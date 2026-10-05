import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

test('recorded six-SKU source sends all 24 product and 18 option attributes with exact JSON constraints through the actual intake API',async()=>{
 const h=mobileIntakeHarness();
 try{
  let calls=0;const original=h.bindings.AI.run;
  h.bindings.AI.run=async(model,input)=>{
   calls++;const source=JSON.parse(input.messages[1].content),schema=input.response_format.json_schema.properties.attributes;
   assert.equal(source.attributes.length,42);assert.equal(source.attributes.filter(pair=>pair.name.startsWith('상품속성:')).length,24);assert.equal(source.attributes.filter(pair=>pair.name.startsWith('option')).length,18);
   assert.deepEqual(source.attributes.map(pair=>pair.sourceIndex),Array.from({length:42},(_,index)=>index));
   assert.equal(schema.minItems,42);assert.equal(schema.maxItems,42);assert.equal(schema.items.properties.sourceIndex.maximum,41);
   assert.equal(input.max_tokens,4096);assert.match(input.messages[0].content,/exactly 42 entries/);
   return original(model,input);
  };
  const result=await h.intake();assert.match(result,/초안 저장됨/);assert.equal(calls,1);
  const stored=h.sqlite.prepare('SELECT review,result,status FROM translation_jobs ORDER BY created_at').all();assert.equal(stored.length,1);assert.equal(stored[0].status,'completed');
  const review=JSON.parse(stored[0].review);assert.equal(review.source.attributes.length,42);assert.ok(review.source.attributes.every(pair=>!Object.hasOwn(pair,'sourceIndex')));
  const generated=JSON.parse(stored[0].result);assert.equal(generated.draft.attributes.length,42);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
  assert.equal(JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload).rows.length,6);
 }finally{h.close();}
});
