import test from 'node:test';
import assert from 'node:assert/strict';
import {assetApiFixture,assetSnapshot,companies,plain,sha} from './helpers/supplier-hub-single-assets.mjs';

const pdf=Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
async function fixture(company=companies[0]){
 const snapshot=assetSnapshot(company),raw=JSON.parse(snapshot.schemaString);
 raw.properties.legalPage={type:'object',properties:{certificates:{type:'array',items:{},allOf:['합성 인증 A','합성 인증 B'].map(name=>({contains:{type:'object',properties:{certificateName:{type:'string',enum:[name]},certificateValue:{type:'string',enum:['CERT-A','CERT-B']}},required:['certificateName','certificateValue']}}))}},required:['certificates']};
 snapshot.schemaString=JSON.stringify(raw);
 const f=await assetApiFixture(company,snapshot);
 // This fixture originally uses an explicitly queried legacy profile. Mirror
 // a newly collected product's saved category link for the legal API, whose
 // targets deliberately come from the captured selection rather than a URL.
 f.h.context.category=f.profile;f.h.context.company={...company};
 f.h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(f.h.context),'job');
 f.h.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run(f.h.sourceUrl,f.id);
 f.h.sqlite.prepare('INSERT INTO collection_products(job_id,owner_id,product_id,created_at) VALUES(?,?,?,?)').run('job','owner',f.id,new Date().toISOString());
 const quotation=await json(await f.h.route(f.base+'/quotation-fields'+f.query));
 const fields=quotation.resolved.schema.fields.filter(field=>field.hubWire?.path[0]==='legalPage');
 await json(await f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:quotation.revision,expectedInputFingerprint:quotation.inputFingerprint,
  changes:fields.map(field=>({optionId:null,fieldKey:field.id,value:'CERT-A'}))}}));
 const api=f.h.load('app/api/products/[id]/legal-documents/route.ts'),context={params:Promise.resolve({id:f.id})};
 const send=(method,body,query='')=>api[method](new Request('https://app.test'+f.base+'/legal-documents'+query,{method,...(body instanceof FormData?{body}:body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})}),context);
 const before=await json(await send('GET')),form=new FormData();form.set('expectedRevision',String(before.revision));form.set('file',new File([pdf],'한글 인증 원본.pdf'));
 const uploaded=await json(await send('POST',form),201);
 const target=uploaded.native.targets.find(target=>target.binding.certificate?.schemaIndex===0);
 assert.ok(target,JSON.stringify(uploaded.native));
 const bind=()=>send('PATCH',{expectedRevision:uploaded.revision,binding:{key:uploaded.documents.files[0].key,targetId:target.id,expectedSchemaSha256:uploaded.native.schemaSha256}});
 return {...f,send,uploaded,bind,fields};
}
for(const company of companies)test(`${company.code}: actual Single package binds a private original plan to exact source and preserves the required transport block`,async()=>{
 const f=await fixture(company);try{
  const before=await json(await f.h.route(f.endpoint));
  assert.equal(before.nativeLegalAttachmentPlan.metadataValid,false);
  const bound=await json(await f.bind()),view=await json(await f.h.route(f.endpoint)),plan=view.nativeLegalAttachmentPlan;
  assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues));
  assert.equal(plan.files.length,1);assert.equal(plan.files[0].originalName,'한글 인증 원본.pdf');assert.equal(plan.files[0].transportName,'cert0-한글 인증 원본.pdf');
  assert.equal(plan.files[0].key,bound.documents.files[0].key);assert.equal(plan.files[0].sha256,sha(pdf));assert.equal(plan.files[0].byteLength,pdf.byteLength);
  assert.deepEqual(plain(plan.identity.company),company);assert.equal(plan.identity.productId,f.id);assert.equal(plan.identity.categoryId,snapshotCategory(f));
  assert.deepEqual(plain(plan.identity.members),view.options.map((row,documentIndex)=>({...plain(row),documentIndex})));
  assert.deepEqual(plain(plan.identity.source),plain(view.source));assert.equal(plan.identity.inputFingerprint,view.inputFingerprint);
  assert.equal(plan.identity.schemaSha256,view.schemaSha256);assert.ok(/^[a-f0-9]{64}$/.test(plan.planSha256));
  for(const key of ['bytesVerified','transportReady','registered','remoteWrites','submissionReady'])assert.equal(plan[key],false,key);
  assert.equal(view.review.canPrepare,false);assert.ok(view.review.issues.some(issue=>issue.code==='SINGLE_LEGAL_DOCUMENT_TRANSPORT_UNVERIFIED'));
  assert.equal(view.prepared,false);assert.equal(view.registered,false);assert.equal(view.remoteWrites,false);assert.equal(view.payload.docId,null);
  assert.ok(!JSON.stringify(view.payload).includes('legal-'));assert.notEqual(before.fingerprint,view.fingerprint);
  const repeat=await json(await f.h.route(f.endpoint));assert.equal(repeat.fingerprint,view.fingerprint);assert.equal(repeat.nativeLegalAttachmentPlan.planSha256,plan.planSha256);
  const captured=await json(await f.h.route(f.base+'/supplier-hub-single-package'));
  assert.equal(captured.nativeLegalAttachmentPlan.metadataValid,true,JSON.stringify(captured.nativeLegalAttachmentPlan.issues));
  assert.equal(captured.nativeLegalAttachmentPlan.identity.source.profileId,f.profile.id);
  assert.equal(captured.nativeLegalAttachmentPlan.identity.source.profileRevision,null,'captured selection has no queried live-profile revision');
  assert.equal(captured.nativeLegalAttachmentPlan.identity.schemaSha256,view.schemaSha256);
  assert.notEqual(captured.nativeLegalAttachmentPlan.planSha256,plan.planSha256,'captured and explicitly queried source clocks stay distinct');
  const download=await f.send('GET',undefined,'?key='+encodeURIComponent(plan.files[0].key));assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),pdf);
  assert.deepEqual(f.h.network,[]);assert.equal([...f.h.objects.keys()].filter(key=>key.startsWith('quotation-public-detail/')).length,0);
  assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM supplier_hub_receipts').get().n,0);
 }finally{f.close();}
});
function snapshotCategory(f){return f.profile.categoryId;}
test('editing the saved certificate value invalidates old original mapping without mutating its bytes or sending a request',async()=>{
 const f=await fixture();try{
  await json(await f.bind());const before=await json(await f.h.route(f.endpoint)),original=before.nativeLegalAttachmentPlan.files[0],quotation=await json(await f.h.route(f.base+'/quotation-fields'+f.query));
  await json(await f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:quotation.revision,expectedInputFingerprint:quotation.inputFingerprint,
   changes:f.fields.map(field=>({optionId:null,fieldKey:field.id,value:'CERT-B'}))}}));
  const after=await json(await f.h.route(f.endpoint));assert.notEqual(after.fingerprint,before.fingerprint);assert.equal(after.nativeLegalAttachmentPlan.metadataValid,false);
  assert.equal(after.nativeLegalAttachmentPlan.files.length,0);assert.equal(after.prepared,false);assert.deepEqual(Buffer.from(f.h.objects.get(original.key)),pdf);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
