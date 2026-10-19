/** Public editor selection rules only; combat runs in the backend. */
export const STAT_FIELDS=[['might','무력'],['intelligence','지력'],['defence','통솔'],['speed','선공']];

/** IDs are identity keys. In particular, S/A 황보숭 and ordinary/SP 제갈량 differ. */
export function heroChoiceLabel(row){return `${row.name} · ${row.rarity_name} · ${row.faction_name} (#${row.id})`;}

/** Original client stat math only. No formation, combat, or effect calculation. */
export function previewHeroStats(data,hero){
  const row=data.heroes.find(h=>h.id===hero.hero_id);
  if(!row?.base_stats||!row?.growth_stats)throw new Error('무장 기본·성장 스탯이 포함된 최신 메타데이터를 조회하세요.');
  const values=STAT_FIELDS.map(([key])=>key);
  if(hero.total_stats!=null){
    if(values.some(k=>typeof hero.total_stats[k]!=='number'||!Number.isFinite(hero.total_stats[k])||hero.total_stats[k]<0||hero.total_stats[k]>2000)||!values.some(k=>hero.total_stats[k]>0))throw new Error('총 능력치는 네 속성을 모두 입력하세요. 직접 입력을 사용하지 않으면 null로 유지하세요.');
    return {...hero.total_stats};
  }
  const recommended=hero.allocation_mode==='recommended',points=Math.floor(hero.level/10)*10+(hero.breakthrough??0)*10;
  if(recommended&&!row.recommended_attribute)throw new Error('추천 배분 속성이 확인되지 않았습니다.');
  return Object.fromEntries(values.map(key=>[key,row.base_stats[key]+row.growth_stats[key]*(hero.level-1)+(recommended?(key===row.recommended_attribute?points:0):(hero.allocation?.[key]??0))+(hero.equipment?.[key]??0)+(hero.horse?.[key]??0)]));
}

/** Migrate alias names only. Do not choose/drop a proficiency or repair total stats. */
export function migrateProgression(army){
  const value=structuredClone(army);
  for(const h of value.heroes){
    if(h.promotion!=null&&(h.innate?.grade??0)!==0&&h.promotion!==h.innate.grade)throw new Error('무장 승품과 호환 grade가 다릅니다. 입력을 확인하세요.');
    h.promotion=h.promotion??h.innate?.grade??0;
    if(h.innate)h.innate.grade=0;
    for(const skill of h.learned??[]){
      if(skill.breakthrough!=null&&(skill.grade??0)!==0&&skill.breakthrough!==skill.grade)throw new Error('전법 돌파와 호환 grade가 다릅니다. 입력을 확인하세요.');
      skill.breakthrough=skill.breakthrough??skill.grade??0;skill.grade=0;
    }
  }
  return value;
}

export function romanceFor(data,hero){return hero.romance_trait_id==null?null:(data.romance_options??[]).find(r=>r.trait_id===hero.romance_trait_id&&r.hero_id===hero.hero_id)??null;}
export function innateFor(data,hero){return romanceFor(data,hero)?.innate??data.heroes.find(h=>h.id===hero.hero_id)?.innate;}
export function armFor(data,hero){return data.arms.find(a=>a.id===(hero.advanced_arms_id||romanceFor(data,hero)?.arms_id||data.heroes.find(h=>h.id===hero.hero_id)?.default_arms_id));}

/** Selection only. Fixed Romance books replace the normal slots. */
export function withRomance(data,army,heroId,traitId,{warbookPage='normal'}={}){
  const copy=structuredClone(army),hero=copy.heroes.find(h=>h.hero_id===heroId);
  if(!hero)throw new Error('편성에 없는 무장입니다.');
  hero.romance_trait_id=traitId;hero.warbook_page=warbookPage;
  const option=romanceFor(data,hero);
  if(traitId!=null&&!option)throw new Error('해당 시즌·무장의 연의 분기를 선택하세요.');
  if(warbookPage==='romance')hero.warbook_slots=[];
  const arm=data.arms.find(a=>a.id===hero.advanced_arms_id);
  const expected=option?.arms_id??data.heroes.find(h=>h.id===heroId)?.default_arms_id;
  if(arm&&arm.arms_type!==data.arms.find(a=>a.id===expected)?.arms_type){hero.advanced_arms_id=null;hero.arms_skill_ids=[];}
  return validateArmy(data,copy);
}

