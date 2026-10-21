import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRecoveryFixture} from './helpers/native-product-recovery.mjs';
import {SINGLE_COMPANIES} from './helpers/supplier-hub-single-document.mjs';
import {createProductDocumentReceiver} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {PRODUCT_DOCUMENT_LIVE_VERIFIED,dispatchProductDocument} from '../extensions/supplier-hub/product-document-dispatch.mjs';
import {withProductDocumentChrome} from './helpers/product-document-preview.mjs';
const copy=value=>JSON.parse(JSON.stringify(value));
const observationInput=(f,common)=>({...common,identityDigest:f.context.identityDigest,operation:'update',operationId:f.packet.requestId+':update',docId:f.createdDocId,
 baselineDocIds:[f.prior.docId],expectedBody:{...copy(f.context.packet.body),docId:f.createdDocId}});
const records=f=>f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords;
const mutations=f=>f.calls.filter(call=>call.name==='hub-fetch'&&call.method==='POST'&&/\/(?:create|update|validate-step\/\d+)$/.test(new URL(call.url).pathname));

for(const company of SINGLE_COMPANIES)test(`${company.code}: lost upload ACK recovery lists the exact new document without rewriting the ledger, files or document`,async()=>{
 const f=await nativeRecoveryFixture(company,{loseUploadAck:true});try{
  const beforeProtected=JSON.stringify(f.documents.get(f.prior.docId)),common=await f.start();await assert.rejects(f.update(common));
  const ledgerBefore=records(f),documentBefore=JSON.stringify(f.documents.get(f.createdDocId)),writes=mutations(f).length,uploads=f.state.uploads.length;
  f.state.recoveryRequests.length=0;const result=await f.adapter.inspectNativeAssets(observationInput(f,common));
  assert.equal(result.readOnly,true);assert.equal(result.ledgerMutated,false);assert.equal(result.unresolved,true);assert.equal(result.canContinue,false);assert.equal(result.remoteBytesVerified,false);assert.equal(result.actualUploadVerified,false);assert.equal(result.registered,false);
  assert.deepEqual(f.state.recoveryRequests.map(row=>row.method),['GET']);assert.equal(result.groups[0].state,'listed-unconfirmed');assert.equal(result.groups[0].listedFiles.length,1);
  assert.equal(result.groups[0].expectedFiles[0].byteLength,f.state.source.images[0].byteLength);assert.equal(result.groups[0].expectedFiles[0].contentType,'image/png');assert.equal(result.groups[0].remoteByteLengthVerified,false);assert.equal(result.groups[0].remoteContentTypeVerified,false);
  assert.equal(records(f),ledgerBefore);assert.equal(JSON.stringify(f.documents.get(f.createdDocId)),documentBefore);assert.equal(JSON.stringify(f.documents.get(f.prior.docId)),beforeProtected);assert.equal(f.state.uploads.length,uploads);assert.equal(mutations(f).length,writes);
  let recovered;await assert.rejects(f.adapter.recoverWrite(observationInput(f,common)),error=>{recovered=error.observation;return error.code==='NATIVE_ASSET_RECOVERY_READ_ONLY';});
  assert.equal(recovered.groups[0].state,'listed-unconfirmed');assert.equal(records(f),ledgerBefore);assert.equal(f.state.uploads.length,uploads);assert.equal(mutations(f).length,writes);assert.equal(f.submitted,0);
 }finally{f.close();}
});
test('native receiver recover reports read-only file facts and retains the original update-requested checkpoint',async()=>{
 const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{loseUploadAck:true});let checkpoint;const store={get:async()=>checkpoint,claim:async(_key,value)=>{if(checkpoint)return false;checkpoint=copy(value);return true;},compareAndSet:async(_key,expected,next)=>{if(JSON.stringify(checkpoint)!==JSON.stringify(expected))return false;checkpoint=copy(next);return true;}};
 try{const receiver=createProductDocumentReceiver({adapter:f.adapter,store}),started=await receiver.start(f.packet,f.sender);assert.equal(started.state,'update-requested');assert.equal(started.needsRecovery,true);
  const ledgerBefore=records(f),checkpointBefore=JSON.stringify(checkpoint),uploads=f.state.uploads.length,writes=mutations(f).length;const result=await receiver.recover(f.packet,f.sender);
  assert.equal(result.state,'update-requested');assert.equal(result.needsRecovery,true);assert.equal(result.error.code,'NATIVE_ASSET_RECOVERY_READ_ONLY');assert.match(result.error.message,/1\/4/);
  assert.equal(JSON.stringify(checkpoint),checkpointBefore);assert.equal(records(f),ledgerBefore);assert.equal(f.state.uploads.length,uploads);assert.equal(mutations(f).length,writes);assert.equal(f.submitted,0);
 }finally{f.close();}
});
test('already observed groups are compared with fresh list metadata while a later requested group stays unresolved',async()=>{
 const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{loseUploadAck:true,loseUploadAckGroup:'ADDITIONAL'});try{const common=await f.start();await assert.rejects(f.update(common));assert.deepEqual(f.state.uploads,['MAIN','ADDITIONAL']);const ledger=records(f),result=await f.adapter.inspectNativeAssets(observationInput(f,common));
  assert.equal(result.groups[0].state,'metadata-current');assert.equal(result.groups[1].state,'listed-unconfirmed');assert.equal(result.canContinue,false);assert.equal(records(f),ledger);assert.equal(f.state.uploads.length,2);assert.equal(f.submitted,0);
 }finally{f.close();}
});
test('legal queries use only the observed read-only files-by-type operation and cannot become an upload acknowledgement',async()=>{
 const f=await nativeRecoveryFixture(SINGLE_COMPANIES[1],{pdf:true,loseUploadAck:true,loseUploadAckGroup:'certificate'});try{const common=await f.start();await assert.rejects(f.update(common));const ledger=records(f),uploads=f.state.uploads.length;f.state.recoveryRequests.length=0;
  const result=await f.adapter.inspectNativeAssets(observationInput(f,common)),legal=result.groups.find(group=>group.groupKey==='legal:certificate');assert.equal(legal.state,'listed-unconfirmed');assert.equal(legal.expectedFiles[0].contentType,'application/pdf');assert.equal(legal.remoteContentTypeVerified,false);
  assert.deepEqual(f.state.recoveryRequests.map(row=>[new URL(row.url).pathname,row.method]),[['/sr/draft/api/get-images-by-id/'+f.createdDocId,'GET'],['/sr/draft/api/get-files-by-type/'+f.createdDocId,'POST']]);assert.equal(records(f),ledger);assert.equal(f.state.uploads.length,uploads);assert.equal(f.submitted,0);
 }finally{f.close();}
});
test('missing or full filename lists are diagnostic facts rather than remote byte/type/size evidence',async()=>{
 for(const missing of [false,true]){const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{loseUploadAck:true});try{const common=await f.start();await assert.rejects(f.update(common));if(missing)f.state.registry.clear();const before=records(f),result=await f.adapter.inspectNativeAssets(observationInput(f,common));assert.equal(result.groups[0].state,missing?'not-observed':'listed-unconfirmed');assert.equal(result.remoteBytesVerified,false);assert.equal(result.actualUploadVerified,false);assert.equal(result.canContinue,false);assert.equal(records(f),before);}finally{f.close();}}
});
test('changed actor/source/body/frame/document/ledger and unfamiliar list entries fail closed without writes',async()=>{
 for(const kind of ['actor','source','body','tab','frame','doc','old-doc','ledger','unknown-file','observed-list','local-size','local-type','group-promotion']){const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0],{loseUploadAck:true,loseUploadAckGroup:kind==='observed-list'?'ADDITIONAL':undefined});try{const common=await f.start();await assert.rejects(f.update(common));const input=observationInput(f,common),writes=mutations(f).length,uploads=f.state.uploads.length;
  if(kind==='actor')f.state.company=copy(SINGLE_COMPANIES[1]);if(kind==='source')f.state.source={...f.state.source,inputFingerprint:'f'.repeat(64)};
  if(kind==='body')input.expectedBody.productName='changed';if(kind==='tab')input.tab.windowId++;
  if(kind==='frame'){const execute=f.api.scripting.executeScript;f.api.scripting.executeScript=async request=>{const result=await execute(request);if(request.func.name==='nativeAssetRecoveryPage')result[0].documentId='new-frame';return result;};}
  if(['doc','old-doc','ledger'].includes(kind)){const all=JSON.parse(records(f)),record=all[f.context.packetDigest];if(kind==='doc')record.docId='different-doc';if(kind==='old-doc')record.baselineDocIds.push(record.docId);if(kind==='ledger')record.nativeAssets.planSha256='f'.repeat(64);f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords=JSON.stringify(all);}
  if(kind==='unknown-file')f.state.registry.set('unexpected.png',{imageName:'unexpected.png',imageUrl:'/stored/unexpected.png',s3Link:'stored/unexpected.png'});
  if(kind==='observed-list'){const key=f.state.source.images[0].transportName;f.state.registry.set(key,{...f.state.registry.get(key),s3Link:'different-storage'});}
  if(['local-size','local-type','group-promotion'].includes(kind)){const execute=f.api.scripting.executeScript;f.api.scripting.executeScript=async request=>{const result=await execute(request);if(request.func.name==='nativeAssetRecoveryPage'){const group=result[0].result.groups[0];if(kind==='local-size')group.expectedFiles[0].byteLength++;if(kind==='local-type')group.expectedFiles[0].contentType='image/jpeg';if(kind==='group-promotion')group.remoteBytesVerified=true;}return result;};}
  const before=records(f);await assert.rejects(f.adapter.inspectNativeAssets(input));assert.equal(records(f),before);assert.equal(mutations(f).length,writes);assert.equal(f.state.uploads.length,uploads);assert.equal(f.submitted,0);
 }finally{f.close();}}
});
test('dispatch live gate remains false and no new start is enabled by the read-only recovery helper',async()=>{
 const f=await nativeRecoveryFixture(SINGLE_COMPANIES[0]);try{assert.equal(PRODUCT_DOCUMENT_LIVE_VERIFIED,false);const preview=await withProductDocumentChrome(f.api,()=>dispatchProductDocument({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'preview',packet:f.packet},f.sender));assert.equal(preview.liveVerified,false);await assert.rejects(dispatchProductDocument({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'start',packet:f.packet},f.sender),error=>error.code==='PRODUCT_LIVE_CONTRACT_UNVERIFIED');assert.equal(f.state.uploads.length,0);assert.equal(f.submitted,0);}finally{f.close();}
});
