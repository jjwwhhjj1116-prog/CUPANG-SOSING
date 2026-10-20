import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const pdf=Buffer.concat([Buffer.from('%PDF-1.7\n%'),Buffer.from([255,254]),Buffer.from('\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n')]);
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const object=(properties,required=[])=>({type:'object',properties,required});
async function fixture(company=companies[0]){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});h.bindings.FILES.delete=async key=>h.objects.delete(key);
 h.bindings.YOOFAM_AUTH_ENABLED='true';const now=new Date().toISOString(),email=company.code==='A01526306'?'jwhj1116@kakao.com':'unari8484@gmail.com',role=company.code==='A01526306'?'admin':'member';
 h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('owner',email,'synthetic-not-a-password',role,'approved',company.code,company.name,now,now);
 const raw=object({startPage:object({productName:{type:'string'},categoryPath:{type:'string'}},['productName','categoryPath']),productPage:object({}),legalPage:object({certificates:{type:'array',items:{},allOf:['합성 인증 A','합성 인증 B'].map(name=>({contains:object({certificateName:{type:'string',enum:[name]},certificateValue:{type:'string',enum:['CERT-A','CERT-B']}},['certificateName','certificateValue'])}))},msds:{type:'string',enum:['Y','N']}},['certificates'])},['startPage','productPage','legalPage']);
 raw.metadata='scope:Retail_Categorized_Single;categoryId:754;version:1;productNoticeCategoryId:25';
 const snapshot={format:'supplier-hub-schema-v1',categoryId:'80719',categoryPath:[...h.context.category.categoryPath],company:{...company},observedAt:Date.now(),schemaString:JSON.stringify(raw),metadata:{scopeType:'Retail_Categorized_Single',kanCategoryId:754,version:1,noticeNumber:25},draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1'};
 const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 인증 연결 양식',categoryId:'80719',categoryPath:snapshot.categoryPath,template:null,mappings:[],hubSchema:snapshot},'cat');
 h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
 await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(h.settings));
 const receipt={schemaVersion:1,offerId:'813724060928',sourceUrl:h.sourceUrl,provider:'synthetic-native-legal-local-only',collectedAt:now,title:'합성 법적 서류 상품',description:'합성 설명',attributes:[],images:[],
  options:['black','white'].map(sku=>({sku:'synthetic-'+sku,name:sku,unitPriceCny:5,minimumOrder:1,stock:null}))};
 await h.load('db/collection-results.ts').storeCollectionResult('owner','job',receipt);
 const product=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'})),id=product.productId,base='/api/products/'+id;
 let quotation=await json(await h.route(base+'/quotation-fields'));
 const legalFields=quotation.resolved.schema.fields.filter(field=>field.hubWire?.path[0]==='legalPage');
 await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:quotation.revision,expectedInputFingerprint:quotation.inputFingerprint,changes:legalFields.map(field=>({optionId:null,fieldKey:field.id,value:field.hubWire.path[1]==='msds'?'Y':'CERT-A'}))}}));
 const api=h.load('app/api/products/[id]/legal-documents/route.ts'),context={params:Promise.resolve({id})};
 const send=(method,body,query='')=>api[method](new Request('https://app.test'+base+'/legal-documents'+query,{method,...(body instanceof FormData?{body}:body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})}),context);
 const upload=async()=>{const current=await json(await send('GET')),form=new FormData();form.set('expectedRevision',String(current.revision));form.set('file',new File([pdf],'합성 인증 원본.pdf'));return json(await send('POST',form),201);};
 const saved=await upload();assert.ok(saved.native?.targets.length,JSON.stringify(saved));
 const bind=(view=saved,target=view.native.targets.find(target=>target.binding.nativeType==='certificate'))=>send('PATCH',{expectedRevision:view.revision,binding:{key:view.documents.files[0].key,targetId:target.id,expectedSchemaSha256:view.native.schemaSha256}});
 return {h,id,base,profile,snapshot,send,saved,bind,legalFields,close:()=>h.close()};
}
const quote=f=>f.h.sqlite.prepare('SELECT * FROM product_quotation_fields WHERE product_id=?').get(f.id);
const content=f=>f.h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(f.id);
const originals=f=>[...f.h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('hex')]);

for(const company of companies)test(`${company.code}: actual legal API explicitly binds/unlinks a saved original PDF without changing binary identity or stage-seven values`,async()=>{
 const f=await fixture(company);try{
  const original=f.saved.documents.files[0],bytes=originals(f),quotation=quote(f),beforeContent=JSON.parse(content(f).payload);
  assert.equal(original.nativeBinding,undefined);assert.ok(f.saved.native.issues.some(issue=>issue.code==='NATIVE_LEGAL_UNBOUND'));
  const bound=await json(await f.bind());assert.equal(bound.revision,f.saved.revision+1);const file=bound.documents.files[0];
  for(const key of ['key','name','byteLength','sha256','type'])assert.equal(file[key],original[key]);
  assert.equal(file.nativeBinding.nativeType,'certificate');assert.equal(file.nativeBinding.certificate.schemaIndex,0);assert.equal(file.nativeBinding.certificate.value,'CERT-A');
  assert.deepEqual(quote(f),quotation);assert.deepEqual(originals(f),bytes);
  const afterContent=JSON.parse(content(f).payload);for(const key of Object.keys(beforeContent).filter(key=>!['revision','updatedAt','legalDocuments'].includes(key)))assert.deepEqual(afterContent[key],beforeContent[key],key);
  const downloaded=await f.send('GET',undefined,'?key='+encodeURIComponent(file.key));assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),pdf);
  assert.equal((await json(await f.bind(f.saved),409)).documents,undefined,'stale content revision is never acknowledged as a binding');
  const unbound=await json(await f.send('PATCH',{expectedRevision:bound.revision,binding:{key:file.key,targetId:null,expectedSchemaSha256:file.nativeBinding.schemaSha256}}));
  assert.equal(unbound.documents.files[0].nativeBinding,undefined);assert.deepEqual(unbound.documents.files[0],original);assert.deepEqual(quote(f),quotation);assert.deepEqual(originals(f),bytes);
  assert.deepEqual(f.h.network,[]);assert.equal(f.h.aiSources.length,0);assert.equal(f.h.stats.downloads,0);
 }finally{f.close();}
});