export function bookChoices(data,hero,slot){
  if(hero.warbook_page==='romance')return [];
  const rule=data.heroes.find(h=>h.id===hero.hero_id)?.warbook_slots.find(s=>s.slot===slot);
  if(!rule||hero.level<rule.unlock_level)return [];
  const others=hero.warbook_slots.filter(s=>s.slot!==slot).map(s=>data.warbooks.find(b=>b.id===s.warbook_id)).filter(Boolean);
  return data.warbooks.filter(b=>rule.warbook_ids.includes(b.id)&&!others.some(o=>o.id===b.id||(o.group_id>0&&o.group_id===b.group_id))&&!(b.quality===3&&others.some(o=>o.quality===3)));
}

export function tacticChoices(data,army,hero,index){
  const current=hero.learned[index]?.skill_id;
  return data.tactics.filter(t=>{
    if(t.id===current)return true;
    const group=t.exclusive_group_id??t.base_skill_id??t.id;
    if(army.heroes.some(h=>h.learned.some((s,i)=>{
      if(h===hero&&i===index)return false;
      const other=data.tactics.find(r=>r.id===s.skill_id);
      return other&&other.id!==t.id&&(other.exclusive_group_id??other.base_skill_id??other.id)===group;
    })))return false;
    if(hero.learned.some((s,i)=>i!==index&&s.skill_id===t.id))return false;
    const used=army.heroes.reduce((n,h)=>n+h.learned.filter(s=>s.skill_id===t.id).length,0);
    return used<t.max_per_army;
  });
}

