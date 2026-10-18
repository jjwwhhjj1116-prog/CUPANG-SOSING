import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {schemaCompanies,hubSchemaSnapshot,schemaPath} from './helpers/hub-schema.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const read=name=>fs.readFileSync(new URL('fixtures/'+name,import.meta.url),'utf8');
const sourceUrl='https://detail.1688.com/offer/628000000001.html';
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
function sources(single=false){
 const mobile=JSON.parse(read('1688-mobile-813724060928.json').replaceAll('813724060928','628000000001')),sku=JSON.parse(read('1688-skus-813724060928.json').replaceAll('813724060928','628000000001'));
 if(single){const data=sku.data.result.data;data.skuModel.skuProps=[];data.skuModel.skuInfoMap={'':{skuId:'628000000010',specAttrs:'',price:'12.5',canBookCount:0}};data.orderParamModel.orderParam.beginNum=3;data.orderParamModel.orderParam.skuParam.skuPriceType='skuPrice';}
 return{mobile,sku,html:'<script>window.__INIT_DATA='+JSON.stringify(mobile)+';</script>',detail:read('1688-description-813724060928.txt')};
}
async function fixture(company,single=false){
 const original=sources(single),calls=[];let status=503;
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,sourceFetcher:async(target,init)=>{
  const url=new URL(target);calls.push({host:url.hostname,signal:init?.signal});
  if(url.hostname==='detail.1688.com')return new Response('<html>Local fixture without PC metadata</html>',{headers:{'content-type':'text/html'}});
  if(url.hostname==='m.1688.com')return new Response(original.html,{headers:{'content-type':'text/html'}});
  if(url.hostname==='h5api.m.1688.com')return Response.json(original.sku);
  if(url.hostname==='itemcdn.tmall.com')return new Response(status===200?original.detail:'temporary optional detail outage',{status});
  throw Error('Unexpected local fixture source');
 }});
 const snapshot=hubSchemaSnapshot(company),raw=JSON.parse(snapshot.schemaString);
 raw.properties.imagePage.properties.images={type:'object',properties:{mainImage:{type:'string',title:'대표 이미지'},additionalImage:{type:'string',title:'추가 이미지'}}};
 raw.properties.imagePage.properties.details={type:'object',required:['detailedImage'],properties:{detailedImage:{type:'string',title:'상세 이미지',minLength:1},htmlProductDetailContent:{type:'string',title:'HTML 상세 내용'}}};
 const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'Local fixture category',categoryId:'991234',categoryPath:schemaPath,hubSchema:{...snapshot,schemaString:JSON.stringify(raw),draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1',settingsInitialization:'couplus-options-v1'},template:null,mappings:[]});
 const queued=await json(await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:[sourceUrl],goal:'work',profileId:profile.id,expectedProfileRevision:profile.revision})})));
 const job=queued.jobs[0],base='/api/collection-jobs/'+job.id;
 const fetcher=(path,init={})=>h.route(path,{method:init.method??'GET',body:init.body});
 return{h,original,calls,job,base,fetcher,status(value){status=value;},close(){h.close();}};
}

