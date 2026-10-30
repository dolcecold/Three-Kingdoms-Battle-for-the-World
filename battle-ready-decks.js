/* 배틀 선택 전용: 원본의 학습 전법 6칸이 확정된 세팅만 허용.
 * 추천덱 도감/최적 5군/개인 저장 덱의 원본 자료나 보유 풀은 변경하지 않는다.
 */
const knownId=(id,map)=>Number.isInteger(Number(id))&&Number(id)>0&&(!map||map.has(Number(id)));

function validTacticAllocation(ids,idx){
  if(!idx?.tactic)return true;
  const used=new Map(),groups=new Map();
  for(const id of ids){
    const t=idx.tactic.get(id);if(!t)return false;
    const group=t.exclusive_group_id??t.base_skill_id??t.id;
    if(groups.has(group)&&groups.get(group)!==id)return false;
    groups.set(group,id);
    const count=(used.get(id)||0)+1;
    if(count>Number(t.max_per_army??1))return false;
    used.set(id,count);
  }
  return true;
}

export function isBattleReadyPreset(template,idx){
  const heroes=template?.army?.heroes;
  if(!Array.isArray(heroes)||heroes.length!==3)return false;
  if(new Set(heroes.map(h=>Number(h.hero_id))).size!==3)return false;
  const learned=[];
  for(const hero of heroes){
    if(!knownId(hero.hero_id,idx?.hero)||!Array.isArray(hero.learned)||hero.learned.length!==2)return false;
    const ids=hero.learned.map(t=>Number(t.skill_id));
    if(new Set(ids).size!==2||ids.some(id=>!knownId(id,idx?.tactic)))return false;
    learned.push(...ids);
  }
  return validTacticAllocation(learned,idx);
}

/** 참고 세팅: 무장과 학습 전법 1·2번이 각각 단일 후보로 확정되어 있어야 한다. */
export function resolvedBattleReference(variant,idx){
  if(!variant?.hero_roster_resolved||!Array.isArray(variant.members)||variant.members.length!==3)return null;
  const heroes=[],tactics=[],all=[];
  for(const member of variant.members){
    const hc=member.hero_choice;
    if(hc?.status!=='resolved'||hc.candidates?.length!==1)return null;
    const heroId=Number(hc.candidates[0]?.id);
    if(!knownId(heroId,idx?.hero))return null;
    const choices=member.learned_choices;
    if(!Array.isArray(choices)||choices.length!==2)return null;
    const slots=new Map();
    for(const choice of choices){
      const slot=Number(choice.slot);
      if(![1,2].includes(slot)||slots.has(slot)||choice.selection_required===true)return null;
      if(!Array.isArray(choice.options)||choice.options.length!==1)return null;
      const option=choice.options[0];
      if(option.status!=='resolved'||option.candidates?.length!==1)return null;
      const tacticId=Number(option.candidates[0]?.id);
      if(!knownId(tacticId,idx?.tactic))return null;
      slots.set(slot,tacticId);
    }
    if(!slots.has(1)||!slots.has(2)||slots.get(1)===slots.get(2))return null;
    heroes.push(heroId);
    const ids=[slots.get(1),slots.get(2)];tactics.push(ids);all.push(...ids);
  }
  if(new Set(heroes).size!==3||!validTacticAllocation(all,idx))return null;
  return {heroes,tactics};
}
