/** 보유 풀 기반 다부대 추천. 현 시즌의 확인 가능한 티어만 가중하고 기존 저장 데이터는 변경하지 않음. */
import {buildCandidates,recommendLineups,reallocateLineupByPriority,compareLineupAllocations,PROJECTIONS,isProjection} from './planner-core.js?v=1.5.0';
const $=id=>document.getElementById(id);
export function createPlannerView({state,h,fill,ensurePresets,presetsData,poolSnapshot,readLineup,addTemplatesToLineup,savePlanDrafts,notify}){
  let datasets=null,projectionMode='auto';
  const ORDER_KEY='cheonha-planner-priorities-v150';
  const readOrders=()=>{try{const value=JSON.parse(localStorage.getItem(ORDER_KEY)||'{}');return value&&typeof value==='object'?value:{};}catch{return {};}};
  const storedOrders=readOrders(),activePlans=new Map(),changeNotices=new Map();
  let currentContext=null,dragged=null,pointerDrag=null;
  const manuallySelected=new Set();
  const html=(tag,attrs,...children)=>h(tag,attrs,...children);
  const signature=(plan,season)=>`${season}::${plan.entries.map(f=>String(f.candidate.id)).sort().join('||')}`;
  function saveOrders(){try{const keys=Object.keys(storedOrders);for(const k of keys.slice(0,Math.max(0,keys.length-32)))delete storedOrders[k];localStorage.setItem(ORDER_KEY,JSON.stringify(storedOrders));}catch{ /* 사생활 보호 모드에서는 이 화면에서만 유지 */ }}
  function priorityPlan(plan,key){
    const ids=storedOrders[key];
    if(!Array.isArray(ids)||ids.length!==plan.entries.length)return plan;
    const reference=new Map(plan.entries.map(f=>[String(f.candidate.id),f]));
    if(ids.some(id=>!reference.has(String(id)))||new Set(ids.map(String)).size!==ids.length)return plan;
    return reallocateLineupByPriority(ids.map(id=>reference.get(String(id))),currentContext);
  }
  async function load(){
    if(datasets)return;
    await ensurePresets();
    const get=async uri=>{const res=await fetch(uri,{cache:'no-cache'});if(!res.ok)throw new Error('추천 참고 데이터 로딩 실패: '+uri);return res.json();};
    const [s2,s3,index]=await Promise.all([get('./references/data/kr_s2_deck_references.json'),get('./references/data/kr_s3_deck_references.json'),get('./data/unified-s3-recommendations.json')]);
    datasets={s2:s2.entries,s3:s3.variants,index};
  }
  const stat=(label,value)=>html('span',{class:'planner-stat'},html('b',{text:String(value)}),html('small',{text:label}));
  const meter=(label,have,total)=>html('span',{class:'planner-meter'},html('b',{text:`${have}/${total}`}),html('small',{text:label}));
  const tags=fit=>html('div',{class:'planner-tags'},
    html('span',{class:'planner-tag tier',text:fit.candidate.tier.label}),
    html('span',{class:`planner-tag ${fit.complete?'owned':'missing'}`,text:`장수 ${fit.ownedHeroes}/3`} ),
    fit.skillDefined?html('span',{class:`planner-tag ${fit.skillsComplete?'owned':'missing'}`,text:`전법 ${fit.matchedSkills}/${fit.candidate.skillSlots.length}`}):
      html('span',{class:'planner-tag missing',text:'전법 원문 없음'}),
    html('span',{class:'planner-tag muted',text:fit.candidate.kind==='preset'?'원본 추천덱':'참고 세팅'}));
  function entry(fit,index){
    const c=fit.candidate;
    const header=html('header',{class:'planner-entry-header'},
      html('div',{class:'planner-entry-heading'},html('b',{text:`${index+1}군 · ${c.title}`}),html('p',{class:'planner-heroes',text:c.heroNames.join(' · ')})),
      html('div',{class:'planner-entry-stats'},meter('장수',fit.ownedHeroes,3),fit.skillDefined?meter('전법',fit.matchedSkills,c.skillSlots.length):null));
    const info=html('div',{class:'planner-entry-body'},tags(fit));
    if(fit.selected.length){
      const byHero=new Map();
      for(const line of fit.selected){if(!byHero.has(line.hero))byHero.set(line.hero,[]);byHero.get(line.hero).push(line);}
      for(const [hero,lines] of byHero){
        info.append(html('div',{class:'planner-hero-tactics'},html('strong',{text:hero}),...lines.map(l=>html('p',null,
          `전법${l.slot} · `,
          html('span',{class:l.chosen?'planner-equipped':'planner-unavailable',text:l.chosen?.name||'비워 둠'}),
          l.chosen?.projection?html('small',{class:'planner-projection-label',text:' · 투영 사용'}):null,
          l.alternatives.length?html('small',{text:` (원문 후보: ${l.alternatives.map(a=>a.name).join(' / ')})`}):null,
          l.unresolved?html('small',{text:' · 미확정 선택지 제외'}):null))));
      }
    }else info.append(html('p',{class:'rec-guide-missing',text:'원본에 전법이 기재되지 않아 전법 적합도는 확인할 수 없습니다.'}));
    if(c.tier.source)info.append(html('p',{class:'planner-evidence',text:`티어 근거: ${c.tier.source.split('\n')[0]}`}));
    if(c.kind!=='preset')info.append(html('p',{class:'planner-evidence',text:'참고 세팅은 실제 배치·병법·장비를 검수해야 합니다. 저장 시 채울 수 있는 칸만 채운 초안으로 들어갑니다.'}));
    return html('details',{class:'planner-entry',open:index===0},html('summary',null,header,html('span',{class:'planner-expand',text:'세부 보기 ▾'})),info);
  }
  function planCard(basePlan,i){
    const key=signature(basePlan,state.season);
    const plan=priorityPlan(basePlan,key);
    activePlans.set(key,{basePlan,plan});
    const notice=changeNotices.get(key);
    const templateIds=plan.entries.filter(p=>p.candidate.templateId).map(p=>p.candidate.templateId);
    const totalHeroes=plan.entries.reduce((n,e)=>n+e.ownedHeroes,0);
    const usedProjection=[...plan.usedTactics].filter(isProjection);
    const projectionNames=PROJECTIONS.filter(p=>usedProjection.includes(p.shadow)).map(p=>p.name);
    const totalSkills=plan.entries.reduce((n,e)=>n+e.matchedSkills,0);
    const totalSkillSlots=plan.entries.reduce((n,e)=>n+e.candidate.skillSlots.length,0);
    return html('article',{class:'planner-plan war-card',dataset:{planKey:key}},
      html('header',{class:'planner-plan-head'},
        html('div',null,html('h3',{text:i===0?'1순위 최적 5군':`대안 조합 ${i+1}`}),html('p',{class:'planner-plan-explain',text:'장수/전법 적합도, 원문 티어, 대체 전법 반영 여부를 함께 비교한 결과입니다.'})),
        html('div',{class:'planner-plan-head-stats'},stat('구성 부대',plan.entries.length),stat('보유 무장 충족',`${totalHeroes}/15`),stat('보유 전법 충족',totalSkillSlots?`${totalSkills}/${totalSkillSlots}`:'미기재'))),
      html('div',{class:'planner-priority-head'},
        html('p',{class:'planner-priority-help',text:'⠿ 손잡이를 드래그하거나 ↑ ↓ 버튼으로 순서를 바꾸면, 위의 덱부터 일반·대체·투영 전법을 다시 배분합니다. 조합 5개는 유지됩니다.'}),
        storedOrders[key]?html('button',{type:'button',class:'ghost-btn small',dataset:{priorityAction:'reset',planKey:key},text:'추천 순서로 되돌리기'}):null),
      notice?html('p',{class:'planner-priority-notice',role:'status',text:notice}):null,
      html('div',{class:'planner-projection-used'},html('strong',{text:`사용한 투영 ${usedProjection.length}/3`}),...projectionNames.map(name=>html('span',{text:`영·${name}`}))),
      html('div',{class:'planner-plan-actions'},
        html('button',{type:'button',class:'solid-btn',onClick:async()=>{
          try{const saved=await savePlanDrafts(plan.entries);notify(`${saved}개 덱 초안을 내 덱에 저장했습니다.`);}catch(err){notify(err.message||String(err),true);}
        },text:'이 조합을 내 덱 초안으로 저장'}),
        templateIds.length?html('button',{type:'button',class:'ghost-btn',onClick:()=>{const added=addTemplatesToLineup(templateIds);notify(`${added}개 원본 추천덱을 내 구성에 추가했습니다.`);render();},text:`원본 추천덱 ${templateIds.length}개 내 구성에 추가`}):null),
      html('div',{class:'planner-plan-list',dataset:{planKey:key}},...plan.entries.map((fit,index)=>html('div',{class:'planner-sort-item',dataset:{planKey:key,entryId:String(fit.candidate.id)}},
        html('div',{class:'planner-sort-tools'},
          html('button',{type:'button',class:'planner-drag-handle',title:`${index+1}군 순서 드래그`, 'aria-label':`${fit.candidate.title} 순서 이동: 드래그`,text:'⠿'}),
          html('span',{class:'planner-sort-rank',text:`${index+1}군 우선순위`}),
          html('div',{class:'planner-sort-shortcuts'},
            index>0?html('button',{type:'button',class:'planner-sort-shortcut',dataset:{priorityAction:'first',planKey:key,entryId:String(fit.candidate.id)},title:'1군으로 올리기', 'aria-label':`${fit.candidate.title} 1군으로 올리기`,text:'⇡'}):null,
            html('button',{type:'button',class:'planner-sort-shortcut',disabled:index===0,dataset:{priorityAction:'up',planKey:key,entryId:String(fit.candidate.id)},'aria-label':`${fit.candidate.title} 한 단계 올리기`,text:'↑'}),
            html('button',{type:'button',class:'planner-sort-shortcut',disabled:index===plan.entries.length-1,dataset:{priorityAction:'down',planKey:key,entryId:String(fit.candidate.id)},'aria-label':`${fit.candidate.title} 한 단계 내리기`,text:'↓'}))),
        entry(fit,index))))
    );
  }
  function render(){
    if(!datasets)return;
    const season=state.season;
    $('planner-season').textContent=`한국 시즌 ${season}`;
    const pool=poolSnapshot();const lineup=readLineup();
    const owned=new Set(pool.tactics);const valid=PROJECTIONS.filter(p=>owned.has(p.base)||owned.has(p.shadow));
    for(const id of [...manuallySelected])if(!valid.some(p=>p.shadow===id))manuallySelected.delete(id);
    const projectionSettings=season===3?(projectionMode==='auto'?'auto':[...manuallySelected]):[];
    $('planner-projection-panel').hidden=season!==3;
    $('planner-projection-label').textContent=projectionMode==='auto'?'자동 배분 · 최대 3종':`직접 선택 · ${manuallySelected.size}/3종`;
    $('planner-projection-hint').textContent=`사용 가능한 투영 원본 ${valid.length}/6종 · 선택 가능한 종류별 투영 1개씩, 전체 최대 3개`;
    fill($('planner-projection-options'),...PROJECTIONS.map(p=>html('label',{class:valid.some(x=>x.shadow===p.shadow)?'':'is-disabled'},
      html('input',{type:'checkbox',value:p.shadow,disabled:projectionMode!=='manual'||!valid.some(x=>x.shadow===p.shadow),checked:manuallySelected.has(p.shadow)}),
      html('span',{text:`영·${p.name}`}))));
    const reserve=$('planner-reserve').checked;
    const reservedHeroes=reserve?lineup.flatMap(e=>e.heroes||[]):[];
    const reservedTactics=reserve?lineup.flatMap(e=>e.tactics||[]):[];
    const candidates=buildCandidates({season,presets:presetsData()?.templates||[],s2:datasets.s2,s3:datasets.s3});
    if(season===3){const expected=new Set(datasets.index.items.map(e=>e.id));
      if(candidates.length!==expected.size||candidates.some(c=>!expected.has(c.id)))throw new Error('시즌3 통합 추천덱 목록이 원본과 일치하지 않습니다.');}
    currentContext={heroes:pool.heroes,tactics:pool.tactics,reservedHeroes,reservedTactics,tacticCatalog:state.idx?.tactic||new Map(),projectionSelection:projectionSettings};
    activePlans.clear();
    const result=recommendLineups(candidates,{
      heroes:pool.heroes,tactics:pool.tactics,reservedHeroes,reservedTactics,
      count:Number($('planner-count').value),allowPartial:$('planner-partial').checked,tacticCatalog:state.idx?.tactic||new Map(),projectionSelection:projectionSettings});
    fill($('planner-overview'),stat('후보 덱',candidates.length),stat('보유 장수',pool.heroes.length),stat('보유 전법',pool.tactics.length),stat('조건 충족 후보',result.eligible));
    $('planner-explain').textContent=season===2?
      '시즌2는 T0 > T1+ > T1 원문 티어를 우선 반영합니다. 같은 장수 조합이라도 원본 추천덱과 티어표 참고 세팅을 함께 훑고, 투영/반전 등 같은 계열의 보유 전법도 사용 가능한 후보로 계산합니다.':
      season===3?'시즌3은 세팅 문맥에 명시된 1·2·3티어만 가중합니다. 세팅별 대체 전법과 상성 메모를 유지하며, 채울 수 없는 슬롯은 비워 둔 초안으로 저장할 수 있습니다.':
      '시즌1은 공통 티어가 없어 장수·전법 적합도를 우선합니다.';
    if(!pool.heroes.length){fill($('planner-results'),html('div',{class:'empty-box'},html('p',{text:'보유 장수가 등록되지 않았습니다. 먼저 보유 풀에서 장수를 체크하세요.'}),html('a',{class:'solid-btn small',href:'#/roster/pool',text:'보유 풀 등록하기'})));return;}
    if(!result.plans.length){fill($('planner-results'),html('div',{class:'empty-box'},html('p',{text:'현재 조건으로 묶을 수 있는 추천 조합이 없습니다.'}),html('p',{text:'미완성 덱도 보기 옵션을 켜거나, 내 구성에서 사용 중인 자원을 제외하지 않도록 바꿔 보세요.'})));return;}
    fill($('planner-results'),...result.plans.map(planCard));
  }
  async function show(){await load();render();}
  for(const id of ['planner-count','planner-reserve','planner-partial'])$(id).addEventListener('change',render);
  document.querySelectorAll('input[name=projection-mode]').forEach(input=>input.addEventListener('change',e=>{if(!e.target.checked)return;projectionMode=e.target.value;render();}));
  $('planner-projection-options').addEventListener('change',e=>{const input=e.target.closest('input[type=checkbox]');if(!input)return;const id=Number(input.value);
    if(input.checked){if(manuallySelected.size>=3){input.checked=false;notify('투영은 서로 다른 3종까지 선택할 수 있습니다.',true);return;}manuallySelected.add(id);}
    else manuallySelected.delete(id);render();});

  /** 변경 전 할당을 기준으로 변화를 계산하되 후보와 입력 보유 풀은 그대로 유지합니다. */
  function movePriority(key,entryId,toIndex){
    const active=activePlans.get(key);if(!active||!currentContext)return;
    const order=active.plan.entries.map(e=>String(e.candidate.id));
    const from=order.indexOf(String(entryId));
    if(from<0||toIndex===from||toIndex<0||toIndex>=order.length)return;
    order.splice(from,1);order.splice(toIndex,0,String(entryId));
    const byId=new Map(active.plan.entries.map(e=>[String(e.candidate.id),e]));
    const after=reallocateLineupByPriority(order.map(id=>byId.get(id)),currentContext);
    const changed=compareLineupAllocations(active.plan,after);
    const changedSlots=changed.reduce((n,e)=>n+e.changedSlots,0);
    const impacted=changed.filter(e=>e.changedSlots>0).length;
    storedOrders[key]=order;saveOrders();
    changeNotices.set(key,`${from+1}군 → ${toIndex+1}군으로 이동했습니다. ${impacted}개 덱의 전법 ${changedSlots}칸이 다시 배분됐습니다.${changedSlots?' 전법이 부족한 자리는 빈칸으로 표시됩니다.':''}`);
    render();
    const moved=[...$('planner-results').querySelectorAll('.planner-sort-item')].find(el=>el.dataset.planKey===key&&el.dataset.entryId===String(entryId));
    moved?.querySelector('.planner-drag-handle')?.focus({preventScroll:true});
  }
  function resetPriority(key){delete storedOrders[key];saveOrders();changeNotices.delete(key);render();}
  const results=$('planner-results');
  results.addEventListener('click',e=>{
    const btn=e.target.closest('[data-priority-action]');if(!btn)return;
    const key=btn.dataset.planKey,action=btn.dataset.priorityAction;
    if(action==='reset'){resetPriority(key);return;}
    const entryId=btn.dataset.entryId,active=activePlans.get(key);
    if(!active)return;
    const at=active.plan.entries.findIndex(f=>String(f.candidate.id)===entryId);
    movePriority(key,entryId,action==='first'?0:at+(action==='up'?-1:1));
  });
  function rowList(key){const active=activePlans.get(key);return active?.plan.entries||[];}
  function dropIndex(key,y){
    const parent=[...results.querySelectorAll('.planner-plan-list')].find(el=>el.dataset.planKey===key);
    if(!parent)return -1;
    const rows=[...parent.children].filter(el=>el.classList.contains('planner-sort-item')&&el.dataset.entryId!==dragged?.id);
    const index=rows.filter(el=>y>el.getBoundingClientRect().top+el.getBoundingClientRect().height/2).length;
    return Math.max(0,Math.min(rowList(key).length-1,index));
  }
  function markDrop(key,index){
    results.querySelectorAll('.planner-sort-item').forEach(el=>el.classList.remove('planner-drop-before','planner-drop-after'));
    const rows=[...results.querySelectorAll('.planner-plan-list')].find(el=>el.dataset.planKey===key);
    const others=[...(rows?.children||[])].filter(el=>el.classList.contains('planner-sort-item')&&el.dataset.entryId!==dragged?.id);
    if(others[index])others[index].classList.add('planner-drop-before');
    else others.at(-1)?.classList.add('planner-drop-after');
  }
  function clearDrag(){
    if(pointerDrag){if(pointerDrag.raf)cancelAnimationFrame(pointerDrag.raf);pointerDrag.row.style.transform='';pointerDrag.row.classList.remove('planner-is-dragging');pointerDrag=null;}
    results.querySelectorAll('.planner-sort-item').forEach(el=>el.classList.remove('planner-is-dragging','planner-drop-before','planner-drop-after'));
    dragged=null;
  }
  // 마우스와 모바일 터치를 하나의 Pointer Events 경로로 처리합니다.
  function pointerScroll(){
    if(!pointerDrag)return;
    const edge=120,y=pointerDrag.y;
    if(y<edge)window.scrollBy(0,-Math.ceil((edge-y)/4));
    else if(y>window.innerHeight-edge)window.scrollBy(0,Math.ceil((y-(window.innerHeight-edge))/4));
    if(dragged){
      const r=pointerDrag.row,visualTop=r.getBoundingClientRect().top-pointerDrag.delta;
      pointerDrag.delta=pointerDrag.y-pointerDrag.offset-visualTop;
      r.style.transform=`translateY(${pointerDrag.delta}px)`;
      markDrop(dragged.key,dropIndex(dragged.key,pointerDrag.y));
    }
    pointerDrag.raf=requestAnimationFrame(pointerScroll);
  }
  results.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    const handle=e.target.closest('.planner-drag-handle');if(!handle)return;
    const row=handle.closest('.planner-sort-item');if(!row)return;
    e.preventDefault();handle.setPointerCapture(e.pointerId);
    dragged={key:row.dataset.planKey,id:row.dataset.entryId};
    pointerDrag={row,handle,id:e.pointerId,y:e.clientY,offset:e.clientY-row.getBoundingClientRect().top,delta:0,raf:0};
    row.classList.add('planner-is-dragging');
    pointerDrag.raf=requestAnimationFrame(pointerScroll);
  });
  results.addEventListener('pointermove',e=>{
    if(!pointerDrag||e.pointerId!==pointerDrag.id)return;
    e.preventDefault();pointerDrag.y=e.clientY;
  });
  results.addEventListener('pointerup',e=>{
    if(!pointerDrag||e.pointerId!==pointerDrag.id)return;
    e.preventDefault();const {key,id}=dragged,to=dropIndex(key,e.clientY);clearDrag();movePriority(key,id,to);
  });
  results.addEventListener('pointercancel',()=>{if(pointerDrag)clearDrag();});
  return {show};
}
