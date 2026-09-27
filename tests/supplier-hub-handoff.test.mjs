import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
const code=ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-handoff.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(reply){
  const listeners=new Set(),timers=new Set(),sent=[];
  const win={location:{origin:'https://sourceflow.jjwwhhjj1116.workers.dev'},addEventListener:(_,cb)=>listeners.add(cb),removeEventListener:(_,cb)=>listeners.delete(cb),postMessage(message){sent.push(message);queueMicrotask(()=>reply?.(message,emit));}};
  const emit=(message,result,overrides={})=>{for(const listener of [...listeners])listener({source:win,origin:win.location.origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:message.requestId,result},...overrides});};
  const exports={};vm.runInNewContext(code,{exports,window:win,crypto:webcrypto,Uint8Array,btoa,Error,setTimeout:cb=>{timers.add(cb);return cb;},clearTimeout:cb=>timers.delete(cb)});
  return {api:exports,sent,listeners,timers,expire(){for(const cb of [...timers])cb();}};
}
const identity={productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64)};
test('registration evidence stays bound to quotation ID and a bounded visible page',()=>{
 const api=harness().api;
 const value={quotationId:'123',scope:'visible-page',registered:false,observedAt:Date.now(),rows:[{title:'상품',submittedAt:'date',category:'cat',barcode:'',sourceQuotation:'file',skuId:'1',status:'상품 검수 완료',stage:'발주서 발행'}]};
 assert.equal(api.validateRegistrationResult(value,'123').registered,false);
 for(const patch of [{quotationId:'other'},{scope:'all'},{registered:true},{observedAt:Infinity},{rows:[{}]},{rows:Array(1001).fill(value.rows[0])}])assert.throws(()=>api.validateRegistrationResult({...value,...patch},'123'));
});
test('web package handoff sends exact reviewed identity and bytes, cleans listeners',async()=>{
  const h=harness((m,emit)=>emit(m,m.type==='PING'?{ok:true}:{ok:true,fingerprint:identity.fingerprint,registered:false}));
  await h.api.checkSupplierHubExtension(new AbortController().signal);
  await h.api.prepareSupplierHubHandoff(new Blob(['ZIP fixture']),identity,new AbortController().signal);
  assert.equal(h.sent[0].type,'PING');assert.equal(h.sent[1].payload.fingerprint,identity.fingerprint);
  assert.equal(Buffer.from(h.sent[1].payload.base64,'base64').toString(),'ZIP fixture');assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);
});
test('foreign-window and foreign-origin responses cannot acknowledge handoff',async()=>{
  const h=harness((m,emit)=>{emit(m,{ok:true},{source:{}});emit(m,{ok:true},{origin:'https://evil.example'});});
  const pending=h.api.checkSupplierHubExtension(new AbortController().signal);await Promise.resolve();assert.equal(h.listeners.size,1);h.expire();await assert.rejects(pending,/설치/);assert.equal(h.listeners.size,0);
});
test('mismatched acknowledgement, oversized payload, cancellation and extension error fail without retries',async()=>{
  const h=harness((m,emit)=>emit(m,{ok:true,fingerprint:'b'.repeat(64),registered:false}));
  await assert.rejects(()=>h.api.prepareSupplierHubHandoff(new Blob(['x']),identity,new AbortController().signal),/다릅니다/);assert.equal(h.sent.length,1);
  await assert.rejects(()=>h.api.prepareSupplierHubHandoff({size:31*1024*1024},identity,new AbortController().signal),/30MB/);assert.equal(h.sent.length,1);
  const idle=harness(),controller=new AbortController(),pending=idle.api.checkSupplierHubExtension(controller.signal);controller.abort();await assert.rejects(pending,/취소/);assert.equal(idle.listeners.size,0);
  const failed=harness((m,emit)=>emit(m,{ok:false,error:'저장 실패'}));await assert.rejects(()=>failed.api.checkSupplierHubExtension(new AbortController().signal),/저장 실패/);assert.equal(failed.sent.length,1);
});

test('result retrieval uses exact reviewed identity and never promotes validation to registration',async()=>{
  const record={...identity,origin:'https://sourceflow.jjwwhhjj1116.workers.dev',filename:`YOOFAM-${identity.fingerprint}.xlsx`,state:'validation-complete',status:'완료',quotationId:'123',observedAt:Date.now(),registered:false};
  const h=harness((m,emit)=>emit(m,{ok:true,fingerprint:identity.fingerprint,record,registered:false}));
  const result=await h.api.getSupplierHubResult(identity,new AbortController().signal);
  assert.equal(h.sent[0].type,'RESULT');assert.equal(result.quotationId,'123');assert.equal(result.registered,false);assert.equal(h.listeners.size,0);
  for(const change of [{productId:'other'},{categoryId:'999'},{fingerprint:'b'.repeat(64)},{filename:'different.xlsx'},{registered:true},{observedAt:NaN},{state:'registered'},{detail:{}}]){
    const wrong=harness((m,emit)=>emit(m,{ok:true,fingerprint:identity.fingerprint,record:{...record,...change},registered:false}));
    await assert.rejects(()=>wrong.api.getSupplierHubResult(identity,new AbortController().signal));
  }
  const missing=harness((m,emit)=>emit(m,{ok:true,fingerprint:identity.fingerprint,record:null,registered:false}));
  assert.equal(await missing.api.getSupplierHubResult(identity,new AbortController().signal),null);
});
