import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/batch-work.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const {runBatchProduct}=exports;
const version='2026-09-25T00:00:00.000Z';
const product={id:'one',updated_at:version};
const workflow={productId:'one',productVersion:version,stages:[]};
const json=value=>Response.json(value);

test('confirmed batch runs use new keys even when only settings or options change',async()=>{
 const keys=new Map();const sent=[];let count=0;
 const options={keys,signal:new AbortController().signal,newKey:()=>`key-${++count}`,fetcher:async(_url,init)=>{
  if(init.method!=='POST')return json({product});
  sent.push(JSON.parse(init.body));return json({workflow});
 }};
 await runBatchProduct('one',options);await runBatchProduct('one',options);
 assert.deepEqual(sent.map(body=>body.idempotencyKey),['key-1','key-2']);
 assert.equal(keys.size,0);
});

test('lost or invalid responses retain the same key until the result is confirmed',async()=>{
 const keys=new Map();const sent=[];let attempt=0;
 const options={keys,signal:new AbortController().signal,newKey:()=>`key-${keys.size}`,fetcher:async(_url,init)=>{
  if(init.method!=='POST')return json({product});
  sent.push(JSON.parse(init.body).idempotencyKey);
  if(++attempt===1)throw Error('connection lost after commit');
  if(attempt===2)return json({workflow:{...workflow,productId:'other'}});
  return json({workflow});
 }};
 await assert.rejects(runBatchProduct('one',options),/connection lost/);
 await assert.rejects(runBatchProduct('one',options),/작업 결과/);
 await runBatchProduct('one',options);
 assert.equal(new Set(sent).size,1);assert.equal(keys.size,0);
});

test('closing during the product read prevents the write; mismatched products cannot run',async()=>{
 const controller=new AbortController();let writes=0;
 const options={keys:new Map(),signal:controller.signal,newKey:()=> 'key',fetcher:async(_url,init)=>{
  if(init.method==='POST')writes++;
  controller.abort();return json({product});
 }};
 assert.equal(await runBatchProduct('one',options),null);assert.equal(writes,0);
 await assert.rejects(runBatchProduct('one',{...options,signal:new AbortController().signal,fetcher:async()=>json({product:{...product,id:'other'}})}),/최신 상태/);
 assert.equal(options.keys.size,0);
});
