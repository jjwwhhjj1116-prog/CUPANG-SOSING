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
async function json(response, statuses=[200]) { assert.ok(statuses.includes(response.status),response.status+': '+await response.clone().text()); return response.json(); }

// Actual API handlers and ephemeral SQLite/R2. Seller source facts, PNG bytes
// and the mapped XLSX are fixtures; no operating record or Hub is contacted.
async function fixture(company=companies[0]) {
 const api=mobileIntakeHarness(company);
 try {
  const get=api.bindings.FILES.get;
  api.bindings.FILES.get=async(key,options)=>{const object=await get(key),bytes=api.objects.get(key);if(!object||!bytes)return object;const offset=options?.range?.offset??0,end=options?.range?.length===undefined?bytes.byteLength:offset+options.range.length;return {...object,body:new Response(bytes.slice(offset,end)).body};};
  const schema=api.load('app/quotation-schema.ts').getQuotationSchema('80719'),fields=schema.fields.map(field=>field.id),workbook=new Uint8Array(quotationWorkbook(fields));
  const sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex'),storageKey=api.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');api.objects.set(storageKey,workbook);
  const profileInput={name:'제품 라벨 재생성 시험',categoryId:'80719',categoryPath:schema.categoryPath,
   template:{name:'synthetic-label-replacement.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))};
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',profileInput,'cat');
  api.context.category=profile;api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(api.context),'job');await api.intake();
  const product=api.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,endpoint=base+'/product-labels?profileId=cat',quotationEndpoint=base+'/quotation-fields?profileId=cat';
  const quotation=await json(await api.route(quotationEndpoint)),selected=quotation.resolved.rows.find(row=>row.optionId),other=quotation.resolved.rows.filter(row=>row.optionId)[1];
  const calls=[];
  const request=async(url,init={})=>{calls.push({url,method:init.method??'GET',init});return url==='/api/files'?api.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:init.body})):api.route(url,{method:init.method??'GET',...(init.body!==undefined?{body:JSON.parse(init.body)}:{})});};
  const read=()=>api.route(endpoint).then(json),readQuotation=()=>api.route(quotationEndpoint).then(json);
  const save=(view,changes)=>api.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}).then(json);
  const quoteSave=(view,changes)=>api.route(quotationEndpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}).then(json);
  const attach=async(optionId=selected.optionId, overrides={})=>api.load('app/product-label-attachment.ts').attachProductLabel({productId:product.id,endpoint,quotationEndpoint,renderedView:await read(),optionId,blob:new Blob([png],{type:'image/png'}),uploadedKey:null,onUploaded(){},...overrides},overrides.request??request);
  const review=()=>api.route(base+'/submission-review?profileId=cat').then(json),preview=()=>api.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:'cat'}}).then(json);
  const refs=view=>view.resolved.rows.find(row=>row.optionId===selected.optionId).fields.labelImages.value.split('\n').filter(Boolean);
  async function connect(key) {const before=await readQuotation();await json(await api.route(base+'/attachments',{method:'POST',body:{key,role:null,expectedVersion:before.productVersion,expectedContentRevision:before.contentRevision}}));}
  async function manual(uploadId=null) {const form=new FormData();form.set('file',new File([png],uploadId?'sourceflow-quotation-label.png':'manual-confirmed.png',{type:'image/png'}));if(uploadId)form.set('labelUploadId',uploadId);const file=await json(await api.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:form})),[201]);await connect(file.key);return file.key;}
  async function setRefs(keys,optionId=selected.optionId) {const view=await readQuotation(),target=api.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(view.resolved.schema.fields,'labelImages');return quoteSave(view,target.linked.map(fieldKey=>({optionId,fieldKey,value:keys.join('\n')})));}
  const snapshots=()=>Object.fromEntries(['product_content','product_options','product_price_policy'].map(table=>[table,api.sqlite.prepare('SELECT payload FROM '+table+' WHERE product_id=?').get(product.id).payload]));
  return {api,product,base,endpoint,quotationEndpoint,fields,profileInput,selected,other,calls,request,read,readQuotation,save,quoteSave,attach,review,preview,refs,connect,manual,setRefs,snapshots};
 } catch(error) {api.close();throw error;}
}

