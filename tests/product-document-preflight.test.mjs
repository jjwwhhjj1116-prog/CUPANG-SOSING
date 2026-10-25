import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {nativeRecoveryFixture} from './helpers/native-product-recovery.mjs';
import {SINGLE_COMPANIES,clone} from './helpers/supplier-hub-single-document.mjs';
import {withProductDocumentChrome} from './helpers/product-document-preview.mjs';
import {dispatchProductDocument,PRODUCT_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/product-document-dispatch.mjs';
import {productDocumentIdentity,createProductDocumentDraftReceiver} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {createVerifiedProductDocumentBrowserAdapter} from '../extensions/supplier-hub/product-document-adapter.mjs';
import {SingleDocumentError,readPreparedDocumentPreviewCheckpoint} from '../extensions/supplier-hub/single-document.mjs';
import {createProductDocumentPacket,PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT,PRODUCT_DOCUMENT_PREVIEW_ACK_TIMEOUT,PRODUCT_DOCUMENT_REQUEST_TTL} from '../extensions/supplier-hub/product-document.mjs';

const message=f=>({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'preview',packet:f.packet});
const snapshot=f=>JSON.stringify({documents:[...f.documents],storage:f.storage.changes,records:f.hubDocument.documentElement.dataset,source:f.state.source,tabs:f.tabs});
function sourceOnly(f,baseline){
  assert.equal(snapshot(f),baseline);
  assert.equal(f.submitted,0);assert.equal(f.checkboxClicks,0);assert.equal(f.nextClicks,0);assert.equal(f.state.uploads.length,0);assert.equal(f.state.recoveryRequests.length,0);
  assert.equal(f.storage.changes.length,0);assert.equal(f.documents.size,1);assert.deepEqual(f.documents.get(f.prior.docId),f.prior);
  assert.ok(f.calls.every(call=>call.name==='app-message'||call.name==='execute'&&call.target.tabId===f.sender.tab.id));
  assert.ok(f.state.appReads.every(url=>new URL(url).origin===new URL(f.sender.url).origin&&!new URL(url).searchParams.has('key')));
  for(const event of Object.values(f.webRequest))assert.equal(event.size,0);
}
async function preview(f){return withProductDocumentChrome(f.api,()=>dispatchProductDocument(message(f),f.sender));}

test('saved own submitted receipt survives a real app source nonce reload through readonly durable preview and observation without another write',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{browser:{registerRequestedRows:f=>[{docId:f.createdDocId,status:'SUBMITTED',qvtRequestId:'native-reload-raw',productName:f.documents.get(f.createdDocId).productName,categoryPath:f.documents.get(f.createdDocId).categoryPath}]}});
 try{const send=f.api.tabs.sendMessage;f.api.tabs.sendMessage=async(id,value,frame)=>value.type==='YOOFAM_CONFIRM_NATIVE_PRODUCT_DOCUMENT_ACTION'?{ok:true,userInitiated:true,challengeId:value.expected.challenge.id,identityDigest:f.context.identityDigest,checkedAt:Date.now()}:send(id,value,frame);
  const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store});await receiver.prepareDraft(f.packet,f.sender);const review=await receiver.reviewPreparedDraft(f.packet,f.sender),pending=await receiver.confirmPreparedDraft(f.packet,f.sender,f.action(review));assert.equal(pending.state,'pending',JSON.stringify(pending));
  f.state.receipts.push({format:'yoofam-product-document-receipt-v1',productId:f.context.identity.productId,company:clone(f.context.identity.company),registered:false,requestId:f.packet.requestId,docId:pending.docId,packetDigest:pending.packetDigest,identityDigest:pending.identityDigest,preparedBodySha256:pending.preparedBodySha256,receipt:clone(pending.receipt)});
  const original=f.storage.get(f.context.key),writes=f.calls.filter(row=>row.name==='hub-fetch'&&row.init.method==='POST').length,uploads=f.state.uploads.length,submits=f.submitted;
  await f.reloadSourceSession();t.mock.timers.tick(PRODUCT_DOCUMENT_REQUEST_TTL+1);const packet=await createProductDocumentPacket(f.packet.review,{requestId:f.packet.requestId,createdAt:Date.now(),now:Date.now()}),before=f.storage.changes.length,inputs=[];
  const deliver=f.api.tabs.sendMessage;f.api.tabs.sendMessage=async(id,value,frame)=>{inputs.push(clone(value));return deliver(id,value,frame);};
  const result=await withProductDocumentChrome(f.api,()=>dispatchProductDocument({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'preview',packet},f.sender),f.storage.store);
  assert.equal(result.requestId,f.packet.requestId);assert.equal(result.packetDigest,pending.packetDigest);assert.equal(f.storage.changes.length,before);assert.equal(inputs[0].type,'YOOFAM_READ_NATIVE_PRODUCT_DOCUMENT_SOURCE');assert.equal(inputs[0].expected.docId,null);assert.ok(inputs.slice(1).every(row=>row.expected.docId===pending.docId&&row.expected.receiptRecovery.sessionId===original.sessionId));
  const recovered=await receiver.recoverPreparedDraft(packet,f.sender);assert.equal(recovered.state,'pending',JSON.stringify(recovered));assert.equal(recovered.recovered,true);assert.equal(recovered.docId,pending.docId);assert.equal(recovered.receipt.qvtRequestId,pending.receipt.qvtRequestId);assert.equal(f.storage.get(f.context.key).sessionId,original.sessionId);
  assert.equal((await receiver.observePreparedDraft(packet,f.sender)).state,'pending');
  const input={tab:original.tab,identity:f.context.identity,sessionId:original.sessionId,docId:original.docId,requestId:original.requestId,packetDigest:original.packetDigest};
  for(const operation of [()=>f.adapter.createTarget(input),()=>f.adapter.hubRequest({...input,method:'POST',path:'/sr/draft/api/update',body:{...f.context.packet.body,docId:original.docId}}),()=>f.adapter.navigate(input),()=>f.adapter.qualifyPreparedDraft(input),()=>f.adapter.verifyHumanConfirmation(input),()=>f.adapter.confirmAgreements(input),()=>f.adapter.confirmStageAgreements(input),()=>f.adapter.submit(input)])await assert.rejects(operation,{code:'READ_ONLY_RECEIPT'});
  assert.equal(f.calls.filter(row=>row.name==='hub-fetch'&&row.init.method==='POST').length,writes);assert.equal(f.state.uploads.length,uploads);assert.equal(f.submitted,submits);assert.equal((await receiver.reviewPreparedDraft(packet,f.sender)).error.code,'SOURCE_CHANGED');assert.equal((await receiver.confirmPreparedDraft(packet,f.sender,{})).error.code,'SOURCE_CHANGED');
 }finally{f.close();t.mock.timers.reset();}
});

