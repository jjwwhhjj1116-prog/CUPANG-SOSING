import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const requests=h=>h.load('app/sourcing.ts').parseCollectionRequest({urls:[h.sourceUrl+'?source=retry'],goal:'price'});

// Actual handlers/transactions and private SQLite/R2 fixtures only. The fixture
// category is synthetic; no real company product or Supplier Hub is modified.
function currentCompanyRoutes(h,company){
 function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,Request,Response,TextEncoder,Uint8Array,Date,process:{env:{NODE_ENV:'production'}},require(name){
  if(name==='@/app/chatgpt-auth')return {getWorkspaceOwnerId:async()=>'owner',getChatGPTUser:async()=>({verifiedAccess:true,userId:'owner',membership:{id:'owner',email:'private-company-fixture@example.test',role:'admin',status:'approved',companyCode:company.code,companyName:company.name}})};
  if(name==='cloudflare:workers')return {env:h.bindings};if(name==='next/server')return {NextResponse:Response};assert.ok(name.startsWith('@/'),name);return h.load(name.slice(2)+'.ts');
 }});return exports;}
 const jobs=load('app/api/collection-jobs/route.ts'),fields=load('app/api/products/[id]/quotation-fields/route.ts');
 return {enqueue(profile,settings,features='현재 회사 새 초안'){return jobs.POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:[h.sourceUrl],goal:'price',profileId:profile.id,expectedProfileRevision:profile.revision,features,keywords:'현재 회사',expectedSettings:settings})}));},
  quote(id){return fields.GET(new Request('https://app.test/api/products/'+id+'/quotation-fields'),{params:Promise.resolve({id})});}};
}
async function profile(h,company,name='회사별 수집 시험'){
 const hubSchema={...hubSchemaSnapshot(company),draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1',settingsInitialization:'couplus-options-v1'};
 return h.load('db/category-profiles.ts').createCategoryProfile('owner',{name,categoryId:hubSchema.categoryId,categoryPath:schemaPath,hubSchema,template:null,mappings:[]});
}
function oldSnapshot(h,productId,jobId='job'){
 const one=(table,key,id)=>h.sqlite.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).get(id)??null;
 const all=(table,key,id)=>h.sqlite.prepare(`SELECT * FROM ${table} WHERE ${key}=? ORDER BY rowid`).all(id);
 return JSON.stringify({product:one('products','id',productId),policy:one('product_price_policy','product_id',productId),content:one('product_content','product_id',productId),options:one('product_options','product_id',productId),quotation:one('product_quotation_fields','product_id',productId),
  job:one('collection_jobs','id',jobId),context:one('collection_context','job_id',jobId),receipt:one('collection_results','job_id',jobId),supplements:all('collection_source_supplements','job_id',jobId),images:all('collection_images','job_id',jobId),link:one('collection_products','job_id',jobId),removal:one('product_removals','product_id',productId)});
}
async function historical(company=schemaCompanies[0]){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  await json(await h.load('app/api/settings/route.ts').PUT(new Request('https://app.test/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...h.settings,expectedOwnerId:'owner'})})));
  const original=await profile(h,company,'이전 회사 저장 당시 양식');h.context.category=original;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get();assert.ok(product);
  const quote=await json(await h.route('/api/products/'+product.id+'/quotation-fields'));
  await json(await h.route('/api/products/'+product.id+'/quotation-fields',{method:'PUT',body:{expectedRevision:quote.revision,expectedInputFingerprint:quote.inputFingerprint,changes:[{optionId:null,fieldKey:'title',value:'원래 회사 직접 수정 제목'},{optionId:'collected-1',fieldKey:'searchTags',value:''}]}}));
  return {h,company,original,product:h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(product.id)};
 }catch(error){h.close();throw error;}
}

for(const oldCompany of schemaCompanies)test(`different known linked company releases only disposable claim and captures the new form (${oldCompany.code})`,async()=>{
 const f=await historical(oldCompany),{h}=f;try{
  const current=schemaCompanies.find(company=>company.code!==oldCompany.code),selected=await profile(h,current,'새 회사 양식'),api=currentCompanyRoutes(h,current),jobs=h.load('db/collection-jobs.ts');
  await jobs.enqueueCollection('owner',requests(h),h.context);assert.equal(h.sqlite.prepare('SELECT job_id FROM collection_offer_claims WHERE owner_id=? AND offer_id=?').get('owner','813724060928').job_id,'job');
  const before=oldSnapshot(h,f.product.id),bytes=JSON.parse(f.product.image_keys).map(key=>[key,Buffer.from(h.objects.get(key)).toString('hex')]);
  const response=await json(await api.enqueue(selected,h.settings)),next=response.jobs[0];assert.notEqual(next.id,'job');assert.equal(next.product_id,null);assert.equal(next.received_at,null);assert.deepEqual(response.preservedRequests,[]);
  assert.deepEqual(next.context.category.hubSchema.company,current);assert.equal(next.context.category.id,selected.id);assert.equal(next.context.features,'현재 회사 새 초안');assert.equal(next.context.settings.importer,h.settings.importer,'claim selection must not invent or relabel the explicitly supplied settings');
  assert.equal(oldSnapshot(h,f.product.id),before);assert.deepEqual(JSON.parse(f.product.image_keys).map(key=>[key,Buffer.from(h.objects.get(key)).toString('hex')]),bytes);assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM product_removals').get().n,0);
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM collection_results WHERE job_id=?').get(next.id).n,0);assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM products').get().n,1);
  for(const retry of await Promise.all(Array.from({length:5},()=>api.enqueue(selected,h.settings))))assert.equal((await json(retry)).jobs[0].id,next.id);
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM collection_jobs WHERE owner_id=? AND offer_id=?').get('owner','813724060928').n,2);assert.equal(h.sqlite.prepare('SELECT job_id FROM collection_offer_claims WHERE owner_id=? AND offer_id=?').get('owner','813724060928').job_id,next.id);
  const captured=await h.load('db/quotation-fields.ts').readQuotationCollectionSource('owner','813724060928',f.product.id);assert.equal(captured.id,'job');assert.deepEqual(JSON.parse(captured.payload).category.hubSchema.company,oldCompany);assert.equal(captured.linked,true);
  const oldQuote=await json(await h.route('/api/products/'+f.product.id+'/quotation-fields'));assert.equal(oldQuote.resolved.rows[0].fields.title.value,'원래 회사 직접 수정 제목');assert.equal(oldQuote.resolved.rows.find(row=>row.optionId==='collected-1').fields.searchTags.value,'');
  assert.equal((await json(await api.quote(f.product.id),409)).code,'QUOTATION_COMPANY_MISMATCH');
  const source=await h.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',f.product.id,null);assert.equal(source.source.collection.snapshot.id,'job');assert.deepEqual(plain(source.hubSchema.company),oldCompany);
  // Fixture facts are explicitly supplied to this new job's own receipt; enqueue
  // never copied a historical result or promoted the previous product.
  const receipt=await h.load('db/collection-results.ts').readCollectionResult('owner','job');await h.load('db/collection-results.ts').storeCollectionResult('owner',next.id,receipt.result);
  const fresh=await h.load('db/collection-products.ts').promoteCollection('owner',next,receipt.result);assert.notEqual(fresh.product_id,f.product.id);
  const freshQuote=await json(await api.quote(fresh.product_id));assert.equal(freshQuote.categoryContext.profileId,selected.id);assert.equal(freshQuote.resolved.rows.filter(row=>row.optionId).length,6);assert.notEqual(freshQuote.resolved.rows[0].fields.title.value,'원래 회사 직접 수정 제목');
  assert.equal(oldSnapshot(h,f.product.id),before);assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM products').get().n,2);assert.equal((await json(await api.enqueue(selected,h.settings))).jobs[0].id,next.id);assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});

test('legacy backfill cannot resurrect the mismatched linked job after a lost new-claim acknowledgement',async()=>{
 const f=await historical(),{h}=f;try{
  const selected=await profile(h,schemaCompanies[1]),context={...plain(h.context),category:selected,features:'현재회사 새 입력'},jobs=h.load('db/collection-jobs.ts'),before=oldSnapshot(h,f.product.id);
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM collection_offer_claims').get().n,0,'exercise legacy history without a claim');
  let next;await assert.rejects(async()=>{[next]=await jobs.enqueueCollection('owner',requests(h),context);throw Error('committed response lost');},/response lost/);
  assert.notEqual(next.id,'job');assert.equal((await jobs.enqueueCollection('owner',requests(h),context))[0].id,next.id);assert.equal(oldSnapshot(h,f.product.id),before);
  h.sqlite.prepare('DELETE FROM collection_offer_claims WHERE owner_id=? AND offer_id=?').run('owner','813724060928');
  const recovered=(await jobs.enqueueCollection('owner',requests(h),context))[0];assert.equal(recovered.id,next.id);assert.equal(recovered.context.features,'현재회사 새 입력');assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM collection_jobs WHERE owner_id=? AND offer_id=?').get('owner','813724060928').n,2);
  assert.equal(oldSnapshot(h,f.product.id),before);
 }finally{h.close();}
});

test('same-company category and settings changes retain the original linked product and first form',async()=>{
 const f=await historical(),{h}=f;try{
  const selected=await profile(h,f.company,'같은 회사 나중 선택 양식'),jobs=h.load('db/collection-jobs.ts'),before=oldSnapshot(h,f.product.id),changed={...plain(h.context),category:selected,settings:{...h.context.settings,brand:'나중 브랜드',exchangeRate:420},features:'나중 특징'};
  for(const result of await Promise.all(Array.from({length:4},()=>jobs.enqueueCollection('owner',requests(h),changed)))){assert.equal(result[0].id,'job');assert.equal(result[0].context.category.id,f.original.id);assert.equal(result[0].context.features,h.context.features);}
  assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM collection_jobs WHERE owner_id=? AND offer_id=?').get('owner','813724060928').n,1);assert.equal(oldSnapshot(h,f.product.id),before);
 }finally{h.close();}
});

test('unknown or malformed old captured company does not release its owned linked product claim',async()=>{
 const f=await historical(),{h}=f;try{
  const selected=await profile(h,schemaCompanies[1]),jobs=h.load('db/collection-jobs.ts'),context={...plain(h.context),category:selected};await jobs.enqueueCollection('owner',requests(h),h.context);
  for(const company of [null,{},'A01464742',{code:'A01464742',name:'유앤채'},{code:'unknown',name:'와이홉'},{code:1464742,name:'와이홉'}]){
   const original=plain(h.context);original.category.hubSchema.company=company;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(original),'job');const before=oldSnapshot(h,f.product.id);
   const [retained]=await jobs.enqueueCollection('owner',requests(h),context);assert.equal(retained.id,'job');assert.equal(oldSnapshot(h,f.product.id),before);assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM collection_jobs').get().n,1);
  }
 }finally{h.close();}
});

test('unknown or malformed new context and receipt-only unlinked drafts preserve first-capture semantics',async()=>{
 const f=await historical(),{h}=f;try{
  const jobs=h.load('db/collection-jobs.ts');await jobs.enqueueCollection('owner',requests(h),h.context);const before=oldSnapshot(h,f.product.id);
  for(const company of [undefined,null,{},'A01526306',{code:'A01526306',name:'와이홉'},{code:'A00000000',name:'유앤채'}]){
   const context=plain(h.context);context.category.hubSchema.company=company;assert.equal((await jobs.enqueueCollection('owner',requests(h),context))[0].id,'job');assert.equal(oldSnapshot(h,f.product.id),before);
  }
  const pendingContext=plain(h.context),[pending]=await jobs.enqueueCollection('pending-owner',requests(h),pendingContext),receipt=await h.load('db/collection-results.ts').readCollectionResult('owner','job');await h.load('db/collection-results.ts').storeCollectionResult('pending-owner',pending.id,receipt.result);
  const newContext={...plain(h.context),category:await profile(h,schemaCompanies[1])};const [retained]=await jobs.enqueueCollection('pending-owner',requests(h),newContext);assert.equal(retained.id,pending.id);assert.equal(retained.product_id,null);assert.ok(retained.received_at);assert.deepEqual(plain(retained.context),pendingContext);assert.equal(h.sqlite.prepare('SELECT count(*) AS n FROM collection_jobs WHERE owner_id=?').get('pending-owner').n,1);
 }finally{h.close();}
});

test('company retirement stays owner-scoped and an inconsistent foreign product link cannot authorize it',async()=>{
 const f=await historical(),{h}=f;try{
  const jobs=h.load('db/collection-jobs.ts'),receipt=await h.load('db/collection-results.ts').readCollectionResult('owner','job'),oldContext=plain(h.context),[foreign]=await jobs.enqueueCollection('foreign-owner',requests(h),oldContext);await h.load('db/collection-results.ts').storeCollectionResult('foreign-owner',foreign.id,receipt.result);
  const foreignProduct=await h.load('db/collection-products.ts').promoteCollection('foreign-owner',foreign,receipt.result),before=oldSnapshot(h,foreignProduct.product_id,foreign.id),context={...plain(h.context),category:await profile(h,schemaCompanies[1])};
  const [next]=await jobs.enqueueCollection('owner',requests(h),context);assert.notEqual(next.id,'job');assert.equal(oldSnapshot(h,foreignProduct.product_id,foreign.id),before);assert.equal(h.sqlite.prepare('SELECT job_id FROM collection_offer_claims WHERE owner_id=? AND offer_id=?').get('foreign-owner','813724060928').job_id,foreign.id);
  // Corrupt fixture ownership must not count as a proven linked own product.
  h.sqlite.prepare('UPDATE products SET owner_id=? WHERE id=?').run('different-owner',foreignProduct.product_id);const inconsistent=oldSnapshot(h,foreignProduct.product_id,foreign.id);assert.equal((await jobs.enqueueCollection('foreign-owner',requests(h),context))[0].id,foreign.id);assert.equal(oldSnapshot(h,foreignProduct.product_id,foreign.id),inconsistent);
 }finally{h.close();}
});
