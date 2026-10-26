import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRecoveryFixture} from './helpers/native-product-recovery.mjs';
import {SINGLE_COMPANIES} from './helpers/supplier-hub-single-document.mjs';
import {createProductDocumentDraftReceiver} from '../extensions/supplier-hub/product-document-receiver.mjs';

const copy=value=>structuredClone(value);
const documentWrites=f=>f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').map(call=>({path:new URL(call.url).pathname,body:JSON.parse(call.init.body)}));
const created=f=>documentWrites(f).filter(call=>call.path.endsWith('/create'));
const updated=f=>documentWrites(f).filter(call=>call.path.endsWith('/update'));
const validations=f=>documentWrites(f).filter(call=>/\/validate-step\/[2-5]$/.test(call.path));
const marker=f=>f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords;

/** Build the production core's real update-requested checkpoint after its
 * synthetic create ACK. Interrupt before any upload/update, then model loss
 * of only the task's DOM marker; no fabricated checkpoint is introduced. */
async function pendingFixture(company=SINGLE_COMPANIES[0],options={}){
  const f=await nativeRecoveryFixture(company,options);let blocked=true;
  const adapter={...f.adapter,hubRequest:async input=>{
    if(blocked&&input.method==='POST'&&input.path==='/sr/draft/api/update')throw Error('Synthetic interrupted update before dispatch');
    return f.adapter.hubRequest(input);
  }};
  const receiver=createProductDocumentDraftReceiver({adapter,store:f.storage.store});
  try{
    const protectedBefore=copy(f.documents.get(f.prior.docId)),result=await receiver.prepareDraft(f.packet,f.sender);
    assert.equal(result.state,'update-requested',JSON.stringify(result));assert.equal(result.docId,f.createdDocId);
    assert.equal(created(f).length,1);assert.equal(updated(f).length,0);assert.equal(f.state.uploads.length,0);
    const checkpointBefore=await f.storage.store.get(f.context.key),records=JSON.parse(marker(f));
    assert.equal(records[f.context.packetDigest].docId,f.createdDocId);delete records[f.context.packetDigest];
    f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords=JSON.stringify(records);blocked=false;
    return{...f,adapter,receiver,protectedBefore,checkpointBefore};
  }catch(error){f.close();throw error;}
}
function unchanged(f){assert.deepEqual(f.documents.get(f.prior.docId),f.protectedBefore);assert.equal(created(f).length,1);assert.equal(f.submitted,0);}

for(const company of SINGLE_COMPANIES)test(`${company.code}: approved repair writes only the original document, then the explicit preparation action validates all steps`,async()=>{
  const f=await pendingFixture(company,{repairBodyFailure:true,browser:{sortObjectArguments:true,dropNullArguments:true}});
  try{
    const repaired=await f.receiver.repairExistingDraft(f.packet,f.sender);
    assert.equal(repaired.state,'updated',JSON.stringify(repaired));assert.equal(repaired.docId,f.createdDocId);
    assert.equal(repaired.draftProof.existingDocumentRepairAttempted,true);assert.deepEqual(repaired.draftProof.validatedSteps,[]);
    assert.equal(updated(f).length,1);assert.deepEqual(updated(f)[0].body,{...copy(f.context.packet.body),docId:f.createdDocId});
    assert.deepEqual(f.state.uploads,['MAIN','ADDITIONAL','LABEL','DETAIL']);assert.equal(validations(f).length,0);
    const checkpoint=await f.storage.store.get(f.context.key),audit=checkpoint.existingDocumentRepair;
    assert.equal(audit.format,'yoofam-existing-document-repair-v1');assert.equal(audit.attempt,1);assert.equal(audit.docId,f.createdDocId);
    assert.equal(audit.priorSequence,f.checkpointBefore.sequence);assert.equal(audit.priorOperationId,f.checkpointBefore.operationId);
    assert.match(audit.inspectionSha256,/^[a-f0-9]{64}$/);assert.ok(audit.startedAt>0);
    unchanged(f);
    const completed=await f.receiver.prepareDraft(f.packet,f.sender);
    assert.equal(completed.state,'validated',JSON.stringify(completed));assert.deepEqual(completed.draftProof.validatedSteps,[2,3,4,5]);
    assert.equal(completed.draftProof.existingDocumentRepairAttempted,true);assert.equal(updated(f).length,1);
    assert.deepEqual(validations(f).map(call=>Number(call.path.at(-1))),[2,3,4,5]);unchanged(f);
  }finally{f.close();}
});

