import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';
import { prepareAttachments, readPackageZip } from '../extensions/supplier-hub/package.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
const labelIssues=report=>report.issues.filter(issue=>issue.code.startsWith('GENERATED_QUOTATION_LABEL_'));
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
function snapshot(company){
 const named=name=>({contains:{type:'object',properties:{attributeName:{type:'string',enum:[name]},attributeValue:{type:'string'}}}});
 return {format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath:['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'],
  company:{code:company.companyCode,name:company.companyName},observedAt:Date.now(),inputBindings:'couplus-paths-v1',
  metadata:{displayCategoryCode:'69900',kanCategoryId:2624,scopeType:'Retail_Categorized_Single',noticeNumber:4,version:188},
  schemaString:JSON.stringify({type:'object',properties:{
   startPage:{type:'object',properties:{productName:{type:'string',title:'상품명'}}},
   productPage:{type:'object',properties:{brand:{type:'string',title:'브랜드'},
    commonAttributes:{type:'object',properties:{exposedAttributes:{type:'array',allOf:[named('색상'),named('패션의류/잡화 사이즈')]}}}}},
   legalPage:{type:'object',properties:{}},
  }})};
}

// Real routes, ephemeral SQLite and synthetic workbook/image bytes. The recorded
// source adapter is local; no operating product or Supplier Hub record is used.
async function fixture(company=companies[0]){
 const api=mobileIntakeHarness(company);
 try{
  const get=api.bindings.FILES.get;
  api.bindings.FILES.get=async(key,options)=>{const object=await get(key),bytes=api.objects.get(key);if(!object||!bytes)return object;const offset=options?.range?.offset??0,end=options?.range?.length===undefined?bytes.byteLength:offset+options.range.length;return {...object,body:new Response(bytes.slice(offset,end)).body};};
  const hubSchema=snapshot(company),schema=api.load('app/quotation-schema.ts').getQuotationSchema(hubSchema.categoryId,hubSchema.categoryPath,hubSchema);
  const headers=schema.fields.map(field=>field.id),workbook=new Uint8Array(quotationWorkbook(headers));
  const sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex'),storageKey=api.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');api.objects.set(storageKey,workbook);
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'견적 표시사항 원천 시험',categoryId:hubSchema.categoryId,categoryPath:hubSchema.categoryPath,hubSchema,
   template:{name:'synthetic-quotation-label.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers},mappings:headers.map((field,column)=>({field,column,required:false}))},'cat');
  api.context.category=profile;api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(api.context),'job');await api.intake();
  const product=api.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,endpoint=base+'/quotation-fields';
  const read=(url=endpoint)=>api.route(url).then(json);
  const save=(view,changes,url=endpoint)=>api.route(url,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}).then(json);
  let view=await read();const selected=view.resolved.rows.find(row=>row.optionId),other=view.resolved.rows.filter(row=>row.optionId)[1],color=view.resolved.schema.fields.find(field=>field.hubWire?.name==='색상');
  const legacyKey=view.imageKeys[3];
  view=await save(view,[...Object.entries({model:'SYNTHETIC-MODEL',taxType:'과세',kcMarkType:'해당사항없음',shelfLifeDays:'0',handlingReason:'해당사항없음',packagedWeightG:'100',packagedDimensionsMm:'100*100*100',labelImages:legacyKey}),[color.id,'합성 녹색']].map(([fieldKey,value])=>({fieldKey,optionId:null,value})));
  const proofModule=api.load('app/quotation-label-proof.ts'),uploadModule=api.load('app/quotation-label-upload.ts');
  const context=(value,optionId=selected.optionId,url=endpoint)=>({productId:product.id,endpoint:url,view:value,optionId});
  const make=async(value,optionId=selected.optionId,url=endpoint)=>{const input=context(value??await read(),optionId,url);return {proof:proofModule.quotationLabelProofRequest(input),uploadId:await uploadModule.quotationLabelUploadId(input)};};
  const upload=async(proof,uploadId,bytes=png,extra)=>{
   const form=new FormData();form.set('file',new File([bytes],'sourceflow-quotation-label.png',{type:'image/png'}));if(uploadId!==null)form.set('labelUploadId',uploadId);if(proof!==null)form.set('quotationLabelProof',JSON.stringify(proof));if(extra)extra(form);
   return api.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',headers:{origin:'https://app.test'},body:form}));
  };
  const connect=async(key,optionId=selected.optionId)=>{
   let current=await read();await json(await api.route(base+'/attachments',{method:'POST',body:{key,role:null,expectedVersion:current.productVersion,expectedContentRevision:current.contentRevision}}));
   current=await read();const row=current.resolved.rows.find(row=>row.optionId===optionId),target=api.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(current.resolved.schema.fields,'labelImages');
   return save(current,target.linked.map(fieldKey=>({optionId,fieldKey,value:[row.fields[target.primary].value,key].filter(Boolean).join('\n')})));
  };
  const attach=async()=>{const made=await make(),file=await json(await upload(made.proof,made.uploadId),201);await connect(file.key);return {...made,...file};};
  const review=()=>api.route(base+'/submission-review?profileId=cat').then(json),preview=()=>api.route(base+'/quotation',{method:'POST',body:{action:'preview'}}).then(json);
  const exported=async(value)=>{const response=await api.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:value.fingerprint}});assert.equal(response.status,200,await response.clone().text());return new Uint8Array(await response.arrayBuffer());};
  return {api,product,base,endpoint,headers,selected,other,color,legacyKey,read,save,make,upload,connect,attach,review,preview,exported,proofModule};
 }catch(error){api.close();throw error;}
}

