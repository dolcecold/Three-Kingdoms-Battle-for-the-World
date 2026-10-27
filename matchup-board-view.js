/** 대표 상성 관계도 — 캡처 요약과 원문 메타를 구분해서 표시한다. */
import {MATCHUP_BOARD} from './matchup-board-data.js';
const familyOf=v=>String(v?.label||'').split(' · ')[0].trim();
const normalize=s=>String(s??'').replace(/\s+/g,'').toLocaleLowerCase('ko');
const $=id=>document.getElementById(id);
export function createMatchupBoardView({h,fill,notify}){
  const host=$('matchup-board');
  let refs=null,selection=MATCHUP_BOARD[0].key,selectedNode=null,detailOpen=false,focusBefore=null;
  const getKey=key=>MATCHUP_BOARD.find(row=>row.key===key)||null;
  const setupOf=term=>{
    const exact=MATCHUP_BOARD.find(item=>normalize(item.label)===normalize(term)||item.aliases.some(name=>normalize(name)===normalize(term)));
    if(!exact)return [];
    const aliases=new Set(exact.aliases.map(normalize));
    return (refs?.variants||[]).filter(v=>aliases.has(normalize(familyOf(v))));
  };
  const variantsOf=key=>{const row=getKey(key);return row?setupOf(row.label):[];};
  const pick=term=>MATCHUP_BOARD.find(item=>normalize(item.label)===normalize(term)||item.aliases.some(a=>normalize(a)===normalize(term)));
  async function load(){if(refs)return;const res=await fetch('./references/data/kr_s3_deck_references.json',{cache:'no-cache'});if(!res.ok)throw new Error('상성표 참고 세팅을 불러오지 못했습니다.');refs=await res.json();}
  function detailMember(m){
    const lines=[];
    const choices=(label,rows)=>{for(const row of rows||[])lines.push(h('div',{class:'war-setup-line'},h('b',{text:`${label} ${row.slot??''}`}),h('span',{text:(row.options||[]).map(o=>o.text).join(' / ')||row.text||'미기재'})));};
    choices('전법',m.learned_choices);choices('병법',m.warbook_choices);
    for(const [label,key] of [['병종','troop'],['장비','gear'],['말','horse'],['스탯','attributes'],['배치 메모','position']]){
      const v=m.fields?.[key];if(v)lines.push(h('div',{class:'war-setup-line'},h('b',{text:label}),h('span',{text:v})));
    }
    return h('section',{class:'war-setup-member'},h('h4',{text:m.general}),...lines);
  }
  function setupCard(v){
    return h('details',{class:'war-setup'},
      h('summary',null,h('span',{class:'war-leaf-glyph',text:'▤'}),h('strong',{text:v.label}),h('small',{text:'펼쳐보기'})),
      h('div',{class:'war-setup-content'},
        h('p',{text:(v.members||[]).map(m=>m.general).join(' · ')}),
        ...((v.members||[]).map(detailMember)),
        ...(v.notes||[]).slice(0,3).map(n=>h('p',{class:'war-setup-note',text:n})),
        h('a',{href:`#/recommendations?source=s3&id=${encodeURIComponent(v.id)}`,class:'war-link',text:'추천덱 도감에서 전체 세팅 보기 →'})));
  }
  function showNode(term,kind){
    selectedNode={term,kind};focusBefore=document.activeElement;
    const modal=$('war-matchup-modal'),target=$('war-matchup-modal-body');
    const match=pick(term),setups=setupOf(term);
    fill(target,
      h('p',{class:'war-overline',text:kind==='center'?'현재 기준 덱':kind==='good'?'선택 덱에 불리한 대상':'선택 덱에 유리한 대상'}),
      h('h2',{id:'war-matchup-modal-title',text:term}),
      h('p',{class:'war-modal-description',text:match?match.heroes:'덱 유형/편성 분류로 기록된 이름이며 특정 세팅으로 확정할 수 없습니다.'}),
      h('div',{class:'war-modal-tools'},
        match?h('button',{type:'button',class:'war-primary-action',dataset:{warCenter:match.key},text:'이 덱을 중심으로 상성 보기'}):null,
        h('span',{class:'war-source-label',text:`연결된 참고 세팅 ${setups.length}개`})),
      setups.length?h('section',{class:'war-modal-setups'},h('h3',{text:'관련 추천 세팅'}),...setups.map(setupCard)):
        h('p',{class:'war-empty-note',text:'현재 메타에서 해당 이름에 직접 연결되는 개별 세팅을 확인할 수 없습니다. 상대 유형을 단일 덱으로 간주하지 않습니다.'}));
    modal.hidden=false;document.body.classList.add('war-modal-lock');modal.querySelector('[data-war-close]').focus({preventScroll:true});detailOpen=true;
  }
  function closeNode(){if(!detailOpen)return;$('war-matchup-modal').hidden=true;document.body.classList.remove('war-modal-lock');detailOpen=false;focusBefore?.focus?.({preventScroll:true});}
  function sideNodes(list,kind){
    return list.map((name,i)=>h('button',{type:'button',class:`war-diagram-node ${kind}`,dataset:{warNode:name,warKind:kind},title:`${name}의 세팅 보기`},
      h('span',{class:'war-diagram-index',text:String(i+1).padStart(2,'0')}),h('span',{class:'war-diagram-name',text:name}),h('span',{class:'war-diagram-node-arrow',text:'↗'})));
  }
  function makeWires(){
    const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg');svg.setAttribute('class','war-diagram-wires');svg.setAttribute('aria-hidden','true');
    const defs=document.createElementNS(ns,'defs');svg.append(defs);
    for(const [kind,color] of [['good','#67d1ad'],['bad','#ed826d']]){
      const marker=document.createElementNS(ns,'marker');
      for(const [k,v] of Object.entries({id:`war-arrow-${kind}`,viewBox:'0 0 10 10',refX:'9',refY:'5',markerWidth:'7',markerHeight:'7',orient:'auto-start-reverse'}))marker.setAttribute(k,v);
      const arrow=document.createElementNS(ns,'path');arrow.setAttribute('d','M 0 0 L 10 5 L 0 10 z');arrow.setAttribute('fill',color);marker.append(arrow);defs.append(marker);
    }
    return svg;
  }
  function render(){
    const item=getKey(selection)||MATCHUP_BOARD[0];selection=item.key;
    const names=variantsOf(item.key);const count=item.good.length+item.bad.length;
    const diagram=h('section',{class:'war-diagram', 'aria-label':`${item.label} 상성 관계도`},
      h('div',{class:'war-diagram-top'},h('p',{class:'war-overline',text:'戰術 相剋圖 · BATTLE MATCHUPS'}),
        h('h2',{text:'상성 관계도'}),h('p',{class:'war-diagram-help',text:'화살표 방향이 유리한 쪽에서 불리한 쪽을 향합니다. 상대 덱을 누르면 관련 세팅을 볼 수 있습니다.'})),
      h('div',{class:'war-diagram-network'},
        makeWires(),
        h('div',{class:'war-diagram-center'},
          h('span',{class:'war-center-seal','aria-hidden':'true',text:'將'}),
          h('span',{class:'war-overline',text:'대상 부대'}),h('h3',{text:item.label}),h('p',{text:item.heroes}),
          h('small',{text:`${item.build} · 참고 세팅 ${names.length}개`}),
          h('button',{type:'button',class:'war-center-action',dataset:{warNode:item.label,warKind:'center'},text:'이 덱 세팅 보기 →'})),
        h('div',{class:'war-diagram-side bad'},
          h('div',{class:'war-diagram-side-title'},h('strong',{text:'나에게 불리'}),h('span',{text:`${item.bad.length} 유형`})),
          h('div',{class:'war-diagram-nodes'},...sideNodes(item.bad,'bad'))),
        h('div',{class:'war-diagram-side good'},
          h('div',{class:'war-diagram-side-title'},h('strong',{text:'내가 유리'}),h('span',{text:`${item.good.length} 유형`})),
          h('div',{class:'war-diagram-nodes'},...sideNodes(item.good,'good')))),
      h('div',{class:'war-diagram-legend'},
        h('span',null,h('i',{class:'war-legend-dot bad'}),'불리 · 상대가 우세'),
        h('span',null,h('i',{class:'war-legend-dot good'}),'유리 · 내가 우세')));
    fill(host,
      h('div',{class:'war-board-wrap'},
        h('section',{class:'war-board-picker'},h('div',{class:'war-board-picker-heading'},
          h('div',null,h('p',{class:'war-overline',text:'진형 선택'}),h('h3',{text:'기준 덱을 선택하세요'})),
          h('small',{text:`대표 덱 ${MATCHUP_BOARD.length}개`})),
          h('div',{class:'war-board-catalog'},...MATCHUP_BOARD.map((row,i)=>h('button',{type:'button',class:'war-board-select'+(row.key===selection?' active':''),dataset:{warSelect:row.key},'aria-pressed':String(row.key===selection)},
            h('span',{class:'war-board-num',text:String(i+1).padStart(2,'0')}),h('span',{class:'war-board-select-label',text:row.label}),h('small',{text:row.heroes}))))),
        diagram,
        h('p',{class:'war-board-source',text:'근거: 제공된 2026-10-26 게임 내 상성 요약 캡처와 현재 시즌3 세팅 메타. 유형끼리의 대표 상성으로, 승률 수치 및 개별 세팅의 확정 우위는 아닙니다.'})));
    // Layout measurements happen after DOM insertion. Lines are decorative only; buttons remain interactive if unavailable.
    requestAnimationFrame(drawWires);
  }
  function drawWires(){
    const box=host.querySelector('.war-diagram-network'),svg=box?.querySelector('.war-diagram-wires');if(!box||!svg)return;
    const rect=box.getBoundingClientRect();if(!rect.width||!rect.height)return;
    svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);svg.setAttribute('preserveAspectRatio','none');
    while(svg.lastChild&&svg.lastChild.tagName?.toLowerCase()!=='defs')svg.lastChild.remove();
    const center=box.querySelector('.war-diagram-center')?.getBoundingClientRect();if(!center)return;
    const mobile=matchMedia('(max-width:800px)').matches;
    for(const kind of ['bad','good']){
      const side=box.querySelector(`.war-diagram-side.${kind}`);
      const targets=mobile?[side?.querySelector('.war-diagram-side-title')].filter(Boolean):[...side.querySelectorAll(`.war-diagram-node.${kind}`)];
      for(const node of targets){
        const target=node.getBoundingClientRect();
        let x1,y1,x2,y2;
        if(mobile){
          x1=center.left+center.width/2-rect.left;y1=center.bottom-rect.top;
          x2=target.left+target.width/2-rect.left;y2=target.top-rect.top;
          if(kind==='bad'){[x1,x2]=[x2,x1];[y1,y2]=[y2,y1];}
        }else if(kind==='bad'){
          x1=target.right-rect.left;y1=target.top+target.height/2-rect.top;
          x2=center.left-rect.left;y2=center.top+center.height/2-rect.top;
        }else{
          x1=center.right-rect.left;y1=center.top+center.height/2-rect.top;
          x2=target.left-rect.left;y2=target.top+target.height/2-rect.top;
        }
        const delta=Math.max(30,Math.abs(x2-x1)*.45);
        const d=mobile?`M ${x1} ${y1} Q ${(x1+x2)/2} ${(y1+y2)/2}, ${x2} ${y2}`:
          `M ${x1} ${y1} C ${x1+delta} ${y1}, ${x2-delta} ${y2}, ${x2} ${y2}`;
        const path=document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d',d);path.setAttribute('class',`war-wire ${kind}`);
        path.setAttribute('marker-end',`url(#war-arrow-${kind})`);svg.append(path);
      }
    }
  }
  host.addEventListener('click',e=>{
    const select=e.target.closest('[data-war-select]');if(select){selection=select.dataset.warSelect;render();return;}
    const node=e.target.closest('[data-war-node]');if(node){showNode(node.dataset.warNode,node.dataset.warKind);return;}
  });
  const modal=h('div',{class:'war-modal-overlay',id:'war-matchup-modal',hidden:true},
    h('div',{class:'war-modal-shade',dataset:{warClose:'1'}}),
    h('section',{class:'war-modal-panel',role:'dialog','aria-modal':'true','aria-labelledby':'war-matchup-modal-title'},
      h('div',{class:'war-modal-head'},h('strong',{text:'軍略 · 덱 상세'}),h('button',{type:'button',class:'war-modal-close',dataset:{warClose:'1'},text:'닫기 ×'})),
      h('div',{id:'war-matchup-modal-body',class:'war-modal-body'})));
  document.body.append(modal);
  modal.addEventListener('click',e=>{
    if(e.target.closest('[data-war-close]')){closeNode();return;}
    if(e.target.closest('a[href^="#/recommendations"]')){closeNode();return;}
    const center=e.target.closest('[data-war-center]');if(center){selection=center.dataset.warCenter;closeNode();render();host.scrollIntoView({block:'start'});return;}
  });
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&detailOpen){e.preventDefault();closeNode();}});
  window.addEventListener('resize',()=>{if(!host.closest('[hidden]'))requestAnimationFrame(drawWires);},{passive:true});
  async function show(){await load();render();}
  return {show};
}
