import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {nativeReviewFixture,companies} from './helpers/native-source-review.mjs';

// Controlled time drives the real source-reader module. Fetch and body reads
// deliberately ignore abort in some cases, as a hanging response did in UI.
function timedModel(f){
 const exports={},timers=new Map();let next=0;
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-native-product-document.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Error,URL,Date,Response,TextEncoder,TextDecoder,Uint8Array,AbortController,crypto:webcrypto,
   setTimeout(fn,ms){timers.set(++next,{fn,ms});return next;},clearTimeout(id){timers.delete(id);},
   require(name){assert.ok(name.startsWith('@/'));return f.h.load(name.slice(2)+'.ts');}});
 return{model:exports,timers,expire(){assert.equal(timers.size,1);const [id,timer]=[...timers][0];assert.equal(timer.ms,45000);timers.delete(id);timer.fn();}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function observedSignal(){
 const controller=new AbortController(),signal=controller.signal;let added=0,removed=0;
 const add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);
 signal.addEventListener=(type,...args)=>{if(type==='abort')added++;return add(type,...args);};
 signal.removeEventListener=(type,...args)=>{if(type==='abort')removed++;return remove(type,...args);};
 return{controller,signal,balance:()=>added-removed};
}

test('source deadline ends a fetch that ignores abort and keeps the caller task active',async()=>{
 const f=await nativeReviewFixture();try{
  const t=timedModel(f),caller=observedSignal();let requestSignal,resolveFetch,calls=0,cancelled=0;
  const pending=t.model.readCurrentNativeAssetSource({...f.scope,signal:caller.signal,fetcher:(_path,init)=>{calls++;requestSignal=init.signal;return new Promise(resolve=>{resolveFetch=resolve;});}});
  const rejected=assert.rejects(pending,error=>error.code==='SOURCE_READ_TIMEOUT'&&/45초/.test(error.message));t.expire();await rejected;
  assert.equal(caller.signal.aborted,false);assert.equal(requestSignal.aborted,true);assert.equal(caller.balance(),0);assert.equal(t.timers.size,0);
  resolveFetch(new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}}));await flush();
  assert.equal(calls,1);assert.equal(cancelled,1);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('source deadline also bounds a stalled response body and a nonsettling cancel',async()=>{
 const f=await nativeReviewFixture();try{
  const t=timedModel(f),caller=observedSignal();let calls=0,cancelled=0,readStarted=false;
  const body=new ReadableStream({pull(){readStarted=true;},cancel(){cancelled++;return new Promise(()=>{});}});
  const pending=t.model.readCurrentNativeAssetSource({...f.scope,signal:caller.signal,fetcher:async()=>{calls++;return new Response(body,{headers:{'content-type':'application/json'}});}});
  const rejected=assert.rejects(pending,error=>error.code==='SOURCE_READ_TIMEOUT');await flush();assert.equal(readStarted,true);t.expire();await rejected;await flush();
  assert.equal(caller.signal.aborted,false);assert.equal(caller.balance(),0);assert.equal(t.timers.size,0);assert.equal(cancelled,1);assert.equal(calls,1);
 }finally{f.close();}
});

test('caller cancellation stops the source read without turning into a local timeout',async()=>{
 const f=await nativeReviewFixture();try{
  const t=timedModel(f),caller=observedSignal();let requestSignal;
  const pending=t.model.readCurrentNativeAssetSource({...f.scope,signal:caller.signal,fetcher:(_path,init)=>{requestSignal=init.signal;return new Promise(()=>{});}});
  const rejected=assert.rejects(pending,error=>error.code==='SOURCE_READ_ABORTED');caller.controller.abort();await rejected;
  assert.equal(requestSignal.aborted,true);assert.equal(caller.balance(),0);assert.equal(t.timers.size,0);
 }finally{f.close();}
});

test('successful source reads clear deadline and parent listener and still compare the final actor',async()=>{
 const f=await nativeReviewFixture();try{
  const t=timedModel(f),caller=observedSignal();let actorReads=0;
  await assert.rejects(t.model.readCurrentNativeAssetSource({...f.scope,signal:caller.signal,fetcher:async(path,init)=>{
   if(path.includes('catalog-context')&&++actorReads===2)return Response.json({ownerId:'owner',company:companies[1]});
   return f.request(path,init);
  }}));
  assert.equal(actorReads,2);assert.equal(caller.signal.aborted,false);assert.equal(caller.balance(),0);assert.equal(t.timers.size,0);
  const current=await t.model.readCurrentNativeAssetSource({...f.scope,signal:caller.signal,fetcher:f.request});
  assert.equal(current.sourcePlanSha256,f.sourcePlan.sourcePlanSha256);assert.equal(caller.balance(),0);assert.equal(t.timers.size,0);
 }finally{f.close();}
});
