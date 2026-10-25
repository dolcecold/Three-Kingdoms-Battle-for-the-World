/** 시즌별 원문 추천자료를 바탕으로 한 브라우저 전용 후보/다부대 추천. 전투 승률 계산 아님. */
const norm=x=>String(x??'').replace(/\s+/g,'').toLocaleLowerCase('ko');
export const rosterKey=names=>(names||[]).map(norm).sort().join('|');
export function tierOf(text,season){
  const value=String(text||'');
  const match=season===2?value.match(/(?:^|\s)(T0|T1\+|T1)(?=\s|[^\w]|$)/i):value.match(/([123])\s*티어/);
  if(!match)return {label:'등급 미기재',rank:0,source:null};
  const label=season===2?match[1].toUpperCase():`${match[1]}티어`;
  return {label,rank:season===2?({'T0':4,'T1+':3,'T1':2}[label]||0):4-Number(match[1]),source:value};
}
const ids=items=>(items||[]).map(x=>Number(x)).filter(Number.isInteger);
const uniq=rows=>[...new Set(rows)];
function baseCandidate(x){return {...x,heroes:uniq(x.heroes||[]),heroNames:x.heroNames||[],skillSlots:x.skillSlots||[],tier:x.tier||{label:'등급 미기재',rank:0,source:null}};}
export function buildCandidates({season,presets=[],s2=[],s3=[]}){
  const templates=presets.filter(t=>(t.season??t.source_kr_season)===season);
  const result=[];
  if(season===2){
    const indexed=new Map();
    for(const item of s2){
      const key=rosterKey(item.generals);const rank=tierOf(item.heading,2);
      if(!indexed.has(key)||indexed.get(key).tier.rank<rank.rank)indexed.set(key,{tier:rank,item});
    }
    for(const t of templates){
      const match=indexed.get(rosterKey(t.heroes.map(h=>h.name)));
      result.push(baseCandidate({id:t.id,title:t.name,kind:'preset',templateId:t.id,
        heroes:t.heroes.map(h=>h.id),heroNames:t.heroes.map(h=>h.name),
        skillSlots:t.heroes.flatMap(h=>(h.learned_tactics||[]).map((s,i)=>({hero:h.name,slot:i+1,choices:[{id:s.id,name:s.name}]}))),
        skillSource:(t.heroes||[]).some(h=>h.learned_tactics?.length)?'기존 추천덱':'전법 미기재',
        tier:match?.tier,tierSource:match?.item?.source_sheet||null}));
    }
    const existing=new Set(templates.map(t=>rosterKey(t.heroes.map(h=>h.name))));
    for(const [key,{item,tier}] of indexed){
      if(existing.has(key))continue;
      result.push(baseCandidate({id:item.id,title:item.heading.split('\n')[0],kind:'s2-ref',
        heroes:(item.display_guide?.members||[]).map(m=>m.hero_id).filter(id=>id!=null),
        heroNames:item.generals,tier,tierSource:item.source_sheet,skillSource:'전법 원문 미기재'}));
    }
  }else if(season===3){
    for(const v of s3){
      const contexts=v.reference_contexts||[];
      const ranked=contexts.map(c=>tierOf(c.stage,3)).filter(t=>t.rank>0).sort((a,b)=>b.rank-a.rank);
      const heroIds=(v.members||[]).map(m=>m.hero_choice?.status==='resolved'&&m.hero_choice?.candidates?.length===1?m.hero_choice.candidates[0].id:null);
      const slots=(v.members||[]).flatMap(m=>(m.learned_choices||[]).map(c=>({hero:m.general,slot:c.slot,raw:c.text,
        choices:(c.options||[]).flatMap(o=>o.candidates?.length===1&&o.status==='resolved'?[{id:o.candidates[0].id,name:o.candidates[0].name}]:[]),
        unresolved:(c.options||[]).some(o=>o.status!=='resolved'||o.candidates?.length!==1)})));
      result.push(baseCandidate({id:v.id,title:v.label,kind:'s3-ref',heroes:heroIds.filter(Boolean),heroNames:v.members.map(m=>m.general),
        unresolvedHeroes:heroIds.includes(null),skillSlots:slots,skillSource:'S3 세팅별 대체 전법',tier:ranked[0],tierSource:ranked[0]?.source||null,variant:v}));
    }
    for(const t of templates){
      // 시즌3 원본 추천 6개는 세팅별 티어 자료와 별도로 유지. 근거 없이 순위를 부여하지 않는다.
      result.push(baseCandidate({id:t.id,title:t.name,kind:'preset',templateId:t.id,
        heroes:t.heroes.map(h=>h.id),heroNames:t.heroes.map(h=>h.name),
        skillSlots:t.heroes.flatMap(h=>(h.learned_tactics||[]).map((s,i)=>({hero:h.name,slot:i+1,choices:[{id:s.id,name:s.name}]}))),
        skillSource:'기존 추천덱'}));
    }
  }else for(const t of templates)result.push(baseCandidate({id:t.id,title:t.name,kind:'preset',templateId:t.id,
    heroes:t.heroes.map(h=>h.id),heroNames:t.heroes.map(h=>h.name),
    skillSlots:t.heroes.flatMap(h=>(h.learned_tactics||[]).map((s,i)=>({hero:h.name,slot:i+1,choices:[{id:s.id,name:s.name}]}))),skillSource:'기존 추천덱'}));
  return result;
}
/** 전법은 같은 슬롯의 원문 대안 중 소유/미점유 하나만 택한다. 임의 대체는 금지한다. */
export function fitCandidate(c,{heroes,tactics,usedHeroes=new Set(),usedTactics=new Set()}){
  const usedH=new Set(),usedT=new Set(),selected=[];let ownedHeroes=0,matchedSkills=0,missingSlots=0;
  for(const id of c.heroes){if(heroes.has(id)&&!usedHeroes.has(id)&&!usedH.has(id)){usedH.add(id);ownedHeroes++;}}
  // 대체 전법의 선택 폭이 좁은 슬롯부터 채워 보유 전법 사용 가능 칸을 최대화한다.
  const ordered=(c.skillSlots||[]).map((row,index)=>({row,index,valid:(row.choices||[]).filter(opt=>tactics.has(opt.id)&&!usedTactics.has(opt.id))}));
  ordered.sort((a,b)=>a.valid.length-b.valid.length||a.index-b.index);
  const match=new Map();
  const find=(entry,seen)=>{
    for(const option of entry.valid){
      if(seen.has(option.id))continue;seen.add(option.id);
      const other=match.get(option.id);
      if(!other||find(other,seen)){match.set(option.id,entry);return true;}
    }
    return false;
  };
  for(const entry of ordered)find(entry,new Set());
  const chosen=new Map();for(const [id,entry] of match)chosen.set(entry.index,entry.valid.find(x=>x.id===id));
  for(let i=0;i<c.skillSlots.length;i++){
    const row=c.skillSlots[i],found=chosen.get(i)||null;
    if(found){usedT.add(found.id);matchedSkills++;}else missingSlots++;
    selected.push({hero:row.hero,slot:row.slot,chosen:found,alternatives:row.choices||[],raw:row.raw||null,unresolved:!!row.unresolved});
  }
  const complete=ownedHeroes===3&&c.heroes.length===3&&!c.unresolvedHeroes;
  // 티어 근거가 없는 덱에 임의 등급을 부여하지 않는다. 미기재 슬롯은 완성으로 세지 않는다.
  const tierPoints=c.tier.rank*110;
  const fitPoints=ownedHeroes*50+matchedSkills*18;
  const penalty=missingSlots*5+(c.skillSlots.length===0?22:0)+(c.unresolvedHeroes?65:0);
  return {candidate:c,complete,ownedHeroes,matchedSkills,missingSlots,selected,
    usedHeroes:usedH,usedTactics:usedT,score:tierPoints+fitPoints-penalty,
    skillDefined:c.skillSlots.length>0,skillsComplete:c.skillSlots.length>0&&missingSlots===0};
}
/** 폭 제한 beam search; 탐색 품질용 근사이며 최적해 보증은 하지 않는다. */
export function recommendLineups(candidates,{heroes=[],tactics=[],reservedHeroes=[],reservedTactics=[],count=3,allowPartial=false,beamWidth=100}={}){
  const ownedH=new Set(ids(heroes)),ownedT=new Set(ids(tactics));
  const reservedH=new Set(ids(reservedHeroes)),reservedT=new Set(ids(reservedTactics));
  const usable=candidates.filter(c=>c.heroes.length===3&&!c.unresolvedHeroes&&new Set(c.heroes).size===3)
    .map(c=>fitCandidate(c,{heroes:ownedH,tactics:ownedT,usedHeroes:reservedH,usedTactics:reservedT}))
    .filter(p=>allowPartial?p.ownedHeroes>0:p.complete)
    .sort((a,b)=>b.score-a.score).slice(0,110).map(p=>p.candidate);
  let beam=[{entries:[],usedHeroes:new Set(reservedH),usedTactics:new Set(reservedT),total:0}];
  const finals=[];
  for(let depth=1;depth<=Math.min(5,Math.max(1,count));depth++){
    const next=[];
    for(const p of beam){
      for(const c of usable){
        if(p.entries.some(e=>e.candidate.id===c.id))continue;
        if(c.heroes.some(id=>p.usedHeroes.has(id)))continue; // 1명의 중복도 허용하지 않는다.
        const fitted=fitCandidate(c,{heroes:ownedH,tactics:ownedT,usedHeroes:p.usedHeroes,usedTactics:p.usedTactics});
        if(!allowPartial&&!fitted.complete)continue;
        const h=new Set([...p.usedHeroes,...c.heroes]);
        const t=new Set([...p.usedTactics,...fitted.usedTactics]);
        // 같은 부대 구성의 서로 다른 세팅을 한 계획에 함께 배치할 수 없다 (위 영웅 중복 규칙).
        const plan={entries:[...p.entries,fitted],usedHeroes:h,usedTactics:t,total:p.total+fitted.score+80};
        next.push(plan);
      }
    }
    if(!next.length)break;
    next.sort((a,b)=>b.total-a.total||b.entries.length-a.entries.length);
    const distinct=new Map();
    for(const p of next){const sig=p.entries.map(e=>e.candidate.id).sort().join('|');if(!distinct.has(sig))distinct.set(sig,p);if(distinct.size>=beamWidth)break;}
    beam=[...distinct.values()];
    finals.push(...beam.slice(0,30));
  }
  // 목표 부대 수에 가까운 계획을 우선하되 실제 추천품질도 비교 가능하도록 점수로 순위 지정
  finals.sort((a,b)=>Number(b.entries.length===count)-Number(a.entries.length===count)||b.total-a.total);
  const choices=[],seen=new Set();
  for(const p of finals){const key=p.entries.map(e=>rosterKey(e.candidate.heroNames)).sort().join('||');if(seen.has(key))continue;seen.add(key);choices.push(p);if(choices.length===3)break;}
  return {plans:choices,eligible:usable.length,ownedHeroes:ownedH.size,ownedTactics:ownedT.size};
}
