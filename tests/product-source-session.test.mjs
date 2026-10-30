import test from 'node:test';
import assert from 'node:assert/strict';
import {readProductSourceSession} from '../extensions/supplier-hub/product-source-session.mjs';
import {nativeRecoveryFixture} from './helpers/native-product-recovery.mjs';

const copy=value=>structuredClone(value),nonce='original-owned-source-session';
async function fixture(){
 const f=await nativeRecoveryFixture(),c=f.context;
 const expected={identity:copy(c.identity),bodySha256:c.originalBodySha256,preparedBodySha256:c.bodySha256,packetDigest:c.packetDigest,requestId:f.packet.requestId,docId:null};
 const state={format:'yoofam-supplier-hub-product-document-v1',draftOnly:true,key:c.key,identity:copy(c.identity),identityDigest:c.identityDigest,packetDigest:c.packetDigest,
  requestId:f.packet.requestId,originalBodySha256:c.originalBodySha256,bodySha256:c.bodySha256,docId:null,sessionId:nonce};
 const sender={...copy(f.sender),id:'source-session-test'},message={type:'YOOFAM_READ_PRODUCT_SOURCE_SESSION',expected};let reads=0,tabReads=0;
 const api={runtime:{id:sender.id},tabs:{get:async()=>{tabReads++;return{id:sender.tab.id,windowId:sender.tab.windowId,url:sender.url};}}};
 const store={get:async key=>{reads++;assert.equal(key,c.key);return state;}};
 return{f,c,expected,state,sender,message,api,store,counts:()=>({reads,tabReads})};
}

test('only the exact authenticated top-level operation can read its private checkpoint nonce without a Hub request or write',async()=>{
 const x=await fixture();try{
  assert.deepEqual(await readProductSourceSession(x.message,x.sender,x),{sessionId:nonce});
  assert.deepEqual(x.counts(),{reads:1,tabReads:2});
  assert.equal(x.f.state.uploads.length,0);assert.equal(x.f.state.recoveryRequests.length,0);
 }finally{x.f.close();}
});

test('an operation with no checkpoint keeps its new nonce and never creates a record',async()=>{
 const x=await fixture();try{assert.deepEqual(await readProductSourceSession(x.message,x.sender,{api:x.api,store:{get:async()=>undefined}}),{sessionId:null});}finally{x.f.close();}
});

test('a reserved operation which has not bound a session or target keeps its new source nonce',async()=>{
 const x=await fixture();try{Object.assign(x.state,{sessionId:null,state:'prepared',docId:null,tab:null,ownedTarget:null});assert.deepEqual(await readProductSourceSession(x.message,x.sender,x),{sessionId:null});}finally{x.f.close();}
});

test('foreign extension, frame, origin, app tab or window cannot read a nonce',async()=>{
 const mutations=[s=>s.id='other',s=>s.frameId=1,s=>s.url='https://detail.1688.com/offer/886.html',s=>s.tab.id++,s=>s.tab.windowId++];
 for(const mutate of mutations){const x=await fixture();try{const sender=copy(x.sender);mutate(sender);await assert.rejects(readProductSourceSession(x.message,sender,x));assert.equal(x.counts().reads,0);}finally{x.f.close();}}
});

test('different account, source, members, document, request or body cannot inherit another operation nonce',async()=>{
 const mutations=[s=>s.identity.ownerId='foreign-owner',s=>s.identity.company.code='A01464742',s=>s.identity.members[0].optionId='other-option',s=>s.identity.appTabId++,s=>s.identityDigest='a'.repeat(64),
  s=>s.requestId='foreign-request',s=>s.bodySha256='a'.repeat(64),s=>s.originalBodySha256='a'.repeat(64),s=>s.packetDigest='a'.repeat(64),s=>s.docId=123,s=>s.draftOnly=false,s=>s.sessionId=''];
 for(const mutate of mutations){const x=await fixture();try{mutate(x.state);await assert.rejects(readProductSourceSession(x.message,x.sender,x));}finally{x.f.close();}}
});

test('a navigation during the private checkpoint read blocks the reply',async()=>{
 const x=await fixture();try{
  let navigated=false;x.store.get=async()=>{navigated=true;return x.state;};x.api.tabs.get=async()=>({id:x.sender.tab.id,windowId:x.sender.tab.windowId,url:navigated?'https://supplier.coupang.com/dashboard/KR':x.sender.url});
  await assert.rejects(readProductSourceSession(x.message,x.sender,x));
 }finally{x.f.close();}
});

test('actual isolated source code restores only once after fresh full proof and preserves the original operation across a page reload',async()=>{
 const calls=[],f=await nativeRecoveryFixture(undefined,{sourceSessionId:nonce,onSourceSessionRead:message=>calls.push(message)});
 try{
  const input={identity:f.context.identity,bodySha256:f.context.originalBodySha256,preparedBodySha256:f.context.bodySha256,packetDigest:f.context.packetDigest,requestId:f.packet.requestId,docId:null};
  const first=await f.adapter.readSource(input);assert.equal(first.sessionId,nonce);assert.equal(calls.length,1);
  await f.adapter.readSource(input);assert.equal(calls.length,1);
  await f.reloadSourceSession();const restored=await f.adapter.readSource(input);assert.equal(restored.sessionId,nonce);assert.equal(calls.length,2);
  assert.equal(f.state.uploads.length,0);assert.equal(f.state.recoveryRequests.length,0);
  f.state.company={code:'A01464742',name:'와이홉'};await assert.rejects(f.adapter.readSource(input),{code:'SOURCE_CHANGED'});assert.equal(calls.length,2);
  f.state.company=copy(input.identity.company);assert.equal((await f.adapter.readSource(input)).current,false);
  assert.notEqual((await f.adapter.readSource(input)).sessionId,nonce,'an observed account ABA cannot restore the prior nonce inside the same page');assert.equal(calls.length,2);
 }finally{f.close();}
});
