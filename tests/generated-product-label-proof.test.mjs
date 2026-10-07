import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';
import { readPackageZip } from '../extensions/supplier-hub/package.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=', 'base64'));
const companies = [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
const labelIssues = report => report.issues.filter(issue => issue.code.startsWith('GENERATED_PRODUCT_LABEL_'));
async function json(response) { assert.equal(response.status,200,response.status+': '+await response.clone().text()); return response.json(); }

// Real routes and ephemeral SQLite; stored image bytes and the mapped XLSX are
// local fixtures. No operating product, seller media or Hub record is written.
async function fixture(company=companies[0]) {
 const api=mobileIntakeHarness(company);
 try {
  const get=api.bindings.FILES.get;
  api.bindings.FILES.get=async(key,options)=>{const object=await get(key),bytes=api.objects.get(key);if(!object||!bytes)return object;const offset=options?.range?.offset??0,end=options?.range?.length===undefined?bytes.byteLength:offset+options.range.length;return {...object,body:new Response(bytes.slice(offset,end)).body};};
  const schema=api.load('app/quotation-schema.ts').getQuotationSchema('80719'),fields=schema.fields.map(field=>field.id),workbook=new Uint8Array(quotationWorkbook(fields));
  const sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex'),storageKey=api.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');api.objects.set(storageKey,workbook);
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'생성 제품 라벨 원천 시험',categoryId:'80719',categoryPath:schema.categoryPath,
   template:{name:'synthetic-label-proof.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  api.context.category=profile;api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(api.context),'job');await api.intake();
  const product=api.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,endpoint=base+'/product-labels?profileId=cat',quotationEndpoint=base+'/quotation-fields?profileId=cat';
  const quotation=await json(await api.route(quotationEndpoint)),selected=quotation.resolved.rows.find(row=>row.optionId),other=quotation.resolved.rows.filter(row=>row.optionId)[1];
  const calls=[];
  const request=async(url,init={})=>{calls.push({url,method:init.method??'GET'});return url==='/api/files'?api.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:init.body})):api.route(url,{method:init.method??'GET',...(init.body!==undefined?{body:JSON.parse(init.body)}:{})});};
  const read=()=>api.route(endpoint).then(json),readQuotation=()=>api.route(quotationEndpoint).then(json);
  const save=(view,changes)=>api.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}).then(json);
  const quoteSave=(view,changes)=>api.route(quotationEndpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}).then(json);
  const attach=async(optionId=selected.optionId)=>api.load('app/product-label-attachment.ts').attachProductLabel({productId:product.id,endpoint,quotationEndpoint,renderedView:await read(),optionId,blob:new Blob([png],{type:'image/png'}),uploadedKey:null,onUploaded(){}},request);
  const review=()=>api.route(base+'/submission-review?profileId=cat').then(json),preview=()=>api.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:'cat'}}).then(json);
  return {api,product,base,endpoint,quotationEndpoint,fields,selected,other,calls,request,read,readQuotation,save,quoteSave,attach,review,preview};
 } catch(error) {api.close();throw error;}
}