test('durable preview projection rejects poisoned, wrong original UUID, body, owner and full checkpoints; pre-submit nonce reload remains blocked',async()=>{
 const f=await nativeRecoveryFixture(SINGLE_COMPANIES[1]);try{const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store});await receiver.prepareDraft(f.packet,f.sender);const original=f.storage.get(f.context.key),before=f.storage.changes.length;
  assert.deepEqual(await readPreparedDocumentPreviewCheckpoint(f.context,f.storage.store),{docId:original.docId,sessionId:original.sessionId});assert.equal(await readPreparedDocumentPreviewCheckpoint(f.context,{get:async()=>undefined}),null);
  const invalid=[state=>{state.identity.ownerId='other';},state=>{state.bodySha256='f'.repeat(64);},state=>{state.laneKey='other';},state=>{state.requestId='other-request';},state=>{state.docId=state.baselineDocIds[0];},state=>{delete state.draftOnly;},state=>{state.preparedLifecycle=true;}];
  for(const mutate of invalid){const state=clone(original);mutate(state);await assert.rejects(readPreparedDocumentPreviewCheckpoint(f.context,{get:async()=>state}));}
  await assert.rejects(readPreparedDocumentPreviewCheckpoint({...f.context,packet:{...f.context.packet,requestId:'other-request'}},f.storage.store),{code:'CHECKPOINT_MODE'});assert.equal(f.storage.changes.length,before);
  await f.reloadSourceSession();await assert.rejects(withProductDocumentChrome(f.api,()=>dispatchProductDocument(message(f),f.sender),f.storage.store),{code:'SOURCE_CHANGED'});assert.equal((await receiver.reviewPreparedDraft(f.packet,f.sender)).error.code,'SOURCE_CHANGED');assert.equal(f.submitted,0);assert.equal(f.storage.changes.length,before);
 }finally{f.close();}
});

