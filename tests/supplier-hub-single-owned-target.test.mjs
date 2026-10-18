import test from 'node:test';
import assert from 'node:assert/strict';
import {singleBrowserFixture} from './helpers/supplier-hub-single-document-adapter.mjs';
import {SINGLE_COMPANIES} from './helpers/supplier-hub-single-document.mjs';
import {createSingleDocumentBrowserAdapter} from '../extensions/supplier-hub/single-document-adapter.mjs';
import {createSingleDocumentReceiver} from '../extensions/supplier-hub/single-document.mjs';
import {dispatchSingleDocument,SINGLE_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/single-dispatch.mjs';

// Actual receiver, SQLite checkpoints and serialized page functions. Every
// Chrome tab/document/receipt below is synthetic; no native browser or HTTP.
const protectedTabs=[
  {id:727931166,windowId:29,url:'https://supplier.coupang.com/sr/registration/step/productPage',status:'complete'},
  {id:727932928,windowId:29,url:'https://supplier.coupang.com/dashboard/KR',status:'complete'},
  {id:727932710,windowId:29,url:'https://couplus.example.test/workspace',status:'complete'},
];
const tabCreates=f=>f.calls.filter(call=>call.name==='tabs-create');
const remoteWrites=f=>f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST');
function untouched(f){
  assert.deepEqual(f.tabs.filter(tab=>protectedTabs.some(prior=>prior.id===tab.id)),protectedTabs);
  assert.deepEqual(f.documents.get('protected-previous'),f.prior);
  assert.equal(f.calls.some(call=>call.name==='tabs-query'),false);
  assert.equal(f.calls.some(call=>call.name==='execute'&&protectedTabs.some(tab=>tab.id===call.target.tabId)
    ||call.name==='tabs-update'&&protectedTabs.some(tab=>tab.id===call.id)),false);
}
function replacement(f){
  f.adapter.dispose();const adapter=createSingleDocumentBrowserAdapter({api:f.api});
  return {adapter,receiver:createSingleDocumentReceiver({adapter,store:f.storage.store})};
}

for(const company of SINGLE_COMPANIES)test(company.name+' owns a new inactive tab beside protected tabs through staged consent and exact receipt',async()=>{
  const f=await singleBrowserFixture(company,{extraTabs:protectedTabs,stageFlow:true,registerRequestedRows:f=>[
    {docId:f.createdDocId,status:'SUBMITTED',qvtRequestId:'synthetic-owned-QVT',productName:f.packet.body.productName,categoryPath:f.packet.body.categoryPath,modifiedAt:new Date().toISOString(),remark:''},
  ]});
  try{
    const rawCreate=f.api.tabs.create;f.api.tabs.create=async input=>{
      const checkpoint=f.storage.get(f.context.key);assert.equal(checkpoint.state,'target-requested');assert.equal(checkpoint.ownedTarget,null);assert.equal(checkpoint.sessionId,f.sessionId);
      assert.equal(remoteWrites(f).length,0);return rawCreate(input);
    };
    const rawExecute=f.api.scripting.executeScript;f.api.scripting.executeScript=async request=>{
      if(request.target.tabId===71){const checkpoint=f.storage.get(f.context.key);assert.equal(checkpoint.ownedTarget.tabId,71);assert.equal(checkpoint.ownedTarget.packetDigest,f.context.packetDigest);}
      return rawExecute(request);
    };
    let state=await f.receiver.start(f.packet,f.sender);assert.equal(state.state,'awaiting-stage-consent',JSON.stringify(state));
    assert.equal(f.submitted,0);assert.equal(remoteWrites(f).length,6);assert.equal(tabCreates(f).length,1);
    assert.deepEqual(tabCreates(f)[0].input,{windowId:f.sender.tab.windowId,url:'https://supplier.coupang.com/dashboard/KR',active:false});
    assert.deepEqual(f.storage.get(f.context.key).ownedTarget,{tabId:71,windowId:29,origin:'https://supplier.coupang.com',requestId:f.packet.requestId,packetDigest:f.context.packetDigest});
    for(let stage=0;stage<2;stage++)state=await f.receiver.confirm(f.packet,f.sender,f.action(state));
    assert.equal(state.state,'awaiting-consent');assert.equal(f.submitted,0);
    state=await f.receiver.confirm(f.packet,f.sender,f.action(state));assert.equal(state.state,'pending',JSON.stringify(state));assert.equal(state.receipt.receiptId,'synthetic-owned-QVT');assert.equal(state.registered,false);
    await f.receiver.start(f.packet,f.sender);await f.receiver.observe(f.packet,f.sender);assert.equal(f.submitted,1);assert.equal(tabCreates(f).length,1);assert.equal(remoteWrites(f).length,6);untouched(f);
  }finally{f.close();}
});

test('company verification failure retains the new target and worker restart resumes only that exact tab',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{extraTabs:protectedTabs});let other;
  const rawExecute=f.api.scripting.executeScript;let mismatch=true;
  f.api.scripting.executeScript=async request=>request.target.tabId===71&&request.func.name==='verifySupplierHubCompany'&&mismatch
    ?[{frameId:0,result:{code:SINGLE_COMPANIES[1].code}}]:rawExecute(request);
  try{
    const blocked=await f.receiver.start(f.packet,f.sender);assert.equal(blocked.state,'scope-blocked');assert.equal(remoteWrites(f).length,0);
    const checkpoint=f.storage.get(f.context.key);assert.equal(checkpoint.state,'target-created');assert.equal(checkpoint.tab,null);assert.equal(checkpoint.ownedTarget.tabId,71);
    mismatch=false;other=replacement(f);
    const recovered=await other.receiver.recover(f.packet,f.sender);assert.equal(recovered.state,'target-created');assert.equal(remoteWrites(f).length,0);
    const resumed=await other.receiver.resume(f.packet,f.sender);assert.equal(resumed.state,'awaiting-consent',JSON.stringify(resumed));assert.equal(tabCreates(f).length,1);untouched(f);
  }finally{other?.adapter.dispose();f.close();}
});

