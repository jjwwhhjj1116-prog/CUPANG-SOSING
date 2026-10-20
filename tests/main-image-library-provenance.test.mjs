import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const digest=value=>createHash('sha256').update(value).digest('hex');
const json=async response=>{assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');return response.json();};
const tables=['products','product_content','product_options','product_price_policy','collection_results','collection_context','collection_images','product_quotation_fields'];
const saved=h=>JSON.stringify(tables.map(table=>h.sqlite.prepare('SELECT * FROM '+table).all()));
const product=h=>h.sqlite.prepare('SELECT * FROM products').get();
const endpoint=h=>'/api/products/'+product(h).id+'/options';
async function setup(company=companies[0]){const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});await h.intake();return h;}
async function read(h,company=companies[0],p=product(h),options){return h.load('db/main-image-library.ts').readMainImageLibraryEvidence('owner',p,options??await h.load('db/product-options.ts').readProductOptions('owner',p.id),company);}
function original(h){const raw=h.sqlite.prepare('SELECT payload FROM collection_results').get().payload;return{raw,result:JSON.parse(raw),links:new Map(h.sqlite.prepare('SELECT image_index,object_key FROM collection_images').all().map(row=>[row.image_index,row.object_key]))};}
async function addProcessed(h,{kind='free',valid=true}={}){
 const p=product(h),output=digest('synthetic output '+kind),fingerprint=digest('synthetic request '+kind),key=kind==='ai'?'owner/ai-synthetic-job.png':`owner/free-image-${kind==='workspace'?'workspace-':''}${p.id}-${fingerprint}-${output}.png`;
 const metadata=kind==='ai'?{imageJobId:'synthetic-job',provenance:'generated',sha256:output}:{freeImageSourceSha256:digest('source'),freeImageOutputSha256:output,
  ...(kind==='workspace'?{freeImageEditDocumentSha256:digest('document'),freeImageEditRecordSha256:digest('record')}:{freeImageOptionIdsSha256:digest('[]')}),imageValidation:'header-v1',dimensionValidation:'header-v1'};
 if(!valid)delete metadata[kind==='ai'?'sha256':'freeImageSourceSha256'];
 await h.bindings.FILES.put(key,new Uint8Array([1,2,3]),{httpMetadata:{contentType:'image/png'},customMetadata:metadata});
 h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([...JSON.parse(p.image_keys),key]),p.id);
 if(kind==='ai'){
  await h.load('db/image-jobs.ts').listImageJobs('owner',p.id);
  h.sqlite.prepare(`INSERT INTO image_jobs(id,owner_id,product_id,idempotency_key,request_fingerprint,product_version,content_revision,product_image_keys,status,review_fingerprint,review,expires_at,result,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('synthetic-job','owner',p.id,'fixture','request',p.updated_at,0,p.image_keys,'completed','review','{}',p.updated_at,JSON.stringify({provenance:'generated',storageKey:key,sha256:output}),p.updated_at);
 }
 return key;
}

for(const company of companies)test(`immutable receipt gallery roles survive editable role replacements and source option reordering (${company.code})`,async()=>{
 const h=await setup(company);try{
  const p=product(h),source=original(h),beforeNetwork=h.network.length;
  // These saved selections intentionally disagree with the immutable gallery.
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload),detailKey=source.links.get(source.result.images.findIndex(image=>image.role==='detail'));
  content.assets.main={value:[detailKey],provenance:'manual',updatedAt:p.updated_at};content.assets.detail={value:[source.links.get(0)],provenance:'manual',updatedAt:p.updated_at};
  h.sqlite.prepare('UPDATE product_content SET payload=?').run(JSON.stringify(content));
  const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);options.rows.reverse();options.rows[0].imageKey=detailKey;h.sqlite.prepare('UPDATE product_options SET payload=?').run(JSON.stringify(options));
  const before=saved(h),body=await json(await h.route(endpoint(h))),library=body.imageLibrary;
  assert.ok(library);assert.deepEqual(library.company,company);assert.equal(library.source.fingerprint,digest(source.raw));assert.equal(library.source.jobId,'job');assert.equal(library.source.receivedAt,h.sqlite.prepare('SELECT received_at FROM collection_results').get().received_at);
  const expectedMain=source.result.images.flatMap((image,index)=>image.role==='main'||image.role==='additional'&&source.result.sourceGallery.imageIndices.includes(index)?[source.links.get(index)]:[]);
  const expectedDetail=source.result.images.flatMap((image,index)=>image.role==='detail'?[source.links.get(index)]:[]);
  assert.deepEqual(library.main,expectedMain);assert.deepEqual(library.detail,expectedDetail);assert.ok(!library.main.includes(detailKey));assert.deepEqual(library.options,[...new Set(source.result.options.map(row=>source.links.get(row.imageIndex)))]);assert.deepEqual(library.work,[]);
  assert.equal(saved(h),before);assert.equal(h.network.length,beforeNetwork);assert.equal(body.options.rows[0].imageKey,detailKey);
 }finally{h.close();}
});

for(const company of companies)test(`work tab requires stored processing evidence and excludes raw, upload, label and foreign-product filenames (${company.code})`,async()=>{
 const h=await setup(company);try{
  const free=await addProcessed(h),workspace=await addProcessed(h,{kind:'workspace'}),ai=await addProcessed(h,{kind:'ai'}),invalid=await addProcessed(h,{kind:'invalid',valid:false}),p=product(h);
  const manual='owner/manual.png',foreign=`owner/free-image-other-product-${digest('request')}-${digest('output')}.png`;
  h.objects.set(manual,new Uint8Array([1]));h.objects.set(foreign,new Uint8Array([2]));h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([...JSON.parse(p.image_keys),manual,foreign]),p.id);
  const before=saved(h),objects=JSON.stringify([...h.objects]),network=h.network.length,library=(await json(await h.route(endpoint(h)))).imageLibrary;
  assert.deepEqual(library.work,[free,workspace,ai]);for(const key of [invalid,manual,foreign,...original(h).links.values()])assert.ok(!library.work.includes(key));
  assert.equal(saved(h),before);assert.equal(JSON.stringify([...h.objects]),objects);assert.equal(h.network.length,network);
  h.sqlite.prepare("UPDATE image_jobs SET status='running' WHERE id='synthetic-job'").run();assert.ok(!(await read(h,company)).work.includes(ai));
 }finally{h.close();}
});

test('missing source-gallery marker never labels ambiguous additional/option pool as original main gallery',async()=>{
 const h=await setup();try{const source=original(h);delete source.result.sourceGallery;h.sqlite.prepare('UPDATE collection_results SET payload=?').run(JSON.stringify(source.result));const library=await read(h);assert.deepEqual([...library.main],[source.links.get(0)]);assert.ok(library.options.length>0);assert.ok(library.detail.length>0);assert.deepEqual([...library.work],[]);}finally{h.close();}
});

test('an unlinked legacy product can show its proven processing results without inventing any original gallery or creating source tables',async()=>{
 const h=await setup();try{const key=await addProcessed(h);h.sqlite.prepare('DELETE FROM collection_products').run();h.sqlite.exec('DROP TABLE collection_source_supplements');const before=saved(h),library=await read(h);assert.ok(library);assert.equal(library.source,null);assert.deepEqual([...library.work],[key]);for(const role of ['main','options','detail'])assert.deepEqual([...library[role]],[]);assert.equal(saved(h),before);assert.equal(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='collection_source_supplements'").get(),undefined);}finally{h.close();}
});

test('removed files and unrelated same-URL imports never resurrect originals',async()=>{
 const h=await setup();try{
  const source=original(h),p=product(h),removed=source.links.get(0);h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify(JSON.parse(p.image_keys).filter(key=>key!==removed)),p.id);
  const library=await read(h);assert.ok(!library.main.includes(removed));assert.ok(!library.options.includes(removed));
  const other={...p,id:'unrelated-product'},columns=Object.keys(other);h.sqlite.prepare(`INSERT INTO products(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...Object.values(other));
  h.sqlite.prepare('UPDATE collection_images SET product_id=? WHERE image_index=0').run(other.id);assert.ok(!(await read(h)).main.includes(removed));
 }finally{h.close();}
});

