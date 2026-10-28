import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNativeDocumentReadback} from '../extensions/supplier-hub/single-document-adapter.mjs';
import {nativeReceiverReceiptFixture,companies} from './helpers/native-product-receiver-receipt-flow.mjs';
import {createProductDocumentDraftReceiver} from '../extensions/supplier-hub/product-document-receiver.mjs';

const copy=value=>structuredClone(value);
const numeric=['purchasePrice','coupangSalePrice','msrp','osrp'];
function storedShape(value){
 const result=copy(value);if(typeof result.displayCategoryCode==='string')result.displayCategoryCode=Number(result.displayCategoryCode);
 for(const row of result.jsonDocument??[]){for(const key of numeric)if(typeof row.productPage?.commonAttributes?.[key]==='string'&&/^(0|[1-9]\d*)$/.test(row.productPage.commonAttributes[key]))row.productPage.commonAttributes[key]=Number(row.productPage.commonAttributes[key]);if(row.legalPage?.adCert==='')delete row.legalPage.adCert;}
 if(!Object.hasOwn(result,'remark'))result.remark=null;return result;
}
function body(){return{docId:853001,displayCategoryCode:'68183',productName:'합성 상품',jsonDocument:[0,1,2].map(index=>({productPage:{commonAttributes:{purchasePrice:'3420',coupangSalePrice:'6220',msrp:'8090',osrp:'8090',other:'10'},modelNumber:'모델'+index},legalPage:{adCert:'',certificates:[]},imagePage:{msrpAgree:false,labelContactAgreed:false},logisticsPage:{weight:'10'}}))};}

test('only observed numeric/empty native forms normalize, preserving source and raw response',()=>{
 const expected=body(),stored=storedShape(expected),before=copy(stored),original=copy(expected);
 assert.deepEqual(normalizeNativeDocumentReadback(stored,expected),expected);assert.deepEqual(stored,before);assert.deepEqual(expected,original);
});

test('changed values, omitted nonempty fields, reordered options, flags and unobserved conversions still differ',()=>{
 for(const mutate of [
  v=>v.docId++,v=>v.displayCategoryCode++,v=>v.jsonDocument[0].productPage.commonAttributes.purchasePrice++,
  v=>v.jsonDocument[0].productPage.commonAttributes.other=10,v=>v.jsonDocument[0].logisticsPage.weight=10,
  v=>v.jsonDocument[0].imagePage.msrpAgree=true,v=>v.jsonDocument[0].productPage.modelNumber='다른 모델',
  v=>v.jsonDocument.reverse(),v=>v.jsonDocument.pop(),v=>v.remark='반려 사유',
 ]){const expected=body(),stored=storedShape(expected);mutate(stored);assert.notDeepEqual(normalizeNativeDocumentReadback(stored,expected),expected);}
 const expected=body();expected.jsonDocument[0].legalPage.adCert='제출한 인증값';const stored=storedShape(expected);delete stored.jsonDocument[0].legalPage.adCert;
 assert.notDeepEqual(normalizeNativeDocumentReadback(stored,expected),expected);
 for(const text of ['03420',' 3420','3.42e3','3420.0','9007199254740993','-1']){const expected=body();expected.jsonDocument[0].productPage.commonAttributes.purchasePrice=text;const stored=storedShape(expected);stored.jsonDocument[0].productPage.commonAttributes.purchasePrice=Number(text);assert.notDeepEqual(normalizeNativeDocumentReadback(stored,expected),expected);}
});

test('actual native receiver validates stored numeric forms and recovers without another create/update/upload',async()=>{
 const f=await nativeReceiverReceiptFixture(companies[0],{browser:{stageFlow:true,documentRead:storedShape}});
 try{
  const prior=JSON.stringify(f.documents.get(f.prior.docId)),receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store});
  const prepared=await receiver.prepareDraft(f.packet,f.sender);assert.equal(prepared.state,'validated',JSON.stringify(prepared));assert.deepEqual(prepared.draftProof.validatedSteps,[2,3,4,5]);
  const writes=()=>f.calls.filter(c=>c.name==='hub-fetch'&&c.init.method==='POST').map(c=>new URL(c.url).pathname),before=writes(),uploads=copy(f.state.uploads);
  const recovered=await receiver.recoverDraft(f.packet,f.sender);assert.equal(recovered.state,'validated',JSON.stringify(recovered));assert.deepEqual(writes(),before);assert.deepEqual(f.state.uploads,uploads);
  const reviewed=await receiver.reviewPreparedDraft(f.packet,f.sender);assert.equal(reviewed.state,'awaiting-stage-consent',JSON.stringify(reviewed));assert.equal(reviewed.challenge.stage,'productPage');
  assert.deepEqual(writes(),before);assert.deepEqual(f.state.uploads,uploads);assert.equal(f.state.humanConfirmations.length,0);
  assert.equal(before.filter(path=>path.endsWith('/create')).length,1);assert.equal(before.filter(path=>path.endsWith('/update')).length,1);
  assert.equal(JSON.stringify(f.documents.get(f.prior.docId)),prior);assert.equal(f.submitted,0);
 }finally{f.close();}
});

test('a real native price mismatch never reaches validation or causes an update replay',async()=>{
 const f=await nativeReceiverReceiptFixture(companies[0],{browser:{documentRead:value=>{const result=storedShape(value);result.jsonDocument[0].productPage.commonAttributes.purchasePrice++;return result;}}});
 try{
  const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store}),first=await receiver.prepareDraft(f.packet,f.sender);
  assert.equal(first.state,'update-requested');assert.equal(first.error.code,'READBACK_UNCONFIRMED');
  const before=f.calls.filter(c=>c.name==='hub-fetch'&&c.init.method==='POST').length;
  const recovered=await receiver.recoverDraft(f.packet,f.sender);assert.ok(recovered.error);assert.equal(f.calls.filter(c=>c.name==='hub-fetch'&&c.init.method==='POST').length,before);
  assert.equal(f.submitted,0);
 }finally{f.close();}
});