test('submitted readonly dispatch reattests with a fresh disposed adapter after the cached mutation watch expires, without renewing it or writing again',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{browser:{registerRequestedRows:f=>[{docId:f.createdDocId,status:'SUBMITTED',qvtRequestId:'native-expired-watch',productName:f.documents.get(f.createdDocId).productName,categoryPath:f.documents.get(f.createdDocId).categoryPath}]}}),selected=[];
 try{
  const send=f.api.tabs.sendMessage;f.api.tabs.sendMessage=async(id,value,frame)=>value.type==='YOOFAM_CONFIRM_NATIVE_PRODUCT_DOCUMENT_ACTION'?{ok:true,userInitiated:true,challengeId:value.expected.challenge.id,identityDigest:f.context.identityDigest,checkedAt:Date.now()}:send(id,value,frame);
  const source=fs.readFileSync(new URL('../extensions/supplier-hub/product-document-dispatch.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,''),run=vm.runInNewContext(source+'\ndispatchProductDocument',{
   productDocumentIdentity,resolveProductSourceContext:async context=>context,createProductDocumentDraftReceiver,SingleDocumentError,readPreparedDocumentPreviewCheckpoint,PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT,setTimeout,clearTimeout,Date,
   createProductDocumentReceiver:()=>assert.fail('General unqualified receiver must stay disabled'),createProductDocumentStore:()=>f.storage.store,
   createVerifiedProductDocumentBrowserAdapter:async context=>{const value=await createVerifiedProductDocumentBrowserAdapter(context,{api:f.api}),entry={...value,disposed:0};selected.push(entry);return{...value,adapter:{...value.adapter,dispose:()=>{entry.disposed++;value.adapter.dispose();}}};}
  }),request=(action,packet=f.packet,confirmation)=>run({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action,packet,...(confirmation===undefined?{}:{confirmation})},f.sender);
  assert.equal((await request('prepareDraft')).state,'validated');const review=await request('reviewPreparedDraft'),pending=await request('confirmPreparedDraft',f.packet,f.action(review));assert.equal(pending.state,'pending',JSON.stringify(pending));
  f.state.receipts.push({format:'yoofam-product-document-receipt-v1',productId:f.context.identity.productId,company:clone(f.context.identity.company),registered:false,requestId:f.packet.requestId,docId:pending.docId,packetDigest:pending.packetDigest,identityDigest:pending.identityDigest,preparedBodySha256:pending.preparedBodySha256,receipt:clone(pending.receipt)});
  const original=f.storage.get(f.context.key);t.mock.timers.tick(600001);await assert.rejects(selected[0].adapter.readTab({tab:original.tab,identity:f.context.identity}),{code:'TAB_CHANGED'});await new Promise(resolve=>setImmediate(resolve));
  const recordBefore=JSON.parse(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords)[f.context.packetDigest],writes=f.calls.filter(row=>row.name==='hub-fetch'&&row.init.method==='POST').length,uploads=f.state.uploads.length,submits=f.submitted,next=f.nextClicks,checkboxes=f.checkboxClicks;
  await f.reloadSourceSession();const packet=await createProductDocumentPacket(f.packet.review,{requestId:f.packet.requestId,createdAt:Date.now(),now:Date.now()});assert.equal((await request('preview',packet)).registered,false);
  for(const action of ['recoverPreparedDraft','observePreparedDraft','recoverPreparedDraft']){const before=selected.length,result=await request(action,packet);assert.equal(result.state,'pending',JSON.stringify(result));assert.equal(result.docId,pending.docId);assert.equal(result.receipt.qvtRequestId,pending.receipt.qvtRequestId);if(action==='recoverPreparedDraft')assert.equal(result.recovered,true);assert.equal(selected.length,before+1);assert.equal(selected.at(-1).disposed,1);}
  assert.equal(f.storage.get(f.context.key).sessionId,original.sessionId);assert.equal(f.calls.filter(row=>row.name==='hub-fetch'&&row.init.method==='POST').length,writes);assert.equal(f.state.uploads.length,uploads);assert.equal(f.submitted,submits);assert.equal(f.nextClicks,next);assert.equal(f.checkboxClicks,checkboxes);
  assert.deepEqual(JSON.parse(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords)[f.context.packetDigest],recordBefore,'read-only observation must not renew or change the expired mutation watch');
  const execute=f.api.scripting.executeScript;f.api.scripting.executeScript=async input=>{const out=await execute(input);if(input.target.tabId===original.tab.tabId)for(const row of out)row.documentId='changed-hub-frame';return out;};
  const blocked=await request('recoverPreparedDraft',packet);assert.equal(blocked.state,'scope-blocked',JSON.stringify(blocked));assert.equal(blocked.error.code,'TAB_CHANGED');assert.equal(selected.at(-1).disposed,1);assert.equal(f.submitted,submits);assert.equal(f.nextClicks,next);
 }finally{for(const entry of selected)entry.adapter.dispose();f.close();t.mock.timers.reset();}
});

