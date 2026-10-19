import test from 'node:test';
import assert from 'node:assert/strict';
import {singleDocumentFixture,SINGLE_COMPANIES} from './helpers/supplier-hub-single-document.mjs';
import {normalizeRejectionDetails} from '../extensions/supplier-hub/rejection-details.mjs';
const native=(state='pending',sourceStatus='SUBMITTED',id='native-file-id')=>({state,sourceStatus,receiptId:id,qvtRequestId:id,evidence:'document-receipt',registered:false,skuId:undefined});
for(const company of SINGLE_COMPANIES){
  test(company.name+' durable native receipt progresses without a new submission or a guessed SKU',async()=>{
    const options={receipt:native()},f=await singleDocumentFixture(company,options);
    try{
      const ready=await f.receiver.start(f.packet,f.sender),pending=await f.receiver.confirm(f.packet,f.sender,f.action(ready));
      assert.equal(pending.state,'pending');assert.equal(pending.registered,false);assert.equal(pending.receipt.sourceStatus,'SUBMITTED');assert.equal(f.submitted,1);
      const saved=f.storage.get(f.context.key);assert.equal(saved.submitRequestedAt,f.now);const observation=f.calls.find(call=>call.name==='observeReceipt').input;
      assert.equal(observation.submitRequestedAt,saved.submitRequestedAt);assert.equal(observation.expectedBody.docId,ready.docId);assert.deepEqual(observation.expectedBody,f.documents.get(ready.docId));
      f.now++;options.receipt=native('accepted','FINISHED');const accepted=await f.receiver.observe(f.packet,f.sender);
      assert.equal(accepted.state,'accepted');assert.equal(accepted.registered,false);assert.equal(accepted.success,false);assert.equal(accepted.receipt.qvtRequestId,'native-file-id');assert.equal(Object.hasOwn(accepted.receipt,'skuId'),false);assert.equal(f.submitted,1);
      const previous=f.storage.get(f.context.key);f.now++;options.receipt=native('pending','SUBMITTED');const reversed=await f.receiver.observe(f.packet,f.sender);
      assert.equal(reversed.error.code,'RECEIPT_CHANGED');assert.equal(reversed.state,'accepted');assert.deepEqual(f.storage.get(f.context.key),previous);assert.equal(f.submitted,1);f.assertPreserved();
    }finally{f.close();}
  });
}
test('native source status, aliases and registered flag cannot smuggle a false receipt or catalog completion',async()=>{
  for(const patch of [{sourceStatus:'UNKNOWN'},{sourceStatus:'FINISHED'},{qvtRequestId:123},{qvtRequestId:undefined},{registered:true},{skuId:'made-up'},{evidence:'document-and-sku'},{observedAt:1}]){
    const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{receipt:{...native(),...patch}});
    try{const ready=await f.receiver.start(f.packet,f.sender),result=await f.receiver.confirm(f.packet,f.sender,f.action(ready));assert.equal(result.state,'submit-requested');assert.equal(result.error.code,'RECEIPT_UNCONFIRMED');assert.equal(result.registered,false);assert.equal(f.storage.get(f.context.key).receipt,null);assert.equal(f.submitted,1);f.assertPreserved();}finally{f.close();}
  }
});
test('native rejected file outcome remains distinct from accepted receipt and independent catalog SKU evidence',async()=>{
  const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{receipt:native('rejected','REJECTED',1205)});
  try{const ready=await f.receiver.start(f.packet,f.sender),result=await f.receiver.confirm(f.packet,f.sender,f.action(ready));assert.equal(result.state,'rejected');assert.equal(result.receipt.receiptId,1205);assert.equal(result.receipt.qvtRequestId,1205);assert.equal(result.registered,false);assert.equal(result.success,false);assert.equal(f.submitted,1);f.assertPreserved();}finally{f.close();}
});
test('saved native receipt alias tampering and submit timestamp tampering cannot be restored from a checkpoint',async()=>{
  for(const patch of [state=>{state.receipt.qvtRequestId='changed';},state=>{state.submitRequestedAt=state.humanConfirmedAt-1;},state=>{state.submitRequestedAt=state.updatedAt+1;},state=>{state.receipt.registered=true;}]){
    const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{receipt:native()});
    try{const ready=await f.receiver.start(f.packet,f.sender);await f.receiver.confirm(f.packet,f.sender,f.action(ready));const state=f.storage.get(f.context.key);patch(state);f.storage.force(f.context.key,state);await assert.rejects(f.receiver.observe(f.packet,f.sender),error=>error.code==='CHECKPOINT');assert.equal(f.submitted,1);f.assertPreserved();}finally{f.close();}
  }
});

test('native rejected diagnostics survive the receiver checkpoint while forged success diagnostics are refused',async()=>{
  const diagnostics=normalizeRejectionDetails(JSON.stringify({errors:[{columnName:'포장 무게',message:'양수를 입력해주세요.'}]}));
  const f=await singleDocumentFixture(SINGLE_COMPANIES[0],{receipt:{...native('rejected','REJECTED',1205),rejectionDetails:diagnostics}});
  try{
    const ready=await f.receiver.start(f.packet,f.sender),result=await f.receiver.confirm(f.packet,f.sender,f.action(ready));
    assert.equal(result.state,'rejected');assert.deepEqual(result.receipt.rejectionDetails,diagnostics);assert.equal(result.registered,false);
    const stored=f.storage.get(f.context.key);assert.deepEqual(stored.receipt.rejectionDetails,diagnostics);
    const tampered=structuredClone(stored);tampered.receipt.rejectionDetails.errors[0].extra=true;f.storage.force(f.context.key,tampered);
    await assert.rejects(f.receiver.observe(f.packet,f.sender),error=>error.code==='CHECKPOINT');assert.equal(f.submitted,1);f.assertPreserved();
  }finally{f.close();}
  const accepted=await singleDocumentFixture(SINGLE_COMPANIES[0],{receipt:{...native('accepted','FINISHED',1206),rejectionDetails:diagnostics}});
  try{const ready=await accepted.receiver.start(accepted.packet,accepted.sender),result=await accepted.receiver.confirm(accepted.packet,accepted.sender,accepted.action(ready));assert.equal(result.state,'submit-requested');assert.equal(result.error.code,'RECEIPT_UNCONFIRMED');assert.equal(result.registered,false);}finally{accepted.close();}
});
