import {MATCHUP_BOARD} from './matchup-board-data.js';
const familyOf=v=>String(v?.label||'').split(' · ')[0].trim();
const normalize=s=>String(s??'').replace(/\s+/g,'').toLocaleLowerCase('ko');
export function createMatchupBoardView({h,fill,notify}){
  const host=document.getElementById('matchup-board');
  let refs=null,selection=MATCHUP_BOARD[0]?.key||null;
  const byBoardKey=key=>MATCHUP_BOARD.find(x=>x.key===key)||MATCHUP_BOARD[0];
  async function load(){
    if(refs)return;
    const res=await fetch('./references/data/kr_s3_deck_references.json',{cache:'no-cache'});
    if(!res.ok)throw new Error('상성표 참고 세팅을 불러오지 못했습니다.');
    refs=await res.json();
  }
  function relatedVariants(item){
    const aliases=new Set(item.aliases.map(normalize));
    return (refs?.variants||[]).filter(v=>aliases.has(normalize(familyOf(v))));
  }
  function noteCard(v){
    const members=(v.members||[]).map(m=>m.general).join(' · ');
    const lines=[];
    if(v.presentation_label)lines.push(v.presentation_label);
    if(v.formation)lines.push(v.formation);
    return h('details',{class:'matchup-setup-card'},
      h('summary',null,
        h('div',null,h('strong',{text:v.label}),h('p',{class:'matchup-setup-meta',text:members})),
        h('span',{class:'matchup-setup-badge',text:'세팅 보기'})),
      h('div',{class:'matchup-setup-body'},
        lines.length?h('p',{class:'matchup-setup-summary',text:lines.join(' · ')}):null,
        ...(v.notes||[]).slice(0,2).map(n=>h('p',{text:n})),
        ...(v.members||[]).map(m=>h('div',{class:'matchup-member-line'},
          h('strong',{text:m.general}),
          h('span',{text:(m.learned_choices||[]).map(c=>c.text).join(' / ')||'전법 원문 미기재'})))));
  }
  function relationBlock(title,list,klass){
    return h('section',{class:`matchup-relation ${klass}`},h('h3',{text:title}),h('div',{class:'matchup-chip-list'},...list.map(name=>h('span',{class:`matchup-chip ${klass}`,text:name}))));
  }
  function render(){
    const item=byBoardKey(selection);
    const setups=relatedVariants(item);
    fill(host,
      h('div',{class:'matchup-shell war-card'},
        h('aside',{class:'matchup-nav'},
          h('div',{class:'matchup-nav-head'},h('strong',{text:'대표 덱 목록'}),h('small',{text:'덱 선택'})),
          ...MATCHUP_BOARD.map(row=>h('button',{type:'button',class:`matchup-nav-item ${row.key===item.key?'is-active':''}`,dataset:{matchupKey:row.key}},
            h('span',{class:'matchup-nav-title',text:row.label}),
            h('small',{text:row.heroes})))),
        h('section',{class:'matchup-detail'},
          h('div',{class:'matchup-hero'},
            h('div',null,h('p',{class:'matchup-kicker',text:'상성 요약'}),h('h2',{text:item.label}),h('p',{class:'matchup-line',text:`${item.heroes} · ${item.build}`})),
            h('div',{class:'matchup-detail-actions'},h('span',{class:'matchup-count-badge',text:`관련 세팅 ${setups.length}개`}))),
          h('p',{class:'matchup-disclaimer',text:'첨부된 상성표 캡처와 기존 시즌3 상성 메타를 바탕으로 만든 표시용 요약입니다. 대표 관계를 빠르게 보는 목적이며, 실제 전투 결과를 보장하지 않습니다.'}),
          h('div',{class:'matchup-grid'},relationBlock('유리',item.good,'good'),relationBlock('불리',item.bad,'bad')),
          h('section',{class:'matchup-setup-list'},h('h3',{text:'관련 세팅 정보'}),
            setups.length?setups.map(noteCard):h('p',{class:'rec-guide-empty',text:'연결된 세팅 정보를 찾지 못했습니다.'})))));
  }
  host?.addEventListener('click',e=>{
    const btn=e.target.closest('[data-matchup-key]');
    if(!btn)return;
    selection=btn.dataset.matchupKey;render();
  });
  async function show(){await load();render();}
  return {show};
}
