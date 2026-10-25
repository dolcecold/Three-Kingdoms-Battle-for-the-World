import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url));
const read=(f)=>JSON.parse(readFileSync(path.join(here,'..',f),'utf8'));
const refs=read('references/data/kr_s3_deck_references.json');
const matchups=read('data/recommendation-matchups.json');
const known=new Map(refs.variants.map(v=>[v.id,v]));
let n=0;
for(const [id,m] of Object.entries(matchups.items)){
  assert.equal(m.season,3);
  assert.ok(known.has(id),`missing setup: ${id}`);
  const sourceNotes=known.get(id).notes || [];
  assert.deepEqual(m.notes,sourceNotes);
  assert.ok(sourceNotes.length>0);
  const claims=['good','bad','even'].flatMap(x=>m[x]||[]);
  for(const claim of claims)assert.ok(claim.target?.length>1,'missing target');
  assert.ok(claims.length||(m.caution||[]).length);
  n++;
}
assert.equal(n,16);
const recommended=read('data/recommended-decks.json');
assert.equal(recommended.templates.length,128);
assert.equal(read('references/data/kr_s2_deck_references.json').entries.length,57);
assert.equal(refs.variants.length,90);
console.log(`PASS: ${n} source-linked S3 setup matchups; S1/S2 no inferred matchups`);