test('wrong source/company/owner, malformed source and stale product/option clocks stay visibly unclassified while normal options remain readable',async()=>{
 const h=await setup();try{
  const p=product(h),options=await h.load('db/product-options.ts').readProductOptions('owner',p.id),source=original(h),context=h.sqlite.prepare('SELECT payload FROM collection_context').get().payload;
  assert.equal(await h.load('db/main-image-library.ts').readMainImageLibraryEvidence('other',p,options,companies[0]),null);
  assert.equal(await read(h,companies[1]),null);assert.equal(await read(h,null),null);assert.equal(await read(h,companies[0],{...p,updated_at:'2000-01-01T00:00:00.000Z'}),null);assert.equal(await read(h,companies[0],p,{...options,revision:options.revision+1}),null);
  for(const broken of ['broken',JSON.stringify({...source.result,offerId:'999'}),JSON.stringify({...source.result,images:[]})]){h.sqlite.prepare('UPDATE collection_results SET payload=?').run(broken);const body=await json(await h.route(endpoint(h)));assert.equal(body.imageLibrary,null);assert.equal(body.options.rows.length,6);assert.equal(body.pricing.rows.length,6);}
  h.sqlite.prepare('UPDATE collection_results SET payload=?').run(source.raw);h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify({...JSON.parse(context),company:companies[1]}));assert.equal((await json(await h.route(endpoint(h)))).imageLibrary,null);
  h.sqlite.prepare('UPDATE collection_context SET payload=?').run(context);h.sqlite.prepare("UPDATE collection_results SET owner_id='other'").run();assert.equal(await read(h),null);
 }finally{h.close();}
});

