/** Korean presets: selection and editable army restoration. */
import {normalizeArmy} from './army-code.js';
import {validateArmy} from './editor.js';
import {displayGuideFor} from './deck-display-guides.js';
export {displayGuideFor} from './deck-display-guides.js';

export async function loadRecommendedDecks(url='./data/recommended-decks.json',{fetchImpl=globalThis.fetch}={}){
  const response=await fetchImpl(url,{cache:'no-cache'});if(!response.ok)throw new Error('추천덱 자료를 불러오지 못했습니다.');
  const data=await response.json();
  if(!['1.0.0','1.1.0','2.0.0','2.1.0'].includes(data.schema_version)||!Array.isArray(data.templates))throw new Error('지원하지 않는 추천덱 데이터 형식입니다.');
  return data;
}
export function templateAvailability(template,season,editor){
  const entry=template.availability?.[String(season)];
  const enabled=template.available_seasons?.includes(season)??entry?.can_import;
  if(!enabled||!template.army)return {can_import:false,reason:'현재 한국 시즌에서 사용할 수 없는 편성입니다.'};
  if(editor){try{validateArmy(editor,normalizeArmy(template.army));}catch(error){return {can_import:false,reason:error.message};}}
  const initial=template.season??template.source_kr_season;
  return {can_import:true,source_recommendation:initial===season,carried_forward:initial!==season};
}
export function filterRecommendedDecks(data,{season,editor,source,query='',mode='combat',includeBlocked=false,role=null}={}){
  const q=query.replace(/\s/g,'').toLowerCase();
  return data.templates.filter(t=>{
    if(!data.schema_version.startsWith('2.')&&source&&source!=='all'&&t.source?.kind!==source)return false;
    if(mode!=='all'&&(t.mode??t.scope??'combat')!==mode)return false;
    if(!includeBlocked&&!templateAvailability(t,season,editor).can_import)return false;
    const display=displayGuideFor(t,{season:season??3});
    if(role&&!display.members.some(m=>m.roles.includes(role)))return false;
    const searchable=[t.name,...(t.aliases??[]),...(t.heroes??[]).flatMap(h=>[h.name,...(h.learned_tactics??[]).map(s=>s.name)]),...display.members.flatMap(m=>[...m.role_labels,...m.role_notes,...m.action_notes,...m.stat_guides.map(s=>s.text)])].filter(Boolean).join(' ').replace(/\s/g,'').toLowerCase();
    return !q||searchable.includes(q);
  }).sort((a,b)=>Number((b.season??b.source_kr_season)===season)-Number((a.season??a.source_kr_season)===season));
}
export function armyFromRecommendedDeck(template,season,editor){
  const availability=templateAvailability(template,season,editor);
  if(!availability.can_import)throw new Error(availability.reason);
  return normalizeArmy(structuredClone(template.army));
}
