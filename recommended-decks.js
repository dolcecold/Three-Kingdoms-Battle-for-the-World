/** Read archived presets and return editable public ArmyConfig values. */
import {normalizeArmy} from './army-code.js';
import {validateArmy} from './editor.js';

export async function loadRecommendedDecks(url='./data/recommended-decks.json',{fetchImpl=globalThis.fetch}={}){
  const response=await fetchImpl(url);if(!response.ok)throw new Error('추천덱 자료를 불러오지 못했습니다.');
  const data=await response.json();
  if(!['1.0.0','1.1.0'].includes(data.schema_version)||!Array.isArray(data.templates))throw new Error('지원하지 않는 추천덱 데이터 형식입니다.');
  return data;
}
export function templateAvailability(template,season,editor){
  const entry=template.availability[String(season)];
  if(!entry?.can_import||!template.army)return {can_import:false,reason:entry?.reason||'현재 시즌에 불러올 수 없는 자료입니다.'};
  if(editor){try{validateArmy(editor,normalizeArmy(template.army));}catch(error){return {can_import:false,reason:error.message};}}
  return {can_import:true,source_recommendation:template.source_kr_season===season,carried_forward:template.source_kr_season!==season};
}
export function filterRecommendedDecks(data,{season,editor,source='google_sheet_archive',query='',includeBlocked=false}={}){
  const q=query.replace(/\s/g,'').toLowerCase();
  return data.templates.filter(t=>{
    if(source!=='all'&&t.source.kind!==source)return false;
    if(!includeBlocked&&!templateAvailability(t,season,editor).can_import)return false;
    const searchable=[t.id,t.name,...t.aliases,...t.heroes.flatMap(h=>[h.raw_name,h.name,...h.learned_tactics.map(s=>s.name||s.raw_name),...h.tactic_candidates.map(s=>s.name||s.raw_name)])].filter(Boolean).join(' ').replace(/\s/g,'').toLowerCase();
    return !q||searchable.includes(q);
  }).sort((a,b)=>Number(b.source_kr_season===season)-Number(a.source_kr_season===season));
}
export function armyFromRecommendedDeck(template,season,editor){
  const availability=templateAvailability(template,season,editor);
  if(!availability.can_import)throw new Error(availability.reason);
  return normalizeArmy(structuredClone(template.army));
}
