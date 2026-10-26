import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRecoveryFixture} from './helpers/native-product-recovery.mjs';
import {createVerifiedProductDocumentBrowserAdapter} from '../extensions/supplier-hub/product-document-adapter.mjs';

const record=f=>JSON.parse(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords)[f.context.packetDigest];
const writes=f=>f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').map(call=>new URL(call.url).pathname);
const proof=f=>({identity:f.context.identity,bodySha256:f.context.originalBodySha256,preparedBodySha256:f.context.bodySha256,packetDigest:f.context.packetDigest,requestId:f.packet.requestId,docId:f.createdDocId});

test('a fresh adapter after same-tab reload recovers the real observed create record without creating, uploading or updating',async()=>{
 const f=await nativeRecoveryFixture();let fresh;try{
  const common=await f.start(),before=writes(f),saved=structuredClone(record(f));await f.recordMirror.flush();
  await f.api.tabs.update(common.tab.tabId,{url:'https://supplier.coupang.com/dashboard/KR'});
  assert.equal(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords,undefined);
  fresh=(await createVerifiedProductDocumentBrowserAdapter(f.context,{api:f.api})).adapter;await fresh.readSource(proof(f));
  const value=await fresh.readDocument({...common,docId:f.createdDocId,expectedBody:{...f.context.packet.body,docId:f.createdDocId}});
  assert.equal(value.body.docId,f.createdDocId);assert.deepEqual(record(f),saved);assert.deepEqual(writes(f),before);assert.deepEqual(f.state.uploads,[]);
 }finally{fresh?.dispose();f.close();}
});

test('a storage failure blocks every new file/body write before native dispatch',async()=>{
 const f=await nativeRecoveryFixture();try{const common=await f.start(),before=writes(f);f.recordMirror.control.failWrite=true;
  await assert.rejects(f.update(common));assert.deepEqual(writes(f),before);assert.deepEqual(f.state.uploads,[]);assert.equal(record(f).state,'created');
 }finally{f.close();}
});

test('local mirror failure after the actual update ACK cannot mask it or replay the update',async()=>{
 let f;f=await nativeRecoveryFixture(undefined,{browser:{beforeHubFetch:url=>{if(url.endsWith('/update'))f.recordMirror.control.failWrite=true;}}});
 try{const common=await f.start(),value=await f.update(common);assert.equal(value.ok,true);assert.equal(value.status,200);assert.equal(record(f).state,'updated');
  const read=await f.adapter.readDocument({...common,docId:f.createdDocId,expectedBody:{...f.context.packet.body,docId:f.createdDocId}});assert.equal(read.body.docId,f.createdDocId);
  const before=writes(f);await assert.rejects(f.adapter.hubRequest({...common,method:'POST',path:'/sr/draft/api/validate-step/2',operationId:f.packet.requestId+':validate:2',body:{...f.context.packet.body,docId:f.createdDocId}}));
  assert.deepEqual(writes(f),before);assert.equal(writes(f).filter(path=>path.endsWith('/update')).length,1);
 }finally{f.close();}
});

test('an uncertain upload marker survives a reload without becoming an upload ACK or triggering a second upload',async()=>{
 const f=await nativeRecoveryFixture(undefined,{loseUploadAck:true});try{
  const common=await f.start();await assert.rejects(f.update(common));const saved=structuredClone(record(f));assert.equal(saved.nativeAssets.groups['image:MAIN'].state,'requested');await f.recordMirror.flush();
  await f.api.tabs.update(common.tab.tabId,{url:'https://supplier.coupang.com/dashboard/KR'});const before=[...f.state.uploads],beforeWrites=writes(f);
  await assert.rejects(f.adapter.recoverWrite({...common,docId:f.createdDocId,operationId:f.packet.requestId+':update',operation:'update',expectedBody:{...f.context.packet.body,docId:f.createdDocId}}));
  assert.deepEqual(record(f),saved);assert.deepEqual(f.state.uploads,before);assert.deepEqual(writes(f),beforeWrites);
 }finally{f.close();}
});
