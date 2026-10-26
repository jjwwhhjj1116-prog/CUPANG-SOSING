import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRecoveryFixture} from './helpers/native-product-recovery.mjs';
import {createProductDocumentDraftReceiver} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {createProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';

async function pending(t){
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const f=await nativeRecoveryFixture(undefined,{sourceSessionId:'closed-owned-source',browser:{dropNullArguments:true}});
 const dropped={...f.adapter,hubRequest:async input=>input.method==='POST'&&input.path.endsWith('/create')?undefined:f.adapter.hubRequest(input)};
 const legacy=createProductDocumentDraftReceiver({adapter:dropped,store:f.storage.store});
 await legacy.prepareDraft(f.packet,f.sender);t.mock.timers.tick(61000);await legacy.retryCreateDraft(f.packet,f.sender);await legacy.resumeCreateRetryDraft(f.packet,f.sender);
 const receiver=()=>createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store});
 return{f,receiver,close:()=>{f.close();t.mock.timers.reset();},posts:()=>f.calls.filter(c=>c.name==='hub-fetch'&&c.init.method==='POST'&&c.url.endsWith('/create')).length,targets:()=>f.calls.filter(c=>c.name==='tabs-create').length};
}

test('closed original target requires an explicit connection approval; reconnect preserves request/audit and stops before any Hub write',async t=>{
 const p=await pending(t),{f}=p;
 try{const original=structuredClone(await f.storage.store.get(f.context.key)),prior=structuredClone(f.documents.get(f.prior.docId));f.closeOwnedTab();
  const blocked=await p.receiver().recoverPreparedDraft(f.packet,f.sender);
  assert.equal(blocked.state,'create-requested');assert.equal(blocked.error.code,'CLOSED_TARGET_APPROVAL');assert.equal(p.targets(),1);assert.equal(p.posts(),0);
  const bound=await p.receiver().recoverClosedTarget(f.packet,f.sender);
  assert.equal(bound.state,'create-requested',JSON.stringify(bound));assert.equal(bound.recovered,true);assert.equal(bound.requestId,original.requestId);assert.equal(bound.docId,null);assert.equal(p.targets(),2);assert.equal(p.posts(),0);
  const saved=await f.storage.store.get(f.context.key);assert.deepEqual(saved.createRetry,original.createRetry);assert.deepEqual(saved.baselineDocIds,original.baselineDocIds);
  assert.equal(saved.targetRecovery.previousTarget.tabId,original.ownedTarget.tabId);assert.notEqual(saved.ownedTarget.tabId,original.ownedTarget.tabId);assert.equal(saved.targetRecovery.phase,'bound');
  const result=await p.receiver().recoverDraft(f.packet,f.sender);assert.equal(result.state,'target-created',JSON.stringify(result));assert.equal(p.posts(),0);
  const packet=await createProductDocumentPacket(f.packet.review,{requestId:f.packet.requestId,createdAt:Date.now(),now:Date.now()}),done=await p.receiver().prepareDraft(packet,f.sender);
  assert.equal(done.state,'validated',JSON.stringify(done));assert.equal(done.draftProof.validatedSteps.length,4);assert.equal(p.posts(),1);assert.equal(p.targets(),2);assert.equal(f.submitted,0);assert.deepEqual(f.documents.get(f.prior.docId),prior);
 }finally{p.close();}
});

test('an open owned tab on another page cannot be replaced and unrelated existing tabs are never selected',async t=>{
 const p=await pending(t),{f}=p;
 try{f.hubLocation.pathname='/po-web/purchase/order/list';const result=await p.receiver().recoverClosedTarget(f.packet,f.sender);
  assert.equal(result.error.code,'CLOSED_TARGET_SCOPE');assert.equal(p.targets(),1);assert.equal(p.posts(),0);
 }finally{p.close();}
});

test('lost replacement-tab ACK stays reserved without creating another tab or any document',async t=>{
 const p=await pending(t),{f}=p;
 try{f.closeOwnedTab();const create=f.api.tabs.create;f.api.tabs.create=async input=>{await create(input);return undefined;};
  await p.receiver().recoverClosedTarget(f.packet,f.sender);assert.equal(p.targets(),2);assert.equal(p.posts(),0);
  for(const action of ['recoverDraft','recoverClosedTarget']){const result=await p.receiver()[action](f.packet,f.sender);assert.equal(result.error.code,'CLOSED_TARGET_PENDING');}
  assert.equal(p.targets(),2);assert.equal(p.posts(),0);assert.equal((await f.storage.store.get(f.context.key)).targetRecovery.phase,'requested');
 }finally{p.close();}
});

test('source/company changes block the closed-target approval before a new tab is created',async t=>{
 const p=await pending(t),{f}=p;
 try{f.closeOwnedTab();f.state.company={code:'A01464742',name:'와이홉'};const result=await p.receiver().recoverClosedTarget(f.packet,f.sender);
  assert.equal(result.state,'scope-blocked');assert.equal(p.targets(),1);assert.equal(p.posts(),0);
 }finally{p.close();}
});

test('two independent closed-target approvals reserve one replacement and never dispatch creation',async t=>{
 const p=await pending(t),{f}=p;
 try{f.closeOwnedTab();await Promise.all([p.receiver().recoverClosedTarget(f.packet,f.sender),p.receiver().recoverClosedTarget(f.packet,f.sender)]);
  assert.equal(p.targets(),2);assert.equal(p.posts(),0);const saved=await f.storage.store.get(f.context.key);assert.ok(['created','bound'].includes(saved.targetRecovery.phase));
 }finally{p.close();}
});
