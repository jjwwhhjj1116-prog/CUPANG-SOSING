import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRecoveryFixture} from './helpers/native-product-recovery.mjs';
import {createProductDocumentDraftReceiver} from '../extensions/supplier-hub/product-document-receiver.mjs';

test('native preparation preserves owned identity across reordered Chrome object arguments',async()=>{
 const f=await nativeRecoveryFixture(undefined,{browser:{sortObjectArguments:true,dropNullArguments:true}});
 try{const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store});const result=await receiver.prepareDraft(f.packet,f.sender);
  assert.equal(result.state,'validated',JSON.stringify(result));assert.equal(result.draftProof.validatedSteps.length,4);assert.equal(f.state.uploads.length,4);assert.equal(f.submitted,0);
 }finally{f.close();}
});

async function interrupted(){
 const f=await nativeRecoveryFixture(undefined,{browser:{sortObjectArguments:true,dropNullArguments:true,draftList:rows=>rows.map(row=>({...row,status:'UNFINISHED',jsonDocument:null}))}});
 const failed={...f.adapter,hubRequest:input=>input.path.endsWith('/update')?Promise.reject(Error('Synthetic failure before native upload')):f.adapter.hubRequest(input)};
 const receiver=createProductDocumentDraftReceiver({adapter:failed,store:f.storage.store});
 const result=await receiver.prepareDraft(f.packet,f.sender);assert.equal(result.state,'update-requested');assert.equal(f.state.uploads.length,0);
 return f;
}

test('positive proof of no upload or update restores only the same created document for explicit continuation',async()=>{
 const f=await interrupted();try{const before=structuredClone(f.documents.get(f.prior.docId));const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store});
  const read=await receiver.recoverDraft(f.packet,f.sender);assert.equal(read.state,'created',JSON.stringify(read));assert.equal(read.docId,f.createdDocId);assert.equal(read.recovered,true);assert.equal(f.state.uploads.length,0);
  const done=await receiver.prepareDraft(f.packet,f.sender);assert.equal(done.state,'validated',JSON.stringify(done));assert.equal(done.docId,read.docId);assert.equal(f.state.uploads.length,4);
  assert.equal(f.calls.filter(row=>row.name==='hub-fetch'&&row.init.method==='POST'&&row.url.endsWith('/create')).length,1);
  assert.deepEqual(f.documents.get(f.prior.docId),before);assert.equal(f.submitted,0);
 }finally{f.close();}
});

test('an upload/update marker or changed remote body cannot be treated as an unsent update',async()=>{
 for(const mode of ['upload','update','loaded','watch','body']){const f=await interrupted();try{
  const all=JSON.parse(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords),record=all[f.context.packetDigest];
  if(mode==='upload')record.nativeAssets={groups:{'image:MAIN':{state:'requested'}}};
  if(mode==='update')record.updateOperationId=f.packet.requestId+':update';
  if(mode==='loaded')record.loadedDocId=record.docId;
  if(mode==='watch')record.watchToken='observed-watch';
  if(mode==='body')f.documents.get(f.createdDocId).productName='Changed remote document';
  f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords=JSON.stringify(all);
  const state=await f.storage.store.get(f.context.key),input={tab:state.tab,sessionId:state.sessionId,identity:f.context.identity,requestId:f.packet.requestId,operationId:f.packet.requestId+':update',docId:f.createdDocId,baselineDocIds:state.baselineDocIds,expectedBody:{...f.context.packet.body,docId:f.createdDocId}};
  if(mode==='loaded')await assert.rejects(f.adapter.inspectUnsentUpdate(input),error=>error.code==='TAB_CHANGED');
  else assert.equal(await f.adapter.inspectUnsentUpdate(input),null,mode);
  assert.equal(f.state.uploads.length,0);assert.equal(f.submitted,0);
 }finally{f.close();}}
});

test('an altered unsent-update proof cannot rewind the pending checkpoint or permit another create',async()=>{
 for(const key of ['docId','packetDigest','uploadsNotRequested']){const f=await interrupted();try{
  const before=await f.storage.store.get(f.context.key),adapter={...f.adapter,inspectUnsentUpdate:async input=>{const proof=await f.adapter.inspectUnsentUpdate(input);assert.ok(proof);return{...proof,[key]:key==='docId'?proof.docId+1:key==='packetDigest'?'f'.repeat(64):false};}};
  const result=await createProductDocumentDraftReceiver({adapter,store:f.storage.store}).recoverDraft(f.packet,f.sender);
  assert.equal(result.state,'update-requested');assert.equal(result.error.code,'UNSENT_UPDATE_UNCONFIRMED');assert.deepEqual(await f.storage.store.get(f.context.key),before);assert.equal(f.state.uploads.length,0);
 }finally{f.close();}}
});

test('a real binding mismatch names only the differing field and cannot upload or recreate',async()=>{
 const f=await interrupted();try{const all=JSON.parse(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords);all[f.context.packetDigest].binding.sessionId='changed-session';f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords=JSON.stringify(all);
  const result=await createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store}).recoverDraft(f.packet,f.sender);
  assert.equal(result.state,'update-requested');assert.equal(result.error.code,'OWNED_RECORD_BINDING_CHANGED');assert.match(result.error.message,/sessionId/);assert.doesNotMatch(result.error.message,/changed-session/);assert.equal(f.state.uploads.length,0);
 }finally{f.close();}
});

test('an injection error is reported as execution failure instead of a missing document',async()=>{
 const f=await nativeRecoveryFixture();try{const execute=f.api.scripting.executeScript;f.api.scripting.executeScript=async request=>request.func.name==='singleDocumentOwnedRecordPage'?[{frameId:0,documentId:f.hubDocumentId,error:{name:'ReferenceError'}}]:execute(request);
  const result=await createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store}).prepareDraft(f.packet,f.sender);
  assert.equal(result.state,'update-requested');assert.equal(result.error.code,'PAGE_EXECUTION_FAILED');assert.equal(f.state.uploads.length,0);assert.equal(f.submitted,0);
 }finally{f.close();}
});
