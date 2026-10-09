import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {readPackageZip,prepareAttachments} from '../extensions/supplier-hub/package.mjs';

const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
const plain=value=>JSON.parse(JSON.stringify(value));
const issues=report=>report.issues.filter(issue=>issue.code.startsWith('GENERATED_QUOTATION_LABEL_'));
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function fixture(company=schemaCompanies[0]){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 try{
  const snapshot={...hubSchemaSnapshot(company),inputBindings:'couplus-paths-v1'},schema=h.load('app/quotation-schema.ts').getQuotationSchema('991234',schemaPath,snapshot),fields=schema.fields.map(field=>field.id),workbook=new Uint8Array(quotationWorkbook(fields)),sha256=createHash('sha256').update(workbook).digest('hex'),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 견적 라벨 교체',categoryId:'991234',categoryPath:schemaPath,hubSchema:snapshot,template:{name:'synthetic-replacement.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,endpoint=base+'/quotation-fields?profileId=cat',read=()=>h.route(endpoint).then(json),before=await read(),included=before.resolved.rows.filter(row=>row.included&&row.optionId),selected=included[0].optionId,other=included[1].optionId;
  const get=h.bindings.FILES.get;h.bindings.FILES.get=async(key,options)=>{const object=await get(key);if(!object)return null;const bytes=new Uint8Array(await object.arrayBuffer());return{...object,body:new Response(bytes.slice(options?.range?.offset??0,(options?.range?.offset??0)+(options?.range?.length??bytes.length))).body};};
  const calls=[],request=async(path,init={})=>{calls.push({path,method:init.method??'GET'});return path==='/api/files'?h.load('app/api/files/route.ts').POST(new Request('https://app.test'+path,{method:'POST',body:init.body})):h.route(path,{method:init.method??'GET',...(init.body!==undefined?{body:JSON.parse(init.body)}:{})});};
  const save=(view,changes)=>h.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}).then(json);
  const target=view=>h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(view.resolved.schema.fields,'labelImages');
  const refs=(view,id=selected)=>view.resolved.rows.find(row=>row.optionId===id).fields[target(view).primary].value.split('\n').filter(Boolean);
  const attach=async(optionId=selected,view,fetcher=request)=>h.load('app/quotation-label-attachment.ts').attachQuotationLabel({productId:product.id,endpoint,renderedView:view??await read(),optionId,blob:new Blob([png],{type:'image/png'}),uploadedKey:null,onUploaded(){}},fetcher);
  const review=()=>h.route(base+'/submission-review?profileId=cat').then(json);
  const source=()=>JSON.stringify(Object.fromEntries(['product_content','product_options','collection_context','collection_results'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()])));
  return{h,product,base,endpoint,fields,selected,other,before,calls,request,read,save,target,refs,attach,review,source};
 }catch(error){h.close();throw error;}
}