for(const company of SINGLE_COMPANIES)test(`${company.code}: production preview independently rechecks the native source and returns no receipt or remote capability`,async()=>{
  const f=await nativeRecoveryFixture(company);try{
    f.calls.length=0;f.state.appReads.length=0;const before=snapshot(f),inputs=[];
    const send=f.api.tabs.sendMessage;f.api.tabs.sendMessage=async(id,value,frame)=>{inputs.push(clone(value));return send(id,value,frame);};
    const out=await preview(f);assert.equal(out.liveVerified,false);assert.equal(out.remoteWrites,false);assert.equal(out.registered,false);
    assert.equal(out.identityDigest,f.context.identityDigest);assert.deepEqual(out.identity,f.context.identity);assert.equal(out.requestId,f.packet.requestId);
    assert.equal(out.preparedBodySha256,f.context.bodySha256);assert.equal(out.originalBodySha256,f.context.originalBodySha256);
    assert.equal(out.draftPreparationAvailable,true);assert.equal(out.preparedLifecycleAvailable,true);assert.equal(out.createRetryAvailable,true);assert.deepEqual(Object.keys(out).sort(),['format','requestId','identity','fingerprint','productId','members','identityDigest','packetDigest','reviewDigest','preparedBodySha256','originalBodySha256','liveVerified','draftPreparationAvailable','preparedLifecycleAvailable','createRetryAvailable','createRetryContinuationAvailable','remoteWrites','registered'].sort());
    assert.deepEqual(inputs.map(value=>value.type),['YOOFAM_READ_NATIVE_PRODUCT_DOCUMENT_SOURCE','YOOFAM_VERIFY_NATIVE_PRODUCT_DOCUMENT_SOURCE','YOOFAM_READ_NATIVE_PRODUCT_DOCUMENT_SOURCE','YOOFAM_VERIFY_NATIVE_PRODUCT_DOCUMENT_SOURCE']);for(const value of inputs){assert.deepEqual(value.expected,{identity:f.context.identity,bodySha256:f.context.originalBodySha256,preparedBodySha256:f.context.bodySha256,packetDigest:f.context.packetDigest,requestId:f.context.packet.requestId,docId:null});}
    assert.ok(f.state.appReads.length>=10);sourceOnly(f,before);assert.equal(PRODUCT_DOCUMENT_LIVE_VERIFIED,false);
  }finally{f.close();}
});