test('lost Chrome create acknowledgement or target checkpoint acknowledgement never creates or adopts another tab',async()=>{
  for(const lost of ['create-ack','target-cas','committed-target-ack']){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{extraTabs:protectedTabs});let other;
    const rawCreate=f.api.tabs.create,rawCas=f.storage.store.compareAndSet;
    if(lost==='create-ack')f.api.tabs.create=async input=>{await rawCreate(input);throw Error('Synthetic Chrome create ACK lost');};
    else f.storage.store.compareAndSet=async(key,before,next)=>{
      if(next.state==='target-created'){
        if(lost==='committed-target-ack'){await rawCas(key,before,next);throw Error('Synthetic checkpoint ACK lost after commit');}
        return false;
      }
      return rawCas(key,before,next);
    };
    try{
      const pending=await f.receiver.start(f.packet,f.sender);assert.equal(remoteWrites(f).length,0);assert.equal(tabCreates(f).length,1);
      assert.equal(pending.state,lost==='committed-target-ack'?'target-created':'target-requested');
      f.storage.store.compareAndSet=rawCas;other=replacement(f);
      const recovered=await other.receiver.recover(f.packet,f.sender);assert.equal(remoteWrites(f).length,0);
      if(lost==='committed-target-ack'){
        assert.equal(recovered.state,'target-created');const resumed=await other.receiver.resume(f.packet,f.sender);assert.equal(resumed.state,'awaiting-consent');
      }else{
        assert.equal(recovered.error.code,'TARGET_UNCONFIRMED');assert.equal(recovered.needsRecovery,true);
        await other.receiver.start(f.packet,f.sender);await other.receiver.resume(f.packet,f.sender);assert.equal(remoteWrites(f).length,0);
      }
      assert.equal(tabCreates(f).length,1);untouched(f);
    }finally{other?.adapter.dispose();f.close();}
  }
});

test('closed, moved or redirected owned targets cannot fall back to an existing authenticated Hub tab',async()=>{
  for(const change of ['closed','moved','redirected']){
    const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{extraTabs:protectedTabs});const rawCreate=f.api.tabs.create;
    f.api.tabs.create=async input=>{
      const tab=await rawCreate(input);
      if(change==='closed')f.tabs.splice(f.tabs.findIndex(row=>row.id===71),1);
      if(change==='moved')f.tabs.find(row=>row.id===71).windowId=999;
      if(change==='redirected')f.hubLocation.pathname='/login';
      return tab;
    };
    try{
      const result=await f.receiver.start(f.packet,f.sender);assert.equal(result.state,'scope-blocked',JSON.stringify(result));assert.equal(f.storage.get(f.context.key).state,'target-created');
      await f.receiver.recover(f.packet,f.sender);await f.receiver.resume(f.packet,f.sender);assert.equal(remoteWrites(f).length,0);assert.equal(tabCreates(f).length,1);untouched(f);
    }finally{f.close();}
  }
});

test('legacy active checkpoints without owned provenance fail closed before touching any browser tab',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{extraTabs:protectedTabs});
  try{
    await f.receiver.start(f.packet,f.sender);const old=f.storage.get(f.context.key);delete old.ownedTarget;delete old.tab.requestId;delete old.tab.packetDigest;f.storage.force(f.context.key,old);
    const calls=f.calls.length;
    await assert.rejects(()=>f.receiver.recover(f.packet,f.sender),error=>error.code==='CHECKPOINT');
    assert.equal(f.calls.length,calls);assert.equal(tabCreates(f).length,1);untouched(f);
  }finally{f.close();}
});

test('unverified live dispatch still cannot instantiate a target or send a remote request',async()=>{
  const f=await singleBrowserFixture(SINGLE_COMPANIES[0],{extraTabs:protectedTabs});
  try{
    assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);
    await assert.rejects(()=>dispatchSingleDocument({type:'YOOFAM_SINGLE_DOCUMENT_REQUEST',action:'start',packet:f.packet},f.sender),error=>error.code==='SINGLE_LIVE_CONTRACT_UNVERIFIED');
    assert.equal(tabCreates(f).length,0);assert.equal(remoteWrites(f).length,0);untouched(f);
  }finally{f.close();}
});