for(const company of schemaCompanies){
 test(`explicit regenerated v2 quotation PNG replaces its stale reference and preserves original bytes (${company.code})`,async()=>{
  const f=await fixture(company);try{
   let view=await f.read();const manual=view.imageKeys[0];view=await f.save(view,[...f.target(view).linked.map(fieldKey=>({fieldKey,optionId:f.selected,value:manual})),{fieldKey:'searchTags',optionId:f.other,value:'다른 옵션 직접 검색어'}]);
   view=await f.attach();const old=f.refs(view).find(key=>key!==manual),pool=[...view.imageKeys],source=f.source(),original=f.h.objects.get(old).slice(),meta=(await f.h.bindings.FILES.head(old)).customMetadata;
   assert.equal(meta.quotationLabelRecipe,'quotation-label-png-v2');assert.equal(meta.quotationLabelProductId,f.product.id);assert.equal(meta.quotationLabelOptionId,f.selected);assert.equal(meta.quotationLabelProfileId,'cat');assert.deepEqual(issues(await f.review()),[]);
   view=await f.save(view,[{fieldKey:'model',optionId:f.selected,value:'새로 저장한 모델'}]);const before=plain(view.overrides),objects=f.h.objects.size;
   const stale=issues(await f.review());assert.equal(stale.length,1);assert.equal(stale[0].code,'GENERATED_QUOTATION_LABEL_STALE');assert.equal(stale[0].optionId,f.selected);
   const preview=await json(await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:'cat'}}));assert.equal(issues(preview.submissionReview)[0].code,'GENERATED_QUOTATION_LABEL_STALE');
   const bundle=await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'export',profileId:'cat',fingerprint:preview.fingerprint}});assert.equal(bundle.status,200,await bundle.clone().text());
   const bytes=new Uint8Array(await bundle.arrayBuffer()),zip=readPackageZip(bytes),report=JSON.parse(new TextDecoder().decode(zip.get('submission-review.json')));assert.equal(issues(report)[0].code,'GENERATED_QUOTATION_LABEL_STALE');await assert.rejects(prepareAttachments(bytes),/수정이 필요한 오류/);
   assert.deepEqual(plain((await f.read()).overrides),before);assert.equal(f.h.objects.size,objects,'read-only review/export/extension rejection never regenerates or mutates files');
   const other=plain(view.overrides.options[f.other]),next=await f.attach(f.selected,view),keys=f.refs(next);assert.equal(keys.length,2);assert.equal(keys[0],manual);assert.notEqual(keys[1],old);assert.ok(!keys.includes(old));assert.ok(pool.every(key=>next.imageKeys.includes(key)));assert.ok(next.imageKeys.includes(old));assert.deepEqual(f.h.objects.get(old),original);assert.deepEqual((await f.h.bindings.FILES.head(old)).customMetadata,meta);assert.deepEqual(plain(next.overrides.options[f.other]),other);assert.deepEqual(issues(await f.review()),[]);assert.equal(f.source(),source);
   const count=f.h.objects.size,writes=f.calls.filter(call=>call.method==='PUT').length;await f.attach(f.selected,next);assert.equal(f.h.objects.size,count);assert.equal(f.calls.filter(call=>call.method==='PUT').length,writes,'retry of a current proven label has no duplicate reference write');assert.equal(f.h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');assert.ok(!f.h.network.includes('supplier.coupang.com'));
  }finally{f.h.close();}
 });

 test(`replacement scope retains manual, legacy and another option's proven quotation PNG (${company.code})`,async()=>{
  const f=await fixture(company);try{
   let view=await f.attach();const old=f.refs(view)[0];view=await f.attach(f.other,view);const otherKey=f.refs(view,f.other)[0],manual=view.imageKeys.find(key=>key!==old&&key!==otherKey);
   const form=new FormData();form.set('file',new File([png],'sourceflow-quotation-label.png',{type:'image/png'}));form.set('labelUploadId','f'.repeat(64));const legacy=await json(await f.h.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:form})),201);
   await json(await f.h.route(f.base+'/attachments',{method:'POST',body:{key:legacy.key,role:null,expectedVersion:view.productVersion,expectedContentRevision:view.contentRevision}}));view=await f.read();
   view=await f.save(view,f.target(view).linked.map(fieldKey=>({fieldKey,optionId:f.selected,value:[manual,old,legacy.key,otherKey].join('\n')})));view=await f.save(view,[{fieldKey:'model',optionId:f.selected,value:'교체 대상 모델'}]);
   const source=f.source(),other=plain(view.overrides.options[f.other]),pool=[...view.imageKeys],originals=new Map(pool.map(key=>[key,f.h.objects.get(key).slice()]));view=await f.attach(f.selected,view);const refs=f.refs(view);
   assert.deepEqual(refs.slice(0,3),[manual,legacy.key,otherKey]);assert.equal(refs.length,4);assert.ok(!refs.includes(old));assert.ok(pool.every(key=>view.imageKeys.includes(key)));for(const [key,bytes]of originals)assert.deepEqual(f.h.objects.get(key),bytes);assert.deepEqual(plain(view.overrides.options[f.other]),other);assert.equal(f.source(),source);assert.equal((await f.h.bindings.FILES.head(legacy.key)).customMetadata.quotationLabelRecipe,undefined);
  }finally{f.h.close();}
 });
}

