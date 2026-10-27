import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PROJECTIONS,projectionOptions,fitCandidate,recommendLineups,isProjection,buildCandidates} from '../planner-core.js';
const editor=JSON.parse(fs.readFileSync(new URL('../data/editor-s3.json',import.meta.url)));
const catalog=new Map(editor.tactics.map(t=>[t.id,t]));
assert.equal(PROJECTIONS.length,6);
for(const p of PROJECTIONS){assert.equal(catalog.get(p.shadow)?.base_skill_id,p.base);assert.equal(catalog.get(p.shadow)?.variant,'shadow');}
const base=PROJECTIONS.map(p=>p.base), allShadow=PROJECTIONS.map(p=>p.shadow);
assert.equal(projectionOptions({tactics:base,tacticCatalog:catalog}).length,6);
assert.throws(()=>projectionOptions({tactics:base,tacticCatalog:catalog,selection:allShadow.slice(0,4)}),/3개/);
// Four identical requested tactics across five armies -> one original and one projected, never 3+ duplicate copies.
const same=Array.from({length:5},(_,i)=>({id:'same'+i,kind:'preset',title:'동종'+i,heroes:[i*3+1,i*3+2,i*3+3],heroNames:['a'+i,'b'+i,'c'+i],skillSlots:[{hero:'a'+i,slot:1,choices:[{id:base[0],name:catalog.get(base[0]).name}]}],tier:{rank:2,label:'T1'}}));
const heroPool=Array.from({length:15},(_,i)=>i+1);
const samePlans=recommendLineups(same,{heroes:heroPool,tactics:[base[0]],count:5,allowPartial:false,tacticCatalog:catalog});
assert.ok(samePlans.plans.length);
const one=samePlans.plans[0];
const assigned=one.entries.flatMap(e=>e.selected.filter(s=>s.chosen).map(s=>s.chosen.id));
assert.equal(assigned.filter(id=>id===base[0]).length,1);
assert.equal(assigned.filter(id=>id===PROJECTIONS[0].shadow).length,1);
assert.equal(assigned.length,2);
// All six projected families wanted; can create up to 3 distinct shadows with all six originals owned.
const pair=Array.from({length:5},(_,i)=>({id:'pair'+i,kind:'preset',title:'pair'+i,heroes:[i*3+1,i*3+2,i*3+3],heroNames:['x'+i,'y'+i,'z'+i],skillSlots:PROJECTIONS.slice(0,6).map((p,j)=>({hero:'x'+i,slot:j+1,choices:[{id:p.base,name:p.name}]})),tier:{rank:2,label:'T1'}}));
const result=recommendLineups(pair,{heroes:heroPool,tactics:base,count:5,allowPartial:false,tacticCatalog:catalog,beamWidth:70});
assert.ok(result.plans.length);
for(const plan of result.plans){
 const used=[...plan.usedTactics].filter(isProjection);
 assert.ok(used.length<=3,'3 shadows across all armies');
 assert.equal(new Set(used).size,used.length,'unique shadows');
 const each=plan.entries.flatMap(e=>e.selected.map(s=>s.chosen?.id).filter(Boolean));
 assert.equal(new Set(each).size,each.length,'no tactic ID repeats');
}
const restricted=recommendLineups(pair,{heroes:heroPool,tactics:base,count:5,allowPartial:false,tacticCatalog:catalog,projectionSelection:[PROJECTIONS[1].shadow]});
assert.ok(restricted.plans.length);
assert.ok(restricted.plans.every(p=>[...p.usedTactics].filter(isProjection).every(id=>id===PROJECTIONS[1].shadow)));
// Six S3 seeds + ninety references remain intact.
const recommended=JSON.parse(fs.readFileSync(new URL('../data/recommended-decks.json',import.meta.url))).templates;
const refs=JSON.parse(fs.readFileSync(new URL('../references/data/kr_s3_deck_references.json',import.meta.url))).variants;
const all=buildCandidates({season:3,presets:recommended,s3:refs});
assert.equal(all.length,96);
console.log('Projection capacity, uniqueness, manual selection, source coverage: OK');
const sameArmy={id:'same-army',heroes:[1,2,3],heroNames:['갑','을','병'],skillSlots:[
 {hero:'갑',slot:1,choices:[{id:PROJECTIONS[0].base,name:PROJECTIONS[0].name}]},
 {hero:'을',slot:1,choices:[{id:PROJECTIONS[0].base,name:PROJECTIONS[0].name}]}],tier:{rank:3}};
const intra=fitCandidate(sameArmy,{heroes:new Set([1,2,3]),tactics:new Set([PROJECTIONS[0].base]),tacticCatalog:catalog});
assert.equal(intra.matchedSkills,1,'one exclusive family per army even with shadow present');
