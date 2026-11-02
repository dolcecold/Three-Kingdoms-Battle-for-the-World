/** 길드 공용: 개인 저장 덱/서버 편성에 쓰는 공통 빠른 편집기.
 * UI에서 변경한 필드만 복사본에 적용하고 사용자가 저장할 때만 onSave를 호출한다.
 * backend planner validates server entries; no roster/localStorage mutation in this module.
 */
import {bookChoices,armFor,romanceFor} from './editor.js';
const make=(tag,props={},...children)=>{
  const el=document.createElement(tag);
  for(const [k,v] of Object.entries(props||{})){
    if(v===undefined||v===null)continue;
    if(k==='class')el.className=v;
    else if(k==='text')el.textContent=v;
    else if(k==='text')el.textContent=v;
    else if(k==='value'||k==='checked'||k==='disabled'||k==='type'||k==='placeholder'||k==='min'||k==='max'||k==='title')el[k]=v;
    else if(k.startsWith('on')&&typeof v==='function')el.addEventListener(k.slice(2).toLowerCase(),v);
    else el.setAttribute(k,String(v));
  }
  for(const x of children.flat(Infinity))if(x!=null&&x!==false)el.append(x instanceof Node?x:document.createTextNode(String(x)));
  return el;
};
const label=(name,field)=>make('div',{class:'workspace-editor-field'},make('label',{text:name}),field);
const empty=(name='선택 안 함')=>make('option',{value:'',text:name});
const choice=(rows,selected,toText,hasEmpty=true)=>{
  const s=make('select');if(hasEmpty)s.append(empty());
  for(const row of rows)s.append(make('option',{value:String(row.id),text:toText(row)}));
  s.value=selected==null?'':String(selected);return s;
};
function findBook(data,hero,slot){return hero.warbook_slots?.find(x=>x.slot===slot)?.warbook_id??null;}
/** 사용자가 실제 보유하고 있지 않은 항목을 원본이 포함할 수 있으므로, 원본 ID 자체는 유지한다. */
let activeEditorPromise=null;
export function openArmyWorkspaceEditor({army,data,title='부대 편집',onSave}){
  if(activeEditorPromise)return activeEditorPromise;
  activeEditorPromise=new Promise((resolve,reject)=>{
    const draft=structuredClone(army);
    const dialog=make('dialog',{class:'workspace-editor-dialog','aria-label':title}),root=make('div',{class:'workspace-editor'});
    const head=make('div',{class:'workspace-editor-head'},make('h3',{text:title}));
    const content=make('div',{class:'workspace-editor-content'}),error=make('p',{class:'workspace-editor-warning',role:'alert'});
    const footer=make('div',{class:'workspace-editor-footer'}),save=make('button',{type:'button',class:'solid-btn',text:'변경사항 저장'});
    let done=false;
    function close(){dialog.close();}
    function picker({name,rows,current,onPick,display}){
      const pop=make('dialog',{class:'workspace-editor-dialog','aria-label':name});
      const box=make('div',{class:'workspace-editor'}),titleLine=make('div',{class:'workspace-editor-head'},make('strong',{text:name}),make('button',{type:'button',class:'ghost-btn small',onClick:()=>pop.close(),text:'닫기'}));
      const input=make('input',{type:'search',placeholder:`${name} 검색`,autocomplete:'off','aria-label':`${name} 검색`});
      const list=make('div',{class:'workspace-editor-picklist'});
      function renderRows(){const q=input.value.trim().replace(/\s/g,'').toLocaleLowerCase('ko');
        list.replaceChildren();
        for(const row of rows.filter(r=>!q||(display(r)+r.id).replace(/\s/g,'').toLocaleLowerCase('ko').includes(q)).slice(0,160)){
          list.append(make('button',{type:'button',onClick:()=>{onPick(row.id);pop.close();render();},text:`${row.id===current?'✓ ':''}${display(row)}`}));
        }
        if(!list.children.length)list.append(make('p',{text:'검색 결과가 없습니다.'}));
      }
      input.addEventListener('input',renderRows);
      const body=make('div',{class:'workspace-editor-content'},input,list);
      box.append(titleLine,body);pop.append(box);document.body.append(pop);
      pop.addEventListener('close',()=>pop.remove(),{once:true});renderRows();pop.showModal();input.focus();
    }
    function render(){
      content.replaceChildren();
      const nameInput=make('input',{value:draft.name||''});nameInput.addEventListener('input',()=>draft.name=nameInput.value.slice(0,80));
      const formation=choice(data.formations||[],draft.formation_id,x=>x.name,false);
      formation.addEventListener('change',()=>draft.formation_id=Number(formation.value));
      content.append(make('div',{class:'workspace-editor-basic'},label('부대 이름',nameInput),label('진형',formation)));
      const cards=make('div',{class:'workspace-editor-heroes'}),heroes=[...draft.heroes].sort((a,b)=>a.slot-b.slot);
      for(const hero of heroes){
        const meta=data.heroes.find(x=>x.id===hero.hero_id),hc=make('section',{class:'workspace-editor-hero'});
        const reorder=make('div',{class:'workspace-editor-hero-head'},make('strong',{text:`${hero.slot}번 · ${meta?.name||hero.hero_id}`}),
          make('div',null,make('button',{type:'button',class:'ghost-btn small',disabled:hero.slot===1,onClick:()=>swap(hero.slot,hero.slot-1),text:'◀'}),
          make('button',{type:'button',class:'ghost-btn small',disabled:hero.slot===3,onClick:()=>swap(hero.slot,hero.slot+1),text:'▶'})));
        hc.append(reorder);
        const replace=make('button',{type:'button',class:'ghost-btn small',text:'무장 바꾸기 (기존 설정 초기화)'});
        replace.addEventListener('click',()=>{
          picker({name:'무장 교체',rows:data.heroes.filter(x=>!draft.heroes.some(h=>h.hero_id===x.id)),current:hero.hero_id,
            display:x=>`${x.name} · ${x.rarity_name||''}`,
            onPick:id=>{
              const template=structuredClone(data.examples[0].heroes[0]);
              Object.assign(hero,template,{hero_id:id,slot:hero.slot});
              hero.learned=[];hero.warbook_slots=[];hero.arms_skill_ids=[];hero.advanced_arms_id=null;hero.romance_trait_id=null;
              hero.warbook_page='normal';hero.allocation_mode=data.heroes.find(h=>h.id===id)?.recommended_attribute?'recommended':'manual';hero.total_stats=null;
            }});
        });
        hc.append(replace);
        const level=make('input',{type:'number',value:hero.level??50,min:1,max:50});level.addEventListener('change',()=>hero.level=Number(level.value));
        const troops=make('input',{type:'number',value:hero.troops??10000,min:1,max:50000});troops.addEventListener('change',()=>hero.troops=Number(troops.value));
        hc.append(make('div',{class:'workspace-editor-grid2'},label('레벨',level),label('병력',troops)));
        const roms=(data.romance_options||[]).filter(x=>x.hero_id===hero.hero_id).map(x=>({...x,id:x.trait_id}));
        if(roms.length){const rom=choice(roms,hero.romance_trait_id,x=>x.name||`연의 ${x.trait_id}`);
          rom.addEventListener('change',()=>{hero.romance_trait_id=rom.value?Number(rom.value):null;hero.warbook_slots=[];hero.warbook_page='normal';hero.advanced_arms_id=null;hero.arms_skill_ids=[];render();});
          hc.append(label('연의 분기',rom));}
        // learned skill position remains distinct, and empty first slot never borrows a fake ID.
        for(let i=0;i<2;i++){
          const skill=hero.learned?.[i],row=(data.tactics||[]).find(x=>x.id===skill?.skill_id);
          const selectSkill=make('button',{type:'button',text:row?.name||'＋ 전법 선택'});
          selectSkill.addEventListener('click',()=>{
            picker({name:`${meta?.name||'무장'} 학습 전법 ${i+1}`,rows:[{id:0,name:'전법 비우기'},...data.tactics],current:skill?.skill_id,
              display:x=>x.id===0?'전법 비우기':x.name,
              onPick:id=>{
                if(id===0)hero.learned.splice(i,1);
                else{
                  const next={skill_id:id,level:skill?.level??10,breakthrough:skill?.breakthrough??0,grade:0};
                  if(hero.learned[i])hero.learned[i]=next;else hero.learned.push(next);
                }
              }});
          });
          hc.append(make('div',{class:'workspace-editor-choice'},make('small',{text:`학습 전법 ${i+1}`}),selectSkill));
        }
        const armsCurrent=armFor(data,hero),rom=romanceFor(data,hero),basicType=rom?.arms_id??data.heroes.find(h=>h.id===hero.hero_id)?.default_arms_id;
        const basic=data.arms.find(a=>a.id===basicType);
        const allowed=(data.arms||[]).filter(a=>!basic||a.arms_type===basic.arms_type||a.id===basic.id);
        const arms=choice(allowed,hero.advanced_arms_id,x=>`${x.name}${x.is_base?' · 기본':''}`);
        arms.addEventListener('change',()=>{hero.advanced_arms_id=arms.value?Number(arms.value):null;hero.arms_skill_ids=[];render();});
        hc.append(label('병종',arms));
        const arm=armFor(data,hero),profs=arm?(data.proficiencies||[]).filter(x=>arm.proficiency_ids?.includes(x.id)):[];
        if(profs.length){const pr=choice(profs,hero.arms_skill_ids?.[0],x=>x.name);
          pr.addEventListener('change',()=>{hero.arms_skill_ids=pr.value?[Number(pr.value)]:[];});hc.append(label('병종 정통',pr));}
        const pg=make('select');pg.append(make('option',{value:'normal',text:'일반 병법'}));
        if(hero.romance_trait_id!=null)pg.append(make('option',{value:'romance',text:'연의 고정 병법'}));
        pg.value=hero.warbook_page||'normal';pg.addEventListener('change',()=>{hero.warbook_page=pg.value;if(pg.value==='romance')hero.warbook_slots=[];render();});
        hc.append(label('병법 페이지',pg));
        if(hero.warbook_page!=='romance'){
          for(let slot=1;slot<=3;slot++){
            const old=findBook(data,hero,slot),options=bookChoices(data,hero,slot).map(x=>({...x}));
            const b=choice(options,old,x=>`${x.name} · ${x.quality_name||'등급'+x.quality}`);
            b.addEventListener('change',()=>{
              hero.warbook_slots=hero.warbook_slots.filter(x=>x.slot!==slot);
              if(b.value)hero.warbook_slots.push({slot,warbook_id:Number(b.value)});
              hero.warbook_slots.sort((a,b)=>a.slot-b.slot);render();
            });
            hc.append(label(`병법 ${slot}`,b));
          }
        }else hc.append(make('p',{class:'muted-note',text:'연의 분기 고정 병법이 적용됩니다.'}));
        const extra=make('details',{class:'workspace-editor-extra'});
        extra.append(make('summary',{text:'능력치 · 승품 · 장비 · 말 추가 설정'}));
        const addNumber=(title,key,min,max)=>{
          const input=make('input',{type:'number',value:hero[key]??0,min,max});
          input.addEventListener('change',()=>{hero[key]=Math.max(min,Math.min(max,Number(input.value)||0));});
          extra.append(label(title,input));
        };
        addNumber('무장 돌파', 'breakthrough',0,5);
        addNumber('무장 승품', 'promotion',0,5);
        const alloc=choice([{id:'recommended',name:'추천 배분'},{id:'manual',name:'직접 배분'}],hero.allocation_mode||'manual',x=>x.name,false);
        alloc.addEventListener('change',()=>{hero.allocation_mode=alloc.value;render();});
        extra.append(label('스탯 배분',alloc));
        if(hero.allocation_mode==='manual'){
          const statNames=[['might','무력'],['intelligence','지력'],['defence','통솔'],['speed','선공']];
          const grid=make('div',{class:'workspace-editor-grid2'});
          for(const [field,nm] of statNames){
            const input=make('input',{type:'number',value:hero.allocation?.[field]??0,min:0,max:2000});
            input.addEventListener('change',()=>{hero.allocation??={might:0,intelligence:0,defence:0,speed:0};hero.allocation[field]=Number(input.value)||0;});
            grid.append(label(nm,input));
          }
          extra.append(grid);
        }
        if((data.equipment||[]).length){
          const eq=choice(data.equipment,hero.equipment_item_id,x=>x.name||String(x.id));
          eq.addEventListener('change',()=>{hero.equipment_item_id=eq.value?Number(eq.value):null;hero.equipment_loadout=[];});
          extra.append(label('장비 아이템',eq));
        }
        if((data.horses||[]).length){
          const horse=choice(data.horses,hero.horse_item_id,x=>x.name||String(x.id));
          horse.addEventListener('change',()=>{hero.horse_item_id=horse.value?Number(horse.value):null;hero.horse_loadout=null;});
          extra.append(label('말 아이템',horse));
        }
        hc.append(extra);
        cards.append(hc);
      }
      content.append(cards);
    }
    function swap(from,to){const a=draft.heroes.find(h=>h.slot===from),b=draft.heroes.find(h=>h.slot===to);if(!a||!b)return;
      [a.slot,b.slot]=[to,from];render();}
    let saving=false;
    save.addEventListener('click',async()=>{
      if(saving)return;error.textContent='';
      if(!draft.name?.trim()){error.textContent='부대 이름을 입력하세요.';return;}
      try{saving=true;save.disabled=true;await onSave(structuredClone(draft));done=true;close();}
      catch(err){error.textContent=err?.message||String(err);}finally{saving=false;save.disabled=false;}
    });
    footer.append(error,make('div',null,make('button',{type:'button',class:'ghost-btn',onClick:close,text:'취소'}),' ',save));
    root.append(head,content,footer);dialog.append(root);document.body.append(dialog);
    dialog.addEventListener('close',()=>{dialog.remove();resolve(done);},{once:true});
    render();dialog.showModal();
  });
  activeEditorPromise.finally(()=>{activeEditorPromise=null;});
  return activeEditorPromise;
}
