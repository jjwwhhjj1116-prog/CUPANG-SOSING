import test from 'node:test';
import assert from 'node:assert/strict';
import {completeQuotationNativeFixture,companies,json} from './helpers/quotation-native-flow.mjs';
import {nativeReceiverReceiptFixture,plain} from './helpers/native-product-receiver-receipt-flow.mjs';
import {createProductDocumentDraftReceiver} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {PRODUCT_DOCUMENT_REQUEST_TTL} from '../extensions/supplier-hub/product-document.mjs';
import {quotationTitleLoader} from './helpers/quotation-seo-title-ui.mjs';

const writes=f=>f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').map(call=>new URL(call.url).pathname);
const summary=async f=>(await f.source.h.load('db/product-content.ts').readRegistrationSummaries('owner',[await f.source.h.load('db/queries.ts').findProduct('owner',f.id)]))[f.id];
const cleanReceipt=quotationTitleLoader()('app/supplier-hub-product-client.ts').preparedReceiptObservation;

for(const company of companies)test(company.code+': saved writing completion reaches the exact native prepared document and durable final receipt without any replay',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});let source,f;
 try{
  source=await completeQuotationNativeFixture(company);f=await nativeReceiverReceiptFixture(company,{source,browser:{stageFlow:true,finalNoItems:true}});source=null;
  const view=await f.source.fields(),checked=f.source.h.load('app/quotation-save-validation.ts').currentSavedQuotationValidation(view,f.id);
  assert.ok(checked);assert.equal(checked.schemaReady,true);assert.equal(checked.globalErrorCount,0);assert.ok(checked.rows.filter(row=>row.included).every(row=>row.errorCount===0));assert.equal((await summary(f)).stages.quotation.state,'complete');
  assert.equal(view.submissionReady,false);assert.equal(f.plan.metadataValid,true);assert.equal(f.plan.images.length,7);assert.equal(f.plan.identity.members.length,2);assert.equal(f.plan.body.jsonDocument.length,2);
  const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store}),objects=f.source.objectState(),protectedDocument=JSON.stringify(f.documents.get(f.prior.docId));
  const prepared=await receiver.prepareDraft(f.packet,f.sender);assert.equal(prepared.state,'validated',JSON.stringify(prepared));assert.deepEqual(prepared.draftProof.validatedSteps,[2,3,4,5]);assert.equal(f.submitted,0);
  const uploads=JSON.stringify(f.state.uploads),beforeWrites=writes(f);assert.equal(beforeWrites.filter(path=>path.endsWith('/create')).length,1);assert.deepEqual(f.state.uploads.map(row=>row.group),['MAIN','ADDITIONAL','LABEL','DETAIL']);
  t.mock.timers.tick(1);const rechecked=await json(await f.source.h.route(f.source.fieldsPath,{method:'POST',body:{action:'validate-saved',expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint}}));
  assert.equal(rechecked.revision,view.revision);assert.equal(rechecked.productVersion,view.productVersion);assert.equal(rechecked.inputFingerprint,view.inputFingerprint);assert.deepEqual(plain(rechecked.overrides),plain(view.overrides));
  const plan=await f.source.source();for(const key of ['identity','identityDigest','sourcePlanSha256','originalBodySha256','preparedBodySha256'])assert.deepEqual(plain(plan[key]),plain(f.plan[key]),key);
  const sourceAfterRecheck=f.source.state();let result=await receiver.reviewPreparedDraft(f.packet,f.sender),stages=[];
  while(result.challenge){assert.ok(stages.length<3);stages.push(result.challenge.stage);assert.equal(f.submitted,0);result=await receiver.confirmPreparedDraft(f.packet,f.sender,f.action(result));}
  assert.deepEqual(stages,['productPage','imagePage','logisticsPage']);assert.equal(result.state,'pending',JSON.stringify(result));assert.equal(result.receipt.sourceStatus,'SUBMITTED');assert.equal(f.submitted,1);assert.equal(f.state.humanConfirmations.length,3);
  await json(await f.post(cleanReceipt(result)));const sent=writes(f),requestId=result.requestId,docId=result.docId,qvtRequestId=result.receipt.qvtRequestId;
  t.mock.timers.tick(PRODUCT_DOCUMENT_REQUEST_TTL+1);await assert.rejects(receiver.prepareDraft(f.packet,f.sender),{code:'EXPIRED'});
  result=await receiver.observePreparedDraft(f.packet,f.sender);assert.equal(result.state,'pending',JSON.stringify(result));await json(await f.post(cleanReceipt(result)));
  f.state.status='FINISHED';result=await receiver.observePreparedDraft(f.packet,f.sender);assert.equal(result.state,'accepted',JSON.stringify(result));assert.equal(result.requestId,requestId);assert.equal(result.docId,docId);assert.equal(result.receipt.qvtRequestId,qvtRequestId);assert.equal(result.receipt.sourceStatus,'FINISHED');assert.equal(result.registered,false);assert.equal(result.success,false);
  await json(await f.post(cleanReceipt(result)));await json(await f.post(cleanReceipt(result)));const history=await f.history();assert.equal(history.receipts.length,1);assert.equal(history.receipts[0].receipt.sourceStatus,'FINISHED');assert.equal(history.receipts[0].requestId,requestId);
  assert.deepEqual(writes(f),sent);assert.equal(f.submitted,1);assert.equal(JSON.stringify(f.state.uploads),uploads);assert.equal(f.source.state(),sourceAfterRecheck);assert.equal(f.source.objectState(),objects);assert.equal(JSON.stringify(f.documents.get(f.prior.docId)),protectedDocument);assert.deepEqual(f.source.h.network,[]);
 }finally{f?.close();source?.close();t.mock.timers.reset();}
});
