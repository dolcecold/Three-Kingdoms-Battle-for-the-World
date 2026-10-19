/* 천하결전 덱 시뮬레이터 — 화면 계층
 * 전투 계산·암호화 키·비공개 데이터는 없습니다. 공개 편성 규칙(editor.js), 공개 코드(army-code.js),
 * 공개 API 2개(api-client.js)만 사용합니다. 이 파일은 화면과 상호작용만 담당합니다. */
import {BattleApi,encodeArmyCode,decodeArmyCode} from './api-client.js';
import {normalizeArmy} from './army-code.js';
import {STAT_FIELDS,armFor,bookChoices,tacticChoices,validateArmy,previewHeroStats,migrateProgression,romanceFor,innateFor} from './editor.js';
import {API_BASE_URL} from './config.js';
import {loadRecommendedDecks,filterRecommendedDecks} from './recommended-decks.js';
import {reviewArmyCoexistence} from './guide-content.js';

/* ── 기본 도구 ─────────────────────────────────────────── */
const $=id=>document.getElementById(id);
const SIDES=['left','right'];
const SIDE_NAME={left:'아군',right:'상대'};
const SIDE_CLASS={left:'ally',right:'enemy'};
const KEYS={api:'cheonha-sample-api',draft:'cheonha-draft-v1',theme:'cheonha-theme',decks:'cheonha-mydecks-v1',dev:'cheonha-dev',eng:'cheonha-max-engagements',pool:'cheonha-pool-v1',lineup:'cheonha-lineup-v1'};
const fmt=n=>Number(n??0).toLocaleString('ko-KR');
const clone=v=>structuredClone(v);
const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const store={
  get(k){try{return localStorage.getItem(k);}catch{return null;}},
  set(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v);}catch{}}
};
const PROPS=new Set(['value','checked','disabled','open','hidden','readOnly','min','max','step','type','maxLength','title','id','name','placeholder']);
function h(tag,attrs,...kids){
  const el=document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){
    if(v==null||v===false)continue;
    if(k==='class')el.className=v;
    else if(k==='text')el.textContent=v;
    else if(k==='dataset')Object.assign(el.dataset,v);
    else if(k.startsWith('on')&&typeof v==='function')el.addEventListener(k.slice(2),v);
    else if(PROPS.has(k))el[k]=v;
    else el.setAttribute(k,v===true?'':String(v));
  }
  for(const kid of kids.flat(Infinity)){if(kid==null||kid===false)continue;el.append(kid instanceof Node?kid:String(kid));}
  return el;
}
/** replaceChildren은 배열을 펼치지 않으므로 배열·null을 정리해서 넣습니다. */
const fill=(el,...kids)=>el.replaceChildren(...kids.flat(Infinity).filter(k=>k!=null&&k!==false));
const SVGNS='http://www.w3.org/2000/svg';
function sv(tag,attrs={},...kids){const el=document.createElementNS(SVGNS,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);for(const kid of kids)if(kid!=null)el.append(kid instanceof Node?kid:String(kid));return el;}
const chevron=()=>{const s=sv('svg',{viewBox:'0 0 16 16','aria-hidden':'true'});s.append(sv('path',{d:'M4 6l4 4 4-4'}));return s;};

let toastTimer;
function notify(text,error=false){clearTimeout(toastTimer);const t=$('toast');t.textContent=text;t.classList.toggle('error',error);t.hidden=false;toastTimer=setTimeout(()=>t.hidden=true,error?7000:3200);}
function message(error){
  if(error?.name==='AbortError')return '요청을 취소했습니다.';
  if(error instanceof TypeError&&/fetch|network|load failed/i.test(error.message))return '서버에 닿지 못했습니다. API 주소, 서버 실행 상태, CORS 허용 주소를 확인하세요.';
  if(error instanceof TypeError)console.error(error);
  let text=error?.message||'알 수 없는 오류가 발생했습니다.';
  if(error?.status===429)text+=error.retryAfter?` ${error.retryAfter}초 뒤에 다시 시도하세요.`:' 잠시 뒤에 다시 시도하세요.';
  if(error?.status===504)text+=' 최대 경기 수를 줄이면 빨라질 수 있습니다.';
  if(error?.status===503)text+=' 지금은 계산할 수 없습니다. 잠시 뒤 다시 시도하세요.';
  if(error?.requestId)text+=` (요청 ID ${error.requestId})`;
  return text;
}
async function copyText(text){
  try{await navigator.clipboard.writeText(text);return true;}
  catch{const ta=h('textarea',{value:text,readOnly:true,style:'position:fixed;opacity:0'});document.body.append(ta);ta.select();const ok=document.execCommand?.('copy');ta.remove();if(!ok)throw new Error('클립보드에 접근할 수 없습니다. 코드를 직접 선택해 복사하세요.');return true;}
}

/* ── 상태 ─────────────────────────────────────────────── */
const state={maxEng:Number(store.get(KEYS.eng))||0,dev:store.get(KEYS.dev)==='1',season:2,data:null,idx:null,api:null,armies:{left:null,right:null},busy:false,open:new Set(),tabs:new Map(),report:null,sample:false,dirty:false,view:'left',battleAbort:null};

function indexData(d){
  const map=rows=>new Map(rows.map(r=>[r.id,r]));
  return {hero:map(d.heroes),tactic:map(d.tactics),book:map(d.warbooks),arm:map(d.arms),prof:map(d.proficiencies),formation:map(d.formations)};
}
async function localData(season){
  const res=await fetch(`./data/editor-s${season}.json`,{cache:'no-cache'});
  if(!res.ok)throw new Error('기본 편성 데이터를 불러오지 못했습니다. data 폴더가 함께 배포됐는지 확인하세요.');
  return res.json();
}
function prep(army){return migrateProgression(normalizeArmy(clone(army)));}
/** 화면에 그릴 수 있는지만 봅니다. 정통 개수 같은 규칙 위반은 불러온 뒤 부대 아래에 표시해 사용자가 고치게 합니다(계약 가이드). */
function loadable(data,army){
  const ids=new Set(data.heroes.map(x=>x.id));
  if(army.heroes.length!==3||army.heroes.some(x=>!ids.has(x.hero_id)))throw new Error('현재 시즌에서 선택할 수 없는 무장이 있어 불러올 수 없습니다.');
  if(new Set(army.heroes.map(x=>x.slot)).size!==3||army.heroes.some(x=>![1,2,3].includes(x.slot)))throw new Error('무장 위치 정보가 올바르지 않습니다.');
  return army;
}
const isValid=(data,army)=>{try{validateArmy(data,army);return true;}catch{return false;}};
function examplesFrom(data){return SIDES.map((_,i)=>prep(data.examples[i]));}
function baseArmy(data){
  const d=decks.base(data.season);if(!d)return null;
  try{return loadable(data,prep(d.army));}catch{return null;}
}
function startArmies(data){const ex=examplesFrom(data);return [baseArmy(data)||ex[0],ex[1]];}

/* ── 내 덱 (브라우저 localStorage) ───────────────────────── */
const decks={
  all(){try{const d=JSON.parse(store.get(KEYS.decks)||'null');return d?.v===1&&Array.isArray(d.decks)?d.decks:[];}catch{return [];}},
  write(list){
    store.set(KEYS.decks,JSON.stringify({v:1,decks:list}));
    if(store.get(KEYS.decks)==null)throw new Error('브라우저 저장소를 쓸 수 없어 덱을 저장하지 못했습니다. 시크릿 모드나 저장소 차단 설정을 확인하세요.');
  },
  forSeason(season){return this.all().filter(d=>d.season===season).sort((a,b)=>Number(b.base)-Number(a.base)||b.updated-a.updated);},
  base(season){return this.all().find(d=>d.season===season&&d.base)||null;},
  add(name,army,base=false){
    const list=this.all();
    if(base)list.forEach(d=>{if(d.season===state.season)d.base=false;});
    const id=Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    list.push({id,name:(name||'').trim().slice(0,80)||'이름 없는 덱',season:state.season,army:clone(army),base,updated:Date.now()});
    this.write(list);return id;
  },
  update(id,patch){
    const list=this.all(),d=list.find(x=>x.id===id);if(!d)return;
    if(patch.base)list.forEach(x=>{if(x.season===d.season)x.base=false;});
    Object.assign(d,patch,{updated:Date.now()});this.write(list);
  },
  remove(id){this.write(this.all().filter(d=>d.id!==id));}
};
function acceptData(data,{reset=false}={}){
  if(data.season!==state.season||!Array.isArray(data.heroes)||!data.rules||!data.examples?.length)throw new Error('이 화면과 호환되지 않는 편성 데이터입니다.');
  if(!reset&&state.armies.left){for(const s of SIDES)loadable(data,state.armies[s]);}
  state.data=data;state.idx=indexData(data);
  if(reset||!state.armies.left){[state.armies.left,state.armies.right]=startArmies(data);state.open.clear();state.tabs.clear();}
}
/** 서버 데이터를 받되, 현재 편성이 맞지 않으면 예시로 바꾸고 알립니다. */
async function warnIfServerDiffers(data){
  try{
    const local=await localData(data.season);
    if(local.data_version!==data.data_version)
      notify(`서버 편성 데이터가 이 화면의 메타와 다릅니다 (한국 S${data.season} 무장 서버 ${data.heroes.length}명 / 화면 ${local.heroes.length}명). 지금은 서버 목록을 씁니다. 백엔드 재배포나 캐시를 확인하세요.`,true);
  }catch{}
}
function adoptServerData(data){
  warnIfServerDiffers(data);
  try{acceptData(data);return true;}
  catch(error){acceptData(data,{reset:true});notify(`현재 편성이 서버 데이터와 맞지 않아 예시 편성으로 바꿨습니다. (${error.message})`,true);return false;}
}

/* ── 테마 ─────────────────────────────────────────────── */
function applyTheme(){const t=store.get(KEYS.theme);if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;else delete document.documentElement.dataset.theme;}
function toggleTheme(){
  const current=document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  store.set(KEYS.theme,current==='dark'?'light':'dark');applyTheme();
}

/* ── 바쁨·작업 ─────────────────────────────────────────── */
function busy(on){
  state.busy=on;
  $('armies').querySelectorAll('.army').forEach(a=>{a.inert=on;a.setAttribute('aria-busy',String(on));});
  document.querySelectorAll('#season-switch input,[data-action],#open-connection,#connect-submit,#example-report').forEach(el=>el.disabled=on);
  $('battle').disabled=on||!state.data;
}
async function task(work,errorTarget){
  if(state.busy)return;busy(true);
  try{return await work();}
  catch(error){if(errorTarget)$(errorTarget).textContent=message(error);else notify(message(error),true);}
  finally{busy(false);}
}

/* ── 연결 ─────────────────────────────────────────────── */
const savedUrl=()=>store.get(KEYS.api)||API_BASE_URL||'';
function updateConnection(){
  const pill=$('open-connection');pill.classList.toggle('connected',Boolean(state.api));
  $('connection-label').textContent=state.api?'서버 연결됨':'편성 모드';
  pill.title=state.api?state.api.baseUrl:'전투 서버가 연결되지 않았습니다';
  if(!state.battleAbort)$('battle-hint').textContent=state.api?`한국 시즌 ${state.season} 추정 전투를 계산합니다.`:'편성·공유는 지금 바로 쓸 수 있고, 전투는 서버 연결 뒤 진행됩니다.';
}
function openConnection(){$('api-url').value=state.api?.baseUrl||savedUrl();$('connection-error').textContent='';$('connection-dialog').showModal();}

/* ── 초안 자동 저장 ─────────────────────────────────────── */
let draftTimer;
function saveDraft(){clearTimeout(draftTimer);draftTimer=setTimeout(()=>store.set(KEYS.draft,JSON.stringify({v:1,season:state.season,left:state.armies.left,right:state.armies.right})),400);}
function readDraft(){try{const d=JSON.parse(store.get(KEYS.draft)||'null');return d?.v===1&&[1,2,3].includes(d.season)&&d.left&&d.right?d:null;}catch{return null;}}
function restoreDraft(draft){
  try{const left=prep(draft.left),right=prep(draft.right);loadable(state.data,left);loadable(state.data,right);state.armies.left=left;state.armies.right=right;return true;}
  catch{return false;}
}

/* ── 렌더링 ───────────────────────────────────────────── */
/** data_version은 서버 간 정합용이라 화면에 표시하지 않고 코드에만 담습니다. */
const codeOpts=()=>({data_version:state.data?.data_version??null});
const totalTroops=army=>army.heroes.reduce((s,x)=>s+Number(x.troops||0),0);
function dirty(){
  state.dirty=true;
  const chip=$('report-stale');if(chip)chip.hidden=state.sample;
  saveDraft();
}
let renderQueued=false;
/** change 이벤트 뒤 포커스가 다음 칸으로 옮겨간 다음에 다시 그립니다(Tab 이동 유지). */
function scheduleRender(){if(renderQueued)return;renderQueued=true;setTimeout(()=>{renderQueued=false;render();},0);}
function render(){
  const key=document.activeElement?.dataset?.focus;
  for(const s of SIDES)renderArmy(s);
  updateSummary();updateConnection();updateTabs();syncEngagements();
  if(key)document.querySelector(`[data-focus="${CSS.escape(key)}"]`)?.focus({preventScroll:true});
}
function syncEngagements(){
  const r=state.data?.rules||{},min=r.min_engagements||1,max=r.max_engagements||8;
  if(!(state.maxEng>=min&&state.maxEng<=max))state.maxEng=r.default_max_engagements||max;
  const el=$('max-eng');
  if(el.options.length!==max-min+1)el.replaceChildren(...Array.from({length:max-min+1},(_,i)=>h('option',{value:String(min+i),text:`${min+i}경기`})));
  el.value=String(state.maxEng);
}
function updateSummary(){
  if(!state.data)return;
  for(const s of SIDES){const n=fmt(totalTroops(state.armies[s]));$(`${s}-total`).textContent=n;$(`tab-${s}-total`).textContent=n;}
}
function updateTabs(){
  for(const s of SIDES){const on=state.view===s;$(`tab-${s}`).setAttribute('aria-selected',String(on));$(s).classList.toggle('is-active',on);}
}
function sel(rows,value,attrs={},{empty=false,group}={}){
  const el=h('select',attrs);
  if(empty)el.append(h('option',{value:'',text:'선택 안 함'}));
  if(group){
    const groups=new Map();for(const r of rows){const g=group(r);if(!groups.has(g))groups.set(g,[]);groups.get(g).push(r);}
    for(const [g,list] of groups)el.append(h('optgroup',{label:g},list.map(r=>h('option',{value:String(r.id),text:r.name}))));
  }else for(const r of rows)el.append(h('option',{value:String(r.id),text:r.name}));
  el.value=value==null?'':String(value);
  return el;
}
const num=(value,attrs)=>h('input',{type:'number',inputMode:'decimal',step:'any',value:value??'',...attrs});
const fkey=(side,slot,path)=>`${side}|${slot}|${path}`;