for(const company of schemaCompanies)for(const single of [false,true])test(`optional detail 503 preserves the exact ${single?'single':'six'} SKU source and opens a reviewable work draft (${company.code})`,async()=>{
 const f=await fixture(company,single),{h,job,base}=f;try{
  const known=h.load('app/alibaba-mobile-product.ts').parseAlibabaMobileProduct(h.load('app/alibaba-mobile-product.ts').parseAlibabaMobilePage(f.original.html,sourceUrl),f.original.sku);
  const collected=await json(await h.route(base+'/collect',{method:'POST'}));assert.equal(collected.receipt.result.provider,'1688-public-mobile-partial-v1');assert.deepEqual(plain(collected.receipt.result.options),plain(known.options));assert.deepEqual(plain(collected.receipt.result.images),plain(known.images));assert.deepEqual(plain(collected.receipt.result.attributes),plain(known.attributes));
  let captures=0;const updates=[],intake=()=>h.load('app/intake-collection.ts').collectIntakeProduct(job,{signal:new AbortController().signal,fetcher:f.fetcher,onJob:value=>updates.push(value),onProgress(){},captureFromBrowser:async()=>{captures++;throw Error('A confirmed partial source must not be automatically captured again');}});
  const message=await intake();assert.match(message,/초안|검토/);assert.equal(captures,0);const product=h.sqlite.prepare('SELECT * FROM products WHERE source_url=?').get(sourceUrl);assert.ok(product);assert.ok(updates.some(value=>value.product_id===product.id));assert.equal(product.supplier_hub_status,'미전송');assert.equal(product.image_status,'대기');
  const options=await json(await h.route('/api/products/'+product.id+'/options'));assert.deepEqual(options.options.rows.map(row=>[row.supplierSku,row.unitCostCny,row.minimumOrderQuantity,row.stock]),plain(known.options.map(row=>[row.sku,row.unitPriceCny,row.minimumOrder,row.stock])));
  const view=await json(await h.route('/api/products/'+product.id+'/quotation-fields')),detail=view.resolved.schema.fields.find(field=>field.hubInput==='detailImages');assert.ok(detail);assert.ok(view.resolved.rows.every(row=>row.fields[detail.id].value===''&&row.fields[detail.id].validationIssues?.length));
  assert.match(h.load('app/collection-result.ts').collectionSourceWarnings(collected.receipt.result).join(' '),/상세 설명.*상세 이미지/);
  const before=JSON.stringify({product:h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(product.id),content:h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(product.id),options:h.sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(product.id)}),requests=f.calls.length;
  await intake();assert.equal(captures,0);assert.equal(f.calls.length,requests);assert.equal(JSON.stringify({product:h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(product.id),content:h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(product.id),options:h.sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(product.id)}),before);
 }finally{f.close();}
});

for(const company of schemaCompanies)test(`Chrome partial capture stores the validated source once and leaves missing details incomplete (${company.code})`,async()=>{
 const f=await fixture(company),{h,job,base}=f;try{
  const capture=await h.load('app/alibaba-mobile-collector.ts').collectAlibabaMobileCapture(sourceUrl,{signal:new AbortController().signal});
  assert.equal(capture.format,'1688-public-mobile-partial-capture-v1');assert.equal(capture.detailSource,'');assert.deepEqual(plain(capture.detailUnavailable),{status:503});assert.equal(capture.mobileHtml,f.original.html);assert.deepEqual(plain(capture.skuPayload),f.original.sku);
  const stored=await json(await h.route(base+'/browser-capture',{method:'POST',body:capture}));assert.equal(stored.receipt.result.provider,'chrome-public-mobile-partial-v1');assert.equal(stored.receipt.result.options.length,6);assert.equal(stored.receipt.result.images.length,8);assert.equal(stored.receipt.result.attributes.length,24);
  const requests=f.calls.length;let captures=0;await h.load('app/intake-collection.ts').collectIntakeProduct(job,{signal:new AbortController().signal,fetcher:f.fetcher,onJob(){},onProgress(){},captureFromBrowser:async()=>{captures++;assert.fail('Partial Chrome capture must not repeat itself');}});
  assert.equal(captures,0);assert.equal(f.calls.length,requests);const product=h.sqlite.prepare('SELECT * FROM products WHERE source_url=?').get(sourceUrl);assert.ok(product);assert.equal(product.supplier_hub_status,'미전송');assert.equal(product.image_status,'대기');
  const content=await json(await h.route('/api/products/'+product.id+'/content'));assert.equal(content.content.assets.detail.value.length,0);assert.ok(content.content.assets.main.value.length);assert.ok(content.content.assets.additional.value.length);
 }finally{f.close();}
});

test('only transient optional-detail HTTP statuses produce a partial capture; full and invalid source contracts remain distinct',async()=>{
 const f=await fixture(schemaCompanies[0]),{h}=f;try{
  const collector=h.load('app/alibaba-mobile-collector.ts'),parse=h.load('app/browser-product-capture.ts').parseBrowserProductCapture;
  for(const status of [502,503,504]){f.status(status);const raw=await collector.collectAlibabaMobileCapture(sourceUrl,{signal:new AbortController().signal});assert.equal(raw.format,'1688-public-mobile-partial-capture-v1');assert.equal(raw.detailUnavailable.status,status);assert.equal(parse(raw,sourceUrl).provider,'chrome-public-mobile-partial-v1');}
  f.status(200);const full=await collector.collectAlibabaMobileCapture(sourceUrl,{signal:new AbortController().signal});assert.equal(full.format,'1688-public-mobile-capture-v1');assert.equal('detailUnavailable' in full,false);assert.ok(parse(full,sourceUrl).images.some(image=>image.role==='detail'));
  for(const status of [401,403,404,429,500]){f.status(status);await assert.rejects(collector.collectAlibabaMobileCapture(sourceUrl,{signal:new AbortController().signal}));}
 }finally{f.close();}
});

