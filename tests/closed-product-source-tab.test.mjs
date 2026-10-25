import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRecoveryFixture} from './helpers/native-product-recovery.mjs';
import {productDocumentIdentity,createProductDocumentDraftReceiver} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {resolveProductSourceContext} from '../extensions/supplier-hub/product-source-context.mjs';
import {createVerifiedProductDocumentBrowserAdapter} from '../extensions/supplier-hub/product-document-adapter.mjs';
import {readProductSourceSession} from '../extensions/supplier-hub/product-source-session.mjs';

const copy=value=>structuredClone(value),nonce='original-closed-tab-source';
async function setup(){
 const f=await nativeRecoveryFixture(undefined,{sourceSessionId:nonce});
 const receiver=createProductDocumentDraftReceiver({adapter:{...f.adapter,readTab:async()=>{throw Error('pause-before-create');}},store:f.storage.store});
 const paused=await receiver.prepareDraft(f.packet,f.sender);assert.equal(paused.state,'target-created');assert.equal(paused.docId,null);
 const sender={...copy(f.sender),tab:{...copy(f.sender.tab),id:f.sender.tab.id+100}},oldTab=copy(f.tabs.find(tab=>tab.id===f.sender.tab.id));
 f.tabs.splice(f.tabs.findIndex(tab=>tab.id===oldTab.id),1);f.tabs.push({...oldTab,id:sender.tab.id});
 f.api.tabs.query=async()=>copy(f.tabs);
 const send=f.api.tabs.sendMessage,reads=[];f.api.tabs.sendMessage=async(id,...args)=>{reads.push(id);assert.equal(id,sender.tab.id);return send(f.sender.tab.id,...args);};
 const base=await productDocumentIdentity(f.packet,sender);
 return{f,sender,oldTab,base,reads,resolve:context=>resolveProductSourceContext(context,{api:f.api,store:f.storage.store})};
}

test('a closed original app tab transfers only current-source reads while retaining the original operation, nonce, target and document identity',async()=>{
 const x=await setup();let selected;
 try{
  const before=x.f.storage.changes.length,context=await x.resolve(x.base);
  assert.equal(context.sourceAppTabId,x.sender.tab.id);assert.equal(context.identity.appTabId,x.f.sender.tab.id);
  assert.equal(context.identityDigest,x.f.context.identityDigest);assert.equal(context.packetDigest,x.f.context.packetDigest);
  assert.equal(context.packet.requestId,x.f.packet.requestId);assert.equal(x.f.storage.changes.length,before);
  assert.ok(Object.isFrozen(context.identity.members));assert.ok(Object.isFrozen(context.packet.body.jsonDocument));
  selected=await createVerifiedProductDocumentBrowserAdapter(context,{api:x.f.api});
  const receiver=createProductDocumentDraftReceiver({adapter:selected.adapter,store:x.f.storage.store,resolveSourceContext:x.resolve});
  const recovered=await receiver.recoverDraft(x.f.packet,x.sender);
  assert.equal(recovered.recovered,true);assert.equal(recovered.state,'target-created');assert.equal(recovered.docId,null);
  assert.equal(recovered.identity.appTabId,x.f.sender.tab.id);assert.equal(recovered.registered,false);
  assert.equal(x.f.calls.filter(call=>call.name==='tabs-create').length,1);
  assert.ok(x.reads.length>0);assert.ok(x.reads.every(id=>id===x.sender.tab.id));assert.equal(x.f.state.uploads.length,0);
  // An explicit continuation resumes the same owned target instead of making
  // another tab or request, then exercises actual native byte/update guards.
  const prepared=await receiver.prepareDraft(x.f.packet,x.sender);
  assert.equal(prepared.state,'validated',JSON.stringify(prepared));assert.equal(prepared.draftProof.validatedSteps.length,4);
  assert.equal(prepared.requestId,x.f.packet.requestId);assert.equal(x.f.calls.filter(call=>call.name==='tabs-create').length,1);
  assert.deepEqual(x.f.documents.get(x.f.prior.docId),x.f.prior);assert.equal(x.f.submitted,0);
 }finally{selected?.adapter.dispose();x.f.close();}
});

test('an open original tab cannot be taken over even by the same authenticated account and product',async()=>{
 const x=await setup();try{x.f.tabs.push(x.oldTab);await assert.rejects(x.resolve(x.base));assert.equal(x.reads.length,0);}finally{x.f.close();}
});

test('different request, body, company, members, window or poisoned checkpoint cannot transfer a closed operation',async()=>{
 const changes=[c=>c.packet.requestId='another-request',c=>c.bodySha256='a'.repeat(64),c=>c.identity.company.code='A01464742',c=>c.identity.members[0].optionId='other',c=>c.identity.windowId++];
 for(const change of changes){const x=await setup();try{const context=copy(x.base);change(context);await assert.rejects(x.resolve(context));assert.equal(x.reads.length,0);}finally{x.f.close();}}
});

test('a replacement source tab navigation or reopening of the original tab blocks every later source proof',async()=>{
 for(const mode of ['navigation','reopened']){const x=await setup();let selected;try{
  const context=await x.resolve(x.base);selected=await createVerifiedProductDocumentBrowserAdapter(context,{api:x.f.api});
  if(mode==='navigation')x.f.tabs.find(tab=>tab.id===x.sender.tab.id).url='https://supplier.coupang.com/dashboard/KR';else x.f.tabs.push(x.oldTab);
  const reads=x.reads.length;await assert.rejects(selected.adapter.readSource({identity:context.identity,bodySha256:context.originalBodySha256,preparedBodySha256:context.bodySha256,packetDigest:context.packetDigest,requestId:x.f.packet.requestId,docId:null}));
  assert.equal(x.reads.length,reads);
 }finally{selected?.adapter.dispose();x.f.close();}}
});

test('the private nonce reader accepts only a proved closed original tab and never rewrites its checkpoint',async()=>{
 const x=await setup();try{
  const context=await x.resolve(x.base),expected={identity:context.identity,bodySha256:context.originalBodySha256,preparedBodySha256:context.bodySha256,packetDigest:context.packetDigest,requestId:x.f.packet.requestId,docId:null};
  const before=x.f.storage.changes.length;
  const api={...x.f.api,runtime:{id:'owned-extension'}};
  assert.deepEqual(await readProductSourceSession({type:'YOOFAM_READ_PRODUCT_SOURCE_SESSION',expected},{...x.sender,id:'owned-extension'},{api,store:x.f.storage.store}),{sessionId:nonce});
  assert.equal(x.f.storage.changes.length,before);x.f.tabs.push(x.oldTab);
  await assert.rejects(readProductSourceSession({type:'YOOFAM_READ_PRODUCT_SOURCE_SESSION',expected},{...x.sender,id:'owned-extension'},{api,store:x.f.storage.store}));
 }finally{x.f.close();}
});
