/** Public item selection and displayed stats only. Combat runs on the server. */
const SLOTS=['weapon','armor','treasure','horse'];
const ATTRS=['might','intelligence','defence','speed'];
const id=value=>Number.isInteger(value)&&value>0;
const lookup=(rows,ident)=>rows?.find(r=>r.id===ident||(r.alias_ids??[]).includes(ident));

export function itemChoices(data,slot){
  if(!SLOTS.includes(slot))throw new Error('장비·말 슬롯을 확인하세요.');
  return (slot==='horse'?data.horses:data.equipment).filter(r=>r.kind===slot);
}

/** A unique option with no item selected remains visible, with selectable=false. */
export function itemOptionChoices(data,{slot,category,itemId=null,heroId=null}){
  if(!SLOTS.includes(slot)||!['skill','effect'].includes(category))throw new Error('특기·특효 종류를 확인하세요.');
  if(itemId!=null&&!itemChoices(data,slot).some(r=>r.id===itemId))throw new Error('아이템 ID와 슬롯 종류가 다릅니다.');
  return (data[category==='skill'?'item_skills':'item_effects']??[])
    .filter(r=>r.kind===slot&&(itemId==null||!r.allowed_item_ids.length||r.allowed_item_ids.includes(itemId)))
    .map(r=>({...r,active_for_hero:!r.allowed_hero_ids.length||r.allowed_hero_ids.includes(heroId),
      requires_item_choice:!!r.allowed_item_ids.length&&itemId==null,
      selectable:!r.allowed_item_ids.length||r.allowed_item_ids.includes(itemId)}));
}

/** Hero mismatch is legal equipment, but the dedicated effect stays inactive. */
export function validateItemLoadout(data,hero){
  const entries=hero.equipment_loadout??[];
  if(!Array.isArray(entries)||entries.length>3||entries.some(e=>!e||!SLOTS.slice(0,3).includes(e.slot))||new Set(entries.map(e=>e.slot)).size!==entries.length)throw new Error('무기·갑옷·보물은 슬롯별로1개만 선택하세요.');
  if(hero.permanent_item_stats_included!=null&&typeof hero.permanent_item_stats_included!=='boolean')throw new Error('고정 특효 스탯 포함 여부는 true/false/null로 입력하세요.');
  const selected=[];
  for(const [slot,entry] of [...entries.map(e=>[e.slot,e]),...(hero.horse_loadout==null?[]:[['horse',hero.horse_loadout]])]){
    if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error('장비·말 선택값을 확인하세요.');
    if(entry.item_id!=null&&(!id(entry.item_id)||!itemChoices(data,slot).some(r=>r.id===entry.item_id)))throw new Error('아이템 ID와 슬롯 종류가 다릅니다.');
    for(const [key,category] of [['skill_id','item_skills'],['effect_id','item_effects']]){
      if(entry[key]==null)continue;
      const row=lookup(data[category],entry[key]);
      if(!id(entry[key])||!row||row.kind!==slot)throw new Error('해당 슬롯에서 선택할 수 없는 특기·특효 ID입니다.');
      if(row.allowed_item_ids.length&&!row.allowed_item_ids.includes(entry.item_id))throw new Error(`${row.name}: 전용 아이템을 함께 선택하세요.`);
      selected.push({...row,category,slot,active_for_hero:!row.allowed_hero_ids.length||row.allowed_hero_ids.includes(hero.hero_id)});
    }
  }
  return selected;
}

/** Return an editable copy; null removes the whole slot. Validate the full army before encoding. */
export function withItemLoadout(data,hero,slot,selection){
  if(!SLOTS.includes(slot))throw new Error('장비·말 슬롯을 확인하세요.');
  const copy=structuredClone(hero);
  if(slot==='horse')copy.horse_loadout=selection==null?null:{...selection};
  else copy.equipment_loadout=[...(copy.equipment_loadout??[]).filter(e=>e.slot!==slot),...(selection==null?[]:[{...selection,slot}])];
  validateItemLoadout(data,copy);
  return copy;
}

/** Fixed displayed bonuses only; no timed buffs or battle calculations. */
export function permanentItemStats(data,hero){
  const selected=validateItemLoadout(data,hero),out=Object.fromEntries(ATTRS.map(k=>[k,0]));
  if(hero.permanent_item_stats_included??(hero.total_stats!=null))return out;
  for(const row of selected)if(row.active_for_hero)for(const key of ATTRS)out[key]+=row.attribute_bonuses?.[key]??0;
  return out;
}