test('a second repair reservation cannot repeat an update whose response was lost',async()=>{
  const f=await pendingFixture(undefined,{browser:{loseExecuteAck:'singleDocumentHubRequestPage',losePath:'/sr/draft/api/update'}});
  try{
    const first=await f.receiver.repairExistingDraft(f.packet,f.sender);assert.equal(first.state,'update-requested',JSON.stringify(first));
    const checkpoint=await f.storage.store.get(f.context.key);assert.equal(checkpoint.existingDocumentRepair.attempt,1);
    assert.equal(updated(f).length,1);assert.deepEqual(f.state.uploads,['MAIN','ADDITIONAL','LABEL','DETAIL']);
    const before={writes:copy(documentWrites(f)),uploads:copy(f.state.uploads),checkpoint:copy(checkpoint)};
    const second=await f.receiver.repairExistingDraft(f.packet,f.sender);assert.ok(second.error,JSON.stringify(second));
    assert.deepEqual(await f.storage.store.get(f.context.key),before.checkpoint);assert.deepEqual(documentWrites(f),before.writes);assert.deepEqual(f.state.uploads,before.uploads);
    const recovered=await f.receiver.recoverDraft(f.packet,f.sender);assert.equal(recovered.state,'updated',JSON.stringify(recovered));
    assert.deepEqual(documentWrites(f),before.writes);assert.deepEqual(f.state.uploads,before.uploads);assert.equal(validations(f).length,0);unchanged(f);
  }finally{f.close();}
});

test('a lost upload ACK remains pending even when its file appears in the server list',async()=>{
  const f=await pendingFixture(undefined,{loseUploadAck:true});
  try{
    const attempted=await f.receiver.repairExistingDraft(f.packet,f.sender);assert.equal(attempted.state,'update-requested',JSON.stringify(attempted));
    assert.deepEqual(f.state.uploads,['MAIN']);assert.equal(updated(f).length,0);
    const before=await f.storage.store.get(f.context.key);assert.equal(before.existingDocumentRepair.attempt,1);
    for(const action of ['repairExistingDraft','prepareDraft','recoverDraft']){
      const result=await f.receiver[action](f.packet,f.sender);assert.equal(result.state,'update-requested',JSON.stringify(result));
      assert.deepEqual(await f.storage.store.get(f.context.key),before);assert.deepEqual(f.state.uploads,['MAIN']);assert.equal(updated(f).length,0);unchanged(f);
    }
  }finally{f.close();}
});

test('an update ACK cannot complete repair while the fresh body read is still HTTP 500 or differs from the original',async()=>{
  for(const kind of ['http500','changed-body']){
    const browser={},f=await pendingFixture(undefined,{repairBodyFailure:true,browser});
    try{
      if(kind==='http500'){browser.documentStatus=500;browser.documentRead=()=>({errorCode:'INTERNAL_SERVER_ERROR'});}
      else browser.documentRead=value=>({...value,productName:'Changed synthetic readback'});
      const result=await f.receiver.repairExistingDraft(f.packet,f.sender);
      assert.equal(result.state,'update-requested',kind+': '+JSON.stringify(result));assert.ok(result.error,kind);
      assert.equal(updated(f).length,1);assert.deepEqual(f.state.uploads,['MAIN','ADDITIONAL','LABEL','DETAIL']);assert.equal(validations(f).length,0);
      const checkpoint=await f.storage.store.get(f.context.key);assert.equal(checkpoint.existingDocumentRepair.attempt,1);
      const beforeWrites=copy(documentWrites(f)),beforeUploads=copy(f.state.uploads);
      const recovery=await f.receiver.recoverDraft(f.packet,f.sender);assert.equal(recovery.state,'update-requested',JSON.stringify(recovery));
      assert.deepEqual(await f.storage.store.get(f.context.key),checkpoint);assert.deepEqual(documentWrites(f),beforeWrites);assert.deepEqual(f.state.uploads,beforeUploads);unchanged(f);
    }finally{f.close();}
  }
});

test('existing image/legal files or changed remote metadata/body prevent binding and repair dispatch',async()=>{
  for(const kind of ['image','legal','metadata','body']){
    const options=kind==='metadata'?{repairRowChanges:{productName:'Different synthetic product'}}:kind==='body'?{repairBodyChanges:{jsonDocument:[]}}:{};
    const f=await pendingFixture(undefined,options);
    try{
      if(kind==='image')f.state.registry.set('previous.png',{imageName:'previous.png',imageUrl:'/stored/previous.png',s3Link:'stored/previous.png'});
      if(kind==='legal')f.state.registry.set('previous.pdf',{fileName:'previous.pdf',fileType:'certificate',s3Link:'stored/previous.pdf'});
      const beforeMarker=marker(f),before=await f.storage.store.get(f.context.key),result=await f.receiver.repairExistingDraft(f.packet,f.sender);
      assert.equal(result.state,'update-requested',kind+': '+JSON.stringify(result));assert.ok(result.error,kind);
      assert.deepEqual(await f.storage.store.get(f.context.key),before);assert.equal(marker(f),beforeMarker);
      assert.equal(updated(f).length,0);assert.equal(f.state.uploads.length,0);unchanged(f);
    }finally{f.close();}
  }
});