for(const company of companies) test(`explicit same-SKU regeneration replaces old final references in XLSX/ZIP and preserves bytes and manual blanks (${company.companyCode})`,async()=>{
 const f=await fixture(company);try {
  await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'productName',value:'직접 확인한 제품명'},{optionId:f.selected.optionId,fieldKey:'material',value:'원료 A'},{optionId:f.selected.optionId,fieldKey:'netContents',value:''}]);
  await f.quoteSave(await f.readQuotation(),[{optionId:null,fieldKey:'noticeMaterial',value:'수동 법적 재질 공통값'},{optionId:f.other.optionId,fieldKey:'noticeMaterial',value:'다른 SKU 수동 재질'},{optionId:f.selected.optionId,fieldKey:'noticeCountryOfOrigin',value:''}]);
  const old=await f.attach(),source=f.snapshots(),original=plain((await f.readQuotation()).overrides),other=await f.attach(f.other.optionId),manual=await f.manual(),legacy=await f.manual('f'.repeat(64));
  await f.setRefs([manual,old.key,legacy]);
  const beforePool=(await f.readQuotation()).imageKeys,oldMeta=plain((await f.api.bindings.FILES.head(old.key)).customMetadata);
  await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'material',value:'수정한 원료 B'}]);
  assert.equal(labelIssues(await f.review()).find(issue=>issue.optionId===f.selected.optionId).code,'GENERATED_PRODUCT_LABEL_STALE');
  const fresh=await f.attach();assert.notEqual(fresh.key,old.key);const quote=await f.readQuotation();
  assert.deepEqual(f.refs(quote),[manual,legacy,fresh.key]);assert.deepEqual(quote.imageKeys,[...beforePool,fresh.key]);
  assert.equal(quote.resolved.rows.find(row=>row.optionId===f.other.optionId).fields.labelImages.value,other.key);
  assert.deepEqual(plain(quote.overrides.common),original.common);assert.equal(quote.overrides.options[f.selected.optionId].noticeCountryOfOrigin,'');assert.equal(quote.overrides.options[f.other.optionId].noticeMaterial,'다른 SKU 수동 재질');
  assert.equal((await f.read()).rows.find(row=>row.optionId===f.selected.optionId).values.netContents,'');
  assert.deepEqual(labelIssues(await f.review()),[]);const preview=await f.preview();assert.deepEqual(labelIssues(preview.submissionReview),[]);
  const response=await f.api.route(f.base+'/quotation',{method:'POST',body:{action:'export',profileId:'cat',fingerprint:preview.fingerprint}});assert.equal(response.status,200,await response.clone().text());
  const zip=readPackageZip(new Uint8Array(await response.arrayBuffer())),plan=JSON.parse(new TextDecoder().decode(zip.get('supplier-hub-upload-plan.json'))),report=JSON.parse(new TextDecoder().decode(zip.get('submission-review.json')));
  assert.equal(plan.company.code,company.companyCode);assert.deepEqual(labelIssues(report),[]);
  const selectedFiles=plan.labelImages.filter(image=>image.references.some(ref=>ref.optionId===f.selected.optionId));assert.deepEqual(selectedFiles.map(image=>image.key),[manual,legacy,fresh.key]);assert.ok(!plan.labelImages.some(image=>image.key===old.key));
  for(const image of selectedFiles)assert.deepEqual(zip.get(image.archivePath),png);
  const workbook=zip.get(plan.quotation.file.filename),reader=f.api.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(workbook.buffer.slice(workbook.byteOffset,workbook.byteOffset+workbook.byteLength))),row=reader.xlsxHeaders(sheet,'견적서',2);
  assert.equal(row[f.fields.indexOf('labelImages')],selectedFiles.map(image=>image.filename).join('\n'));assert.equal(row[f.fields.indexOf('noticeCountryOfOrigin')],'');assert.equal(row[f.fields.indexOf('noticeMaterial')],'수동 법적 재질 공통값');
  assert.deepEqual(f.api.objects.get(old.key),png);assert.deepEqual(plain((await f.api.bindings.FILES.head(old.key)).customMetadata),oldMeta);assert.deepEqual(f.snapshots(),source);
  assert.equal(f.api.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(f.product.id).supplier_hub_status,'미전송');assert.ok(!f.api.network.includes('supplier.coupang.com'));
 }finally {f.api.close();}
});