test('a source change during v2 PNG upload preserves the uploaded file but cannot connect its stale plan',async()=>{
 const f=await fixture();try{
  const reviewed=await f.read(),objects=f.h.objects.size,put=f.h.bindings.FILES.put;let key,changed=false;
  f.h.bindings.FILES.put=async(...args)=>{const response=await put(...args);if(!changed&&args[0].includes('/quotation-label-')){changed=true;key=args[0];await f.save(await f.read(),[{fieldKey:'model',optionId:f.selected,value:'업로드 중 바뀐 모델'}]);}return response;};
  await assert.rejects(f.attach(f.selected,reviewed),/변경/);const current=await f.read();assert.ok(key);assert.equal(f.h.objects.size,objects+1);assert.deepEqual(f.h.objects.get(key),png);assert.ok(!current.imageKeys.includes(key));assert.ok(!f.refs(current).includes(key));assert.equal(f.calls.filter(call=>call.path.endsWith('/attachments')).length,0);assert.equal(f.calls.filter(call=>call.method==='PUT').length,0);
 }finally{f.h.close();}
});

test('a concurrent quotation write after the attachment prevents replacing existing label references',async()=>{
 const f=await fixture();try{
  let view=await f.attach();const old=f.refs(view)[0];view=await f.save(view,[{fieldKey:'model',optionId:f.selected,value:'새 모델'}]);let conflict=false;
  const request=async(path,init={})=>{if(init.method==='PUT'&&!conflict){conflict=true;await f.save(await f.read(),[{fieldKey:'searchTags',optionId:f.other,value:'다른 화면의 직접 수정'}]);}return f.request(path,init);};
  await assert.rejects(f.attach(f.selected,view,request),/변경|다른/);const current=await f.read();assert.deepEqual(f.refs(current),[old]);assert.equal(current.resolved.rows.find(row=>row.optionId===f.other).fields.searchTags.value,'다른 화면의 직접 수정');assert.equal(current.imageKeys.length,view.imageKeys.length+1,'the new uploaded PNG stays in the library for an explicit retry');
 }finally{f.h.close();}
});

test('an already connected PNG cannot report success if a receipt read races with another quotation write',async()=>{
 const f=await fixture();try{
  let view=await f.attach();const own=f.refs(view)[0];view=await f.attach(f.other,view);const other=f.refs(view,f.other)[0];
  view=await f.save(view,f.target(view).linked.map(fieldKey=>({fieldKey,optionId:f.selected,value:[own,other].join('\n')})));
  const before=f.refs(view),objects=f.h.objects.size,otherReceipt='/api/files?labelUploadId='+/quotation-label-([a-f0-9]{64})\.png$/.exec(other)[1];let raced=false,reads=0;
  // Each fresh selection checks this preserved other-option receipt. Change
  // clocks during its last check, after the last reference snapshot was read.
  const request=async(path,init={})=>{const response=await f.request(path,init);if(path===otherReceipt&&++reads===3){raced=true;await f.save(await f.read(),[{fieldKey:'searchTags',optionId:f.other,value:'확인 중 다른 화면의 저장'}]);}return response;};
  const writes=f.calls.filter(call=>call.method==='PUT').length;await assert.rejects(f.attach(f.selected,view,request),/변경/);assert.equal(raced,true);assert.deepEqual(f.refs(await f.read()),before);assert.equal(f.h.objects.size,objects);assert.equal(f.calls.filter(call=>call.method==='PUT').length,writes,'a stale no-op receipt neither claims a confirmed save nor starts another write');
 }finally{f.h.close();}
});
