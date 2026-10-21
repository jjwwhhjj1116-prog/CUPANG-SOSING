import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativeReceiverReceiptFixture,companies,plain,json} from './helpers/native-product-receiver-receipt-flow.mjs';
import {PRODUCT_DOCUMENT_LIVE_VERIFIED,dispatchProductDocument} from '../extensions/supplier-hub/product-document-dispatch.mjs';
import {SINGLE_DOCUMENT_LIVE_VERIFIED} from '../extensions/supplier-hub/single-dispatch.mjs';
import {PRODUCT_DOCUMENT_REQUEST_TTL} from '../extensions/supplier-hub/product-document.mjs';

const writes=f=>f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').map(call=>new URL(call.url).pathname);
const cases=[];
test.after(()=>fs.writeFileSync(new URL('../outputs/step769-native-chain-proof.json',import.meta.url),JSON.stringify({cases,boundary:'Actual native-assets/quotation/receipt handlers, actual adapter and receiver; isolated SQLite/private PNGs and synthetic Chrome/Hub transport/explicit synthetic consents only. No external request or real receipt verification.',realSourceOrHubRequests:0,realProductWrites:0,actualUploadVerified:false,remoteBytesVerified:false,registered:false},null,2)+'\n'));

for(const company of companies)test(company.code+': actual native source plan -> full-group receiver -> strict receipt observation -> actual receipt API persists one immutable document',async t=>{
 // This test's isolated worker creates every application/Chrome VM below with
 // the same Date. CPU contention must not consume the preview/consent TTL.
 // Real setTimeout/abort/watch timers and all guard reads remain unchanged.
 t.mock.timers.enable({apis:['Date'],now:Date.now()});let f;
 try{
  f=await nativeReceiverReceiptFixture(company);
  const sqlBefore=f.source.state(),objectsBefore=f.source.objectState(),prior=JSON.stringify(f.documents.get(f.prior.docId));
  assert.deepEqual(f.plan.identity.members.map(row=>row.optionId),['synthetic-one','synthetic-two']);assert.equal(f.plan.body.jsonDocument.length,2);
  assert.deepEqual(f.plan.body.jsonDocument.map(doc=>doc.productPage.commonAttributes.purchasePrice),['11960','3333']);
  assert.deepEqual(f.plan.body.jsonDocument.map(doc=>[doc.startPage.productName,doc.productPage.commonAttributes.coupangSalePrice,doc.productPage.commonAttributes.msrp]),[['합성 전체 첫째','19930','25910'],['합성 전체 둘째','4444','5555']]);
  let result=await f.receiver.start(f.packet,f.sender);
  assert.equal(result.state,'awaiting-consent',JSON.stringify(result));assert.equal(f.submitted,0);assert.equal(f.state.humanConfirmations.length,0);
  assert.deepEqual(f.state.uploads.map(row=>row.group),['MAIN','ADDITIONAL','LABEL','DETAIL']);
  for(const group of f.state.uploads)assert.deepEqual(group.files,[...new Set(f.plan.images.filter(image=>image.imageType===group.group).map(image=>image.transportName))]);
  for(const image of f.plan.images)assert.ok(f.state.uploads.some(group=>group.group===image.imageType&&group.files.includes(image.transportName)));
  const stored=f.documents.get(f.createdDocId);assert.deepEqual(stored.jsonDocument,plain(f.context.packet.body.jsonDocument));
  assert.deepEqual(writes(f),['/sr/draft/api/create','/sr/draft/api/update','/sr/qvt/api/validate-step/2','/sr/qvt/api/validate-step/3','/sr/qvt/api/validate-step/4','/sr/qvt/api/validate-step/5']);
  f.state.rowChanges={docId:f.prior.docId};
  result=await f.receiver.confirm(f.packet,f.sender,f.action(result));
  assert.equal(result.state,'submit-requested',JSON.stringify(result));assert.equal(result.receipt,undefined);assert.equal(result.registered,false);assert.equal(f.submitted,1);assert.equal(f.state.humanConfirmations.length,1);
  f.state.rowChanges={};result=await f.receiver.observe(f.packet,f.sender);
  assert.equal(result.state,'pending',JSON.stringify(result));assert.equal(result.receipt.qvtRequestId,'000769-QVT-raw');assert.equal(result.receipt.evidence,'document-receipt');assert.equal(Object.hasOwn(result.receipt,'skuId'),false);
  f.state.qvtRequestId='different-QVT';const changedQvt=await f.receiver.observe(f.packet,f.sender);assert.equal(changedQvt.state,'pending');assert.equal(changedQvt.error.code,'RECEIPT_CHANGED');assert.equal(changedQvt.receipt.qvtRequestId,result.receipt.qvtRequestId);assert.equal(f.submitted,1);f.state.qvtRequestId=result.receipt.qvtRequestId;
  const saved=await json(await f.post(result));assert.equal(saved.receipt.recordType,'product-document');assert.deepEqual(saved.receipt.members.map(row=>row.optionId),['synthetic-one','synthetic-two']);assert.equal(saved.receipt.receipt.qvtRequestId,result.receipt.qvtRequestId);assert.equal(saved.receipt.registered,false);
  const history=await f.history();assert.equal(history.receipts.length,1);assert.equal(history.receipts[0].packetDigest,f.context.packetDigest);
  const wrong=[value=>{value.identity.company=plain(companies.find(other=>other.code!==company.code));},value=>{value.docId=value.receipt.docId=f.createdDocId+99;},value=>{value.receipt.qvtRequestId=value.receipt.receiptId='different-QVT';}];
  for(const mutate of wrong){const value=plain(result);mutate(value);await json(await f.post(value),409);}
  const beforeWrites=writes(f),beforeUploads=plain(f.state.uploads),receiver=f.reloadReceiver();
  const duplicate=await receiver.start(f.packet,f.sender);assert.equal(duplicate.state,'pending');assert.equal(duplicate.duplicate,true);
  await assert.rejects(dispatchProductDocument({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'start',packet:f.packet},f.sender),error=>error.code==='PRODUCT_LIVE_CONTRACT_UNVERIFIED');
  const checkpointBeforeExpiry=JSON.stringify(f.storage.get(f.context.key)),expiredAt=f.packet.createdAt+PRODUCT_DOCUMENT_REQUEST_TTL+1;
  t.mock.timers.tick(expiredAt-Date.now());assert.equal(Date.now(),expiredAt);
  await assert.rejects(receiver.start(f.packet,f.sender),error=>error.code==='EXPIRED');
  await assert.rejects(dispatchProductDocument({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'start',packet:f.packet},f.sender),error=>error.code==='EXPIRED');
  assert.equal(JSON.stringify(f.storage.get(f.context.key)),checkpointBeforeExpiry,'an expired new start cannot change the durable request');
  await receiver.recover(f.packet,f.sender);await receiver.resume(f.packet,f.sender);assert.deepEqual(writes(f),beforeWrites);assert.deepEqual(f.state.uploads,beforeUploads);assert.equal(f.submitted,1);
  f.state.status='FINISHED';const accepted=await receiver.observe(f.packet,f.sender);assert.equal(accepted.state,'accepted',JSON.stringify(accepted));assert.equal(accepted.registered,false);assert.equal(accepted.success,false);assert.equal(accepted.receipt.qvtRequestId,result.receipt.qvtRequestId);
  await json(await f.post(accepted));await json(await f.post(accepted));const final=await f.history();assert.equal(final.receipts.length,1);assert.equal(final.receipts[0].receipt.sourceStatus,'FINISHED');assert.equal(final.receipts[0].registered,false);
  const ledger=JSON.parse(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords)[f.context.packetDigest].nativeAssets;assert.equal(ledger.state,'complete');assert.equal(ledger.remoteBytesVerified,false);assert.equal(ledger.actualUploadVerified,false);
  assert.equal(f.source.state(),sqlBefore);assert.equal(f.source.objectState(),objectsBefore);assert.equal(JSON.stringify(f.documents.get(f.prior.docId)),prior);assert.deepEqual(f.source.h.network,[]);assert.equal(f.submitted,1);
  assert.equal(PRODUCT_DOCUMENT_LIVE_VERIFIED,false);assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);await assert.rejects(dispatchProductDocument({type:'YOOFAM_PRODUCT_DOCUMENT_REQUEST',action:'resume',packet:f.packet},f.sender),error=>error.code==='PRODUCT_LIVE_CONTRACT_UNVERIFIED');
  cases.push({company:company.code,includedMembers:2,excludedMembers:1,uploadGroups:plain(f.state.uploads),appHandlerReads:f.state.appReads.length,privateOriginalReads:f.state.appReads.filter(row=>new URL(row.url).searchParams.has('key')).length,explicitSyntheticConsents:f.state.humanConfirmations.length,syntheticSubmitClicks:f.submitted,receiptRows:final.receipts.length,state:final.receipts[0].receipt.state,deterministicDate:true,realTimersUnchanged:true,expiredStartRejected:true,expiredRecoveryAndObservationVerified:true,protectedSQLAndObjectsUnchanged:true,protectedHubDocumentUnchanged:true,remoteBytesVerified:false,actualUploadVerified:false,registered:false});
 }finally{f?.close();t.mock.timers.reset();}
});
