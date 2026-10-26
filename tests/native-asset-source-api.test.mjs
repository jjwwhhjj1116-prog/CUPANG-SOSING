import test from 'node:test';
import assert from 'node:assert/strict';
import {assetApiFixture,assetSnapshot,companies,plain,sha} from './helpers/supplier-hub-single-assets.mjs';
const read=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
async function fixture(company=companies[0],snapshot=assetSnapshot(company)){
 const f=await assetApiFixture(company,snapshot),legal=f.h.load('app/api/products/[id]/legal-documents/route.ts'),context={params:Promise.resolve({id:f.id})};
 const listed=await read(await legal.GET(new Request('https://app.test'+f.base+'/legal-documents'),context));
 await read(await legal.PATCH(new Request('https://app.test'+f.base+'/legal-documents',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:listed.revision,applicability:'not-applicable'})}),context));
 const api=f.h.load('app/api/products/[id]/native-assets/route.ts');
 const send=(query=f.query,signal)=>api.GET(new Request('https://app.test'+f.base+'/native-assets'+query,{signal}),context);
 const raw=(plan,key,signal)=>send(f.query+'&sourcePlanSha256='+plan.sourcePlanSha256+'&key='+encodeURIComponent(key),signal);
 return {...f,send,raw};
}
for(const company of companies)test(`${company.code}: actual authenticated API exposes a source-bound sidecar and exact original bytes without changing the legacy package or any product`,async()=>{
 const f=await fixture(company);try{
  const before=await read(await f.h.route(f.endpoint)),originals=f.objectState(),product=JSON.stringify(f.h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id));
  const plan=await read(await f.send());assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues));assert.deepEqual(plain(plan.identity.company),company);assert.equal(plan.identity.productId,f.id);assert.equal(plan.images.length,7);
  assert.equal(Object.hasOwn(plan,'target'),false);for(const flag of ['transportReady','submissionReady','remoteWrites','registered','bytesVerified'])assert.equal(plan[flag],false);
  for(const file of plan.images){const response=await f.raw(plan,file.key);assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('content-type'),file.contentType);assert.equal(response.headers.get('x-yoofam-source-plan-sha256'),plan.sourcePlanSha256);assert.equal(response.headers.get('x-yoofam-file-sha256'),file.sha256);assert.match(response.headers.get('content-disposition'),/^attachment; filename="yoofam-native-original\.png"; filename\*=UTF-8''/);assert.equal(response.headers.get('cache-control'),'private, no-store');const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,file.byteLength);assert.equal(sha(bytes),file.sha256);assert.deepEqual(bytes,Buffer.from(f.h.objects.get(file.key)));}
  const after=await read(await f.h.route(f.endpoint));assert.deepEqual(plain(after),plain(before));assert.equal(Object.hasOwn(after,'nativeAssetSourcePlan'),false,'default legacy package is unchanged');assert.equal(f.objectState(),originals);assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id)),product);
  assert.deepEqual(f.h.network,[]);assert.equal([...f.h.objects.keys()].filter(key=>key.startsWith('quotation-public-detail/')).length,0);assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM supplier_hub_receipts').get().n,0);
 }finally{f.close();}
});
test('exact source plan SHA plus current product membership are both required for a private image read',async()=>{
 const f=await fixture();try{
  const plan=await read(await f.send()),file=plan.images[0];
  for(const query of [f.query+'&key='+encodeURIComponent(file.key),f.query+'&sourcePlanSha256='+plan.sourcePlanSha256,f.query+'&sourcePlanSha256=bad&key='+encodeURIComponent(file.key),f.query+'&profileId=another',f.query+'&unexpected=yes'])assert.equal((await f.send(query)).status,400);
  assert.equal((await f.raw({...plan,sourcePlanSha256:'f'.repeat(64)},file.key)).status,409);
  assert.equal((await f.raw(plan,'other/private.png')).status,404);assert.equal((await f.raw(plan,f.keys.at(-1))).status,404,'owned but excluded pool image is not in the native sidecar');
  const controller=new AbortController();controller.abort();assert.equal((await f.raw(plan,file.key,controller.signal)).status,409);
  assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
test('option/product source edits invalidate old image capabilities before bytes can be returned',async()=>{
 for(const kind of ['option','product']){const f=await fixture();try{
  const plan=await read(await f.send()),file=plan.images[0];
  if(kind==='product')f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-20T23:59:59.999Z',f.id);
  else{const db=f.h.load('db/product-options.ts'),model=f.h.load('app/product-options.ts'),current=await db.readProductOptions('owner',f.id),rows=model.optionInputs(current),product=await f.h.load('db/queries.ts').findProduct('owner',f.id);rows[0].translatedName+=' 수정';assert.ok(await db.saveProductOptions('owner',model.applyOptionRows(current,rows,new Date().toISOString()),current.revision,product.updated_at));}
  assert.equal((await f.raw(plan,file.key)).status,409);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}}
});
test('changed original bytes/metadata under the same key cannot satisfy the old reviewed plan',async()=>{
 for(const repairMetadata of [false,true]){const f=await fixture();try{
  const plan=await read(await f.send()),file=plan.images[0],bytes=new Uint8Array(f.h.objects.get(file.key));bytes[bytes.length-1]^=1;
  if(repairMetadata)await f.h.bindings.FILES.put(file.key,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{sha256:sha(bytes)}});else f.h.objects.set(file.key,bytes);
  assert.equal((await f.raw(plan,file.key)).status,409);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}}
});
test('source or company changes during actual private storage reads fail before returning bytes',async()=>{
 for(const kind of ['product','company']){const f=await fixture();try{
  const plan=await read(await f.send()),file=plan.images[0],get=f.h.bindings.FILES.get;let fired=false;
  f.h.bindings.FILES.get=async key=>{const value=await get(key);if(!fired&&key===file.key){fired=true;if(kind==='company')f.h.setCompany(companies[1]);else f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-20T23:59:59.999Z',f.id);}return value;};
  assert.equal((await f.raw(plan,file.key)).status,409);assert.equal(fired,true);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}}
});

test('native plan GET verifies every private file once in a bounded batch with complete beginning/end source proofs',async()=>{
 const f=await fixture();try{
  const source=f.h.load('app/exports/quotation-source.ts'),original=source.readQuotationExportSource,get=f.h.bindings.FILES.get;
  let sourceReads=0,inFlight=0,maxInFlight=0;const privateReads=new Map();
  source.readQuotationExportSource=async(...args)=>{sourceReads++;return original(...args);};
  f.h.bindings.FILES.get=async key=>{
   if(!f.keys.includes(key))return get(key);
   const count=(privateReads.get(key)??0)+1;privateReads.set(key,count);
   if(count===1)return get(key);
   inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
   try{return await get(key);}finally{inFlight--;}
  };
  const plan=await read(await f.send());assert.equal(plan.images.length,7);
  assert.equal(sourceReads,2,'initial complete snapshot plus final complete saved values, with a clock fence before bytes');
  for(const file of plan.images)assert.equal(privateReads.get(file.key),2,'initial bytes plus one current native verification: '+file.key);
  assert.equal(maxInFlight,3,'current-byte readers overlap but remain bounded to three');assert.equal(inFlight,0);
  assert.deepEqual(f.h.network,[]);assert.equal([...f.h.objects.keys()].filter(key=>key.startsWith('quotation-public-detail/')).length,0);
 }finally{f.close();}
});

test('synthetic delayed storage measures fewer native plan reads without changing its identity or legacy defaults',async t=>{
 const f=await fixture();try{
  await read(await f.send()); // Exclude fixture/module initialization from the path measurement.
  const loader=f.h.load('app/exports/single-package.ts'),source=f.h.load('app/exports/quotation-source.ts'),original=source.readQuotationExportSource;
  const get=f.h.bindings.FILES.get,head=f.h.bindings.FILES.head,delay=()=>new Promise(resolve=>setTimeout(resolve,4));let counts;
  source.readQuotationExportSource=async(...args)=>{counts.sources++;return original(...args);};
  f.h.bindings.FILES.get=async key=>{counts.gets++;if(f.keys.includes(key))counts.privateGets++;await delay();return get(key);};
  f.h.bindings.FILES.head=async key=>{counts.heads++;await delay();return head(key);};
  const results=[];
  for(const nativeReadOnly of [false,true]){
   counts={sources:0,gets:0,privateGets:0,heads:0,active:0};const active=async()=>{counts.active++;await delay();},start=performance.now();
   await active();const loaded=await loader.loadSinglePackage('owner',f.id,f.profile.id,companies[0],active,false,undefined,true,{nativeReadOnly});
   if(!nativeReadOnly)await loaded.nativeAssetSourceGuard(); // The previous native plan GET route's repeated batch.
   await active();results.push({...counts,elapsedMs:Math.round(performance.now()-start),plan:loaded.view.nativeAssetSourcePlan});
  }
  const [previous,current]=results;assert.equal(previous.plan.sourcePlanSha256,current.plan.sourcePlanSha256);
  assert.equal(previous.sources,8);assert.equal(current.sources,2);assert.equal(previous.gets,23);assert.equal(current.gets,14);
  assert.equal(previous.privateGets,22);assert.equal(current.privateGets,14);
  assert.ok(current.active<previous.active);assert.equal(current.active,5);
  t.diagnostic('Synthetic 7-image path, 4ms per storage/auth call: '+JSON.stringify(results.map(({plan,...metrics})=>({images:plan.images.length,...metrics}))));
  assert.deepEqual(f.h.network,[]);assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM supplier_hub_receipts').get().n,0);
 }finally{f.close();}
});

for(const index of [0,3,6])test(`native batch denies every response when source/auth/file changes at private image ${index+1}`,async()=>{
 for(const kind of ['product','options','profile','company','membership','cancel','file-bytes','file-metadata']){
  const f=await fixture();try{
   const get=f.h.bindings.FILES.get,controller=new AbortController(),reads=new Map();let fired=false;
   f.h.bindings.FILES.get=async key=>{
    const value=await get(key),count=(reads.get(key)??0)+1;reads.set(key,count);
    // Initial bytes are read once to build the plan. Mutate during the
    // independent current-byte proof, regardless of source-query count.
    if(!fired&&count===2&&key===f.keys[index]){
     fired=true;
     if(kind==='product')f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-20T23:59:59.999Z',f.id);
     if(kind==='options')f.h.sqlite.prepare('UPDATE product_options SET revision=revision+1 WHERE product_id=?').run(f.id);
     if(kind==='profile')f.h.sqlite.prepare('UPDATE category_profiles SET revision=revision+1 WHERE id=?').run(f.profile.id);
     if(kind==='company')f.h.setCompany(companies[1]);
     if(kind==='membership')f.h.setMembershipStatus('suspended');
     if(kind==='cancel')controller.abort();
     if(kind==='file-bytes'){
      const bytes=new Uint8Array(f.h.objects.get(key));bytes[bytes.length-1]^=1;f.h.objects.set(key,bytes);
      return {...value,arrayBuffer:async()=>bytes.slice().buffer};
     }
     if(kind==='file-metadata')await f.h.bindings.FILES.put(key,f.h.objects.get(key),{httpMetadata:{contentType:'image/png'},customMetadata:{sha256:'a'.repeat(64)}});
    }
    return value;
   };
   const response=await f.send(f.query,controller.signal);assert.equal(response.status,409,kind);assert.equal(fired,true,kind+' mutation reached the actual native batch');
   const body=await response.json();assert.ok(body.error);assert.equal(body.images,undefined,'no plan or private bytes leave a failed final proof');
   assert.deepEqual(f.h.network,[]);assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM supplier_hub_receipts').get().n,0);
  }finally{f.close();}
 }
});

test('private byte GET retains its final independent byte and source proof after the response digest',async()=>{
 for(const kind of ['product','company','membership','cancel','file-bytes','file-metadata']){
  const f=await fixture();try{
   const plan=await read(await f.send()),file=plan.images.at(-1),get=f.h.bindings.FILES.get,controller=new AbortController();let reads=0,fired=false;
   f.h.bindings.FILES.get=async key=>{
    const value=await get(key);if(key!==file.key||++reads!==3)return value;
    fired=true;
    if(kind==='product')f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-20T23:59:59.999Z',f.id);
    if(kind==='company')f.h.setCompany(companies[1]);
    if(kind==='membership')f.h.setMembershipStatus('suspended');
    if(kind==='cancel')controller.abort();
    if(kind==='file-bytes'){const bytes=new Uint8Array(f.h.objects.get(key));bytes[bytes.length-1]^=1;f.h.objects.set(key,bytes);return {...value,arrayBuffer:async()=>bytes.slice().buffer};}
    if(kind==='file-metadata')await f.h.bindings.FILES.put(key,f.h.objects.get(key),{httpMetadata:{contentType:'image/png'},customMetadata:{sha256:'a'.repeat(64)}});
    return value;
   };
   const response=await f.raw(plan,file.key,controller.signal);assert.equal(fired,true,kind+' reached the final current-byte proof');assert.equal(response.status,409,kind);
   assert.ok((await response.json()).error);assert.deepEqual(f.h.network,[]);
  }finally{f.close();}
 }
});
test('actual saved quotation can select two size and two label files for native preparation without relaxing the legacy count rule',async()=>{
 const snapshot=assetSnapshot(),raw=JSON.parse(snapshot.schemaString);raw.properties.imagePage.properties.images.properties.sizeChartImage={type:'string',title:'사이즈표 파일명'};snapshot.schemaString=JSON.stringify(raw);
 const f=await fixture(companies[0],snapshot);try{
  const before=await read(await f.h.route(f.base+'/quotation-fields'+f.query)),sizeField=before.resolved.schema.fields.find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(['imagePage','images','sizeChartImage'])),labelField=before.resolved.schema.fields.find(field=>field.hubWire?.name==='제품 한글 표시사항 라벨 또는 도안 이미지');
  assert.ok(sizeField);assert.ok(labelField);const size=f.keys.slice(1,3),label=[f.keys[6],f.keys[7]];
  await read(await f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:before.revision,expectedInputFingerprint:before.inputFingerprint,changes:[{optionId:null,fieldKey:sizeField.id,value:size.join('\n')},{optionId:null,fieldKey:labelField.id,value:label.join('\n')}]}}));
  const old=await read(await f.h.route(f.endpoint));assert.equal(old.review.canPrepare,false);assert.ok(old.review.issues.some(issue=>issue.code==='SINGLE_IMAGE_COUNT'));
  const get=f.h.bindings.FILES.get,reads=new Map();f.h.bindings.FILES.get=async key=>{reads.set(key,(reads.get(key)??0)+1);return get(key);};
  const plan=await read(await f.send());assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues));const all=type=>plan.images.filter(file=>file.imageType===type);assert.equal(all('SIZECHART').length,2);assert.equal(all('LABEL').length,2);
  for(const key of new Set(plan.images.map(file=>file.key)))assert.equal(reads.get(key),2,'role aliases reuse one current byte verification per key');
  for(const file of [...all('SIZECHART'),...all('LABEL')]){const response=await f.raw(plan,file.key);assert.equal(response.status,200,await response.clone().text());assert.equal(sha(new Uint8Array(await response.arrayBuffer())),file.sha256);}
  for(const document of plan.body.jsonDocument){assert.equal(document.imagePage.images.sizeChartImage,size.map(key=>all('SIZECHART').find(file=>file.key===key).transportName).join(','));assert.equal(document.imagePage.images.labelImages[0].labelImageFiles,label.map(key=>all('LABEL').find(file=>file.key===key).transportName).join(','));}
  assert.deepEqual(plain(await read(await f.h.route(f.endpoint))),plain(old));assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

// Model the storage service's immutable per-upload version independently of
// uploader-controlled metadata. Unversioned harnesses keep the byte-read path.
function versionedStorage(f){
 const store=f.h.bindings.FILES,get=store.get,head=store.head,put=store.put;
 const versions=new Map(f.keys.map((key,index)=>[key,'r2-upload-'+index])),reads=new Map();
 store.get=async key=>{const version=versions.has(key)?versions.get(key):'r2-upload-other',value=await get(key);reads.set(key,(reads.get(key)??0)+1);return value?{...value,version}:null;};
 store.head=async key=>{const value=await head(key);return value?{...value,version:versions.has(key)?versions.get(key):'r2-upload-other'}:null;};
 store.put=async(key,...args)=>{const result=await put(key,...args);versions.set(key,'r2-replacement-'+crypto.randomUUID());return result;};
 return{reads,versions};
}

test('immutable R2 upload version revalidates exact request-local bytes without downloading the whole batch twice',async()=>{
 const f=await fixture();try{
  const storage=versionedStorage(f),plan=await read(await f.send());
  for(const key of new Set(plan.images.map(file=>file.key)))assert.equal(storage.reads.get(key),1,'one format/digest-verified body per unique key');
  storage.reads.clear();const file=plan.images[0],response=await f.raw(plan,file.key);
  assert.equal(response.status,200,await response.clone().text());assert.equal(sha(new Uint8Array(await response.arrayBuffer())),file.sha256);
  for(const key of new Set(plan.images.map(file=>file.key)))assert.equal(storage.reads.get(key),1,'response final fence uses a fresh version HEAD');
  assert.deepEqual(f.h.network,[]);assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM supplier_hub_receipts').get().n,0);
 }finally{f.close();}
});

test('versioned native reads reject replacement, metadata, scope or cancellation changes during final HEAD',async()=>{
 for(const kind of ['replacement','metadata','missing','product','company','membership','cancel']){
  const f=await fixture();try{
   const storage=versionedStorage(f),head=f.h.bindings.FILES.head,controller=new AbortController(),heads=new Map();let fired=false;
   f.h.bindings.FILES.head=async key=>{
    heads.set(key,(heads.get(key)??0)+1);
    if(!fired&&key===f.keys[0]&&heads.get(key)>=2&&storage.reads.has(key)){
     fired=true;
     if(kind==='replacement')storage.versions.set(key,'r2-another-upload');
     if(kind==='metadata'){const value=await head(key);return {...value,customMetadata:{...value.customMetadata,sha256:'a'.repeat(64)}};}
     if(kind==='missing')return null;
     if(kind==='product')f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-26T23:59:59.999Z',f.id);
     if(kind==='company')f.h.setCompany(companies[1]);
     if(kind==='membership')f.h.setMembershipStatus('suspended');
     if(kind==='cancel')controller.abort();
    }
    return head(key);
   };
   const response=await f.send(f.query,controller.signal);assert.equal(fired,true,kind);assert.equal(response.status,409,kind);
   assert.equal((await response.json()).images,undefined);assert.deepEqual(f.h.network,[]);
  }finally{f.close();}
 }
});

test('an empty, malformed or absent version never replaces independent current-byte validation',async()=>{
 for(const version of [undefined,'','bad version','x'.repeat(513)]){
  const f=await fixture();try{
   const storage=versionedStorage(f);for(const key of f.keys)storage.versions.set(key,version);
   const plan=await read(await f.send());
   for(const file of plan.images)assert.equal(storage.reads.get(file.key),2);
  }finally{f.close();}
 }
});

test('authenticated bounded image batch returns exactly the reviewed unique bytes without changing its plan or any product',async()=>{
 const f=await fixture();try{
  const response=await f.send(),plan=await read(response);assert.equal(response.headers.get('x-yoofam-native-image-batch'),'v1');
  const before=JSON.stringify(f.h.sqlite.prepare('SELECT * FROM products').all()),objects=f.objectState(),batch=await read(await f.send(f.query+'&sourcePlanSha256='+plan.sourcePlanSha256+'&bundle=images'));
  assert.equal(batch.format,'yoofam-native-image-batch-v1');assert.equal(batch.sourcePlanSha256,plan.sourcePlanSha256);assert.equal(batch.registered,false);assert.equal(batch.remoteWrites,false);
  const unique=new Map(plan.images.map(file=>[file.key,file]));assert.equal(batch.files.length,unique.size);
  for(const value of batch.files){const file=unique.get(value.key),bytes=Buffer.from(value.base64,'base64');assert.ok(file);assert.equal(value.contentType,file.contentType);assert.equal(bytes.length,file.byteLength);assert.equal(sha(bytes),file.sha256);assert.deepEqual(bytes,Buffer.from(f.h.objects.get(file.key)));}
  assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM products').all()),before);assert.equal(f.objectState(),objects);assert.deepEqual(f.h.network,[]);
  for(const suffix of ['&bundle=other','&bundle=images&key='+encodeURIComponent(plan.images[0].key),'&bundle=images&bundle=images'])assert.equal((await f.send(f.query+'&sourcePlanSha256='+plan.sourcePlanSha256+suffix)).status,400);
  assert.equal((await f.send(f.query+'&sourcePlanSha256='+'f'.repeat(64)+'&bundle=images')).status,409);
 }finally{f.close();}
});

test('image batch keeps a final independent scope/byte proof before releasing any base64',async()=>{
 for(const kind of ['company','bytes','cancel']){const f=await fixture();try{
  const plan=await read(await f.send()),key=plan.images[0].key,get=f.h.bindings.FILES.get,controller=new AbortController();let reads=0,fired=false;
  f.h.bindings.FILES.get=async selected=>{const value=await get(selected);if(selected!==key||++reads!==3)return value;fired=true;
   if(kind==='company')f.h.setCompany(companies[1]);if(kind==='cancel')controller.abort();
   if(kind==='bytes'){const bytes=new Uint8Array(f.h.objects.get(key));bytes[bytes.length-1]^=1;return {...value,arrayBuffer:async()=>bytes.buffer};}return value;};
  const response=await f.send(f.query+'&sourcePlanSha256='+plan.sourcePlanSha256+'&bundle=images',controller.signal);assert.equal(fired,true,kind);assert.equal(response.status,409,kind);assert.equal((await response.json()).files,undefined);
  assert.deepEqual(f.h.network,[]);
 }finally{f.close();}}
});

test('an image batch above 8 MiB is rejected without a partial response while individual files remain available',async()=>{
 const f=await fixture();try{
  for(const key of f.keys.slice(0,7)){const original=f.h.objects.get(key),bytes=new Uint8Array(1300*1024);bytes.set(original);await f.h.bindings.FILES.put(key,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{sha256:sha(bytes)}});}
  const plan=await read(await f.send()),response=await f.send(f.query+'&sourcePlanSha256='+plan.sourcePlanSha256+'&bundle=images');
  assert.equal(response.status,413);assert.equal((await response.json()).files,undefined);
  const single=await f.raw(plan,plan.images[0].key);assert.equal(single.status,200);assert.equal((await single.arrayBuffer()).byteLength,plan.images[0].byteLength);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
