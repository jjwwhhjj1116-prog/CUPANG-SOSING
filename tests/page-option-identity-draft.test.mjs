import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const companies=[{companyCode:'A01526306',companyName:'유앤채'},{companyCode:'A01464742',companyName:'와이홉'}];
const captureId='75500000-0000-4000-8000-000000000055';
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const request=(url,body)=>new Request('https://app.test'+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const snapshot=h=>({format:'yoofam-page-source-v1',sourceUrl:h.sourceUrl,offerId:'813724060928',collectedAt:new Date().toISOString(),title:'합성 페이지 옵션 상품',description:'옵션별 원가가 확인된 합성 원문',
 options:[null,null,'known-supplier-755'].map((supplierSku,index)=>({key:['black:size-small','white:size-large','blue:size-large'][index],name:['검정 / 소형','흰색 / 대형','파랑 / 대형'][index],supplierSku,unitPriceCny:[5,7,9][index],currency:'CNY',minimumOrder:null,stock:null,imageUrl:`https://cbu01.alicdn.com/synthetic-755-${index}.png`})),
 images:[0,1,2].map(index=>({url:`https://cbu01.alicdn.com/synthetic-755-${index}.png`,role:index===0?'main':'additional'})),attributes:[]});
async function store(h,company,source){
 const fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(source),api=h.load('app/api/source-inbox/route.ts');
 await json(await api.POST(request('/api/source-inbox',{expectedOwnerId:'owner',expectedCompany:{code:company.companyCode,name:company.companyName},id:captureId,fingerprint,snapshot:source})));
 return {api,selection:{format:'yoofam-saved-page-capture-v1',sourceUrl:h.sourceUrl,captureId,fingerprint,revision:1}};
}
for(const company of companies)test(`${company.companyCode}: captured multi-option row keys reach editable drafts without invented supplier SKUs`,async()=>{
 const h=mobileIntakeHarness(company);try{
  const source=snapshot(h),before=JSON.stringify(source),f=await store(h,company,source);
  const item=(await json(await f.api.GET())).items.find(item=>item.id===captureId);assert.deepEqual(item.issues,[]);assert.ok(item.warnings.some(text=>text.includes('SKU 미확인')));
  const stored=h.sqlite.prepare('SELECT * FROM source_inbox WHERE id=?').get(captureId);
  const ready=await json(await h.load('app/api/source-inbox/ready/route.ts').GET(new Request('https://app.test/api/source-inbox/ready?'+new URLSearchParams({sourceUrl:h.sourceUrl,captureId,fingerprint:f.selection.fingerprint,revision:'1'}))));
  const ack=await json(await h.route('/api/collection-jobs/job/collect',{method:'POST',body:{browserCapture:ready.capture}}));
  assert.deepEqual(ack.receipt.result.pageOptionIdentity,{format:'yoofam-page-option-identity-v1',offerId:source.offerId,sourceKeys:source.options.map(row=>row.key)});
  assert.deepEqual(ack.receipt.result.options.map(row=>row.sku),['','','known-supplier-755']);
  const promoted=await json(await h.route('/api/collection-jobs/job/product',{method:'POST',body:{expectedSource:{capture:ready.capture,receivedAt:ack.receipt.receivedAt}}}));
  const base='/api/products/'+promoted.productId,state=await json(await h.route(base+'/options'));
  assert.deepEqual(state.options.rows.map(row=>row.id),['collected-1','collected-2','collected-3']);
  assert.deepEqual(state.options.rows.map(row=>row.supplierSku),['','','known-supplier-755']);
  assert.deepEqual(state.options.rows.map(row=>row.provenance.supplierSku),['unverified','unverified','collected']);
  assert.deepEqual(state.options.rows.map(row=>row.unitCostCny),[5,7,9]);assert.deepEqual(state.options.rows.map(row=>row.minimumOrderQuantity),[null,null,null]);
  const quote=await json(await h.route(base+'/quotation-fields'));assert.deepEqual(quote.resolved.rows.filter(row=>row.included).map(row=>row.optionId),['collected-1','collected-2','collected-3']);
  const content=await h.load('db/product-content.ts').readProductContent('owner',promoted.productId),keys=[0,1,2].map(index=>'owner/synthetic-page-row-'+index+'.png');
  const draft=h.load('app/collection-image-draft.ts').collectedImageDraft('owner',ack.receipt.result,keys.map((key,imageIndex)=>({key,imageIndex})),keys,content,state.options,new Date().toISOString());
  assert.deepEqual(draft.options.rows.map(row=>row.imageKey),[null,null,keys[2]],'blank SKUs must never join to the same variant image');
  assert.deepEqual(draft.options.rows.slice(0,2).map(row=>row.provenance.imageKey),['unverified','unverified']);
  assert.equal(draft.content.assets.main.value[0],keys[0]);
  const productDB=h.load('db/queries.ts'),optionDB=h.load('db/product-options.ts'),model=h.load('app/product-options.ts');
  const product=await productDB.findProduct('owner',promoted.productId),rows=model.optionInputs(state.options);rows[0].translatedName='수동 검토 검정';
  await optionDB.saveProductOptions('owner',model.applyOptionRows(state.options,rows,new Date().toISOString()),state.options.revision,product.updated_at);
  const saved=JSON.stringify(h.sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(promoted.productId));
  const retry=await json(await h.route('/api/collection-jobs/job/product',{method:'POST',body:{expectedSource:{capture:ready.capture,receivedAt:ack.receipt.receivedAt}}}));
  assert.equal(retry.reused,true);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(promoted.productId)),saved);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM source_inbox WHERE id=?').get(captureId),stored);assert.equal(JSON.stringify(source),before);assert.deepEqual(h.network,[]);
 }finally{h.close();}
});
test('anonymous option receipt requires exact page provider, offer and complete unique source keys; known duplicate SKU and OpenAPI default remain separate',()=>{
 const h=mobileIntakeHarness();try{
  const source=snapshot(h),model=h.load('app/source-inbox.ts'),validate=h.load('app/collection-result.ts').validateCollectionResult;
  const result=model.pageSourceCollectionResult(source),{offerId,...body}=result;assert.equal(validate(body,offerId).options[0].sku,'');
  const supplement=h.load('app/collection-source-supplement.ts');assert.equal(supplement.canSupplementCollection(result),false);
  assert.throws(()=>supplement.supplementCollectionSource(result,{...result,provider:'chrome-public-mobile-v1'}));
  const noProof={...body};delete noProof.pageOptionIdentity;assert.throws(()=>validate(noProof,offerId));
  for(const change of [null,{}, {...body.pageOptionIdentity,offerId:'999999999999'}, {...body.pageOptionIdentity,sourceKeys:['same','same','other']},
   {...body.pageOptionIdentity,sourceKeys:['one']},{...body.pageOptionIdentity,sourceKeys:['one','two',' three ']},{...body.pageOptionIdentity,sourceKeys:['one','two','\u0000bad']},
   {...body.pageOptionIdentity,extra:true}])assert.throws(()=>validate({...body,pageOptionIdentity:change},offerId));
  for(const provider of ['1688-openapi-candidate-v1','chrome-current-page-v2','external-test'])assert.throws(()=>validate({...body,provider},offerId));
  assert.throws(()=>validate({...body,offerDefault:{}},offerId));assert.throws(()=>validate({...body,priceBasis:{}},offerId));
  assert.throws(()=>validate({...body,options:body.options.map(row=>({...row,sku:'duplicate-known'}))},offerId));
  assert.throws(()=>validate({...body,options:body.options.map(row=>({...row,sku:null}))},offerId));
  assert.deepEqual(h.network,[]);
 }finally{h.close();}
});
for(const [field,label] of [['unitPriceCny','옵션 원가'],['currency','위안(CNY) 통화']])test(`source row identity never substitutes unknown ${label}`,async()=>{
 const company=companies[1],h=mobileIntakeHarness(company);try{
  const source=snapshot(h);source.options[0][field]=null;const f=await store(h,company,source),listing=await json(await f.api.GET());assert.ok(listing.items[0].issues.includes(label));
  assert.throws(()=>h.load('app/source-inbox.ts').pageSourceCollectionResult(source));
  await json(await h.route('/api/collection-jobs/job/collect',{method:'POST',body:{browserCapture:f.selection}}),422);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);assert.deepEqual(h.network,[]);
 }finally{h.close();}
});