for(const company of companies)test(`server-proven quotation PNG staleness blocks actual package preparation (${company.companyCode})`,async()=>{
 const f=await fixture(company);try{
  const originalContent=f.api.sqlite.prepare('SELECT payload FROM product_content').get().payload,originalOptions=f.api.sqlite.prepare('SELECT payload FROM product_options').get().payload;
  const attached=await f.attach(),metadata=(await f.api.bindings.FILES.head(attached.key)).customMetadata;
  assert.equal(metadata.quotationLabelRecipe,'quotation-label-png-v2');assert.equal(metadata.quotationLabelProductId,f.product.id);assert.equal(metadata.quotationLabelOptionId,f.selected.optionId);assert.equal(metadata.quotationLabelProfileId,'cat','an endpoint without profileId still uses the effective captured profile');
  const stored=await json(await f.api.route('/api/files?labelUploadId='+attached.uploadId));assert.deepEqual(stored.quotationLabelProof,attached.quotationLabelProof);assert.deepEqual(plain(f.proofModule.quotationLabelReceiptFromMetadata(metadata)),attached.quotationLabelProof);
  assert.deepEqual(labelIssues(await f.review()),[]);const ready=await f.preview();assert.equal(ready.submissionReview.errorCount,0);assert.ok(await prepareAttachments(await f.exported(ready)));
  await f.save(await f.read(),[{fieldKey:f.color.id,optionId:f.selected.optionId,value:'합성 파랑'}]);
  const issue=labelIssues(await f.review());assert.equal(issue.length,1);assert.equal(issue[0].code,'GENERATED_QUOTATION_LABEL_STALE');assert.equal(issue[0].kind,'error');assert.equal(issue[0].optionId,f.selected.optionId);
  const preview=await f.preview();assert.deepEqual(labelIssues(preview.submissionReview),issue);const bytes=await f.exported(preview),zip=readPackageZip(bytes),report=JSON.parse(new TextDecoder().decode(zip.get('submission-review.json'))),plan=JSON.parse(new TextDecoder().decode(zip.get('supplier-hub-upload-plan.json')));
  assert.equal(labelIssues(report)[0].code,'GENERATED_QUOTATION_LABEL_STALE');await assert.rejects(prepareAttachments(bytes),/수정이 필요한 오류/);
  const image=plan.labelImages.find(item=>Buffer.from(zip.get(item.archivePath)).equals(Buffer.from(png)));assert.ok(image);const reader=f.api.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(zip.get(plan.quotation.file.filename)));
  assert.ok(reader.xlsxHeaders(sheet,'견적서',2)[f.headers.indexOf('labelImages')].split('\n').includes(image.filename));
  assert.deepEqual(f.api.objects.get(attached.key),png);assert.deepEqual((await f.api.bindings.FILES.head(attached.key)).customMetadata,metadata);assert.equal(f.api.sqlite.prepare('SELECT payload FROM product_content').get().payload,originalContent);assert.equal(f.api.sqlite.prepare('SELECT payload FROM product_options').get().payload,originalOptions);assert.equal(f.api.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');assert.ok(!f.api.network.includes('supplier.coupang.com'));
 }finally{f.api.close();}
});