for(const company of companies) test(`server-marked nine-row PNG freshness reaches saved review, workbook preview and handoff package (${company.companyCode})`,async()=>{
 const f=await fixture(company);try{
  let view=await f.read();view=await f.save(view,[{optionId:f.selected.optionId,fieldKey:'productName',value:'직접 확인한 제품명'},{optionId:f.selected.optionId,fieldKey:'material',value:'라벨 원료 A'},{optionId:f.selected.optionId,fieldKey:'manufacturer',value:'라벨 제조원 A'}]);
  const content=f.api.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.product.id).payload,options=f.api.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.product.id).payload;
  const attached=await f.attach(),key=attached.key,metadata=(await f.api.bindings.FILES.head(key)).customMetadata;
  assert.equal(metadata.productLabelRecipe,'product-label-png-v1');assert.equal(metadata.productLabelProductId,f.product.id);assert.equal(metadata.productLabelOptionId,f.selected.optionId);assert.equal(metadata.productLabelProfileId,'cat');assert.match(metadata.productLabelPlanSha256,/^[a-f0-9]{64}$/);assert.match(metadata.productLabelSourceFingerprint,/^[a-f0-9]{64}$/);
  assert.deepEqual(labelIssues(await f.review()),[]);assert.deepEqual(labelIssues((await f.preview()).submissionReview),[]);
  const beforeQuote=plain((await f.readQuotation()).overrides);
  for(const [fieldKey,value] of [['material','수정한 원료 B'],['manufacturer','수정한 제조원 B'],['productName','수정한 제품명 B']]){
   view=await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey,value}]);assert.equal(view.rows.find(row=>row.optionId===f.selected.optionId).values[fieldKey],value);
   const issues=labelIssues(await f.review());assert.equal(issues.length,1);assert.equal(issues[0].code,'GENERATED_PRODUCT_LABEL_STALE');assert.equal(issues[0].optionId,f.selected.optionId);assert.equal(issues[0].fieldId,'labelImages');
   assert.deepEqual(plain((await f.readQuotation()).overrides),beforeQuote);assert.deepEqual(f.api.objects.get(key),png);assert.equal((await f.api.bindings.FILES.head(key)).customMetadata.productLabelPlanSha256,metadata.productLabelPlanSha256);
  }
  const preview=await f.preview();assert.equal(labelIssues(preview.submissionReview)[0].code,'GENERATED_PRODUCT_LABEL_STALE');
  const exported=await f.api.route(f.base+'/quotation',{method:'POST',body:{action:'export',profileId:'cat',fingerprint:preview.fingerprint}});assert.equal(exported.status,200,await exported.clone().text());
  const zip=readPackageZip(new Uint8Array(await exported.arrayBuffer())),report=JSON.parse(new TextDecoder().decode(zip.get('submission-review.json'))),plan=JSON.parse(new TextDecoder().decode(zip.get('supplier-hub-upload-plan.json')));
  assert.equal(labelIssues(report)[0].code,'GENERATED_PRODUCT_LABEL_STALE');assert.equal(plan.company.code,company.companyCode);const stored=plan.labelImages.find(item=>zip.get(item.archivePath)&&Buffer.from(zip.get(item.archivePath)).equals(Buffer.from(png)));assert.ok(stored);
  const workbook=zip.get(plan.quotation.file.filename);assert.ok(workbook);const reader=f.api.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(workbook.buffer.slice(workbook.byteOffset,workbook.byteOffset+workbook.byteLength)));assert.equal(reader.xlsxHeaders(sheet,'견적서',2)[f.fields.indexOf('labelImages')],stored.filename);
  assert.equal(f.api.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.product.id).payload,content);assert.equal(f.api.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.product.id).payload,options);assert.equal(f.api.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(f.product.id).supplier_hub_status,'미전송');assert.ok(!f.api.network.includes('supplier.coupang.com'));
 }finally{f.api.close();}
});

test('price and nonprinted option-name changes preserve the exact generated plan despite newer source clocks',async()=>{
 const f=await fixture();try{
  await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'productName',value:'가격·옵션명과 독립인 제품명'}]);const attached=await f.attach(),before=await f.read(),metadata=(await f.api.bindings.FILES.head(attached.key)).customMetadata;
  const options=await json(await f.api.route(f.base+'/options')),names=Object.keys(f.api.load('app/product-options.ts').optionFieldNames),rows=options.options.rows.map(row=>Object.fromEntries(['id',...names].filter(key=>row[key]!==undefined).map(key=>[key,row[key]])));
  const chosen=rows.find(row=>row.id===f.selected.optionId);chosen.unitCostCny+=2;chosen.translatedName='새 옵션 표시명';
  await json(await f.api.route(f.base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
  const after=await f.read();assert.notEqual(after.productVersion,before.productVersion);assert.notEqual(after.inputFingerprint,before.inputFingerprint);assert.notEqual(after.rows.find(row=>row.optionId===f.selected.optionId).optionLabel,before.rows.find(row=>row.optionId===f.selected.optionId).optionLabel);
  assert.deepEqual(plain(f.api.load('app/product-label.ts').productLabelPlan(after,f.selected.optionId)),plain(f.api.load('app/product-label.ts').productLabelPlan(before,f.selected.optionId)));
  assert.deepEqual(labelIssues(await f.review()),[]);assert.deepEqual(labelIssues((await f.preview()).submissionReview),[]);assert.deepEqual((await f.api.bindings.FILES.head(attached.key)).customMetadata,metadata);
 }finally{f.api.close();}
});