for(const company of companies) test(`replacement retains common, other-SKU/profile/category/product, legacy, manual and stage-seven labels (${company.companyCode})`,async()=>{
 const f=await fixture(company);try {
  const own=await f.attach(),common=await f.attach(null),other=await f.attach(f.other.optionId),manual=await f.manual(),legacy=await f.manual('e'.repeat(64));
  const quote=await f.readQuotation();let noticeKey;
  await f.api.load('app/quotation-label-attachment.ts').attachQuotationLabel({productId:f.product.id,endpoint:f.quotationEndpoint,renderedView:quote,optionId:f.selected.optionId,blob:new Blob([png],{type:'image/png'}),uploadedKey:null,onUploaded:key=>noticeKey=key},f.request);
  // Server-marked R2 fixtures model historical valid receipts from other exact
  // scopes; only the actual route can expose their metadata to the client.
  const baseMeta=plain((await f.api.bindings.FILES.head(own.key)).customMetadata),different=[];
  for(const [index,changes] of [[0,{productLabelProfileId:'other-profile'}],[1,{productLabelCategorySha256:'1'.repeat(64)}],[2,{productLabelProductId:'other-product'}]]) {
   const uploadId=String(index+2).repeat(64),key=f.api.load('app/label-upload-key.ts').labelUploadKey('owner',uploadId);
   await f.api.bindings.FILES.put(key,png,{httpMetadata:{contentType:'image/png'},customMetadata:{...baseMeta,...changes,labelUploadId:uploadId}});await f.connect(key);different.push(key);
  }
  const preserved=[manual,common.key,other.key,legacy,noticeKey,...different];await f.setRefs([manual,own.key,...preserved.slice(1)]);
  const others=plain((await f.readQuotation()).overrides.options[f.other.optionId]),pool=(await f.readQuotation()).imageKeys,commonOverrides=plain((await f.readQuotation()).overrides.common);
  await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'material',value:'수정한 개별 재질'}]);const fresh=await f.attach();
  assert.deepEqual(f.refs(await f.readQuotation()),[...preserved,fresh.key]);assert.deepEqual((await f.readQuotation()).imageKeys,[...pool,fresh.key]);assert.deepEqual(plain((await f.readQuotation()).overrides.options[f.other.optionId]),others);assert.deepEqual(plain((await f.readQuotation()).overrides.common),commonOverrides);
  for(const key of [own.key,...preserved])assert.deepEqual(f.api.objects.get(key),png);
  assert.ok(labelIssues(await f.review()).length>0,'different-scope stale proof stays visible until explicit manual exclusion');
 }finally {f.api.close();}
});

