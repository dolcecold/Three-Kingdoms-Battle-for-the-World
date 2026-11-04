/* 천하결전 설명 기반 효과 색인 v1 — 순수 함수, 사용자 데이터/서버 저장 없음.
 * 주의: 자연어 설명에서의 판정은 계산 엔진 검증이 아니라 검색 보조용이다. */
const INDIRECT_NEGATIVE='__generic_negative__';
const INDIRECT_CONTROL='__generic_control__';
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const escapeRx=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const controlNames=new Set(['군량 고갈','침묵','무장 해제','조롱','혼란','공포','허약']);
const ambiguousNames=new Set(['방어','관통','간파','반격','회심','연타','화공','폭풍','위협','홍수']);

export const effectTypes={
  apply:'부여·획득', modify:'수치 증감', remove:'직접 제거', block:'무효화·면역', condition:'조건 활용', mention:'설명에 언급'
};
export const sourceTypes={hero:'장수 고유',tactic:'학습 전법',warbook:'병법',romance:'연의 고유'};
export const targetSides={self:'자신',ally:'아군·우군',enemy:'적군',both:'양측',unknown:'대상 미확정'};
export const targetScopes={one:'단일',part:'일부',all:'전체',unknown:'인원 미확정'};

function sentenceParts(text){
  // 문장/줄 단위로 분리한 뒤 콤마로 효과를 세분화하되 원문은 별도 보관한다.
  return String(text||'').replace(/\r/g,'').split(/\n|(?<=[.!?])\s+(?=[가-힣(])/u)
    .flatMap(sentence=>{
      const t=clean(sentence);if(!t)return [];
      const chunks=t.split(/,\s*(?![^()]*\))/u).map(clean).filter(Boolean);
      return chunks.map((part,i)=>({part,previous:chunks[i-1]||'',sentence:t}));
    });
}
function targetInfo(part,previous=''){
  const s=clean(part),p=clean(previous);
  const matchesBoth=/(?:적군과\s*아군|아군과\s*적군|적군과\s*우군|우군과\s*적군|양측|적·아군)/.test(s);
  const self=/((?:자신|스스로|시전자)(?:이|가|의|에게|을|를|은|만|도|에게는|한테)?)/.test(s);
  const ally=/(?:아군|우군|우리편)/.test(s),enemy=/(?:적군|적측|적에게|적의|상대)/.test(s);
  let side=matchesBoth?'both':self&&!ally&&!enemy?'self':ally&&!enemy?'ally':enemy&&!ally?'enemy':'unknown';
  // 한 절에 대상이 여러 진영이면 섣불리 하나로 확정하지 않는다.
  if(!matchesBoth&&ally&&enemy)side='both';
  let scope=/(?:[2-9]\s*(?:명|개|인)|복수|여러\s*(?:명|적))/u.test(s)?'part':/(?:전원|전체|모두)/.test(s)?'all':/(?:단일|1\s*(?:명|개|인)|자신|한\s*명|공격\s*목표)/u.test(s)?'one':'unknown';
  let inferred=false;
  if(side==='unknown'&&/(?:대상|목표|해당)/.test(s) && p){
    const old=targetInfo(p,'');if(old.side!=='unknown'){side=old.side;inferred=true;}
    if(scope==='unknown'&&old.scope!=='unknown'){scope=old.scope;inferred=true;}
  }else if(side==='unknown'&&p&&/(?:부여|획득|상태|제거|확률)/.test(s)){
    const old=targetInfo(p,'');if(old.side!=='unknown'){side=old.side;inferred=true;}
    if(scope==='unknown'&&old.scope!=='unknown'){scope=old.scope;inferred=true;}
  }
  if(side==='self')scope='one';
  // '아군이 X를 부여하면 목표에게 Y'는 아군이 시전자이지 Y의 적용 대상이 아니다.
  if(/(?:아군|우군)이?\s*.{0,32}(?:부여하면|발동하면|행동하면)/u.test(s)&&/(?:목표에게|상대에게)/.test(s)){side='unknown';scope='unknown';inferred=true;}
  if(/공격자에게/.test(s)){scope='one';} 
  const selector=(s.match(/(?:무력|지력|통솔|선공|병력)이?\s*가장\s*(?:높|낮)은\s*(?:아군|우군|적군)?\s*(?:단일)?\s*목표|(?:랜덤|무작위)\s*(?:아군|우군|적군)?\s*(?:단일|[2-9]명)?\s*목표|전열\s*우선|후열\s*우선|공격\s*목표/u)||[])[0]||'';
  return {side,scope,selector,kind:inferred?'context':'description'};
}
function describeRole(part,pos,name){
  const near=part.slice(Math.max(0,pos-13)),tail=part.slice(pos+name.length);
  if(/(?:부여|획득)\s*후/.test(tail.slice(0,16)))return 'condition';
  if(/(?:[가-힣]{0,6})?(?:제거|해제|정화|소거)/.test(tail.slice(0,55))&&/(?:상태|디버프|버프|효과)/.test(tail.slice(0,35)))return 'remove';
  if(/(?:무효화|면역|차단|방지|무시)/.test(tail.slice(0,45))&&/(?:상태|효과|피해|전법)/.test(tail.slice(0,35)))return 'block';
  // "상태면", "보유한 경우"는 부여가 아니라 조건 효과.
  if(/(?:상태|효과)?(?:면|이면|일\s*때|일\s*경우|를?\s*보유|가?\s*걸린|를?\s*지닌|가?\s*있는)/u.test(tail.slice(0,32)))return 'condition';
  if(/(?:부여|획득|얻게|얻는다|얻게\s*된다|적용|발생|생성)/.test(tail.slice(0,62)))return 'apply';
  if(/(?:확률|피해|효과|수치|스택|계수).{0,26}(?:증가|감소|상승|하락)/.test(tail.slice(0,60))||/(?:증가|감소|상승|하락)/.test(tail.slice(0,26)))return 'modify';
  if(/(?:부여|획득|제거|면역|무효화|보유)/.test(near) && !/(?:상태|일\s*때)/.test(tail.slice(0,16)))return 'mention';
  return 'mention';
}
function textMatches(term,description){
  const m=escapeRx(term);
  return new RegExp(`(^|[^가-힣\\w])(${m})`,'gu');
}
function baseSources(editor){
  const rows=[];
  for(const hero of editor.heroes||[]){
    if(hero.innate?.description)rows.push({kind:'hero',id:String(hero.id),name:hero.name,skill:hero.innate.name||'',description:hero.innate.description,effect_status:hero.innate.effect_status||''});
  }
  for(const skill of editor.tactics||[])if(skill.description)rows.push({kind:'tactic',id:String(skill.id),name:skill.name,skill:'',description:skill.description,effect_status:skill.effect_status||''});
  for(const book of editor.warbooks||[])if(book.description)rows.push({kind:'warbook',id:String(book.id),name:book.name,skill:book.quality_name||'',description:book.description,effect_status:book.effect_status||''});
  for(const opt of editor.romance_options||[]){
    if(opt.innate?.description)rows.push({kind:'romance',id:String(opt.trait_id),name:(editor.heroes||[]).find(h=>h.id===opt.hero_id)?.name||opt.name,skill:opt.innate.name||opt.name,description:opt.innate.description,owner_hero_id:opt.hero_id,effect_status:opt.innate.effect_status||''});
    for(const book of opt.warbooks||[]){
      if(book.description)rows.push({kind:'romance',id:String(opt.trait_id)+':'+String(book.id),name:book.name,skill:`연의 병법 · ${opt.name}`,description:book.description,owner_hero_id:opt.hero_id,effect_status:book.effect_status||''});
    }
  }
  return rows;
}
export function buildEffectIndex(editor,glossary){
  const dictionary=(glossary||[]).filter(x=>x?.name&&x?.description).map(x=>({...x,tags:x.tags||[]}));
  // 긴 용어부터 검사하여 포함 관계인 상태효과를 이중 집계하지 않는다.
  const terms=dictionary.map(x=>x.name).sort((a,b)=>b.length-a.length);
  const records=[];let seq=0;
  for(const src of baseSources(editor)){
    const parts=sentenceParts(src.description);
    for(const {part,previous,sentence} of parts){
      const occupied=[];
      for(const term of terms){
        for(const match of part.matchAll(textMatches(term,src.description))){
          const pos=match.index+(match[1]||'').length,end=pos+term.length;
          const remaining=part.slice(end);
          if(/^[가-힣]/u.test(remaining)&&!/^(?:을|를|이|가|은|는|의|에|와|과|로|도|만|이자|이고|이며|상태|효과|확률|율|스택|피해|발동|무시|면역|부여|중첩|해제|제거|획득|추가)/u.test(remaining))continue;
          if(occupied.some(([a,b])=>pos<b&&end>a))continue;
          // 방어·회심 등의 일반 단어는 명시적 상태 부여/수치 변화에 한정.
          const role=describeRole(part,pos,term);
          if(ambiguousNames.has(term)&&role==='mention')continue;
          occupied.push([pos,end]);
          records.push({id:`e${seq++}`,status:term,role,source_type:src.kind,source_id:src.id,
            source_name:src.name,skill_name:src.skill,source_effect_status:src.effect_status,owner_hero_id:src.owner_hero_id||null,
            target:targetInfo(part,previous),evidence:'literal',description:part,context:sentence,full_description:src.description});
        }
      }
      // 광역 상태 제거는 검색 대상의 상태 이름이 직접 나와 있지 않다.
      if(/(?:디버프|이상\s*상태|제어\s*상태).{0,28}?(?:제거|해제|정화)/u.test(part)){
        const tag=/제어\s*상태/.test(part)?INDIRECT_CONTROL:INDIRECT_NEGATIVE;
        records.push({id:`e${seq++}`,status:tag,role:'remove',source_type:src.kind,source_id:src.id,
          source_name:src.name,skill_name:src.skill,source_effect_status:src.effect_status,owner_hero_id:src.owner_hero_id||null,
          target:targetInfo(part,previous),evidence:'generic',description:part,context:sentence,full_description:src.description});
      }
    }
  }
  // 동일한 효과 절+상태 반복 제거
  const seen=new Set();const compact=records.filter(r=>{
    const k=[r.source_type,r.source_id,r.status,r.role,r.description].join('|');
    if(seen.has(k))return false;seen.add(k);return true;
  });
  return {season:editor.season,data_version:editor.data_version,dictionary,records:compact,
    source_count:baseSources(editor).length,build_method:'natural_language_index_v1'};
}
export function searchEffectIndex(index,opt={}){
  const {status='',intent='all',source='all',side='all',scope='*',ownedHeroes=null,ownedTactics=null,onlyOwned=false,includeRelated=true,query=''}=opt;
  const def=index.dictionary.find(x=>x.name===status);
  const q=clean(query).toLocaleLowerCase('ko-KR');
  const control=Boolean(def&&(def.tags.includes('control')||controlNames.has(status)));
  const negative=Boolean(def&&(def.tags.includes('negative')||controlNames.has(status)||/디버프|이상 상태/.test(def.description)));
  const output=[];
  for(const r of index.records){
    const direct=!status||r.status===status;
    let related=false,relation='';
    if(!direct&&status&&includeRelated&&intent!=='apply'&&intent!=='modify'&&intent!=='condition'){
      if(r.status===INDIRECT_NEGATIVE&&negative){related=true;relation='범용 디버프 제거 후보 · 해당 제어 상태 제거 가능 여부 확인 필요';}
      if(r.status===INDIRECT_CONTROL&&control){related=true;relation='범용 제어 상태 제거 후보 · 실제 적용 규칙 확인 필요';}
      if(r.status==='정신 회복'&&r.role==='apply'&&control){related=true;relation='정신 회복은 제어 상태를 일시 무효화 (가이드 사전 근거)';}
    }
    if(!direct&&!related)continue;
    const isCounter= r.role==='remove'||r.role==='block'||related;
    if(intent==='counter'&&!isCounter)continue;
    if(intent==='apply'&&r.role!=='apply')continue;
    if(intent==='modify'&&r.role!=='modify')continue;
    if(intent==='condition'&&r.role!=='condition')continue;
    if(intent==='remove'&&r.role!=='remove')continue;
    if(source!=='all'&&r.source_type!==source)continue;
    if(side!=='all'&&r.target.side!==side)continue;
    if(scope!=='*'&&r.target.scope!==scope)continue;
    if(onlyOwned){
      if(r.source_type==='hero'&&(!ownedHeroes||!ownedHeroes.has(Number(r.source_id))))continue;
      if(r.source_type==='tactic'&&(!ownedTactics||!ownedTactics.has(Number(r.source_id))))continue;
      if(r.source_type==='romance'&&(!ownedHeroes||!ownedHeroes.has(Number(r.owner_hero_id))))continue;
      if(r.source_type==='warbook')continue; // 병법 보유 정보 미구축 시 보유 확정으로 보여주지 않음
    }
    if(q && ![r.source_name,r.skill_name,r.description,r.full_description,r.status,relation].join(' ').toLocaleLowerCase('ko-KR').includes(q))continue;
    output.push({...r,related,relation});
  }
  output.sort((a,b)=>{
    // 원문 직접 언급이 우선, 상태별 부여·제거가 그 다음, 관련 후보는 뒤로
    const weight=r=>(r.related?100:0)+(r.role==='mention'?20:r.role==='condition'?12:r.role==='modify'?5:0)+(r.target.kind==='context'?2:0);
    return weight(a)-weight(b)||a.source_name.localeCompare(b.source_name,'ko');
  });
  return output;
}
