import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/codex-main-image-channel.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,BroadcastChannel,crypto,AbortController,AbortSignal,setTimeout,clearTimeout,Date,Error,JSON});return exports;}
const scope={ownerId:'owner',company:{code:'A01526306',name:'유앤채'}},image={mimeType:'image/png',data:'iVBORw0KGgo='},job={productId:'product',optionId:'red',profileId:null,sourceKey:'owner/original.png',prompt:'제품 모양을 유지하세요.',image};
test('Codex picks an explicitly requested main image and applies its result exactly once',async()=>{
 const m=load(),controller=new AbortController(),channel='test-'+crypto.randomUUID(),applied=[];
 const pending=m.requestCodexMainImageEdit(job,scope,{signal:controller.signal,channel,onApply:async file=>{applied.push(file);return{key:'owner/result.png',productVersion:'2026-11-05T00:00:00Z'};}});
 const picked=await m.dispatchCodexMainImageCommand('main-image/next',{},scope,{channel,signal:controller.signal});
 assert.equal(picked.job.optionId,'red');assert.equal(picked.job.sourceKey,'owner/original.png');assert.equal(picked.image.data,image.data);
 const result=await m.dispatchCodexMainImageCommand('main-image/complete',{requestId:picked.job.requestId,image},scope,{channel,signal:controller.signal});
 assert.equal(result.key,'owner/result.png');assert.equal((await pending).key,'owner/result.png');assert.equal(applied.length,1);
 await assert.rejects(m.dispatchCodexMainImageCommand('main-image/complete',{requestId:picked.job.requestId,image},scope,{channel,signal:AbortSignal.timeout(80)}));assert.equal(applied.length,1);controller.abort();
});
test('a different company cannot claim or complete the pending request; cancellation never applies',async()=>{
 const m=load(),controller=new AbortController(),channel='test-'+crypto.randomUUID();let writes=0;
 const pending=m.requestCodexMainImageEdit(job,scope,{channel,signal:controller.signal,onApply:async()=>{writes++;}});pending.catch(()=>{});
 const other={ownerId:'owner',company:{code:'A01464742',name:'와이홉'}};
 const none=await m.dispatchCodexMainImageCommand('main-image/next',{},other,{channel,signal:controller.signal});assert.equal(none.job,null);
 controller.abort();await assert.rejects(pending);assert.equal(writes,0);
});