test('fake partial evidence cannot store a receipt, bypass full detail validation or change source facts',async()=>{
 const f=await fixture(schemaCompanies[0]),{h,base}=f;try{
  const raw=await h.load('app/alibaba-mobile-collector.ts').collectAlibabaMobileCapture(sourceUrl,{signal:new AbortController().signal}),before=JSON.stringify(h.sqlite.prepare('SELECT * FROM collection_results').all());
  for(const corrupt of [value=>delete value.detailUnavailable,value=>{value.detailUnavailable={status:200};},value=>{value.detailUnavailable={status:401};},value=>{value.detailUnavailable={status:'503'};},value=>{value.detailUnavailable={status:503,url:'invented'};},value=>{value.detailUnavailable=[];},value=>{value.detailSource=f.original.detail;},value=>{value.format='1688-public-mobile-capture-v1';delete value.detailUnavailable;},value=>{const page=structuredClone(f.original.mobile);delete page.globalData.detailModel;value.mobileHtml='<script>window.__INIT_DATA='+JSON.stringify(page)+';</script>';},value=>{value.mobileHtml='x'.repeat(2*1024*1024+1);},value=>{value.sourceUrl='https://detail.1688.com/offer/628000000002.html';},value=>{value.skuPayload.data.result.data.offerBaseInfo.offerId=628000000002;},value=>{value.skuPayload.data.result.data.skuModel.isPricePrivate=true;},value=>{const info=value.skuPayload.data.result.data.skuModel.skuInfoMap;Object.values(info)[0].price='invented';}]){
   const changed=structuredClone(plain(raw));corrupt(changed);const response=await h.route(base+'/browser-capture',{method:'POST',body:changed});assert.equal(response.status,422,await response.clone().text());assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM collection_results').all()),before);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM products').get().n,0);
  }
 }finally{f.close();}
});

test('malformed or oversized successful detail bodies and cancellation cannot be reclassified as transient partial sources',async()=>{
 const f=await fixture(schemaCompanies[0]),{h}=f;try{
  const collector=h.load('app/alibaba-mobile-collector.ts');
  const fetcher=(detail,signal)=>async target=>{const url=new URL(target);if(url.hostname==='m.1688.com')return new Response(f.original.html,{headers:{'content-type':'text/html'}});if(url.hostname==='h5api.m.1688.com')return Response.json(f.original.sku);assert.equal(url.hostname,'itemcdn.tmall.com');if(signal)signal.abort();return detail();};
  for(const body of ['malformed callback without an inert detail object','x'.repeat(2*1024*1024+1)])await assert.rejects(collector.collectAlibabaMobileCapture(sourceUrl,{signal:new AbortController().signal,fetcher:fetcher(()=>new Response(body))}));
  const controller=new AbortController();await assert.rejects(collector.collectAlibabaMobileCapture(sourceUrl,{signal:controller.signal,fetcher:fetcher(()=>new Response('temporary detail error',{status:503}),controller)}),/취소/);
  controller.abort();let called=false;await assert.rejects(collector.collectAlibabaMobileCapture(sourceUrl,{signal:controller.signal,fetcher:async()=>{called=true;assert.fail('Cancelled capture must not fetch');}}));assert.equal(called,false);
 }finally{f.close();}
});