test('strict product-label metadata and client receipts reject partial, forged or wrong-recipe evidence',async()=>{
 const f=await fixture();try {
  const attached=await f.attach(),proofModule=f.api.load('app/product-label-proof.ts'),metadata=plain((await f.api.bindings.FILES.head(attached.key)).customMetadata),proof=plain(proofModule.productLabelReceiptFromMetadata(metadata)),uploadId=metadata.labelUploadId;
  const body=await json(await f.api.route('/api/files?labelUploadId='+uploadId));assert.deepEqual(body.productLabelProof,proof);
  assert.equal(proofModule.productLabelReceiptFromMetadata({}),null);assert.equal(proofModule.productLabelReceiptFromMetadata({...metadata,productLabelRecipe:'quotation-label-png-v2'}),null);
  for(const invalid of [{productLabelProductId:''},{productLabelOptionId:undefined},{productLabelProfileId:42},{productLabelProfileId:'../cat'},{productLabelPlanSha256:'fake'},{productLabelCategorySha256:'0'},{productLabelSourceFingerprint:''},{productLabelProductVersion:'not-a-clock'},{productLabelRevision:'00'},{productLabelRevision:'9007199254740992'},{labelUploadId:'bad'},{labelBlobSha256:'bad'}])assert.throws(()=>proofModule.productLabelReceiptFromMetadata({...metadata,...invalid}),/확인/);
  const read=async value=>proofModule.readProductLabelReceipt(uploadId,async()=>Response.json(value));
  for(const invalid of [{...body,key:null},{...body,key:'owner/quotation-label-'+ '0'.repeat(64)+'.png'},{...body,size:0},{...body,sha256:'bad'},{...body,productLabelProof:{...proof,optionId:'../option'}},{...body,productLabelProof:{...proof,profileId:undefined}},{...body,productLabelProof:{...proof,recipe:'manual'}},{...body,productLabelProof:{...proof,extra:'guessed'}}])await assert.rejects(read(invalid),/확인/);
  assert.equal((await read({...body,productLabelProof:undefined})).proof,null);assert.equal((await read({key:null})).proof,null);
  const unmarked={...body};delete unmarked.productLabelProof;assert.equal((await read(unmarked)).proof,null);assert.deepEqual(plain(await proofModule.readProductLabelReceipt(uploadId,f.request)).proof,proof);
 }finally {f.api.close();}
});

test('the file receipt is owner scoped and corrupted marked metadata never permits destructive replacement',async()=>{
 const f=await fixture();try {
  const attached=await f.attach(),head=f.api.bindings.FILES.head,metadata=plain((await head(attached.key)).customMetadata),uploadId=metadata.labelUploadId;
  const foreignKey=f.api.load('app/label-upload-key.ts').labelUploadKey('foreign-owner','d'.repeat(64));await f.api.bindings.FILES.put(foreignKey,png,{httpMetadata:{contentType:'image/png'},customMetadata:{...metadata,labelUploadId:'d'.repeat(64)}});
  assert.deepEqual(await json(await f.api.route('/api/files?labelUploadId='+'d'.repeat(64))),{key:null});
  f.api.bindings.FILES.head=async key=>{const object=await head(key);return key===attached.key?{...object,customMetadata:{...object.customMetadata,productLabelPlanSha256:'broken'}}:object;};
  assert.equal((await f.api.route('/api/files?labelUploadId='+uploadId)).status,503);
  await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'material',value:'새 원료'}]);const before=plain(await f.readQuotation()),count=f.api.objects.size,start=f.calls.length;
  await assert.rejects(f.attach(),/확인/);assert.deepEqual(plain(await f.readQuotation()),before);assert.equal(f.api.objects.size,count);assert.ok(f.calls.slice(start).every(call=>call.method==='GET'));assert.deepEqual(f.api.objects.get(attached.key),png);
 }finally {f.api.close();}
});

