/** 길드 공용 최적 5군 UI — 추천/후보 조회/자원 배분/검증은 서버 v0.6.9에서 수행. */
import {LineupPlannerApi,PlannerSession,setPinned,moveEntry,editTactic} from './lineup-planner-client.js';
const $=id=>document.getElementById(id);
const clone=x=>structuredClone(x);
const keyFor=season=>`cheonha-server-planner-v068-s${season}`;
const safeRead=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}};
const safeWrite=(key,val)=>{try{localStorage.setItem(key,JSON.stringify(val));}catch{ /* 개인 브라우저 저장소가 비활성인 경우 메모리 상태만 사용 */ }};
const labelStatus={optimal_within_catalog:'추천 자료 내 탐색 완료',bounded:'제한된 탐색 결과',not_searched:'탐색 전',no_candidates:'후보 없음'};
const cellStatus={selected:'배분됨',conflict:'중복 · 대체 필요',not_owned:'미보유 · 대체 필요',unresolved:'미확정 · 대체 필요'};
export function createPlannerView({state,h,fill,poolSnapshot,notify,openConnection,saveServerEntry,sendServerEntry}){
  let season=null,version=null,baseUrl=null,session=null,plan=null,busy=false,lastError='',lastAction='',projectionMode='auto',manualShadows=new Set(),rules=null,drag=null,validateTimer=null,viewEpoch=0;
  let verifiedPoolSig=null,verifiedProjectionSig=null;
  let candidatesPage=null,candidateLoading=false,candidateError='',candidateQuery='',candidateTarget=1,candidateOffset=0,candidateSeq=0,candidateTimer=null,candidatesExpanded=false,activeView=false;
  let candidateOnlySelectable=true,candidateDraft=false;
  const e=(tag,attrs,...children)=>h(tag,attrs,...children);
  const catalog=id=>state.idx?.tactic?.get(Number(id))?.name||`전법 #${id}`;
  const heroName=id=>state.idx?.hero?.get(Number(id))?.name||`무장 #${id}`;
  function showStatus(text,isError=false){lastError=isError?text:'';const el=$('planner-server-status');el.textContent=text||'';el.classList.toggle('planner-error',isError);}
  const poolSig=()=>JSON.stringify(poolSnapshot());
  const projectionSig=()=>JSON.stringify(projectionSelection());
  const stale=()=>Boolean(plan&&(verifiedPoolSig!==poolSig()||verifiedProjectionSig!==projectionSig()));
  function persist(){if(!season||!plan)return;safeWrite(keyFor(season),{data_version:version,plan,projectionMode,manualShadows:[...manualShadows],verifiedPoolSig,verifiedProjectionSig,candidateDraft});}
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
    if(session)session.plan=plan;
  }
  const st=(name,value)=>e('span',{class:'planner-stat'},e('b',{text:String(value)}),e('small',{text:name}));
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
    if(!plan){fill($('planner-results'),e('div',{class:'empty-box'},e('p',{text:busy?'보유 풀 기준으로 서버에서 5군을 계산하고 있습니다.':'자동 추천 결과를 불러오지 못했습니다. 연결을 확인한 뒤 메뉴에 다시 진입하거나 재추천하세요.'})));return;}
    const entries=[...plan.entries].sort((a,b)=>a.position-b.position);
    const byPosition=new Map(entries.map(x=>[x.position,x]));
    const owned=new Set(pool.tactics.map(Number));
    const usedProjection=(plan.used_projection_ids||[]).map(catalog);
    const resultStale=stale();
    const header=e('header',{class:'planner-plan-head'},
      e('div',null,e('h3',{text:'서버 추천 5군'}),e('p',{class:'planner-plan-explain',text:'고정한 부대는 순위를 옮겨도 유지됩니다. 순서 변경은 편성을 고정한 채 전법을 재배분합니다.'})),
      e('div',{class:'planner-plan-head-stats'},st('투영 사용',`${(plan.used_projection_ids||[]).length}/3`),st('편성 완성',`${entries.filter(x=>x.battle_ready&&!resultStale).length}/${Number($('planner-count').value)}`)));
    const actions=e('div',{class:'planner-plan-actions'},
      e('span',{class:'planner-tag',text:`${labelStatus[plan.search_status]||'서버 검사'} · ${plan.mode||'rebuild'}`}),
      ...usedProjection.map(name=>e('span',{class:'planner-tag',text:name})),
      e('button',{type:'button',class:'ghost-btn small',disabled:busy,onClick:()=>keepPinnedOnly(false),text:'📌 고정 부대만 남기고 후보 찾기'}),
      e('button',{type:'button',class:'ghost-btn small',disabled:busy,onClick:()=>keepPinnedOnly(true),text:'1·2군 고정 + 3~5군 비우기'}),
      e('button',{type:'button',class:'ghost-btn small',disabled:busy,onClick:()=>{candidatesExpanded=!candidatesExpanded;if(candidatesExpanded)loadCandidates();else invalidateCandidates(false);render();},text:candidatesExpanded?'다른 후보 닫기':'다른 후보 보기'}),
      e('button',{type:'button',class:'ghost-btn small',disabled:busy,onClick:()=>saveAll(),text:'5군 내 덱에 저장'}));
    const items=[];
    for(let position=1;position<=5;position++){
      const row=byPosition.get(position);
      if(!row){items.push(e('div',{class:'planner-empty-position',dataset:{emptyPosition:String(position)}},e('strong',{text:`${position}군 · 편성 없음`}),e('p',{class:'muted-note',text:'보유 장수 또는 원본 후보가 부족합니다. 빈 순위를 유지합니다.'})));continue;}
      const rank=e('div',{class:'planner-sort-tools'},
        e('button',{type:'button',class:'planner-drag-handle',title:'드래그하여 순서 변경', 'aria-label':`${row.title} 순서 이동`,text:'⠿'}),
        e('strong',{class:'planner-sort-rank',text:`${position}군`}),
        e('button',{type:'button',class:`planner-pin ${row.pinned?'is-pinned':''}`,'aria-pressed':String(!!row.pinned),title:'고정한 편성 전체를 보존',onClick:()=>pin(row.entry_id),text:row.pinned?'📌 고정됨':'📍 고정'}),
        e('div',{class:'planner-sort-shortcuts'},
          e('button',{type:'button',class:'planner-sort-shortcut',disabled:busy||position===1,title:'1군으로 이동, 전법만 재배분',onClick:()=>move(row.entry_id,1),text:'⇡'}),
          e('button',{type:'button',class:'planner-sort-shortcut',disabled:busy||position===1,title:'위로',onClick:()=>move(row.entry_id,position-1),text:'↑'}),
          e('button',{type:'button',class:'planner-sort-shortcut',disabled:busy||position===5,title:'아래로',onClick:()=>move(row.entry_id,position+1),text:'↓'})));
      const cards=[];
      for(const hero of [...(row.army?.heroes||[])].sort((a,b)=>a.slot-b.slot)){
        const slots=(row.tactic_slots||[]).filter(s=>s.hero_slot===hero.slot).sort((a,b)=>a.slot-b.slot);
        cards.push(e('div',{class:'planner-hero-tactics'},e('strong',{text:`${hero.slot}번 · ${heroName(hero.hero_id)} · Lv.${hero.level??50}`}),
          ...slots.map(s=>e('div',{class:'planner-skill-row'},
            e('span',{class:s.selected_id?'planner-equipped':'planner-unavailable',text:`전법${s.slot} · ${s.selected_id?catalog(s.selected_id):'빈칸 · 대체 필요'}`}),
            e('small',{text:s.selected_id?(s.state==='selected'?'':cellStatus[s.state]||''):(s.preferred_id?`추천: ${catalog(s.preferred_id)} · ${cellStatus[s.state]||'미확정'}`:cellStatus[s.state]||'미확정')}),
            e('button',{type:'button',class:'ghost-btn small',disabled:busy,onClick:()=>edit(row.entry_id,hero.slot,s.slot),text:'변경'})))));
      }
      const body=e('div',{class:'planner-entry-body'},
        e('div',{class:'planner-tags'},e('span',{class:'planner-tag tier',text:row.tier_label||'티어 미기재'}),
          e('span',{class:`planner-tag ${row.battle_ready&&row.code&&!resultStale?'owned':'missing'}`,text:row.battle_ready&&row.code&&!resultStale?'배틀 가능':resultStale?'다시 서버 검증 필요':'전법 확인 필요'}),
          e('span',{class:'planner-tag muted',text:row.pinned?'📌 편성 고정':'미고정'})),
        ...cards,
        ...(row.notes||[]).map(note=>e('p',{class:'muted-note',text:String(note)})),
        e('div',{class:'planner-plan-actions'},
          e('button',{type:'button',class:'ghost-btn small',disabled:busy,onClick:()=>saveOne(row),text:row.battle_ready&&row.code&&!resultStale?'내 덱에 저장':'미완성 계획 초안 저장'}),
          e('button',{type:'button',class:'solid-btn small',disabled:busy||resultStale||!row.battle_ready||!row.code,onClick:()=>sendOne(row),text:'배틀에 불러오기'}),
          e('button',{type:'button',class:'ghost-btn small',disabled:busy,onClick:()=>rebuildPinned(row.entry_id),text:'이 덱 고정 후 잔여 재추천'})));
      items.push(e('div',{class:'planner-sort-item',dataset:{entryId:row.entry_id}},rank,
        e('details',{class:'planner-entry',open:position===1},
          e('summary',null,e('header',{class:'planner-entry-header'},e('div',{class:'planner-entry-heading'},e('b',{text:row.title||`부대 ${position}`}),e('p',{class:'planner-heroes',text:(row.army?.heroes||[]).sort((a,b)=>a.slot-b.slot).map(x=>heroName(x.hero_id)).join(' · ')})),e('span',{class:'planner-expand',text:'상세 / 전법 편집 ▾'}))),body)));
    }
    // 서버가 동일 문구를 슬롯별로 반복 반환하는 전역 conflict 블록은 생략한다.
    // 세부 대체 필요 상태는 해당 전법 슬롯에서 계속 확인하고 수정할 수 있다.
    fill($('planner-results'),e('article',{class:'planner-plan war-card'},header,
      e('div',{class:'planner-priority-head'},e('p',{class:'planner-priority-help',text:'⠿ 드래그 또는 ↑ ↓ 이동: 현재 장수 조합을 유지하고 전법만 서버에서 재배분(reorder)합니다. 📌 고정 후 「나머지 재추천」: 고정한 편성 전체를 예약하고 나머지를 다시 탐색(rebuild)합니다.'})),actions,
      e('div',{class:'planner-plan-list'},...items),
      candidatesExpanded?renderCandidates():null,
      ...[...new Set((plan.notices||[]).map(String))].filter(x=>!/^다른 부대가 사용 중이거나/.test(x)).map(x=>e('p',{class:'muted-note',text:x})),
      ...(plan.changes||[]).slice(0,8).map(x=>e('p',{class:'planner-evidence',text:String(x)}))));
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
      e('p',{class:'muted-note',text:'📌 고정된 부대만 자원을 선점합니다. 3~5군을 비우면 다른 후보를 자유롭게 비교할 수 있습니다. 선택 가능하더라도 전법 부족은 삽입 후 직접 수정해야 합니다.'}));
    if(plan.entries.some(x=>x.position===candidateTarget&&x.pinned))
      candidateTarget=Array.from({length:5},(_,i)=>i+1).find(x=>!plan.entries.some(y=>y.position===x&&y.pinned))||1;
    const select=e('select',{'aria-label':'후보 삽입 순위'});
    for(let p=1;p<=5;p++){
      const pinned=plan.entries.some(x=>x.position===p&&x.pinned);
      select.append(e('option',{value:p,disabled:pinned,text:`${p}군 ${pinned?'· 고정 (선택 불가)':'위치에 넣기'}`}));
    }
    select.value=String(candidateTarget);
    select.addEventListener('change',()=>{candidateTarget=Number(select.value);render();});
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
    // 서버 티어 정렬은 유지하되, 선택 가능한 후보를 언제나 위로 정렬한다.
    const sorted=[...unfiltered].sort((a,b)=>Number(Boolean(b.is_selectable))-Number(Boolean(a.is_selectable)));
    const rows=candidateOnlySelectable?sorted.filter(x=>x.is_selectable):sorted;
    const canSelect=unfiltered.filter(x=>x.is_selectable).length;
    box.append(e('p',{class:'muted-note',text:`서버 후보 ${page.total??0}개 · 현재 ${unfiltered.length}개 조회 중 선택 가능 ${canSelect}개 · ${candidateOnlySelectable?'선택 가능만 표시':'선택 가능 순서로 먼저 표시'}` }));
    const list=e('div',{class:'planner-alternative-list'});
    for(const item of rows){
      const selectable=Boolean(item.is_selectable),heroes=(item.hero_ids||[]).map((id,i)=>`${heroName(id)}${item.hero_owned?.[i]===false?' (미보유)':''}`).join(' · ');
      const message=[!selectable?(item.unavailable_reason||'보유·고정·시즌 조건 확인 필요'):null,
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
      plan=data;session.plan=data;candidateDraft=false;invalidateCandidates(false);verifiedPoolSig=poolSig();verifiedProjectionSig=projectionSig();persist();showStatus(`서버 응답 완료 · ${labelStatus[data.search_status]||'결과 확인'} · ${data.entries?.length||0}개 부대`);if(candidatesExpanded)loadCandidates();
    }catch(err){if(currentEpoch!==viewEpoch)return;plan=before;showStatus(errorMessage(err),true);}
    finally{if(currentEpoch===viewEpoch){busy=false;render();if(candidatesExpanded&&activeView&&serverReady()&&!candidatesPage&&!candidateLoading)loadCandidates();}}
  }
  /** 서버에는 고정 부대만 제출한다. 개인 저장 덱과 보유 풀은 건드리지 않는다.
   * onlyFirstTwo=true이면 정확히 1·2군을 고정하고 3·4·5군을 계획에서만 비운다.
   */
  function keepPinnedOnly(onlyFirstTwo=false){
    if(!plan||busy)return;
    const current=plan.entries||[];
    let keep;
    if(onlyFirstTwo){
      const first=current.find(x=>x.position===1),second=current.find(x=>x.position===2);
      if(!first||!second){notify('1군과 2군 모두 편성된 상태에서 사용할 수 있습니다.',true);return;}
      if(current.some(x=>x.pinned&&x.position>2)&&!window.confirm('3~5군에도 고정된 부대가 있습니다. 1·2군만 고정하고 나머지 고정을 해제해 비울까요?'))return;
      keep=current.filter(x=>x.position===1||x.position===2).map(x=>({...clone(x),pinned:true}));
    }else{
      keep=current.filter(x=>x.pinned).map(clone);
      if(!keep.length){notify('먼저 보존할 부대를 📌 고정해 주세요. 1·2군만 남기려면 옆의 전용 버튼을 사용할 수 있습니다.',true);return;}
    }
    clearTimeout(validateTimer);session?.cancel();viewEpoch++;busy=false;
    plan={...clone(plan),entries:keep,empty_positions:Array.from({length:5},(_,i)=>i+1).filter(p=>!keep.some(e=>e.position===p)),
      lineup_ready:false,search_status:'not_searched',notices:[],changes:[],candidate_count:null};
    candidateDraft=true;session.plan=plan;candidatesExpanded=true;candidateQuery='';candidateOffset=0;candidateOnlySelectable=true;
    candidateTarget=plan.empty_positions[0]||1;
    invalidateCandidates(false);persist();render();
    showStatus(`📌 ${keep.length}개 부대 유지 · 나머지 ${plan.empty_positions.length}개 순위 비움 · 서버에서 선택 가능한 후보 조회 중`);
    loadCandidates();
  }
  function pin(id){if(busy||!plan)return;try{const row=plan.entries.find(x=>x.entry_id===id);plan=setPinned(plan,id,!row.pinned);if(session)session.plan=plan;persist();invalidateCandidates(true);render();showStatus('📌 표시만 변경했습니다. 「나머지 재추천」을 누르면 고정 부대를 보존합니다.');}catch(err){notify(err.message,true);}}
  function move(id,to){if(busy||!plan)return;try{const changed=moveEntry(plan,id,to);request('reorder',changed);}catch(err){notify(err.message,true);}}
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
    const destination=y=>{
      const rows=[...root.querySelectorAll('.planner-sort-item,.planner-empty-position')].filter(el=>el.dataset.entryId!==gesture?.entryId);
      const next=rows.find(el=>y<el.getBoundingClientRect().top+el.getBoundingClientRect().height/2);
      return next?Math.max(1,Number(next.dataset.emptyPosition||plan?.entries.find(e=>e.entry_id===next.dataset.entryId)?.position||1)):5;
    };
    function tick(){if(!gesture)return;
      const y=gesture.y,edge=110;
      if(y<edge)window.scrollBy(0,-Math.ceil((edge-y)/5));
      if(y>innerHeight-edge)window.scrollBy(0,Math.ceil((y-(innerHeight-edge))/5));
      const to=destination(y);
      root.querySelectorAll('.planner-sort-item').forEach(el=>{el.classList.remove('planner-drop-before','planner-drop-after');if(el.dataset.entryId!==gesture.entryId&&Number(plan?.entries.find(e=>e.entry_id===el.dataset.entryId)?.position)===to)el.classList.add('planner-drop-before');});
      raf=requestAnimationFrame(tick);
    }
    root.addEventListener('pointerdown',evt=>{const handle=evt.target.closest('.planner-drag-handle');if(!handle||busy||evt.button!==0)return;const row=handle.closest('.planner-sort-item');if(!row)return;
      evt.preventDefault();handle.setPointerCapture(evt.pointerId);gesture={id:evt.pointerId,entryId:row.dataset.entryId,y:evt.clientY};row.classList.add('planner-is-dragging');raf=requestAnimationFrame(tick);});
    root.addEventListener('pointermove',evt=>{if(gesture?.id===evt.pointerId){evt.preventDefault();gesture.y=evt.clientY;}});
    root.addEventListener('pointerup',evt=>{if(!gesture||gesture.id!==evt.pointerId)return;evt.preventDefault();const id=gesture.entryId,to=destination(evt.clientY),from=plan?.entries.find(e=>e.entry_id===id)?.position;cleanup();if(to&&to!==from)move(id,to);});
    root.addEventListener('pointercancel',cleanup);
  }
  async function show(){activeView=true;synchronize();await loadRules();synchronize();render();
    if(!serverReady()||!poolSnapshot().heroes?.length)return;
    // 사용자 의도로 비운 후보 탐색 계획은 화면 재진입 시 자동 채우지 않는다.
    if(candidateDraft){candidatesExpanded=true;candidateOnlySelectable=true;candidateTarget=plan.empty_positions?.[0]||candidateTarget;render();loadCandidates();return;}
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
