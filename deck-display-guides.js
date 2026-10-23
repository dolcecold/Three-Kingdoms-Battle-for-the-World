/** Display-only source notes. Does not allocate attributes or change an army. */
export const DECK_ROLE_LABELS=Object.freeze({damage:'딜러',tank:'탱커',healer:'힐러',support:'보조'});
const unique=rows=>[...new Set(rows.filter(Boolean))];

/** Works with a recommended template, KR S3 setup, or KR S2 reference entry. */
export function displayGuideFor(deck,{season=3}={}){
  if(![1,2,3].includes(season))throw new Error('한국 시즌1·2·3을 선택하세요.');
  const members=(deck?.display_guide?.members??[]).map(row=>{
    const entries=structuredClone((row.entries??[]).filter(e=>e.seasons.includes(season)));
    const roles=unique(entries.flatMap(e=>e.roles));
    const result={hero_id:row.hero_id,name:row.hero_name,roles,
      role_labels:roles.map(role=>DECK_ROLE_LABELS[role]),
      role_notes:unique(entries.map(e=>e.role_note)),
      action_notes:unique(entries.map(e=>e.action_note)),
      stat_guides:entries.filter(e=>e.stat_guide).map(e=>({...e.stat_guide,source:e.source})),
      equipment_notes:unique(entries.map(e=>e.equipment_note)),
      horse_notes:unique(entries.map(e=>e.horse_note)),
      sources:entries.map(e=>e.source)};
    result.has_guidance=!!(roles.length||result.role_notes.length||result.action_notes.length||result.stat_guides.length||result.equipment_notes.length||result.horse_notes.length);
    return result;
  });
  return {usage:'display_only',season,members,
    has_role_guidance:members.some(m=>m.roles.length),
    has_stat_guidance:members.some(m=>m.stat_guides.length),
    has_guidance:members.some(m=>m.has_guidance)};
}