function renderArmy(side){
  const army=state.armies[side],host=$(side);
  host.replaceChildren(
    armyHead(side,army),
    formationBlock(side,army),
    h('div',{class:'hero-stack'},[...army.heroes].sort((a,b)=>a.slot-b.slot).map(hero=>heroCard(side,army,hero))),
    armyFoot(side,army)
  );
}
function quickDeck(side){
  const list=decks.forSeason(state.season);if(!list.length)return null;
  return h('select',{class:'quick-deck','aria-label':`${SIDE_NAME[side]} 부대에 내 덱 불러오기`,dataset:{quickDeck:side,focus:fkey(side,'army','quick')}},
    h('option',{value:'',text:'내 덱 출전…'}),list.map(d=>h('option',{value:d.id,text:(d.base?'★ ':'')+d.name})));
}
function armyHead(side,army){
  return h('header',{class:'army-head'},
    h('div',{class:'army-ident'},
      h('span',{class:'army-side',text:`${SIDE_NAME[side]} 부대`}),
      h('input',{class:'army-name',type:'text',maxLength:80,value:army.name,'aria-label':`${SIDE_NAME[side]} 부대 이름`,dataset:{path:'army.name',focus:fkey(side,'army','name')}}),
      quickDeck(side)),
    h('div',{class:'army-tools'},
      decks.forSeason(state.season).length?null:h('a',{class:'ghost-btn small preset-btn',href:'#/roster/presets',text:'덱 가져오기'}),
      h('button',{class:'ghost-btn small',type:'button',dataset:{deckSave:side},text:'내 덱에 저장'}),
      h('button',{class:'ghost-btn small',type:'button',dataset:{codeMode:'import',side},text:'코드 불러오기'}),
      h('button',{class:'ghost-btn small',type:'button',dataset:{codeMode:'share',side},text:'공유'}))
  );
}
function formationBlock(side,army){
  const f=state.idx.formation.get(army.formation_id);
  const rowOf=slot=>f?.positions.find(p=>p.slot===slot)?.row;
  const map=h('div',{class:'formation-map','aria-hidden':'true'},
    ['front','back'].map(row=>h('div',{class:'row'},h('span',{text:row==='front'?'전열':'후열'}),[1,2,3].map(slot=>h('span',{class:'cell'+(rowOf(slot)===row?' on':''),text:rowOf(slot)===row?slot:''})))));
  return h('div',{class:'formation'},
    h('label',{class:'field'},'진형',sel(state.data.formations,army.formation_id,{dataset:{path:'army.formation_id',focus:fkey(side,'army','formation')}})),
    map,
    f?.description?h('p',{class:'formation-desc',text:f.description}):null);
}
function romanceRow(side,army,hero,opts){
  const d=state.data;
  // 같은 연의 그룹은 부대당 1무장·1분기입니다. 다른 무장이 이미 쓰는 그룹은 고를 수 없게 표시합니다.
  const taken=new Set(army.heroes.filter(x=>x!==hero).map(x=>romanceFor(d,x)?.stage_id).filter(v=>v!=null));
  const el=h('select',{dataset:{path:'romance',focus:fkey(side,hero.slot,'romance')},'aria-label':'연의 분기'},
    h('option',{value:'',text:'선택 안 함 (기본 고유 전법)'}),
    opts.map(r=>h('option',{value:String(r.trait_id),disabled:taken.has(r.stage_id)&&hero.romance_trait_id!==r.trait_id,
      text:`${r.name} · ${d.arms.find(a=>a.id===r.arms_id)?.name||''}${taken.has(r.stage_id)&&hero.romance_trait_id!==r.trait_id?' (같은 그룹 사용 중)':''}`})));
  el.value=hero.romance_trait_id==null?'':String(hero.romance_trait_id);
  return h('label',{class:'romance-row'},h('span',{class:'romance-label',text:'연의'}),el);
}
function heroCard(side,army,hero){
  const d=state.data,ix=state.idx,row=ix.hero.get(hero.hero_id),arm=armFor(d,hero);
  const pos=ix.formation.get(army.formation_id)?.positions.find(p=>p.slot===hero.slot)?.row;
  const key=`${side}:${hero.slot}`;
  const top=h('div',{class:'hc-top'},
    h('span',{class:'slot-badge'+(pos==='back'?' back':''),'aria-label':`${hero.slot}번 위치, ${pos==='back'?'후열':'전열'}`},h('b',{text:hero.slot}),h('small',{text:pos==='back'?'후열':'전열'})),
    h('button',{class:'hero-pick',type:'button','aria-label':`${SIDE_NAME[side]} ${hero.slot}번 무장 ${row.name}, 바꾸기`,dataset:{pick:'hero',focus:fkey(side,hero.slot,'pick-hero')}},
      h('span',{class:'name'},h('span',{text:row.name}),chevron()),
      h('span',{class:'meta',text:[row.faction_name,row.rarity_name&&`${row.rarity_name}등급`,arm?.name||'병종 미상',`Lv${hero.level}`,hero.breakthrough?`돌파${hero.breakthrough}`:null,hero.promotion?`승품${hero.promotion}`:null].filter(Boolean).join(' · ')})),
    h('label',{class:'troops-field'},'병력',num(hero.troops,{min:1,max:50000,step:1,dataset:{path:'troops',focus:fkey(side,hero.slot,'troops')}}))
  );
  const rom=romanceFor(d,hero),inn=innateFor(d,hero)||row.innate;
  const innate=h('details',{class:'innate'},
    h('summary',{dataset:{focus:fkey(side,hero.slot,'innate')}},'고유 ',h('b',{text:inn.name}),rom?h('span',{class:'tag legend',text:`연의 · ${rom.name}`}):null,inn.effect_status==='not_implemented'?h('span',{class:'tag warn',text:'효과 미반영'}):null),
    h('p',null,inn.description,h('small',{class:'desc-basis',text:` 설명 기준 Lv${d.rules.description_skill_level}·강화${d.rules.description_skill_grade} · 현재 Lv${hero.innate.level}·승품${hero.promotion??0}`})));
  const romOpts=(d.romance_options||[]).filter(r=>r.hero_id===hero.hero_id);
  const romance=romOpts.length?romanceRow(side,army,hero,romOpts):null;
  const pv=statPreview(hero).shown;
  const eq=hero.equipment_item_id!=null?state.data.equipment?.find(x=>x.id===hero.equipment_item_id)?.name:null;
  const hs=hero.horse_item_id!=null?state.data.horses?.find(x=>x.id===hero.horse_item_id)?.name:null;
  const strip=pv?h('p',{class:'stat-strip',title:'진형·전법 적용 전 표시용 능력치'},STAT_FIELDS.map(([k,n])=>h('span',null,n,h('b',{text:shortNum(pv[k])}))),
    eq||hs?h('span',{class:'items',text:[eq,hs].filter(Boolean).join(' · ')}):null,hero.total_stats?h('span',{class:'tag',text:'직접 입력'}):null):null;
  const tactics=h('div',{class:'tactic-row'});
  hero.learned.forEach((s,i)=>{const t=ix.tactic.get(s.skill_id);tactics.append(h('button',{class:'tactic-btn',type:'button',dataset:{pick:'tactic',index:i,focus:fkey(side,hero.slot,`pick-tactic-${i}`)},'aria-label':`학습 전법 ${i+1}: ${t?.name||'알 수 없음'}, 바꾸기`},
    h('span',{class:'t-name',text:t?.name||`ID ${s.skill_id}`}),
    h('span',{class:'t-meta'},t?h('span',{class:`tag type-${t.type_name}`,text:t.type_name}):null,`Lv${s.level} · 돌파${s.breakthrough??0}`)));});
  if(hero.learned.length<2)tactics.append(h('button',{class:'tactic-btn empty',type:'button',dataset:{pick:'tactic',index:hero.learned.length,focus:fkey(side,hero.slot,`pick-tactic-${hero.learned.length}`)},text:'+ 전법 추가'}));
  const slots=row.warbook_slots.length;
  const adv=h('details',{class:'advanced',open:state.open.has(key),dataset:{openKey:key}},
    h('summary',{dataset:{focus:fkey(side,hero.slot,'adv')}},'상세 설정',h('span',{class:'adv-meta',text:`${hero.warbook_page==='romance'&&romanceFor(state.data,hero)?'연의 병법':`병법 ${hero.warbook_slots.length}/${slots}`} · 정통 ${hero.arms_skill_ids.length}/${state.data.rules.max_proficiencies_per_hero??1}${hero.total_stats?' · 총능력치 입력':''}`})),
    state.open.has(key)?advancedBody(side,army,hero,row,arm,key):null);
  return h('article',{class:'hero-card',dataset:{slot:hero.slot}},top,strip,romance,innate,tactics,adv);
}
const TABS=[['basic','기본'],['books','병법'],['arms','병종'],['stats','능력치']];
function advancedBody(side,army,hero,row,arm,key){
  const tab=state.tabs.get(key)||'basic',d=state.data,ix=state.idx,F=p=>fkey(side,hero.slot,p);
  const tabs=h('div',{class:'adv-tabs',role:'tablist','aria-label':'상세 설정 분류'},TABS.map(([id,name])=>h('button',{type:'button',role:'tab','aria-selected':String(id===tab),dataset:{tab:id,focus:F(`tab-${id}`)},text:name})));
  const panel=h('div',{class:'adv-panel',role:'tabpanel'});
  if(tab==='basic'){
    panel.append(h('div',{class:'grid-4'},
      h('label',{class:'field'},'위치',sel([1,2,3].map(id=>({id,name:`${id}번`})),hero.slot,{dataset:{path:'position_slot',focus:F('position')}})),
      h('label',{class:'field'},'무장 레벨',num(hero.level,{min:1,max:50,step:1,dataset:{path:'level',focus:F('level')}})),
      h('label',{class:'field'},'무장 돌파',num(hero.breakthrough,{min:0,max:5,step:1,dataset:{path:'breakthrough',focus:F('breakthrough')}})),
      h('label',{class:'field'},'무장 승품',num(hero.promotion??0,{min:0,max:5,step:1,dataset:{path:'promotion',focus:F('promotion')}})),
      h('label',{class:'field'},'고유 전법 Lv',num(hero.innate.level,{min:1,max:10,step:1,dataset:{path:'innate.level',focus:F('innate.level')}}))),
      h('p',{class:'muted-note',text:'무장 돌파는 능력치 배분점을, 무장 승품은 고유 전법을 강화합니다.'}));
    hero.learned.forEach((s,i)=>panel.append(
      h('p',{class:'sub-head'},ix.tactic.get(s.skill_id)?.name||'학습 전법',h('span',{text:`학습 전법 ${i+1}`})),
      h('div',{class:'grid-2'},
        h('label',{class:'field'},'레벨',num(s.level,{min:1,max:10,step:1,dataset:{path:`learned_upgrade.${i}.level`,focus:F(`lu${i}l`)}})),
        h('label',{class:'field'},'전법 돌파',num(s.breakthrough??0,{min:0,max:5,step:1,dataset:{path:`learned_upgrade.${i}.breakthrough`,focus:F(`lu${i}b`)}})))));
    panel.append(h('p',{class:'muted-note',text:'위치를 바꾸면 해당 위치의 무장과 자리를 맞바꿉니다. 레벨을 낮추면 해금되지 않은 병법 슬롯은 비워집니다.'}));
  }else if(tab==='books'){
    const rom=romanceFor(d,hero),page=hero.warbook_page||'normal';
    if(rom){
      panel.append(h('div',{class:'seg',role:'group','aria-label':'병법 페이지'},
        h('button',{type:'button','aria-pressed':String(page==='normal'),dataset:{bookPage:'normal',focus:F('page-normal')},text:'일반 병법'}),
        h('button',{type:'button','aria-pressed':String(page==='romance'),dataset:{bookPage:'romance',focus:F('page-romance')},text:'연의 고정 병법'})));
    }
    if(rom&&page==='romance'){
      panel.append(h('p',{class:'sub-head'},`${rom.name} 고정 병법`,h('span',{text:'일반 병법 대신 적용 · 중복 합산 없음'})),
        ...rom.warbooks.map(b=>h('p',{class:'desc-box'},h('b',{text:b.name}),' ',b.description)));
    }else for(const rule of row.warbook_slots){
      const current=hero.warbook_slots.find(s=>s.slot===rule.slot),locked=hero.level<rule.unlock_level;
      const choices=[...bookChoices(d,hero,rule.slot)].sort((a,b)=>b.quality-a.quality||a.id-b.id);
      const book=current&&ix.book.get(current.warbook_id);
      panel.append(h('div',{class:'field'},
        h('label',{class:'sub-head',for:`wb-${side}-${hero.slot}-${rule.slot}`},`슬롯 ${rule.slot}`,h('span',{text:locked?`Lv${rule.unlock_level}에 해금`:`Lv${rule.unlock_level} 해금 · ${choices.length}개 선택 가능`})),
        sel(choices,current?.warbook_id,{id:`wb-${side}-${hero.slot}-${rule.slot}`,disabled:locked,dataset:{path:`warbook.${rule.slot}`,focus:F(`wb${rule.slot}`)}},{empty:true,group:b=>b.quality_name}),
        book?h('p',{class:'desc-box'},h('span',{class:'tag'+(book.quality===3?' legend':''),text:book.quality_name}),' ',book.description):null));
    }
    if(!row.warbook_slots.length)panel.append(h('p',{class:'muted-note',text:'이 무장은 병법 슬롯 정보가 없습니다.'}));
    panel.append(h('p',{class:'muted-note',text:'전설 병법은 무장당 1개, 같은 그룹 병법은 중복 불가입니다. 고를 수 있는 것만 표시합니다. 계정 보유 여부는 반영하지 않습니다.'}));
  }else if(tab==='arms'){
    const armSel=sel(d.arms.map(a=>({id:a.id,name:a.is_base?a.name:`${a.name} (고급 · Lv${a.unlock_level??35})`})),arm?.id,{dataset:{path:'advanced_arms_id',focus:F('arms')}});
    const romType=romanceFor(d,hero)?.arms_id;
    for(const o of armSel.options){const a=ix.arm.get(Number(o.value));if(a&&a.id!==arm?.id&&(hero.level<(a.unlock_level??1)||(romType!=null&&a.arms_type!==romType)))o.disabled=true;}
    const profLv=arm?.proficiency_unlock_level??d.rules.proficiency_unlock_level??40;
    const why=d.season===1?'한국 시즌 1에는 정통이 없습니다.':!arm||arm.is_base?'기본 병종에는 정통이 없습니다. 고급 병종을 고르면 선택할 수 있습니다.':hero.level<profLv?`정통은 Lv${profLv}부터 선택할 수 있습니다.`:null;
    const many=hero.arms_skill_ids.length>1,cur=many?null:hero.arms_skill_ids[0];
    const profs=d.proficiencies.filter(p=>arm?.proficiency_ids.includes(p.id));
    const picked=cur!=null&&ix.prof.get(cur);
    panel.append(
      h('label',{class:'field'},'병종',armSel),
      arm?.description?h('p',{class:'desc-box',text:arm.description}):null,
      romType!=null?h('p',{class:'muted-note',text:'연의 분기가 정한 병종 계열만 고를 수 있습니다.'}):null,
      h('label',{class:'field'},`정통 (무장당 최대 ${d.rules.max_proficiencies_per_hero??1}개)`,sel(profs,cur,{disabled:Boolean(why)&&!hero.arms_skill_ids.length,dataset:{path:'proficiency',focus:F('prof')}},{empty:true})),
      many?h('p',{class:'army-status bad',text:`옛 코드의 정통 ${hero.arms_skill_ids.length}개가 들어 있습니다. 현재 규칙은 1개이니 다시 골라 주세요.`}):null,
      why?h('p',{class:'muted-note',text:why}):null,
      picked?h('p',{class:'desc-box'},h('b',{text:picked.name}),` · ${picked.description}`):null,
      h('p',{class:'muted-note',text:`고급 병종은 Lv35, 정통은 Lv${profLv}부터입니다. 패업·계정별 해제 상태는 반영하지 않습니다.`}));
  }else{
    const pts=allocPoints(hero),attr=STAT_FIELDS.find(([k])=>k===row.recommended_attribute)?.[1];
    const rec=hero.allocation_mode==='recommended';
    panel.append(h('div',{class:'seg alloc-seg',role:'group','aria-label':'능력치 배분 방식'},
      h('button',{type:'button','aria-pressed':String(rec),disabled:!attr,dataset:{alloc:'recommended',focus:F('alloc-rec')},text:'추천 자동 배분'}),
      h('button',{type:'button','aria-pressed':String(!rec),dataset:{alloc:'manual',focus:F('alloc-man')},text:'직접 배분'})));
    if(rec)panel.append(h('p',{class:'desc-box',text:`배분점 ${pts}점을 ${attr}에 자동 배분합니다. (레벨 ${hero.level} 기준 + 무장 돌파 ${hero.breakthrough}단계)`}));
    else{
      const sum=STAT_FIELDS.reduce((n,[k])=>n+Number(hero.allocation[k]||0),0);
      panel.append(h('p',{class:'sub-head'},'능력치 배분',h('span',{text:`합계 ${fmt(sum)}점 · 기본 배분점 ${pts}점`})),statGrid(hero.allocation,'allocation',F),
        h('p',{class:'muted-note',text:attr?`무장 돌파분까지 포함한 실제 배분 총점을 입력합니다. 이 무장의 추천 속성은 ${attr}입니다.`:'무장 돌파분까지 포함한 실제 배분 총점을 입력합니다.'}));
    }
    for(const [k,label,idKey,catalog] of [['equipment','장비','equipment_item_id',d.equipment],['horse','말','horse_item_id',d.horses]]){
      const item=hero[idKey]!=null?catalog?.find(x=>x.id===hero[idKey]):null;
      panel.append(h('p',{class:'sub-head'},label,h('span',{text:'게임에 표시된 실제 옵션 입력'})),
        catalog?.length?h('button',{type:'button',class:'item-pick'+(item?'':' empty'),dataset:{pick:k,focus:F(`pick-${k}`)}},
          item?[h('b',{text:item.name}),h('span',{class:'tag',text:item.kind_name}),h('span',{class:'tag'+(item.rarity>=4?' legend':''),text:item.rarity_name})]:`${label} 이름 선택 (선택 사항)`):null,
        statGrid(hero[k],k,F));
    }
    panel.append(h('p',{class:'muted-note',text:'이름은 기록용이고 능력치는 자동으로 채워지지 않습니다. 같은 장비도 개체마다 옵션이 달라 실제 값을 입력해야 하며, 특수 효과는 반영하지 않습니다.'}));
    const preview=statPreview(hero);
    panel.append(h('label',{class:'check-row'},h('input',{type:'checkbox',checked:hero.total_stats!==null,dataset:{path:'use_total_stats',focus:F('use_total')}}),'총 능력치 직접 입력'));
    if(hero.total_stats)panel.append(statGrid(hero.total_stats,'total_stats',F,preview.auto),h('p',{class:'muted-note',text:'게임의 진형·전법 적용 전 총 능력치 네 가지를 모두 입력합니다. 레벨·배분·장비·말을 다시 더하지 않습니다. 회색 숫자는 자동 계산 참고값입니다.'}));
    panel.append(statBreakdown(hero,row,preview));
  }
  return h('div',null,tabs,panel);
}
function allocPoints(hero){
  const r=state.data.rules;
  return Math.floor(hero.level/(r.allocation_level_step||10))*(r.points_per_level_step||10)+(hero.breakthrough||0)*(r.points_per_breakthrough||10);
}
function statGrid(stats,prefix,F,hint){return h('div',{class:'grid-4'},STAT_FIELDS.map(([k,name])=>h('label',{class:'field'},name,num(stats[k],{min:0,max:2000,placeholder:hint?shortNum(hint[k]):undefined,dataset:{path:`${prefix}.${k}`,focus:F(`${prefix}.${k}`)}}))));}
const shortNum=v=>v==null||!Number.isFinite(v)?'–':String(Math.round(v*10)/10);
/** 표시용 미리보기입니다. 결과를 total_stats에 저장하지 않습니다(계약 가이드). */
function statPreview(hero){
  let auto=null,shown=null;
  try{auto=previewHeroStats(state.data,{...hero,total_stats:null});}catch{}
  try{shown=previewHeroStats(state.data,hero);}catch{}
  return {auto,shown};
}
function statBreakdown(hero,row,preview){
  if(!row.base_stats)return null;
  const rec=hero.allocation_mode==='recommended',pts=allocPoints(hero);
  const parts=[
    [`기본 Lv${hero.level}`,k=>row.base_stats[k]+row.growth_stats[k]*(hero.level-1)],
    [rec?'추천 배분':'배분',k=>rec?(k===row.recommended_attribute?pts:0):Number(hero.allocation[k]||0)],
    ['장비',k=>Number(hero.equipment[k]||0)],['말',k=>Number(hero.horse[k]||0)]];
  const rows=hero.total_stats?[]:parts.map(([n,f])=>[n,...STAT_FIELDS.map(([k])=>shortNum(f(k)))]);
  rows.push([hero.total_stats?'직접 입력':'합계',...STAT_FIELDS.map(([k])=>h('b',{text:shortNum(preview.shown?.[k])}))]);
  return h('div',{class:'stat-breakdown'},h('p',{class:'sub-head'},'능력치 미리보기',h('span',{text:'진형·전법·전투 효과 적용 전'})),tableEl(['',...STAT_FIELDS.map(([,n])=>n)],rows));
}
function emptyHint(army){
  const empty=army.heroes.reduce((n,x)=>n+(2-x.learned.length),0);
  const zero=army.heroes.filter(x=>!x.total_stats&&x.allocation_mode!=='recommended'&&Object.values(x.allocation).every(v=>!v));
  const fixable=zero.some(x=>state.idx.hero.get(x.hero_id)?.recommended_attribute);
  const parts=[empty?`학습 전법 빈칸 ${empty}개`:null,zero.length?`능력치 배분 0인 무장 ${zero.length}명`:null].filter(Boolean);
  return parts.length?h('div',{class:'army-hint'},
    h('span',{text:`${parts.join(' · ')} — 피해가 낮게 계산돼 전멸 승패가 나기 어렵습니다.`}),
    fixable?h('button',{type:'button',class:'ghost-btn small',dataset:{allocAll:'1'},text:'추천 자동 배분 적용'}):null):null;
}
function armyFoot(side,army){
  let status;
  const partial=army.heroes.find(x=>x.total_stats&&STAT_FIELDS.some(([k])=>x.total_stats[k]==null));
  if(partial)status=h('p',{class:'army-status bad',role:'status',text:`${state.idx.hero.get(partial.hero_id).name}: 총 능력치 네 가지를 모두 입력하세요. 쓰지 않으려면 '총 능력치 직접 입력'을 끄세요.`});
  else try{validateArmy(state.data,army);status=h('p',{class:'army-status ok',text:'편성 규칙을 통과했습니다. 최종 검증은 전투 때 서버가 합니다.'});}
  catch(e){status=h('p',{class:'army-status bad',role:'status',text:e.message});}
  return h('footer',{class:'army-foot'},
    h('span',{class:'army-total'},'총 병력',h('b',{text:fmt(totalTroops(army))})),
    emptyHint(army),
    h('label',{class:'supply-field'},'보급',num(army.supply,{min:0,max:100,step:1,dataset:{path:'army.supply',focus:fkey(side,'army','supply')}})),
    status);
}

