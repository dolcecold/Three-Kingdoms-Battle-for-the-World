import {displayGuideFor} from './deck-display-guides.js';
import {createDeckGuideCards} from './deck-guide-cards.js';
const SOURCES={presets:'기존 추천덱',s2:'한국 S2 참고 편성',s3:'한국 S3 세팅'};
const stringify=x=>String(x??'').replace(/\s+/g,'').toLocaleLowerCase('ko');
const present=x=>Array.isArray(x)?x.filter(Boolean).join(' · '):String(x??'');
export function createRecommendationsView({state,h,fill,ensurePresets,presetsData,openPreset}){
  const $=id=>document.getElementById(id);
  let source='presets',season=state.season,lastEditorSeason=state.season,role='all',query='',guided=false,selection=null;
  let s2=null,s3=null;
  let loaded=false;
  const sourceButtons=[...$('rec-source').querySelectorAll('button')];
  const seasonButtons=[...$('rec-seasons').querySelectorAll('button')];
  const sourceAllowed=value=>value==='presets'||(value==='s2'&&season===2)||(value==='s3'&&season===3);
  const toRows=()=>{
    if(source==='presets')return (presetsData()?.templates??[]).filter(t=>(t.season??t.source_kr_season)===season).map(t=>({id:t.id,title:t.name,heroes:t.heroes?.map(x=>x.name)??[],sourceSeason:t.season||null,raw:t,subtitle:t.mode==='opening'?'개척용':'일반 전투'}));
    if(source==='s2')return (season===2?s2?.entries??[]:[]).map(t=>({id:t.id,title:t.heading?.split('\n')[0]||t.generals?.join(' · '),heroes:t.generals??[],raw:t,subtitle:t.source_sheet||''}));
    return (season===3?s3?.variants??[]:[]).map(t=>({id:t.id,title:t.label||t.presentation_label,heroes:t.members?.map(x=>x.general)||[],raw:t,subtitle:[t.presentation_label,t.formation].filter(Boolean).join(' · ')}));
  };
  function guideFor(row){return displayGuideFor(row.raw,{season});}
  function terms(row,guide){
    const g=guide.members.flatMap(m=>[m.name,...m.role_labels,...m.role_notes,...m.action_notes,...m.equipment_notes,...m.horse_notes,...m.stat_guides.map(s=>s.text)]);
    const raw=row.raw;
    const skills=source==='presets'?raw.heroes?.flatMap(m=>m.learned_tactics?.map(x=>x.name)||[])||[]:
      source==='s3'?raw.members?.flatMap(m=>Object.values(m.fields||{}))||[]:[];
    return stringify([row.title,...row.heroes,row.subtitle,...skills,...g].join(' '));
  }
  const allRows=()=>toRows().map(row=>({...row,guide:guideFor(row)})).filter(row=>{
    if(role!=='all'&&!row.guide.members.some(m=>m.roles.includes(role)))return false;
    if(guided&&!row.guide.has_guidance)return false;
    if(query&&!terms(row,row.guide).includes(stringify(query)))return false;
    return true;
  });
  const selectRow=rows=>{
    if(!rows.some(x=>x.id===selection))selection=rows[0]?.id||null;
    return rows.find(x=>x.id===selection)||null;
  };
  function details(row){
    const box=$('rec-detail');if(!row){fill(box,h('p',{class:'rec-guide-empty',text:'조건에 해당하는 덱이 없습니다. 필터를 조정해 주세요.'}));return;}
    const t=row.raw,common=[h('h3',{text:row.title})];
    if(source==='presets'){
      common.push(h('p',{class:'muted-note',text:`한국 S${t.season} 전용 추천덱 · ${row.subtitle} · 배틀 편집 시즌: S${state.season}`}),
        h('div',{class:'rec-roster'},...(t.heroes||[]).map(x=>h('div',{class:'rec-roster-member'},h('b',{text:x.name}),h('small',{text:present(x.learned_tactics?.map(y=>y.name))||'전법 미기재'})))),
        h('div',{class:'rec-actions'},h('button',{type:'button',class:'solid-btn',onClick:()=>openPreset(t.id),text:'내 보유 풀에서 편성하기'})));
    }else if(source==='s2'){
      common.push(h('p',{class:'muted-note',text:`${t.source_sheet||'시즌2 시트'} · 참고자료 · 실제 전후열 미검증`}),
        h('p',{class:'rec-source-description',text:'원본에 기록된 무장 순서가 실제 배치 슬롯을 의미하지 않습니다. 이 목록은 자동 편성·배틀 불러오기를 지원하지 않습니다.'}),
        h('div',{class:'rec-roster'},...(t.generals||[]).map(x=>h('span',{class:'rec-roster-member',text:x}))));
      if(t.alternative_generals?.length)common.push(h('p',{class:'rec-guide-note',text:`대안: ${t.alternative_generals.map(x=>`${x.general} → ${(x.alternatives||[]).join('/')}`).join(' · ')}`}));
    }else{
      common.push(h('p',{class:'muted-note',text:`한국 S3 참고 세팅 · ${t.formation||'진형 미기재'} · ${t.occurrence_count||1}회 기록`}),
        h('p',{class:'rec-source-description',text:'세팅별 원문을 그대로 표시합니다. 전법과 배분 수치, 선택지는 자동으로 합치지 않으며, 원문 순서를 실제 전후열로 간주하지 않습니다.'}),
        h('div',{class:'rec-roster'},...(t.members||[]).map(m=>h('div',{class:'rec-roster-member'},h('b',{text:m.general}),h('small',{text:[m.fields?.strategy_1,m.fields?.strategy_2].filter(Boolean).join(' · ')||'전법 미기재'})))));
    }
    const note=!row.guide.has_guidance&&source==='presets'?'이 시즌 추천덱에 명시된 역할·스탯 지침이 없습니다. 다른 시즌 메모는 섞어서 표시하지 않습니다.':undefined;
    common.push(createDeckGuideCards(h,row.guide,{heading:'무장별 역할과 스탯 배분',emptyText:note||'이 자료에는 해당 시즌의 역할·스탯 지침이 명시되지 않았습니다.'}));
    const url=source==='s2'?t.source_url:source==='s3'?t.evidence?.[0]?.url:null;
    if(url&&/^https:\/\/docs\.google\.com\//.test(url))common.push(h('p',{class:'rec-source-link'},h('a',{href:url,target:'_blank',rel:'noopener noreferrer',text:'원본 시트 보기 ↗'})));
    fill(box,...common);
  }
  function render(){
    if(!sourceAllowed(source)){source='presets';selection=null;}
    seasonButtons.forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.recSeason)===season)));
    sourceButtons.forEach(b=>{
      b.hidden=!sourceAllowed(b.dataset.recSource);
      b.setAttribute('aria-selected',String(b.dataset.recSource===source));
    });
    $('rec-presets-count').textContent=String((presetsData()?.templates??[]).filter(t=>(t.season??t.source_kr_season)===season).length);
    const note=source==='presets'?
      `한국 시즌${season} 추천덱만 표시합니다. 이전·이후 시즌 추천덱을 섞거나 하위 시즌 덱을 자동 포함하지 않습니다. 역할·배분 가이드도 S${season} 자료만 표시합니다.`:
      source==='s2'?'한국 시즌2 시트 참고 편성 57개. 실제 진형 배치나 전후열을 확정한 자료가 아닙니다.':
      '한국 시즌3 시트의 90개 개별 세팅. 같은 3명이라도 variant별 스탯·장비·말 가이드가 다릅니다. →는 배분 우선순위, /는 대안입니다.';
    $('rec-source-note').textContent=note;
    const rows=allRows(),selected=selectRow(rows);
    $('rec-count').textContent=`한국 S${season} · ${SOURCES[source]} · ${rows.length}개 표시${role!=='all'?' · 명시된 역할만 필터링':''}`;
    fill($('rec-list'),rows.length?rows.map(row=>h('button',{class:'rec-list-option',type:'button',role:'option','aria-selected':String(row.id===selection),dataset:{recId:row.id}},
      h('strong',{text:row.title}),h('span',{class:'rec-list-heroes',text:present(row.heroes)}),
      h('span',{class:'rec-list-tags'},
        row.guide.has_stat_guidance?h('small',{class:'rec-tag',text:'스탯 가이드'}):null,
        [...new Set(row.guide.members.flatMap(m=>m.role_labels))].map(name=>h('small',{class:'rec-tag role',text:name})),
        source==='presets'?h('small',{class:'rec-tag muted',text:`추천 S${row.sourceSeason}` }):null))):h('p',{class:'rec-guide-empty',text:'조건에 맞는 자료가 없습니다.'}));
    details(selected);
  }
  async function show(){
    if(!loaded){
      $('rec-count').textContent='추천 덱 자료를 불러오는 중입니다.';
      await ensurePresets();
      const load=async file=>{const response=await fetch(file,{cache:'no-cache'});if(!response.ok)throw new Error(`${file} 참조 파일을 불러오지 못했습니다.`);return response.json();};
      [s2,s3]=await Promise.all([load('./references/data/kr_s2_deck_references.json'),load('./references/data/kr_s3_deck_references.json')]);
      loaded=true;
    }
    if(state.season!==lastEditorSeason){
      lastEditorSeason=state.season;season=state.season;source='presets';selection=null;
    }
    render();
  }
  $('rec-seasons').addEventListener('click',e=>{
    const button=e.target.closest('[data-rec-season]');if(!button)return;
    const next=Number(button.dataset.recSeason);if(![1,2,3].includes(next))return;
    season=next;source='presets';selection=null;render();
  });
  $('rec-source').addEventListener('click',e=>{const b=e.target.closest('[data-rec-source]');if(!b||!sourceAllowed(b.dataset.recSource))return;source=b.dataset.recSource;selection=null;render();});
  $('rec-search').addEventListener('input',e=>{query=e.target.value;selection=null;render();});
  $('rec-role').addEventListener('change',e=>{role=e.target.value;selection=null;render();});
  $('rec-guided').addEventListener('change',e=>{guided=e.target.checked;selection=null;render();});
  $('rec-list').addEventListener('click',e=>{const b=e.target.closest('[data-rec-id]');if(!b)return;selection=b.dataset.recId;render();});
  $('rec-list').addEventListener('keydown',e=>{
    if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
    const btns=[...$('rec-list').querySelectorAll('[data-rec-id]')];if(!btns.length)return;
    e.preventDefault();const i=btns.indexOf(document.activeElement);
    const j=e.key==='Home'?0:e.key==='End'?btns.length-1:Math.max(0,Math.min(btns.length-1,i+(e.key==='ArrowDown'?1:-1)));
    btns[j].click();btns[j].focus();
  });
  return {show};
}
