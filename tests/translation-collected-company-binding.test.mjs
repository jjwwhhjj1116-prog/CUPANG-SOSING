import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const providers=['workers-ai','google-free'];
const offerId='639000000021',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const manualSource={title:'收纳篮',description:'收纳篮商品说明',attributes:[],provenance:'manual',reference:'local manual translation fixture'};
const tables=['products','product_content','product_options','product_price_policy','product_quotation_fields','collection_jobs','collection_context','collection_results','collection_products','collection_images','category_profiles','workspace_settings','translation_jobs','supplier_hub_receipts'];
const snapshot=h=>JSON.stringify(Object.fromEntries(tables.map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
const sourceSnapshot=h=>JSON.stringify(Object.fromEntries(['collection_jobs','collection_context','collection_results','collection_products','collection_images','category_profiles','workspace_settings','product_price_policy'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
const payload=(h,table)=>JSON.parse(h.sqlite.prepare('SELECT payload FROM '+table).get().payload);

// Every record, response and file belongs to this fresh local fixture. Queue,
// canonical URL capture, source receipt and promotion use the actual handlers.
export async function companyTranslationFixture(company=companies[0],provider='workers-ai',legacy=null){
 const queries=[],translations=new Map([['收纳篮','수납 바스켓'],['收纳篮商品说明','수납 바스켓 상품 설명'],['红色款','빨강형'],['灰色款','회색형'],['红色','빨강'],['灰色','회색'],['大型','대형']]);
 let modelCalls=0;
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,translationFetcher:async target=>{
  const url=new URL(target),q=url.searchParams.get('q');queries.push(q);assert.equal(url.origin,'https://translate.googleapis.com');assert.ok(!q.includes('collected-'));
  const translate=text=>{assert.ok(translations.has(text),text);return translations.get(text);};
  const value=q.startsWith('[[YFTR')?q.split('\n').map(line=>{const match=/^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line);assert.ok(match);return `${match[1]} ${translate(match[2])}`;}).join('\n'):translate(q);
  return Response.json([[[value,q]],null,'zh-CN']);
 }});
 try{
  h.sqlite.exec('DELETE FROM collection_context; DELETE FROM collection_jobs;');
  await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(h.settings));
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',h.context.category);
  const queued=await json(await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
   urls:[sourceUrl+'?offerId='+offerId+'&spm=local-fixture'],goal:'work',profileId:profile.id,expectedProfileRevision:profile.revision,expectedSettings:h.settings,
  })}))),job=queued.jobs[0];
  assert.equal(job.source_url,sourceUrl);assert.equal(job.offer_id,offerId);assert.equal(job.context.category.id,profile.id);assert.equal(job.context.category.revision,profile.revision);assert.equal(job.context.category.categoryId,'80719');assert.deepEqual(job.context.company,company);assert.deepEqual(job.context.settings,JSON.parse(JSON.stringify(h.settings)));
  if(legacy==='unrecorded'){
   const context={...job.context};delete context.company;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(context),job.id);
  }
  await json(await h.route('/api/collection-jobs/'+job.id+'/result',{method:'POST',body:{schemaVersion:1,sourceUrl,provider:'synthetic-local-639',collectedAt:new Date().toISOString(),title:manualSource.title,description:manualSource.description,attributes:[],
   options:[{sku:'LOCAL-639-RED',name:'红色款',unitPriceCny:12.5,minimumOrder:2,stock:3,color:'红色',size:'大型'},{sku:'LOCAL-639-GRAY',name:'灰色款',unitPriceCny:6.5,minimumOrder:1,stock:0,color:'灰色',size:'12 cm'}],images:[]}}));
  const promoted=await json(await h.route('/api/collection-jobs/'+job.id+'/product',{method:'POST'})),productId=promoted.productId,base='/api/products/'+productId;
  // A reviewed owned image and a pack quantity must survive a rejected
  // company change just as source costs and raw SKU facts do.
  const imageKey='owner/local-company-639.png';await h.bindings.FILES.put(imageKey,png,{httpMetadata:{contentType:'image/png'},customMetadata:{provenance:'manual'}});
  let product=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(productId);assert.ok(await h.load('db/queries.ts').updateProduct('owner',productId,{image_keys:JSON.stringify([imageKey])},product.updated_at));
  const content=(await json(await h.route(base+'/content'))).content;
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{main:[imageKey]}}}}));
  const view=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(view.options);rows[0].unitsPerPack=3;rows[0].imageKey=imageKey;
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:view.options.revision,expectedProductVersion:view.productVersion,rows}}));
  if(legacy==='unlinked')h.sqlite.prepare('DELETE FROM collection_products WHERE product_id=?').run(productId);
  h.bindings.AI.run=async(_model,input)=>{modelCalls++;const inputSource=JSON.parse(input.messages[1].content);return{response:{title:'수납 바스켓',description:'수납 바스켓 상품 설명',keywords:['수납'],warnings:[],attributes:inputSource.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name,value:translations.get(pair.value)??pair.value}))}};};
  if(provider==='google-free'){h.bindings.SOURCEFLOW_TEXT_PROVIDER=provider;delete h.bindings.AI;}
  product=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(productId);
  const request=body=>h.route(base+'/translation',{method:'POST',body});
  const manual=()=>({action:'prepare',expectedVersion:h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(productId).updated_at,idempotencyKey:'manual-company-fixture',source:manualSource});
  return{h,company,provider,profile,job,productId,base,imageKey,queries,request,manual,get modelCalls(){return modelCalls;},get version(){return h.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(productId).updated_at;}};
 }catch(error){h.close();throw error;}
}
const approve=f=>job=>f.request({action:'approve',jobId:job.id,reviewFingerprint:job.review.fingerprint,confirmPaid:true});
const execute=f=>job=>f.request({action:'execute',jobId:job.id});
function assertNoProviderCalls(f){assert.equal(f.modelCalls,0);assert.deepEqual(f.queries,[]);assert.deepEqual(f.h.network,[]);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_receipts').get().n,0);}

for(const company of companies)for(const provider of providers)for(const phase of ['before-prepare','before-approve','before-execute'])test(`exact collected company blocks translation ${phase} without a job mutation or provider call (${company.code}, ${provider})`,async()=>{
 const f=await companyTranslationFixture(company,provider),{h}=f;
 try{
  let job;
  if(phase!=='before-prepare')job=(await json(await f.request({action:'prepare-collected',intake:true}),201)).job;
  if(phase==='before-execute')await json(await approve(f)(job));
  const before=snapshot(h),objects=new Map([...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes)]));
  h.setCompany(companies.find(value=>value.code!==company.code));
  const requests=phase==='before-prepare'?[{action:'prepare-collected',intake:true},f.manual()]:phase==='before-approve'?[{action:'approve',jobId:job.id,reviewFingerprint:job.review.fingerprint,confirmPaid:true},{action:'execute',jobId:job.id},{action:'prepare-collected',intake:true},f.manual()]:[{action:'execute',jobId:job.id},{action:'approve',jobId:job.id,reviewFingerprint:job.review.fingerprint,confirmPaid:true},{action:'prepare-collected',intake:true},f.manual()];
  for(const body of requests){const rejected=await json(await f.request(body),409);assert.equal(rejected.code,'COLLECTION_COMPANY_MISMATCH');assert.match(rejected.error,/수집 당시 회사.*현재 로그인 회사/);assert.equal(snapshot(h),before);assertNoProviderCalls(f);}
  const history=await json(await h.route(f.base+'/translation'));assert.equal(history.jobs.length,phase==='before-prepare'?0:1);if(job)assert.equal(history.jobs[0].id,job.id);
  assert.equal(snapshot(h),before,'read-only history remains available without rewriting its context or status');assert.equal(h.objects.size,objects.size);for(const [key,bytes]of objects)assert.deepEqual(Buffer.from(h.objects.get(key)),bytes);
  h.setCompany(company);
  const resumed=await json(await f.request({action:'prepare-collected',intake:true}),phase==='before-prepare'?201:200);if(job){assert.equal(resumed.job.id,job.id);assert.equal(resumed.replayed,true);}
  assertNoProviderCalls(f);
 }finally{h.close();}
});

