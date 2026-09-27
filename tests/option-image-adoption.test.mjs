import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>load(name.replace('@/', '')+'.ts')});
 return exports;
}
const {adoptGeneratedOptionImage}=load('app/option-image-adoption.ts');
const model=load('app/product-options.ts');
const job=()=>({productId:'p',status:'completed',review:{sourceKey:'raw'},result:{attached:true,storageKey:'edited'}});
const fixture=()=>({productVersion:'latest-version',options:{productId:'p',revision:8,rows:[
 {...model.emptyOptionInput('a'),imageKey:'raw',translatedName:'수정한 이름',unitCostCny:12,stock:0},
 {...model.emptyOptionInput('b'),imageKey:'raw',included:false},
 {...model.emptyOptionInput('c'),imageKey:'manual'},
 {...model.emptyOptionInput('d'),imageKey:null},
]}});
test('reads latest rows and saves only matching image changes with both CAS versions; quotation uses result',async()=>{
 const current=fixture(), before=JSON.stringify(current), calls=[];
 const count=await adoptGeneratedOptionImage('p',job(),['raw','edited'],async(url,init)=>{
  calls.push({url,init});return Response.json(current);
 });
 assert.equal(count,2);assert.equal(calls[0].init.cache,'no-store');
 const body=JSON.parse(calls[1].init.body);
 assert.equal(body.expectedRevision,8);assert.equal(body.expectedProductVersion,'latest-version');
 assert.deepEqual(body.rows.map(r=>r.imageKey),['edited','edited','manual',null]);
 assert.equal(body.rows[0].translatedName,'수정한 이름');assert.equal(body.rows[0].unitCostCny,12);assert.equal(body.rows[0].stock,0);assert.equal(body.rows[1].included,false);
 assert.equal(model.quotationMainImageKeys(body.rows[0],['common'])[0],'edited');
 assert.equal(JSON.stringify(current),before);
});
test('conflict surfaces without automatic retry or success',async()=>{
 let calls=0;
 await assert.rejects(adoptGeneratedOptionImage('p',job(),['raw','edited'],async()=>++calls===1?Response.json(fixture()):Response.json({error:'옵션 변경 충돌'},{status:409})),/충돌/);
 assert.equal(calls,2);
});
test('invalid result does not read or save and other product cannot be changed',async()=>{
 for(const mutate of [j=>j.productId='other',j=>j.status='running',j=>j.result.attached=false,j=>j.result.storageKey='raw']){
  const j=job();mutate(j);let calls=0;await assert.rejects(adoptGeneratedOptionImage('p',j,['raw','edited'],async()=>{calls++;}));assert.equal(calls,0);
 }
});
test('missing source references, read failures and mismatched returned product never PATCH',async()=>{
 for(const scenario of ['no-match','read-failure','wrong-product']){
  let calls=0;const current=fixture();
  if(scenario==='no-match')current.options.rows=[];
  if(scenario==='wrong-product')current.options.productId='other';
  await assert.rejects(adoptGeneratedOptionImage('p',job(),['raw','edited'],async()=>{calls++;return Response.json(current,{status:scenario==='read-failure'?503:200});}));assert.equal(calls,1);
 }
});