export function validateArmy(data,army){
  const fail=message=>{throw new Error(message);};
  const range=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
  const integer=(v,min,max)=>Number.isInteger(v)&&range(v,min,max);
  if(!army||!Array.isArray(army.heroes)||army.heroes.length!==3)fail('부대에는 무장 3명이 필요합니다.');
  if(typeof army.name!=='string'||!army.name.trim()||army.name.length>80)fail('부대 이름은 1~80자로 입력하세요.');
  if(!data.formations.some(f=>f.id===army.formation_id))fail('현재 시즌에서 선택할 수 없는 진형입니다.');
  if(!integer(army.supply,0,100))fail('보급은 0~100 사이의 정수로 입력하세요.');
  if(new Set(army.heroes.map(h=>h.slot)).size!==3||army.heroes.some(h=>![1,2,3].includes(h.slot)))fail('무장 위치는 1·2·3번이어야 합니다.');
  if(new Set(army.heroes.map(h=>h.hero_id)).size!==3)fail('같은 부대에 무장을 중복 배치할 수 없습니다.');
  const learnedCounts=new Map();
  const variantGroups=new Map();
  const romanceGroups=new Set();
  for(const h of army.heroes){
    const row=data.heroes.find(x=>x.id===h.hero_id);
    if(!row)fail('현재 시즌에서 선택할 수 없는 무장이 있습니다.');
    const romance=romanceFor(data,h);
    if(h.romance_trait_id!=null&&(!Number.isInteger(h.romance_trait_id)||!romance||data.season!==3))fail(`${row.name}: 한국 시즌3의 해당 무장 연의 분기를 선택하세요.`);
    if(!['normal','romance'].includes(h.warbook_page??'normal'))fail('병법 페이지를 확인하세요.');
    if(h.warbook_page==='romance'&&(!romance||h.warbook_slots.length))fail(`${row.name}: 연의 고정 병법은 일반 병법과 함께 적용할 수 없습니다.`);
    if(romance){if(romanceGroups.has(romance.stage_id))fail('같은 연의 그룹에서는 한 무장의 한 분기만 선택하세요.');romanceGroups.add(romance.stage_id);}
    if(!integer(h.level,1,50)||!integer(h.troops,1,50000))fail(`${row.name}: 레벨은 1~50, 병력은 1~50,000으로 입력하세요.`);
    if(!integer(h.breakthrough??0,0,5)||!['manual','recommended'].includes(h.allocation_mode??'manual'))fail(`${row.name}: 무장 돌파는 0~5, 배분 방식은 직접 또는 추천으로 선택하세요.`);
    if(h.promotion!=null&&(!integer(h.promotion,0,5)||(h.innate.grade!==0&&h.innate.grade!==h.promotion)))fail(`${row.name}: 무장 승품은 0~5로 입력하고 호환용 고유 grade와 일치시켜 주세요.`);
    if(h.allocation_mode==='recommended'&&h.total_stats==null&&!row.recommended_attribute)fail(`${row.name}: 추천 배분 속성이 확인되지 않았습니다. 직접 배분을 선택하세요.`);
    for(const stats of [h.allocation,h.equipment,h.horse,...(h.total_stats==null?[]:[h.total_stats])]){
      if(!stats||STAT_FIELDS.some(([key])=>!range(stats[key],0,2000)))fail(`${row.name}: 능력치는 0~2,000 사이의 숫자로 입력하세요.`);
    }
    if(h.total_stats!=null&&!STAT_FIELDS.some(([key])=>h.total_stats[key]>0))fail(`${row.name}: 총 능력치가 모두0입니다. 직접 입력을 사용하지 않으면 total_stats=null로 보내세요.`);
    for(const [key,choices] of [['equipment_item_id',data.equipment],['horse_item_id',data.horses]])if(h[key]!=null&&!choices?.some(item=>item.id===h[key]))fail(`${row.name}: 장비·말 ID를 확인하세요.`);
    if(!Array.isArray(h.learned)||h.learned.length>2||new Set(h.learned.map(s=>s.skill_id)).size!==h.learned.length)fail(`${row.name}: 학습 전법은 중복 없이 2개까지 선택하세요.`);
    for(const s of [h.innate,...h.learned])if(!s||!integer(s.level,1,10)||!integer(s.grade,0,5)||s.breakthrough!=null&&(!integer(s.breakthrough,0,5)||(s.grade!==0&&s.grade!==s.breakthrough)))fail(`${row.name}: 전법 레벨은 1~10, 돌파는 0~5로 입력하고 호환용 grade와 일치시켜 주세요.`);
    for(const s of h.learned){
      const tactic=data.tactics.find(t=>t.id===s.skill_id);
      if(!tactic)fail(`${row.name}: 선택할 수 없는 학습 전법이 있습니다.`);
      const group=tactic.exclusive_group_id??tactic.base_skill_id??tactic.id;
      if(variantGroups.has(group)&&variantGroups.get(group)!==s.skill_id)fail('같은 원본의 일반·투영·반전 전법은 한 부대에서 함께 사용할 수 없습니다.');
      variantGroups.set(group,s.skill_id);
      const n=(learnedCounts.get(s.skill_id)||0)+1;learnedCounts.set(s.skill_id,n);
      if(n>tactic.max_per_army)fail(`${tactic.name}: 부대 내 사용 가능 횟수를 초과했습니다.`);
    }
    if(!Array.isArray(h.warbook_slots)||h.warbook_slots.length>3||new Set(h.warbook_slots.map(s=>s.slot)).size!==h.warbook_slots.length)fail(`${row.name}: 병법 슬롯을 확인하세요.`);
    for(const s of h.warbook_slots){
      if(!bookChoices(data,h,s.slot).some(b=>b.id===s.warbook_id))fail(`${row.name}: 사용할 수 없는 병법 또는 중복 병법이 있습니다.`);
    }
    const arm=armFor(data,h);
    if(!arm)fail(`${row.name}: 병종을 확인하세요.`);
    if(romance&&arm.arms_type!==romance.arms_id)fail(`${row.name}: 연의 분기와 같은 계열의 병종을 선택하세요.`);
    if(h.level<(arm.unlock_level??1))fail(`${row.name}: 선택 병종은 Lv${arm.unlock_level}부터 사용할 수 있습니다.`);
    if(!Array.isArray(h.arms_skill_ids)||h.arms_skill_ids.length>(data.rules.max_proficiencies_per_hero??1)||h.arms_skill_ids.some(id=>!arm.proficiency_ids.includes(id)))fail(`${row.name}: 병종 정통은 해당 고급 병종의 후보 중1개만 선택하세요.`);
    if(h.arms_skill_ids.length&&(data.season===1||arm.is_base||h.level<(arm.proficiency_unlock_level??40)))fail(`${row.name}: 정통은 한국 S2·S3 고급 병종에서 Lv40부터 선택하세요.`);
  }
  return army;
}