test('unmarked manual PNGs, old opaque recipes and quotation-notice PNGs are not guessed to be nine-row labels',async()=>{
 const f=await fixture();try{
  for(const uploadId of [null,'f'.repeat(64)]){
   const form=new FormData();form.set('file',new File([png],uploadId?'sourceflow-quotation-label.png':'manual-confirmed.png',{type:'image/png'}));if(uploadId)form.set('labelUploadId',uploadId);
   const response=await f.api.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:form}));assert.equal(response.status,201,await response.clone().text());const file=await response.json();
   const quote=await f.readQuotation();await json(await f.api.route(f.base+'/attachments',{method:'POST',body:{key:file.key,role:null,expectedVersion:quote.productVersion,expectedContentRevision:quote.contentRevision}}));
   const next=await f.readQuotation(),row=next.resolved.rows.find(row=>row.optionId===f.selected.optionId),target=f.api.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(next.resolved.schema.fields,'labelImages');
   await f.quoteSave(next,target.linked.map(fieldKey=>({optionId:f.selected.optionId,fieldKey,value:[row.fields[target.primary].value,file.key].filter(Boolean).join('\n')})));assert.equal((await f.api.bindings.FILES.head(file.key)).customMetadata.productLabelRecipe,undefined);
  }
  await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'material',value:'수정한 9행 재질'}]);const before=plain((await f.readQuotation()).overrides),count=f.api.objects.size;
  assert.deepEqual(labelIssues(await f.review()),[]);assert.deepEqual(labelIssues((await f.preview()).submissionReview),[]);assert.deepEqual(plain((await f.readQuotation()).overrides),before);assert.equal(f.api.objects.size,count);
 }finally{f.api.close();}
});

test('common generated proof is compared to each included final nine-row plan, and explicit image exclusion alone clears stale scope',async()=>{
 const f=await fixture();try{
  const common=f.api.load('app/product-label.ts').productLabelFields.map(({key})=>({optionId:null,fieldKey:key,value:key==='productName'?'공통으로 확인한 라벨':key==='importer'?'와이홉':'공통 '+key}));await f.save(await f.read(),common);const attached=await f.attach(null);
  assert.deepEqual(labelIssues(await f.review()),[]);await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'material',value:'개별 원료 직접 수정'}]);
  const issues=labelIssues(await f.review());assert.equal(issues.length,1);assert.equal(issues[0].optionId,f.selected.optionId);assert.equal(issues[0].code,'GENERATED_PRODUCT_LABEL_STALE');
  const regenerated=await f.attach();assert.notEqual(regenerated.key,attached.key);assert.equal(labelIssues(await f.review()).length,1,'appending a new PNG must not silently erase an older reference');
  const quote=await f.readQuotation(),target=f.api.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(quote.resolved.schema.fields,'labelImages');
  await f.quoteSave(quote,target.linked.map(fieldKey=>({optionId:f.selected.optionId,fieldKey,value:regenerated.key})));
  assert.deepEqual(labelIssues(await f.review()),[]);assert.ok(f.api.objects.has(attached.key));assert.ok((await f.readQuotation()).resolved.rows.find(row=>row.optionId===f.other.optionId).fields.labelImages.value.includes(attached.key));
 }finally{f.api.close();}
});

