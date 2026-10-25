import fs from 'node:fs';
import assert from 'node:assert/strict';
import {buildCandidates,recommendLineups,fitCandidate,tierOf,rosterKey} from '../planner-core.js';
const d=(p)=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url)));
const templates=d('../data/recommended-decks.json').templates;
const s2=d('../references/data/kr_s2_deck_references.json').entries;
const s3=d('../references/data/kr_s3_deck_references.json').variants;
assert.equal(tierOf('T0선등 여포',2).label,'T0');
assert.equal(tierOf('T1+ 쌍황육',2).rank,3);
assert.equal(tierOf('T1 장서각',2).rank,2);
assert.equal(tierOf('1티어 선발대',3).rank,3);
assert.equal(tierOf('공존 선발대',3).rank,0);
assert.equal(rosterKey(['조운','초선','감부인']),rosterKey(['감부인','조운','초선']));
const override={id:'x',kind:'s3-ref',heroes:[1,2,3],heroNames:['가','나','다'],tier:{rank:4,label:'T0'},skillSlots:[{hero:'가',slot:1,choices:[{id:101,name:'A'},{id:102,name:'B'}]},{hero:'나',slot:2,choices:[{id:101,name:'A'}]}]};
const match=fitCandidate(override,{heroes:new Set([1,2,3]),tactics:new Set([101,102])});
assert.equal(match.matchedSkills,2,'alternative bipartite matching');
assert.equal(match.selected[0].chosen.id,102);
assert.equal(match.selected[1].chosen.id,101);
for(const season of [1,2,3]){
 const c=buildCandidates({season,presets:templates,s2,s3});
 const target={1:58,2:72,3:96}[season];
 assert.equal(c.length,target,'source count');
 assert.equal(new Set(c.map(x=>x.id)).size,target);
 const hs=[...new Set(c.flatMap(x=>x.heroes))];const ts=[...new Set(c.flatMap(x=>x.skillSlots.flatMap(s=>s.choices.map(v=>v.id))))];
 const result=recommendLineups(c,{heroes:hs,tactics:ts,count:5});
 assert.ok(result.plans.length>0);
 for(const plan of result.plans){
  assert.ok(plan.entries.length<=5);
  const ownedHeroes=plan.entries.flatMap(e=>e.candidate.heroes);
  const ownedTactics=plan.entries.flatMap(e=>[...e.usedTactics]);
  assert.equal(new Set(ownedHeroes).size,ownedHeroes.length,'no hero overlap');
  assert.equal(new Set(ownedTactics).size,ownedTactics.length,'no skill overlap');
  assert.ok(plan.entries.every(e=>e.complete),'full ownership by default');
 }
 console.log('S'+season+' pass',c.length,'candidates,',result.plans.length,'multi-deck configurations');
}
const s3c=buildCandidates({season:3,presets:templates,s2,s3});
assert.ok(s3c.some(c=>c.kind==='s3-ref'&&c.skillSlots.some(x=>x.choices.length>1)));
const s2c=buildCandidates({season:2,presets:templates,s2,s3});
assert.ok(s2c.some(c=>c.kind==='s2-ref'&&c.tier.rank>0));
const noResource=recommendLineups(s2c,{heroes:[],tactics:[],count:3});assert.equal(noResource.plans.length,0);
const reservedHeroes=s2c.find(c=>c.heroes.length===3).heroes;
const poolHeroes=[...new Set(s2c.flatMap(c=>c.heroes))];
const noReserved=recommendLineups(s2c,{heroes:poolHeroes,tactics:[],reservedHeroes,count:3});
assert.ok(noReserved.plans.every(p=>p.entries.every(e=>e.candidate.heroes.every(id=>!reservedHeroes.includes(id)))));
console.log('All planner tests passed');