test('altered inspection response cannot reserve the one repair or rewrite a page marker',async()=>{
  for(const field of ['docId','preparedBodySha256','sourcePlanSha256','priorUpdateOutcome','emptyImages','duplicateMatches']){
    const f=await pendingFixture();
    try{
      const execute=f.api.scripting.executeScript;f.api.scripting.executeScript=async request=>{
        const result=await execute(request);
        if(request.func.name==='singleExistingDocumentRepairPage'){
          const response=JSON.parse(result[0].result);
          response.proof[field]=field==='docId'?f.prior.docId:field==='emptyImages'?false:field==='duplicateMatches'?1:field==='priorUpdateOutcome'?'not-requested':'f'.repeat(64);
          result[0].result=JSON.stringify(response);
        }
        return result;
      };
      const before=await f.storage.store.get(f.context.key),beforeMarker=marker(f),result=await f.receiver.repairExistingDraft(f.packet,f.sender);
      assert.equal(result.state,'update-requested',field+': '+JSON.stringify(result));assert.ok(result.error,field);
      assert.deepEqual(await f.storage.store.get(f.context.key),before);assert.equal(marker(f),beforeMarker);assert.equal(updated(f).length,0);assert.equal(f.state.uploads.length,0);unchanged(f);
    }finally{f.close();}
  }
});

test('another same-name draft or a requested document blocks repair before reserving or writing',async()=>{
  for(const kind of ['same-name-draft','same-name-requested','same-id-requested','string-id-requested']){
    const f=await pendingFixture();
    try{
      const original=f.documents.get(f.createdDocId),other={...copy(original),docId:f.createdDocId+1};
      if(kind==='same-name-draft')f.documents.set(other.docId,other);
      else f.state.repairRequestedRows=[kind==='same-name-requested'?other:{docId:kind==='string-id-requested'?String(f.createdDocId):f.createdDocId,productName:'Different synthetic name'}];
      const before=await f.storage.store.get(f.context.key),beforeMarker=marker(f),result=await f.receiver.repairExistingDraft(f.packet,f.sender);
      assert.equal(result.state,'update-requested',kind+': '+JSON.stringify(result));assert.ok(result.error,kind);
      assert.deepEqual(await f.storage.store.get(f.context.key),before);assert.equal(marker(f),beforeMarker);assert.equal(updated(f).length,0);assert.equal(f.state.uploads.length,0);unchanged(f);
      if(kind==='same-name-draft')assert.deepEqual(f.documents.get(other.docId),other);
    }finally{f.close();}
  }
});

test('a newly requested duplicate between inspection and binding prevents every upload and update',async()=>{
  const f=await pendingFixture();
  try{
    const adapter={...f.adapter,inspectExistingDocument:async input=>{
      const proof=await f.adapter.inspectExistingDocument(input);
      f.state.repairRequestedRows=[{docId:f.createdDocId,productName:f.context.packet.body.productName}];return proof;
    }},receiver=createProductDocumentDraftReceiver({adapter,store:f.storage.store}),beforeMarker=marker(f);
    const result=await receiver.repairExistingDraft(f.packet,f.sender);assert.equal(result.state,'update-requested',JSON.stringify(result));assert.ok(result.error);
    const reserved=await f.storage.store.get(f.context.key);assert.equal(reserved.existingDocumentRepair.attempt,1);
    assert.equal(marker(f),beforeMarker);assert.equal(updated(f).length,0);assert.equal(f.state.uploads.length,0);unchanged(f);
  }finally{f.close();}
});

test('a failed durable repair reservation prevents bind, upload and update',async()=>{
  const f=await pendingFixture();
  try{
    let reservations=0;const store={...f.storage.store,compareAndSet:async(key,expected,next)=>{
      if(next.existingDocumentRepair!==undefined&&expected.existingDocumentRepair===undefined){reservations++;return false;}
      return f.storage.store.compareAndSet(key,expected,next);
    }};
    const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store}),before=await store.get(f.context.key),beforeMarker=marker(f);
    const result=await receiver.repairExistingDraft(f.packet,f.sender);assert.ok(result.error,JSON.stringify(result));assert.equal(reservations,1);
    assert.deepEqual(await store.get(f.context.key),before);assert.equal(marker(f),beforeMarker);assert.equal(updated(f).length,0);assert.equal(f.state.uploads.length,0);unchanged(f);
  }finally{f.close();}
});

test('a source change after inspection never dispatches the reserved repair',async()=>{
  const f=await pendingFixture();
  try{
    const adapter={...f.adapter,inspectExistingDocument:async input=>{
      const proof=await f.adapter.inspectExistingDocument(input);f.state.source={...f.state.source,inputFingerprint:'f'.repeat(64)};return proof;
    }},receiver=createProductDocumentDraftReceiver({adapter,store:f.storage.store}),beforeMarker=marker(f);
    const result=await receiver.repairExistingDraft(f.packet,f.sender);assert.ok(result.error,JSON.stringify(result));
    assert.equal(marker(f),beforeMarker);assert.equal(updated(f).length,0);assert.equal(f.state.uploads.length,0);unchanged(f);
  }finally{f.close();}
});
