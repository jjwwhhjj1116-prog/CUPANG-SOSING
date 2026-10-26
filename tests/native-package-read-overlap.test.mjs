import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeReviewFixture,json,plain} from './helpers/native-source-review.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
async function arrived(...signals){
 let timer;
 try{await Promise.race([Promise.all(signals.map(signal=>signal.promise)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Independent reads did not overlap')),5000);})]);}
 finally{clearTimeout(timer);}
}
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
function request(f){return f.h.load('app/api/products/[id]/native-assets/route.ts').GET(new Request('https://app.test'+f.sourcePath),f.context);}

test('initial native attachment bodies and metadata HEAD overlap without changing the exact source plan or read counts',async()=>{
 const f=await nativeReviewFixture(),getGate=deferred(),headGate=deferred(),getStarted=deferred(),headStarted=deferred();let pending;
 try{
  const get=f.h.bindings.FILES.get,head=f.h.bindings.FILES.head,key=f.keys[0],gets=new Map(),heads=new Map(),objects=f.objectState();let gated=false;
  f.h.bindings.FILES.get=async current=>{const count=(gets.get(current)??0)+1;gets.set(current,count);if(gated&&current===key&&count===1){getStarted.resolve();await getGate.promise;}return get(current);};
  f.h.bindings.FILES.head=async current=>{const count=(heads.get(current)??0)+1;heads.set(current,count);if(gated&&current===key&&count===1){headStarted.resolve();await headGate.promise;}return head(current);};
  await json(await request(f));const baselineHeads=new Map(heads);gets.clear();heads.clear();gated=true;
  pending=request(f);await arrived(getStarted,headStarted);
  getGate.resolve();headGate.resolve();const plan=await json(await pending);
  assert.deepEqual(plain(plan),plain(f.sourcePlan));
  for(const file of plan.images){assert.equal(gets.get(file.key),2);assert.equal(heads.get(file.key),baselineHeads.get(file.key),'overlap adds no HEAD, including existing generated-label proofs');}
  assert.equal(f.objectState(),objects);assert.deepEqual(f.h.network,[]);
 }finally{getGate.resolve();headGate.resolve();await pending;f.close();}
});

test('current native file body and fresh HEAD overlap, but HEAD still starts after GET has resolved',async()=>{
 const f=await nativeReviewFixture(),bodyGate=deferred(),headGate=deferred(),bodyStarted=deferred(),headStarted=deferred();let pending;
 try{
  const get=f.h.bindings.FILES.get,head=f.h.bindings.FILES.head,key=f.keys[0];let gets=0,heads=0,getResolved=false,finished=false;
  f.h.bindings.FILES.get=async current=>{
   const value=await get(current);if(current!==key||++gets!==2)return value;
   getResolved=true;return{...value,arrayBuffer:async()=>{bodyStarted.resolve();await bodyGate.promise;return value.arrayBuffer();}};
  };
  f.h.bindings.FILES.head=async current=>{
   if(current===key&&++heads===2){assert.equal(getResolved,true,'fresh metadata read follows the GET response');headStarted.resolve();await headGate.promise;}
   return head(current);
  };
  pending=request(f).then(response=>{finished=true;return response;});await arrived(bodyStarted,headStarted);
  headGate.resolve();await nextTurn();assert.equal(finished,false,'the response waits for current body/hash validation');
  bodyGate.resolve();assert.deepEqual(plain(await json(await pending)),plain(f.sourcePlan));assert.equal(gets,2);assert.equal(heads,2);assert.deepEqual(f.h.network,[]);
 }finally{bodyGate.resolve();headGate.resolve();await pending;f.close();}
});

for(const failed of ['get','head'])test(`an initial ${failed} failure waits for the other parallel read and returns no partial plan`,async()=>{
 const f=await nativeReviewFixture(),gate=deferred(),blocked=deferred(),rejected=deferred();let pending;
 try{
  const get=f.h.bindings.FILES.get,head=f.h.bindings.FILES.head,key=f.keys[0];let finished=false;
  const wrap=(kind,original)=>async current=>{
   if(current===key){if(kind===failed){rejected.resolve();throw Error('Synthetic '+kind+' failure');}blocked.resolve();await gate.promise;}
   return original(current);
  };
  f.h.bindings.FILES.get=wrap('get',get);f.h.bindings.FILES.head=wrap('head',head);
  pending=request(f).then(response=>{finished=true;return response;});await arrived(blocked,rejected);await nextTurn();assert.equal(finished,false);
  gate.resolve();const response=await pending,body=await response.json();assert.equal(response.status,503);assert.ok(body.error);assert.equal(body.images,undefined);assert.deepEqual(f.h.network,[]);
 }finally{gate.resolve();await pending;f.close();}
});

test('a failed current body digest still waits for its parallel metadata proof and withholds the plan',async()=>{
 const f=await nativeReviewFixture(),headGate=deferred(),headStarted=deferred(),bodyRead=deferred();let pending;
 try{
  const get=f.h.bindings.FILES.get,head=f.h.bindings.FILES.head,key=f.keys[0];let gets=0,heads=0,finished=false;
  f.h.bindings.FILES.get=async current=>{
   const value=await get(current);if(current!==key||++gets!==2)return value;
   return{...value,arrayBuffer:async()=>{const bytes=new Uint8Array(await value.arrayBuffer());bytes[bytes.length-1]^=1;bodyRead.resolve();return bytes.buffer;}};
  };
  f.h.bindings.FILES.head=async current=>{if(current===key&&++heads===2){headStarted.resolve();await headGate.promise;}return head(current);};
  pending=request(f).then(response=>{finished=true;return response;});await arrived(headStarted,bodyRead);await nextTurn();assert.equal(finished,false);
  headGate.resolve();const response=await pending,body=await response.json();assert.equal(response.status,409);assert.equal(body.code,'SINGLE_SOURCE_CHANGED');assert.equal(body.images,undefined);assert.deepEqual(f.h.network,[]);
 }finally{headGate.resolve();await pending;f.close();}
});
