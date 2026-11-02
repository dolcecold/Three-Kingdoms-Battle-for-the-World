/** 길드 공용 최적 5군 UI — 추천/후보 조회/자원 배분/검증은 서버 v0.6.9에서 수행. */
import {LineupPlannerApi,PlannerSession,setPinned,moveEntry,editTactic} from './lineup-planner-client.js';
const $=id=>document.getElementById(id);
const clone=x=>structuredClone(x);
const keyFor=season=>`cheonha-server-planner-v068-s${season}`;
const safeRead=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}};
const safeWrite=(key,val)=>{try{localStorage.setItem(key,JSON.stringify(val));}catch{ /* 개인 브라우저 저장소가 비활성인 경우 메모리 상태만 사용 */ }};
const labelStatus={optimal_within_catalog:'추천 자료 내 탐색 완료',bounded:'제한된 탐색 결과',not_searched:'탐색 전',no_candidates:'후보 없음'};
const cellStatus={selected:'배분됨',conflict:'중복 · 대체 필요',not_owned:'미보유 · 대체 필요',unresolved:'미확정 · 대체 필요'};
export function createPlannerView({state,h,fill,poolSnapshot,notify,openConnection,saveServerEntry,sendServerEntry,listSavedDecks=()=>[],openSavedDeckEditor,openPlannerArmyEditor}){
  let season=null,version=null,baseUrl=null,session=null,plan=null,busy=false,lastError='',lastAction='',projectionMode='auto',manualShadows=new Set(),rules=null,drag=null,validateTimer=null,viewEpoch=0;
  let verifiedPoolSig=null,verifiedProjectionSig=null;
  let candidatesPage=null,candidateLoading=false,candidateError='',candidateQuery='',candidateTarget=1,candidateOffset=0,candidateSeq=0,candidateTimer=null,candidatesExpanded=false,activeView=false;
  let candidateOnlySelectable=true,candidateDraft=false,selectedPosition=1,workTab='edit',movingEntryId=null;
  let savedPickerSelection=new Set(),savedPickSearch='',savedPickerOpen=false;
  const e=(tag,attrs,...children)=>h(tag,attrs,...children);
  const catalog=id=>state.idx?.tactic?.get(Number(id))?.name||`전법 #${id}`;
  const heroName=id=>state.idx?.hero?.get(Number(id))?.name||`무장 #${id}`;
  function showStatus(text,isError=false){lastError=isError?text:'';const el=$('planner-server-status');el.textContent=text||'';el.classList.toggle('planner-error',isError);}
  const poolSig=()=>JSON.stringify(poolSnapshot());
  const projectionSig=()=>JSON.stringify(projectionSelection());
  const stale=()=>Boolean(plan&&(verifiedPoolSig!==poolSig()||verifiedProjectionSig!==projectionSig()));
  function persist(){if(!season||!plan)return;safeWrite(keyFor(season),{data_version:version,plan,projectionMode,manualShadows:[...manualShadows],verifiedPoolSig,verifiedProjectionSig,candidateDraft,selectedPosition});}
  async function loadRules(){if(rules)return;try{const r=await fetch('./data/projection-rules.json',{cache:'no-cache'});if(r.ok)rules=await r.json();}catch{}rules ||= {options:[]};}
  function projectionSelection(){return state.season===3?(projectionMode==='auto'?'auto':[...manualShadows]):[];}
  function serverReady(){return Boolean(state.api?.baseUrl);}
  function synchronize(){
    const nextSeason=state.season,nextVersion=state.data?.data_version||null,nextUrl=state.api?.baseUrl||null;
    if(season===nextSeason&&version===nextVersion&&baseUrl===nextUrl)return;
    clearTimeout(validateTimer);clearTimeout(candidateTimer);candidateSeq++;candidatesPage=null;candidateLoading=false;candidateError='';session?.cancel();viewEpoch++;
    season=nextSeason;version=nextVersion;baseUrl=nextUrl;session=nextUrl?new PlannerSession(new LineupPlannerApi(nextUrl)):null;busy=false;lastError='';
    const stored=safeRead(keyFor(season));
    plan=stored?.data_version===version&&Array.isArray(stored?.plan?.entries)?stored.plan:null;
    projectionMode=stored?.projectionMode==='manual'?'manual':'auto';manualShadows=new Set(Array.isArray(stored?.manualShadows)?stored.manualShadows.slice(0,3):[]);
    verifiedPoolSig=plan?stored?.verifiedPoolSig??null:null;verifiedProjectionSig=plan?stored?.verifiedProjectionSig??null:null;
    candidateDraft=Boolean(stored?.candidateDraft)&&Boolean(plan);
    selectedPosition=Number(stored?.selectedPosition)||1;
    if(selectedPosition<1||selectedPosition>5)selectedPosition=1;
    workTab=candidateDraft?'candidates':'edit';candidatesExpanded=candidateDraft;candidateTarget=selectedPosition;
    if(session)session.plan=plan;
  }
  const st=(name,value)=>e('span',{class:'planner-stat'},e('b',{text:String(value)}),e('small',{text:name}));
  /** 사용자 저장 덱을 백엔드가 받아들이는 고정 PlannerEntry로 변환. 추천이나 전법 배분은 하지 않는다. */
  function savedToPinnedEntry(deck,position){
    const army=clone(deck.army),heroes=[...(army.heroes||[])].sort((a,b)=>a.slot-b.slot);
    if(heroes.length!==3||new Set(heroes.map(x=>x.hero_id)).size!==3)throw Error(`${deck.name}: 장수 세팅을 확인해 주세요.`);
    const cells=[];
    for(const hero of heroes)for(let slot=1;slot<=2;slot++){
      const learned=hero.learned?.[slot-1];
      cells.push({hero_slot:hero.slot,slot,selected_id:learned?.skill_id??null,preferred_id:null,
        state:learned?.skill_id!=null?'selected':'unresolved',reference_alternatives:[]});
    }
    return {entry_id:`saved-${deck.id}`,candidate_id:null,position,pinned:true,title:deck.name,
      army,tactic_slots:cells,battle_ready:false,code:null,notes:['내 덱에서 가져온 고정 편성 · 서버 제약 검증 필요']};
  }
  /** 선택한 내 덱만 보존한 별도 작업 계획. 서버에서 아직 성공 검증되지 않았으므로 기존 계획은 요청 실패 시 보존한다. */
  function importSavedDecks(ids){
    if(!serverReady())throw Error('서버 연결 후 저장 덱을 작업실로 불러올 수 있습니다.');
    if(busy){notify('서버 요청 완료 후 다시 실행해 주세요.',true);return;}
    const selected=[...new Set(ids)].map(id=>listSavedDecks().find(d=>d.id===id)).filter(Boolean);
    if(!selected.length){notify('가져올 수 있는 내 덱이 없습니다.',true);return;}
    if(selected.length>5){notify('최대 5개의 덱만 고정할 수 있습니다.',true);return;}
    if(!selected.every(d=>d.army?.heroes?.length===3))throw Error('빈칸 포함 계획 초안은 고정 편성에 넣을 수 없습니다.');
    const used=new Map();
    for(const d of selected)for(const hero of d.army.heroes){
      const other=used.get(hero.hero_id);if(other)throw Error(`${heroName(hero.hero_id)}: 「${other}」와 「${d.name}」에서 중복 사용 중입니다. 내 덱을 수정한 뒤 다시 선택해 주세요.`);
      used.set(hero.hero_id,d.name);
    }
    savedPickerSelection=new Set(selected.map(d=>d.id));
    const entries=selected.map((d,i)=>savedToPinnedEntry(d,i+1));
    const draft={entries,empty_positions:Array.from({length:5-selected.length},(_,i)=>selected.length+i+1),
      candidate_count:null,search_status:'not_searched',lineup_ready:false,notices:[],changes:[],used_projection_ids:[],available_tactic_ids:[]};
    // 실제 서버 추천 상태 대신 별도 초안으로 표시. 실패하더라도 개인 저장 덱은 변하지 않는다.
    session?.cancel();viewEpoch++;plan=draft;if(session)session.plan=draft;
    candidateDraft=true;selectedPosition=Math.min(5,selected.length+1);candidateTarget=selectedPosition;
    candidatesExpanded=true;workTab='candidates';candidateQuery='';candidateOffset=0;candidateOnlySelectable=true;
    verifiedPoolSig=null;verifiedProjectionSig=null;invalidateCandidates(false);persist();render();
    showStatus(`내 덱 ${selected.length}개를 📌 고정했습니다. 남은 ${5-selected.length}개 순위에 맞는 서버 후보를 찾습니다.`);
    loadCandidates();
  }
  /** 다른 화면에서도 내 덱을 고정할 수 있도록 선택 가능 리스트를 편성 작업실에 표시한다. */
  function renderSavedPicker(){
    const wrap=e('section',{class:'planner-ux-saved-picker'},
      e('div',{class:'planner-ux-picker-head'},e('div',null,e('h4',{text:'내 덱에서 고정 편성 선택'}),
        e('p',{class:'muted-note',text:'예: 내 덱 4개 선택 → 1~4군 고정 → 서버에서 가능한 5군 후보만 조회. 실제 내 덱은 삭제·수정되지 않습니다.'})),
        e('a',{href:'#/roster/pool',class:'ghost-btn small',text:'보유 풀 등록·확인'})));
    const inp=e('input',{type:'search',placeholder:'저장된 덱 검색',value:savedPickSearch,'aria-label':'작업실 내 덱 검색'});
    inp.addEventListener('input',()=>{savedPickSearch=inp.value;const old=wrap.querySelector('.planner-ux-saved-items');if(old){old.replaceWith(buildRows());}});
    const badge=e('span',{class:'muted-note',text:`${savedPickerSelection.size}/5개 선택`});
    const run=e('button',{type:'button',class:'solid-btn',disabled:busy||!savedPickerSelection.size,
      onClick:()=>{try{importSavedDecks([...savedPickerSelection]);}catch(error){notify(error.message||String(error),true);}},text:'선택한 덱으로 5군 시작 →'});
    function buildRows(){
      const rows=e('div',{class:'planner-ux-saved-items'}),list=listSavedDecks().filter(d=>d.army&&(!savedPickSearch||d.name.toLocaleLowerCase('ko').includes(savedPickSearch.toLocaleLowerCase('ko'))));
      for(const d of list){
        const mark=e('input',{type:'checkbox',checked:savedPickerSelection.has(d.id),disabled:busy});
        mark.addEventListener('change',()=>{
          if(mark.checked&&savedPickerSelection.size>=5){mark.checked=false;notify('내 덱은 최대 5개 선택할 수 있습니다.',true);return;}
          mark.checked?savedPickerSelection.add(d.id):savedPickerSelection.delete(d.id);
          badge.textContent=`${savedPickerSelection.size}/5개 선택`;run.disabled=!savedPickerSelection.size||busy;
        });
        const line=e('div',{class:'planner-ux-saved-row'},
          e('label',null,mark,e('span',null,e('strong',{text:d.name}),e('small',{text:d.army.heroes.map(x=>heroName(x.hero_id)).join(' · ')}))),
          e('button',{type:'button',class:'ghost-btn small',onClick:()=>openSavedDeckEditor(d.id).then(()=>render()).catch(error=>notify(error.message,true)),text:'바로 편집'}));
        rows.append(line);
      }
      if(!list.length)rows.append(e('p',{class:'muted-note',text:'저장된 완성 덱이 없습니다. 보유 풀 → 내 덱에서 덱을 먼저 저장해 주세요.'}));
      return rows;
    }
    wrap.append(e('div',{class:'planner-ux-picker-controls'},inp,badge,run),buildRows());
    return wrap;
  }
  function refreshAfterArmyEdit(entryId,army){
    const current=plan?.entries.find(x=>x.entry_id===entryId);if(!current)return;
    const next=clone(plan),row=next.entries.find(x=>x.entry_id===entryId);
    row.army=clone(army);row.title=army.name;row.battle_ready=false;row.code=null;
    row.tactic_slots=[];
    for(const hero of army.heroes)for(let slot=1;slot<=2;slot++)row.tactic_slots.push({hero_slot:hero.slot,slot,
      selected_id:hero.learned?.[slot-1]?.skill_id??null,preferred_id:null,
      state:hero.learned?.[slot-1]?'selected':'unresolved',reference_alternatives:[]});
    next.lineup_ready=false;plan=next;session.plan=next;persist();invalidateCandidates(false);render();
    // 서버가 최종 확인; 입력을 임의로 고치지 않는다.
    request('validate',plan);
  }
  function renderProjection(){
    const holder=$('planner-projection-panel');holder.hidden=state.season!==3;
    $('planner-projection-label').textContent=projectionMode==='auto'?'자동 · 서버 최대 3종':`직접 선택 · ${manualShadows.size}/3종`;
    document.querySelectorAll('input[name="projection-mode"]').forEach(input=>input.checked=input.value===projectionMode);
    const own=new Set((poolSnapshot().tactics||[]).map(Number));
    const possible=(rules?.options||[]).filter(p=>own.has(p.base_id)||own.has(p.shadow_id));
    $('planner-projection-hint').textContent='보유 원본 기준 선택 가능 '+possible.length+'종. 실제 배분 및 중복 검사는 서버가 수행합니다.';
    fill($('planner-projection-options'),...(rules?.options||[]).map(p=>e('label',{class:possible.some(x=>x.shadow_id===p.shadow_id)?'':'is-disabled'},
      e('input',{type:'checkbox',value:String(p.shadow_id),disabled:projectionMode!=='manual'||!possible.some(x=>x.shadow_id===p.shadow_id),checked:manualShadows.has(p.shadow_id)}),e('span',{text:`영·${p.name}`}))));
  }
  function render(){
    $('planner-season').textContent=`한국 시즌 ${state.season}`;
    $('planner-count').value='5';renderProjection();
    const pool=poolSnapshot();
    fill($('planner-overview'),st('보유 무장',pool.heroes.length),st('보유 전법',pool.tactics.length),st('서버 후보',plan?.candidate_count??'—'),st('추천 부대',plan?.entries?.length??'—'));
    $('planner-explain').textContent=plan?`${candidateDraft?'📌 고정 부대만 유지 · 나머지 후보 선택 중 · ':''}${stale()?'⚠ 보유 풀/투영 선택 변경 — 다시 서버 검증 필요 · ':''}서버 기준 · ${labelStatus[plan.search_status]||plan.search_status||'검토 필요'} · ${plan.lineup_ready?'5군 자원 검사 통과':'편성 검토 필요'} · 실전 승률 보증 아님`:'📌 고정 부대 보존, 전법 대체, 미완성 초안 점검은 백엔드에서 처리합니다.';
    $('planner-server-recommend').hidden=true; // 최초 추천은 진입할 때 자동 호출. 사용자 수동 실행은 '나머지 재추천'.
    $('planner-server-rebuild').disabled=busy||!serverReady()||!plan;
    $('planner-server-validate').disabled=busy||!serverReady()||!plan;
    $('planner-server-rebuild').hidden=!plan;
    $('planner-server-validate').hidden=!plan;
    if(!serverReady()){
      showStatus('전투 서버가 연결되지 않았습니다. 연결 후 서버 추천을 실행할 수 있습니다.',true);
      fill($('planner-results'),e('div',{class:'empty-box'},e('p',{text:'이 기능은 백엔드 v0.6.9 이상에 연결되어야 동작합니다. 이전 브라우저 추천 엔진으로 자동 전환하지 않습니다.'}),e('button',{type:'button',class:'solid-btn',onClick:openConnection,text:'서버 연결 설정'})));
      return;
    }
    if(!pool.heroes.length){fill($('planner-results'),e('div',{class:'empty-box'},e('p',{text:'보유 풀에 장수를 등록한 뒤 추천을 실행하세요.'}),e('a',{href:'#/roster/pool',class:'ghost-btn',text:'보유 풀 관리'})));return;}
    if(!plan){fill($('planner-results'),renderSavedPicker(),e('div',{class:'empty-box'},e('p',{text:busy?'보유 풀 기준으로 서버에서 5군을 계산하고 있습니다.':'자동 추천 결과를 불러오지 못했습니다. 서버 연결을 확인하고 다시 시도해 주세요.'}),busy?null:e('button',{type:'button',class:'solid-btn',onClick:()=>request('rebuild',null),text:'다시 추천 받기'})));return;}
    const wasSearching=document.activeElement?.getAttribute?.('aria-label')==='서버 후보 검색';
    const entries=[...plan.entries].sort((a,b)=>a.position-b.position);
    const byPosition=new Map(entries.map(x=>[x.position,x]));
    const owned=new Set(pool.tactics.map(Number));
    const usedProjection=(plan.used_projection_ids||[]).map(catalog);
    const resultStale=stale();
    // A compact squad rail is always visible; only one selected squad is edited at a time.
    if(!Number.isInteger(selectedPosition)||selectedPosition<1||selectedPosition>5)selectedPosition=1;
    const selected=byPosition.get(selectedPosition);
    const emptyCount=5-entries.length;
    const pinnedCount=entries.filter(x=>x.pinned).length;
    const readyCount=entries.filter(x=>x.battle_ready&&x.code&&!resultStale).length;
    const header=e('header',{class:'planner-plan-head planner-ux-heading'},
      e('div',null,e('h3',{text:'내 최적 5군'}),e('p',{class:'planner-plan-explain',text:'부대를 선택해 전법을 편집하거나, 같은 위치에서 다른 후보를 찾아 교체하세요.'})),
      e('div',{class:'planner-plan-head-stats'},st('고정',`${pinnedCount}군`),st('배틀 가능',`${readyCount}/5`),st('빈 순위',`${emptyCount}군`)));
    const actions=e('div',{class:'planner-ux-toolbar'},
      e('button',{type:'button',class:'ghost-btn',disabled:busy,onClick:keepPinnedOnly,text:'📌 고정만 남기고 비우기'}),
      e('button',{type:'button',class:'ghost-btn',disabled:busy,onClick:()=>saveAll(),text:'5군 전체 저장'}));
    const changeSelected=(p)=>{
      selectedPosition=p;candidateTarget=p;
      workTab=byPosition.has(p)?'edit':'candidates';
      candidatesExpanded=workTab==='candidates';
      persist();render();
      if(candidatesExpanded&&!candidatesPage&&!candidateLoading)loadCandidates();
    };
    const squads=[];
    for(let position=1;position<=5;position++){
      const row=byPosition.get(position),isSelected=position===selectedPosition;
      if(!row){squads.push(e('div',{class:`planner-ux-squad planner-empty-position ${isSelected?'is-active':''}`,dataset:{emptyPosition:String(position)}},
        e('button',{type:'button',class:'planner-ux-squad-select',onClick:()=>changeSelected(position),'aria-pressed':String(isSelected)},
          e('strong',{text:`${position}군`}),e('span',{class:'planner-ux-squad-title',text:'빈 편성'}),e('small',{text:'다른 후보 선택하기 →'}))));continue;}
      const complete=Boolean(row.battle_ready&&row.code&&!resultStale);
      squads.push(e('div',{class:`planner-ux-squad planner-sort-item ${isSelected?'is-active':''}`,dataset:{entryId:row.entry_id}},
        e('button',{type:'button',class:'planner-drag-handle',title:'잡아서 순서 변경', 'aria-label':`${position}군 드래그 이동`,text:'⠿'}),
        e('button',{type:'button',class:'planner-ux-squad-select',onClick:()=>changeSelected(position),'aria-pressed':String(isSelected)},
          e('strong',{text:`${position}군`}),e('span',{class:'planner-ux-squad-title',text:row.title||`${position}군 편성`}),
          e('small',{text:(row.army?.heroes||[]).slice().sort((a,b)=>a.slot-b.slot).map(x=>heroName(x.hero_id)).join(' · ')}),
          e('span',{class:`planner-ux-progress ${complete?'is-ready':''}`,text:complete?'✓ 배틀 가능':resultStale?'재검증 필요':`${(row.tactic_slots||[]).filter(x=>!x.selected_id||x.state!=='selected').length}칸 확인 필요`})),
        e('button',{type:'button',class:`planner-pin ${row.pinned?'is-pinned':''}`,disabled:busy,'aria-pressed':String(Boolean(row.pinned)),'aria-label':`${position}군 ${row.pinned?'고정 해제':'고정'}`,title:'이 부대 전체 고정/해제',onClick:()=>pin(row.entry_id),text:row.pinned?'📌':'📍'})));
    }
    const tabs=e('div',{class:'planner-ux-tabs',role:'tablist','aria-label':'최적 5군 작업'},
      e('button',{type:'button',role:'tab','aria-selected':String(workTab==='edit'),class:workTab==='edit'?'is-active':'',disabled:!selected,
        onClick:()=>{workTab='edit';candidatesExpanded=false;invalidateCandidates(false);render();},text:'선택 부대 편집'}),
      e('button',{type:'button',role:'tab','aria-selected':String(workTab==='candidates'),class:workTab==='candidates'?'is-active':'',
        onClick:()=>{workTab='candidates';candidatesExpanded=true;candidateTarget=selectedPosition;render();if(!candidatesPage&&!candidateLoading)loadCandidates();},text:'다른 후보 찾기'}));
    let content;
    if(workTab==='candidates'){
      candidateTarget=selectedPosition;
      content=renderCandidates();
    } else if(!selected){
      content=e('div',{class:'planner-ux-placeholder'},e('h4',{text:`${selectedPosition}군 · 아직 편성이 없습니다`}),
        e('p',{text:'서버 추천 후보에서 원하는 장수 조합을 선택할 수 있습니다.'}),
        e('button',{type:'button',class:'solid-btn',onClick:()=>{workTab='candidates';candidatesExpanded=true;render();loadCandidates();},text:'이 자리에 후보 넣기'}));
    } else {
      const row=selected;
      const warning=(row.tactic_slots||[]).filter(s=>s.selected_id==null||s.state!=='selected').length;
      const heroCards=[];
      for(const hero of [...(row.army?.heroes||[])].sort((a,b)=>a.slot-b.slot)){
        const slots=(row.tactic_slots||[]).filter(s=>s.hero_slot===hero.slot).sort((a,b)=>a.slot-b.slot);
        heroCards.push(e('section',{class:'planner-ux-hero'},
          e('header',null,e('span',{class:'planner-ux-hero-index',text:String(hero.slot)}),
            e('div',null,e('strong',{text:heroName(hero.hero_id)}),e('small',{text:`Lv.${hero.level??50}`}))),
          e('div',{class:'planner-ux-skills'},...slots.map(s=>{
            const ok=Boolean(s.selected_id&&s.state==='selected');
            return e('button',{type:'button',class:`planner-ux-skill ${ok?'':'needs-attention'}`,disabled:busy,
              onClick:()=>edit(row.entry_id,hero.slot,s.slot),'aria-label':`${heroName(hero.hero_id)} 학습 전법 ${s.slot} 변경`},
              e('span',{class:'planner-ux-skill-index',text:`전법 ${s.slot}`}),
              e('strong',{text:s.selected_id?catalog(s.selected_id):'비어 있음 · 선택하기'}),
              e('small',{text:ok?'편집 ↗':s.preferred_id?`추천 ${catalog(s.preferred_id)} · 클릭해 대체`:'클릭해서 전법 선택'}));
          }))));
      }
      content=e('div',{class:'planner-ux-editor'},
        e('header',{class:'planner-ux-editor-header'},e('div',null,
          e('div',{class:'planner-ux-editor-meta'},e('span',{class:'planner-tag tier',text:row.tier_label||'원문 티어 미기재'}),
            e('span',{class:`planner-tag ${warning||resultStale?'missing':'owned'}`,text:resultStale?'서버 재검증 필요':warning?`전법 ${warning}칸 확인 필요`:row.battle_ready?'배틀 가능':'서버 검증 필요'})),
          e('h4',{text:`${selectedPosition}군 · ${row.title||'편성'}`}),
          e('p',{class:'muted-note',text:row.pinned?'📌 고정됨 · 재추천 시 편성 전체 보존':'미고정 · 나머지 재추천 시 교체될 수 있음'})),
          e('button',{type:'button',class:'ghost-btn small',disabled:busy||row.pinned,onClick:()=>{workTab='candidates';candidatesExpanded=true;candidateTarget=selectedPosition;render();loadCandidates();},text:row.pinned?'고정 해제 후 교체':'이 군의 다른 후보 보기'})),
        e('div',{class:'planner-ux-complete-edit'},
          e('span',{class:'muted-note',text:'전법은 아래 칸을 누르고, 나머지 편성은 한곳에서 편집하세요.'}),
          e('button',{type:'button',class:'ghost-btn small',disabled:busy,onClick:()=>openPlannerArmyEditor({entry:row,onSave:async army=>refreshAfterArmyEdit(row.entry_id,army)}).catch(error=>notify(error.message||String(error),true)),text:'장수 · 진형 · 병법 · 병종 전체 편집'})),
        e('div',{class:'planner-ux-heroes'},...heroCards),
        e('div',{class:'planner-ux-editor-movement'},
          e('span',{class:'muted-note',text:'우선순위 변경 · 전법 재배분'}),
          e('button',{type:'button',class:'ghost-btn small',disabled:busy||selectedPosition===1,onClick:()=>move(row.entry_id,1),text:'맨 앞으로'}),
          e('button',{type:'button',class:'ghost-btn small',disabled:busy||selectedPosition===1,onClick:()=>move(row.entry_id,selectedPosition-1),text:'↑ 위'}),
          e('button',{type:'button',class:'ghost-btn small',disabled:busy||selectedPosition===5,onClick:()=>move(row.entry_id,selectedPosition+1),text:'↓ 아래'})),
        (row.notes||[]).length?e('details',{class:'planner-ux-notes'},e('summary',{text:`추천 원문·검토 사항 (${row.notes.length})`}),...(row.notes||[]).map(note=>e('p',{class:'muted-note',text:String(note)}))):null,
        e('div',{class:'planner-ux-editor-actions'},
          e('button',{type:'button',class:'ghost-btn',disabled:busy,onClick:()=>saveOne(row),text:row.battle_ready&&row.code&&!resultStale?'내 덱에 저장':'계획 초안 저장'}),
          e('button',{type:'button',class:'solid-btn',disabled:busy||resultStale||!row.battle_ready||!row.code,onClick:()=>sendOne(row),text:'배틀에 불러오기'}),
          e('button',{type:'button',class:'ghost-btn',disabled:busy,onClick:()=>rebuildPinned(row.entry_id),text:'이 군 고정 후 나머지 재추천'})));
    }
    const workspace=e('section',{class:'planner-ux-workspace'},tabs,
      e('div',{class:'planner-ux-workspace-content'},content));
    const savedPanel=e('details',{class:'planner-ux-saved-panel',open:savedPickerOpen,onToggle:evt=>{savedPickerOpen=evt.target.open;}},
      e('summary',{text:'내 덱에서 1~5군 고정 선택 · 배틀 이동 없이 편집'}),renderSavedPicker());
    const board=e('div',{class:'planner-ux-board'},
      e('aside',{class:'planner-ux-rail','aria-label':'5군 선택 목록'},
        e('div',{class:'planner-ux-rail-head'},e('strong',{text:'부대 선택'}),e('small',{text:'📌 고정 · ⠿ 순서 이동'})),
        e('div',{class:'planner-plan-list'},...squads)),workspace);
    fill($('planner-results'),e('article',{class:'planner-plan war-card planner-ux'},header,savedPanel,actions,board,
      ...[...new Set((plan.notices||[]).map(String))].filter(x=>!/^다른 부대가 사용 중이거나/.test(x)).slice(0,2).map(x=>e('p',{class:'muted-note',text:x}))));
    if(wasSearching&&workTab==='candidates'){const input=$('planner-results').querySelector('input[aria-label="서버 후보 검색"]');if(input){input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length);}}
  }
  /** 후보 조회는 절대 현재 편성을 변경하지 않는다. 검색/핀/보유풀 변경 시 이전 응답은 무효화한다. */
  function invalidateCandidates(reload=false){
    clearTimeout(candidateTimer);candidateSeq++;candidatesPage=null;candidateLoading=false;candidateError='';
    if(reload&&activeView&&candidatesExpanded&&plan&&serverReady())loadCandidates();
  }
  async function loadCandidates(){
    if(!activeView||!candidatesExpanded||!plan||!session||busy)return;
    const n=++candidateSeq,epoch=viewEpoch,currentSession=session,signature=poolSig(),projectSig=projectionSig();
    candidateLoading=true;candidateError='';render();
    try {
      const result=await currentSession.candidates({season:state.season,pool:poolSnapshot(),count:5,
        projection_selection:projectionSelection(),data_version:version,
        // 후보 조회에 다른 미고정 3~5군을 전송하면 사용자가 교체하려는 편성까지
        // 예약됐다고 오해할 수 있다. 실제 사용/제약 판정은 고정 부대만 기준으로 한다.
        plan:{entries:(plan.entries||[]).filter(e=>e.pinned)},
        exclude_candidate_ids:(plan.entries||[]).filter(e=>e.pinned).map(e=>e.candidate_id).filter(Boolean),
        query:candidateQuery.trim(),offset:candidateOffset,limit:100});
      if(n!==candidateSeq||epoch!==viewEpoch||!activeView||!candidatesExpanded||currentSession!==session||signature!==poolSig()||projectSig!==projectionSig()||!result)return;
      candidatesPage=result;
    }catch(err){
      if(n!==candidateSeq||epoch!==viewEpoch||!activeView)return;
      candidateError=errorMessage(err);
    }finally{if(n===candidateSeq&&epoch===viewEpoch&&activeView){candidateLoading=false;render();}}
  }
  function insertCandidate(candidate){
    if(!plan||busy||!candidate?.is_selectable)return;
    const position=candidateTarget;
    if(plan.entries.some(e=>e.position===position&&e.pinned)){
      notify(`${position}군은 고정된 부대입니다. 고정을 해제한 뒤 다시 선택하세요.`,true);return;
    }
    // 서버가 candidate_id로 실제 원문 편성을 복원한다. 클라이언트 편성 조립 금지.
    request('rebuild',plan,[{position,candidate_id:candidate.candidate_id,pin_result:true}]);
  }
  function renderCandidates(){
    const box=e('section',{class:'planner-alternatives'},e('h4',{text:'서버 추천 후보에서 교체'}),
      e('p',{class:'muted-note',text:'📌 고정된 부대만 자원을 선점합니다. 고정하지 않은 순위는 모두 비우고 후보를 자유롭게 선택할 수 있습니다. 선택 가능하더라도 전법 부족은 삽입 후 직접 수정해야 합니다.'}));
    if(plan.entries.some(x=>x.position===candidateTarget&&x.pinned))
      candidateTarget=Array.from({length:5},(_,i)=>i+1).find(x=>!plan.entries.some(y=>y.position===x&&y.pinned))||1;selectedPosition=candidateTarget;
    const select=e('select',{'aria-label':'후보 삽입 순위'});
    for(let p=1;p<=5;p++){
      const pinned=plan.entries.some(x=>x.position===p&&x.pinned);
      select.append(e('option',{value:p,disabled:pinned,text:`${p}군 ${pinned?'· 고정 (선택 불가)':'위치에 넣기'}`}));
    }
    select.value=String(candidateTarget);
    select.addEventListener('change',()=>{candidateTarget=Number(select.value);selectedPosition=candidateTarget;persist();render();});
    const search=e('input',{type:'search',placeholder:'서버 후보 이름 또는 ID 검색',value:candidateQuery,'aria-label':'서버 후보 검색'});
    search.addEventListener('input',()=>{
      candidateQuery=search.value;candidateOffset=0;
      invalidateCandidates(false);clearTimeout(candidateTimer);
      const oldList=box.querySelector('.planner-alternative-list');
      if(oldList)oldList.replaceChildren(e('p',{class:'muted-note',text:'검색어에 맞는 후보 조회 대기 중…'}));
      candidateTimer=setTimeout(loadCandidates,300);
      // 검색 입력에 포커스를 유지하도록 결과 렌더링은 서버 요청 때 수행.
    });
    const reload=e('button',{type:'button',class:'ghost-btn small',disabled:busy||candidateLoading,onClick:()=>loadCandidates(),text:'후보 새로고침'});
    box.append(e('div',{class:'planner-alternative-controls'},e('label',null,'교체 위치 ',select),search,reload));
    box.append(e('label',{class:'planner-candidate-filter'},
      e('input',{type:'checkbox',checked:candidateOnlySelectable,onChange:evt=>{candidateOnlySelectable=evt.target.checked;render();}}),
      e('strong',{text:'선택 가능한 후보만 보기'}),
      e('span',{class:'muted-note',text:'해제하면 선택 불가 후보도 함께 보입니다.'})));
    if(candidateLoading){box.append(e('p',{class:'muted-note',text:'보유 풀과 고정 편성으로 서버 후보를 확인하는 중…'}));return box;}
    if(candidateError){box.append(e('p',{class:'planner-error',text:candidateError}));return box;}
    if(!candidatesPage){box.append(e('p',{class:'muted-note',text:'다른 후보 보기를 열면 서버에서 후보를 조회합니다.'}));return box;}
    const page=candidatesPage,unfiltered=Array.isArray(page.candidates)?page.candidates:[];
    // 선택 가능 → 부족 전법 적은 순 → 검토 필요 적은 순. 서버 전투력·승률 점수 아님.
    const sorted=[...unfiltered].sort((a,b)=>
      Number(Boolean(b.is_selectable))-Number(Boolean(a.is_selectable)) ||
      (a.missing_tactic_ids?.length??99)-(b.missing_tactic_ids?.length??99) ||
      Number(Boolean(a.needs_review))-Number(Boolean(b.needs_review)));

    const rows=candidateOnlySelectable?sorted.filter(x=>x.is_selectable):sorted;
    const canSelect=unfiltered.filter(x=>x.is_selectable).length;
    box.append(e('p',{class:'muted-note',text:`서버 후보 ${page.total??0}개 · 현재 ${unfiltered.length}개 중 선택 가능 ${canSelect}개 · 선택 가능/부족 전법 적은 순 (승률 순위 아님)` }));
    const list=e('div',{class:'planner-alternative-list'});
    for(const item of rows){
      const selectable=Boolean(item.is_selectable),heroes=(item.hero_ids||[]).map((id,i)=>`${heroName(id)}${item.hero_owned?.[i]===false?' (미보유)':''}`).join(' · ');
      const message=[selectable?`서버 전법 충족 ${Math.max(0,6-(item.missing_tactic_ids||[]).length)}/6칸 (참고값)`:null,
        !selectable?(item.unavailable_reason||'보유·고정·시즌 조건 확인 필요'):null,
        selectable&&(item.missing_tactic_ids||[]).length?`부족한 전법 ${item.missing_tactic_ids.map(catalog).join(', ')} · 삽입 후 수동 대체`:null,
        item.needs_review?'병법/연의/원문 세팅 추가 확인 필요':null,
        ...(item.preview?.notes||[]).slice(0,3).map(String),
        ...(item.issues||[]).slice(0,2).map(i=>typeof i==='string'?i:i.message).filter(Boolean)].filter(Boolean).join(' / ');
      list.append(e('div',{class:'planner-alternative-row'},
        e('div',{class:'planner-alternative-description'},
          e('b',{text:item.title||item.candidate_id}),e('span',{class:'muted-note',text:heroes}),
          e('small',{text:[item.tier_label,item.source,selectable?'선택 가능':'선택 불가'].filter(Boolean).join(' · ')}),
          message?e('small',{class:'muted-note',text:message}):null),
        e('button',{type:'button',class:'ghost-btn small',disabled:busy||!selectable||plan.entries.some(x=>x.position===candidateTarget&&x.pinned),
          onClick:()=>insertCandidate(item),text:selectable?'이 순위에 넣고 재추천':'선택 불가'})));
    }
    if(!rows.length)list.append(e('p',{class:'muted-note',text:candidateOnlySelectable?'이 페이지에는 선택 가능한 후보가 없습니다. 체크를 해제하면 선택 불가 사유를 볼 수 있습니다.':'조건에 맞는 후보가 없습니다.'}));
    box.append(list);
    const total=Number(page.total||0),offset=Number(page.offset||0),limit=Number(page.limit||100);
    box.append(e('div',{class:'planner-alternative-pagination'},
      e('button',{type:'button',class:'ghost-btn small',disabled:offset===0||candidateLoading,onClick:()=>{candidateOffset=Math.max(0,offset-limit);loadCandidates();},text:`이전 ${limit}개`}),
      e('span',{class:'muted-note',text:`${total?Math.floor(offset/limit)+1:0} / ${Math.max(1,Math.ceil(total/limit))}페이지`}),
      e('button',{type:'button',class:'ghost-btn small',disabled:offset+rows.length>=total||candidateLoading,onClick:()=>{candidateOffset=offset+limit;loadCandidates();},text:`다음 ${limit}개`})));
    return box;
  }
  function errorMessage(err){
    if(err?.status===429)return `서버 계산 중입니다. ${err.retryAfter?`${err.retryAfter}초 뒤에 `:'잠시 후 '}다시 실행해 주세요. 자동 반복 요청하지 않습니다.`;
    if(err?.status===413)return '요청 데이터가 서버 제한을 초과했습니다. 보유 풀 또는 서버 요청 크기 제한을 확인하세요.';
    if(err?.status===422){const details=(err.issues||[]).slice(0,3).map(i=>`${i.position?`${i.position}군 · `:''}${i.message||''}`).filter(Boolean).join(' / ');return `${err.code==='INVALID_LINEUP'?'고정 부대/편성 자원 충돌':'요청 정보'}: ${err.message||'서버 제약을 확인하세요.'}${details?' · '+details:''} 기존 편성과 보유 풀은 유지했습니다.`;}
    return `${err?.message||'서버 연결 실패'}. 기존 편성과 보유 풀은 유지했습니다.`;
  }
  async function request(mode='rebuild',input=plan,forced_candidates=[]){
    synchronize();if(!serverReady()){render();return;}
    const currentEpoch=viewEpoch,before=plan;busy=true;showStatus(`서버에서 ${mode==='validate'?'편성 검증':mode==='reorder'?'전법 재배분':forced_candidates.length?'후보 배치 및 잔여 재추천':'5군 추천'} 중…`);render();
    try{
      const data=await session.run({season:state.season,data_version:state.data?.data_version||null,pool:poolSnapshot(),count:5,mode,plan:input,projection_selection:projectionSelection(),forced_candidates});
      if(!data||currentEpoch!==viewEpoch)return;
      plan=data;session.plan=data;candidateDraft=false;if(mode==='reorder'&&movingEntryId){const moved=data.entries?.find(x=>x.entry_id===movingEntryId);if(moved)selectedPosition=moved.position;}movingEntryId=null;if(forced_candidates.length){workTab='edit';candidatesExpanded=false;selectedPosition=forced_candidates[0].position;}invalidateCandidates(false);verifiedPoolSig=poolSig();verifiedProjectionSig=projectionSig();persist();showStatus(`서버 응답 완료 · ${labelStatus[data.search_status]||'결과 확인'} · ${data.entries?.length||0}개 부대`);if(candidatesExpanded)loadCandidates();
    }catch(err){if(currentEpoch!==viewEpoch)return;plan=before;movingEntryId=null;showStatus(errorMessage(err),true);}
    finally{if(currentEpoch===viewEpoch){busy=false;render();if(candidatesExpanded&&activeView&&serverReady()&&!candidatesPage&&!candidateLoading)loadCandidates();}}
  }
  /** 📌 고정된 부대만 현재 순위를 유지한다. 비고정 순위만 비우고 서버 후보 조회로 전환한다.
   * 내 덱·보유 풀은 변경하지 않으며, 고정 부대가 0개면 확인 후 전체 순위를 비운다.
   */
  function keepPinnedOnly(){
    if(!plan||busy)return;
    const keep=(plan.entries||[]).filter(x=>x.pinned).map(clone);
    if(keep.length===5){notify('5개 부대가 모두 고정되어 있습니다. 후보를 교체하려면 먼저 해당 부대의 📌 고정을 해제해 주세요.',true);return;}
    if(!keep.length&&!window.confirm('고정된 부대가 없습니다. 현재 5군 계획을 모두 비우고 새 후보를 선택할까요? (내 덱과 보유 풀은 변경하지 않습니다.)'))return;
    clearTimeout(validateTimer);session?.cancel();viewEpoch++;busy=false;
    const occupied=new Set(keep.map(x=>x.position));
    plan={...clone(plan),entries:keep,empty_positions:Array.from({length:5},(_,i)=>i+1).filter(p=>!occupied.has(p)),
      lineup_ready:false,search_status:'not_searched',notices:[],changes:[],candidate_count:null};
    candidateDraft=true;session.plan=plan;candidatesExpanded=true;candidateQuery='';candidateOffset=0;candidateOnlySelectable=true;
    candidateTarget=plan.empty_positions[0]||1;selectedPosition=candidateTarget;workTab='candidates';
    invalidateCandidates(false);persist();render();
    showStatus(`📌 고정 ${keep.length}개 부대 유지 · 비고정 ${plan.empty_positions.length}개 순위 비움 · 서버에서 선택 가능한 후보 조회 중`);
    loadCandidates();
  }
  function pin(id){if(busy||!plan)return;try{const row=plan.entries.find(x=>x.entry_id===id);plan=setPinned(plan,id,!row.pinned);if(session)session.plan=plan;persist();invalidateCandidates(true);render();showStatus('📌 표시만 변경했습니다. 「나머지 재추천」을 누르면 고정 부대를 보존합니다.');}catch(err){notify(err.message,true);}}
  function move(id,to){if(busy||!plan)return;try{const changed=moveEntry(plan,id,to);movingEntryId=id;request('reorder',changed);}catch(err){notify(err.message,true);}}
  function rebuildPinned(id){if(busy||!plan)return;try{request('rebuild',setPinned(plan,id,true));}catch(err){notify(err.message,true);}}
  const safeEntry=entry=>stale()?{...entry,battle_ready:false,code:null}:entry;
  async function saveOne(entry){try{await saveServerEntry(safeEntry(entry));notify(`'${entry.title}' 내 덱에 저장했습니다. 개인 브라우저에만 저장됩니다.`);}catch(err){notify(err.message||String(err),true);}}
  async function saveAll(){let count=0;for(const entry of plan?.entries||[]){try{await saveServerEntry(safeEntry(entry));count++;}catch(err){notify(`${count}개 저장 이후 중단: ${err.message}`,true);return;}}notify(`${count}개를 내 덱에 새로 저장했습니다. 기존 덱은 덮어쓰지 않았습니다.`);}
  async function sendOne(entry){if(stale()||!entry.battle_ready||!entry.code)return;try{await sendServerEntry(entry);}catch(err){notify(err.message||String(err),true);}}
  function edit(id,heroSlot,tacticSlot){
    const entry=plan?.entries.find(x=>x.entry_id===id),cell=entry?.tactic_slots.find(x=>x.hero_slot===heroSlot&&x.slot===tacticSlot);if(!cell)return;
    const d=$('planner-tactic-dialog');d.replaceChildren();const form=e('div',{class:'planner-tactic-form'});
    const title=e('h3',{text:`${entry.title} · ${heroSlot}번 장수 전법${tacticSlot} 변경`});
    const search=e('input',{type:'search',placeholder:'전법 이름 검색',autocomplete:'off','aria-label':'전법 검색'});
    const list=e('div',{class:'planner-tactic-options'});
    const available=new Set((plan.available_tactic_ids||[]).map(Number));
    const used=new Set((plan.entries||[]).flatMap(x=>(x.tactic_slots||[]).map(s=>Number(s.selected_id))).filter(x=>x));
    const own=new Set((poolSnapshot().tactics||[]).map(Number));
    const universe=new Set([...own,...available,...used,Number(cell.selected_id)].filter(Boolean));
    const options=[...universe].filter(x=>state.idx?.tactic?.has(x)).sort((a,b)=>catalog(a).localeCompare(catalog(b),'ko'));
    function choose(id2){d.close();clearTimeout(validateTimer);session?.cancel();
      const orig=plan;try{
        invalidateCandidates(false);plan=editTactic(plan,id,heroSlot,tacticSlot,id2?{skill_id:id2,level:10,breakthrough:0,grade:0}:null);
        session.plan=plan;persist();showStatus('전법 수동 변경됨 · 서버 validate 대기 중');render();
        validateTimer=setTimeout(()=>request('validate',plan),280);
      }catch(err){plan=orig;notify(err.message,true);render();}}
    function filter(){const q=search.value.trim().toLocaleLowerCase('ko');const rows=options.filter(x=>!q||catalog(x).toLocaleLowerCase('ko').includes(q)||String(x).includes(q)).slice(0,120);
      fill(list,e('button',{type:'button',class:'ghost-btn small',onClick:()=>choose(null),text:'전법 비우기'}),
        ...rows.map(x=>e('button',{type:'button',class:'planner-tactic-choice',onClick:()=>choose(x)},
          e('strong',{text:catalog(x)}),e('small',{text:`#${x} · ${x===cell.selected_id?'현재 장착':available.has(x)?'미사용 가능':used.has(x)?'다른 칸 사용 중 · 서버 검증 필요':'보유 전법 · 검증 필요'}`}))));
      if(!rows.length)list.append(e('p',{class:'muted-note',text:'검색 결과가 없습니다.'}));}
    search.addEventListener('input',filter);
    form.append(title,e('p',{class:'muted-note',text:'사용 중이거나 중복 가능한 전법도 선택할 수 있지만 서버 검증에서 충돌하면 배틀에 보낼 수 없습니다.'}),search,list,e('button',{type:'button',class:'ghost-btn',onClick:()=>d.close(),text:'닫기'}));d.append(form);filter();d.showModal();search.focus();
  }
  function attachDrag(){
    const root=$('planner-results');let gesture=null,raf=0;
    const cleanup=()=>{if(raf)cancelAnimationFrame(raf);raf=0;gesture=null;root.querySelectorAll('.planner-sort-item').forEach(el=>el.classList.remove('planner-is-dragging','planner-drop-before','planner-drop-after'));};
    const destination=(x,y)=>{
      const list=root.querySelector('.planner-ux-rail .planner-plan-list');
      const horizontal=list&&getComputedStyle(list).gridAutoFlow==='column';
      const rows=[...root.querySelectorAll('.planner-sort-item,.planner-empty-position')].filter(el=>el.dataset.entryId!==gesture?.entryId);
      const next=rows.find(el=>{const r=el.getBoundingClientRect();return horizontal?x<r.left+r.width/2:y<r.top+r.height/2;});
      return next?Math.max(1,Number(next.dataset.emptyPosition||plan?.entries.find(e=>e.entry_id===next.dataset.entryId)?.position||1)):5;
    };
    function tick(){if(!gesture)return;
      const {x,y}=gesture,list=root.querySelector('.planner-ux-rail .planner-plan-list');
      const horizontal=list&&getComputedStyle(list).gridAutoFlow==='column';
      if(horizontal){
        const bounds=list.getBoundingClientRect(),edge=54;
        if(x<bounds.left+edge)list.scrollLeft-=Math.ceil((bounds.left+edge-x)/5);
        if(x>bounds.right-edge)list.scrollLeft+=Math.ceil((x-(bounds.right-edge))/5);
      }else{
        const edge=110;
        if(y<edge)window.scrollBy(0,-Math.ceil((edge-y)/5));
        if(y>innerHeight-edge)window.scrollBy(0,Math.ceil((y-(innerHeight-edge))/5));
      }
      const to=destination(x,y);
      root.querySelectorAll('.planner-sort-item').forEach(el=>{el.classList.remove('planner-drop-before','planner-drop-after');if(el.dataset.entryId!==gesture.entryId&&Number(plan?.entries.find(e=>e.entry_id===el.dataset.entryId)?.position)===to)el.classList.add('planner-drop-before');});
      raf=requestAnimationFrame(tick);
    }
    root.addEventListener('pointerdown',evt=>{const handle=evt.target.closest('.planner-drag-handle');if(!handle||busy||evt.button!==0)return;const row=handle.closest('.planner-sort-item');if(!row)return;
      evt.preventDefault();handle.setPointerCapture(evt.pointerId);gesture={id:evt.pointerId,entryId:row.dataset.entryId,x:evt.clientX,y:evt.clientY};row.classList.add('planner-is-dragging');raf=requestAnimationFrame(tick);});
    root.addEventListener('pointermove',evt=>{if(gesture?.id===evt.pointerId){evt.preventDefault();gesture.y=evt.clientY;gesture.x=evt.clientX;}});
    root.addEventListener('pointerup',evt=>{if(!gesture||gesture.id!==evt.pointerId)return;evt.preventDefault();const id=gesture.entryId,to=destination(evt.clientX,evt.clientY),from=plan?.entries.find(e=>e.entry_id===id)?.position;cleanup();if(to&&to!==from)move(id,to);});
    root.addEventListener('pointercancel',cleanup);
  }
  async function show({savedDeckIds=null}={}){activeView=true;synchronize();await loadRules();synchronize();render();
    if(Array.isArray(savedDeckIds)&&savedDeckIds.length){try{importSavedDecks(savedDeckIds);}catch(error){notify(error.message||String(error),true);}return;}
    if(!serverReady()||!poolSnapshot().heroes?.length)return;
    // 사용자 의도로 비운 후보 탐색 계획은 화면 재진입 시 자동 채우지 않는다.
    if(candidateDraft){candidatesExpanded=true;workTab='candidates';candidateOnlySelectable=true;candidateTarget=selectedPosition;render();loadCandidates();return;}
    // 그 외에는 진입 시 자동 추천. 고정은 보존하고 나머지를 재추천한다.
    await request('rebuild',plan);
  }
  $('planner-server-rebuild').addEventListener('click',()=>request('rebuild'));
  $('planner-server-validate').addEventListener('click',()=>request('validate'));
  document.querySelectorAll('input[name="projection-mode"]').forEach(input=>input.addEventListener('change',()=>{if(!input.checked)return;session?.cancel();viewEpoch++;busy=false;projectionMode=input.value;invalidateCandidates(true);persist();render();}));
  $('planner-projection-options').addEventListener('change',evt=>{const input=evt.target.closest('input[type="checkbox"]');if(!input)return;const id=Number(input.value);if(input.checked&&manualShadows.size>=3){input.checked=false;notify('투영 전법은 3종까지 선택할 수 있습니다.',true);return;}
    session?.cancel();viewEpoch++;busy=false;invalidateCandidates(true);if(input.checked)manualShadows.add(id);else manualShadows.delete(id);persist();render();});
  const dialog=e('dialog',{id:'planner-tactic-dialog',class:'planner-tactic-dialog'});document.body.append(dialog);
  attachDrag();
  return {show,cancel:()=>{activeView=false;clearTimeout(validateTimer);invalidateCandidates(false);session?.cancel();viewEpoch++;busy=false;}};
}
