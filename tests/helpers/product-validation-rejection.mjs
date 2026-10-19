import assert from 'node:assert/strict';
import {createProductDocumentReceiver,productDocumentIdentity} from '../../extensions/supplier-hub/product-document-receiver.mjs';
import {sqliteSingleStore,SINGLE_SENDER} from './supplier-hub-single-document.mjs';

/** Actual receiver and committed SQLite checkpoints; every adapter operation
 * is a local synthetic document. No browser, network or real product exists. */
export async function productValidationRejectionFixture(packet,options={}){
 const now=options.now??Date.now(),context=await productDocumentIdentity(packet,SINGLE_SENDER,{now}),storage=options.storage??sqliteSingleStore();
 const protectedBody={docId:'protected-existing',productName:'기존 작업 원본',jsonDocument:[{productPage:{price:7777}}]},documents=options.documents??new Map([[protectedBody.docId,structuredClone(protectedBody)]]);
 const calls=[],company=structuredClone(packet.review.identity.company),tab={tabId:71,windowId:SINGLE_SENDER.tab.windowId,origin:'https://supplier.coupang.com',requestId:packet.requestId,packetDigest:context.packetDigest,company,authenticated:true};
 const f={storage,context,documents,calls,creates:0,updates:0,validations:0,now,sourceCurrent:true};
 const read=input=>({docId:input.docId,company,identityDigest:context.identityDigest,body:structuredClone(documents.get(input.docId))});
 const forbidden=async()=>assert.fail('Rejected document must never navigate, consent, submit or infer a receipt');
 const adapter={
  readSource:async input=>{calls.push('source');assert.equal(input.requestId,packet.requestId);return {current:f.sourceCurrent,submissionReady:true,priorDocumentClear:true,identity:context.identity,bodySha256:context.originalBodySha256,sessionId:'validation-fixture-session'};},
  createTarget:async()=>({tabId:tab.tabId,windowId:tab.windowId,origin:tab.origin,requestId:packet.requestId,packetDigest:context.packetDigest}),readTab:async()=>tab,
  hubRequest:async input=>{calls.push(input.method+' '+input.path);
   if(input.method==='GET')return {ok:true,status:200,json:[...documents.keys()].map(docId=>({docId}))};
   if(input.path==='/sr/draft/api/create'){
    assert.equal(storage.get(context.key).state,'create-requested');f.creates++;const docId='local-'+packet.requestId;documents.set(docId,{...structuredClone(input.body),docId});return {ok:true,status:200,json:{docId}};
   }
   if(input.path==='/sr/draft/api/update'){
    assert.equal(storage.get(context.key).state,'update-requested');assert.notEqual(input.body.docId,protectedBody.docId);f.updates++;documents.set(input.body.docId,structuredClone(input.body));return {ok:true,status:200,json:{}};
   }
   assert.equal(input.path,'/sr/qvt/api/validate-step/2');assert.equal(storage.get(context.key).state,'validation-requested');f.validations++;
   return {ok:true,status:200,json:{code:200,data:[{success:false,errors:[{columnName:'supplyPrice',message:'합성 단계 검증 반려'}]}]}};
  },
  readDocument:async input=>read(input),recoverWrite:forbidden,readValidation:forbidden,navigate:forbidden,readAgreements:forbidden,verifyHumanConfirmation:forbidden,confirmAgreements:forbidden,submit:forbidden,observeReceipt:forbidden,
 };
 f.remount=()=>f.receiver=createProductDocumentReceiver({adapter,store:storage.store,now:()=>f.now});f.remount();
 f.assertPreserved=()=>assert.deepEqual(documents.get(protectedBody.docId),protectedBody);
 f.close=()=>{if(!options.storage)storage.db.close();};return f;
}