test('a foreign-owner receipt response or failed lookup keeps all final references and blocks replacement writes',async()=>{
 const f=await fixture();try {
  const old=await f.attach(),metadata=(await f.api.bindings.FILES.head(old.key)).customMetadata,receipt=await json(await f.api.route('/api/files?labelUploadId='+metadata.labelUploadId));
  await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'material',value:'새 생성 원료'}]);const before=plain(await f.readQuotation()),count=f.api.objects.size;
  for(const [kind,response] of [['foreign',()=>Response.json({...receipt,key:receipt.key.replace('owner/','foreign-owner/')})],['unavailable',()=>Response.json({error:'receipt unavailable'},{status:503})]]) {
   const start=f.calls.length,request=async(url,init={})=>url==='/api/files?labelUploadId='+metadata.labelUploadId?response():f.request(url,init);
   await assert.rejects(f.attach(f.selected.optionId,{request}),error=>{
    if(kind==='foreign')assert.match(error.message,/소유자/);
    else assert.ok(error.message.endsWith('[GET /api/files · HTTP 503 · JSON 응답]'),error.message);
    assert.doesNotMatch(error.message,/unavailable|labelUploadId|foreign-owner/);
    return true;
   });assert.deepEqual(plain(await f.readQuotation()),before);assert.equal(f.api.objects.size,count);assert.ok(f.calls.slice(start).every(call=>call.method==='GET'));assert.deepEqual(f.api.objects.get(old.key),png);
  }
 }finally {f.api.close();}
});

test('an explicit null historical receipt preserves its original reference instead of guessing a removable generated file',async()=>{
 const f=await fixture();try {
  const old=await f.attach(),head=f.api.bindings.FILES.head;await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'material',value:'새 생성 원료'}]);
  f.api.bindings.FILES.head=async key=>key===old.key?null:head(key);const fresh=await f.attach();assert.deepEqual(f.refs(await f.readQuotation()),[old.key,fresh.key]);assert.ok((await f.readQuotation()).imageKeys.includes(old.key));assert.deepEqual(f.api.objects.get(old.key),png);assert.deepEqual(f.api.objects.get(fresh.key),png);
 }finally {f.api.close();}
});

for(const company of companies) test(`lost upload and quotation acknowledgements recover the single replacement without another PUT (${company.companyCode})`,async()=>{
 const f=await fixture(company);try {
  const old=await f.attach();await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'material',value:'복구할 새 원료'}]);let lostUpload=true,lostQuote=true;
  const request=async(url,init={})=>{const response=await f.request(url,init);if(url==='/api/files'&&init.method==='POST'&&lostUpload){lostUpload=false;throw Error('lost upload acknowledgement');}if(url===f.quotationEndpoint&&init.method==='PUT'&&lostQuote){lostQuote=false;throw Error('lost quotation acknowledgement');}return response;};
  const start=f.calls.length,count=f.api.objects.size,attached=await f.attach(f.selected.optionId,{request}),first=f.calls.slice(start);
  assert.deepEqual(f.refs(await f.readQuotation()),[attached.key]);assert.equal(first.filter(call=>call.url==='/api/files'&&call.method==='POST').length,1);assert.equal(first.filter(call=>call.url===f.quotationEndpoint&&call.method==='PUT').length,1);assert.equal(f.api.objects.size,count+1);assert.deepEqual(f.api.objects.get(old.key),png);
  const clock=plain(await f.readQuotation()),retryStart=f.calls.length;const retry=await f.attach(f.selected.optionId,{request,uploadedKey:attached.key,blob:null});assert.equal(retry.key,attached.key);assert.deepEqual(plain(await f.readQuotation()),clock);assert.ok(f.calls.slice(retryStart).every(call=>call.method==='GET'));assert.deepEqual(labelIssues(await f.review()),[]);
 }finally {f.api.close();}
});

test('a nine-row change during replacement upload preserves the old reference and both R2 bytes without a quotation write',async()=>{
 const f=await fixture();try {
  const old=await f.attach();await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'material',value:'생성할 값'}]);const quote=plain((await f.readQuotation()).overrides),put=f.api.bindings.FILES.put;let freshKey;
  f.api.bindings.FILES.put=async(...args)=>{const result=await put(...args);freshKey=args[0];await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'material',value:'업로드 중 변경값'}]);return result;};
  const start=f.calls.length;await assert.rejects(f.attach(),/변경|다시/);assert.ok(freshKey);assert.deepEqual(f.refs(await f.readQuotation()),[old.key]);assert.deepEqual(plain((await f.readQuotation()).overrides),quote);assert.deepEqual(f.api.objects.get(old.key),png);assert.deepEqual(f.api.objects.get(freshKey),png);assert.ok(!(await f.readQuotation()).imageKeys.includes(freshKey));assert.equal(f.calls.slice(start).filter(call=>call.url===f.quotationEndpoint&&call.method==='PUT').length,0);
 }finally {f.api.close();}
});