/* ── 편집 ─────────────────────────────────────────────── */
function setPath(obj,path,value){const keys=path.split('.');let t=obj;for(const k of keys.slice(0,-1))t=t[k];t[keys.at(-1)]=value;}
function applyEdit(side,slot,path,value){
  const army=state.armies[side],hero=army.heroes.find(x=>x.slot===slot);
  if(path.startsWith('army.'))setPath(army,path.slice(5),value);
  else if(path==='position_slot'){const other=army.heroes.find(x=>x.slot===value);if(other&&other!==hero){other.slot=hero.slot;hero.slot=value;}}
  else if(path==='hero_id'){hero.hero_id=value;hero.warbook_slots=[];hero.advanced_arms_id=null;hero.arms_skill_ids=[];hero.total_stats=null;hero.innate={level:10,grade:0};hero.promotion=0;hero.breakthrough=0;hero.romance_trait_id=null;hero.warbook_page='normal';
    if(hero.allocation_mode==='recommended'&&!state.idx.hero.get(value)?.recommended_attribute)hero.allocation_mode='manual';}
  else if(path.startsWith('learned.')){const i=Number(path.split('.')[1]);if(value)hero.learned[i]={skill_id:value,level:hero.learned[i]?.level||state.data.rules.skill_level?.default||10,grade:0,breakthrough:hero.learned[i]?.breakthrough??0};else hero.learned.splice(i,1);hero.learned=hero.learned.filter(Boolean);}
  else if(path.startsWith('learned_upgrade.'))setPath(hero,'learned.'+path.slice(16),value);
  else if(path.startsWith('warbook.')){const s=Number(path.split('.')[1]);hero.warbook_slots=hero.warbook_slots.filter(x=>x.slot!==s);if(value)hero.warbook_slots.push({slot:s,warbook_id:value});}
  else if(path==='advanced_arms_id'){
    const row=state.idx.hero.get(hero.hero_id),next=state.idx.arm.get(value);
    hero.advanced_arms_id=value===(romanceFor(state.data,hero)?.arms_id??row.default_arms_id)?null:value;
    if(hero.arms_skill_ids.length&&!hero.arms_skill_ids.every(id=>next?.proficiency_ids.includes(id))){hero.arms_skill_ids=[];notify('새 병종에 없는 정통이라 비웠습니다. 정통을 다시 골라 주세요.');}
  }
  else if(path==='proficiency')hero.arms_skill_ids=value?[value]:[];
  else if(path==='romance'){
    // editor.withRomance와 같은 규칙이지만, 다른 칸이 미완성인 편성도 고칠 수 있게 마지막 검증은 하지 않습니다.
    hero.romance_trait_id=value;
    if(value==null)hero.warbook_page='normal';
    else if(hero.warbook_page==='romance')hero.warbook_slots=[];
    const rom=romanceFor(state.data,hero),cur=state.idx.arm.get(hero.advanced_arms_id);
    const expected=rom?.arms_id??state.idx.hero.get(hero.hero_id).default_arms_id;
    if(cur&&cur.arms_type!==state.idx.arm.get(expected)?.arms_type){hero.advanced_arms_id=null;hero.arms_skill_ids=[];}
  }
  else if(path==='warbook_page'){hero.warbook_page=value;if(value==='romance')hero.warbook_slots=[];}
  else if(path==='use_total_stats')hero.total_stats=value?Object.fromEntries(STAT_FIELDS.map(([k])=>[k,null])):null;
  else setPath(hero,path,value);
  if(path==='level'&&hero){const row=state.idx.hero.get(hero.hero_id);hero.warbook_slots=hero.warbook_slots.filter(s=>hero.level>=(row.warbook_slots.find(r=>r.slot===s.slot)?.unlock_level??99));}
  dirty();scheduleRender();
}
function onChange(event){
  if(state.busy)return;const c=event.target;
  if(c.dataset.quickDeck){
    const d=decks.all().find(x=>x.id===c.value);if(!d)return;
    try{const s=c.dataset.quickDeck;state.armies[s]=loadable(state.data,prep(d.army));dirty();render();notify(`'${d.name}'을(를) ${SIDE_NAME[s]} 부대로 출전시켰습니다.`);}
    catch(err){notify(`이 덱을 쓸 수 없습니다: ${message(err)}`,true);render();}
    return;
  }
  const path=c.dataset.path;if(!path)return;
  const side=c.closest('.army').dataset.side,slot=Number(c.closest('[data-slot]')?.dataset.slot);
  const value=c.type==='checkbox'?c.checked:(c.type==='number'||c.tagName==='SELECT')?(c.value===''?null:Number(c.value)):c.value;
  applyEdit(side,slot,path,value);
}

