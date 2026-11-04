/* 효과·상태 탐색: 현재 시즌 editor 설명+시즌3 가이드 상태 사전 기반.
 * 필터는 읽기 전용; 보유 풀/내 덱/서버 API는 쓰지 않는다. */
import {buildEffectIndex,searchEffectIndex,effectTypes,sourceTypes,targetSides,targetScopes} from './effect-index.js';

const intents=[['counter','대응·해제'],['apply','상태 부여'],['modify','효과 강화'],['condition','조건 활용'],['all','전체 효과']];
const classOf=k=>k==='negative'||k==='control'?'negative':k==='buff'?'positive':'other';
const text=v=>String(v??'');
export function createEffectExplorer(ctx,glossary){
  const {h,fill,state}=ctx;
  let index=null,lastVersion='',filter={status:'군량 고갈',intent:'counter',source:'all',side:'all',scope:'*',query:'',onlyOwned:false,includeRelated:true};
  let limit=36;
  const root=h('div',{class:'effect-explorer'}),pills=h('div',{class:'effect-status-pills',role:'group','aria-label':'상태효과 빠른 선택'});
  const results=h('div',{class:'effect-result-list'}),resultInfo=h('p',{class:'effect-result-count','aria-live':'polite'});
  const notice=h('p',{class:'effect-index-note'}),more=h('button',{type:'button',class:'ghost-btn effect-more',text:'더 보기'});
  const count=h('span',{class:'effect-index-count'});
  const query=h('input',{type:'search',class:'effect-query',placeholder:'무장·전법명, 대상, 효과 문구 검색','aria-label':'효과 검색어'});
  const statusSelect=h('select',{'aria-label':'상태효과 선택'});
  const intentBar=h('div',{class:'effect-intent-tabs',role:'group','aria-label':'탐색 목적'});
  const sourceSelect=makeSelect('출처', [['all','전체 자료'],...Object.entries(sourceTypes)]);
  const sideSelect=makeSelect('대상 진영',[['all','대상 진영 전체'],...Object.entries(targetSides)]);
  const scopeSelect=makeSelect('대상 수',[['*','단일·일부·전체'],...Object.entries(targetScopes)]);
  const onlyOwned=h('input',{type:'checkbox'}),includeRelated=h('input',{type:'checkbox',checked:true});
  const desc=h('p',{class:'effect-status-definition'}),current=h('strong',{class:'effect-current-state'});
  function makeSelect(label,entries){return h('select',{'aria-label':label},entries.map(([v,t])=>h('option',{value:v,text:t})));}
  function tag(t,cls=''){return h('span',{class:`effect-tag ${cls}`,text:t});}
  const tooltip='이 데이터는 게임 전법 문장에서 자동 색인한 참고 정보입니다. 실제 발동률·제어 해제 판정은 시뮬레이터/전투로그로 검증하세요.';
  fill(root,
    h('div',{class:'effect-heading'},
      h('div',null,h('p',{class:'crumb',text:'전략 연구 · 효과 사전'}),h('h2',{text:'효과·상태 탐색'}),
        h('p',{class:'lead',text:'특정 상태를 거는 전법, 대응·무효화하는 장수와 병법을 한곳에서 찾아봅니다.'})),
      h('a',{class:'ghost-btn small',href:'#/guides',text:'← 문서 가이드'})),
    h('div',{class:'effect-note'},'출처는 현재 시즌의 편성 메타입니다. ',tag('원문에 명시','literal'),
      tag('상태 관계 기반 후보','related'),'는 구분하며, 효과 대상은 자연어 분석 결과라 검수가 필요할 수 있습니다.'),
    h('section',{class:'effect-control-panel','aria-label':'상태효과 필터'},
      h('div',{class:'effect-section-title'},h('strong',{text:'01 · 어떤 상태를 찾으시나요?'}),count),
      pills,
      h('div',{class:'effect-search-row'},
        h('label',{class:'effect-field'},h('span',{text:'상태 선택'}),statusSelect),
        h('label',{class:'effect-field grow'},h('span',{text:'상세 검색'}),query)),
      h('div',{class:'effect-definition'},current,desc),
      h('div',{class:'effect-section-title'},h('strong',{text:'02 · 무엇을 찾으시나요?'})),intentBar,
      h('div',{class:'effect-filter-grid'},
        h('label',{class:'effect-field'},h('span',{text:'자료 종류'}),sourceSelect),
        h('label',{class:'effect-field'},h('span',{text:'적용 대상'}),sideSelect),
        h('label',{class:'effect-field'},h('span',{text:'대상 수'}),scopeSelect)),
      h('div',{class:'effect-flags'},
        h('label',{class:'check-row'},includeRelated,'범용 제거·정신 회복 등 간접 대응도 포함'),
        h('label',{class:'check-row'},onlyOwned,'보유 장수·학습 전법만 (병법 제외)')),
      notice),
    h('section',{class:'effect-results','aria-label':'효과 검색 결과'},resultInfo,results,more),
    h('p',{class:'effect-disclaimer',text:tooltip})
  );

  function drawPills(){
    const preferred=['군량 고갈','무장 해제','침묵','혼란','공포','허약','정신 회복','연타','방어','반격'];
    const names=preferred.filter(s=>index.dictionary.some(x=>x.name===s));
    fill(pills,names.map(s=>h('button',{type:'button',class:'effect-status-pill','aria-pressed':String(filter.status===s),
      onclick:()=>{filter.status=s;statusSelect.value=s;limit=36;drawPills();drawResults();},text:s})));
  }
  function drawIntents(){fill(intentBar,intents.map(([v,t])=>h('button',{type:'button',class:'effect-intent-tab','aria-pressed':String(filter.intent===v),
    onclick:()=>{filter.intent=v;limit=36;drawIntents();drawResults();},text:t})));}
  function drawResults(){
    if(!index)return;
    const def=index.dictionary.find(x=>x.name===filter.status);
    current.textContent=def?.name||'전체 효과';desc.textContent=def?.description||'';
    const ownedHeroes=ctx.poolHeroIds()?.map(Number)||null, ownedTactics=ctx.poolTacticIds?.()?.map(Number)||null;
    onlyOwned.disabled=!ownedHeroes;
    if(!ownedHeroes){onlyOwned.checked=false;filter.onlyOwned=false;}
    const found=searchEffectIndex(index,{...filter,ownedHeroes:ownedHeroes?new Set(ownedHeroes):null,ownedTactics:ownedTactics?new Set(ownedTactics):null});
    resultInfo.textContent=`${found.length.toLocaleString()}건 검색 · 한국 시즌 ${index.season} · ${found.filter(x=>x.related).length}건은 간접 대응 후보`;
    const list=found.slice(0,limit);
    fill(results,list.length?list.map(r=>effectCard(r)):h('div',{class:'effect-empty'},h('strong',{text:'조건에 맞는 효과를 찾지 못했습니다.'}),
      h('p',{text:'대상 진영을 전체로 바꾸거나, ‘전체 효과’에서 원문 언급도 확인해 보세요.'})));
    more.hidden=found.length<=limit;
    more.textContent=`더 보기 (${found.length-limit}건 남음)`;
  }
  function effectCard(r){
    const related=r.related;
    const tags=[tag(sourceTypes[r.source_type]||r.source_type),
      tag(related?'간접 대응 후보':effectTypes[r.role]||'효과 언급',related?'indirect':r.role==='apply'?'applied':''),
      tag(`${targetSides[r.target.side]} · ${targetScopes[r.target.scope]}`),
      ...(r.target.kind==='context'?[tag('대상 문맥 추정','inferred')]:[]),
      ...(r.source_effect_status==='estimated'?[tag('전투 계산 추정','inferred')]:[])];
    const detail=h('details',{class:'effect-original'},h('summary',{text:'전법 전체 원문 보기'}),h('p',{text:r.full_description}));
    return h('article',{class:'effect-card'},
      h('div',{class:'effect-card-top'},
        h('div',null,h('strong',{class:'effect-source-name',text:r.source_name}),r.skill_name?h('span',{class:'effect-skill-name',text:` · ${r.skill_name}`}):null),
        h('span',{class:'effect-source-id',text:`ID ${r.source_id}`})),
      h('div',{class:'effect-tags'},tags),
      h('p',{class:'effect-match-text',text:r.description}),
      r.target.selector?h('p',{class:'effect-target-note',text:`대상 선정: ${r.target.selector}`}):null,
      related?h('p',{class:'effect-related-note',text:r.relation}):null,
      detail);
  }
  function initialize(){
    if(!index||index.data_version!==state.data?.data_version||index.season!==state.season){
      index=buildEffectIndex(state.data,glossary);
      lastVersion=index.data_version;
      const popular=['군량 고갈','무장 해제','침묵','혼란','공포','허약','정신 회복','연타'];
      if(!index.dictionary.some(x=>x.name===filter.status))filter.status=popular.find(s=>index.dictionary.some(x=>x.name===s))||index.dictionary[0]?.name||'';
      fill(statusSelect,index.dictionary.map(x=>h('option',{value:x.name,text:`${x.name} (${x.tags.includes('control')?'제어':x.tags.includes('negative')?'디버프':x.tags.includes('buff')?'버프':'기타'})`})));
      statusSelect.value=filter.status;
      count.textContent=`${index.dictionary.length}개 상태 · ${index.source_count}개 원문 자료`;
      notice.textContent=`색인 버전: ${index.data_version} · 한국 시즌 ${index.season}. 현재 페이지의 editor 메타를 즉시 색인합니다. 원문의 확률·수치는 그대로 보존합니다.`;
    }
    drawPills();drawIntents();drawResults();
  }
  statusSelect.onchange=()=>{filter.status=statusSelect.value;limit=36;drawPills();drawResults();};
  query.oninput=()=>{filter.query=query.value;limit=36;drawResults();};
  sourceSelect.onchange=()=>{filter.source=sourceSelect.value;limit=36;drawResults();};
  sideSelect.onchange=()=>{filter.side=sideSelect.value;limit=36;drawResults();};
  scopeSelect.onchange=()=>{filter.scope=scopeSelect.value;limit=36;drawResults();};
  includeRelated.onchange=()=>{filter.includeRelated=includeRelated.checked;limit=36;drawResults();};
  onlyOwned.onchange=()=>{filter.onlyOwned=onlyOwned.checked;limit=36;drawResults();};
  more.onclick=()=>{limit+=36;drawResults();};
  return {element:root,show:initialize,getIndex:()=>index};
}