for(const company of schemaCompanies)test(`explicit full-source repair enriches a partial draft while retaining original prices and manual edits (${company.code})`,async()=>{
 const f=await fixture(company),{h,job,base}=f;try{
  await json(await h.route(base+'/collect',{method:'POST'}));await h.intake(job.id);let product=h.sqlite.prepare('SELECT * FROM products WHERE source_url=?').get(sourceUrl);const pbase='/api/products/'+product.id;
  const rawBefore=h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get(job.id).payload,receipt=JSON.parse(rawBefore);
  let content=await json(await h.route(pbase+'/content'));await json(await h.route(pbase+'/content',{method:'PATCH',body:{expectedRevision:content.content.revision,patch:{seo:{title:'직접 검토한 상품명'},detail:{description:'직접 작성한 상세 설명'},label:{material:''},labelClears:['material'],assets:{detail:[]}}}}));
  let options=await json(await h.route(pbase+'/options')),rows=h.load('app/product-options.ts').optionInputs(options.options);rows[0].translatedName='직접 지정한 옵션';rows[0].unitCostCny=9.25;rows[0].imageKey=null;rows[0].included=false;rows[1].translatedName='직접 검토한 포함 옵션';
  await json(await h.route(pbase+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
  // This ordinary content edit is not an explicit SEO-document save. The
  // quotation fallback therefore uses the saved base title + saved korName.
  // An independently edited quotation title must remain above that fallback.
  const quotationBefore=await json(await h.route(pbase+'/quotation-fields'));
  const quotationSaved=await json(await h.route(pbase+'/quotation-fields',{method:'PUT',body:{expectedRevision:quotationBefore.revision,expectedInputFingerprint:quotationBefore.inputFingerprint,
   changes:[{fieldKey:'title',optionId:rows[2].id,value:'견적서에서 직접 지정한 상품명'}]}}));
  const titleBefore=quotationSaved.automatic.rows.map(row=>[row.optionId,row.fields.title.value]);
  assert.equal(quotationSaved.automatic.rows.find(row=>row.optionId===rows[1].id).fields.title.value,'직접 검토한 상품명, 직접 검토한 포함 옵션');
  assert.equal(quotationSaved.resolved.rows.find(row=>row.optionId===rows[2].id).fields.title.value,'견적서에서 직접 지정한 상품명');
  product=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(product.id);
  f.status(200);const modelCalls=h.aiSources.length;let captures=0;
  const repaired=await h.load('app/collection-supplement-client.ts').completeCollectionSupplement({jobId:job.id,offerId:job.offer_id,sourceUrl,productId:product.id,productVersion:product.updated_at,provider:'1688-public-mobile-partial-v1'},{fetcher:f.fetcher,signal:new AbortController().signal,onProgress(){},captureFromBrowser:async()=>{captures++;return h.load('app/alibaba-mobile-collector.ts').collectAlibabaMobileCapture(sourceUrl,{signal:new AbortController().signal});}});
  assert.match(repaired,/보완/);assert.equal(captures,1);assert.equal(h.aiSources.length,modelCalls,'source repair must not generate new SEO or overwrite reviewed options');assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get(job.id).payload,rawBefore,'first receipt remains immutable');
  const effective=await json(await h.route(base+'/result'));assert.equal(effective.receipt.result.provider,'chrome-public-mobile-supplement-v1');assert.deepEqual(effective.receipt.result.options,receipt.options);assert.ok(effective.receipt.result.images.some(image=>image.role==='detail'));
  content=await json(await h.route(pbase+'/content'));assert.equal(content.content.seo.title.value,'직접 검토한 상품명');assert.equal(content.content.seo.title.provenance,'manual');assert.equal(content.content.detail.description.value,'직접 작성한 상세 설명');assert.equal(content.content.label.material.value,'');assert.equal(content.content.label.material.provenance,'manual');assert.deepEqual(content.content.assets.detail.value,[]);
  options=await json(await h.route(pbase+'/options'));assert.equal(options.options.rows[0].translatedName,'직접 지정한 옵션');assert.equal(options.options.rows[1].translatedName,'직접 검토한 포함 옵션');assert.equal(options.options.rows[1].provenance.translatedName,'manual');assert.equal(options.options.rows[0].unitCostCny,9.25);assert.equal(options.options.rows[0].imageKey,null);assert.equal(options.options.rows[0].included,false);assert.equal(options.options.rows[0].supplierSku,receipt.options[0].sku);
  const quote=await json(await h.route(pbase+'/quotation-fields'));
  assert.deepEqual(quote.automatic.rows.map(row=>[row.optionId,row.fields.title.value]),titleBefore,'source repair cannot replace either included or excluded option titles');
  assert.equal(quote.resolved.rows.find(row=>row.optionId===rows[1].id).fields.title.value,'직접 검토한 상품명, 직접 검토한 포함 옵션');
  assert.equal(quote.resolved.rows.find(row=>row.optionId===rows[2].id).fields.title.value,'견적서에서 직접 지정한 상품명');
  assert.equal(quote.resolved.rows.find(row=>row.optionId===rows[2].id).fields.title.source,'manual-option');
  assert.deepEqual(quote.overrides,quotationSaved.overrides,'source repair cannot rewrite manual quotation values');
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(product.id).supplier_hub_status,'미전송');
 }finally{f.close();}
});
