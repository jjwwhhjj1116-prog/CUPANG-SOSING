import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};

// Recorded supplier facts and real handlers in private SQLite/R2 fixtures.
// The two observed category forms below test immutable capture/linkage only;
// neither asserts that these sunglasses belong in the basket/floor-mat category.
function request(h,path,{method='GET',body}={}){
 const url=new URL(path,'https://app.test'),parts=url.pathname.split('/');
 const req=new Request(url,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
 if(url.pathname==='/api/collection-jobs')return h.load('app/api/collection-jobs/route.ts')[method](req);
 if(parts[2]==='collection-jobs')return h.load(`app/api/collection-jobs/[id]/${parts[4]}/route.ts`)[method](req,{params:Promise.resolve({id:parts[3]})});
 if(parts[2]==='products'&&parts.length===4)return h.load('app/api/products/[id]/route.ts')[method](req,{params:Promise.resolve({id:parts[3]})});
 if(url.pathname==='/api/settings')return h.load('app/api/settings/route.ts')[method](req);
 return h.route(path,{method,body});
}
async function profile(h,categoryId,name){
 return h.load('db/category-profiles.ts').createCategoryProfile('owner',{name,categoryId,categoryPath:plain(h.load('app/quotation-schema.ts').getQuotationSchema(categoryId).categoryPath),template:null,mappings:[]});
}
async function settings(h,value){
 return (await json(await request(h,'/api/settings',{method:'PUT',body:{...value,expectedOwnerId:'owner'}}))).settings;
}
async function enqueue(h,selected,current,features='새로 검토할 특징'){
 return json(await request(h,'/api/collection-jobs',{method:'POST',body:{urls:[h.sourceUrl+'?spm=retry'],goal:'price',profileId:selected.id,expectedProfileRevision:selected.revision,expectedSettings:current,features,keywords:'새 초안 키워드'}}));
}
function oldRows(h,productId,jobId='job'){
 const one=(table,key,id)=>h.sqlite.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).get(id)??null;
 const all=(table,key,id)=>h.sqlite.prepare(`SELECT * FROM ${table} WHERE ${key}=? ORDER BY rowid`).all(id);
 return JSON.stringify({product:one('products','id',productId),policy:one('product_price_policy','product_id',productId),
  content:one('product_content','product_id',productId),options:one('product_options','product_id',productId),quotation:one('product_quotation_fields','product_id',productId),
  job:one('collection_jobs','id',jobId),context:one('collection_context','job_id',jobId),receipt:one('collection_results','job_id',jobId),
  supplements:all('collection_source_supplements','job_id',jobId),link:one('collection_products','job_id',jobId),images:all('collection_images','job_id',jobId)});
}
async function seedReviewedProduct(h){
 const original=await profile(h,'80719','기존 수집 당시 양식');
 h.context.category=original;h.context.settings=await settings(h,h.settings);
 h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
 await h.intake();
 const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
 let content=(await json(await request(h,base+'/content'))).content;
 await json(await request(h,base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'삭제 전에 직접 검토한 제목',description:''},label:{material:''}}}}));
 let quote=await json(await request(h,base+'/quotation-fields'));
 await json(await request(h,base+'/quotation-fields',{method:'PUT',body:{expectedRevision:quote.revision,expectedInputFingerprint:quote.inputFingerprint,changes:[{optionId:'collected-1',fieldKey:'searchTags',value:''}]}}));
 quote=await json(await request(h,base+'/quotation-fields'));
 const current=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(product.id);
 return {original,product:current,quote};
}

