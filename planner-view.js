/** 보유 풀 기반 다부대 추천. 현 시즌의 확인 가능한 티어만 가중하고 기존 저장 데이터는 변경하지 않음. */
import {buildCandidates,recommendLineups} from './planner-core.js';
const $=id=>document.getElementById(id);
export function createPlannerView({state,h,fill,ensurePresets,presetsData,poolSnapshot,readLineup,addTemplatesToLineup,savePlanDrafts,notify}){
  let datasets=null;
  const html=(tag,attrs,...children)=>h(tag,attrs,...children);
  async function load(){
    if(datasets)return;
    await ensurePresets();
    const get=async uri=>{const res=await fetch(uri,{cache:'no-cache'});if(!res.ok)throw new Error('추천 참고 데이터 로딩 실패: '+uri);return res.json();};
    const [s2,s3]=await Promise.all([get('./references/data/kr_s2_deck_references.json'),get('./references/data/kr_s3_deck_references.json')]);
    datasets={s2:s2.entries,s3:s3.variants};
  }
  const stat=(label,value)=>html('span',{class:'planner-stat'},html('b',{text:String(value)}),html('small',{text:label}));
  const meter=(label,have,total)=>html('span',{class:'planner-meter'},html('b',{text:`${have}/${total}`}),html('small',{text:label}));
  const tags=fit=>html('div',{class:'planner-tags'},
    html('span',{class:'planner-tag tier',text:fit.candidate.tier.label}),
    html('span',{class:`planner-tag ${fit.complete?'owned':'missing'}`,text:`장수 ${fit.ownedHeroes}/3`} ),
    fit.skillDefined?html('span',{class:`planner-tag ${fit.skillsComplete?'owned':'missing'}`,text:`전법 ${fit.matchedSkills}/${fit.candidate.skillSlots.length}`}):
      html('span',{class:'planner-tag missing',text:'전법 원문 없음'}),
    html('span',{class:'planner-tag muted',text:fit.candidate.kind==='preset'?'원본 추천덱':'참고 세팅'}));
  function entry(fit,index){
    const c=fit.candidate;
    const header=html('header',{class:'planner-entry-header'},
      html('div',{class:'planner-entry-heading'},html('b',{text:`${index+1}군 · ${c.title}`}),html('p',{class:'planner-heroes',text:c.heroNames.join(' · ')})),
      html('div',{class:'planner-entry-stats'},meter('장수',fit.ownedHeroes,3),fit.skillDefined?meter('전법',fit.matchedSkills,c.skillSlots.length):null));
    const info=html('div',{class:'planner-entry-body'},tags(fit));
    if(fit.selected.length){
      const byHero=new Map();
      for(const line of fit.selected){if(!byHero.has(line.hero))byHero.set(line.hero,[]);byHero.get(line.hero).push(line);}
      for(const [hero,lines] of byHero){
        info.append(html('div',{class:'planner-hero-tactics'},html('strong',{text:hero}),...lines.map(l=>html('p',null,
          `전법${l.slot} · `,
          html('span',{class:l.chosen?'planner-equipped':'planner-unavailable',text:l.chosen?.name||'비워 둠'}),
          l.alternatives.length?html('small',{text:` (원문 후보: ${l.alternatives.map(a=>a.name).join(' / ')})`}):null,
          l.unresolved?html('small',{text:' · 미확정 선택지 제외'}):null))));
      }
    }else info.append(html('p',{class:'rec-guide-missing',text:'원본에 전법이 기재되지 않아 전법 적합도는 확인할 수 없습니다.'}));
    if(c.tier.source)info.append(html('p',{class:'planner-evidence',text:`티어 근거: ${c.tier.source.split('\n')[0]}`}));
    if(c.kind!=='preset')info.append(html('p',{class:'planner-evidence',text:'참고 세팅은 실제 배치·병법·장비를 검수해야 합니다. 저장 시 채울 수 있는 칸만 채운 초안으로 들어갑니다.'}));
    return html('details',{class:'planner-entry',open:index===0},html('summary',null,header,html('span',{class:'planner-expand',text:'세부 보기 ▾'})),info);
  }
  function planCard(plan,i){
    const templateIds=plan.entries.filter(p=>p.candidate.templateId).map(p=>p.candidate.templateId);
    const totalHeroes=plan.entries.reduce((n,e)=>n+e.ownedHeroes,0);
    const totalSkills=plan.entries.reduce((n,e)=>n+e.matchedSkills,0);
    const totalSkillSlots=plan.entries.reduce((n,e)=>n+e.candidate.skillSlots.length,0);
    return html('article',{class:'planner-plan war-card'},
      html('header',{class:'planner-plan-head'},
        html('div',null,html('h3',{text:i===0?'1순위 최적 5군':`대안 조합 ${i+1}`}),html('p',{class:'planner-plan-explain',text:'장수/전법 적합도, 원문 티어, 대체 전법 반영 여부를 함께 비교한 결과입니다.'})),
        html('div',{class:'planner-plan-head-stats'},stat('구성 부대',plan.entries.length),stat('보유 무장 충족',`${totalHeroes}/15`),stat('보유 전법 충족',totalSkillSlots?`${totalSkills}/${totalSkillSlots}`:'미기재'))),
      html('div',{class:'planner-plan-actions'},
        html('button',{type:'button',class:'solid-btn',onClick:async()=>{
          try{const saved=await savePlanDrafts(plan.entries);notify(`${saved}개 덱 초안을 내 덱에 저장했습니다.`);}catch(err){notify(err.message||String(err),true);}
        },text:'이 조합을 내 덱 초안으로 저장'}),
        templateIds.length?html('button',{type:'button',class:'ghost-btn',onClick:()=>{const added=addTemplatesToLineup(templateIds);notify(`${added}개 원본 추천덱을 내 구성에 추가했습니다.`);render();},text:`원본 추천덱 ${templateIds.length}개 내 구성에 추가`}):null),
      html('div',{class:'planner-plan-list'},...plan.entries.map(entry))
    );
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
      count:Number($('planner-count').value),allowPartial:$('planner-partial').checked,tacticCatalog:state.idx?.tactic||new Map()});
    fill($('planner-overview'),stat('후보 덱',candidates.length),stat('보유 장수',pool.heroes.length),stat('보유 전법',pool.tactics.length),stat('조건 충족 후보',result.eligible));
    $('planner-explain').textContent=season===2?
      '시즌2는 T0 > T1+ > T1 원문 티어를 우선 반영합니다. 같은 장수 조합이라도 원본 추천덱과 티어표 참고 세팅을 함께 훑고, 투영/반전 등 같은 계열의 보유 전법도 사용 가능한 후보로 계산합니다.':
      season===3?'시즌3은 세팅 문맥에 명시된 1·2·3티어만 가중합니다. 세팅별 대체 전법과 상성 메모를 유지하며, 채울 수 없는 슬롯은 비워 둔 초안으로 저장할 수 있습니다.':
      '시즌1은 공통 티어가 없어 장수·전법 적합도를 우선합니다.';
    if(!pool.heroes.length){fill($('planner-results'),html('div',{class:'empty-box'},html('p',{text:'보유 장수가 등록되지 않았습니다. 먼저 보유 풀에서 장수를 체크하세요.'}),html('a',{class:'solid-btn small',href:'#/roster/pool',text:'보유 풀 등록하기'})));return;}
    if(!result.plans.length){fill($('planner-results'),html('div',{class:'empty-box'},html('p',{text:'현재 조건으로 묶을 수 있는 추천 조합이 없습니다.'}),html('p',{text:'미완성 덱도 보기 옵션을 켜거나, 내 구성에서 사용 중인 자원을 제외하지 않도록 바꿔 보세요.'})));return;}
    fill($('planner-results'),...result.plans.map(planCard));
  }
  async function show(){await load();render();}
  for(const id of ['planner-count','planner-reserve','planner-partial'])$(id).addEventListener('change',render);
  return {show};
}