for(const change of ['product','options','source','company','membership','image-link'])test(`metadata read rejects a concurrent ${change} scope change without a write of its own`,async()=>{
 const h=await setup();try{
  await addProcessed(h);const head=h.bindings.FILES.head;let changed=false;h.bindings.FILES.head=async key=>{
   if(!changed){changed=true;
    if(change==='product')h.sqlite.prepare("UPDATE products SET updated_at='2001-01-01T00:00:00.000Z'").run();
    if(change==='options')h.sqlite.prepare('UPDATE product_options SET revision=revision+1').run();
    if(change==='source'){const source=original(h);source.result.description+=' changed';h.sqlite.prepare('UPDATE collection_results SET payload=?').run(JSON.stringify(source.result));}
    if(change==='company')h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify({...h.context,company:companies[1]}));
    if(change==='membership')h.setCompany(companies[1]);
    if(change==='image-link')h.sqlite.prepare('DELETE FROM collection_images WHERE image_index=0').run();
   }return head(key);
  };
  const body=await json(await h.route(endpoint(h)));assert.ok(changed);assert.equal(body.imageLibrary,null);assert.equal(body.options.rows.length,6);
 }finally{h.close();}
});

test('validated append-only saved source supplement exposes its original detail links and checks its exact effective fingerprint',async()=>{
 const h=await setup();try{
  const source=original(h),effective=structuredClone(source.result),index=effective.images.length,key='owner/supplement-detail.png',p=product(h);
  effective.images.push({url:'https://cbu01.alicdn.com/img/synthetic-supplement.jpg',role:'detail'});effective.provider='chrome-public-mobile-supplement-v1';
  h.sqlite.prepare('INSERT INTO collection_source_supplements(job_id,owner_id,base_payload,captured_payload,payload,received_at) VALUES(?,?,?,?,?,?)').run('job','owner',source.raw,JSON.stringify(effective),JSON.stringify(effective),p.created_at);
  h.sqlite.prepare('INSERT INTO collection_images VALUES(?,?,?,?,?,?,?)').run('job',index,'owner',p.id,key,'fixture',p.created_at);h.sqlite.prepare('UPDATE products SET image_keys=?').run(JSON.stringify([...JSON.parse(p.image_keys),key]));
  const before=saved(h),library=await read(h);assert.ok(library.detail.includes(key));assert.equal(library.source.fingerprint,digest(JSON.stringify(effective)));assert.equal(saved(h),before);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,source.raw);
  effective.images[0].role='detail';h.sqlite.prepare('UPDATE collection_source_supplements SET payload=?').run(JSON.stringify(effective));assert.equal(await read(h),null);
 }finally{h.close();}
});