test('a quotation CAS race retains the concurrent manual reference rather than erasing it with a replacement',async()=>{
 const f=await fixture();try {
  const old=await f.attach(),manual=await f.manual();await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'material',value:'새 생성값'}]);let raced=false,uploaded;
  const request=async(url,init={})=>{if(url===f.quotationEndpoint&&init.method==='PUT'&&!raced){raced=true;await f.setRefs([old.key,manual]);}return f.request(url,init);};
  await assert.rejects(f.attach(f.selected.optionId,{request,onUploaded:key=>uploaded=key}),/변경|최신/);assert.ok(raced);assert.deepEqual(f.refs(await f.readQuotation()),[old.key,manual]);assert.ok((await f.readQuotation()).imageKeys.includes(uploaded));assert.deepEqual(f.api.objects.get(old.key),png);assert.deepEqual(f.api.objects.get(uploaded),png);
  const retry=await f.attach(f.selected.optionId,{uploadedKey:uploaded,blob:null});assert.equal(retry.key,uploaded);assert.deepEqual(f.refs(await f.readQuotation()),[manual,uploaded]);assert.deepEqual(labelIssues(await f.review()),[]);
 }finally {f.api.close();}
});

test('read-only retry confirms its final no-op pair and rejects a concurrent quotation change',async()=>{
 const f=await fixture();try {
  const attached=await f.attach(),manual=await f.manual();let reads=0,raced=false;
  const request=async(url,init={})=>{if(url===f.quotationEndpoint&&(init.method??'GET')==='GET'&&++reads===4){raced=true;await f.setRefs([attached.key,manual]);}return f.request(url,init);};
  const start=f.calls.length;await assert.rejects(f.attach(f.selected.optionId,{request,blob:null,uploadedKey:attached.key}),/변경|다시/);assert.ok(raced);assert.deepEqual(f.refs(await f.readQuotation()),[attached.key,manual]);assert.ok(f.calls.slice(start).every(call=>call.method==='GET'||call.url===f.quotationEndpoint));
  assert.equal(f.calls.slice(start).filter(call=>call.url===f.quotationEndpoint&&call.method==='PUT').length,0,'the concurrent fixture write does not go through the attachment request');assert.deepEqual(f.api.objects.get(attached.key),png);
 }finally {f.api.close();}
});

test('an already-connected fresh PNG still replaces older same-scope generated references on explicit retry',async()=>{
 const f=await fixture();try {
  const old=await f.attach();await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'material',value:'새 원료'}]);const fresh=await f.attach();await f.setRefs([old.key,fresh.key]);const before=await f.readQuotation(),count=f.api.objects.size,start=f.calls.length;
  const result=await f.attach(f.selected.optionId,{uploadedKey:fresh.key,blob:null});assert.equal(result.key,fresh.key);assert.deepEqual(f.refs(await f.readQuotation()),[fresh.key]);assert.equal((await f.readQuotation()).revision,before.revision+1);assert.equal(f.api.objects.size,count);assert.equal(f.calls.slice(start).filter(call=>call.url==='/api/files'&&call.method==='POST').length,0);assert.deepEqual(f.api.objects.get(old.key),png);assert.deepEqual(labelIssues(await f.review()),[]);
 }finally {f.api.close();}
});

