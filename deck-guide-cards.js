/* 한국 시즌/세팅별 원문 표시 전용. 전투 입력값이나 추천 배분을 변경하지 않는다. */
import {DECK_ROLE_LABELS} from './deck-display-guides.js';
const STATS={might:'무력',intelligence:'지력',defence:'통솔',speed:'선공'};
const txt=(s)=>typeof s==='string'?s:String(s??'');
const attrGroup=g=>(Array.isArray(g)?g:[]).map(s=>STATS[s]||s).join(' / ');
function statsView(h,stat){
  const p=(stat.priority_groups||[]).filter(x=>Array.isArray(x)&&x.length);
  const el=h('div',{class:'rec-stat-guide'},h('div',{class:'rec-stat-label',text:'스탯 배분 가이드'}));
  if(p.length&&['single_focus','ordered','alternatives'].includes(stat.mode)){
    const path=[];
    for(let i=0;i<p.length;i++){
      if(i)path.push(h('span',{class:'rec-stat-arrow','aria-hidden':'true',text:stat.mode==='alternatives'?' / ':'→'}));
      path.push(h('span',{class:'rec-stat-chip',text:attrGroup(p[i])+(stat.mode==='single_focus'?' 위주':'')}));
    }
    el.append(h('div',{class:'rec-stat-path'},...path));
  }
  el.append(h('p',{class:'rec-original-note',text:stat.text}));
  return el;
}
export function createDeckGuideCards(h,guide,{heading='역할·스탯 가이드',emptyText='역할·스탯 가이드가 제공되지 않았습니다.',compact=false}={}){
  const members=guide?.members||[];
  const guided=members.some(m=>m.has_guidance);
  const root=h('section',{class:'rec-guide-block'},h('div',{class:'rec-guide-heading'},h('h4',{text:heading}),h('small',{text:`한국 S${guide?.season||'?'} · 원문 근거 표시`})));
  if(!members.length){root.append(h('p',{class:'rec-guide-empty',text:emptyText}));return root;}
  if(!guided){root.append(h('p',{class:'rec-guide-empty',text:emptyText}));return root;}
  const grid=h('div',{class:'rec-guide-cards'+(compact?' is-compact':'')});
  for(const m of members){
    const card=h('section',{class:'rec-hero-guide'+(m.has_guidance?'':' no-guide')},
      h('header',{class:'rec-hero-head'},
        h('strong',{text:m.name|| (m.hero_id==null?'미확정 무장':`무장 #${m.hero_id}`)}),
        h('div',{class:'rec-roles'},m.roles.length?m.roles.map(r=>h('span',{class:`rec-role role-${r}`,text:DECK_ROLE_LABELS[r]||r})):h('span',{class:'rec-role role-unknown',text:'역할 미기재'}))));
    for(const note of m.role_notes||[])card.append(h('p',{class:'rec-guide-note',text:note}));
    for(const note of m.action_notes||[])card.append(h('p',{class:'rec-guide-note rec-action-note'},h('b',{text:'운용 · '}),txt(note)));
    if(m.stat_guides?.length){for(const g of m.stat_guides)card.append(statsView(h,g));}
    else card.append(h('p',{class:'rec-guide-missing',text:'배분 가이드 없음'}));
    for(const note of m.equipment_notes||[])card.append(h('p',{class:'rec-gear-note'},h('b',{text:'장비 · '}),txt(note)));
    for(const note of m.horse_notes||[])card.append(h('p',{class:'rec-gear-note'},h('b',{text:'말 · '}),txt(note)));
    grid.append(card);
  }
  root.append(grid,h('p',{class:'rec-reference-disclaimer',text:'역할·스탯 문구는 해당 원본 세팅의 참고 정보입니다. 자동 스탯 배분·전투 계산에 적용되지 않으며, 미기재 역할은 추정하지 않습니다.'}));
  return root;
}
