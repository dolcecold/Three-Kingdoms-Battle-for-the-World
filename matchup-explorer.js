/** 한국 S3 세팅별 상성 메모만 사용합니다. 카테고리 이름으로 개별 덱의 상성을 추론하지 않습니다. */
const normalize=s=>String(s??'').replace(/\s+/g,'').toLocaleLowerCase('ko');
export const familyName=variant=>String(variant?.label||'').split(' · ')[0].trim();
const RELATIONS=['good','bad','even'];
export function directMatchups(id,items){return items?.[id]||null;}
/** 선택 덱 이름을 명시적으로 언급하는 다른 세팅의 상성 기록. '주의'는 승패로 해석하지 않습니다. */
export function mentionsOfDeck(variant,variants,items){
  const name=normalize(familyName(variant));
  if(name.length<3)return [];
  const found=[];
  for(const other of variants||[]){
    if(other.id===variant.id)continue;
    const entry=items?.[other.id];if(!entry)continue;
    for(const type of RELATIONS){
      for(const statement of entry[type]||[]){
        if(!normalize(statement.target).includes(name))continue;
        found.push({variant:other,relation:type,target:statement.target,condition:statement.condition||'',source:entry.source||''});
      }
    }
    for(const caution of entry.caution||[]){
      if(normalize(caution).includes(name))found.push({variant:other,relation:'caution',target:String(caution),condition:'',source:entry.source||''});
    }
  }
  return found;
}
export function matchupTargets(items){
  const groups=new Map();
  for(const [id,item] of Object.entries(items||{}))for(const stmt of item.good||[]){
    const target=String(stmt.target||'').trim();const key=normalize(target);
    if(!key)continue;
    if(!groups.has(key))groups.set(key,{key,target,ids:new Set()});
    groups.get(key).ids.add(id);
  }
  return [...groups.values()].map(x=>({key:x.key,target:x.target,count:x.ids.size})).sort((a,b)=>b.count-a.count||a.target.localeCompare(b.target,'ko'));
}
/** 원문에 동일하게 표기된 상대 유형을 이긴다고 명시된 세팅만 수집. */
export function countersForTarget(target,variants,items){
  const wanted=normalize(target);if(!wanted)return [];
  return (variants||[]).flatMap(v=>(items?.[v.id]?.good||[]).filter(x=>normalize(x.target)===wanted)
    .map(x=>({variant:v,target:x.target,condition:x.condition||'',source:items[v.id].source||''})));
}