test('stale schema hash, wrong target and original file key fail without modifying saved documents or quotation',async()=>{
 const f=await fixture();try{
  const baseline=content(f),quotation=quote(f),target=f.saved.native.targets[0];
  for(const [change,status] of [[{key:f.saved.documents.files[0].key,targetId:target.id,expectedSchemaSha256:'0'.repeat(64)},409],
   [{key:f.saved.documents.files[0].key,targetId:'certificate:wrong',expectedSchemaSha256:f.saved.native.schemaSha256},400],
   [{key:'foreign/legal/product/legal-00000000-0000-4000-8000-000000000001.pdf',targetId:target.id,expectedSchemaSha256:f.saved.native.schemaSha256},404]])await json(await f.send('PATCH',{expectedRevision:f.saved.revision,binding:change}),status);
  assert.deepEqual(content(f),baseline);assert.deepEqual(quote(f),quotation);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('an obsolete binding can be removed explicitly with its stored hash even after the selected category profile becomes unavailable',async()=>{
 const f=await fixture();try{
  const bound=await json(await f.bind()),file=bound.documents.files[0],before=quote(f),bytes=originals(f);
  f.h.sqlite.prepare('DELETE FROM category_profiles WHERE id=?').run(f.profile.id);
  const unavailable=await json(await f.send('GET'));assert.equal(unavailable.native,null);assert.equal(unavailable.documents.files[0].nativeBinding.schemaSha256,file.nativeBinding.schemaSha256);
  const unbound=await json(await f.send('PATCH',{expectedRevision:unavailable.revision,binding:{key:file.key,targetId:null,expectedSchemaSha256:file.nativeBinding.schemaSha256}}));
  assert.equal(unbound.documents.files[0].nativeBinding,undefined);assert.equal(unbound.native,null);assert.deepEqual(quote(f),before);assert.deepEqual(originals(f),bytes);
 }finally{f.close();}
});

for(const mutation of ['content','schema','quotation','option','company','capturedContext'])test(`atomic legal binding CAS rejects a concurrent ${mutation} change and preserves the competing writer`,async()=>{
 const f=await fixture();try{
  const prepare=f.h.db.prepare.bind(f.h.db),batch=f.h.db.batch.bind(f.h.db),queries=new WeakMap(),bytes=originals(f);let changed=false,competingContent;
  f.h.db.prepare=sql=>{const statement=prepare(sql);queries.set(statement,sql);return statement;};
  f.h.db.batch=async statements=>{
   if(!changed&&statements.some(statement=>/^INSERT INTO product_content\(/u.test(queries.get(statement)??''))){
    changed=true;
    if(mutation==='content'){
     const current=JSON.parse(content(f).payload);current.revision++;current.seo.title.value='동시에 직접 저장한 제목';f.h.sqlite.prepare('UPDATE product_content SET revision=?,payload=? WHERE product_id=?').run(current.revision,JSON.stringify(current),f.id);
    }else if(mutation==='schema')f.h.sqlite.prepare('UPDATE category_profiles SET revision=revision+1 WHERE id=?').run(f.profile.id);
    else if(mutation==='quotation'){
     const row=quote(f),current=JSON.parse(row.payload),scoped=current.categoryOverrides['category:80719'];scoped.common[f.legalFields[0].id]='CERT-B';
     f.h.sqlite.prepare('UPDATE product_quotation_fields SET payload=? WHERE product_id=?').run(JSON.stringify(current),f.id);
    }else if(mutation==='option'){
     const row=f.h.sqlite.prepare('SELECT * FROM product_options WHERE product_id=?').get(f.id),current=JSON.parse(row.payload);current.revision++;current.rows[0].unitCostCny=9.25;
     f.h.sqlite.prepare('UPDATE product_options SET revision=?,payload=? WHERE product_id=?').run(current.revision,JSON.stringify(current),f.id);
    }else if(mutation==='company')f.h.sqlite.prepare('UPDATE members SET company_code=?,company_name=? WHERE id=?').run(companies[1].code,companies[1].name,'owner');
    else{const row=f.h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get('job'),current=JSON.parse(row.payload);current.keywords='다른 작업의 키워드';f.h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(current),'job');}
    competingContent=content(f);
   }
   return batch(statements);
  };
  await json(await f.bind(),409);assert.equal(changed,true);assert.deepEqual(content(f),competingContent,'binding cannot overwrite the concurrently committed content');
  assert.equal(JSON.parse(content(f).payload).legalDocuments.files[0].nativeBinding,undefined);assert.deepEqual(originals(f),bytes);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