for(const company of companies)for(const provider of providers)test(`same-company intake translation stays idempotent and preserves captured price, quantity, source and images (${company.code}, ${provider})`,async()=>{
 const f=await companyTranslationFixture(company,provider),{h}=f;
 try{
  const before=sourceSnapshot(h),imageBytes=Buffer.from(h.objects.get(f.imageKey)),initial=payload(h,'product_options');
  const prepared=await json(await f.request({action:'prepare-collected',intake:true}),201),job=prepared.job;
  const duplicate=await json(await f.request({action:'prepare-collected',intake:true}));assert.equal(duplicate.job.id,job.id);assert.equal(duplicate.replayed,true);assertNoProviderCalls(f);
  await json(await approve(f)(job));const completed=await json(await execute(f)(job));assert.equal(completed.job.status,'completed');
  const calls=provider==='workers-ai'?f.modelCalls:f.queries.length;assert.ok(calls>0);if(provider==='workers-ai')assert.equal(f.modelCalls,1);
  const repeated=await json(await execute(f)(job));assert.equal(repeated.job.id,job.id);assert.equal(repeated.replayed,true);assert.equal(provider==='workers-ai'?f.modelCalls:f.queries.length,calls);
  const preview=await json(await h.route(f.base+'/translation-apply',{method:'POST',body:{action:'preview',jobId:job.id,expectedVersion:f.version}}));
  await json(await h.route(f.base+'/translation-apply',{method:'POST',body:{action:'apply',jobId:job.id,expectedVersion:f.version,fingerprint:preview.fingerprint}}));
  const content=payload(h,'product_content'),options=payload(h,'product_options'),fields=await json(await h.route(f.base+'/quotation-fields'));
  assert.equal(content.seo.title.value,'검토 브랜드 수납 바스켓');assert.equal(content.seo.description.value,'수납 바스켓 상품 설명');assert.deepEqual(content.assets.main.value,[f.imageKey]);
  assert.deepEqual(options.rows.map(row=>row.color),['빨강','회색']);assert.deepEqual(options.rows.map(row=>row.size),['대형','12 cm']);
  for(const [index,row]of options.rows.entries())for(const key of ['id','originalName','supplierSku','unitCostCny','minimumOrderQuantity','stock','unitsPerPack','imageKey'])assert.equal(row[key],initial.rows[index][key]);
  for(const row of options.rows){const prices=h.load('app/pricing.ts').calculatePrice(row.unitCostCny,h.load('app/pricing.ts').pricePolicy(h.settings),row.unitsPerPack),values=fields.resolved.rows.find(value=>value.optionId===row.id).fields;for(const key of ['supplyPrice','salePrice','msrp'])assert.equal(values[key].value,String(prices[key]));}
  assert.equal(sourceSnapshot(h),before);assert.deepEqual(Buffer.from(h.objects.get(f.imageKey)),imageBytes);assert.equal(h.objects.size,1);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM translation_jobs').get().n,1);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_receipts').get().n,0);
  assert.ok(h.network.every(host=>host==='translate.googleapis.com'));assert.equal(h.network.length,f.queries.length);assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{h.close();}
});

