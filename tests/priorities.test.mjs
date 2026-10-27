import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PROJECTIONS,isProjection,reallocateLineupByPriority,compareLineupAllocations,buildCandidates,recommendLineups} from '../planner-core.js';

const editor=JSON.parse(fs.readFileSync(new URL('../data/editor-s3.json',import.meta.url)));
const catalog=new Map(editor.tactics.map(t=>[t.id,t]));
const [firstProjection,secondProjection]=PROJECTIONS;
const make=(i,slots)=>({id:`army-${i}`,title:`${i}군 후보`,kind:'s3-ref',
  heroes:[i*3+1,i*3+2,i*3+3],heroNames:[`장수${i}a`,`장수${i}b`,`장수${i}c`],
  tier:{rank:3,label:'1티어'},skillSlots:slots.map((skills,j)=>({hero:`장수${i}a`,slot:j+1,choices:skills.map(tid=>({id:tid,name:catalog.get(tid)?.name||`${tid}`}))}))});
const candidates=[
  make(0,[[firstProjection.base]]),make(1,[[firstProjection.base]]),
  make(2,[[firstProjection.base]]),make(3,[[firstProjection.base]]),
  make(4,[[firstProjection.base]])
];
const opts={heroes:Array.from({length:15},(_,i)=>i+1),tactics:[firstProjection.base],tacticCatalog:catalog,projectionSelection:'auto'};
const initial=reallocateLineupByPriority(candidates,opts);
assert.equal(initial.entries[0].selected[0].chosen.id,firstProjection.base);
assert.equal(initial.entries[1].selected[0].chosen.id,firstProjection.shadow);
assert.equal(initial.entries[4].selected[0].chosen,null);
const promoted=reallocateLineupByPriority([candidates[4],...candidates.slice(0,4)],opts);
assert.equal(promoted.entries[0].candidate.id,'army-4');
assert.equal(promoted.entries[0].selected[0].chosen.id,firstProjection.base,'5th->1st reclaims original');
assert.equal(promoted.entries[1].selected[0].chosen.id,firstProjection.shadow,'formerly 1st now receives projection');
assert.equal(promoted.entries[2].selected[0].chosen,null,'third does not fabricate copies');
const differences=compareLineupAllocations(initial,promoted);
assert.ok(differences.some(x=>x.id==='army-4'&&x.gained===1));
assert.ok(differences.some(x=>x.id==='army-0'&&x.changedSlots===1));
const allocated=promoted.entries.flatMap(x=>x.selected.map(s=>s.chosen?.id).filter(Boolean));
assert.equal(allocated.length,new Set(allocated).size);
assert.equal([...promoted.usedTactics].filter(isProjection).length,1);
// Explicitly chosen single projection and global projection budget apply even after reorder.
const altCandidates=Array.from({length:5},(_,i)=>make(i,PROJECTIONS.map(p=>[p.base])));
const altOpts={...opts,tactics:PROJECTIONS.map(p=>p.base)};
const alt=reallocateLineupByPriority([...altCandidates].reverse(),altOpts);
assert.ok([...alt.usedTactics].filter(isProjection).length<=3);
const restricted=reallocateLineupByPriority(altCandidates,{...altOpts,projectionSelection:[secondProjection.shadow]});
assert.deepEqual([...restricted.usedTactics].filter(isProjection),[secondProjection.shadow]);
// Reserved pool cannot be re-spent after a priority change.
const reserved=reallocateLineupByPriority(candidates,{...opts,reservedTactics:[firstProjection.base]});
assert.equal(reserved.entries[0].selected[0].chosen?.id,firstProjection.shadow);
assert.equal(reserved.entries[1].selected[0].chosen,null);
assert.throws(()=>reallocateLineupByPriority([candidates[0],candidates[0]],opts),/중복/);
// The real 96-candidate S3 dataset can form a five-deck plan and reorder it without duplicate resources.
const presets=JSON.parse(fs.readFileSync(new URL('../data/recommended-decks.json',import.meta.url))).templates;
const s3=JSON.parse(fs.readFileSync(new URL('../references/data/kr_s3_deck_references.json',import.meta.url))).variants;
const all=buildCandidates({season:3,presets,s3});
assert.equal(all.length,96);
const roster=[...new Set(all.flatMap(c=>c.heroes))],tactics=[...new Set(all.flatMap(c=>c.skillSlots.flatMap(s=>s.choices.map(o=>o.id))))];
const plans=recommendLineups(all,{heroes:roster,tactics,count:5,allowPartial:true,tacticCatalog:catalog});
assert.ok(plans.plans[0]?.entries.length>=4);
const reversed=reallocateLineupByPriority([...plans.plans[0].entries].reverse(),{heroes:roster,tactics,tacticCatalog:catalog});
assert.deepEqual(reversed.entries.map(x=>x.candidate.id),[...plans.plans[0].entries].reverse().map(x=>x.candidate.id));
const used=reversed.entries.flatMap(x=>x.selected.map(s=>s.chosen?.id).filter(Boolean));
assert.equal(new Set(used).size,used.length);
assert.ok([...reversed.usedTactics].filter(isProjection).length<=3);
console.log('Priority reorder, direct alternatives, projection constraints, reserved pool, actual S3 data: OK');