/* ── 무장·전법 선택 창 ─────────────────────────────────── */
const picker={items:[],groups:[],sel:{},current:null,onPick:null,focusKey:null};
function openPicker({title,sub,items,groups,current,allowClear,onPick,focusKey}){
  groups=groups.filter(g=>g.options.length>1);
  Object.assign(picker,{items,groups,sel:Object.fromEntries(groups.map(g=>[g.key,'all'])),current,onPick,focusKey});
  $('picker-title').textContent=title;$('picker-sub').textContent=sub||'';$('picker-search').value='';$('picker-clear').hidden=!allowClear;
  fill($('picker-chips'),groups.map(g=>h('div',{class:'chip-row',role:'group','aria-label':g.label},
    h('span',{class:'chip-label',text:g.label}),
    [['all','전체'],...g.options.map(o=>[o,o])].map(([v,t])=>h('button',{type:'button','aria-pressed':String(v==='all'),dataset:{group:g.key,chip:v},text:t})))));
  $('picker-chips').hidden=!groups.length;
  renderPicker();$('picker-dialog').showModal();
  if(matchMedia('(pointer:fine)').matches)$('picker-search').focus();
  else $('picker-list').querySelector('[aria-selected="true"]')?.scrollIntoView({block:'center'});
}
function renderPicker(){
  const q=$('picker-search').value.replace(/\s/g,'').toLowerCase();
  const rows=picker.items.filter(it=>Object.entries(picker.sel).every(([k,v])=>v==='all'||it.facets[k]===v)&&(!q||it.search.includes(q)));
  rows.sort((a,b)=>Number(a.disabled)-Number(b.disabled));
  $('picker-list').replaceChildren(...rows.map(it=>h('button',{class:'pick-opt',type:'button',role:'option','aria-selected':String(it.id===picker.current),disabled:it.disabled,dataset:{id:it.id}},
    h('span',{class:'row1'},h('span',{class:'nm',text:it.name}),it.tags),
    it.desc?h('span',{class:'ds',text:it.desc}):null,
    it.disabled&&it.why?h('span',{class:'why',text:it.why}):null)));
  if(!rows.length)$('picker-list').append(h('p',{class:'muted-note',style:'padding:20px;text-align:center',text:'조건에 맞는 항목이 없습니다. 검색어나 분류를 바꿔 보세요.'}));
  $('picker-count').textContent=`${rows.filter(r=>!r.disabled).length}개 선택 가능`;
}
function finishPick(id){
  $('picker-dialog').close();const key=picker.focusKey;picker.onPick?.(id);
  if(key)requestAnimationFrame(()=>document.querySelector(`[data-focus="${CSS.escape(key)}"]`)?.focus());
}
function pickHero(side,slot){
  const army=state.armies[side],hero=army.heroes.find(x=>x.slot===slot),d=state.data,ix=state.idx;
  const heroes=[...d.heroes].sort((a,b)=>(a.faction??9)-(b.faction??9)||(b.rarity??0)-(a.rarity??0)||a.id-b.id);
  const dupName=new Set(heroes.map(r=>r.name).filter((n,i,a)=>a.indexOf(n)!==i));
  const items=heroes.map(r=>{
    const arm=ix.arm.get(r.default_arms_id),taken=r.id!==hero.hero_id&&army.heroes.some(x=>x.hero_id===r.id);
    const tags=[
      r.faction_name?h('span',{class:`tag faction-${r.faction}`,text:r.faction_name}):null,
      r.rarity_name?h('span',{class:'tag'+(r.rarity>=5?' legend':''),text:`${r.rarity_name}등급`}):null,
      arm?h('span',{class:'tag',text:arm.name}):null,
      r.innate.effect_status==='not_implemented'?h('span',{class:'tag warn',text:'고유 효과 미반영'}):null];
    if(dupName.has(r.name))tags.push(h('span',{class:'tag',text:`#${r.id}`}));
    return {id:r.id,name:r.name,tags,facets:{faction:r.faction_name,rarity:r.rarity_name&&`${r.rarity_name}등급`},desc:`${r.innate.name} — ${r.innate.description}`,
      search:[r.name,r.base_name,r.faction_name,r.rarity_name,r.innate.name,r.innate.description,arm?.name].join('').replace(/\s/g,'').toLowerCase(),disabled:taken,why:taken?'이미 이 부대에 있는 무장입니다.':''};
  });
  const uniq=(rows,key,val)=>[...new Map(rows.filter(r=>r[key]!=null).map(r=>[r[key],val(r)])).entries()];
  const groups=[
    {key:'faction',label:'진영',options:uniq(heroes,'faction',r=>r.faction_name).sort((a,b)=>a[0]-b[0]).map(x=>x[1])},
    {key:'rarity',label:'등급',options:uniq(heroes,'rarity',r=>`${r.rarity_name}등급`).sort((a,b)=>b[0]-a[0]).map(x=>x[1])}];
  openPicker({title:`${SIDE_NAME[side]} ${slot}번 무장`,sub:`${d.heroes.length}명 · 무장을 바꾸면 병법·병종·정통 설정이 초기화됩니다.`,items,groups,current:hero.hero_id,allowClear:false,focusKey:fkey(side,slot,'pick-hero'),onPick:id=>{if(id!==hero.hero_id)applyEdit(side,slot,'hero_id',id);}});
}
function pickItem(side,slot,kind){
  const hero=state.armies[side].heroes.find(x=>x.slot===slot),d=state.data;
  const idKey=kind==='equipment'?'equipment_item_id':'horse_item_id',catalog=(kind==='equipment'?d.equipment:d.horses)||[];
  const items=catalog.map(x=>({id:x.id,name:x.name,
    tags:[h('span',{class:'tag',text:x.kind_name}),h('span',{class:'tag'+(x.rarity>=4?' legend':''),text:x.rarity_name})],
    facets:{kind:x.kind_name,rarity:x.rarity_name},desc:x.description,search:(x.name+x.kind_name+x.description).replace(/\s/g,'').toLowerCase()}));
  const order=['SS','S','A','B'];
  const groups=[{key:'kind',label:'종류',options:[...new Set(catalog.map(x=>x.kind_name))]},
    {key:'rarity',label:'등급',options:[...new Set(catalog.map(x=>x.rarity_name))].sort((a,b)=>order.indexOf(a)-order.indexOf(b))}];
  openPicker({title:`${state.idx.hero.get(hero.hero_id).name} · ${kind==='equipment'?'장비':'말'} 이름`,
    sub:'원본 수록 목록이며 이번 시즌 획득 가능 여부는 확인되지 않았습니다. 이름만 기록되고 능력치는 직접 입력합니다.',
    items,groups,current:hero[idKey],allowClear:hero[idKey]!=null,focusKey:fkey(side,slot,`pick-${kind}`),
    onPick:id=>{hero[idKey]=id;dirty();render();}});
}
function pickTactic(side,slot,index){
  const army=state.armies[side],hero=army.heroes.find(x=>x.slot===slot),d=state.data;
  const allowed=new Set(tacticChoices(d,army,hero,index).map(t=>t.id));
  const items=d.tactics.map(t=>{
    const own=hero.learned.some((s,i)=>i!==index&&s.skill_id===t.id),dis=!allowed.has(t.id);
    return {id:t.id,name:t.name,tags:[h('span',{class:`tag type-${t.type_name}`,text:t.type_name}),t.rarity_name?h('span',{class:'tag'+(t.rarity>=3?' legend':''),text:t.rarity_name}):null,t.variant==='shadow'?h('span',{class:'tag',text:'투영'}):null,t.effect_status==='not_implemented'?h('span',{class:'tag warn',text:'효과 미반영'}):null,t.max_per_army>1?h('span',{class:'tag',text:`부대당 ${t.max_per_army}개`}):null],facets:{type:t.type_name,rarity:t.rarity_name},desc:t.description,search:(t.name+t.description+t.type_name).replace(/\s/g,'').toLowerCase(),disabled:dis,why:dis?(own?'이 무장이 이미 배웠습니다.':`부대 내 사용 한도(${t.max_per_army}개)에 도달했습니다.`):''};
  });
  const order=['액티브','패시브','지휘','추격'];
  const groups=[{key:'type',label:'유형',options:[...new Set(d.tactics.map(t=>t.type_name))].sort((a,b)=>(order.indexOf(a)+1||9)-(order.indexOf(b)+1||9))},
    {key:'rarity',label:'등급',options:['S','A','B'].filter(r=>d.tactics.some(t=>t.rarity_name===r))}];
  const row=state.idx.hero.get(hero.hero_id);
  openPicker({title:`${row.name} · 학습 전법 ${index+1}`,sub:`설명 기준 Lv${d.rules.description_skill_level}·강화${d.rules.description_skill_grade} · 실제 전투는 입력한 레벨·돌파로 계산합니다.`,items,current:hero.learned[index]?.skill_id,groups,allowClear:index<hero.learned.length,focusKey:fkey(side,slot,`pick-tactic-${Math.min(index,1)}`),onPick:id=>applyEdit(side,slot,`learned.${index}`,id)});
}

/* ── 보유 풀 메뉴: 추천덱 데이터 ─────────────────────────── */
let presets=null,presetRows=[],presetSelection=null,presetSeason=null,presetSort='fit',presetMode='combat';
const deckSeason=t=>t.season??null;
const seasonName=n=>n==null?'시즌 미상':`한국 S${n}`;
// 같은 용도·시즌·편성 내용은 하나만 남기고, 이름이 같은 변형은 '1안·2안'으로 구분합니다.
function dedupePresets(list){
  const sig=t=>JSON.stringify([t.mode,deckSeason(t),t.army?.formation_id,(t.army?.heroes||[]).map(x=>[x.hero_id,x.learned.map(s=>s.skill_id),x.warbook_slots.map(b=>b.warbook_id)])]);
  const seen=new Map();
  for(const t of list){const k=sig(t);if(!seen.has(k))seen.set(k,t);}
  const kept=list.filter(t=>seen.get(sig(t))===t),count={},idx={};
  const key=t=>`${t.mode}|${deckSeason(t)}|${t.name}`;
  for(const t of kept)count[key(t)]=(count[key(t)]||0)+1;
  return kept.map(t=>{idx[key(t)]=(idx[key(t)]||0)+1;return {...t,label:count[key(t)]>1?`${t.name} · ${idx[key(t)]}안`:t.name};});
}
async function ensurePresets(){if(!presets){presets=await loadRecommendedDecks();presetRows=dedupePresets(presets.templates);}return presetRows;}

/* ── 보유 풀·구성 (브라우저 localStorage) ───────────────── */
function readPool(){try{const d=JSON.parse(store.get(KEYS.pool)||'null');return {heroes:new Set(d?.heroes||[]),tactics:new Set(d?.tactics||[])};}catch{return {heroes:new Set(),tactics:new Set()};}}
let myPool=readPool();
function savePool(){store.set(KEYS.pool,JSON.stringify({v:1,heroes:[...myPool.heroes],tactics:[...myPool.tactics]}));recomputeLineup();updateRosterCounts();}
const poolActive=()=>myPool.heroes.size>0||myPool.tactics.size>0;
// 구성은 시즌별로 저장합니다. 항목마다 차지한 무장·전법을 기록해 나머지 덱의 적합성을 남은 풀로 다시 계산합니다.
function readLineup(){try{return JSON.parse(store.get(KEYS.lineup)||'{}')[state.season]||[];}catch{return [];}}
function saveLineup(list){let all={};try{all=JSON.parse(store.get(KEYS.lineup)||'{}');}catch{}all[state.season]=list;store.set(KEYS.lineup,JSON.stringify(all));updateRosterCounts();}
function availFor(exceptTid,lineup=readLineup()){
  const heroes=new Set([...myPool.heroes].filter(id=>state.idx.hero.has(id)));
  const tactics=new Set([...myPool.tactics].filter(id=>state.idx.tactic.has(id)));
  for(const e of lineup)if(e.tid!==exceptTid){e.heroes.forEach(id=>heroes.delete(id));e.tactics.forEach(id=>tactics.delete(id));}
  return {heroes,tactics};
}
/** 풀이 바뀌면 구성 순서대로 점유를 다시 계산합니다. */
function recomputeLineup(){
  if(!presets)return;
  const next=[];
  for(const e of readLineup()){const t=presetRows.find(x=>x.id===e.tid);if(!t)continue;const p=planDeck(t,availFor(t.id,next));next.push({tid:e.tid,heroes:p.usedH,tactics:p.usedT});}
  saveLineup(next);
}
/** 무장 3명·전법 6칸 기준으로 남은 풀에 맞춰 봅니다. 적합성 = 무장 60% + 전법 40%. */
function planDeck(t,avail){
  const ix=state.idx,usedH=new Set(),usedT=new Set();let hc=0,tc=0;
  const heroes=[0,1,2].map(i=>{
    const x=t.heroes[i];if(!x)return {src:null,own:null,tactics:[]};
    const own=ix.hero.has(x.id)&&avail.heroes.has(x.id)&&!usedH.has(x.id)?x.id:null;
    if(own!=null){usedH.add(own);hc++;}
    const tactics=(x.learned_tactics||[]).slice(0,2).map(sk=>{
      const got=sk.id!=null&&ix.tactic.has(sk.id)&&avail.tactics.has(sk.id)&&!usedT.has(sk.id)?sk.id:null;
      if(got!=null){usedT.add(got);tc++;}
      return {src:sk,got};
    });
    return {src:x,own,tactics};
  });
  return {heroes,heroCount:hc,tacticCount:tc,fit:Math.round(hc/3*60+tc/6*40),usedH:[...usedH],usedT:[...usedT]};
}
const fitTag=p=>h('span',{class:`tag ${p.fit>=80?'fit-high':p.fit>=50?'fit-mid':'fit-low'}`,text:`적합 ${p.fit}% · 무장 ${p.heroCount}/3 · 전법 ${p.tacticCount}/6`});

/** 시즌 검증 없이 지금 편집 시즌 데이터에 맞춰 불러옵니다. 보유 풀이 있으면 미보유 전법 칸은 비웁니다. */
function presetArmyFor(t){
  const d=state.data,ix=state.idx,notes=[];
  const plan=poolActive()?planDeck(t,availFor(t.id)):null;
  const army=prep(t.army);
  army.name=t.label.slice(0,80);
  if(!ix.formation.has(army.formation_id))army.formation_id=d.examples[0].formation_id;
  const srcIndex=x=>t.heroes.findIndex(r=>r.id===x.hero_id);
  const used=new Set(),slots=new Set();
  army.heroes.forEach((x,i)=>{
    x._src=srcIndex(x)>=0?srcIndex(x):i;
    if(!ix.hero.has(x.hero_id)||used.has(x.hero_id)){
      const pool=[...(plan?availFor(t.id).heroes:[]),...d.examples.flatMap(e=>e.heroes.map(y=>y.hero_id)),...d.heroes.map(y=>y.id)];
      const was=t.heroes[x._src]?.name||`${i+1}번`;
      x.hero_id=pool.find(id=>ix.hero.has(id)&&!used.has(id)&&!army.heroes.some(y=>y!==x&&y.hero_id===id));
      x.learned=[];x.warbook_slots=[];x.advanced_arms_id=null;x.arms_skill_ids=[];
      notes.push(`${was} → ${ix.hero.get(x.hero_id).name}(임시)`);
    }
    used.add(x.hero_id);
    if(!slots.has(x.slot)&&[1,2,3].includes(x.slot))slots.add(x.slot);else x.slot=null;
  });
  army.heroes.filter(x=>x.slot==null).forEach(x=>x.slot=[1,2,3].find(n=>!slots.has(n)&&slots.add(n)));
  let dropped=0,emptied=0;const missing=[];
  for(const x of army.heroes){
    const n=x.learned.length+x.warbook_slots.length;
    x.learned=x.learned.filter(s=>ix.tactic.has(s.skill_id));
    x.warbook_slots=x.warbook_slots.filter(s=>ix.book.has(s.warbook_id));
    if(x.advanced_arms_id!=null&&!ix.arm.has(x.advanced_arms_id)){x.advanced_arms_id=null;x.arms_skill_ids=[];}
    dropped+=n-x.learned.length-x.warbook_slots.length;
    if(plan&&plan.heroes[x._src]?.src){
      const keep=new Set(plan.heroes[x._src].tactics.filter(e=>e.got!=null).map(e=>e.got));
      const before=x.learned.length;
      x.learned=x.learned.filter(s=>keep.has(s.skill_id));
      emptied+=before-x.learned.length;
      if(!myPool.heroes.has(x.hero_id))missing.push(ix.hero.get(x.hero_id).name);
    }
    delete x._src;
  }
  if(dropped)notes.push(`이 시즌에 없는 전법·병법 ${dropped}개 비움`);
  if(emptied)notes.push(`보유하지 않은 전법 ${emptied}칸 비움`);
  if(missing.length)notes.push(`미보유 무장: ${missing.join(', ')}`);
  return {t,army:loadable(d,army),notes};
}
const presetNote=(t,notes,army)=>`'${t.label}'을(를) 불러왔습니다.${notes.length?` ${notes.join(' · ')}.`:''}${isValid(state.data,army)?'':' 부대 아래 안내를 보고 고쳐 주세요.'}`;
function sendToBattle(army,side,text,warn=false){
  state.armies[side]=army;state.view=side;dirty();render();
  location.hash='#/battle';notify(text,warn);
}

