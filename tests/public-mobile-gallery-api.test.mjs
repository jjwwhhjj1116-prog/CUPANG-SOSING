import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileImageApiHarness,mobileImageSourceUrl,json,plain} from './helpers/mobile-option-image-fallback.mjs';
import {schemaCompanies} from './helpers/hub-schema.mjs';

const product=h=>h.sqlite.prepare('SELECT * FROM products').get();
const content=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
const options=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);

for(const company of schemaCompanies)for(const partial of [false,true])test(`${company.name}: ${partial?'partial':'full'} public receipt serial import retains gallery, variant library, manual review and immutable source`,async()=>{
 const h=mobileImageApiHarness(company);
 try{
  const body={...h.fixture.capture,...(partial?{format:'1688-public-mobile-partial-capture-v1',detailSource:'',detailUnavailable:{status:503}}:{})};
  await json(await h.route('/api/collection-jobs/job/browser-capture',{method:'POST',body}));
  const receipt=(await json(await h.route('/api/collection-jobs/job/result'))).receipt.result,immutable=h.sqlite.prepare('SELECT * FROM collection_results').get();
  assert.equal(receipt.sourceUrl,mobileImageSourceUrl);assert.deepEqual(receipt.sourceGallery,{format:'1688-public-mobile-gallery-v1',imageIndices:[0,1]});
  const fetcher=(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body});
  const imported=await h.load('app/collection-import.ts').runCollectionImport('job',receipt.images.length,{fetcher,retryAttempts:1,assignToStage:true});
  assert.equal(imported.status,'completed');assert.deepEqual(plain(imported.warnings??[]),[]);
  const keys=new Map(h.sqlite.prepare('SELECT image_index,object_key FROM collection_images ORDER BY image_index').all().map(row=>[row.image_index,row.object_key]));
  assert.deepEqual(content(h).assets.additional.value,[keys.get(1)]);assert.deepEqual(options(h).rows.map(row=>row.imageKey),[0,1,2].map(index=>keys.get(index)));
  assert.ok(h.objects.has(keys.get(3)));assert.equal(h.objects.size,partial?4:5);assert.equal(content(h).assets.detail.value.length,partial?0:1);
  const reused=await json(await h.route('/api/collection-jobs/job/images',{method:'POST',body:{index:3}}));assert.equal(reused.reused,true);assert.deepEqual(reused.warnings,[]);
  const base='/api/products/'+product(h).id,quote=await json(await h.route(base+'/quotation-fields'));
  assert.equal(quote.categoryContext.categoryId,'80719');for(const row of quote.resolved.rows)assert.equal(row.fields.additionalImages.value,keys.get(1));
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content(h).revision,patch:{assets:{additional:[keys.get(3)],detail:[]}}}}));
  const state=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(state.options);rows[2].imageKey=null;
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:state.options.revision,expectedProductVersion:state.productVersion,rows}}));
  const snapshot=JSON.stringify({product:product(h),content:content(h),options:options(h)}),network=h.network.length;
  await json(await h.route('/api/collection-jobs/job/images',{method:'POST',body:{index:2}}));
  await json(await h.route('/api/collection-jobs/job/image-draft',{method:'POST',body:{productId:product(h).id}}));
  await json(await h.route('/api/collection-jobs/job/browser-capture',{method:'POST',body}));
  assert.equal(JSON.stringify({product:product(h),content:content(h),options:options(h)}),snapshot);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM collection_results').get(),immutable);assert.equal(h.network.length,network);assert.deepEqual(h.sources,[]);
  assert.equal(product(h).supplier_hub_status,'미전송');assert.equal(h.aiSources.length,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
 }finally{h.close();}
});
