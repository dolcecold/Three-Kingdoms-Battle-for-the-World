/** Static Korean guide helpers. No combat calculations or new API endpoints. */
import {normalizeArmy} from './army-code.js';
import {validateArmy} from './editor.js';

const searchKey=value=>String(value??'').replace(/\s/g,'').toLowerCase();
const rowsById=rows=>new Map(rows.map(row=>[row.id,row]));
const hasOwn=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
function integer(value,min,max,label){
  if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${label}: ${min}~${max} 사이의 정수를 입력하세요.`);
  return value;
}
function ownedSet(ids){
  if(ids==null)return null;
  if(!Array.isArray(ids)||ids.some(id=>!Number.isInteger(id)||id<=0))throw new Error('보유 무장 ID 목록을 확인하세요.');
  return new Set(ids);
}
function resolveDeck(content,deckOrId){
  const deck=content.opening_decks.find(d=>d.id===(typeof deckOrId==='string'?deckOrId:deckOrId?.id));
  if(!deck)throw new Error('개척 가이드를 찾을 수 없습니다.');
  return deck;
}
function validateContent(content){
  if(!['1.0.0','1.1.0','1.2.0'].includes(content?.schema_version)||content.region!=='KR'||!Array.isArray(content.seasons)||
      !Array.isArray(content.menus)||!Array.isArray(content.articles)||!Array.isArray(content.opening_decks)||
      !Array.isArray(content.coexistence_plans)||!Array.isArray(content.stat_notes)||!Array.isArray(content.glossary)||
      typeof content.catalog_data_version!=='string'||typeof content.content_version!=='string'){
    throw new Error('지원하지 않는 가이드 데이터 형식입니다.');
  }
  if(['1.1.0','1.2.0'].includes(content.schema_version)&&['romance_stages','romance_options','romance_skills','profession_profiles','equipment_options'].some(key=>!Array.isArray(content[key]))){
    throw new Error('확장 가이드의 연의·직업·장비 목록이 누락되었습니다.');
  }
  return content;
}

export async function loadGuideContent(url=new URL('./data/guide-content.json',import.meta.url),{fetchImpl=globalThis.fetch}={}){
  const response=await fetchImpl(url,{cache:'no-cache'});
  if(!response.ok)throw new Error('가이드를 불러오지 못했습니다.');
  return validateContent(await response.json());
}

/** A version mismatch allows reading, but blocks creating a draft with stale IDs. */
export function guideCompatibility(content,editor){
  const season_supported=editor?.region==='KR'&&content.seasons.includes(editor?.season);
  const catalog_matches=typeof editor?.data_version==='string'&&editor.data_version===content.catalog_data_version;
  return {season_supported,catalog_matches,can_import:season_supported&&catalog_matches};
}
function requireCatalog(content,editor){
  const compatibility=guideCompatibility(content,editor);
  if(!compatibility.season_supported)throw new Error('이 가이드는 한국 시즌3 편성 목록을 사용합니다.');
  if(!compatibility.catalog_matches)throw new Error('가이드와 편성 데이터 버전이 다릅니다. 최신 메타데이터를 함께 적용하세요.');
}

export function filterGuideArticles(content,{category=null,season=3,query=''}={}){
  const q=searchKey(query);
  return content.articles.filter(a=>a.seasons.includes(season)&&(!category||a.category===category)&&
    (!q||searchKey([a.title,a.summary,...a.blocks.flatMap(b=>[
      b.text??'',...(b.items??[]).map(i=>typeof i==='string'?i:i.text),...(b.rows??[]).flat()
    ])].join(' ')).includes(q)));
}

/** Korean season3 Romance branch filters; combat runs on the backend. */
export function filterRomanceOptions(content,{heroId=null,stageId=null,ownedHeroIds=null,onlyOwned=false,query=''}={}){
  const owned=ownedSet(ownedHeroIds),q=searchKey(query);
  const skillMap=rowsById(content.romance_skills??[]);
  if(heroId!==null)integer(heroId,1,99999999,'무장 ID');
  if(stageId!==null)integer(stageId,1,3,'연의 선택 그룹');
  if(onlyOwned&&owned===null)throw new Error('보유 무장 필터에 ID 목록을 입력하세요.');
  return (content.romance_options??[]).filter(r=>(heroId===null||r.base_hero.id===heroId)&&
    (stageId===null||r.stage_id===stageId)&&(!onlyOwned||owned.has(r.base_hero.id))&&
    (!q||searchKey([r.base_hero.name,r.title,r.arms.name,...r.skill_option_ids.flatMap(id=>{
      const s=skillMap.get(id);return s?[s.name,s.description]:[];
    }),
      ...r.linked_warbooks.flatMap(b=>[b.name,b.description])].join(' ')).includes(q)));
}

/** Trait IDs (1..12) map to HeroConfig.romance_trait_id, never to hero IDs. */
export function reviewRomanceChoices(content,traitIds){
  if(!content.romance_stages?.length||!content.romance_options?.length)throw new Error('연의 목록이 포함된 가이드 v1.1.0 이상을 사용하세요.');
  if(!Array.isArray(traitIds)||traitIds.some(id=>!Number.isInteger(id)||id<=0))throw new Error('연의 분기 ID 목록을 확인하세요.');
  const optionByTrait=new Map((content.romance_options??[]).map(o=>[o.trait_id,o]));
  const errors=[],selected=[];
  const seen=new Set();
  for(const id of traitIds){
    if(seen.has(id)){errors.push(`분기 ${id}가 중복되었습니다.`);continue;}
    seen.add(id);
    const row=optionByTrait.get(id);
    if(!row){errors.push(`분기 ${id}를 찾을 수 없습니다.`);continue;}
    selected.push(row);
  }
  for(const stage of content.romance_stages??[]){
    if(selected.filter(o=>o.stage_id===stage.id).length>stage.reference_max_selected){
      errors.push(`${stage.name}: 한국 시즌3 연의 선택 기준은 ${stage.reference_max_selected}명·1분기 선택입니다.`);
    }
  }
  const missing_stage_ids=(content.romance_stages??[]).filter(s=>!selected.some(o=>o.stage_id===s.id)).map(s=>s.id);
  return {valid_reference_plan:errors.length===0,complete:errors.length===0&&missing_stage_ids.length===0,
    selected_trait_ids:selected.map(o=>o.trait_id),missing_stage_ids,errors,
    kr_season3_unlocked:true,simulation_supported:true};
}

export function filterEquipmentOptions(content,{slotType=null,kind=null,dedicated=null,query=''}={}){
  if(slotType!==null&&!['equipment','horse'].includes(slotType))throw new Error('장비 또는 말을 선택하세요.');
  if(kind!==null&&!['trait','effect'].includes(kind))throw new Error('특기 또는 특효를 선택하세요.');
  if(dedicated!==null&&typeof dedicated!=='boolean')throw new Error('전용 옵션 필터를 확인하세요.');
  const q=searchKey(query);
  return (content.equipment_options??[]).filter(r=>(slotType===null||r.slot_type===slotType)&&
    (kind===null||r.kind===kind)&&(dedicated===null||r.dedicated===dedicated)&&
    (!q||searchKey(r.name+' '+r.description).includes(q)));
}

export function filterProfessionProfiles(content,{query=''}={}){
  const q=searchKey(query);
  return (content.profession_profiles??[]).filter(r=>!q||searchKey([r.name,r.role,...r.focus,r.cooperation].join(' ')).includes(q));
}

export function openingAvailability(content,deckOrId,editor,{level=null,ownedHeroIds=null}={}){
  const deck=resolveDeck(content,deckOrId),owned=ownedSet(ownedHeroIds);
  if(level!==null)integer(level,0,50,'가이드 조회 레벨');
  const heroMap=rowsById(editor?.heroes??[]);
  const missing_catalog_hero_ids=deck.heroes.filter(h=>!heroMap.has(h.id)).map(h=>h.id);
  const missing_owned_hero_ids=owned===null?null:deck.heroes.filter(h=>!owned.has(h.id)).map(h=>h.id);
  const unimplemented_innate_hero_ids=deck.heroes.filter(h=>heroMap.get(h.id)?.innate?.effect_status==='not_implemented').map(h=>h.id);
  const compatibility=guideCompatibility(content,editor);
  return {...compatibility,
    within_reference_range:level===null?null:level>=deck.level_range.min&&level<=deck.level_range.max,
    missing_catalog_hero_ids,missing_owned_hero_ids,unimplemented_innate_hero_ids,
    can_create_draft:compatibility.can_import&&missing_catalog_hero_ids.length===0};
}

export function filterOpeningDecks(content,{season=3,level=null,ownedHeroIds=null,onlyOwned=false,query=''}={}){
  const owned=ownedSet(ownedHeroIds),q=searchKey(query);
  if(level!==null)integer(level,0,50,'가이드 조회 레벨');
  if(onlyOwned&&owned===null)throw new Error('보유 무장 필터를 사용하려면 ID 목록을 입력하세요.');
  return content.opening_decks.filter(d=>d.seasons.includes(season)&&
    (level===null||level>=d.level_range.min&&level<=d.level_range.max)&&
    (!onlyOwned||d.heroes.every(h=>owned.has(h.id)))&&
    (!q||searchKey([d.name,...d.heroes.map(h=>h.name)].join(' ')).includes(q)));
}

/**
 * Import hero IDs, or the explicitly chosen opening preset's learned tactic IDs.
 * Actual level/troops/skill levels are required; no Lv50/10,000-troop preset defaults.
 * heroInputs: [{hero_id,level,troops,innate_level,learned_levels:{[skill_id]:level}}]
 * Books, proficiency, progression and gear are deliberately empty initial inputs.
 */
export function armyFromOpeningDeck(content,deckOrId,editor,{
  heroInputs,formationId,supply,templateId=null,recommendedDecks=null,name=null
}={}){
  requireCatalog(content,editor);
  const deck=resolveDeck(content,deckOrId);
  if(!Array.isArray(heroInputs)||heroInputs.length!==3||new Set(heroInputs.map(h=>h?.hero_id)).size!==3||
      deck.heroes.some(h=>!heroInputs.some(input=>input.hero_id===h.id))){
    throw new Error('개척 조합의 무장 3명에 대한 실제 레벨·병력·고유 전법 레벨을 입력하세요.');
  }
  let template=null;
  if(templateId!==null){
    if(!deck.tactic_template_ids.includes(templateId)||recommendedDecks?.data_version!==editor.data_version){
      throw new Error('이 개척 조합에 연결된 최신 전법 초안을 선택하세요.');
    }
    template=recommendedDecks.templates?.find(t=>t.id===templateId);
    const ids=template?.army?.heroes?.map(h=>h.hero_id)??[];
    if(template?.mode!=='opening'||!template.available_seasons?.includes(editor.season)||ids.length!==3||
        deck.heroes.some(h=>!ids.includes(h.id)))throw new Error('선택한 개척 전법 초안을 사용할 수 없습니다.');
  }
  const army=normalizeArmy({name:name??deck.name,formation_id:formationId??template?.army.formation_id,
    supply:integer(supply,0,100,'실제 보급'),heroes:deck.heroes.map((h,index)=>{
      const input=heroInputs.find(i=>i.hero_id===h.id);
      const presetHero=template?.army.heroes.find(i=>i.hero_id===h.id);
      return {hero_id:h.id,slot:presetHero?.slot??index+1,
        level:integer(input.level,1,50,`${h.name} 실제 레벨`),
        troops:integer(input.troops,1,50000,`${h.name} 실제 병력`),breakthrough:0,promotion:0,
        innate:{level:integer(input.innate_level,1,10,`${h.name} 고유 전법 레벨`),grade:0},
        learned:(presetHero?.learned??[]).map(s=>({skill_id:s.skill_id,
          level:integer(input.learned_levels?.[s.skill_id],1,10,`${h.name} 학습 전법 ${s.skill_id} 레벨`),
          breakthrough:0,grade:0}))};
    })});
  return validateArmy(editor,army);
}

/** Sort by shared hero count only; this is not a strength or transition-cost score. */
export function findCombatTransitions(content,deckOrId,recommendedDecks,editor,{minSharedHeroes=1}={}){
  requireCatalog(content,editor);
  integer(minSharedHeroes,1,3,'겹치는 무장 수');
  if(recommendedDecks?.data_version!==editor.data_version)throw new Error('추천덱과 편성 데이터 버전이 다릅니다.');
  const ids=new Set(resolveDeck(content,deckOrId).heroes.map(h=>h.id));
  const available=new Set(editor.heroes.map(h=>h.id));
  return recommendedDecks.templates.filter(t=>t.mode==='combat'&&t.available_seasons.includes(editor.season)&&
    t.heroes.every(h=>available.has(h.id))).map(template=>{
      const shared_hero_ids=template.heroes.filter(h=>ids.has(h.id)).map(h=>h.id);
      return {template,shared_hero_ids,shared_count:shared_hero_ids.length,
        new_hero_ids:template.heroes.filter(h=>!ids.has(h.id)).map(h=>h.id)};
    }).filter(row=>row.shared_count>=minSharedHeroes)
    .sort((a,b)=>b.shared_count-a.shared_count||a.template.name.localeCompare(b.template.name,'ko'));
}

export function planAvailability(content,planId,editor,{ownedHeroIds=null}={}){
  const plan=content.coexistence_plans.find(p=>p.id===planId);
  if(!plan)throw new Error('부대 구성안을 찾을 수 없습니다.');
  const available=new Set(editor?.heroes?.map(h=>h.id)??[]),owned=ownedSet(ownedHeroIds);
  const ids=[...new Set(plan.teams.flatMap(t=>t.heroes.map(h=>h.id)))];
  return {...guideCompatibility(content,editor),hero_count:ids.length,
    missing_catalog_hero_ids:ids.filter(id=>!available.has(id)),
    missing_owned_hero_ids:owned===null?null:ids.filter(id=>!owned.has(id))};
}

/**
 * Review learned-tactic usage across armies. max_per_army stays a per-army rule.
 * Missing owned-copy counts mean unknown, never zero or one.
 */
export function reviewArmyCoexistence(armies,editor,{ownedTacticCopies=null}={}){
  if(!Array.isArray(armies)||armies.length<1)throw new Error('검토할 편성을 선택하세요.');
  const heroUse=new Map(),tacticUse=new Map(),invalid_armies=[];
  armies.forEach((army,index)=>{
    try{validateArmy(editor,army);}catch(error){invalid_armies.push({army_index:index,message:error.message});}
    for(const h of army.heroes??[]){
      const use=heroUse.get(h.hero_id)??[];use.push(index);heroUse.set(h.hero_id,use);
      for(const s of h.learned??[]){
        const usage=tacticUse.get(s.skill_id)??[];usage.push({army_index:index,hero_id:h.hero_id});
        tacticUse.set(s.skill_id,usage);
      }
    }
  });
  const tacticMap=rowsById(editor.tactics);
  const tactic_usage=[...tacticUse].map(([id,usage])=>{
    const owned_copies=ownedTacticCopies!==null&&hasOwn(ownedTacticCopies,id)?
      integer(ownedTacticCopies[id],0,9999,'전법 보유 수량'):null;
    return {id,name:tacticMap.get(id)?.name??String(id),uses:usage.length,usage,owned_copies,
      copy_shortage:owned_copies===null?null:Math.max(0,usage.length-owned_copies)};
  });
  return {invalid_armies,
    duplicate_heroes:[...heroUse].filter(([,uses])=>uses.length>1).map(([hero_id,army_indexes])=>({hero_id,army_indexes})),
    shared_tactics:tactic_usage.filter(row=>new Set(row.usage.map(u=>u.army_index)).size>1),
    tactic_usage};
}

export function filterStatNotes(content,{heroIds=null,query=''}={}){
  const ids=ownedSet(heroIds),q=searchKey(query);
  return content.stat_notes.filter(row=>(ids===null||row.heroes.every(h=>ids.has(h.id)))&&
    (!q||searchKey([row.title,...row.notes.flatMap(n=>[n.name,n.allocation_note,n.role_note])].join(' ')).includes(q)));
}

export function filterGlossary(content,{query='',tag=null}={}){
  const q=searchKey(query);
  return content.glossary.filter(row=>(!tag||row.tags.includes(tag))&&
    (!q||searchKey(row.name+' '+row.description).includes(q)));
}
