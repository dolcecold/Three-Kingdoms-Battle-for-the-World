import {displayGuideFor} from './deck-display-guides.js';
import {createDeckGuideCards} from './deck-guide-cards.js';
import {rosterKey,tierOf,fitCandidate,buildCandidates} from './planner-core.js';
import {familyName,mentionsOfDeck,matchupTargets,countersForTarget} from './matchup-explorer.js';
const SOURCES={presets:'기존 추천덱',s2:'한국 S2 참고 편성',s3:'한국 S3 세팅'};
const stringify=x=>String(x??'').replace(/\s+/g,'').toLocaleLowerCase('ko');
const present=x=>Array.isArray(x)?x.filter(Boolean).join(' · '):String(x??'');
const text=x=>String(x??'').trim();
export function createRecommendationsView({state,h,fill,ensurePresets,presetsData,openPreset,poolSnapshot,saveRecommendedDeck,saveReferenceDraft,notify}){
  const $=id=>document.getElementById(id);
  let source='presets',season=state.season,lastEditorSeason=state.season,role='all',query='',guided=false,selection=null;
  let s2=null,s3=null,matchups=null,loaded=false,detailOpened=false,savedScrollY=0,priorFocusId=null;
  let matchupTarget='',shortlistOnly=false;
  const detailHistory=[];
  const SAVED_KEY='cheonha-matchup-shortlist-v1';
  const savedCandidates=()=>{try{return JSON.parse(localStorage.getItem(SAVED_KEY)||'[]').filter(x=>x?.id&&x?.season);}catch{return [];}};
  function writeSaved(rows){try{localStorage.setItem(SAVED_KEY,JSON.stringify(rows));return true;}catch{notify('이 기기에서 후보 목록을 저장하지 못했습니다.',true);return false;}}
  const savedHas=id=>savedCandidates().some(x=>x.id===id&&x.season===season&&x.source===source);
  function toggleSaved(row){const rows=savedCandidates(),idx=rows.findIndex(x=>x.id===row.id&&x.season===season);if(idx>=0)rows.splice(idx,1);else rows.push({id:row.id,season,source,title:row.title});if(writeSaved(rows)){notify(idx>=0?'대응 후보에서 제외했습니다.':'내 덱 후보에 담았습니다.');render();}}
  const savedSet=()=>new Set(savedCandidates().filter(x=>x.season===season&&x.source===source).map(x=>x.id));
  const expanded=new Set();
  const familyExpanded=new Set();
  const familyClosed=new Set(),rosterClosed=new Set();
  let lastDeepLink=null;
  const sourceButtons=[...$('rec-source').querySelectorAll('button')],seasonButtons=[...$('rec-seasons').querySelectorAll('button')];
  const sourceAllowed=value=>value==='presets'||(value==='s2'&&season===2)||(value==='s3'&&season===3);
  const toRows=()=>{
    if(source==='presets')return (presetsData()?.templates??[]).filter(t=>(t.season??t.source_kr_season)===season).map(t=>({id:t.id,title:t.name,heroes:t.heroes?.map(x=>x.name)??[],raw:t,subtitle:t.mode==='opening'?'개척용':'일반 전투'}));
    if(source==='s2')return (season===2?s2?.entries??[]:[]).map(t=>({id:t.id,title:t.heading?.split('\n')[0]||t.generals?.join(' · '),heroes:t.generals??[],raw:t,subtitle:t.source_sheet||''}));
    return (season===3?s3?.variants??[]:[]).map(t=>({id:t.id,title:t.label||t.presentation_label,heroes:t.members?.map(x=>x.general)||[],raw:t,subtitle:[t.presentation_label,t.formation].filter(Boolean).join(' · ')}));
  };
  function guideFor(row){return displayGuideFor(row.raw,{season});}
  function terms(row,guide){
    const g=guide.members.flatMap(m=>[m.name,...m.role_labels,...m.role_notes,...m.action_notes,...m.equipment_notes,...m.horse_notes,...m.stat_guides.map(s=>s.text)]);
    const raw=row.raw;
    const extra=source==='presets'?raw.heroes?.flatMap(m=>m.learned_tactics?.map(x=>x.name)||[])||[]:
      source==='s3'?raw.members?.flatMap(m=>[...Object.values(m.fields||{}),...(m.learned_choices||[]).flatMap(c=>(c.options||[]).map(o=>o.text))])||[]:
      [raw.heading,raw.source_sheet];
    return stringify([row.title,...row.heroes,row.subtitle,...extra,...g].join(' '));
  }
  const matchupFor=row=>source==='s3'?(matchups?.items?.[row.id]||null):null;
  const allRows=()=>toRows().map(row=>({...row,guide:guideFor(row),matchup:matchupFor(row)})).filter(row=>{
    if(shortlistOnly&&!savedSet().has(row.id))return false;
    if(role!=='all'&&!row.guide.members.some(m=>m.roles.includes(role)))return false;
    if(guided&&!row.guide.has_guidance)return false;
    return !query||terms(row,row.guide).includes(stringify(query));
  });
  const keyFor=row=>{
    // 명칭 변형(연의/별칭)이어도 원문에 확정된 무장 ID가 같으면 같은 트리로 묶는다.
    const raw=row.raw;
    const ids=source==='presets'?(raw.heroes||[]).map(x=>x.id):
      source==='s2'?(raw.display_guide?.members||[]).map(x=>x.hero_id):
      (raw.members||[]).map(m=>m.hero_choice?.status==='resolved'&&m.hero_choice?.candidates?.length===1?m.hero_choice.candidates[0].id:null);
    return ids.length===3&&ids.every(x=>x!=null)?'id:'+ids.map(Number).sort((a,b)=>a-b).join('|'):
      'name:'+rosterKey(row.heroes);
  };
  const selectRow=rows=>{if(!rows.some(x=>x.id===selection))selection=rows[0]?.id||null;return rows.find(x=>x.id===selection)||null;};
  const line=(label,value,klass='')=>value!=null&&value!==''?h('p',{class:`rec-full-line ${klass}`},h('b',{text:`${label} · `}),text(value)):null;
  const pills=(heading,options)=>options?.length?h('div',{class:'rec-choice-line'},h('b',{text:heading}),h('div',{class:'rec-choice-pills'},...options.map(o=>h('span',{class:'rec-choice-pill',text:o})))):null;
  // Korean S3 reference notes are sparse. Display only source-supported, setup-specific matchups.
  function matchMini(m){
    if(!m)return null;
    const picks=[['good','유리','good'],['bad','불리','bad'],['even','비등','even']];
    const parts=picks.flatMap(([key,label,cls])=>(m[key]||[]).slice(0,1).map(v=>h('span',{
      class:`rec-match-pill ${cls}`,title:[`${label}: ${v.target}`,v.condition].filter(Boolean).join(' · '),
      text:`${label} ${v.target}`
    })));
    return parts.length?h('div',{class:'rec-match-mini', 'aria-label':'원문에 명시된 상성 요약'},...parts):null;
  }
  function matchDetail(row){
    const m=row.matchup;
    if(!m)return h('section',{class:'rec-match-detail rec-match-unknown'},
      h('h4',{text:'유·불리 상성'}),
      h('p',{text:'현재 자료에 이 세팅의 확인된 상성 정보가 없습니다. 유리·불리를 추정하지 않습니다.'}));
    const configs=[['good','유리한 상대','good'],['bad','불리한 상대','bad'],['even','비등한 상대','even']];
    const sections=configs.filter(([key])=>m[key]?.length).map(([key,title,cls])=>h('div',{class:'rec-match-line'},
      h('b',{class:`rec-match-type ${cls}`,text:title}),
      h('div',{class:'rec-match-targets'},...(m[key]||[]).map(v=>h('span',{class:'rec-match-target'},
        h('strong',{text:v.target}),v.condition?h('small',{text:v.condition}):null)))));
    if(m.caution?.length)sections.push(h('div',{class:'rec-match-caution'},h('b',{text:'주의 · '}),m.caution.join(' · ')));
    return h('section',{class:'rec-match-detail'},h('h4',{text:'유·불리 상성 · 원문 근거'}),
      h('p',{class:'rec-match-disclaimer',text:'한국 S3 참고 시트의 선택한 세팅에 명시된 관계입니다. 실제 승률·확정 상성이 아니며 다른 변형에 자동 적용하지 않습니다.'}),
      ...sections,
      h('details',{class:'rec-match-evidence'},h('summary',{text:'상성 근거 원문 펼치기'}),...(m.notes||[]).map(n=>h('p',{text:n}))));
  }
  const guideLabels=(id,type)=>state.idx?.[type]?.get(id)?.name||null;
  function presetExtra(t){
    const children=[h('div',{class:'rec-full-summary'},line('진형',guideLabels(t.army?.formation_id,'formation')|| (t.army?.formation_id!=null?`ID ${t.army.formation_id}`:'미기재')),
      line('운용',t.mode==='opening'?'개척':'일반 전투'))];
    for(const m of (t.army?.heroes||[]).slice().sort((a,b)=>a.slot-b.slot)){
      const label=t.heroes?.find(x=>x.id===m.hero_id)?.name||guideLabels(m.hero_id,'hero')||`#${m.hero_id}`;
      const props=[line('전법',(m.learned||[]).map(x=>guideLabels(x.skill_id,'tactic')||`#${x.skill_id}`).join(' / ')||'원문 미기재'),
        line('병법',(m.warbook_slots||[]).map(x=>guideLabels(x.warbook_id,'book')||`#${x.warbook_id}`).join(' / ')||'원문 미기재'),
        line('병종',m.advanced_arms_id?guideLabels(m.advanced_arms_id,'arm')||`#${m.advanced_arms_id}`:'상급 병종 미지정'),
        line('병종 정통',(m.arms_skill_ids||[]).map(id=>guideLabels(id,'prof')||`#${id}`).join(' / ')||'원문 미기재'),
        line('장비 / 말',[(m.equipment_item_id!=null?`장비 ID ${m.equipment_item_id}`:''),(m.horse_item_id!=null?`말 ID ${m.horse_item_id}`:'')].filter(Boolean).join(' · ')||'원문 미기재')];
      children.push(h('section',{class:'rec-full-member'},h('h4',{text:`${m.slot}번 · ${label}`}),...props.filter(Boolean)));
    }
    return h('section',{class:'rec-full-section'},h('h4',{text:'전체 편성 데이터'}),h('p',{class:'rec-source-description',text:'전법·병법·상급 병종·정통이 원본에 없는 칸은 ‘미기재’로 구분합니다. 기본 병종은 별도 편성 데이터에서 확정되지 않습니다.'}),...children);
  }
  function referenceExtra(t){
    const sections=[];
    for(const m of (t.members||[])){
      const sub=[h('h4',{text:m.general})];
      const f=m.fields||{};
      const choice=(label,rows)=>{
        for(const row of rows||[]){
          const opts=(row.options||[]).map(o=>o.text+(o.status==='resolved'?'':' (확인 필요)'));
          sub.push(pills(`${label} ${row.slot||''}`.trim(),opts)||line(label,row.text));
        }
      };
      choice('전법',m.learned_choices);
      if(!m.learned_choices?.length)sub.push(line('전법',[f.strategy_1,f.strategy_2].filter(Boolean).join(' / ')||'미기재'));
      choice('병법',m.warbook_choices);
      if(!m.warbook_choices?.length)sub.push(line('병법',[f.warbook_1,f.warbook_2,f.warbook_3].filter(Boolean).join(' / ')||'미기재'));
      for(const [label,k] of [['전법 대안 원문','strategy_alternatives'],['병종','troop'],['장비','gear'],['말','horse'],['스탯','attributes'],['배치 원문','position']])if(f[k])sub.push(line(label,f[k]));
      if(m.romance_required)sub.push(pills('연의 선택',(m.romance_choices||[]).map(c=>c.name))||line('연의','선택 필요'));
      if(m.hero_choice?.status!=='resolved')sub.push(line('무장 매핑','확인 필요'));
      sections.push(h('section',{class:'rec-full-member'},...sub.filter(Boolean)));
    }
    return h('section',{class:'rec-full-section'},h('h4',{text:'세팅별 전법 · 병법 · 병종 · 장비 · 말'}),
      h('p',{class:'rec-source-description',text:'슬래시(/)·선택지는 원문 대안입니다. 미확정 병법과 등급 선택은 그대로 표시하며 자동 확정하지 않습니다. 원문 표시 순서는 실제 슬롯/전후열 근거가 아닙니다.'}),...sections,
      t.notes?.length?h('details',{class:'rec-source-notes'},h('summary',{text:`원본 운용·상성 메모 (${t.notes.length})`}),...t.notes.map(n=>h('p',{text:n}))):null);
  }
  function candidateFit(variant){
    const pool=poolSnapshot();
    const built=buildCandidates({season:3,presets:[],s2:[],s3:[variant]})[0];
    return fitCandidate(built,{heroes:new Set(pool.heroes),tactics:new Set(pool.tactics),tacticCatalog:state.idx?.tactic||new Map()});
  }
  function matchupBrowser(row){
    if(season!==3||source!=='s3')return null;
    const targets=matchupTargets(matchups?.items);
    const mentions=mentionsOfDeck(row.raw,s3?.variants,matchups?.items);
    const direct=matchupFor(row);
    const buttons=(items,kind)=>items.map(({variant,condition,relation,target})=>{
      const fit=candidateFit(variant);
      const type=relation||'good';
      const message=kind==='mention'?type==='good'?'다른 세팅이 이 덱에 유리하다는 원문':type==='bad'?'다른 세팅이 이 덱에 불리하다는 원문':type==='even'?'비등 원문':'상대 메모에 언급 · 우열 미확정':'이 상대 유형에 유리하다는 원문';
      return h('article',{class:'rec-counter-card'},
        h('div',{class:'rec-counter-main'},h('b',{text:variant.label}),
          h('small',{text:message}),
          target?h('small',{class:'rec-counter-condition',text:`${target}${condition?' · '+condition:''}`}):null,
          h('span',{class:'rec-counter-own',text:`보유 장수 ${fit.ownedHeroes}/3 · 대체 전법 ${fit.matchedSkills}/${fit.candidate.skillSlots.length}`})),
        h('div',{class:'rec-counter-actions'},
          h('button',{type:'button',class:'ghost-btn small',dataset:{recJump:variant.id},text:'세팅 자세히'}),
          h('button',{type:'button',class:'ghost-btn small',dataset:{recSaveCandidate:variant.id},text:savedHas(variant.id)?'후보 해제':'내 덱 후보 담기'})));
    });
    const selectedTarget=targets.find(x=>x.key===matchupTarget);
    const matching=selectedTarget?countersForTarget(selectedTarget.target,s3?.variants,matchups?.items):[];
    const directHint=(direct?.good||[]).map(e=>e.target);
    return h('section',{class:'rec-counter-explorer',id:'rec-counter-explorer'},
      h('div',{class:'rec-counter-header'},h('h4',{text:'상성으로 대응덱 찾기'}),h('small',{text:'S3 세팅 원문 기준'})),
      h('p',{class:'rec-counter-note',text:'직접 유·불리, 다른 세팅의 관련 언급, 상대 유형별 카운터를 구분합니다. 유형에 유리하다고 기록돼도 그 유형의 모든 개별 덱에 대한 승률을 보장하지 않습니다.'}),
      !direct?.good?.length&&!direct?.bad?.length&&!direct?.even?.length?
        h('p',{class:'rec-counter-unknown',text:'선택한 세팅의 직접 유·불리 원문은 없습니다. 아래 관련 언급이나 유형별 카운터를 참고하세요.'}):null,
      mentions.length?h('div',{class:'rec-counter-section'},h('h5',{text:`다른 세팅에서 '${familyName(row.raw)}' 언급 (${mentions.length})`}),...buttons(mentions,'mention')):
        h('p',{class:'rec-counter-none',text:'다른 세팅에서 이 덱 이름을 직접 언급한 상성 기록도 없습니다.'}),
      h('div',{class:'rec-counter-section'},
        h('h5',{text:'상대 유형을 골라 유리한 세팅 찾기'}),
        h('label',{class:'rec-counter-select-label'},'상대 유형',h('select',{class:'rec-counter-target-select','aria-label':'상대 유형 선택',onChange:e=>{
          matchupTarget=e.currentTarget.value;
          const scroll=$('rec-detail').scrollTop;details(row);$('rec-detail').scrollTop=scroll;
        }},h('option',{value:'',text:'원문에 기재된 상대 유형 선택',selected:!selectedTarget}),
          ...targets.map(t=>h('option',{value:t.key,text:`${t.target} (${t.count}개 세팅)`,selected:matchupTarget===t.key})))),
        selectedTarget?h('div',{class:'rec-counter-results'},
          h('p',{class:'rec-counter-note',text:`'${selectedTarget.target}'에 유리하다고 명시된 세팅 ${matching.length}개`}),
          ...buttons(matching,'target')):
          h('p',{class:'rec-counter-none',text:directHint.length?`이 덱의 유리 상대: ${directHint.join(' · ')}. 아래에서 상대 유형을 선택하면 그 유형을 잡는 덱을 탐색할 수 있습니다.`:'상대 유형을 탭하면 원문에 해당 유형을 카운터한다고 적힌 세팅만 모아 보여줍니다.'})),
      h('div',{class:'rec-counter-footer'},
        h('button',{type:'button',class:'ghost-btn small',dataset:{recSaveCandidate:row.id},text:savedHas(row.id)?'내 덱 후보에서 제거':'이 세팅을 내 덱 후보에 담기'}),
        h('p',{class:'rec-counter-note',text:'후보 담기는 이 기기 브라우저에 참고 세팅을 보관합니다. 실제 배틀용 편성은 별도 검수가 필요합니다.'})));
  }
  function saveActions(row){
    if(source==='s2')return h('div',{class:'rec-draft-save'},
      h('p',{class:'rec-counter-note',text:'시즌2 티어 편성은 전법·전후열 미확정 자료라 배틀용 덱을 자동 생성하지 않습니다.'}),
      h('button',{type:'button',class:'ghost-btn small',onClick:()=>toggleSaved(row),text:savedHas(row.id)?'내 덱 후보에서 제거':'내 덱 후보에 담기'}));
    if(source==='presets')return h('div',{class:'rec-actions'},
      h('button',{type:'button',class:'ghost-btn',onClick:()=>toggleSaved(row),text:savedHas(row.id)?'후보에서 제거':'내 덱 후보 담기'}),
      h('button',{type:'button',class:'solid-btn',onClick:async()=>{try{await saveRecommendedDeck(row.raw);notify('원본 추천덱을 내 덱에 저장했습니다.');}catch(e){notify(e.message||String(e),true);}},text:'내 덱에 저장'}));
    const eligible=row.raw.hero_roster_resolved&&row.raw.members.length===3;
    return h('div',{class:'rec-draft-save'},
      h('h4',{text:'내 덱에 편성 초안 저장'}),
      h('p',{class:'rec-counter-note',text:'시즌3 참고 세팅은 전후열이 검증되지 않았습니다. 장수는 원문 표시 순서로 임시 배치하고, 보유한 단일 전법만 확정해 저장합니다. 병법·전법 대안·스탯·장비·말은 내 덱에서 직접 확인해야 합니다.'}),
      h('label',{class:'rec-draft-check'},h('input',{type:'checkbox',class:'rec-draft-consent',disabled:!eligible}), '임시 배치·미완성 초안임을 확인했습니다.'),
      h('button',{type:'button',class:'solid-btn',disabled:!eligible,onClick:async e=>{
        const box=e.currentTarget.closest('.rec-draft-save');
        if(!box.querySelector('.rec-draft-consent')?.checked){notify('초안 저장 안내를 확인해 주세요.',true);return;}
        e.currentTarget.disabled=true;
        try{const result=await saveReferenceDraft(row.raw);notify(result);}catch(error){notify(error.message||String(error),true);}finally{e.currentTarget.disabled=false;}
      },text:eligible?'내 덱에 검수용 초안 저장':'무장 ID 미확정 · 저장 불가'}));
  }
  function details(row){
    const host=$('rec-detail');if(!row){fill(host,h('p',{class:'rec-guide-empty',text:'조건에 해당하는 덱이 없습니다. 필터를 조정해 주세요.'}));return;}
    const t=row.raw,common=[h('div',{class:'rec-detail-head'},
      h('div',{class:'rec-detail-title'},h('small',{text:`한국 S${season} · ${SOURCES[source]}`}),h('h3',{id:'rec-detail-title',text:row.title})),
      h('button',{class:'rec-detail-close',type:'button','aria-label':'추천덱 상세 닫기',text:'닫기 ×'}))];
    if(detailHistory.length)common.push(h('button',{type:'button',class:'rec-counter-back',dataset:{recBack:'1'},text:`← ${detailHistory.at(-1).title}로 돌아가기`}));
    if(source==='presets'){
      common.push(h('p',{class:'muted-note',text:`한국 S${t.season} 전용 · ${row.subtitle} · 배틀 편집 시즌 S${state.season}`}),
        h('div',{class:'rec-roster'},...(t.heroes||[]).map(x=>h('div',{class:'rec-roster-member'},h('b',{text:x.name}),h('small',{text:present(x.learned_tactics?.map(y=>y.name))||'전법 미기재'})))),
        presetExtra(t),h('div',{class:'rec-actions'},h('button',{type:'button',class:'solid-btn',onClick:()=>openPreset(t.id),text:'내 보유 풀에서 편성하기'})));
    }else if(source==='s2'){
      common.push(h('p',{class:'muted-note',text:`${t.source_sheet||'시즌2 시트'} · ${tierOf(t.heading,2).label} · 참고자료`}),
        h('p',{class:'rec-source-description',text:'참고 편성에는 장수와 티어만 명시된 경우가 많습니다. 전법·병법·병종·실제 전후열이 수록되지 않았다면 임의 보충하지 않습니다.'}),
        h('div',{class:'rec-roster'},...(t.generals||[]).map(x=>h('span',{class:'rec-roster-member',text:x}))),
        t.alternative_generals?.length?line('대체 무장',t.alternative_generals.map(x=>`${x.general} → ${(x.alternatives||[]).join('/')}`).join(' · ')):null);
    }else{
      common.push(h('p',{class:'muted-note',text:`한국 S3 참고 · ${t.formation||'진형 미기재'} · ${t.occurrence_count||1}회 근거`}),
        h('div',{class:'rec-roster'},...(t.members||[]).map(m=>h('span',{class:'rec-roster-member',text:m.general}))),
        referenceExtra(t));
    }
    common.splice(2,0,matchDetail(row),matchupBrowser(row));
    common.push(saveActions(row));
    common.push(createDeckGuideCards(h,row.guide,{heading:'무장별 역할 · 스탯 우선순위',emptyText:'이 시즌에 명시된 역할·스탯 지침이 없습니다.'}));
    const url=source==='s2'?t.source_url:source==='s3'?t.evidence?.[0]?.url:null;
    if(url&&/^https:\/\/docs\.google\.com\//.test(url))common.push(h('p',{class:'rec-source-link'},h('a',{href:url,target:'_blank',rel:'noopener noreferrer',text:'원본 시트 보기 ↗'})));
    fill(host,...common.filter(Boolean));
  }
  function closeDetail(restoreFocus=true){
    if(!detailOpened)return;
    detailOpened=false;detailHistory.length=0;
    const box=$('rec-detail'),back=$('rec-backdrop');
    box.hidden=true;box.classList.remove('is-open');back.hidden=true;
    document.body.classList.remove('rec-modal-active');document.body.style.top='';
    window.scrollTo(0,savedScrollY);
    if(restoreFocus){
      const selector=priorFocusId?`[data-rec-id="${CSS.escape(priorFocusId)}"]`:null;
      const trigger=selector?$('rec-list').querySelector(selector):null;
      (trigger||$('rec-search')).focus({preventScroll:true});
    }
    priorFocusId=null;
  }
  function openDetail(){
    const box=$('rec-detail'),back=$('rec-backdrop');
    if(!detailOpened){
      savedScrollY=window.scrollY;
      document.body.style.top=`-${savedScrollY}px`;
      document.body.classList.add('rec-modal-active');
      detailOpened=true;
    }
    box.hidden=false;back.hidden=false;box.classList.add('is-open');box.scrollTop=0;
    box.setAttribute('aria-labelledby','rec-detail-title');
    box.querySelector('.rec-detail-close')?.focus({preventScroll:true});
  }
  const grouping=rows=>{
    const folders=new Map();
    for(const row of rows){
      const family=source==='s3'?familyName(row.raw):String(row.title).split(' · ')[0];
      const fk='family:'+source+':'+family;
      if(!folders.has(fk))folders.set(fk,{key:fk,title:family,rosters:new Map(),count:0});
      const folder=folders.get(fk),roster=keyFor(row)||row.id;
      if(!folder.rosters.has(roster))folder.rosters.set(roster,{key:roster,heroes:row.heroes,rows:[]});
      folder.rosters.get(roster).rows.push(row);folder.count++;
    }
    return [...folders.values()].sort((a,b)=>a.title.localeCompare(b.title,'ko'));
  };
  const selectedRowKey=selected=>selected?keyFor(selected):null;
  function treeContent(groups,active){
    const tree=h('div',{class:'war-file-tree',role:'tree','aria-label':'덱 계열, 장수 조합, 세팅 선택 트리'},
      h('div',{class:'war-file-root'},h('span',{class:'war-tree-chevron',text:'▾'}),h('span',{class:'war-folder-icon','aria-hidden':'true',text:'▣'}),
        h('strong',{text:`한국 시즌 ${season} / ${SOURCES[source]}`}),h('small',{text:`${groups.length}계열 · ${groups.reduce((n,g)=>n+g.count,0)}세팅`})));
    for(const [i,folder] of groups.entries()){
      const fOpen=Boolean(query)||(!familyClosed.has(folder.key)&&(familyExpanded.has(folder.key)||(!familyExpanded.size&&i===0)||folder.rosters.has(active)));
      const branch=h('div',{class:'war-tree-branch',role:'group',hidden:!fOpen});
      const families=[...folder.rosters.values()];
      for(const [j,roster] of families.entries()){
        const rOpen=Boolean(query)||(!rosterClosed.has(roster.key)&&(expanded.has(roster.key)||roster.key===active||(!expanded.size&&fOpen&&j===0)));
        const children=h('div',{class:'war-tree-leaves',role:'group',hidden:!rOpen});
        for(const [n,row] of roster.rows.entries()){
          const leafLabel=source==='s3'?(row.title.startsWith(folder.title)?row.title.slice(folder.title.length).replace(/^[\s·-]+/,''):`${row.title}`)||`세팅 ${n+1}`:row.title;
          const leaf=h('button',{type:'button',class:'war-tree-leaf',role:'treeitem','aria-current':String(row.id===selection),dataset:{recId:row.id}},
            h('span',{class:'war-leaf-glyph','aria-hidden':'true',text:'▤'}),
            h('span',{class:'war-tree-leaf-label'},h('strong',{text:leafLabel}),source==='s3'&&row.raw.presentation_label?h('small',{text:row.raw.presentation_label}):null),
            h('span',{class:'war-tree-leaf-tags'},source==='s2'?h('small',{text:tierOf(row.raw.heading,2).label}):null,row.matchup?h('small',{text:'相剋'}):null),
            matchMini(row.matchup));
          children.append(leaf);
        }
        const toggle=h('button',{type:'button',class:'war-tree-toggle roster',role:'treeitem','aria-expanded':String(rOpen),dataset:{warRoster:roster.key}},
          h('span',{class:'war-tree-chevron',text:rOpen?'▾':'▸'}),h('span',{class:'war-folder-icon','aria-hidden':'true',text:'▣'}),
          h('span',{class:'war-tree-node-label',text:roster.heroes.join(' · ')}),h('small',{text:`${roster.rows.length}안`}));
        branch.append(h('div',{class:'war-tree-roster',dataset:{warRosterWrap:roster.key}},toggle,children));
      }
      const folderToggle=h('button',{type:'button',class:'war-tree-toggle family',role:'treeitem','aria-expanded':String(fOpen),dataset:{warFamily:folder.key}},
        h('span',{class:'war-tree-chevron',text:fOpen?'▾':'▸'}),h('span',{class:'war-folder-icon','aria-hidden':'true',text:'▣'}),
        h('span',{class:'war-tree-node-label',text:folder.title}),h('small',{text:`${families.length}조합 · ${folder.count}세팅`}));
      tree.append(h('div',{class:'war-tree-family',dataset:{warFamilyWrap:folder.key}},folderToggle,branch));
    }
    return tree;
  }
  function render(){
    if(!sourceAllowed(source)){source='presets';selection=null;}
    seasonButtons.forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.recSeason)===season)));
    sourceButtons.forEach(b=>{b.hidden=!sourceAllowed(b.dataset.recSource);b.setAttribute('aria-selected',String(b.dataset.recSource===source));});
    $('rec-presets-count').textContent=String((presetsData()?.templates??[]).filter(t=>(t.season??t.source_kr_season)===season).length);
    $('rec-source-note').textContent=source==='presets'?`한국 S${season} 원본 추천덱만 조회합니다. 다른 시즌을 섞지 않습니다.`:
      source==='s2'?'시즌2 티어별 참고 편성. 전법·병법 등 없는 정보는 임의 확정하지 않습니다.':
      '시즌3은 같은 장수 3명도 서로 다른 세팅으로 관리합니다. 전법 대안·병법·병종·장비·말 원문을 각 세팅에 표시합니다.';
    const rows=allRows(),selected=selectRow(rows),groups=grouping(rows);
    $('rec-count').textContent=`한국 S${season} · ${SOURCES[source]} · ${groups.length}개 덱 계열 / ${rows.length}개 세팅`;
    $('rec-shortlist').textContent=`현재 자료 후보 ${savedCandidates().filter(x=>x.season===season&&x.source===source).length}개`;
    $('rec-shortlist').setAttribute('aria-pressed',String(shortlistOnly));
    const activeKey=selected?keyFor(selected):null;
    fill($('rec-list'),groups.length?treeContent(groups,selectedRowKey(selected)):h('p',{class:'rec-guide-empty',text:'조건에 맞는 자료가 없습니다.'}));
    details(selected);

  }
  async function show(){
    if(!loaded){
      $('rec-count').textContent='추천 덱 자료를 불러오는 중입니다.';
      await ensurePresets();
      const load=async file=>{const response=await fetch(file,{cache:'no-cache'});if(!response.ok)throw new Error(`${file} 참조 파일을 불러오지 못했습니다.`);return response.json();};
      [s2,s3,matchups]=await Promise.all([
        load('./references/data/kr_s2_deck_references.json'),
        load('./references/data/kr_s3_deck_references.json'),
        load('./data/recommendation-matchups.json')
      ]);loaded=true;
    }
    if(state.season!==lastEditorSeason){lastEditorSeason=state.season;season=state.season;source='presets';selection=null;expanded.clear();familyExpanded.clear();familyClosed.clear();rosterClosed.clear();closeDetail(false);}
    const qs=location.hash.split('?')[1]||'';
    const params=new URLSearchParams(qs);const requested=params.get('id'),askedSource=params.get('source');
    const deepKey=requested?`${askedSource}:${requested}`:null;
    if(requested&&(deepKey!==lastDeepLink||!detailOpened)&&s3?.variants.some(v=>v.id===requested)){ 
      lastDeepLink=deepKey;source='s3';season=3;selection=requested;
      query='';$('rec-search').value='';role='all';$('rec-role').value='all';guided=false;$('rec-guided').checked=false;
      const v=s3.variants.find(x=>x.id===requested);
      const row={id:v.id,raw:v,heroes:v.members.map(m=>m.general)};
      expanded.add(keyFor(row));familyExpanded.add('family:s3:'+familyName(v));
      render();openDetail();return;
    }
    render();
  }
  $('rec-seasons').addEventListener('click',e=>{const b=e.target.closest('[data-rec-season]');if(!b)return;season=Number(b.dataset.recSeason);source='presets';selection=null;expanded.clear();familyExpanded.clear();familyClosed.clear();rosterClosed.clear();matchupTarget='';shortlistOnly=false;closeDetail(false);render();});
  $('rec-source').addEventListener('click',e=>{const b=e.target.closest('[data-rec-source]');if(!b||!sourceAllowed(b.dataset.recSource))return;source=b.dataset.recSource;selection=null;expanded.clear();familyExpanded.clear();familyClosed.clear();rosterClosed.clear();matchupTarget='';closeDetail(false);render();});
  $('rec-search').addEventListener('input',e=>{query=e.target.value;selection=null;expanded.clear();familyExpanded.clear();familyClosed.clear();rosterClosed.clear();closeDetail(false);render();});
  $('rec-role').addEventListener('change',e=>{role=e.target.value;selection=null;expanded.clear();familyExpanded.clear();familyClosed.clear();rosterClosed.clear();closeDetail(false);render();});
  $('rec-guided').addEventListener('change',e=>{guided=e.target.checked;selection=null;expanded.clear();familyExpanded.clear();familyClosed.clear();rosterClosed.clear();closeDetail(false);render();});
  $('rec-shortlist').addEventListener('click',()=>{shortlistOnly=!shortlistOnly;selection=null;expanded.clear();familyExpanded.clear();familyClosed.clear();rosterClosed.clear();closeDetail(false);render();});
  $('rec-detail').addEventListener('click',e=>{
    const jump=e.target.closest('[data-rec-jump]');
    if(jump){const dest=s3?.variants?.find(v=>v.id===jump.dataset.recJump);if(!dest)return;
      const current=s3?.variants?.find(v=>v.id===selection);if(current)detailHistory.push({id:current.id,title:current.label});
      source='s3';season=3;query='';$('rec-search').value='';role='all';$('rec-role').value='all';guided=false;$('rec-guided').checked=false;shortlistOnly=false;selection=dest.id;matchupTarget='';expanded.add(keyFor({raw:dest,heroes:dest.members.map(m=>m.general)}));render();$('rec-detail').scrollTop=0;return;}
    const back=e.target.closest('[data-rec-back]');
    if(back&&detailHistory.length){const previous=detailHistory.pop(),dest=s3?.variants?.find(v=>v.id===previous.id);if(!dest)return;selection=dest.id;matchupTarget='';render();$('rec-detail').scrollTop=0;return;}
    const save=e.target.closest('[data-rec-save-candidate]');
    if(save){const id=save.dataset.recSaveCandidate;
      const variant=s3?.variants?.find(v=>v.id===id);
      const preset=(presetsData()?.templates||[]).find(v=>v.id===id);
      const found=variant||preset; if(!found)return;
      toggleSaved({id,title:found.label||found.name||id});return;}
    const target=e.target.closest('[data-rec-target]');
    if(target){matchupTarget=target.dataset.recTarget==='__all__'?'':target.dataset.recTarget;
      const saved=$('rec-detail').scrollTop;const id=selection;const rows=allRows();const row=rows.find(x=>x.id===id);if(row){details(row);$('rec-detail').scrollTop=saved;}return;}
  });
  $('rec-list').addEventListener('click',e=>{
    const folder=e.target.closest('[data-war-family]');
    if(folder){const key=folder.dataset.warFamily,el=folder.nextElementSibling,opened=folder.getAttribute('aria-expanded')==='true';
      el.hidden=opened;folder.setAttribute('aria-expanded',String(!opened));folder.querySelector('.war-tree-chevron').textContent=opened?'▸':'▾';
      if(opened){familyExpanded.delete(key);familyClosed.add(key);}else{familyExpanded.add(key);familyClosed.delete(key);}return;}
    const roster=e.target.closest('[data-war-roster]');
    if(roster){const key=roster.dataset.warRoster,el=roster.nextElementSibling,opened=roster.getAttribute('aria-expanded')==='true';
      el.hidden=opened;roster.setAttribute('aria-expanded',String(!opened));roster.querySelector('.war-tree-chevron').textContent=opened?'▸':'▾';
      if(opened){expanded.delete(key);rosterClosed.add(key);}else{expanded.add(key);rosterClosed.delete(key);}return;}
    const b=e.target.closest('[data-rec-id]');if(!b)return;
    priorFocusId=b.dataset.recId;selection=b.dataset.recId;matchupTarget='';detailHistory.length=0;
    const parent=b.closest('[data-war-roster-wrap]');if(parent)expanded.add(parent.dataset.warRosterWrap);
    const f=b.closest('[data-war-family-wrap]');if(f)familyExpanded.add(f.dataset.warFamilyWrap);
    render();openDetail();});
  $('rec-detail').addEventListener('click',e=>{if(e.target.closest('.rec-detail-close'))closeDetail();});
  $('rec-backdrop').addEventListener('click',()=>closeDetail());
  window.addEventListener('keydown',e=>{
    if(!detailOpened)return;
    if(e.key==='Escape'){e.preventDefault();closeDetail();return;}
    if(e.key!=='Tab')return;
    const list=[...$('rec-detail').querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')]
      .filter(x=>x.getClientRects().length>0);
    if(!list.length)return;
    if(e.shiftKey&&document.activeElement===list[0]){e.preventDefault();list.at(-1).focus();}
    else if(!e.shiftKey&&document.activeElement===list.at(-1)){e.preventDefault();list[0].focus();}
  });
  window.addEventListener('hashchange',()=>closeDetail(false));
  return {show};
}
