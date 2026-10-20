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
test('actual saved quotation can select two size and two label files for native preparation without relaxing the legacy count rule',async()=>{
 const snapshot=assetSnapshot(),raw=JSON.parse(snapshot.schemaString);raw.properties.imagePage.properties.images.properties.sizeChartImage={type:'string',title:'사이즈표 파일명'};snapshot.schemaString=JSON.stringify(raw);
 const f=await fixture(companies[0],snapshot);try{
  const before=await read(await f.h.route(f.base+'/quotation-fields'+f.query)),sizeField=before.resolved.schema.fields.find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(['imagePage','images','sizeChartImage'])),labelField=before.resolved.schema.fields.find(field=>field.hubWire?.name==='제품 한글 표시사항 라벨 또는 도안 이미지');
  assert.ok(sizeField);assert.ok(labelField);const size=f.keys.slice(1,3),label=[f.keys[6],f.keys[7]];
  await read(await f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:before.revision,expectedInputFingerprint:before.inputFingerprint,changes:[{optionId:null,fieldKey:sizeField.id,value:size.join('\n')},{optionId:null,fieldKey:labelField.id,value:label.join('\n')}]}}));
  const old=await read(await f.h.route(f.endpoint));assert.equal(old.review.canPrepare,false);assert.ok(old.review.issues.some(issue=>issue.code==='SINGLE_IMAGE_COUNT'));
  const plan=await read(await f.send());assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues));const all=type=>plan.images.filter(file=>file.imageType===type);assert.equal(all('SIZECHART').length,2);assert.equal(all('LABEL').length,2);
  for(const file of [...all('SIZECHART'),...all('LABEL')]){const response=await f.raw(plan,file.key);assert.equal(response.status,200,await response.clone().text());assert.equal(sha(new Uint8Array(await response.arrayBuffer())),file.sha256);}
  for(const document of plan.body.jsonDocument){assert.equal(document.imagePage.images.sizeChartImage,size.map(key=>all('SIZECHART').find(file=>file.key===key).transportName).join(','));assert.equal(document.imagePage.images.labelImages[0].labelImageFiles,label.map(key=>all('LABEL').find(file=>file.key===key).transportName).join(','));}
  assert.deepEqual(plain(await read(await f.h.route(f.endpoint))),plain(old));assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
