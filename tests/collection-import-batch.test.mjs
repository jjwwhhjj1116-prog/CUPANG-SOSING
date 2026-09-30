import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/collection-import-batch.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error});
const run=exports.importCollectionImageBatches;
const saved=index=>({index,status:200,key:`owner/${index}.png`});
const reply=results=>Response.json({results});

test('ordered batches preserve receipt indices and bound each request to three originals',async()=>{
 const calls=[],progress=[];
 const outcome=await run('/collection','p',[0,2,5,6,8,10,199],{shouldStop:()=>false,onProgress:value=>progress.push(value),request:async(path,init)=>{assert.equal(path,'/collection/images-batch');const indices=JSON.parse(init.body).indices;calls.push(indices);return reply([...indices].reverse().map(saved));}});
 assert.equal(outcome.status,'completed');assert.equal(outcome.completedImages,7);
 assert.deepEqual(calls,[[0,2,5],[6,8,10],[199]]);
 assert.equal(progress.at(-1).completedImages,7);assert.equal(progress.at(-1).totalImages,7);
});

test('stop finishes acknowledged batch writes and starts no next batch',async()=>{
 let stop=false,calls=0;
 const outcome=await run('/collection','p',[0,1,2,3],{shouldStop:()=>stop,request:async()=>{calls++;stop=true;return reply([0,1,2].map(saved));}});
 assert.equal(outcome.status,'stopped');assert.equal(outcome.completedImages,3);assert.equal(calls,1);
});

test('partial terminal response counts every committed member before stopping future batches',async()=>{
 let calls=0;
 const outcome=await run('/collection','p',[0,1,2,3],{shouldStop:()=>false,continueOnImageError:true,request:async()=>{calls++;return reply([{index:0,status:409,code:'IMAGE_DETACHED',error:'직접 제외한 이미지'},saved(1),saved(2)]);}});
 assert.equal(outcome.status,'failed');assert.equal(outcome.completedImages,2);assert.equal(calls,1);assert.match(outcome.error,/직접 제외/);
 assert.deepEqual(Array.from(outcome.failedImageIndices),[0]);
});

test('lost batch acknowledgement leaves its indices unconfirmed but independent batches continue',async()=>{
 let calls=0;
 const outcome=await run('/collection','p',[0,1,2,3,4],{shouldStop:()=>false,continueOnImageError:true,request:async()=>{calls++;return calls===1?{ok:true,json:async()=>{throw Error('body lost');}}:reply([3,4].map(saved));}});
 assert.equal(outcome.status,'failed');assert.equal(outcome.completedImages,2);assert.equal(calls,2);
 assert.deepEqual(Array.from(outcome.failedImageIndices),[0,1,2]);assert.match(outcome.error,/1, 2, 3/);
});

test('ambiguous, foreign, missing or duplicate acknowledgements cannot count an image as saved',async()=>{
 for(const results of [[saved(0),saved(0),saved(2)],[saved(0),saved(1),saved(9)],[saved(0),saved(1)],[saved(0),saved(1),{index:2,status:200}],[saved(0),saved(1),{index:2,status:201,key:'owner/2.png'}]]){
  const outcome=await run('/collection','p',[0,1,2],{shouldStop:()=>false,request:async()=>reply(results)});
  assert.equal(outcome.status,'failed');
  if(results.at(-1).status===201)assert.equal(outcome.completedImages,2);else assert.equal(outcome.completedImages,0);
 }
});

test('only the transient failed member uses the idempotent single-image retry',async()=>{
 const calls=[];
 const outcome=await run('/collection','p',[0,1,2],{shouldStop:()=>false,continueOnImageError:true,request:async(path,init)=>{calls.push([path,JSON.parse(init.body)]);return path.endsWith('/images-batch')?reply([saved(0),{index:1,status:503,error:'temporary'},saved(2)]):Response.json({key:'owner/1.png',reused:true});}});
 assert.equal(outcome.status,'completed');assert.equal(outcome.completedImages,3);
 assert.deepEqual(calls,[['/collection/images-batch',{indices:[0,1,2]}],['/collection/images',{index:1,assignToStage:false}]]);
});
