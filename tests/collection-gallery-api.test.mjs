import test from 'node:test';
import assert from 'node:assert/strict';
import {optionImageApiHarness,optionImageSourceUrl,json,plain} from './helpers/alibaba-option-image-fallback.mjs';
import {schemaCompanies} from './helpers/hub-schema.mjs';
const product=h=>h.sqlite.prepare('SELECT * FROM products').get();
const content=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
const options=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
const links=h=>new Map(h.sqlite.prepare('SELECT image_index,object_key FROM collection_images ORDER BY image_index').all().map(row=>[row.image_index,row.object_key]));

for(const company of schemaCompanies)for(const legacy of [false,true])test(company.name+': '+(legacy?'unmarked legacy receipt':'new gallery marker')+' keeps serial image assignment, SKU binding and replay separate',async()=>{
 const h=optionImageApiHarness(company);try{
  const receipt=plain(h.load('app/alibaba-product-result.ts').parseAlibabaProduct(h.payload,optionImageSourceUrl));if(legacy)delete receipt.sourceGallery;
  const {offerId,...body}=receipt;await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body}));
  const immutable=h.sqlite.prepare('SELECT * FROM collection_results').get(),fetcher=(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body});
  const result=await h.load('app/collection-import.ts').runCollectionImport('job',receipt.images.length,{fetcher,retryAttempts:1,assignToStage:true});
  assert.equal(result.status,'completed');assert.deepEqual(plain(result.warnings??[]),[]);const keys=links(h);
  assert.deepEqual(content(h).assets.additional.value,(legacy?[1,2,3]:[1]).map(index=>keys.get(index)));
  assert.deepEqual(options(h).rows.map(row=>row.imageKey),[0,1,3].map(index=>keys.get(index)));assert.equal(h.objects.size,5);
  const reused=await json(await h.route('/api/collection-jobs/job/images',{method:'POST',body:{index:3}}));assert.equal(reused.reused,true);assert.deepEqual(reused.warnings,[]);
  const base='/api/products/'+product(h).id,quote=await json(await h.route(base+'/quotation-fields'));
  for(const row of quote.resolved.rows)assert.equal(row.fields.additionalImages.value,content(h).assets.additional.value.join('\n'));
  // An explicit user selection may use a variant source in Stage4. Automatic
  // replay must preserve that decision, along with a manual option-image blank.
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content(h).revision,patch:{assets:{additional:[keys.get(2)]}}}}));
  const current=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(current.options);rows[2].imageKey=null;
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:current.options.revision,expectedProductVersion:current.productVersion,rows}}));
  const reviewed=JSON.stringify({product:product(h),content:content(h),options:options(h)}),requests=h.network.length;
  const repeated=await json(await h.route('/api/collection-jobs/job/images',{method:'POST',body:{index:3}}));
  assert.equal(repeated.warnings.some(value=>/추가 이미지 배치/.test(value)),legacy);assert.equal(repeated.warnings.filter(value=>/원문 옵션 1개/.test(value)).length,1);
  await json(await h.route('/api/collection-jobs/job/image-draft',{method:'POST',body:{productId:product(h).id}}));
  assert.equal(JSON.stringify({product:product(h),content:content(h),options:options(h)}),reviewed);
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body}));assert.deepEqual(h.sqlite.prepare('SELECT * FROM collection_results').get(),immutable);
  assert.equal(h.network.length,requests);assert.equal(h.objects.size,5);assert.equal(product(h).supplier_hub_status,'미전송');assert.equal(offerId,receipt.offerId);
 }finally{h.close();}
});
