/** 보유 풀 기반 다부대 추천. 현 시즌의 확인 가능한 티어만 가중하고 기존 저장 데이터는 변경하지 않음. */
import {buildCandidates,recommendLineups} from './planner-core.js';
const $=id=>document.getElementById(id);
export function createPlannerView({state,h,fill,ensurePresets,presetsData,poolSnapshot,readLineup,addTemplatesToLineup,notify}){
  let datasets=null,lastSeason=null;
  const html=(tag,attrs,...children)=>h(tag,attrs,...children);
  async function load(){
    if(datasets)return;
    await ensurePresets();
    const get=async uri=>{const res=await fetch(uri,{cache:'no-cache'});if(!res.ok)throw new Error('추천 참고 데이터 로딩 실패: '+uri);return res.json();};
    const [s2,s3]=await Promise.all([get('./references/data/kr_s2_deck_references.json'),get('./references/data/kr_s3_deck_references.json')]);
    datasets={s2:s2.entries,s3:s3.variants};
  }
  const stat=(label,value)=>html('span',{class:'planner-stat'},html('b',{text:String(value)}),html('small',{text:label}));
  const tags=fit=>html('div',{class:'planner-tags'},
    html('span',{class:'planner-tag tier',text:fit.candidate.tier.label}),
    html('span',{class:`planner-tag ${fit.complete?'owned':'missing'}`,text:`장수 ${fit.ownedHeroes}/3`}),
    fit.skillDefined?html('span',{class:`planner-tag ${fit.skillsComplete?'owned':'missing'}`,text:`보유 전법 ${fit.matchedSkills}/${fit.candidate.skillSlots.length}`}):
    html('span',{class:'planner-tag missing',text:'전법 원문 없음'}),
    html('span',{class:'planner-tag muted',text:fit.candidate.kind==='preset'?'편성 가능한 원본':'참고 세팅'}));
  function entry(fit,index){
    const c=fit.candidate;
    const head=html('header',{class:'planner-entry-header'},html('b',{text:`${index+1}군 · ${c.title}`}),tags(fit));
    const info=html('div',{class:'planner-entry-body'},html('p',{class:'planner-heroes',text:c.heroNames.join(' · ')}));
    if(fit.selected.length){
      const byHero=new Map();for(const line of fit.selected){const key=line.hero;if(!byHero.has(key))byHero.set(key,[]);byHero.get(key).push(line);}
      for(const [hero,lines] of byHero){info.append(html('div',{class:'planner-hero-tactics'},html('strong',{text:hero}),...lines.map(l=>html('p',null,
        `전법${l.slot} · `,
        html('span',{class:l.chosen?'planner-equipped':'planner-unavailable',text:l.chosen?.name||'보유 대안 없음'}),
        l.alternatives.length>1?html('small',{text:` (원문 대안: ${l.alternatives.map(a=>a.name).join(' / ')})`}):null,
        l.unresolved?html('small',{text:' · 미확정 선택지는 제외'}):null))));}
    }else info.append(html('p',{class:'rec-guide-missing',text:'원본에 전법이 기재되지 않아 전법 적합도는 확인할 수 없습니다.'}));
    if(c.tier.source)info.append(html('p',{class:'planner-evidence',text:`티어 근거: ${c.tier.source.split('\n')[0]}`}));
    if(c.kind==='s3-ref')info.append(html('p',{class:'planner-evidence',text:'S3 세팅은 병법·병종·전후열 등 실제 적용을 확인해야 하는 참고자료입니다. 추천 덱 도감에서 전체 세팅을 확인하세요.'}));
    return html('details',{class:'planner-entry'},html('summary',null,head,html('span',{class:'planner-expand',text:'전법·근거 보기 ▾'})),info);
  }
  function planCard(plan,i){
    const templateIds=plan.entries.filter(p=>p.candidate.templateId).map(p=>p.candidate.templateId);
    return html('article',{class:'planner-plan'},
      html('header',{class:'planner-plan-head'},html('h3',{text:i===0?'1순위 부대 구성':`대안 구성 ${i+1}`}),
        stat('구성 부대',plan.entries.length),stat('무장 중복',0),stat('전법 중복',0)),
      html('p',{class:'planner-plan-explain',text:'티어·장수 보유·전법 보유율을 함께 비교한 휴리스틱 추천입니다. 전투 승률이나 최적 조합을 검증한 결과는 아닙니다.'}),
      ...plan.entries.map(entry),
      templateIds.length?html('div',{class:'planner-plan-actions'},html('button',{type:'button',class:'solid-btn',onClick:()=>{
        const added=addTemplatesToLineup(templateIds);
        notify(`${added}개 원본 추천덱을 내 구성에 추가했습니다. 참고 세팅은 자동 편성하지 않습니다.`);
        render();
      },text:`원본 추천덱 ${templateIds.length}개 내 구성에 추가`})):null,
      plan.entries.some(x=>x.candidate.kind!=='preset')?html('p',{class:'planner-caveat',text:'참고 편성은 장수 배치·병법 등 검증 전이므로 자동 저장되지 않습니다. 원본 추천덱만 내 구성에 추가할 수 있습니다.'}):null);
  }
  function render(){
    if(!datasets)return;
    const season=state.season;
    $('planner-season').textContent=`한국 시즌 ${season}`;
    const pool=poolSnapshot();const lineup=readLineup();
    const reserve=$('planner-reserve').checked;
    const reservedHeroes=reserve?lineup.flatMap(e=>e.heroes||[]):[];
    const reservedTactics=reserve?lineup.flatMap(e=>e.tactics||[]):[];
    const candidates=buildCandidates({season,presets:presetsData()?.templates||[],s2:datasets.s2,s3:datasets.s3});
    const result=recommendLineups(candidates,{
      heroes:pool.heroes,tactics:pool.tactics,reservedHeroes,reservedTactics,
      count:Number($('planner-count').value),allowPartial:$('planner-partial').checked});
    fill($('planner-overview'),stat('현재 시즌 후보',candidates.length),stat('보유 장수',pool.heroes.length),stat('보유 전법',pool.tactics.length),stat('조건 충족 후보',result.eligible));
    $('planner-explain').textContent=season===2?
      '시즌2의 T0 > T1+ > T1 순위를 원문이 명시된 조합에만 부여합니다. 동일 장수 조합의 원본 추천덱과 티어표를 연결하고, 전법 없는 티어 조합은 참고 편성으로 구분합니다.':
      season===3?'시즌3에서는 해당 세팅의 맥락에 1·2·3티어가 명시된 경우만 티어로 계산합니다. 나머지는 등급 미기재로 남기고, 세팅마다 대체 전법을 확인합니다.':
      '시즌1 자료에는 검증된 공통 티어가 없어 임의로 등급을 만들지 않습니다. 보유 장수·전법 일치율을 우선합니다.';
    if(!pool.heroes.length){fill($('planner-results'),html('div',{class:'empty-box'},html('p',{text:'보유 장수가 등록되지 않았습니다. 먼저 보유 풀에서 장수를 체크하세요.'}),html('a',{class:'solid-btn small',href:'#/roster/pool',text:'보유 풀 등록하기'})));return;}
    if(!result.plans.length){fill($('planner-results'),html('div',{class:'empty-box'},html('p',{text:'현재 선택한 조건으로 구성 가능한 부대가 없습니다.'}),html('p',{text:'보유 장수 3명이 일치하는 조합이 없다면 ‘미완성 덱도 보기’를 켜거나, 이미 사용 중인 자원을 남겨두지 않도록 옵션을 조정해 보세요.'})));return;}
    fill($('planner-results'),...result.plans.map(planCard));
  }
  async function show(){await load();lastSeason=state.season;render();}
  for(const id of ['planner-count','planner-reserve','planner-partial'])$(id).addEventListener('change',render);
  return {show};
}