/* ── 보유 풀 메뉴: 화면 ───────────────────────────────── */
let rosterSub='pool';
function updateRosterCounts(){
  if(!state.data)return;
  const hs=state.data.heroes.filter(x=>myPool.heroes.has(x.id)).length,ts=state.data.tactics.filter(x=>myPool.tactics.has(x.id)).length;
  $('sub-n-pool').textContent=poolActive()?`${hs}·${ts}`:'';
  const ln=readLineup().length,dn=decks.forSeason(state.season).length;
  $('sub-n-lineup').textContent=ln?String(ln):'';$('sub-n-decks').textContent=dn?String(dn):'';
}
async function renderRoster(sub){
  rosterSub=sub;
  for(const k of ['pool','presets','lineup','decks']){$(`roster-${k}`).hidden=k!==sub;const a=document.querySelector(`.subnav [data-sub="${k}"]`);a.setAttribute('aria-current',k===sub?'page':'false');}
  if(sub!=='pool')await ensurePresets();
  if(sub==='pool')renderPool();else if(sub==='presets')renderPresets();else if(sub==='lineup')renderLineupView();else renderDecksView();
  updateRosterCounts();
}
const rosterLink=(sub,text,cls='ghost-btn small')=>h('a',{href:`#/roster/${sub}`,class:cls,text});

