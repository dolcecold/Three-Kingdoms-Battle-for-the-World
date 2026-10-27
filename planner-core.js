/** 한국 시즌별 추천 원문 기반, 클라이언트 5군 근사 탐색. 승률/전역 최적 보증 아님. */
const norm=x=>String(x??'').replace(/\s+/g,'').toLocaleLowerCase('ko');
const ids=a=>[...new Set(Array.from(a||[]).map(Number).filter(Number.isInteger))];
export const rosterKey=names=>(names||[]).map(norm).sort().join('|');
export const PROJECTION_NAMES=['침략 방어','천하평론','연전연승','병력 강화','정의의 희생','허실 간파'];
const PROJECTION_PAIRS=[
  {base:20670,shadow:800028,name:'침략 방어'},
  {base:20130,shadow:800035,name:'천하평론'},
  {base:20600,shadow:800006,name:'연전연승'},
  {base:20610,shadow:800036,name:'병력 강화'},
  {base:20120,shadow:800004,name:'정의의 희생'},
  {base:20640,shadow:800027,name:'허실 간파'}
];
export const PROJECTIONS=Object.freeze(PROJECTION_PAIRS.map(Object.freeze));
const SHADOW_TO_BASE=new Map(PROJECTIONS.map(p=>[p.shadow,p.base]));
const BASE_TO_SHADOW=new Map(PROJECTIONS.map(p=>[p.base,p.shadow]));
export const isProjection=id=>SHADOW_TO_BASE.has(Number(id));
export function tierOf(text,season){
  const match=season===2?String(text||'').match(/(?:^|\s)(T0|T1\+|T1)(?=\s|[^\w]|$)/i):String(text||'').match(/([123])\s*티어/);
  if(!match)return {label:'등급 미기재',rank:0,source:null};
  const label=season===2?match[1].toUpperCase():`${match[1]}티어`;
  return {label,rank:season===2?({T0:4,'T1+':3,T1:2}[label]||0):4-Number(match[1]),source:String(text||'')};
}
function candidate(x){return {...x,heroes:ids(x.heroes),heroNames:x.heroNames||[],skillSlots:x.skillSlots||[],tier:x.tier||{label:'등급 미기재',rank:0,source:null}};}
const slotsForTemplate=t=>t.heroes.flatMap(h=>(h.learned_tactics||[]).map((s,i)=>({hero:h.name,slot:i+1,choices:[{id:s.id,name:s.name}]})));
export function buildCandidates({season,presets=[],s2=[],s3=[]}){
  const templates=presets.filter(t=>(t.season??t.source_kr_season)===season),result=[];
  if(season===2){
    const indexed=new Map();
    for(const item of s2){const key=rosterKey(item.generals),tier=tierOf(item.heading,2);if(!indexed.has(key)||indexed.get(key).tier.rank<tier.rank)indexed.set(key,{tier,item});}
    for(const t of templates){const match=indexed.get(rosterKey(t.heroes.map(h=>h.name)));
      result.push(candidate({id:t.id,title:t.name,kind:'preset',templateId:t.id,template:t,heroes:t.heroes.map(h=>h.id),heroNames:t.heroes.map(h=>h.name),skillSlots:slotsForTemplate(t),skillSource:'기존 추천덱',tier:match?.tier,tierSource:match?.item?.source_sheet||null}));}
    const existing=new Set(templates.map(t=>rosterKey(t.heroes.map(h=>h.name))));
    for(const [key,{item,tier}] of indexed){if(existing.has(key))continue;
      result.push(candidate({id:item.id,title:item.heading.split('\n')[0],kind:'s2-ref',reference:item,heroes:(item.display_guide?.members||[]).map(m=>m.hero_id).filter(id=>id!=null),heroNames:item.generals,tier,tierSource:item.source_sheet,skillSource:'전법 원문 미기재'}));}
  }else if(season===3){
    for(const v of s3){
      const ranked=(v.reference_contexts||[]).map(c=>tierOf(c.stage,3)).filter(t=>t.rank>0).sort((a,b)=>b.rank-a.rank);
      const hIds=(v.members||[]).map(m=>m.hero_choice?.status==='resolved'&&m.hero_choice?.candidates?.length===1?m.hero_choice.candidates[0].id:null);
      const slots=(v.members||[]).flatMap(m=>(m.learned_choices||[]).map(c=>({hero:m.general,slot:c.slot,raw:c.text,
        choices:(c.options||[]).flatMap(o=>o.status==='resolved'&&o.candidates?.length===1?[{id:o.candidates[0].id,name:o.candidates[0].name}]:[]),
        unresolved:(c.options||[]).some(o=>o.status!=='resolved'||o.candidates?.length!==1)})));
      result.push(candidate({id:v.id,title:v.label,kind:'s3-ref',heroes:hIds.filter(Boolean),heroNames:v.members.map(m=>m.general),
        unresolvedHeroes:hIds.includes(null),skillSlots:slots,skillSource:'S3 대체 전법',tier:ranked[0],tierSource:ranked[0]?.source||null,variant:v,reference:v}));}
  }
  if(season!==2)for(const t of templates)result.push(candidate({id:t.id,title:t.name,kind:'preset',templateId:t.id,template:t,heroes:t.heroes.map(h=>h.id),heroNames:t.heroes.map(h=>h.name),skillSlots:slotsForTemplate(t),skillSource:'기존 추천덱'}));
  return result;
}
export function familyOf(id,catalog){
  const row=catalog?.get?.(Number(id))||catalog?.[Number(id)];
  return Number(row?.base_skill_id??row?.exclusive_group_id??row?.id??id);
}
function optionName(id,catalog){return catalog?.get?.(Number(id))?.name||`#${id}`;}
/** 투영을 사용할 수 있는 기본 전법만 허용. 이미 등록된 투영 ID도 기본 3종 제한을 공유한다. */
export function projectionOptions({tactics=[],selection='auto',tacticCatalog=new Map()}={}){
  const own=new Set(ids(tactics));
  const possible=PROJECTIONS.filter(p=>tacticCatalog.has(p.shadow)&&(own.has(p.base)||own.has(p.shadow)));
  if(selection==='auto'||selection==null)return possible;
  const chosen=ids(selection);if(chosen.length>3)throw new Error('투영은 서로 다른 종류로 최대 3개만 선택할 수 있습니다.');
  if(chosen.some(id=>!possible.some(p=>p.shadow===id)))throw new Error('보유 원본 전법에 해당하지 않는 투영을 선택했습니다.');
  return possible.filter(p=>chosen.includes(p.shadow));
}
/** 실제 사용 가능 자원을 개별 ID로 매칭하고, 일반 전법을 우선 사용한다. 투영 최대 3종 전역 공유. */
export function fitCandidate(c,{heroes=new Set(),tactics=new Set(),usedHeroes=new Set(),usedTactics=new Set(),tacticCatalog=new Map(),projectionSelection='auto'}={}){
  const ownedH=heroes instanceof Set?heroes:new Set(ids(heroes));
  const ownedT=tactics instanceof Set?tactics:new Set(ids(tactics));
  const blockedT=usedTactics instanceof Set?usedTactics:new Set(ids(usedTactics));
  const shadowAllowed=projectionOptions({tactics:ownedT,selection:projectionSelection,tacticCatalog});
  const alreadyShadow=[...blockedT].filter(isProjection).length;
  const budget=Math.max(0,3-alreadyShadow);
  const shadowIds=new Set(shadowAllowed.map(p=>p.shadow));
  const usedH=new Set(c.heroes.filter(id=>ownedH.has(id)&&!usedHeroes.has(id)));
  const ownSlots=(c.skillSlots||[]).map((row,index)=>{
    const families=new Set((row.choices||[]).map(opt=>familyOf(opt.id,tacticCatalog)));
    const standard=[...ownedT].filter(id=>!isProjection(id)&&!blockedT.has(id)&&families.has(familyOf(id,tacticCatalog)));
    const projection=[...shadowIds].filter(id=>!blockedT.has(id)&&families.has(familyOf(id,tacticCatalog)));
    return {row,index,standard,projection};
  });
  // 동일 부대에서 같은 원본(exclusive_group_id/투영 base ID)의 두 버전은 함께 사용할 수 없다.
  const match=new Map();
  const augment=(entry,seen)=>{for(const id of entry.standard){const family=familyOf(id,tacticCatalog);
    if(seen.has(family))continue;seen.add(family);
    const other=match.get(family);
    if(!other||augment(other.entry,seen)){match.set(family,{entry,id});return true;}}
    return false;};
  const priority=[...ownSlots].sort((a,b)=>a.standard.length-b.standard.length||a.index-b.index);
  for(const e of priority)augment(e,new Set());
  const chosen=new Map(),usedFamilies=new Set();
  for(const [family,{entry,id}] of match){chosen.set(entry.index,id);usedFamilies.add(family);}
  // 다른 부대에서는 같은 원본의 일반+투영을 나눠 사용할 수 있지만, 부대 내부 중복은 불가.
  const usedShadow=new Set();
  const missing=ownSlots.filter(e=>!chosen.has(e.index)).sort((a,b)=>a.projection.length-b.projection.length||a.index-b.index);
  for(const entry of missing){if(usedShadow.size>=budget)break;
    const found=entry.projection.find(id=>!usedShadow.has(id)&&!usedFamilies.has(familyOf(id,tacticCatalog)));
    if(found!=null){chosen.set(entry.index,found);usedShadow.add(found);usedFamilies.add(familyOf(found,tacticCatalog));}
  }
  const selected=ownSlots.map((e)=>{const tid=chosen.get(e.index),opt=tid!=null?{id:tid,name:optionName(tid,tacticCatalog),family:familyOf(tid,tacticCatalog),projection:isProjection(tid)}:null;
    return {hero:e.row.hero,slot:e.row.slot,chosen:opt,alternatives:e.row.choices||[],raw:e.row.raw||null,unresolved:!!e.row.unresolved};});
  const pickedIds=new Set([...chosen.values()]);
  const matchedSkills=pickedIds.size,missingSlots=ownSlots.length-matchedSkills;
  const ownedHeroes=usedH.size,complete=c.heroes.length===3&&!c.unresolvedHeroes&&ownedHeroes===3;
  const tierPoints=c.tier.rank*135,heroFit=ownedHeroes*65,skillFit=matchedSkills*31;
  const penalty=(3-ownedHeroes)*68+missingSlots*18+(ownSlots.length===0?42:0)+(c.unresolvedHeroes?95:0);
  const perfectBonus=complete?65:0;
  return {candidate:c,complete,ownedHeroes,matchedSkills,missingSlots,selected,usedHeroes:usedH,usedTactics:pickedIds,
    projectionUsed:[...usedShadow],score:tierPoints+heroFit+skillFit+perfectBonus-penalty,
    skillDefined:ownSlots.length>0,skillsComplete:ownSlots.length>0&&missingSlots===0,suitability:heroFit+skillFit-penalty};
}
/** 5군 전체를 동시에 조합하는 beam search. 군 간 중복과 투영 전역 한도 3을 강제하며, 전역 최적해 보장은 하지 않음. */
export function recommendLineups(candidates,{heroes=[],tactics=[],reservedHeroes=[],reservedTactics=[],count=5,allowPartial=true,beamWidth=150,tacticCatalog=new Map(),projectionSelection='auto'}={}){
  const ownedH=new Set(ids(heroes)),ownedT=new Set(ids(tactics));
  const reservedH=new Set(ids(reservedHeroes)),reservedT=new Set(ids(reservedTactics));
  const eligible=candidates.filter(c=>c.heroes.length===3&&!c.unresolvedHeroes&&new Set(c.heroes).size===3)
    .map(c=>fitCandidate(c,{heroes:ownedH,tactics:ownedT,usedHeroes:reservedH,usedTactics:reservedT,tacticCatalog,projectionSelection}))
    .filter(f=>allowPartial?f.ownedHeroes>0:f.complete)
    .sort((a,b)=>b.score-a.score).map(f=>f.candidate);
  const depthMax=Math.max(1,Math.min(5,count));
  let beam=[{entries:[],usedHeroes:new Set(reservedH),usedTactics:new Set(reservedT),total:0}];
  const finished=[];
  for(let d=1;d<=depthMax;d++){
    const next=[];
    for(const p of beam){
      for(const c of eligible){
        if(p.entries.some(e=>e.candidate.id===c.id))continue;
        // 실제 소유한 장수가 중복되는 경우만 금지. 소유하지 않은 장수는 빈 슬롯으로 남길 수 있다.
        if(c.heroes.some(id=>ownedH.has(id)&&p.usedHeroes.has(id)))continue;
        const fit=fitCandidate(c,{heroes:ownedH,tactics:ownedT,usedHeroes:p.usedHeroes,usedTactics:p.usedTactics,tacticCatalog,projectionSelection});
        if(!allowPartial&&!fit.complete)continue;
        if(fit.ownedHeroes===0)continue;
        const usedHeroes=new Set([...p.usedHeroes,...fit.usedHeroes]);
        const usedTactics=new Set([...p.usedTactics,...fit.usedTactics]);
        if([...usedTactics].filter(isProjection).length>3)throw new Error('투영 전법 3종 초과 배분');
        const quality=fit.score+(fit.skillsComplete?30:0)+(fit.complete?25:0);
        next.push({entries:[...p.entries,fit],usedHeroes,usedTactics,total:p.total+quality});
      }
    }
    if(!next.length)break;
    next.sort((a,b)=>b.total-a.total);
    const distinct=new Map();
    for(const p of next){
      const signature=p.entries.map(e=>e.candidate.id).sort().join('|')+'#'+[...p.usedTactics].filter(isProjection).sort().join(',');
      if(!distinct.has(signature))distinct.set(signature,p);
      if(distinct.size>=beamWidth)break;
    }
    beam=[...distinct.values()];finished.push(...beam.slice(0,45));
  }
  finished.sort((a,b)=>Number(b.entries.length===depthMax)-Number(a.entries.length===depthMax)||b.entries.length-a.entries.length||b.total-a.total);
  const plans=[],seen=new Set();
  for(const p of finished){
    const key=p.entries.map(e=>rosterKey(e.candidate.heroNames)).sort().join('||');
    if(seen.has(key))continue;seen.add(key);plans.push(p);if(plans.length>=4)break;
  }
  return {plans,eligible:eligible.length,ownedHeroes:ownedH.size,ownedTactics:ownedT.size};
}