test('native preview rejects changed actor, current source, app frame and active navigation without opening a Hub target',async()=>{
  for(const mode of ['owner','company','profile','member','body','source-clock','input-fingerprint','app-window','app-origin','pending-navigation','wrong-proof','bridge-unavailable']){
    const f=await nativeRecoveryFixture(SINGLE_COMPANIES[1]);try{
      if(mode==='owner')f.state.source.identity.ownerId='other-owner';
      if(mode==='company')f.state.company=clone(SINGLE_COMPANIES[0]);
      if(mode==='profile')f.state.source.identity.source.profileId='different-profile';
      if(mode==='member')f.state.source.identity.members[0].optionId='other-option';
      if(mode==='body')f.state.source.body.jsonDocument[0].startPage.productName='changed saved source';
      if(mode==='source-clock')f.state.source.identity.source.quotationRevision++;
      if(mode==='input-fingerprint')f.state.source.identity.inputFingerprint='f'.repeat(64);
      if(['app-window','app-origin','pending-navigation'].includes(mode)){
        const get=f.api.tabs.get;f.api.tabs.get=async id=>{const tab=await get(id);if(mode==='app-window')tab.windowId++;if(mode==='app-origin')tab.url='https://other.invalid/';if(mode==='pending-navigation')tab.pendingUrl=f.sender.url;return tab;};
      }
      if(['wrong-proof','bridge-unavailable'].includes(mode)){
        const send=f.api.tabs.sendMessage;f.api.tabs.sendMessage=async(...args)=>{if(mode==='bridge-unavailable')throw Error('synthetic source unavailable');const out=await send(...args);out.result.identity.appTabId++;return out;};
      }
      f.calls.length=0;f.state.appReads.length=0;const before=snapshot(f);
      await assert.rejects(preview(f),{code:mode==='bridge-unavailable'?'SOURCE_BRIDGE_UNAVAILABLE':'SOURCE_CHANGED'},mode);sourceOnly(f,before);
    }finally{f.close();}
  }
});

test('native preview rejects invalid source bridge facts, stale responses, changed sessions and either read failing',async()=>{
  const patches=[
    ['not-current',row=>({...row,current:false})],['not-ready',row=>({...row,submissionReady:false})],['prior-document',row=>({...row,priorDocumentClear:false})],
    ['other-owner',row=>({...row,identity:{...row.identity,ownerId:'different-owner'}})],['other-profile',row=>({...row,identity:{...row.identity,profileId:'different-profile'}})],
    ['other-body',row=>({...row,bodySha256:'f'.repeat(64)})],['empty-session',row=>({...row,sessionId:''})],['unsafe-session',row=>({...row,sessionId:'unsafe/session'})],
    ['long-session',row=>({...row,sessionId:'x'.repeat(101)})],['stale-proof',row=>({...row,checkedAt:Date.now()-61000})],
    ['second-session',row=>({...row,sessionId:'changed-session'}),2],['second-source',row=>({...row,identity:{...row.identity,inputFingerprint:'a'.repeat(64)}}),2],
    ['first-throw',()=>{throw Error('synthetic source read failed');}],['second-throw',()=>{throw Error('synthetic source read failed');},2],
  ];
  for(const [name,patch,ordinal=1]of patches){
    const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0]);try{
      const send=f.api.tabs.sendMessage;let reads=0;
      f.api.tabs.sendMessage=async(id,value,frame)=>{const result=await send(id,value,frame);if(value.type!=='YOOFAM_VERIFY_NATIVE_PRODUCT_DOCUMENT_SOURCE')return result;reads++;return reads===ordinal?patch(result):result;};
      f.calls.length=0;f.state.appReads.length=0;const before=snapshot(f);
      await assert.rejects(preview(f),{code:'SOURCE_CHANGED'},name);assert.equal(reads,ordinal);sourceOnly(f,before);
    }finally{f.close();}
  }
});

test('a company or saved body change after the first positive bridge proof is rejected by the independent current-source read',async()=>{
  for(const mode of ['company','body','revision']){
    const f=await nativeRecoveryFixture(SINGLE_COMPANIES[1]);try{
      const send=f.api.tabs.sendMessage;let reads=0;
      f.api.tabs.sendMessage=async(id,value,frame)=>{const result=await send(id,value,frame);if(value.type!=='YOOFAM_VERIFY_NATIVE_PRODUCT_DOCUMENT_SOURCE')return result;if(++reads===1){
        if(mode==='company')f.state.company=clone(SINGLE_COMPANIES[0]);
        if(mode==='body')f.state.source.body.jsonDocument[0].startPage.productName='later saved body';
        if(mode==='revision')f.state.source.identity.source.optionRevision++;
      }return result;};
      f.calls.length=0;f.state.appReads.length=0;const before=snapshot(f);
      await assert.rejects(preview(f),{code:'SOURCE_CHANGED'});assert.equal(reads,1);
      const expected=JSON.parse(before);if(mode==='body')expected.source.body.jsonDocument[0].startPage.productName='later saved body';if(mode==='revision')expected.source.identity.source.optionRevision++;
      sourceOnly(f,JSON.stringify(expected));
    }finally{f.close();}
  }
});