test('new generated upload proof rejects foreign sources, wrong recipes and stale CAS before creating any R2 object',async()=>{
 const f=await fixture();try{
  const proofModule=f.api.load('app/product-label-proof.ts'),upload=f.api.load('app/product-label-upload.ts'),view=await f.read(),context={productId:f.product.id,endpoint:f.endpoint,optionId:f.selected.optionId,view},proof=proofModule.productLabelProofRequest(context),uploadId=await upload.productLabelUploadId(context);
  const submit=async(proofValue,id=uploadId)=>{const form=new FormData();form.set('file',new File([png],'sourceflow-quotation-label.png',{type:'image/png'}));form.set('labelUploadId',id);form.set('productLabelProof',JSON.stringify(proofValue));return f.api.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:form}));};
  const count=f.api.objects.size;
  for(const invalid of [{...proof,endpoint:'https://foreign.test'+f.endpoint},{...proof,endpoint:f.endpoint+'&extra=1'},{...proof,optionId:'missing-SKU'},{...proof,expectedInputFingerprint:'0'.repeat(64)},{...proof,productId:'other-product',endpoint:'/api/products/other-product/product-labels?profileId=cat'}]){
   const response=await submit(invalid);assert.ok([400,409].includes(response.status),response.status+': '+await response.clone().text());assert.equal(f.api.objects.size,count);
  }
  assert.equal((await submit(proof,'e'.repeat(64))).status,409);assert.equal(f.api.objects.size,count);
  await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'material',value:'미리보기 후 변경'}]);assert.equal((await submit(proof)).status,409);assert.equal(f.api.objects.size,count);
  const current=await f.read(),fresh={...context,view:current},freshProof=proofModule.productLabelProofRequest(fresh),freshId=await upload.productLabelUploadId(fresh),response=await submit(freshProof,freshId);assert.equal(response.status,201,await response.clone().text());assert.equal(f.api.objects.size,count+1);
  const key=(await response.json()).key;assert.equal((await submit(freshProof,freshId)).status,200);assert.equal(f.api.objects.size,count+1);assert.equal((await f.api.bindings.FILES.head(key)).customMetadata.productLabelSourceFingerprint,current.inputFingerprint);
 }finally{f.api.close();}
});

test('source change during generated upload preserves bytes but refuses a current-source acknowledgement or automatic quotation write',async()=>{
 const f=await fixture();try{
  const view=await f.read(),proof=f.api.load('app/product-label-proof.ts').productLabelProofRequest({productId:f.product.id,endpoint:f.endpoint,optionId:f.selected.optionId,view}),id=await f.api.load('app/product-label-upload.ts').productLabelUploadId({productId:f.product.id,endpoint:f.endpoint,optionId:f.selected.optionId,view});
  const put=f.api.bindings.FILES.put;let key;f.api.bindings.FILES.put=async(...args)=>{const result=await put(...args);key=args[0];await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'material',value:'업로드 중 새 저장값'}]);return result;};
  const form=new FormData();form.set('file',new File([png],'sourceflow-quotation-label.png',{type:'image/png'}));form.set('labelUploadId',id);form.set('productLabelProof',JSON.stringify(proof));
  const response=await f.api.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:form}));assert.equal(response.status,409,await response.clone().text());assert.deepEqual(f.api.objects.get(key),png);assert.equal((await f.readQuotation()).imageKeys.includes(key),false);assert.ok(!(await f.readQuotation()).resolved.rows.some(row=>row.fields.labelImages.value.includes(key)));
 }finally{f.api.close();}
});

test('marked proof corruption remains visible, while foreign image keys are never headed by the freshness inspector',async()=>{
 const f=await fixture();try{
  const attached=await f.attach(),head=f.api.bindings.FILES.head;
  for(const corrupted of [{productLabelProductId:'other-product'},{productLabelProfileId:undefined},{productLabelProfileId:42},{productLabelProfileId:'../cat'}]){
   f.api.bindings.FILES.head=async key=>{const object=await head(key);return key===attached.key?{...object,customMetadata:{...object.customMetadata,...corrupted}}:object;};
   const issues=labelIssues(await f.review());assert.equal(issues.length,1);assert.equal(issues[0].code,'GENERATED_PRODUCT_LABEL_UNCONFIRMED');assert.deepEqual(f.api.objects.get(attached.key),png);
  }
  const quote=await f.readQuotation(),resolved=plain(quote.resolved);resolved.rows=resolved.rows.filter(row=>row.optionId===f.selected.optionId);resolved.rows[0].fields.labelImages.value='foreign-owner/private.png';let reads=0;
  const result=await f.api.load('app/product-label-proof.ts').inspectGeneratedProductLabels({ownerId:'owner',productId:f.product.id,profileId:'cat',resolved,head:async()=>{reads++;return null;},readView:async()=>{throw Error('must not read foreign source');}});assert.deepEqual(plain(result),[]);assert.equal(reads,0);
 }finally{f.api.close();}
});
