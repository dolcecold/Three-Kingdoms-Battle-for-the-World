/* 가이드 메뉴 — guide-content.js(정적 가이드 SDK)를 화면에 그립니다.
 * 전투 계산은 하지 않으며, 편성 가져오기는 기존 편성·전투 흐름으로 넘깁니다. */
import * as G from './guide-content.js';

export async function createGuideView(ctx){
  const {h,fill,notify,state,store}=ctx;
  const $=id=>document.getElementById(id);
  const content=await G.loadGuideContent(new URL('./data/guide-content.json',import.meta.url));
  const articles=new Map(content.articles.map(a=>[a.id,a]));
  const menuOf=new Map(content.menus.flatMap(m=>m.article_ids.map(id=>[id,m])));
  let current={menu:null,article:null};

  $('guide-scope').textContent=content.scope_note;
  $('guide-search').oninput=()=>renderNav();

  const owned=()=>{const ids=ctx.poolHeroIds();return ids?new Set(ids):null;};
  const heroChip=(hero,set=owned())=>h('span',{class:'hero-chip'+(set==null?'':set.has(hero.id)?' own':' miss'),title:set==null?'':set.has(hero.id)?'보유':'미보유',text:hero.name});
  const table=(columns,rows)=>h('div',{class:'table-wrap'},h('table',null,
    h('thead',null,h('tr',null,columns.map(c=>h('th',{scope:'col',text:c})))),
    h('tbody',null,rows.map(r=>h('tr',null,r.map(c=>h('td',null,c)))))));
  const badge=(text,cls='')=>h('span',{class:`tag ${cls}`,text});
  const presetLinks=ids=>ids.length?h('span',{class:'link-row'},ids.map((id,i)=>h('button',{type:'button',class:'text-link',onclick:async()=>{await ctx.ensurePresets();ctx.openPreset(id);},text:ids.length>1?`${i+1}안`:'추천덱 보기'}))):null;

  /* ── 목차 ── */
  function renderNav(){
    const q=$('guide-search').value.trim();
    const link=a=>h('a',{href:`#/guides/${menuOf.get(a.id)?.id}/${a.id}`,'aria-current':a.id===current.article?'page':'false',text:a.title});
    if(q){
      const hits=G.filterGuideArticles(content,{season:3,query:q});
      fill($('guide-nav'),h('p',{class:'nav-group',text:`검색 결과 ${hits.length}개`}),h('ul',null,hits.map(a=>h('li',null,link(a)))));
      return;
    }
    fill($('guide-nav'),content.menus.map(m=>h('div',{class:'nav-menu'+(m.id===current.menu?' open':'')},
      h('a',{class:'nav-group',href:`#/guides/${m.id}`,text:m.label}),
      h('ul',null,m.article_ids.map(id=>articles.get(id)).filter(Boolean).map(a=>h('li',null,link(a)))))));
  }

  /* ── 본문 ── */
  async function show(parts){
    const menu=content.menus.find(m=>m.id===parts[0])||content.menus[0];
    const articleId=parts[1]&&menu.article_ids.includes(parts[1])?parts[1]:menu.article_ids[0];
    current={menu:menu.id,article:articleId};
    renderNav();
    const a=articles.get(articleId);
    if(!a){fill($('guide-body'),h('p',{class:'empty-box',text:'글을 찾을 수 없습니다. 목차에서 다른 글을 골라 주세요.'}));return;}
    const idx=menu.article_ids.indexOf(articleId);
    const nav=(id,label)=>id?h('a',{class:'ghost-btn small',href:`#/guides/${menu.id}/${id}`,text:`${label} ${articles.get(id)?.title||''}`}):h('span');
    fill($('guide-body'),
      h('p',{class:'crumb',text:menu.label}),
      h('h2',{text:a.title}),
      a.summary?h('p',{class:'lead',text:a.summary}):null,
      state.season!==3?h('div',{class:'season-note'},'가이드는 한국 시즌3 기준입니다. 지금은 한국 S',String(state.season),'를 편집 중이라 개척 편성 가져오기가 막혀 있습니다. ',
        h('button',{type:'button',class:'ghost-btn small',onclick:async()=>{await ctx.switchSeason(3);show(parts);},text:'한국 S3로 전환'})):null,
      a.blocks.map(b=>renderBlock(b,a)),
      h('div',{class:'article-nav'},nav(menu.article_ids[idx-1],'←'),nav(menu.article_ids[idx+1],'→')));
    window.scrollTo({top:0});
  }

  function renderBlock(b,article){
    try{
      switch(b.type){
        case 'paragraph':return h('p',{text:b.text});
        case 'bullets':return h('ul',{class:'bullets'},b.items.map(t=>h('li',{text:t})));
        case 'checklist':return checklist(b,article);
        case 'table':return table(b.columns,b.rows);
        case 'action':return b.action==='browse_combat_presets'?h('p',null,h('a',{class:'solid-btn small',href:'#/roster/presets',text:b.label||'추천덱 보기'})):null;
        case 'opening_decks':return openingBlock(b.ids);
        case 'coexistence_plans':return plansBlock(b.ids);
        case 'stat_notes':return statNotesBlock(b.ids);
        case 'glossary':return glossaryBlock(b.ids);
        case 'romance_options':return romanceBlock();
        case 'profession_profiles':return professionBlock();
        case 'equipment_options':return equipmentBlock();
        default:console.warn('알 수 없는 가이드 블록',b.type);return null;
      }
    }catch(error){console.error(error);return h('p',{class:'form-error',text:`이 부분을 표시하지 못했습니다: ${error.message}`});}
  }

  function checklist(b,article){
    const key=id=>`cheonha-guide:${article.id}:${id}`;
    const box=h('div',{class:'checklist'});
    const draw=()=>{
      const done=b.items.filter(i=>store.get(key(i.id))==='1').length;
      fill(box,h('p',{class:'muted-note',text:`${done}/${b.items.length} 완료`}),b.items.map(i=>h('label',{class:'check-row'},
        h('input',{type:'checkbox',checked:store.get(key(i.id))==='1',onchange:e=>{store.set(key(i.id),e.target.checked?'1':null);draw();}}),i.text)));
    };
    draw();return box;
  }

  /* ── 개척 후보 ── */
  function openingBlock(ids){
    const wrap=h('section',{class:'guide-tool'});
    const level=h('input',{type:'number',min:0,max:50,step:1,placeholder:'전체',class:'narrow','aria-label':'현재 레벨'});
    const onlyOwned=h('input',{type:'checkbox',disabled:!ctx.poolHeroIds()});
    const query=h('input',{type:'search',placeholder:'조합·무장 이름','aria-label':'개척 후보 검색'});
    const list=h('div',{class:'card-grid'});
    const draw=()=>{
      const lv=level.value===''?null:Math.max(0,Math.min(50,Math.trunc(Number(level.value))));
      const set=owned();
      let rows=[];
      try{rows=G.filterOpeningDecks(content,{season:3,level:lv,ownedHeroIds:set?[...set]:null,onlyOwned:onlyOwned.checked&&Boolean(set),query:query.value}).filter(d=>ids.includes(d.id));}
      catch(e){fill(list,h('p',{class:'form-error',text:e.message}));return;}
      if(!rows.length){fill(list,h('div',{class:'empty-box'},h('p',{text:lv!=null&&lv>35?'Lv36부터는 개척 후보가 없습니다. 정규 추천덱을 보세요.':'조건에 맞는 개척 후보가 없습니다.'}),h('a',{class:'ghost-btn small',href:'#/roster/presets',text:'정규 추천덱 보기'})));return;}
      fill(list,rows.map(d=>openingCard(d,set)));
    };
    level.oninput=draw;onlyOwned.onchange=draw;query.oninput=draw;
    draw();
    return fill(wrap,h('div',{class:'tool-row'},
        h('label',{class:'inline-field'},'현재 레벨',level),
        h('label',{class:'check-row'},onlyOwned,ctx.poolHeroIds()?'보유 무장만':'보유 무장만 (보유 풀 등록 필요)'),query),
      list),wrap;
  }
  function openingCard(d,set){
    const av=G.openingAvailability(content,d,state.data,{ownedHeroIds:set?[...set]:null});
    const trans=h('div',{class:'transitions'});
    const card=h('article',{class:'guide-card'},
      h('div',{class:'top'},h('strong',{text:d.name}),badge(d.level_range.label,'fit-mid'),badge(d.preset_kind==='learned_tactics'?'전법 초안 있음':'무장만',d.preset_kind==='learned_tactics'?'fit-high':'')),
      h('p',{class:'hero-row'},d.heroes.map(x=>heroChip(x,set))),
      av.unimplemented_innate_hero_ids.length?h('p',{class:'muted-note',text:`고유 전법 효과 미반영: ${d.heroes.filter(x=>av.unimplemented_innate_hero_ids.includes(x.id)).map(x=>x.name).join(', ')}`}):null,
      h('div',{class:'deck-actions'},
        h('button',{type:'button',class:'solid-btn small',onclick:()=>openImport(d),text:'배틀로 가져오기'}),
        h('button',{type:'button',class:'ghost-btn small',onclick:async()=>{
          if(trans.childNodes.length){fill(trans);return;}
          await ctx.ensurePresets();
          try{
            const rows=G.findCombatTransitions(content,d,ctx.presetsData(),state.data,{minSharedHeroes:2}).slice(0,8);
            fill(trans,rows.length?h('ul',{class:'bullets'},rows.map(r=>h('li',null,
              h('button',{type:'button',class:'text-link',onclick:()=>ctx.openPreset(r.template.id),text:r.template.name}),` · 겹치는 무장 ${r.shared_count}명`))):h('p',{class:'muted-note',text:'무장 2명 이상이 겹치는 정규 추천덱이 없습니다.'}));
          }catch(e){fill(trans,h('p',{class:'form-error',text:e.message}));}
        },text:'정규 덱 전환 후보'})),
      trans);
    return card;
  }

  /* 개척 편성 가져오기: 실제 레벨·병력·전법 레벨을 받습니다(가이드 규칙: 기본 수치를 자동으로 넣지 않음). */
  let importDialog=null;
  function openImport(deck){
    if(!importDialog){importDialog=h('dialog',{class:'modal',id:'opening-import'});document.body.append(importDialog);importDialog.addEventListener('click',e=>{if(e.target===importDialog)importDialog.close();});}
    drawImport(deck);importDialog.showModal();
  }
  async function drawImport(deck){
    const comp=G.guideCompatibility(content,state.data);
    const close=h('button',{type:'button',class:'icon-btn','aria-label':'닫기',onclick:()=>importDialog.close(),text:'✕'});
    if(!comp.can_import){
      fill(importDialog,h('header',{class:'modal-head'},h('h2',{text:`${deck.name} 가져오기`}),close),
        h('div',{class:'modal-body'},h('p',{class:'modal-copy',text:comp.season_supported?'가이드와 편성 데이터 버전이 달라 가져올 수 없습니다. 서버 연결 상태나 데이터 갱신 여부를 확인하세요.':'개척 편성은 한국 시즌3 목록으로만 가져올 수 있습니다.'})),
        h('footer',{class:'modal-foot'},comp.season_supported?null:h('button',{type:'button',class:'solid-btn',onclick:async()=>{await ctx.switchSeason(3);drawImport(deck);},text:'한국 S3로 전환'})));
      return;
    }
    await ctx.ensurePresets();
    const presets=ctx.presetsData();
    const templates=deck.tactic_template_ids.map(id=>presets.templates.find(t=>t.id===id)).filter(Boolean);
    const tplSel=h('select',null,h('option',{value:'',text:'무장만 가져오기'}),templates.map(t=>h('option',{value:t.id,text:`전법 초안: ${t.name}`})));
    if(templates.length)tplSel.value=templates[0].id;
    const formSel=h('select',null,h('option',{value:'',text:'진형 선택'}),state.data.formations.map(f=>h('option',{value:String(f.id),text:f.name})));
    const supply=h('input',{type:'number',min:0,max:100,step:1,value:100});
    const rowsHost=h('div',{class:'import-rows'});
    const tacticName=id=>state.idx.tactic.get(id)?.name||`전법 ${id}`;
    const inputs={};
    const n=(ph,max)=>h('input',{type:'number',min:1,max,step:1,placeholder:ph,required:true});
    const drawRows=()=>{
      const tpl=templates.find(t=>t.id===tplSel.value);
      if(tpl&&!formSel.value)formSel.value=String(tpl.army.formation_id);
      fill(rowsHost,deck.heroes.map(x=>{
        const lv=inputs[`${x.id}:lv`]??=n('레벨',50),tr=inputs[`${x.id}:tr`]??=n('병력',50000),il=inputs[`${x.id}:il`]??=n('고유Lv',10);
        const learned=tpl?.army.heroes.find(y=>y.hero_id===x.id)?.learned||[];
        return h('div',{class:'import-row'},h('strong',{text:x.name}),
          h('label',{class:'field'},'레벨',lv),h('label',{class:'field'},'병력',tr),h('label',{class:'field'},'고유 전법 Lv',il),
          learned.map(s=>h('label',{class:'field'},`${tacticName(s.skill_id)} Lv`,inputs[`${x.id}:${s.skill_id}`]??=n('Lv',10))));
      }));
    };
    tplSel.onchange=drawRows;drawRows();
    const err=h('p',{class:'form-error',role:'alert'});
    const go=side=>{
      err.textContent='';
      try{
        const tpl=templates.find(t=>t.id===tplSel.value)||null;
        const int=el=>el.value===''?NaN:Number(el.value);
        const heroInputs=deck.heroes.map(x=>{
          const learned=tpl?.army.heroes.find(y=>y.hero_id===x.id)?.learned||[];
          return {hero_id:x.id,level:int(inputs[`${x.id}:lv`]),troops:int(inputs[`${x.id}:tr`]),innate_level:int(inputs[`${x.id}:il`]),
            learned_levels:Object.fromEntries(learned.map(s=>[s.skill_id,int(inputs[`${x.id}:${s.skill_id}`])]))};
        });
        if(!tpl&&!formSel.value)throw new Error('진형을 고르세요.');
        const army=G.armyFromOpeningDeck(content,deck.id,state.data,{heroInputs,formationId:formSel.value?Number(formSel.value):undefined,supply:int(supply),templateId:tpl?.id??null,recommendedDecks:presets});
        importDialog.close();
        ctx.sendToBattle(ctx.loadable(state.data,ctx.prep(army)),side,`'${deck.name}'을(를) ${ctx.SIDE_NAME[side]} 부대로 가져왔습니다. 병법·장비·능력치는 편성 화면에서 채우세요.`);
      }catch(e){err.textContent=e.message;}
    };
    fill(importDialog,
      h('header',{class:'modal-head'},h('div',null,h('h2',{text:`${deck.name} 가져오기`}),h('p',{class:'muted-note',text:'게임에 표시된 실제 값을 넣어 주세요. 병법·장비·병종·돌파는 비운 채로 가져오고 편성 화면에서 채웁니다.'})),close),
      h('div',{class:'modal-body'},
        h('div',{class:'grid-3'},templates.length?h('label',{class:'field'},'전법',tplSel):null,h('label',{class:'field'},'진형',formSel),h('label',{class:'field'},'보급',supply)),
        rowsHost,err),
      h('footer',{class:'modal-foot'},h('button',{type:'button',class:'ghost-btn',onclick:()=>go('right'),text:'상대로 가져오기'}),h('button',{type:'button',class:'solid-btn',onclick:()=>go('left'),text:'아군으로 가져오기'})));
  }

  /* ── 5부대 구성안 ── */
  function plansBlock(ids){
    const set=owned();
    return h('div',{class:'stack'},content.coexistence_plans.filter(p=>ids.includes(p.id)).map(p=>{
      const av=G.planAvailability(content,p.id,state.data,{ownedHeroIds:set?[...set]:null});
      return h('section',{class:'guide-card'},
        h('div',{class:'top'},h('strong',{text:p.name}),badge(`무장 ${av.hero_count}명`),
          av.missing_owned_hero_ids?badge(`미보유 ${av.missing_owned_hero_ids.length}명`,av.missing_owned_hero_ids.length?'warn':'fit-high'):null,
          av.missing_catalog_hero_ids.length?badge(`이 시즌에 없음 ${av.missing_catalog_hero_ids.length}명`,'warn'):null),
        table(['부대','무장','추천덱'],p.teams.map(t=>[t.name,h('span',{class:'hero-row'},t.heroes.map(x=>heroChip(x,set))),presetLinks(t.candidate_template_ids)])),
        h('div',{class:'deck-actions'},h('button',{type:'button',class:'ghost-btn small',onclick:async()=>{
          await ctx.ensurePresets();
          const n=ctx.addTemplatesToLineup(p.teams.map(t=>t.candidate_template_ids[0]).filter(Boolean));
          notify(n?`${n}개 부대를 내 구성에 담았습니다. 보유 풀 → 내 구성에서 확인하세요.`:'이미 내 구성에 있는 덱들입니다.');
        },text:'각 부대 첫 번째 안을 내 구성에 담기'}),h('a',{class:'text-link',href:'#/roster/lineup',text:'내 구성 보기'})));
    }));
  }

  /* ── 능력치 배분 메모 ── */
  function statNotesBlock(ids){
    const wrap=h('section',{class:'guide-tool'}),query=h('input',{type:'search',placeholder:'조합·무장 이름, 배분 방향','aria-label':'배분 메모 검색'}),list=h('div',{class:'card-grid'});
    const draw=()=>{
      const rows=G.filterStatNotes(content,{query:query.value}).filter(r=>ids.includes(r.id));
      fill(list,rows.length?rows.map(r=>h('article',{class:'guide-card'},
        h('div',{class:'top'},h('strong',{text:r.title}),presetLinks(r.candidate_template_ids)),
        table(['무장','배분','역할'],r.notes.map(n=>[n.name,n.allocation_note,n.role_note])))):h('p',{class:'muted-note',text:'검색 결과가 없습니다.'}));
    };
    query.oninput=draw;draw();
    return fill(wrap,query,list),wrap;
  }

  /* ── 상태 용어 ── */
  function glossaryBlock(ids){
    const wrap=h('section',{class:'guide-tool'}),query=h('input',{type:'search',placeholder:'상태 이름이나 설명','aria-label':'상태 용어 검색'});
    let tag=null;const chips=h('div',{class:'chips'}),list=h('dl',{class:'glossary'});
    const draw=()=>{
      fill(chips,[{id:null,label:'전체'},...content.glossary_tags].map(t=>h('button',{type:'button','aria-pressed':String(t.id===tag),onclick:()=>{tag=t.id;draw();},text:t.label})));
      const rows=G.filterGlossary(content,{query:query.value,tag}).filter(r=>!ids||ids.includes(r.id));
      fill(list,rows.length?rows.flatMap(r=>[h('dt',{text:r.name}),h('dd',{text:r.description})]):h('p',{class:'muted-note',text:'검색 결과가 없습니다.'}));
    };
    query.oninput=draw;draw();
    return fill(wrap,query,chips,list),wrap;
  }

  /* ── 연의 ── */
  const PLAN_KEY='cheonha-romance-plan';
  const readPlan=()=>{try{const p=JSON.parse(store.get(PLAN_KEY)||'null');return p?.kind==='romance-reference-plan'?p.selected_trait_ids:[];}catch{return [];}};
  const savePlan=ids=>store.set(PLAN_KEY,JSON.stringify({kind:'romance-reference-plan',content_version:content.content_version,selected_trait_ids:ids}));
  function romanceBlock(){
    const wrap=h('section',{class:'guide-tool'});let stage=content.romance_stages[0]?.id;
    const skills=new Map(content.romance_skills.map(s=>[s.id,s]));
    const draw=()=>{
      const plan=readPlan(),review=G.reviewRomanceChoices(content,plan),set=owned();
      const st=content.romance_stages.find(s=>s.id===stage);
      fill(wrap,
        h('div',{class:'chips'},badge('한국 시즌3 해금 확인 필요','warn'),badge('전투 계산 미지원')),
        h('div',{class:'seg'},content.romance_stages.map(s=>h('button',{type:'button','aria-pressed':String(s.id===stage),onclick:()=>{stage=s.id;draw();},text:`${s.name} · ${s.heroes.map(x=>x.name).join('/')}`}))),
        st?.unlock_note?h('p',{class:'muted-note',text:st.unlock_note}):null,
        st.heroes.map(hero=>{
          const opts=G.filterRomanceOptions(content,{stageId:stage,heroId:hero.id});
          const changed=(opts[0]?.skill_option_ids||[]).map(id=>skills.get(id)).filter(Boolean);
          return h('article',{class:'guide-card'},
            h('div',{class:'top'},heroChip(hero,set),h('span',{class:'muted-note',text:'변경 전법 후보 (분기와의 일대일 연결은 미확정)'})),
            h('div',{class:'grid-2'},changed.map(s=>h('div',{class:'desc-box'},h('b',{text:s.name}),' ',badge(s.type,`type-${s.type}`),h('p',{text:s.description}),s.use_note?h('p',{class:'muted-note',text:s.use_note}):null))),
            opts.map(o=>h('div',{class:'branch'},
              h('label',{class:'check-row'},h('input',{type:'checkbox',checked:plan.includes(o.trait_id),onchange:e=>{const next=readPlan().filter(id=>id!==o.trait_id);if(e.target.checked)next.push(o.trait_id);savePlan(next);draw();}}),h('strong',{text:o.title})),
              h('p',null,h('b',{text:'병종 '}),`${o.arms.name}${o.arms.selection==='changed'?' (분기에서 변경)':' (기본 병종)'}`),
              h('ul',{class:'bullets'},o.linked_warbooks.map(b=>h('li',null,h('b',{text:b.name}),` ${b.description}`))))));
        }),
        h('div',{class:'plan-box'},h('strong',{text:`참고 계획: ${review.selected_trait_ids.length}개 분기 선택`}),
          review.errors.length?h('p',{class:'form-error',text:review.errors.join(' ')}):h('p',{class:'muted-note',text:review.complete?'세 그룹을 모두 골랐습니다.':`아직 고르지 않은 그룹: ${review.missing_stage_ids.map(id=>content.romance_stages.find(s=>s.id===id)?.name).join(', ')}`}),
          h('p',{class:'muted-note',text:'보관 공략의 그룹당 1명·1분기 기준으로 점검하는 참고 계획입니다. 게임 해금·보유·전투 적용을 보장하지 않으며, 배틀 편성에는 반영되지 않습니다.'})));
    };
    draw();return wrap;
  }

  /* ── 직업 ── */
  function professionBlock(){
    return h('div',{class:'card-grid'},G.filterProfessionProfiles(content).map(p=>h('article',{class:'guide-card'},
      h('div',{class:'top'},h('strong',{text:p.name}),h('span',{class:'muted-note',text:`대표 인물 ${p.representative_hero.name}`})),
      h('p',{text:p.role}),h('ul',{class:'bullets'},p.focus.map(f=>h('li',{text:f}))),h('p',{class:'muted-note',text:p.cooperation}))));
  }

  /* ── 장비·말 옵션 ── */
  function equipmentBlock(){
    const wrap=h('section',{class:'guide-tool'});let slot=null,kind=null;
    const dedicated=h('input',{type:'checkbox'}),query=h('input',{type:'search',placeholder:'옵션 이름이나 효과','aria-label':'장비 옵션 검색'});
    const list=h('div',{class:'card-grid'}),segs=h('span',{class:'seg-pair'});
    const filters=h('div',{class:'tool-row'},segs,h('label',{class:'check-row'},dedicated,'전용 옵션만'),query);
    const seg=(opts,get,set)=>h('div',{class:'seg'},opts.map(([v,t])=>h('button',{type:'button','aria-pressed':String(get()===v),onclick:()=>{set(v);draw();},text:t})));
    const draw=()=>{
      fill(segs,seg([[null,'전체'],['equipment','장비'],['horse','말']],()=>slot,v=>slot=v),seg([[null,'전체'],['trait','특기'],['effect','특효']],()=>kind,v=>kind=v));
      const rows=G.filterEquipmentOptions(content,{slotType:slot,kind,dedicated:dedicated.checked?true:null,query:query.value});
      fill(list,rows.length?rows.map(r=>h('article',{class:'guide-card compact'},
        h('div',{class:'top'},h('strong',{text:r.name}),badge(r.slot_type==='horse'?'말':'장비'),badge(r.kind==='trait'?'특기':'특효'),r.rare?badge('희귀','legend'):null,r.dedicated?badge('전용','fit-mid'):null),
        h('p',{text:r.description}))):h('p',{class:'muted-note',text:'검색 결과가 없습니다.'}));
    };
    dedicated.onchange=draw;query.oninput=()=>draw();
    draw();
    return fill(wrap,h('p',{class:'muted-note',text:'옵션 효과는 현재 전투 계산에 반영되지 않습니다. 배틀 편성에는 장비·말의 실제 능력치만 입력합니다.'}),filters,list),wrap;
  }

  return {show};
}