test('dispatcher validates the exact proof even if an adapter returns a positive but malformed result, and always disposes its preview adapter',async()=>{
  const f=await nativeRecoveryFixture();try{
    const context=await productDocumentIdentity(f.packet,f.sender),good={current:true,submissionReady:true,priorDocumentClear:true,identity:clone(context.identity),bodySha256:context.originalBodySha256,sessionId:'safe-preview-session'};
    const source=fs.readFileSync(new URL('../extensions/supplier-hub/product-document-dispatch.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
    const variants=[null,[],{...good,current:1},{...good,submissionReady:undefined},{...good,priorDocumentClear:false},{...good,identity:{...good.identity,members:[]}},{...good,bodySha256:'d'.repeat(64)},
      {...good,sessionId:7},{...good,sessionId:''},{...good,sessionId:'with space'},{...good,sessionId:'x'.repeat(101)},'throw','late-packet',good];
    for(const value of variants){
      let disposed=0,reads=0;const incoming=clone(message(f)),sandbox={productDocumentIdentity,resolveProductSourceContext:async context=>context,SingleDocumentError,PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT,setTimeout,clearTimeout,
        createProductDocumentReceiver:()=>assert.fail('Preview must not create a receiver'),createProductDocumentStore:()=>assert.fail('Preview must not create a store'),
        createVerifiedProductDocumentBrowserAdapter:async selected=>{assert.deepEqual(selected,context);return{adapter:{readSource:async input=>{reads++;assert.deepEqual(clone(input),{identity:context.identity,bodySha256:context.originalBodySha256,preparedBodySha256:context.bodySha256,packetDigest:context.packetDigest,requestId:context.packet.requestId,docId:null});if(value==='throw')throw Error('synthetic preflight failure');if(value==='late-packet'){incoming.packet.requestId='mutated-after-validation';incoming.packet.review.reviewDigest='f'.repeat(64);return good;}return value;},dispose:()=>{disposed++;}}};}};
      const run=vm.runInNewContext(source+'\ndispatchProductDocument',sandbox);
      if(value===good||value==='late-packet'){const out=await run(incoming,f.sender);assert.equal(out.registered,false);assert.equal(out.requestId,f.packet.requestId);assert.equal(out.reviewDigest,f.packet.review.reviewDigest);}else await assert.rejects(run(incoming,f.sender),value==='throw'?/synthetic preflight failure/:{code:'SOURCE_CHANGED'});
      assert.equal(reads,1);assert.equal(disposed,1);
    }
  }finally{f.close();}
});

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const drain=async()=>{for(let count=0;count<5;count++)await new Promise(resolve=>setImmediate(resolve));};
function deadlineDispatcher(context,select,resolveContext=async value=>value){
  const timers=new Map();let time=0,sequence=0;
  class DeadlineDate extends Date{static now(){return time;}}
  const source=fs.readFileSync(new URL('../extensions/supplier-hub/product-document-dispatch.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
  const run=vm.runInNewContext(source+'\ndispatchProductDocument',{SingleDocumentError,PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT,Date:DeadlineDate,
    productDocumentIdentity:async()=>context,resolveProductSourceContext:resolveContext,createVerifiedProductDocumentBrowserAdapter:select,
    createProductDocumentReceiver:()=>assert.fail('No preview receiver'),createProductDocumentStore:()=>assert.fail('No preview store'),
    setTimeout:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,at:time+delay});return id;},clearTimeout:id=>timers.delete(id)});
  return{run,timers,advance:(amount,runTimers=true)=>{time+=amount;if(runTimers)for(const[id,timer]of[...timers])if(timer.at<=time){timers.delete(id);timer.fn();}}};
}

test('closed-tab context lookup shares the preflight deadline and a late lookup cannot start an adapter',async()=>{
 const f=await nativeRecoveryFixture();try{
  const waiting=deferred();let selected=0;
  const clock=deadlineDispatcher(f.context,async()=>{selected++;throw Error('late adapter must not start');},()=>waiting.promise);
  const pending=clock.run(message(f),f.sender);await drain();assert.equal(clock.timers.size,1);
  clock.advance(PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT);await assert.rejects(pending,{code:'PRODUCT_SOURCE_PREFLIGHT_TIMEOUT'});
  waiting.resolve(f.context);await drain();assert.equal(selected,0);assert.equal(clock.timers.size,0);
 }finally{f.close();}
});

test('whole read-only preflight accepts delayed selection/source within its shared deadline and clears its timer',async()=>{
  assert.ok(PRODUCT_DOCUMENT_PREVIEW_ACK_TIMEOUT>PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT);assert.ok(PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT>30000);
  const f=await nativeRecoveryFixture();try{
    for(const phase of ['selection','source']){
      const waiting=deferred();let reads=0,disposed=0;
      const proof={current:true,submissionReady:true,priorDocumentClear:true,identity:clone(f.context.identity),bodySha256:f.context.originalBodySha256,sessionId:'safe-preflight-session'};
      const selected={adapter:{readSource:async()=>{reads++;return phase==='source'?waiting.promise:proof;},dispose:()=>{disposed++;}}};
      const clock=deadlineDispatcher(f.context,async()=>phase==='selection'?waiting.promise:selected),pending=clock.run(message(f),f.sender);
      await drain();assert.equal(clock.timers.size,1);clock.advance(phase==='selection'?25000:PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT-1);waiting.resolve(phase==='selection'?selected:proof);
      const result=await pending;assert.equal(result.registered,false);assert.equal(result.liveVerified,false);assert.equal(reads,1);assert.equal(disposed,1);assert.equal(clock.timers.size,0);
    }
  }finally{f.close();}
});

test('whole preflight timeout rejects promptly; late selection never starts a source read and late source proof/error never succeeds',async()=>{
  const f=await nativeRecoveryFixture();try{
    for(const phase of ['selection','source-proof','source-error']){
      const waiting=deferred();let reads=0,disposed=0,succeeded=0;
      const proof={current:true,submissionReady:true,priorDocumentClear:true,identity:clone(f.context.identity),bodySha256:f.context.originalBodySha256,sessionId:'safe-preflight-session'};
      const selected={adapter:{readSource:async()=>{reads++;return waiting.promise;},dispose:()=>{disposed++;}}};
      const clock=deadlineDispatcher(f.context,async()=>phase==='selection'?waiting.promise:selected),pending=clock.run(message(f),f.sender);pending.then(()=>{succeeded++;},()=>{});
      await drain();assert.equal(clock.timers.size,1);clock.advance(PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT);
      await assert.rejects(pending,{code:'PRODUCT_SOURCE_PREFLIGHT_TIMEOUT'});assert.equal(disposed,phase==='selection'?0:1);assert.equal(clock.timers.size,0);
      if(phase==='source-error')waiting.reject(Error('late read-only failure'));else waiting.resolve(phase==='selection'?selected:proof);
      await drain();assert.equal(disposed,1);assert.equal(reads,phase==='selection'?0:1);assert.equal(succeeded,0);assert.equal(clock.timers.size,0);
    }
  }finally{f.close();}
});

test('an overdue adapter result cannot beat an already due but stalled deadline timer',async()=>{
  const f=await nativeRecoveryFixture();try{
    for(const phase of ['selection','source']){
      const waiting=deferred();let reads=0,disposed=0;
      const proof={current:true,submissionReady:true,priorDocumentClear:true,identity:clone(f.context.identity),bodySha256:f.context.originalBodySha256,sessionId:'safe-preflight-session'};
      const selected={adapter:{readSource:async()=>{reads++;return phase==='source'?waiting.promise:proof;},dispose:()=>{disposed++;}}};
      const clock=deadlineDispatcher(f.context,async()=>phase==='selection'?waiting.promise:selected),pending=clock.run(message(f),f.sender);
      await drain();clock.advance(PRODUCT_DOCUMENT_PREFLIGHT_TIMEOUT+1,false);waiting.resolve(phase==='selection'?selected:proof);
      await assert.rejects(pending,{code:'PRODUCT_SOURCE_PREFLIGHT_TIMEOUT'});assert.equal(reads,phase==='selection'?0:1);assert.equal(disposed,1);assert.equal(clock.timers.size,0);
    }
  }finally{f.close();}
});
