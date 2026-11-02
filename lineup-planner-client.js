/** HTTP/state adapter only. Recommendation/search/resource validation run on the backend. */
import {BattleApi} from './api-client.js';
const clone=x=>structuredClone(x);
export class LineupPlannerApi extends BattleApi {
  candidates(payload,{signal}={}) {
    return this.request('/api/v2/lineups/candidates',{method:'POST',body:payload,signal});
  }
  recommend(payload,{signal}={}) {
    return this.request('/api/v2/lineups/recommend',{method:'POST',body:payload,signal});
  }
}
/** Serialize the current plan, preserving pins, manual edits and empty tactic positions. */
export function entryInputs(plan) {
  return (plan?.entries||[]).map(e=>({entry_id:e.entry_id,position:e.position,pinned:!!e.pinned,
    candidate_id:e.candidate_id??null,army:clone(e.army),
    tactic_slots:e.tactic_slots.map(s=>({hero_slot:s.hero_slot,slot:s.slot,skill_id:s.selected_id??null}))}));
}
export function setPinned(plan,id,pinned) {
  const next=clone(plan);const e=next.entries.find(e=>e.entry_id===id);
  if(!e)throw Error('부대를 찾지 못했습니다.');e.pinned=!!pinned;return next;
}
/** Move the whole card with its pin. No recommendations are calculated here. */
export function moveEntry(plan,id,to,{pinMoved=false}={}) {
  const next=clone(plan),entries=next.entries;
  const max=Math.max(entries.length,...entries.map(e=>e.position),...(next.empty_positions||[]));
  const from=entries.find(e=>e.entry_id===id)?.position;
  if(from==null||!Number.isInteger(to)||to<1||to>max)throw Error('이동 순위가 올바르지 않습니다.');
  const slots=Array.from({length:max},(_,i)=>entries.find(e=>e.position===i+1)||null);
  const [moved]=slots.splice(from-1,1);if(pinMoved)moved.pinned=true;slots.splice(to-1,0,moved);
  next.entries=[];next.empty_positions=[];
  slots.forEach((e,i)=>{if(e){e.position=i+1;next.entries.push(e);}else next.empty_positions.push(i+1);});
  return next;
}
/** Edit a learned slot without compressing a hole in slot1 into slot2. */
export function editTactic(plan,id,heroSlot,slot,tactic) {
  const next=clone(plan),entry=next.entries.find(e=>e.entry_id===id);
  if(!entry)throw Error('부대를 찾지 못했습니다.');
  const hero=entry.army.heroes.find(h=>h.slot===heroSlot),cell=entry.tactic_slots.find(x=>x.hero_slot===heroSlot&&x.slot===slot);
  if(!hero||!cell)throw Error('전법칸을 찾지 못했습니다.');
  const configs=new Map();
  const active=entry.tactic_slots.filter(x=>x.hero_slot===heroSlot&&x.selected_id!=null).sort((a,b)=>a.slot-b.slot);
  active.forEach((s,i)=>configs.set(s.slot,hero.learned[i]));
  if(tactic){configs.set(slot,clone(tactic));cell.selected_id=tactic.skill_id;cell.state='selected';}
  else{configs.delete(slot);cell.selected_id=null;cell.state='unresolved';}
  hero.learned=[...configs].sort((a,b)=>a[0]-b[0]).map(([,value])=>value);
  entry.code=null;entry.battle_ready=false;next.lineup_ready=false;return next;
}
/** Stale responses are ignored; existing personal state is never overwritten on failure. */
export class PlannerSession {
  constructor(api){this.api=api;this.revision=0;this.pending=null;this.plan=null;this.candidateRevision=0;}
  async candidates({season,pool,pool_code,count=5,plan=this.plan,projection_selection='auto',data_version,exclude_candidate_ids=[],query='',offset=0,limit=20}) {
    const n=++this.candidateRevision;
    const payload={season,count,entries:entryInputs(plan),projection_selection,data_version,exclude_candidate_ids,query,offset,limit,request_revision:String(n),...(pool_code?{pool_code}:{pool})};
    const result=await this.api.candidates(payload);
    return n===this.candidateRevision&&result.request_revision===String(n)?result:null;
  }
  cancel(){this.candidateRevision++;this.revision++;this.pending?.abort();this.pending=null;}
  async run({season,pool,pool_code,count=5,mode='rebuild',plan=this.plan,projection_selection='auto',data_version,forced_candidates=[]}) {
    this.candidateRevision++;const n=++this.revision;this.pending?.abort();const pending=new AbortController();this.pending=pending;
    const request={season,count,mode,forced_candidates,projection_selection,data_version,entries:entryInputs(plan),request_revision:String(n),...(pool_code?{pool_code}:{pool})};
    try {
      const response=await this.api.recommend(request,{signal:pending.signal});
      if(n!==this.revision||response.request_revision!==String(n))return null;
      this.candidateRevision++;this.plan=response;return response;
    } catch(error) {
      if(n!==this.revision||pending.signal.aborted)return null;
      throw error; // UI handles 422/429/413; no fallback client-side optimizer.
    } finally {if(n===this.revision)this.pending=null;}
  }
}