for(const company of companies) test(`an unproven next-recipe PNG cannot replace an authenticated old product label or be trusted as uploadedKey (${company.companyCode})`,async()=>{
 const f=await fixture(company);try {
  const old=await f.attach();await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'material',value:'확인할 새 원료'}]);
  const context={productId:f.product.id,endpoint:f.endpoint,view:await f.read(),optionId:f.selected.optionId},uploadId=await f.api.load('app/product-label-upload.ts').productLabelUploadId(context);
  const unproven=await f.manual(uploadId);assert.equal((await f.api.bindings.FILES.head(unproven)).customMetadata.productLabelRecipe,undefined);
  const before=plain(await f.readQuotation()),source=f.snapshots(),bytes=[...f.api.objects].map(([key,value])=>[key,Buffer.from(value).toString('hex')]);
  for(const uploadedKey of [null,unproven]) {
   const start=f.calls.length;await assert.rejects(f.attach(f.selected.optionId,{uploadedKey,blob:null}),/원천|확인/);
   assert.deepEqual(plain(await f.readQuotation()),before);assert.deepEqual(f.refs(await f.readQuotation()),[old.key]);assert.deepEqual(f.snapshots(),source);assert.deepEqual([...f.api.objects].map(([key,value])=>[key,Buffer.from(value).toString('hex')]),bytes);
   assert.ok(f.calls.slice(start).every(call=>call.method==='GET'));assert.equal((await f.review()).issues.filter(issue=>issue.code==='GENERATED_PRODUCT_LABEL_STALE').length,1);
  }
 }finally {f.api.close();}
});

for(const company of companies) test(`next-recipe evidence must match the exact current product, option, profile, category and nine-row plan (${company.companyCode})`,async()=>{
 const f=await fixture(company);try {
  const old=await f.attach();await f.save(await f.read(),[{optionId:f.selected.optionId,fieldKey:'material',value:'확인한 다음 원료'}]);
  const view=await f.read(),context={productId:f.product.id,endpoint:f.endpoint,view,optionId:f.selected.optionId},proof=f.api.load('app/product-label-proof.ts').productLabelProofRequest(context),uploadId=await f.api.load('app/product-label-upload.ts').productLabelUploadId(context);
  const form=new FormData();form.set('file',new File([png],'sourceflow-quotation-label.png',{type:'image/png'}));form.set('labelUploadId',uploadId);form.set('productLabelProof',JSON.stringify(proof));
  const fresh=await json(await f.api.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:form})),[201]);
  const head=f.api.bindings.FILES.head,before=plain(await f.readQuotation()),bytes=[...f.api.objects].map(([key,value])=>[key,Buffer.from(value).toString('hex')]);
  for(const changes of [{productLabelProductId:'different-product'},{productLabelOptionId:f.other.optionId},{productLabelProfileId:'different-profile'},{productLabelCategorySha256:'0'.repeat(64)},{productLabelPlanSha256:'0'.repeat(64)}]) {
   f.api.bindings.FILES.head=async key=>{const object=await head(key);return key===fresh.key?{...object,customMetadata:{...object.customMetadata,...changes}}:object;};
   const start=f.calls.length;await assert.rejects(f.attach(f.selected.optionId,{uploadedKey:fresh.key,blob:null}),/원천|확인/);assert.deepEqual(plain(await f.readQuotation()),before);assert.deepEqual(f.refs(await f.readQuotation()),[old.key]);assert.ok(f.calls.slice(start).every(call=>call.method==='GET'));assert.deepEqual([...f.api.objects].map(([key,value])=>[key,Buffer.from(value).toString('hex')]),bytes);
  }
  f.api.bindings.FILES.head=head;const connected=await f.attach(f.selected.optionId,{uploadedKey:fresh.key,blob:null});assert.equal(connected.key,fresh.key);assert.deepEqual(f.refs(await f.readQuotation()),[fresh.key]);assert.deepEqual(labelIssues(await f.review()),[]);
 }finally {f.api.close();}
});
