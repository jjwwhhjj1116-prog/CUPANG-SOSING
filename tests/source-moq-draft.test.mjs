import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{companyCode:'A01526306',companyName:'유앤채'},{companyCode:'A01464742',companyName:'와이홉'}];
const captureId='75400000-0000-4000-8000-000000000054';
const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const request=(path,method,body)=>new Request('https://app.test'+path,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const snapshot=h=>({format:'yoofam-page-source-v1',sourceUrl:h.sourceUrl,offerId:'813724060928',collectedAt:new Date().toISOString(),title:'합성 MOQ 검증 상품',description:'합성 원문 설명',
 options:[null,1,5].map((minimumOrder,index)=>({key:'option-'+index,name:['亮黑 / 太阳镜','砂黑 / 太阳镜','砂灰 / 太阳镜'][index],supplierSku:'synthetic-moq-'+index,unitPriceCny:5,currency:'CNY',minimumOrder,stock:null,imageUrl:null})),
 images:[{url:'https://cbu01.alicdn.com/synthetic-moq-main.png',role:'main'}],attributes:[{name:'品牌',value:'利翔'}]});
async function store(h,company,source){
 const api=h.load('app/api/source-inbox/route.ts'),fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(source);
 const ack=await json(await api.POST(request('/api/source-inbox','POST',{expectedOwnerId:'owner',expectedCompany:{code:company.companyCode,name:company.companyName},id:captureId,fingerprint,snapshot:source})));
 assert.equal(ack.storedId,captureId);assert.equal(ack.storedFingerprint,fingerprint);
 const selection={format:'yoofam-saved-page-capture-v1',sourceUrl:h.sourceUrl,captureId,fingerprint,revision:1};
 return {api,selection,ready:()=>h.load('app/api/source-inbox/ready/route.ts').GET(new Request('https://app.test/api/source-inbox/ready?'+new URLSearchParams({sourceUrl:h.sourceUrl,captureId,fingerprint,revision:'1'})))};
}
function oldState(h,id){return JSON.stringify(Object.fromEntries([
 ['products',h.sqlite.prepare('SELECT * FROM products WHERE id=?').all(id)],
 ...['product_options','product_content','product_price_policy','product_registration_numbers','product_registration_options','collection_products'].map(table=>[table,h.sqlite.prepare(`SELECT * FROM ${table} WHERE product_id=?`).all(id)]),
 ['receipt',h.sqlite.prepare('SELECT * FROM collection_results WHERE job_id=?').all('old-work')],
 ['context',h.sqlite.prepare('SELECT * FROM collection_context WHERE job_id=?').all('old-work')],
]));}
async function oldWork(h,source){
 const now=new Date().toISOString();h.sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run('old-work','owner',source.offerId,source.sourceUrl,'collect','awaiting_connector',now,now);
 h.sqlite.prepare('INSERT INTO collection_context VALUES(?,?)').run('old-work',JSON.stringify(h.context));
 const receipt=h.load('app/source-inbox.ts').pageSourceCollectionResult({...source,title:'기존 합성 원문',options:source.options.map(row=>({...row,minimumOrder:7}))});
 await h.load('db/collection-results.ts').storeCollectionResult('owner','old-work',receipt);
 const job=await h.load('db/collection-jobs.ts').findCollectionJob('owner','old-work'),saved=await h.load('db/collection-products.ts').promoteCollection('owner',job,receipt);
 h.sqlite.prepare('UPDATE products SET title=? WHERE id=?').run('기존에 직접 검토한 상품',saved.product_id);
 return saved.product_id;
}
const priceValues=row=>['supplyPrice','salePrice','msrp'].map(field=>row.fields[field].value);

for(const company of companies)test(`${company.companyCode}: unknown supplier MOQ reaches exact saved-source SEO/price/quotation drafts without replacing quantities or old work`,async()=>{
 const h=mobileIntakeHarness(company);try{
  const source=snapshot(h),oldId=await oldWork(h,source),old=oldState(h,oldId),f=await store(h,company,source);
  const listing=await json(await f.api.GET()),item=listing.items.find(value=>value.id===captureId);
  assert.deepEqual(item.issues,[]);assert.ok(item.warnings.some(message=>message.includes('최소 주문 수량')));
  assert.deepEqual(item.snapshot.options.map(row=>row.minimumOrder),[null,1,5]);
  const rawSource=h.sqlite.prepare('SELECT * FROM source_inbox WHERE id=?').get(captureId);
  const ready=await json(await f.ready());assert.deepEqual(ready.capture,f.selection);
  const ack=await json(await h.route('/api/collection-jobs/job/collect',{method:'POST',body:{browserCapture:ready.capture}}));
  assert.deepEqual(ack.receipt.result.options.map(row=>row.minimumOrder),[null,1,5]);
  const rawReceipt=h.sqlite.prepare('SELECT * FROM collection_results WHERE job_id=?').get('job');
  const proof={capture:ready.capture,receivedAt:ack.receipt.receivedAt};
  const promoted=await json(await h.route('/api/collection-jobs/job/product',{method:'POST',body:{expectedSource:proof}}));
  assert.equal(promoted.reused,false);assert.notEqual(promoted.productId,oldId);const base='/api/products/'+promoted.productId;
  let state=await json(await h.route(base+'/options'));
  assert.deepEqual(state.options.rows.map(row=>row.minimumOrderQuantity),[null,1,5]);
  assert.deepEqual(state.options.rows.map(row=>row.provenance.minimumOrderQuantity),['unverified','collected','collected']);
  assert.deepEqual(state.options.rows.map(row=>row.unitsPerPack),[1,1,1]);
  assert.deepEqual(state.pricing.rows.map(row=>row.sourceCostCny),[5,5,5]);assert.ok(state.pricing.rows.every(row=>!row.error));
  assert.deepEqual(state.pricing.rows[0].calculation,state.pricing.rows[1].calculation);assert.deepEqual(state.pricing.rows[0].calculation,state.pricing.rows[2].calculation);
  const seo=await h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(promoted.productId,(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body}),new AbortController().signal);
  assert.equal(seo.completed,true,seo.message);assert.ok(h.aiSources.length>0,'actual SEO handlers execute against only the harness AI fixture');
  state=await json(await h.route(base+'/options'));
  assert.deepEqual(state.options.rows.map(row=>row.minimumOrderQuantity),[null,1,5]);
  assert.deepEqual(state.options.rows.map(row=>row.provenance.minimumOrderQuantity),['unverified','collected','collected']);
  let quotation=await json(await h.route(base+'/quotation-fields'));
  assert.equal(quotation.categoryContext.categoryId,'80719','synthetic captured form only, without a live category recommendation or Hub submission');
  const quoted=quotation.resolved.rows.filter(row=>row.optionId);
  assert.equal(quoted.length,3);assert.deepEqual(priceValues(quoted[0]),priceValues(quoted[1]));assert.deepEqual(priceValues(quoted[0]),priceValues(quoted[2]));
  for(const row of quoted){assert.equal(row.fields.quantity.value,'1');assert.equal(row.fields.boxSkuQuantity.value,'50');}
  const rows=h.load('app/product-options.ts').optionInputs(state.options);rows[0].unitsPerPack=3;rows[1].minimumOrderQuantity=null;
  state=await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:state.options.revision,expectedProductVersion:state.productVersion,rows}}));
  assert.deepEqual(state.options.rows.map(row=>row.minimumOrderQuantity),[null,null,5]);
  assert.equal(state.options.rows[0].provenance.minimumOrderQuantity,'unverified');assert.equal(state.options.rows[1].provenance.minimumOrderQuantity,'manual');
  assert.equal(state.pricing.rows[0].sourceCostCny,15);assert.equal(state.pricing.rows[1].sourceCostCny,5);
  const expected=h.load('app/pricing.ts').calculatePrice(5,state.pricing.policy,3);assert.deepEqual(plain(state.pricing.rows[0].calculation),plain(expected));
  quotation=await json(await h.route(base+'/quotation-fields'));const packed=quotation.resolved.rows.find(row=>row.optionId===rows[0].id);
  assert.equal(packed.fields.quantity.value,'3');assert.equal(packed.fields.boxSkuQuantity.value,'50');
  assert.deepEqual(priceValues(packed),['supplyPrice','salePrice','msrp'].map(field=>String(expected[field])));
  const reviewed=JSON.stringify({options:h.sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(promoted.productId),content:h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(promoted.productId),product:h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(promoted.productId)});
  const retry=await json(await h.route('/api/collection-jobs/job/product',{method:'POST',body:{expectedSource:proof}}));assert.equal(retry.reused,true);assert.equal(retry.productId,promoted.productId);
  assert.equal(JSON.stringify({options:h.sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(promoted.productId),content:h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(promoted.productId),product:h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(promoted.productId)}),reviewed);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM source_inbox WHERE id=?').get(captureId),rawSource);assert.deepEqual(h.sqlite.prepare('SELECT * FROM collection_results WHERE job_id=?').get('job'),rawReceipt);
  assert.equal(oldState(h,oldId),old);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,2);
  assert.deepEqual(h.network,[]);assert.equal(h.stats.downloads,0);assert.equal(h.objects.size,0);
 }finally{h.close();}
});