/* 1) 보유 무장·전법 */
let poolTab='heroes';const poolSel={faction:'all',rarity:'all',type:'all',trarity:'all'};
function poolRows(){
  const d=state.data,q=$('pool-search').value.replace(/\s/g,'').toLowerCase();
  if(poolTab==='heroes')return [...d.heroes].sort((a,b)=>(a.faction??9)-(b.faction??9)||(b.rarity??0)-(a.rarity??0)||a.id-b.id)
    .filter(r=>(poolSel.faction==='all'||r.faction_name===poolSel.faction)&&(poolSel.rarity==='all'||r.rarity_name===poolSel.rarity)&&(!q||r.name.replace(/\s/g,'').toLowerCase().includes(q)))
    .map(r=>({id:r.id,name:r.name,sub:[r.faction_name,r.rarity_name&&`${r.rarity_name}등급`].filter(Boolean).join(' · ')}));
  return d.tactics.filter(t=>(poolSel.type==='all'||t.type_name===poolSel.type)&&(poolSel.trarity==='all'||t.rarity_name===poolSel.trarity)&&(!q||t.name.replace(/\s/g,'').toLowerCase().includes(q))).map(t=>({id:t.id,name:t.name,sub:[t.type_name,t.rarity_name,t.variant==='shadow'?'투영':null].filter(Boolean).join(' · ')}));
}
function renderPool(){
  const d=state.data,set=poolTab==='heroes'?myPool.heroes:myPool.tactics;
  $('pool-tabs').querySelectorAll('button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.poolTab===poolTab)));
  $('pool-n-heroes').textContent=`${d.heroes.filter(x=>myPool.heroes.has(x.id)).length}/${d.heroes.length}`;
  $('pool-n-tactics').textContent=`${d.tactics.filter(x=>myPool.tactics.has(x.id)).length}/${d.tactics.length}`;
  const order=['액티브','패시브','지휘','추격'];
  const groups=poolTab==='heroes'
    ?[['faction','진영',[...new Set(d.heroes.map(x=>x.faction_name).filter(Boolean))]],['rarity','등급',[...new Map([...d.heroes].sort((x,y)=>(y.rarity??0)-(x.rarity??0)).filter(x=>x.rarity_name).map(x=>[x.rarity_name,1])).keys()]]]
    :[['type','유형',[...new Set(d.tactics.map(x=>x.type_name))].sort((a,b)=>order.indexOf(a)-order.indexOf(b))],['trarity','등급',['S','A','B'].filter(r=>d.tactics.some(t=>t.rarity_name===r))]];
  fill($('pool-chips'),groups.map(([k,label,opts])=>h('div',{class:'chips chip-row',role:'group','aria-label':label},h('span',{class:'chip-label',text:label}),
    ['all',...opts].map(v=>h('button',{type:'button','aria-pressed':String(poolSel[k]===v),dataset:{poolGroup:k,v},text:v==='all'?'전체':v})))));
  const rows=poolRows();
  fill($('pool-grid'),rows.length?rows.map(r=>h('button',{type:'button',class:'pool-item','aria-pressed':String(set.has(r.id)),dataset:{poolId:r.id}},h('span',{text:r.name}),h('small',{text:r.sub}))):h('p',{class:'muted-note',text:'조건에 맞는 항목이 없습니다.'}));
  $('pool-count').textContent=`표시 ${rows.length}개 중 보유 ${rows.filter(r=>set.has(r.id)).length}개`;
}

/* 2) 추천덱 찾기 */
function renderPresets(){
  const lineup=readLineup(),lineupIds=new Set(lineup.map(e=>e.tid));
  if(presetSeason==null)presetSeason=presetRows.some(t=>deckSeason(t)===state.season)?state.season:'all';
  const have=[...new Set(presetRows.filter(t=>t.mode===presetMode).map(deckSeason))].sort((a,b)=>(a??99)-(b??99));
  if(presetSeason!=='all'&&!have.includes(Number(presetSeason)))presetSeason='all';
  fill($('preset-seasons'),[['all','전체'],...have.map(n=>[n,seasonName(n)])].map(([v,t])=>h('button',{type:'button','aria-pressed':String(String(v)===String(presetSeason)),dataset:{season:v},text:t})));
  $('preset-mode').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===presetMode)));
  const fitOn=poolActive()&&presetSort==='fit';
  $('preset-sort').hidden=!poolActive();
  $('preset-sort').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.sort===presetSort)));
  const a=poolActive()?availFor(null):null;
  fill($('preset-help'),poolActive()
    ?[`보유 무장·전법으로 맞출 수 있는 정도(적합성) 순입니다. 내 구성 ${lineup.length}개가 차지한 것을 빼고 남은 무장 ${a.heroes.size}·전법 ${a.tactics.size}개로 계산합니다. `,rosterLink('lineup','내 구성 보기','text-link')]
    :['보유 무장·전법을 등록하면 내가 맞출 수 있는 덱부터 보여줍니다. ',rosterLink('pool','보유 등록하기','text-link')]);
  const best={};for(const t of presetRows)best[t.name]=Math.max(best[t.name]??0,(t.heroes||[]).reduce((n,x)=>n+(x.learned_tactics||[]).length,0));
  const rows=filterRecommendedDecks({schema_version:'2.0.0',templates:presetRows},{season:state.season,query:$('preset-search').value,mode:presetMode,includeBlocked:true})
    .filter(t=>presetSeason==='all'||deckSeason(t)===Number(presetSeason))
    .map(t=>({t,p:poolActive()?planDeck(t,availFor(t.id,lineup)):null}));
  rows.sort(fitOn
    ?(x,y)=>Number(lineupIds.has(y.t.id))-Number(lineupIds.has(x.t.id))||y.p.fit-x.p.fit||y.p.heroCount-x.p.heroCount
    :(x,y)=>(deckSeason(x.t)??99)-(deckSeason(y.t)??99)||(best[y.t.name]-best[x.t.name])||x.t.name.localeCompare(y.t.name,'ko'));
  $('preset-count').textContent=`${rows.length}개 · 불러오면 지금 편집 중인 한국 시즌 ${state.season}에 맞춰집니다.${poolActive()?' 보유하지 않은 전법 칸은 비워서 불러옵니다.':''}`;
  if(!rows.some(r=>r.t.id===presetSelection))presetSelection=rows[0]?.t.id||null;
  fill($('preset-list'),rows.length?rows.map(({t,p})=>h('button',{class:'preset-opt',type:'button',role:'option','aria-selected':String(t.id===presetSelection),dataset:{templateId:t.id}},
    h('strong',{text:t.label}),
    h('span',{class:'heroes',text:t.heroes.map(x=>x.name).join(' · ')}),
    h('span',{class:'meta'},lineupIds.has(t.id)?h('span',{class:'tag in-lineup',text:'내 구성'}):null,p?fitTag(p):null,h('span',{class:'tag',text:seasonName(deckSeason(t))}))))
    :h('p',{class:'muted-note',text:'조건에 맞는 덱이 없습니다.'}));
  renderPresetPreview();
}
function renderPresetPreview(){
  const host=$('preset-preview');$('preset-error').textContent='';
  const t=presetRows.find(x=>x.id===presetSelection);
  for(const id of ['preset-send-left','preset-send-right','preset-save','preset-base','preset-lineup-toggle'])$(id).disabled=!t;
  const inLineup=Boolean(t&&readLineup().some(e=>e.tid===t.id));
  $('preset-lineup-toggle').hidden=!poolActive();$('preset-lineup-toggle').textContent=inLineup?'내 구성에서 빼기':'내 구성에 추가';
  if(!t){host.replaceChildren(h('p',{class:'muted-note',text:'왼쪽 목록에서 덱을 고르면 구성이 여기에 표시됩니다.'}));return;}
  const ix=state.idx,p=poolActive()?planDeck(t,availFor(t.id)):null;
  const line=(label,...kids)=>h('p',null,h('b',{text:`${label} `}),...kids);
  const armyHero=id=>t.army.heroes.find(x=>x.hero_id===id);
  const heroMark=i=>{
    if(!p)return null;const e=p.heroes[i],id=e.src?.id;
    if(e.own!=null)return h('span',{class:'own',text:' ✓ 보유'});
    if(!ix.hero.has(id))return h('span',{class:'busy-own',text:' 이 시즌에 없음'});
    return myPool.heroes.has(id)?h('span',{class:'busy-own',text:' 다른 구성에서 사용 중'}):h('span',{class:'miss',text:' 미보유'});
  };
  const tacticLine=(x,i)=>{
    const list=p?p.heroes[i].tactics:(x.learned_tactics||[]).map(s=>({src:s,got:s.id}));
    if(!list.length)return '직접 선택';
    return list.flatMap((e,j)=>[j?' / ':'',h('span',{class:p?(e.got!=null?'own':'miss'):'',text:e.src.name})]);
  };
  const books=x=>(armyHero(x.id)?.warbook_slots||[]).map(b=>ix.book.get(b.warbook_id)?.name).filter(Boolean);
  fill(host,
    h('h3',{text:t.label}),
    h('p',{class:'muted-note'},`${seasonName(deckSeason(t))} · ${t.mode==='opening'?'개척':'일반 전투'} `,p?fitTag(p):null),
    ix.formation.get(t.army.formation_id)?line('진형',ix.formation.get(t.army.formation_id).name):null,
    t.heroes.map((x,i)=>h('div',{class:'preset-member'},
      h('strong',null,x.name,heroMark(i)),
      line('전법',tacticLine(x,i)),
      books(x).length?line('병법',books(x).join(', ')):null)),
    p?h('p',{class:'muted-note',text:'초록은 보유, 취소선은 미보유입니다. 미보유 전법 칸은 비워서 불러옵니다.'}):null);
}
function toggleLineup(){
  const t=presetRows.find(x=>x.id===presetSelection);if(!t)return;
  const list=readLineup(),i=list.findIndex(e=>e.tid===t.id);
  if(i>=0){list.splice(i,1);saveLineup(list);recomputeLineup();notify(`'${t.label}'을(를) 내 구성에서 뺐습니다. 다른 덱의 적합성을 다시 계산했습니다.`);}
  else{const p=planDeck(t,availFor(t.id));list.push({tid:t.id,heroes:p.usedH,tactics:p.usedT});saveLineup(list);
    notify(`'${t.label}'을(를) 내 구성에 추가했습니다. 무장 ${p.heroCount}명·전법 ${p.tacticCount}개를 차지하고, 남은 풀로 적합성을 다시 계산했습니다.`);}
  renderPresets();
}
function openPreset(tid){
  const t=presetRows.find(x=>x.id===tid);if(!t){notify('추천덱을 찾을 수 없습니다.',true);return;}
  presetMode=t.mode;presetSeason='all';presetSelection=tid;$('preset-search').value='';
  if(location.hash==='#/roster/presets')renderRoster('presets');else location.hash='#/roster/presets';
  requestAnimationFrame(()=>$('preset-list').querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'}));
}
function addTemplatesToLineup(tids){
  let list=readLineup(),added=0;
  for(const tid of tids){const t=presetRows.find(x=>x.id===tid);if(!t||list.some(e=>e.tid===tid))continue;const p=planDeck(t,availFor(tid,list));list.push({tid,heroes:p.usedH,tactics:p.usedT});added++;}
  saveLineup(list);return added;
}

/* 3) 내 구성 */
function renderLineupView(){
  const host=$('roster-lineup'),lineup=readLineup();
  const help=h('p',{class:'sub-help',text:'추천덱 찾기에서 담은 덱들입니다. 앞의 덱이 차지한 무장·전법을 빼고 다음 덱을 계산하므로, 여러 부대를 겹치지 않게 짤 때 씁니다.'});
  if(!lineup.length){fill(host,help,h('div',{class:'empty-box'},h('p',{text:'아직 담은 덱이 없습니다.'}),rosterLink('presets','추천덱 찾으러 가기','solid-btn small')));return;}
  const items=lineup.map((e,i)=>{const t=presetRows.find(x=>x.id===e.tid);return t?{e,t,i}:null;}).filter(Boolean);
  const built=items.map(({t})=>{try{return presetArmyFor(t).army;}catch{return null;}});
  let review=null;try{review=reviewArmyCoexistence(built.filter(Boolean),state.data);}catch{}
  const nameOf=id=>state.idx.hero.get(id)?.name||`ID ${id}`;
  const prior=[];
  const cards=items.map(({e,t,i})=>{
    const p=planDeck(t,availFor(t.id,prior));prior.push(e);
    return h('article',{class:'lineup-card'},
      h('div',{class:'top'},h('span',{class:'order',text:String(i+1)}),h('strong',{text:t.label}),fitTag(p)),
      h('p',{class:'heroes'},t.heroes.map((x,j)=>[j?' · ':'',h('span',{class:p.heroes[j].own!=null?'own':'miss',text:x.name})])),
      h('div',{class:'deck-actions'},
        h('button',{type:'button',class:'solid-btn small ally-btn',dataset:{lineupSend:'left',tid:t.id},text:'배틀: 아군으로'}),
        h('button',{type:'button',class:'ghost-btn small',dataset:{lineupSend:'right',tid:t.id},text:'배틀: 상대로'}),
        h('button',{type:'button',class:'ghost-btn small',dataset:{lineupView:t.id},text:'추천덱에서 보기'}),
        h('button',{type:'button',class:'ghost-btn small danger',dataset:{lineupRemove:t.id},text:'빼기'})));
  });
  const a=availFor(null);
  const rv=review?h('section',{class:'panel'},h('h4',null,'구성 점검',h('span',{text:'추천덱 원문 기준 · 보유 풀 반영'})),
    review.duplicate_heroes.length?h('p',{class:'army-status bad',text:`여러 부대에 겹친 무장: ${review.duplicate_heroes.map(x=>`${nameOf(x.hero_id)}(${x.army_indexes.map(n=>n+1).join('·')}번)`).join(', ')}`}):h('p',{class:'army-status ok',text:'부대끼리 겹치는 무장이 없습니다.'}),
    review.shared_tactics.length?h('p',{class:'muted-note',text:`여러 부대가 같이 쓰는 전법: ${review.shared_tactics.map(x=>`${x.name}(${[...new Set(x.usage.map(u=>u.army_index+1))].join('·')}번)`).join(', ')} — 보유 수량을 확인하세요.`}):null,
    h('p',{class:'muted-note',text:`남은 보유: 무장 ${a.heroes.size}명 · 전법 ${a.tactics.size}개`})):null;
  fill(host,help,h('div',{class:'tool-row end'},
      h('button',{type:'button',class:'ghost-btn small',dataset:{lineupSaveAll:'1'},text:'모두 내 덱에 저장'}),
      h('button',{type:'button',class:'ghost-btn small danger',dataset:{lineupClear:'1'},text:'구성 비우기'})),
    rv,h('div',{class:'lineup-list'},cards));
}

/* 4) 내 덱 */
const pendingDeck={};
function renderDecksView(){
  const host=$('roster-decks'),list=decks.forSeason(state.season),other=decks.all().length-list.length;
  const help=h('p',{class:'sub-help',text:`배틀 화면이나 추천덱에서 저장한 덱입니다. ★ 기본 편성은 처음 열 때와 '기본 편성으로'를 누를 때 아군에 들어갑니다. 한국 시즌 ${state.season} 덱만 보입니다${other?` (다른 시즌 ${other}개)`:''}.`});
  if(!list.length){fill(host,help,h('div',{class:'empty-box'},h('p',{text:'저장한 덱이 없습니다.'}),rosterLink('presets','추천덱에서 가져오기','solid-btn small')));return;}
  const btn=(text,act,id,cls='ghost-btn small')=>h('button',{type:'button',class:cls,dataset:{deckAct:act,id},text});
  fill(host,help,h('div',{class:'deck-list'},list.map(d=>{
    const names=(d.army.heroes||[]).slice().sort((a,b)=>a.slot-b.slot).map(x=>state.idx.hero.get(x.hero_id)?.name||`ID ${x.hero_id}`).join(' · ');
    return h('div',{class:'deck-item'+(d.base?' is-base':'')},
      h('div',{class:'top'},h('strong',{text:d.name}),d.base?h('span',{class:'tag legend',text:'★ 기본 편성'}):null),
      h('span',{class:'heroes',text:`${names} · ${new Date(d.updated).toLocaleString('ko-KR',{dateStyle:'short',timeStyle:'short'})}`}),
      h('div',{class:'deck-actions'},
        btn('배틀: 아군으로','left',d.id,'solid-btn small ally-btn'),btn('배틀: 상대로','right',d.id),
        btn(d.base?'기본 해제':'★ 기본으로','base',d.id),
        btn(pendingDeck[d.id]?'한 번 더 누르면 삭제':'삭제','delete',d.id,'ghost-btn small danger')));
  })));
}

/* ── 배틀: 내 덱 저장 대화상자 ─────────────────────────── */
let deckSide='left';const pending={};
function showDeckSave(side){
  deckSide=side;Object.keys(pending).forEach(k=>delete pending[k]);
  $('deck-title').textContent=`${SIDE_NAME[side]} 편성을 내 덱에 저장`;
  $('deck-save-label').textContent='새 이름으로 저장';
  $('deck-name').value=state.armies[side].name;
  renderDeckSave();$('deck-dialog').showModal();
}
function renderDeckSave(){
  const list=decks.forSeason(state.season);
  $('deck-sub').textContent=`한국 시즌 ${state.season} · 저장된 덱 ${list.length}개`;
  fill($('deck-list'),list.map(d=>h('div',{class:'deck-item'+(d.base?' is-base':'')},
    h('div',{class:'top'},h('strong',{text:d.name}),d.base?h('span',{class:'tag legend',text:'★ 기본 편성'}):null),
    h('div',{class:'deck-actions'},h('button',{type:'button',class:'ghost-btn small',dataset:{deckAct:'overwrite',id:d.id},text:pending[d.id]?'한 번 더 누르면 덮어씀':'지금 편성으로 덮어쓰기'})))));
}
$('deck-save-form').onsubmit=e=>{
  e.preventDefault();
  try{validateArmy(state.data,state.armies[deckSide]);decks.add($('deck-name').value,state.armies[deckSide]);$('deck-dialog').close();render();notify('내 덱에 저장했습니다. 보유 풀 → 내 덱에서 관리할 수 있습니다.');}
  catch(err){notify(message(err),true);}
};
$('deck-list').onclick=e=>{
  const b=e.target.closest('[data-deck-act="overwrite"]');if(!b)return;const id=b.dataset.id,d=decks.all().find(x=>x.id===id);if(!d)return;
  if(!pending[id]){Object.keys(pending).forEach(k=>delete pending[k]);pending[id]=true;renderDeckSave();return;}
  try{validateArmy(state.data,state.armies[deckSide]);decks.update(id,{army:clone(state.armies[deckSide])});$('deck-dialog').close();render();notify(`'${d.name}'을(를) 지금 편성으로 덮어썼습니다.`);}
  catch(err){notify(message(err),true);}
};

/* ── 공유 코드·링크 ────────────────────────────────────── */
let codeSide='left',codeMode='share',codeValue='';
const shareUrl=params=>{const u=new URL(location.href);u.search='';u.hash='/battle?'+new URLSearchParams(params).toString();return u.toString();};
// 예전 공유 링크(#s=…&a=…)와 새 링크(#/battle?s=…&a=…)를 모두 읽습니다.
const hashParams=hash=>{const raw=(hash||'').replace(/^#/,'');return new URLSearchParams(raw.startsWith('/')?(raw.split('?')[1]||''):raw);};
async function showCode(side,mode){
  codeSide=side;codeMode=mode;$('code-error').textContent='';
  const ta=$('army-code');
  if(mode==='share'){
    codeValue=await encodeArmyCode(validateArmy(state.data,state.armies[side]),state.season,codeOpts());
    $('code-title').textContent=`${SIDE_NAME[side]} 부대 공유`;
    $('code-help').textContent='코드나 링크를 받은 사람은 같은 편성을 불러와 수정할 수 있습니다. 편성을 바꾸면 새로 공유하세요.';
    ta.readOnly=true;ta.value=codeValue;$('code-submit').textContent='코드 복사';$('code-secondary').hidden=false;
  }else{
    $('code-title').textContent=`${SIDE_NAME[side]} 부대에 코드 불러오기`;
    $('code-help').textContent=`TC1 코드나 공유 링크를 붙여넣으세요. 코드의 시즌이 지금(S${state.season})과 다르면 시즌을 바꾼 뒤 불러옵니다.`;
    ta.readOnly=false;ta.value='';$('code-submit').textContent='편성 불러오기';$('code-secondary').hidden=true;
  }
  $('code-dialog').showModal();if(mode==='import')ta.focus();else ta.select();
}
function extractCode(input){
  const text=input.trim();
  if(text.startsWith('TC1.'))return text;
  try{const p=hashParams(new URL(text).hash);const c=p.get('a')||p.get('b');if(c)return c;}catch{}
  return text;
}
async function applyCode(){
  if(codeMode==='share'){await copyText(codeValue);notify('공유 코드를 복사했습니다.');return;}
  const decoded=await decodeArmyCode(extractCode($('army-code').value));
  if(decoded.season!==state.season)await switchSeason(decoded.season,{keep:true});
  state.armies[codeSide]=loadable(state.data,prep(decoded.army));
  state.view=codeSide;dirty();render();$('code-dialog').close();
  notify(isValid(state.data,state.armies[codeSide])?`${SIDE_NAME[codeSide]} 부대에 편성을 불러왔습니다.`:`${SIDE_NAME[codeSide]} 부대에 불러왔지만 현재 규칙과 맞지 않는 항목이 있습니다. 부대 아래 안내를 보고 고쳐 주세요.`,!isValid(state.data,state.armies[codeSide]));
}
async function shareMatch(){
  for(const s of SIDES){try{validateArmy(state.data,state.armies[s]);}catch(e){throw new Error(`${SIDE_NAME[s]} 부대: ${e.message}`);}}
  const [a,b]=await Promise.all(SIDES.map(s=>encodeArmyCode(state.armies[s],state.season,codeOpts())));
  await copyText(shareUrl({s:state.season,a,b,n:state.maxEng}));notify('두 부대가 담긴 대전 링크를 복사했습니다.');
}
function readHashCodes(){
  if(!location.hash||location.hash.length<6)return null;
  const p=hashParams(location.hash);const a=p.get('a'),b=p.get('b'),n=Number(p.get('n'));
  if(n)state.maxEng=n;
  return a||b?{a,b}:null;
}

/* ── 시즌 전환 ────────────────────────────────────────── */
function syncSeasonUI(){for(const r of document.querySelectorAll('#season-switch input'))r.checked=Number(r.value)===state.season;}
async function switchSeason(season,{keep=false}={}){
  const prev=state.season,prevData=state.data,prevIdx=state.idx;state.season=season;
  try{
    const data=state.api?await state.api.editor(season):await localData(season);
    if(state.api)warnIfServerDiffers(data);
    let kept=false;
    if(!keep){try{acceptData(data);kept=true;}catch{acceptData(data,{reset:true});}}
    else{state.data=data;state.idx=indexData(data);const ex=startArmies(data);SIDES.forEach((s,i)=>{try{loadable(data,state.armies[s]);}catch{state.armies[s]=ex[i];}});}
    syncSeasonUI();return kept;
  }catch(e){state.season=prev;state.data=prevData;state.idx=prevIdx;syncSeasonUI();throw e;}
}

/* ── 전투 ─────────────────────────────────────────────── */
function setRunning(on){
  const b=$('battle');b.classList.toggle('running',on);
  b.replaceChildren(...(on?['계산','중…']:['전투','개시']).map(t=>h('span',{text:t})));
  b.setAttribute('aria-label',on?'전투 계산 중':'전투 개시');
  $('cancel-battle').hidden=!on;
}
async function battle(){
  if(!state.api){openConnection();notify('전투를 계산하려면 서버를 먼저 연결하세요.');return;}
  for(const s of SIDES){try{validateArmy(state.data,state.armies[s]);}catch(e){state.view=s;updateTabs();throw new Error(`${SIDE_NAME[s]} 부대: ${e.message}`);}}
  const [l,r]=await Promise.all(SIDES.map(s=>encodeArmyCode(state.armies[s],state.season,codeOpts())));
  const ctrl=new AbortController();state.battleAbort=ctrl;setRunning(true);
  $('battle-hint').textContent='서버에서 전투를 계산하고 있습니다.';
  const slow=setTimeout(()=>{$('battle-hint').textContent='응답이 늦습니다. 서버가 잠에서 깨는 중일 수 있으니 조금만 기다려 주세요.';notify('서버 응답을 기다리는 중입니다.');},7000);
  try{
    const report=await state.api.battle(l,r,{signal:ctrl.signal,max_engagements:state.maxEng});
    showReport(report);
    $('report-section').scrollIntoView({behavior:reduceMotion()?'instant':'smooth',block:'start'});
    notify('전투가 끝났습니다.');
  }catch(e){if(ctrl.signal.aborted){notify('전투 요청을 취소했습니다.');return;}throw e;}
  finally{clearTimeout(slow);state.battleAbort=null;setRunning(false);updateConnection();}
}

/* ── 전보 ─────────────────────────────────────────────── */
function troopSeries(report){
  const cur={};
  for(const s of SIDES)for(const x of report.armies[s].heroes)cur[`${s}:${x.slot}`]=x.initial_troops;
  const total=s=>Object.entries(cur).reduce((n,[k,v])=>k.startsWith(s+':')?n+v:n,0);
  const series={left:[total('left')],right:[total('right')]};
  const lines=[...report.timeline].sort((a,b)=>a.turn-b.turn||a.order-b.order);let i=0;
  for(let t=1;t<=report.turns;t++){
    while(i<lines.length&&lines[i].turn<=t){const l=lines[i++];if(l.target&&l.remaining_troops!=null&&l.target in cur)cur[l.target]=l.remaining_troops;}
    series.left.push(total('left'));series.right.push(total('right'));
  }
  return series;
}
function turnLabel(report,turn){
  const l=report.timeline.find(x=>x.turn===turn&&x.engagement);
  return l?`${l.engagement}경기 ${l.engagement_turn}턴`:`${turn}턴`;
}
function troopChart(report){
  const series=troopSeries(report),n=report.turns;
  const W=640,H=240,P={l:56,r:18,t:14,b:30},iw=W-P.l-P.r,ih=H-P.t-P.b;
  const max=Math.max(report.armies.left.initial_troops,report.armies.right.initial_troops,1);
  const x=i=>P.l+(n?i/n:0)*iw,y=v=>P.t+ih-(v/max)*ih;
  const svg=sv('svg',{class:'chart',viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':`턴별 총 병력. 아군 ${fmt(series.left[0])}에서 ${fmt(series.left.at(-1))}, 상대 ${fmt(series.right[0])}에서 ${fmt(series.right.at(-1))}.`});
  for(const f of [0,.25,.5,.75,1]){const yy=y(max*f);svg.append(sv('line',{class:'grid',x1:P.l,x2:W-P.r,y1:yy,y2:yy}),sv('text',{class:'axis-label',x:P.l-8,y:yy+4,'text-anchor':'end'},fmt(Math.round(max*f))));}
  const engs=report.engagements||[];
  if(engs.length>1){
    let at=0;
    for(const e of engs){
      if(at>0)svg.append(sv('line',{class:'eng-sep',x1:x(at),x2:x(at),y1:P.t,y2:P.t+ih}));
      svg.append(sv('text',{class:'axis-label',x:x(at),y:H-8,'text-anchor':at===0?'start':'middle'},`${e.number}경기`));
      at+=e.turns;
    }
    svg.append(sv('text',{class:'axis-label',x:x(n),y:H-8,'text-anchor':'end'},`${n}턴`));
  }else for(let i=0;i<=n;i++)svg.append(sv('text',{class:'axis-label',x:x(i),y:H-8,'text-anchor':'middle'},i===0?'시작':`${i}`));
  for(const s of SIDES){
    svg.append(sv('polyline',{class:`line ${s}`,points:series[s].map((v,i)=>`${x(i)},${y(v)}`).join(' ')}));
    series[s].forEach((v,i)=>{const c=sv('circle',{class:`pt ${s}`,cx:x(i),cy:y(v),r:n>16?2.5:3.5});c.append(sv('title',{},`${SIDE_NAME[s]} ${i===0?'시작':turnLabel(report,i)+' 종료'}: ${fmt(v)}`));svg.append(c);});
  }
  return h('section',{class:'panel'},
    h('h4',null,'턴별 총 병력',h('span',{text:(report.engagements?.length>1?'경기 사이 병력 유지 · ':'')+'전보의 잔여 병력 기록으로 계산'})),
    h('div',{class:'chart-wrap'},svg),
    h('div',{class:'legend'},h('span',null,h('i',{class:'dot ally'}),`아군 ${report.armies.left.name}`),h('span',null,h('i',{class:'dot enemy'}),`상대 ${report.armies.right.name}`)));
}
function tableEl(headers,rows){
  return h('div',{class:'table-wrap'},h('table',null,
    h('thead',null,h('tr',null,headers.map(t=>h('th',{scope:'col',text:t})))),
    h('tbody',null,rows.map(r=>h('tr',null,r.map(c=>h('td',null,c)))))));
}
const OUTCOME={
  left_win:{cls:'left',stamp:'勝',label:'승리',prefix:true},right_win:{cls:'right',stamp:'敗',label:'패배',prefix:true},
  left_advantage:{cls:'left',stamp:'優',label:'우세',prefix:true},right_advantage:{cls:'right',stamp:'劣',label:'열세',prefix:true},
  balanced:{cls:'draw',stamp:'均',label:'비등'},draw:{cls:'draw',stamp:'和',label:'무승부'}};
function drawReason(report){
  const pct=s=>report.armies[s].remaining_troops/Math.max(1,report.armies[s].initial_troops)*100;
  const l=pct('left'),r=pct('right'),lead=Math.abs(l-r)<1?null:l>r?'아군':'상대';
  return `${report.turns}턴 안에 승부가 나지 않아 무승부로 판정됐습니다. 승패는 남은 병력 비율이 아니라 제한 턴 안에 상대 부대를 무너뜨렸는지로 정해집니다.`+
    (lead?` 남은 병력은 ${lead}이 우세합니다 (아군 ${l.toFixed(0)}% : 상대 ${r.toFixed(0)}%).`:'');
}
function showReport(report,sample=false){
  state.report=report;state.sample=sample;state.dirty=false;
  const L=report.armies.left,R=report.armies.right;
  // outcome이 없는 옛 전보는 result로 대체합니다.
  const outcome=report.outcome||(report.result==='left'?'left_win':report.result==='right'?'right_win':'draw');
  const o=OUTCOME[outcome]||OUTCOME.draw;
  const label=report.outcome_label||o.label;
  const title=o.prefix?`아군 ${label}`:label;
  const kicker=report.engagement_count?`한국 시즌 ${report.season} · ${report.engagement_count}경기 ${report.turns}턴 · 최대 ${report.max_engagements}경기`:`한국 시즌 ${report.season} · ${report.turns}턴`;
  const pa=report.power_assessment;
  const verdict=h('header',{class:`verdict ${o.cls}`},
    h('div',null,
      h('p',{class:'kicker',text:kicker}),
      h('h3',{text:title}),
      report.result_message?h('p',{class:'why',text:report.result_message}):report.result==='draw'?h('p',{class:'why',text:drawReason(report)}):null,
      pa?.message&&!['left_win','right_win'].includes(outcome)?h('p',{class:'why',text:`${pa.message}${pa.confidence==='uncalibrated'?' (보정 전 추정)':''}`}):null,
      h('div',{class:'chips'},
        h('span',{class:'tag',text:sample?'예시 전보 — 현재 편성과 무관':'추정 전투'}),
        report.limited_support?h('span',{class:'tag warn',text:'일부 효과 반영 제한'}):null,
        h('span',{class:'tag stale',id:'report-stale',hidden:true,text:'편성이 바뀌었습니다 · 이전 결과'}))),
    h('div',{class:'verdict-stamp','aria-hidden':'true',text:o.stamp}));
  const tally=h('div',{class:'tally'},SIDES.map(s=>{
    const a=report.armies[s],pct=Math.max(0,Math.min(100,a.remaining_troops/Math.max(1,a.initial_troops)*100));
    return h('section',{class:`tally-side ${s}`},
      h('h4',null,h('i',{class:'dot'}),`${SIDE_NAME[s]} · ${a.name}`),
      h('p',{class:'tally-num'},fmt(a.remaining_troops),h('small',{text:`/ ${fmt(a.initial_troops)} 잔여 (${pct.toFixed(0)}%)`})),
      h('div',{class:'bar'},h('span',{style:`width:${pct}%`})),
      h('p',{class:'tally-stats'},h('span',null,'가한 피해',h('b',{text:fmt(a.damage)})),h('span',null,'회복',h('b',{text:fmt(a.healing)}))),
      a.combat_power?h('p',{class:'tally-stats'},
        h('span',null,'추정 전투력',h('b',{text:`${fmt(a.combat_power.initial)} → ${fmt(a.combat_power.remaining)}`})),
        h('span',null,'생존 무장',h('b',{text:`${a.combat_power.remaining_survivors}/${a.combat_power.initial_survivors}`}))):null);
  }));
  const heroes=SIDES.flatMap(s=>report.armies[s].heroes.map(x=>({...x,side:s})));
  const maxDmg=Math.max(1,...heroes.map(x=>x.damage));
  const dmg=h('section',{class:'panel'},h('h4',null,'무장별 가한 피해',h('span',{text:'막대 길이는 최고 피해 대비'})),
    h('div',{class:'dmg-list'},heroes.map(x=>h('div',{class:`dmg-row ${x.side}`},
      h('span',{class:'who'},h('i',{class:`dot ${SIDE_CLASS[x.side]}`}),h('span',{text:x.name})),
      h('span',{class:'track',role:'img','aria-label':`${SIDE_NAME[x.side]} ${x.name} 피해 ${fmt(x.damage)}`},h('span',{style:`width:${x.damage/maxDmg*100}%`})),
      h('span',{class:'val',text:fmt(x.damage)})))));
  const heroTable=h('details',{class:'report-detail'},h('summary',{text:'무장별 기록'}),h('div',{class:'inner'},
    tableEl(['무장','잔여 병력','피해','회복','일반 공격'],heroes.map(x=>[h('span',null,h('i',{class:`dot ${SIDE_CLASS[x.side]}`}),x.name,x.romance_trait_id!=null?h('span',{class:'tag legend',text:`연의 ${(state.data.romance_options||[]).find(r=>r.trait_id===x.romance_trait_id)?.name||x.romance_trait_id}`}):null),`${fmt(x.remaining_troops)} / ${fmt(x.initial_troops)}`,fmt(x.damage),fmt(x.healing),fmt(x.normal_attacks)]))));
  const tacticRows=heroes.flatMap(x=>x.tactics.map(t=>[h('span',null,h('i',{class:`dot ${SIDE_CLASS[x.side]}`}),`${x.name} · ${t.name}`),fmt(t.casts),fmt(t.activations),fmt(t.damage),fmt(t.healing)]));
  const tactics=h('details',{class:'report-detail'},h('summary',{text:'전법별 발동 · 피해'}),h('div',{class:'inner'},
    tableEl(['무장 · 전법','시전·등록','효과 발생','피해','회복'],tacticRows),
    h('p',{class:'muted-note',text:'효과 발생 횟수는 추정 모형의 집계로, 게임 화면의 발동 횟수와 다를 수 있습니다.'})));
  const notes=h('details',{class:'report-detail'},h('summary',{text:'추정 결과 안내'}),h('div',{class:'inner'},(report.notices||[]).map(t=>h('p',{class:'muted-note',text:t}))));
  const card=h('article',{class:'report'+(reduceMotion()?'':' reveal')},verdict,tally,engagementPanel(report),troopChart(report),dmg,state.dev?timelineBlock(report):null,heroTable,tactics,notes);
  $('report').replaceChildren(card);$('download-report').disabled=false;
}
const ENG_REASON={turn_limit:'8턴 종료',annihilation:'전멸',mutual_annihilation:'양측 전멸'};
const NEXT={power_advantage:'전력 차이로 재교전',power_balanced:'전력 비등 · 종료',annihilation:'전멸 · 종료',engagement_limit:'경기 수 상한 · 종료'};
const ADV={left:'아군 우세',right:'상대 우세',balanced:'비등',neither:'—'};
function engagementPanel(report){
  const engs=report.engagements||[];if(!engs.length)return null;
  const res=e=>e.result==='left'?'아군 승':e.result==='right'?'상대 승':ENG_REASON[e.reason]||e.reason;
  const rows=engs.map(e=>[`${e.number}경기`,`${e.turns}턴`,res(e),
    `${fmt(e.armies.left.remaining_troops)} / ${fmt(e.armies.left.initial_troops)}`,
    `${fmt(e.armies.right.remaining_troops)} / ${fmt(e.armies.right.initial_troops)}`,
    `${fmt(e.remaining_combat_power.left)} : ${fmt(e.remaining_combat_power.right)}`,
    ADV[e.power_advantage]||'—',NEXT[e.continuation_reason]||(e.rematch?'재교전':'종료')]);
  return h('section',{class:'panel'},
    h('h4',null,'경기별 진행',h('span',{text:`경기당 최대 ${report.max_turns_per_engagement||8}턴 · 병력·부상병 유지, 임시 효과 초기화`})),
    tableEl(['경기','턴','경기 결과','아군 병력','상대 병력','잔존 전투력 (아군:상대)','평가','다음'],rows),
    h('p',{class:'muted-note',text:'전투력은 편성 비교용 추정 점수로, 게임 공식 전투력·승률이 아닙니다. 우세는 전멸 승패가 아닌 추정 평가입니다.'}));
}
function timelineBlock(report){
  const turns=[...new Set(report.timeline.map(l=>l.turn))].sort((a,b)=>a-b);
  const turnSel=sel([{id:'all',name:'모든 턴'},...turns.map(t=>({id:t,name:t===0?'전투 준비':turnLabel(report,t)}))],'all',{'aria-label':'턴 선택'});
  let side='all',core=true;
  const seg=(opts,get,set,label)=>{const g=h('div',{class:'seg',role:'group','aria-label':label});const paint=()=>g.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v===String(get()))));opts.forEach(([v,t])=>g.append(h('button',{type:'button',dataset:{v},text:t,onclick:()=>{set(v);paint();draw();}})));paint();return g;};
  const sideSeg=seg([['all','전체'],['left','아군'],['right','상대']],()=>side,v=>side=v,'진영 필터');
  const coreSeg=seg([['true','핵심만'],['false','모든 기록']],()=>core,v=>core=v==='true','기록 범위');
  const list=h('ol',{class:'timeline'});
  function draw(){
    const want=turnSel.value;list.replaceChildren();let last=null;
    for(const l of report.timeline){
      if(want!=='all'&&String(l.turn)!==want)continue;
      if(l.kind==='turn')continue;
      const s=l.actor?.split(':')[0];
      if(side!=='all'&&s!==side)continue;
      if(core&&(l.kind==='action'||l.kind==='attack'))continue;
      if(l.turn!==last){last=l.turn;list.append(h('li',{class:'turn-head',text:l.turn===0?'전투 준비':l.engagement?`${l.engagement}경기 ${l.engagement_turn}턴`:`${l.turn}턴`}));}
      const amt=l.amount!=null&&(l.kind==='damage'||l.kind==='heal')?h('span',{class:`amt ${l.kind==='damage'?'dmg':'heal'}`,text:`${l.kind==='damage'?'−':'+'}${fmt(l.amount)}`}):h('span');
      list.append(h('li',{class:`line k-${l.kind} ${s||''}`},h('span',{text:l.text}),amt));
    }
    if(!list.children.length)list.append(h('li',{class:'empty',text:'이 조건에 해당하는 기록이 없습니다.'}));
  }
  turnSel.onchange=draw;draw();
  return h('details',{class:'report-detail',open:true},h('summary',{text:`턴별 전보 · ${report.timeline.length}줄`}),h('div',{class:'inner'},h('div',{class:'tl-filters'},turnSel,sideSeg,coreSeg),list));
}

/* ── 이벤트 ───────────────────────────────────────────── */
$('armies').addEventListener('change',onChange);
$('armies').addEventListener('toggle',e=>{
  const d=e.target;if(!(d instanceof HTMLDetailsElement)||!d.dataset.openKey||!d.isConnected)return;
  const was=state.open.has(d.dataset.openKey);
  if(d.open===was)return;
  d.open?state.open.add(d.dataset.openKey):state.open.delete(d.dataset.openKey);
  if(d.open)render();
},true);
$('armies').addEventListener('click',e=>{
  if(state.busy)return;
  const t=e.target.closest('button');if(!t)return;
  const army=t.closest('.army'),side=army?.dataset.side,slot=Number(t.closest('[data-slot]')?.dataset.slot);
  if(t.dataset.deckSave)showDeckSave(t.dataset.deckSave);
  else if(t.dataset.codeMode)task(()=>showCode(t.dataset.side,t.dataset.codeMode));
  else if(t.dataset.alloc)applyEdit(side,slot,'allocation_mode',t.dataset.alloc);
  else if(t.dataset.bookPage)applyEdit(side,slot,'warbook_page',t.dataset.bookPage);
  else if(t.dataset.allocAll){
    for(const x of state.armies[side].heroes)if(!x.total_stats&&Object.values(x.allocation).every(v=>!v)&&state.idx.hero.get(x.hero_id)?.recommended_attribute)x.allocation_mode='recommended';
    dirty();render();notify('배분이 0인 무장을 추천 자동 배분으로 바꿨습니다.');
  }
  else if(t.dataset.pick==='equipment'||t.dataset.pick==='horse')pickItem(side,slot,t.dataset.pick);
  else if(t.dataset.pick==='hero')pickHero(side,slot);
  else if(t.dataset.pick==='tactic')pickTactic(side,slot,Number(t.dataset.index));
  else if(t.dataset.tab){state.tabs.set(`${side}:${slot}`,t.dataset.tab);render();}
});
for(const b of document.querySelectorAll('.board-tabs [data-view]'))b.addEventListener('click',()=>{state.view=b.dataset.view;updateTabs();});
for(const b of document.querySelectorAll('[data-close]'))b.addEventListener('click',()=>$(b.dataset.close).close());
for(const d of document.querySelectorAll('dialog'))d.addEventListener('click',e=>{if(e.target===d)d.close();});

$('theme-toggle').onclick=toggleTheme;
$('open-connection').onclick=openConnection;
$('connection-form').onsubmit=e=>{
  e.preventDefault();$('connection-error').textContent='';
  task(async()=>{
    const api=new BattleApi($('api-url').value.trim()),data=await api.editor(state.season);
    adoptServerData(data);state.api=api;store.set(KEYS.api,api.baseUrl);render();$('connection-dialog').close();notify('전투 서버에 연결했습니다.');
  },'connection-error');
};
$('disconnect').onclick=()=>task(async()=>{
  const data=await localData(state.season);adoptServerData(data);state.api=null;store.set(KEYS.api,null);render();$('connection-dialog').close();notify('서버 연결을 해제했습니다. 편성 모드로 계속합니다.');
},'connection-error');

$('code-submit').onclick=()=>{$('code-error').textContent='';task(applyCode,'code-error');};
$('code-secondary').onclick=()=>task(async()=>{await copyText(shareUrl({s:state.season,a:codeValue}));notify('공유 링크를 복사했습니다. 링크를 연 사람의 아군 부대로 불러옵니다.');},'code-error');

$('picker-search').oninput=renderPicker;
$('picker-chips').onclick=e=>{
  const b=e.target.closest('[data-chip]');if(!b)return;picker.sel[b.dataset.group]=b.dataset.chip;
  b.parentElement.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderPicker();
};
$('picker-list').onclick=e=>{const b=e.target.closest('.pick-opt');if(b&&!b.disabled)finishPick(Number(b.dataset.id));};
$('picker-clear').onclick=()=>finishPick(null);
$('picker-search').onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();$('picker-list').querySelector('.pick-opt:not(:disabled)')?.focus();}if(e.key==='Enter'){e.preventDefault();$('picker-list').querySelector('.pick-opt:not(:disabled)')?.click();}};
$('picker-list').onkeydown=e=>{
  if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();
  const opts=[...$('picker-list').querySelectorAll('.pick-opt:not(:disabled)')],i=opts.indexOf(document.activeElement);
  if(e.key==='ArrowUp'&&i<=0){$('picker-search').focus();return;}
  opts[Math.min(opts.length-1,Math.max(0,i+(e.key==='ArrowDown'?1:-1)))]?.focus();
};