for(const company of companies)test(`${company.code}: private authenticated original GET feeds verified transport parts; changed binary is rejected before any upload`,async()=>{
 const f=await fixture(company);try{
  await json(await f.bind());const view=await json(await f.h.route(f.endpoint)),plan=plain(view.nativeLegalAttachmentPlan);
  const {prepareNativeLegalBytes}=await import('../extensions/supplier-hub/native-legal-bytes.mjs');
  let reads=0;const readOriginal=async file=>{reads++;const response=await f.send('GET',undefined,file.downloadPath.slice(file.downloadPath.indexOf('?')));if(response.status!==200)throw Error('original not verified');return response.arrayBuffer();};
  const prepared=await prepareNativeLegalBytes(plan,{expectedIdentity:plain(plan.identity),expectedPlanSha256:view.nativeLegalAttachmentPlan.planSha256,readOriginal});
  assert.equal(reads,1);assert.equal(prepared.bytesVerified,true);assert.equal(prepared.transportReady,false);assert.equal(prepared.remoteWrites,false);assert.equal(prepared.registered,false);
  assert.equal(prepared.groups[0].nativeType,'certificate');const part=prepared.groups[0].parts[0];assert.equal(part.name,'uploadFiles');assert.equal(part.transportName,'cert0-한글 인증 원본.pdf');assert.deepEqual(Buffer.from(await part.file.arrayBuffer()),pdf);
  const changed=Buffer.from(pdf);changed[changed.length-1]^=1;f.h.objects.set(plan.files[0].key,changed);
  await assert.rejects(prepareNativeLegalBytes(plan,{expectedIdentity:plain(plan.identity),expectedPlanSha256:view.nativeLegalAttachmentPlan.planSha256,readOriginal}));
  assert.deepEqual(f.h.network,[]);assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM supplier_hub_receipts').get().n,0);
 }finally{f.close();}
});
test('a certificate original containing another row token is preserved privately and blocked visibly before native preparation',async()=>{
 const f=await fixture();try{
  await json(await f.bind());const before=await json(await f.send('GET')),form=new FormData();
  form.set('expectedRevision',String(before.revision));form.set('file',new File([pdf],'cert0-proof.pdf'));
  const uploaded=await json(await f.send('POST',form),201),file=uploaded.documents.files[1];
  const target=uploaded.native.targets.find(target=>target.binding.certificate?.schemaIndex===1);
  await json(await f.send('PATCH',{expectedRevision:uploaded.revision,binding:{key:file.key,targetId:target.id,expectedSchemaSha256:uploaded.native.schemaSha256}}));
  const view=await json(await f.h.route(f.endpoint)),plan=view.nativeLegalAttachmentPlan;
  assert.equal(plan.metadataValid,false);assert.deepEqual(plain(plan.files),[]);
  assert.ok(plan.issues.some(issue=>issue.code==='NATIVE_LEGAL_RESERVED_CERTIFICATE_NAME'&&issue.key===file.key));
  assert.ok(view.review.issues.some(issue=>issue.code==='NATIVE_LEGAL_RESERVED_CERTIFICATE_NAME'&&issue.level==='error'));
  assert.equal(view.prepared,false);assert.equal(view.remoteWrites,false);assert.equal(view.payload.docId,null);
  const original=await f.send('GET',undefined,'?key='+encodeURIComponent(file.key));assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),pdf);
  assert.equal((await json(await f.send('GET'))).documents.files[1].name,'cert0-proof.pdf');assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