for(const company of companies)test(`deleted URL creates a fresh captured draft while its reviewed product and source remain recoverable (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company);
 try{
  const old=await seedReviewedProduct(h),before=oldRows(h,old.product.id);
  const oldKeys=JSON.parse(old.product.image_keys),oldBytes=oldKeys.map(key=>[key,Buffer.from(h.objects.get(key)).toString('hex')]);
  const removed=await json(await request(h,'/api/products/'+old.product.id,{method:'DELETE',body:{expectedVersion:old.product.updated_at}}));
  assert.equal(oldRows(h,old.product.id),before,'removal must not rewrite the old job, source, policy, manual blank or image links');
  const rejected=await json(await request(h,'/api/collection-jobs/job/product',{method:'POST'}),409);
  assert.ok(rejected.error);assert.equal(rejected.productId,undefined,'an explicit old-job retry cannot reopen a removed draft');

  const selected=await profile(h,'81452','다시 추가할 때 선택한 양식');
  const current=await settings(h,{...h.settings,brand:company.companyName+' 새 브랜드',manufacturer:'새로 저장한 제조원',exchangeRate:420});
  const queued=await enqueue(h,selected,current),next=queued.jobs[0];
  assert.notEqual(next.id,'job');assert.equal(next.offer_id,'813724060928');assert.equal(next.source_url,h.sourceUrl);
  assert.equal(next.status,'awaiting_connector');assert.equal(next.product_id,null);assert.equal(next.received_at,null);
  assert.deepEqual(queued.preservedRequests,[]);assert.equal(next.context.category.id,selected.id);assert.equal(next.context.category.categoryId,'81452');
  assert.equal(next.context.settings.exchangeRate,420);assert.equal(next.context.settings.brand,company.companyName+' 새 브랜드');
  assert.equal(next.context.features,'새로 검토할 특징');assert.equal(next.context.keywords,'새 초안 키워드');
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM collection_results WHERE job_id=?').get(next.id).n,0,'fresh intake requires its own receipt, not a copy of the archived capture');
  for(const response of await Promise.all(Array.from({length:4},()=>enqueue(h,selected,current)))){
   assert.equal(response.jobs[0].id,next.id);assert.deepEqual(response.preservedRequests,[]);
  }
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM collection_jobs WHERE owner_id=? AND offer_id=?').get('owner',next.offer_id).n,2);
  assert.equal(h.sqlite.prepare('SELECT job_id FROM collection_offer_claims WHERE owner_id=? AND offer_id=?').get('owner',next.offer_id).job_id,next.id);

  let collected;
  const message=await h.load('app/intake-collection.ts').collectIntakeProduct(next,{signal:new AbortController().signal,
   fetcher:(path,init)=>request(h,path,{method:init?.method??'GET',body:init?.body}),onJob:value=>{collected=value;},onProgress(){}});
  assert.ok(message);assert.ok(collected?.product_id,message);assert.notEqual(collected.product_id,old.product.id);
  const fresh=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(collected.product_id);
  assert.equal(fresh.options_count,6);assert.equal(JSON.parse(fresh.image_keys).length,19);assert.equal(fresh.source_url,h.sourceUrl);assert.equal(fresh.supplier_hub_status,'미전송');
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM products WHERE owner_id=?').get('owner').n,2);
  assert.equal(JSON.parse(h.sqlite.prepare('SELECT payload FROM product_price_policy WHERE product_id=?').get(fresh.id).payload).exchangeRate,420);
  const freshQuote=await json(await request(h,'/api/products/'+fresh.id+'/quotation-fields'));
  assert.equal(freshQuote.categoryContext.profileId,selected.id);assert.equal(freshQuote.categoryContext.categoryId,'81452');
  assert.equal(freshQuote.resolved.rows.filter(row=>row.optionId).length,6);
  assert.notEqual(freshQuote.resolved.rows[0].fields.title.value,'삭제 전에 직접 검토한 제목');
  const freshSnapshot=oldRows(h,fresh.id,next.id);
  for(const result of await Promise.all(Array.from({length:3},()=>request(h,`/api/collection-jobs/${next.id}/product`,{method:'POST'})))){
   const saved=await json(result);assert.equal(saved.productId,fresh.id);assert.equal(saved.reused,true);
  }
  assert.equal(oldRows(h,fresh.id,next.id),freshSnapshot);assert.equal(oldRows(h,old.product.id),before);
  assert.deepEqual(oldKeys.map(key=>[key,Buffer.from(h.objects.get(key)).toString('hex')]),oldBytes);
  const archiveQuery=await h.load('app/product-archive.ts').parseArchiveQuery(new URLSearchParams({range:'all',limit:'100'}));
  const checkArchive=async()=>{
   const items=(await h.load('db/product-archive.ts').listProductArchive('owner',archiveQuery)).items;
   for(const [id,sourceKind,capture,jobId] of [[old.product.id,'product',old.original,'job'],[fresh.id,'product',selected,next.id],['job','request',old.original,'job'],[next.id,'request',selected,next.id]]){
    const item=items.find(item=>item.id===id&&item.sourceKind===sourceKind);assert.ok(item,`archive ${sourceKind} ${id}`);
    assert.deepEqual(plain(item.category),{id:capture.categoryId,path:plain(capture.categoryPath),source:sourceKind==='request'?'request-snapshot':'matching-request',requestId:jobId},'each historical product/request must retain its exact category and intake job, despite an identical URL');
   }
  };
  await checkArchive();

  await json(await request(h,'/api/products/'+old.product.id,{method:'DELETE',body:{action:'restore',expectedVersion:old.product.updated_at,expectedRemovedAt:removed.removedAt}}));
  assert.equal(oldRows(h,old.product.id),before,'restoring an archived product preserves the exact original clock and all saved edits');
  const source=await h.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',old.product.id,null);
  assert.equal(source.source.collection.snapshot.id,'job');assert.equal(source.categoryContext.profileId,old.original.id);assert.equal(source.categoryContext.categoryId,'80719');
  assert.equal(source.settings.exchangeRate,420,'workspace numeric settings remain current; the saved product policy determines its quotation prices');
  assert.equal(JSON.parse(source.product.pricing_policy).exchangeRate,h.context.settings.exchangeRate);
  for(const field of ['brand','manufacturer','importer','serviceContact'])assert.equal(source.settings[field],h.context.settings[field],`the old captured business fact ${field} remains unchanged`);
  const restored=await json(await request(h,'/api/products/'+old.product.id+'/quotation-fields'));
  const prices=view=>plain(view.resolved.rows.filter(row=>row.optionId).map(row=>({optionId:row.optionId,prices:['supplyPrice','salePrice','msrp'].map(field=>row.fields[field].value)})));
  assert.deepEqual(prices(restored),prices(old.quote),'restoring the old draft retains every SKU price under its original saved policy despite workspace FX420');
  assert.equal(restored.resolved.rows.find(row=>row.optionId==='collected-1').fields.searchTags.value,'');
  assert.equal(restored.resolved.rows[0].fields.title.value,'삭제 전에 직접 검토한 제목');
  assert.equal((await enqueue(h,selected,current)).jobs[0].id,next.id,'restore cannot steal the fresh URL claim from another saved draft');
  await checkArchive();
  const active=await h.load('db/queries.ts').listProducts('owner');assert.deepEqual(active.map(product=>product.id).sort(),[old.product.id,fresh.id].sort());
  assert.ok(!h.network.includes('supplier.coupang.com'),'collection and restoration cannot submit a real quotation');
 }finally{h.close();}
});

test('recollection claims isolate owners and preserve an unrelated owner’s linked product and original pending request',async()=>{
 const h=mobileIntakeHarness();
 try{
  const old=await seedReviewedProduct(h),jobs=h.load('db/collection-jobs.ts'),requests=h.load('app/sourcing.ts').parseCollectionRequest({urls:[h.sourceUrl],goal:'price'});
  const context=plain(h.context),[foreign]=await jobs.enqueueCollection('foreign-owner',requests,context);
  const receipt=await h.load('db/collection-results.ts').readCollectionResult('owner','job');
  await h.load('db/collection-results.ts').storeCollectionResult('foreign-owner',foreign.id,receipt.result);
  const linked=await h.load('db/collection-products.ts').promoteCollection('foreign-owner',foreign,receipt.result);
  const before=oldRows(h,linked.product_id,foreign.id);
  const [pending]=await jobs.enqueueCollection('pending-owner',requests,context);
  assert.equal(await jobs.findCollectionJob('owner',foreign.id),null);
  assert.equal(await h.load('db/collection-products.ts').findCollectionProduct('owner',foreign.id),null);
  await json(await request(h,'/api/products/'+old.product.id,{method:'DELETE',body:{expectedVersion:old.product.updated_at}}));
  const selected=await profile(h,'81452','소유 계정 재추가'),current=await settings(h,h.settings),next=(await enqueue(h,selected,current)).jobs[0];
  assert.notEqual(next.id,'job');assert.notEqual(next.id,foreign.id);assert.notEqual(next.id,pending.id);
  assert.equal((await jobs.enqueueCollection('foreign-owner',requests,{...context,features:'다른 입력'}))[0].id,foreign.id);
  assert.equal((await jobs.enqueueCollection('pending-owner',requests,{...context,features:'다른 입력'}))[0].id,pending.id);
  assert.equal(oldRows(h,linked.product_id,foreign.id),before);
  assert.equal(h.sqlite.prepare('SELECT job_id FROM collection_offer_claims WHERE owner_id=? AND offer_id=?').get('foreign-owner',foreign.offer_id).job_id,foreign.id);
  assert.equal(h.sqlite.prepare('SELECT job_id FROM collection_offer_claims WHERE owner_id=? AND offer_id=?').get('pending-owner',pending.offer_id).job_id,pending.id);
  assert.equal((await jobs.findCollectionJob('pending-owner',pending.id)).context.features,context.features);
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM products WHERE owner_id=?').get('foreign-owner').n,1);
 }finally{h.close();}
});

test('an undeleted captured draft keeps its URL claim and manual context despite a later category/settings request',async()=>{
 const h=mobileIntakeHarness();
 try{
  const old=await seedReviewedProduct(h),before=oldRows(h,old.product.id),selected=await profile(h,'81452','재선택한 다른 양식');
  const current=await settings(h,{...h.settings,brand:'나중 기본설정',exchangeRate:420});
  const result=await enqueue(h,selected,current);
  assert.equal(result.jobs[0].id,'job');assert.equal(result.jobs[0].product_id,old.product.id);assert.equal(result.jobs[0].context.category.id,old.original.id);
  assert.equal(result.jobs[0].context.settings.brand,h.context.settings.brand);assert.equal(result.jobs[0].context.settings.exchangeRate,h.context.settings.exchangeRate);
  assert.ok(result.preservedRequests[0].differences.includes('카테고리·견적서 설정'));assert.ok(result.preservedRequests[0].differences.includes('기본설정'));
  assert.equal(oldRows(h,old.product.id),before);assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM products').get().n,1);
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM collection_jobs WHERE owner_id=? AND offer_id=?').get('owner','813724060928').n,1);
 }finally{h.close();}
});