/* ── 보유 풀 메뉴 이벤트 ───────────────────────────────── */
$('pool-tabs').onclick=e=>{const b=e.target.closest('[data-pool-tab]');if(!b)return;poolTab=b.dataset.poolTab;$('pool-search').value='';renderPool();};
$('pool-search').oninput=renderPool;
$('pool-chips').onclick=e=>{const b=e.target.closest('[data-pool-group]');if(!b)return;poolSel[b.dataset.poolGroup]=b.dataset.v;renderPool();};
$('pool-grid').onclick=e=>{
  const b=e.target.closest('[data-pool-id]');if(!b)return;
  const set=poolTab==='heroes'?myPool.heroes:myPool.tactics,id=Number(b.dataset.poolId);
  set.has(id)?set.delete(id):set.add(id);savePool();renderPool();
  $('pool-grid').querySelector(`[data-pool-id="${id}"]`)?.focus();
};
for(const [id,on] of [['pool-all',true],['pool-none',false]])$(id).onclick=()=>{
  const set=poolTab==='heroes'?myPool.heroes:myPool.tactics;
  for(const r of poolRows())on?set.add(r.id):set.delete(r.id);savePool();renderPool();
};
$('preset-search').oninput=()=>{presetSelection=null;renderPresets();};
$('preset-sort').onclick=e=>{const b=e.target.closest('[data-sort]');if(!b)return;presetSort=b.dataset.sort;presetSelection=null;renderPresets();};
$('preset-mode').onclick=e=>{const b=e.target.closest('[data-mode]');if(!b)return;presetMode=b.dataset.mode;presetSelection=null;renderPresets();};
$('preset-seasons').onclick=e=>{const b=e.target.closest('[data-season]');if(!b)return;presetSeason=b.dataset.season==='all'?'all':Number(b.dataset.season);presetSelection=null;renderPresets();};
$('preset-list').onclick=e=>{const b=e.target.closest('[data-template-id]');if(!b)return;presetSelection=b.dataset.templateId;$('preset-list').querySelectorAll('[data-template-id]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));renderPresetPreview();};
$('preset-list').onkeydown=e=>{
  if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;
  const bs=[...$('preset-list').querySelectorAll('[data-template-id]')];if(!bs.length)return;e.preventDefault();
  const i=bs.indexOf(document.activeElement),n=e.key==='Home'?0:e.key==='End'?bs.length-1:Math.max(0,Math.min(bs.length-1,i+(e.key==='ArrowDown'?1:-1)));
  bs[n].focus();bs[n].click();
};
const currentPreset=()=>{const t=presetRows.find(x=>x.id===presetSelection);if(!t)throw new Error('덱을 먼저 고르세요.');return presetArmyFor(t);};
$('preset-lineup-toggle').onclick=toggleLineup;
$('preset-save').onclick=()=>task(async()=>{const {t,army,notes}=currentPreset();decks.add(t.label,army);updateRosterCounts();render();notify(`'${t.label}'을(를) 내 덱에 저장했습니다.${notes.length?` ${notes.join(' · ')}.`:''}`);},'preset-error');
$('preset-base').onclick=()=>task(async()=>{const {t,army,notes}=currentPreset();decks.add(t.label,army,true);sendToBattle(clone(army),'left',`기본 편성으로 지정했습니다. ${presetNote(t,notes,army)}`,!isValid(state.data,army));},'preset-error');
for(const side of SIDES)$(`preset-send-${side}`).onclick=()=>task(async()=>{const {t,army,notes}=currentPreset();sendToBattle(army,side,`${SIDE_NAME[side]}: ${presetNote(t,notes,army)}`,!isValid(state.data,army));},'preset-error');
$('roster-lineup').onclick=e=>{
  const b=e.target.closest('button');if(!b)return;
  const t=b.dataset.tid&&presetRows.find(x=>x.id===b.dataset.tid);
  if(b.dataset.lineupSend&&t){try{const {army,notes}=presetArmyFor(t);sendToBattle(army,b.dataset.lineupSend,`${SIDE_NAME[b.dataset.lineupSend]}: ${presetNote(t,notes,army)}`,!isValid(state.data,army));}catch(err){notify(message(err),true);}}
  else if(b.dataset.lineupView)openPreset(b.dataset.lineupView);
  else if(b.dataset.lineupRemove){saveLineup(readLineup().filter(x=>x.tid!==b.dataset.lineupRemove));recomputeLineup();renderLineupView();notify('내 구성에서 뺐습니다.');}
  else if(b.dataset.lineupClear){saveLineup([]);renderLineupView();notify('내 구성을 비웠습니다.');}
  else if(b.dataset.lineupSaveAll){let n=0;for(const e2 of readLineup()){const tt=presetRows.find(x=>x.id===e2.tid);if(!tt)continue;try{decks.add(tt.label,presetArmyFor(tt).army);n++;}catch{}}updateRosterCounts();render();notify(`${n}개 덱을 내 덱에 저장했습니다.`);}
};
$('roster-decks').onclick=e=>{
  const b=e.target.closest('[data-deck-act]');if(!b)return;
  const {deckAct:act,id}=b.dataset,d=decks.all().find(x=>x.id===id);if(!d)return;
  try{
    if(act==='left'||act==='right'){sendToBattle(loadable(state.data,prep(d.army)),act,`'${d.name}'을(를) ${SIDE_NAME[act]} 부대로 불러왔습니다.`);return;}
    if(act==='base'){decks.update(id,{base:!d.base});notify(d.base?'기본 편성을 해제했습니다.':`'${d.name}'을(를) 기본 편성으로 지정했습니다.`);}
    else if(act==='delete'){
      if(!pendingDeck[id]){Object.keys(pendingDeck).forEach(k=>delete pendingDeck[k]);pendingDeck[id]=true;renderDecksView();return;}
      delete pendingDeck[id];decks.remove(id);notify('덱을 삭제했습니다.');
    }
    renderDecksView();updateRosterCounts();render();
  }catch(err){notify(`이 덱을 쓸 수 없습니다: ${message(err)}`,true);}
};

for(const r of document.querySelectorAll('#season-switch input'))r.addEventListener('change',()=>task(async()=>{
  const kept=await switchSeason(Number(r.value));dirty();render();presetSeason=null;route();
  notify(kept?`한국 시즌 ${state.season}로 바꿨습니다. 현재 편성을 그대로 쓸 수 있습니다.`:`한국 시즌 ${state.season}에서 쓸 수 없는 항목이 있어 예시 편성으로 바꿨습니다.`);
}));

document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b||state.busy)return;
  const a=b.dataset.action;
  if(a==='swap'){[state.armies.left,state.armies.right]=[state.armies.right,state.armies.left];state.open.clear();state.tabs.clear();dirty();render();notify('아군과 상대 편성을 맞바꿨습니다.');}
  else if(a==='reset'){
    if(!state.data)return;const hasBase=Boolean(baseArmy(state.data));
    [state.armies.left,state.armies.right]=startArmies(state.data);state.open.clear();state.tabs.clear();dirty();render();
    notify(hasBase?'아군은 내 기본 편성, 상대는 예시 편성으로 되돌렸습니다.':'두 부대를 예시 편성으로 되돌렸습니다. 내 덱에서 ★ 기본 편성을 지정할 수 있습니다.');
  }
  else if(a==='share-match')task(shareMatch);
});
$('battle').onclick=()=>task(battle);
$('max-eng').onchange=e=>{state.maxEng=Number(e.target.value);store.set(KEYS.eng,String(state.maxEng));};
$('cancel-battle').onclick=()=>state.battleAbort?.abort();
$('example-report').onclick=()=>task(async()=>{
  const res=await fetch('./data/report-example.json');if(!res.ok)throw new Error('예시 전보를 불러오지 못했습니다.');
  showReport(await res.json(),true);$('report-section').scrollIntoView({behavior:reduceMotion()?'instant':'smooth',block:'start'});
});
$('download-report').onclick=()=>{
  if(!state.report)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(state.report,null,2)],{type:'application/json'}));
  const a=h('a',{href:url,download:state.sample?'sample-battle-report.json':`battle-report-${state.report.report_id}.json`});
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('page-origin').textContent=location.origin;
updateRosterCounts();