test('MOQ null is explicit unknown; malformed or omitted MOQ still fails both source and receipt validation',()=>{
 const h=mobileIntakeHarness();try{
  const source=snapshot(h),model=h.load('app/source-inbox.ts'),validate=h.load('app/collection-result.ts').validateCollectionResult;
  const result=model.pageSourceCollectionResult(source),{offerId,...body}=result;
  assert.equal(offerId,source.offerId);assert.deepEqual(result.options.map(row=>row.minimumOrder),[null,1,5]);
  for(const minimumOrder of [undefined,0,-1,'1','1.5',1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
   assert.throws(()=>model.pageSourceCollectionResult({...source,options:[{...source.options[0],minimumOrder}]}));
   assert.throws(()=>validate({...body,options:[{...result.options[0],minimumOrder}]},source.offerId));
  }
  const without={...result.options[0]};delete without.minimumOrder;assert.throws(()=>validate({...body,options:[without]},source.offerId));
  for(const minimumOrder of [null,1,5])assert.equal(validate({...body,options:[{...result.options[0],minimumOrder}]},source.offerId).options[0].minimumOrder,minimumOrder);
  assert.ok(h.load('app/collection-result.ts').collectionSourceWarnings(result).some(message=>message.includes('최소 주문 수량')));
  assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

for(const [field,label] of [['unitPriceCny','옵션 원가'],['currency','위안(CNY) 통화']])test(`${label} unknown remains blocking even when MOQ null alone is draft-ready`,async()=>{
 const company=companies[1],h=mobileIntakeHarness(company);try{
  const source=snapshot(h);source.options[0][field]=null;const f=await store(h,company,source);
  const listing=await json(await f.api.GET()),item=listing.items.find(value=>value.id===captureId);assert.ok(item.issues.includes(label));assert.ok(!item.issues.includes('최소 주문 수량'));
  assert.equal((await json(await f.ready(),409)).code,'PAGE_SOURCE_REVIEW_REQUIRED');
  assert.equal((await json(await h.route('/api/collection-jobs/job/collect',{method:'POST',body:{browserCapture:f.selection}}),422)).code,'SOURCE_CANDIDATE_INVALID');
  for(const table of ['collection_results','products','product_options','product_content','collection_products'])assert.equal(h.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
  assert.deepEqual(h.network,[]);assert.equal(h.aiSources.length,0);
 }finally{h.close();}
});