test('unchanged printed plans reuse their proof after price-only clocks change, while printed option names become stale',async()=>{
 const f=await fixture();try{
  const attached=await f.attach(),before=await f.read(),metadata=(await f.api.bindings.FILES.head(attached.key)).customMetadata;
  const options=await json(await f.api.route(f.base+'/options')),rows=f.api.load('app/product-options.ts').optionInputs(options.options),row=rows.find(row=>row.id===f.selected.optionId);row.unitCostCny+=2;
  await json(await f.api.route(f.base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
  const current=await f.read(),made=await f.make(current);assert.notEqual(current.productVersion,before.productVersion);assert.notEqual(current.inputFingerprint,before.inputFingerprint);assert.equal(made.uploadId,attached.uploadId);assert.deepEqual(labelIssues(await f.review()),[]);
  const reused=await json(await f.upload(made.proof,made.uploadId));assert.equal(reused.reused,true);assert.deepEqual(reused.quotationLabelProof,attached.quotationLabelProof);assert.deepEqual((await f.api.bindings.FILES.head(attached.key)).customMetadata,metadata);
  const latest=await json(await f.api.route(f.base+'/options')),renamed=f.api.load('app/product-options.ts').optionInputs(latest.options);renamed.find(row=>row.id===f.selected.optionId).translatedName='인쇄되는 새 옵션명';
  await json(await f.api.route(f.base+'/options',{method:'PATCH',body:{expectedRevision:latest.options.revision,expectedProductVersion:latest.productVersion,rows:renamed}}));assert.equal(labelIssues(await f.review())[0].code,'GENERATED_QUOTATION_LABEL_STALE');
 }finally{f.api.close();}
});

test('strict proof requests reject foreign endpoints, aliases, extra keys and stale or nonexistent saved scope before writing',async()=>{
 const f=await fixture();try{
  const made=await f.make(),count=f.api.objects.size;
  const malformed=[{...made.proof,endpoint:'https://foreign.test'+f.endpoint},{...made.proof,endpoint:'https://label.invalid'+f.endpoint},{...made.proof,endpoint:f.endpoint+'?profileId=cat&profileId=cat'},{...made.proof,endpoint:f.endpoint+'?other=cat'},{...made.proof,endpoint:f.endpoint+'#alias'},{...made.proof,endpoint:f.endpoint.replace('/quotation-fields','/product-labels')},{...made.proof,extra:'untrusted'},{...made.proof,optionId:''},{...made.proof,expectedRevision:-1},{...made.proof,expectedInputFingerprint:'A'.repeat(64)}];
  for(const proof of malformed){assert.throws(()=>f.proofModule.parseQuotationLabelProofRequest(proof));assert.equal((await f.upload(proof,made.uploadId)).status,400);assert.equal(f.api.objects.size,count);}
  for(const proof of [{...made.proof,optionId:'missing-SKU'},{...made.proof,productId:'other-product',endpoint:'/api/products/other-product/quotation-fields'},{...made.proof,endpoint:f.endpoint+'?profileId=missing'},{...made.proof,expectedInputFingerprint:'0'.repeat(64)}]){assert.equal((await f.upload(proof,made.uploadId)).status,409);assert.equal(f.api.objects.size,count);}
  assert.equal((await f.upload(made.proof,'e'.repeat(64))).status,409);assert.equal((await f.upload(made.proof,null)).status,400);
  assert.equal((await f.upload(made.proof,made.uploadId,png,form=>form.set('productLabelProof',JSON.stringify(made.proof)))).status,400);assert.equal((await f.upload(made.proof,made.uploadId,png,form=>form.append('quotationLabelProof',JSON.stringify(made.proof)))).status,400);
  await f.save(await f.read(),[{fieldKey:f.color.id,optionId:f.selected.optionId,value:'생성 뒤 새 저장값'}]);assert.equal((await f.upload(made.proof,made.uploadId)).status,409);assert.equal(f.api.objects.size,count);
 }finally{f.api.close();}
});

test('explicit profile query and captured profile both yield the same effective source identity without trusting query aliases',async()=>{
 const f=await fixture();try{
  const url=f.endpoint+'?profileId=cat',view=await f.read(url),made=await f.make(view,f.selected.optionId,url),file=await json(await f.upload(made.proof,made.uploadId),201);assert.equal(file.quotationLabelProof.profileId,'cat');
  await f.connect(file.key);assert.deepEqual(labelIssues(await f.review()),[]);
  const metadata=(await f.api.bindings.FILES.head(file.key)).customMetadata;assert.equal(metadata.quotationLabelProfileId,'cat');
  await assert.rejects(f.proofModule.verifiedQuotationLabelMetadata({...made.proof,endpoint:f.endpoint+'?profileId=other'},view,made.uploadId),/변경/);
 }finally{f.api.close();}
});

test('membership reassignment and foreign product ownership cannot create quotation proof receipts',async()=>{
 const f=await fixture();try{
  const made=await f.make(),count=f.api.objects.size;f.api.setCompany({code:companies[1].companyCode,name:companies[1].companyName});assert.equal((await f.upload(made.proof,made.uploadId)).status,409);assert.equal(f.api.objects.size,count);
  f.api.setCompany({code:companies[0].companyCode,name:companies[0].companyName});f.api.sqlite.prepare('UPDATE products SET owner_id=? WHERE id=?').run('other',f.product.id);assert.equal((await f.upload(made.proof,made.uploadId)).status,409);assert.equal(f.api.objects.size,count);
 }finally{f.api.close();}
});

test('a source change during R2 put preserves original bytes but refuses current-source acknowledgement and image linkage',async()=>{
 const f=await fixture();try{
  const made=await f.make(),put=f.api.bindings.FILES.put;let key;
  f.api.bindings.FILES.put=async(...args)=>{const saved=await put(...args);key=args[0];await f.save(await f.read(),[{fieldKey:f.color.id,optionId:f.selected.optionId,value:'업로드 중 새 저장값'}]);return saved;};
  assert.equal((await f.upload(made.proof,made.uploadId)).status,409);assert.deepEqual(f.api.objects.get(key),png);const current=await f.read();assert.equal(current.imageKeys.includes(key),false);assert.ok(!current.resolved.rows.some(row=>row.fields.labelImages.value.includes(key)));
 }finally{f.api.close();}
});

test('a source change during durable reuse cannot acknowledge a stale proof or overwrite its original',async()=>{
 const f=await fixture();try{
  const attached=await f.attach(),made=await f.make(),head=f.api.bindings.FILES.head,metadata=(await head(attached.key)).customMetadata;let changed=false;
  f.api.bindings.FILES.head=async key=>{const object=await head(key);if(key===attached.key&&!changed){changed=true;await f.save(await f.read(),[{fieldKey:f.color.id,optionId:f.selected.optionId,value:'저장본 조회 중 새 값'}]);}return object;};
  assert.equal((await f.upload(made.proof,made.uploadId)).status,409);assert.equal(changed,true);assert.deepEqual(f.api.objects.get(attached.key),png);assert.deepEqual((await head(attached.key)).customMetadata,metadata);
 }finally{f.api.close();}
});

test('marked metadata corruption blocks review and lookup while malformed or conflicting reuse never overwrites an original',async()=>{
 const f=await fixture();try{
  const attached=await f.attach(),head=f.api.bindings.FILES.head,object=await head(attached.key);
  for(const corrupted of [{quotationLabelProductId:'other-product'},{quotationLabelOptionId:'other-SKU'},{quotationLabelProfileId:'other-profile'},{quotationLabelProfileId:undefined},{quotationLabelPlanSha256:'X'.repeat(64)},{quotationLabelCategorySha256:undefined},{quotationLabelRevision:'01'},{quotationLabelSourceFingerprint:undefined},{labelUploadId:'f'.repeat(64)},{labelBlobSha256:undefined}]){
   f.api.bindings.FILES.head=async key=>key===attached.key?{...object,customMetadata:{...object.customMetadata,...corrupted}}:head(key);
   assert.equal(labelIssues(await f.review())[0].code,'GENERATED_QUOTATION_LABEL_UNCONFIRMED');assert.deepEqual(f.api.objects.get(attached.key),png);
  }
  f.api.bindings.FILES.head=async key=>key===attached.key?{...object,customMetadata:{...object.customMetadata,quotationLabelPlanSha256:'f'.repeat(64)}}:head(key);
  assert.equal(labelIssues(await f.review())[0].code,'GENERATED_QUOTATION_LABEL_STALE');assert.equal((await f.upload((await f.make()).proof,attached.uploadId)).status,409);
  f.api.bindings.FILES.head=async key=>key===attached.key?{...object,customMetadata:{...object.customMetadata,quotationLabelProfileId:undefined}}:head(key);
  assert.equal((await f.api.route('/api/files?labelUploadId='+attached.uploadId)).status,503);
  f.api.bindings.FILES.head=head;const changed=new Uint8Array([...png,1]);assert.equal((await f.upload((await f.make()).proof,attached.uploadId,changed)).status,409);assert.deepEqual(f.api.objects.get(attached.key),png);
 }finally{f.api.close();}
});

test('legacy and manual PNGs stay unclassified, and inspector uses exact owned final references with one HEAD per key',async()=>{
 const f=await fixture();try{
  assert.equal(f.proofModule.quotationLabelReceiptFromMetadata(undefined),null);assert.equal(f.proofModule.quotationLabelReceiptFromMetadata({quotationLabelRecipe:'quotation-label-png-v1'}),null);
  const legacy=await json(await f.upload(null,'f'.repeat(64)),201);assert.equal(legacy.quotationLabelProof,undefined);await f.connect(legacy.key);await f.save(await f.read(),[{fieldKey:f.color.id,optionId:f.selected.optionId,value:'구형 PNG는 추정하지 않는 새 값'}]);assert.deepEqual(labelIssues(await f.review()),[]);
  const attached=await f.attach(),metadata=(await f.api.bindings.FILES.head(attached.key)).customMetadata,resolved=plain((await f.read()).resolved);resolved.rows=resolved.rows.filter(row=>row.optionId===f.selected.optionId);resolved.rows[0].fields.labelImages.value=attached.key+'\n'+attached.key+'\nforeign-owner/private.png';let heads=0;
  const inspect=()=>f.proofModule.inspectGeneratedQuotationLabels({ownerId:'owner',productId:f.product.id,profileId:'cat',resolved,head:async key=>{heads++;assert.equal(key,attached.key);return {customMetadata:metadata};}});
  assert.deepEqual(plain(await inspect()),[]);assert.equal(heads,1);resolved.rows[0].included=false;assert.deepEqual(plain(await inspect()),[]);assert.equal(heads,1);
  const readSource=f.api.load('app/exports/quotation-source.ts').readQuotationExportSource,head=f.api.bindings.FILES.head;let generatedHeads=0;f.api.bindings.FILES.head=async key=>{if(key===attached.key)generatedHeads++;return head(key);};await readSource('owner',f.product.id,'cat');assert.equal(generatedHeads,1,'the two recipe inspectors share one R2 HEAD cache');
 }finally{f.api.close();}
});