// 숨김 메뉴: '전투 전보' 제목을 빠르게 3번 누르면 턴별 전보 표시를 켜고 끕니다.
let taps=[];
$('report-heading').addEventListener('click',()=>{
  const now=Date.now();taps=[...taps.filter(t=>now-t<700),now];if(taps.length<3)return;taps=[];
  state.dev=!state.dev;store.set(KEYS.dev,state.dev?'1':null);
  if(state.report)showReport(state.report,state.sample);
  notify(state.dev?'턴별 전보를 표시합니다.':'턴별 전보를 숨겼습니다.');
});

/* ── 메뉴(해시 라우팅) ─────────────────────────────────── */
let guideView=null;
function parseRoute(){
  const raw=location.hash.replace(/^#/,'');
  if(!raw.startsWith('/'))return {view:'battle',parts:[]};
  const parts=raw.split('?')[0].split('/').filter(Boolean);
  return {view:['battle','roster','guides'].includes(parts[0])?parts[0]:'battle',parts:parts.slice(1)};
}
async function route(){
  if(!state.data)return;
  const r=parseRoute();
  for(const v of ['battle','roster','guides'])$(`view-${v}`).hidden=v!==r.view;
  document.querySelectorAll('.main-nav [data-nav]').forEach(a=>a.setAttribute('aria-current',a.dataset.nav===r.view?'page':'false'));
  document.body.dataset.view=r.view;
  try{
    if(r.view==='roster'){
      const sub=['pool','presets','lineup','decks'].includes(r.parts[0])?r.parts[0]:(poolActive()?'presets':'pool');
      await renderRoster(sub);
    }else if(r.view==='guides'){
      if(!guideView){const mod=await import('./guide-view.js');guideView=await mod.createGuideView(guideCtx());}
      await guideView.show(r.parts);
    }
  }catch(error){notify(message(error),true);}
}
function guideCtx(){
  return {state,h,fill,notify,message,clone,prep,loadable,isValid,validateArmy,store,SIDE_NAME,
    poolHeroIds:()=>poolActive()?[...myPool.heroes]:null,
    ensurePresets,openPreset,addTemplatesToLineup,
    sendToBattle:(army,side,text,warn)=>sendToBattle(army,side,text,warn),
    presetsData:()=>presets,
    applyRomance:(side,heroId,traitId)=>{
      if(state.season!==3){notify('연의는 한국 시즌3에서 적용할 수 있습니다. 상단에서 S3로 바꿔 주세요.',true);return false;}
      const hero=state.armies[side].heroes.find(x=>x.hero_id===heroId),name=state.idx.hero.get(heroId)?.name||'해당 무장';
      if(!hero){notify(`${SIDE_NAME[side]} 부대에 ${name}이(가) 없습니다. 배틀에서 ${name}을(를) 편성한 뒤 적용하세요.`,true);return false;}
      applyEdit(side,hero.slot,'romance',traitId);
      const rom=romanceFor(state.data,hero);
      notify(`${SIDE_NAME[side]} ${name}에 연의 '${rom?.name}'을(를) 적용했습니다. 고정 병법은 배틀 → 상세 설정 → 병법 탭에서 고릅니다.`,!isValid(state.data,state.armies[side]));
      return true;
    },
    switchSeason:async n=>{await switchSeason(n);dirty();render();presetSeason=null;}};
}
window.addEventListener('hashchange',route);

/* ── 시작 ─────────────────────────────────────────────── */
async function init(){
  applyTheme();
  await task(async()=>{
    let shared=null;
    const codes=readHashCodes();
    if(codes){
      const [a,b]=await Promise.all([codes.a,codes.b].map(c=>c?decodeArmyCode(c).catch(()=>null):null));
      if(a||b)shared={a,b};else notify('링크에 담긴 공유 코드를 읽지 못했습니다. 기본 편성으로 시작합니다.',true);
      history.replaceState(null,'',location.pathname+location.search+'#/battle');
    }
    const draft=shared?null:readDraft();
    state.season=shared?(shared.a||shared.b).season:draft?.season||2;
    syncSeasonUI();
    acceptData(await localData(state.season),{reset:true});
    if(shared){
      const msgs=[];
      for(const [k,s] of [['a','left'],['b','right']]){
        const dec=shared[k];if(!dec)continue;
        if(dec.season!==state.season){msgs.push(`${SIDE_NAME[s]} 코드는 다른 시즌이라 건너뛰었습니다.`);continue;}
        try{state.armies[s]=loadable(state.data,prep(dec.army));}catch(e){msgs.push(`${SIDE_NAME[s]}: ${e.message}`);}
      }
      notify(msgs.length?msgs.join(' '):'공유받은 편성을 불러왔습니다.',msgs.length>0);
      saveDraft();
    }else if(draft)restoreDraft(draft);
    render();
    const url=savedUrl();
    if(url){
      try{const probe=new BattleApi(url,{timeoutMs:12000});adoptServerData(await probe.editor(state.season));state.api=new BattleApi(probe.baseUrl);render();}
      catch{notify('저장된 서버에 연결하지 못해 기본 편성 데이터로 시작합니다.',true);}
    }
    updateConnection();
  });
  await route();
}
init();