for(const legacy of ['unrecorded','unlinked'])test(`manual legacy source remains usable without inferring company from a matching URL (${legacy})`,async()=>{
 const f=await companyTranslationFixture(companies[0],'workers-ai',legacy),{h}=f;
 try{
  const before=sourceSnapshot(h),current=companies[1];h.setCompany(current);
  const {job}=await json(await f.request(f.manual()),201);await json(await approve(f)(job));const completed=await json(await execute(f)(job));assert.equal(completed.job.status,'completed');assert.equal(f.modelCalls,1);
  assert.equal(sourceSnapshot(h),before);assert.deepEqual(h.network,[]);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_receipts').get().n,0);
  const context=JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload);
  if(legacy==='unrecorded')assert.equal(Object.hasOwn(context,'company'),false);else{assert.deepEqual(context.company,companies[0]);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM collection_products').get().n,0);}
 }finally{h.close();}
});

test('an invalid current company pair cannot prepare or claim a captured product translation',async()=>{
 const f=await companyTranslationFixture(),{h}=f;
 try{const before=snapshot(h);h.setCompany({code:companies[0].code,name:companies[1].name});const response=await json(await f.request({action:'prepare-collected',intake:true}),409);assert.equal(response.code,'COLLECTION_COMPANY_MISMATCH');assert.equal(snapshot(h),before);assertNoProviderCalls(f);}finally{h.close();}
});

test('a collection link changed between source reads returns the existing 409 conflict without preparing or calling a provider',async()=>{
 const f=await companyTranslationFixture(),{h}=f;
 try{
  const withoutLink=()=>JSON.stringify(Object.fromEntries(tables.filter(table=>table!=='collection_products').map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]))),before=withoutLink(),imageBytes=Buffer.from(h.objects.get(f.imageKey));
  let detached=false;
  h.bindings.DB={...h.db,prepare(sql){const query=h.db.prepare(sql),first=query.first.bind(query);query.first=async()=>{const value=await first();if(!detached&&value&&sql==='SELECT job_id FROM collection_products WHERE product_id=? AND owner_id=?'){
   detached=true;h.sqlite.prepare('DELETE FROM collection_products WHERE product_id=?').run(f.productId);
  }return value;};return query;}};
  const rejected=await json(await f.request({action:'prepare-collected',intake:true}),409);assert.equal(rejected.code,'TRANSLATION_CONFLICT');assert.equal(detached,true);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM collection_products').get().n,0);assert.equal(withoutLink(),before,'only the concurrent actor detaches the link; this request writes nothing');assert.deepEqual(Buffer.from(h.objects.get(f.imageKey)),imageBytes);assertNoProviderCalls(f);
 }finally{h.close();}
});
