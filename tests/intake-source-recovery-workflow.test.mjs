import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {originalTitleEvidenceAvailable,titleCompanies,plain,json} from './helpers/quotation-option-title.mjs';

const traces=[],sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceFiles=['app/intake-collection.ts','app/intake-collection-recovery.ts','app/alibaba-mobile-collector.ts'];
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,sha(fs.readFileSync(new URL('../'+file,import.meta.url)))]));
const frozen=sourceHashes();
test.after(()=>{assert.deepEqual(sourceHashes(),frozen);fs.writeFileSync(new URL('../outputs/step715-workflow-proof.json',import.meta.url),JSON.stringify({format:'step715-source-recovery-workflow-v1',sourceHashes:frozen,traces,
 boundary:'Actual collector/intake/import/SEO/content/options/quotation/XLSX/Single projection code with in-memory SQLite and intercepted source/media/model requests. Recorded original 69900 Single and workbook are used for A01526306; the same contract is reused synthetically for A01464742. No actual 1688, Google, model or Hub request, no actual account or existing working product changed, no live gate enabled.'},null,2)+'\n');});

async function fixture(company,partial){
 const original=JSON.parse(JSON.parse(fs.readFileSync(new URL('../outputs/step604-unand-profile-read.json',import.meta.url),'utf8'))[0].results[0].payload);
 const snapshot=structuredClone(original.hubSchema);snapshot.company={...company};
 const mobile=fs.readFileSync(new URL('fixtures/1688-mobile-813724060928.json',import.meta.url),'utf8');
 const sku=JSON.parse(fs.readFileSync(new URL('fixtures/1688-skus-813724060928.json',import.meta.url),'utf8'));
 const sourceRequests=[];
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,...(partial?{sourceFetcher:async(target)=>{
  const url=new URL(target);sourceRequests.push(url.hostname);
  if(url.hostname==='detail.1688.com')return new Response('<html>synthetic PC source without JSON-LD</html>',{headers:{'content-type':'text/html'}});
  if(url.hostname==='m.1688.com')return new Response('<script>window.__INIT_DATA='+mobile+';</script>',{headers:{'content-type':'text/html'}});
  if(url.hostname==='h5api.m.1688.com')return Response.json(sku);
  assert.equal(url.hostname,'itemcdn.tmall.com');throw new TypeError('synthetic optional detail transport failure');
 }}:{})});
 const bytes=new Uint8Array(fs.readFileSync(new URL('../outputs/step603-official-unand-2624.xlsx',import.meta.url))),form=new FormData();
 form.set('file',new File([bytes],'original-Unand.xlsx'));form.set('schema',JSON.stringify(snapshot));form.set('action','workbook');
 const linked=await json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template',{method:'POST',body:form})),201);
 const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'LOCAL715 SOURCE RECOVERY',categoryId:original.categoryId,categoryPath:original.categoryPath,hubSchema:snapshot,template:linked.template,mappings:linked.mappings},'cat');
 h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run();
 await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(h.settings));
 const at='2026-10-01T00:00:00.000Z',protectedId='synthetic-protected-715';
 await h.load('db/queries.ts').insertProduct({id:protectedId,owner_id:'owner',source_url:'synthetic://protected-715',title:'기존 작업 보호용 합성 상품',source_price_cny:5,
  exchange_rate:350,supply_margin:50,coupang_margin:40,supply_price:4050,sale_price:6750,msrp:8780,options_count:0,seo_status:'대기',image_status:'대기',quote_status:'대기',
  registration_status:'수동 입력',supplier_hub_status:'미전송',image_keys:'[]',goal_stage:'price',created_at:at,updated_at:at});
 const contentModel=h.load('app/product-content.ts'),content=contentModel.applyContentPatch(contentModel.emptyProductContent(protectedId),{seo:{title:'기존 검토 제목',keywords:[]},label:{material:''},labelClears:['material']},at);
 await h.load('db/product-content.ts').saveProductContent('owner',content,0);
 const protectedState=()=>JSON.stringify(['products','product_content','product_options','product_price_policy','product_quotation_fields','product_registration_numbers'].map(table=>[
  table,h.sqlite.prepare('SELECT * FROM '+table+' WHERE '+(table==='products'?'id':'product_id')+'=?').all(protectedId)]));
 return{h,profile,sourceRequests,protectedId,protectedState,close(){h.close();}};
}

for(const company of titleCompanies)for(const fault of ['network','body','proxy','partial-network'])test(`lost collection acknowledgement continues the same category draft and reviewed export (${company.code}, ${fault})`,{skip:!originalTitleEvidenceAvailable},async()=>{
 const partial=fault==='partial-network',f=await fixture(company,partial),{h,profile}=f;
 try{
  const protectedBefore=f.protectedState(),job=await h.load('db/collection-jobs.ts').findCollectionJob('owner','job');
  const calls=[],published=[];let lost=false,receiptBytes;
  const fetcher=async(path,init={})=>{
   calls.push({path,method:init.method??'GET'});const response=await h.route(path,{method:init.method??'GET',body:init.body});
   if(path.endsWith('/collect')&&init.method==='POST'&&!lost){
    assert.equal(response.status,200,await response.clone().text());lost=true;
    receiptBytes=h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get(job.id).payload;
    if(fault==='body')return{ok:true,status:200,json:async()=>{throw new TypeError('synthetic response body loss');}};
    if(fault==='proxy')return new Response('<html>synthetic gateway interruption after source commit</html>',{status:503});
    throw new TypeError('synthetic connection loss after source commit');
   }
   return response;
  };
  let browserCaptures=0;
  const message=await h.load('app/intake-collection.ts').collectIntakeProduct(job,{signal:new AbortController().signal,fetcher,onJob:value=>published.push(value),onProgress(){},
   captureFromBrowser:async()=>{browserCaptures++;assert.fail('Already confirmed mobile source must not be captured again');}});
  assert.match(message,/초안|검토/);assert.equal(browserCaptures,0);assert.equal(calls.filter(call=>call.path.endsWith('/collect')).length,1);
  assert.equal(calls[1].path,'/api/collection-jobs/job/result');assert.equal(calls[1].method,'GET');
  const product=h.sqlite.prepare('SELECT * FROM products WHERE source_url=?').get(h.sourceUrl),base='/api/products/'+product.id;
  assert.ok(product);assert.notEqual(product.id,f.protectedId);assert.ok(published.some(value=>value.product_id===product.id));
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,2);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_results').get().n,1);
  assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get(job.id).payload,receiptBytes);
  const quote=()=>h.route(base+'/quotation-fields').then(json),content=()=>h.route(base+'/content').then(json);
  let view=await quote();const savedContent=await content(),options=await json(await h.route(base+'/options'));
  assert.equal(view.categoryContext.categoryId,'69900');assert.equal(view.categoryContext.profileId,profile.id);
  assert.deepEqual(plain(view.categoryContext.categoryPath),plain(profile.categoryPath));assert.equal(options.options.rows.length,6);assert.equal(h.aiSources.length,1);
  for(const section of ['start','product','image','legal','logistics'])assert.ok(view.resolved.schema.fields.some(field=>field.section===section),section);
  const source=JSON.parse(receiptBytes);assert.equal(source.options.length,6);
  assert.deepEqual(options.options.rows.map(row=>[row.supplierSku,row.unitCostCny,row.minimumOrderQuantity]),source.options.map(row=>[row.sku,row.unitPriceCny,row.minimumOrder]));
  assert.ok(savedContent.content.seo.title.value);assert.ok(savedContent.content.assets.main.value.length);assert.ok(savedContent.content.assets.additional.value.length);
  if(partial){assert.equal(source.provider,'1688-public-mobile-partial-v1');assert.equal(savedContent.content.assets.detail.value.length,0);assert.equal(f.sourceRequests.filter(host=>host==='itemcdn.tmall.com').length,1);}
  else assert.ok(savedContent.content.assets.detail.value.length);

  // The user reviews a saved draft through the same real content/option/quote APIs.
  const reviewedTitle='직접 검토한 원문 상품',reviewedOptions=h.load('app/product-options.ts').optionInputs(options.options);reviewedOptions[0].translatedName='직접 검토한 옵션';reviewedOptions.at(-1).included=false;
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:savedContent.content.revision,patch:{seo:{title:reviewedTitle,keywords:[]},label:{material:''},labelClears:['material']}}}));
  const current=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(product.id);
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:current.updated_at,rows:reviewedOptions}}));
  view=await quote();
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   {fieldKey:'brand',optionId:reviewedOptions[0].id,value:'직접 검토 브랜드'},{fieldKey:'model',optionId:null,value:''},
  ]}}));
  view=await quote();const first=view.resolved.rows.find(row=>row.optionId===reviewedOptions[0].id);
  assert.equal(first.fields.brand.value,'직접 검토 브랜드');assert.equal(first.fields.model.value,'');assert.equal(first.fields.model.source,'manual-common');
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  const titleColumn=profile.mappings.find(mapping=>mapping.field==='title').column;
  assert.equal(titleColumn,2);assert.equal(preview.rows.length,5);assert.ok(preview.rows.every(row=>row[titleColumn].includes(reviewedTitle)));
  const download=await h.route(base+'/quotation',{method:'POST',body:{action:'download',fingerprint:preview.fingerprint}});
  assert.equal(download.status,200,await download.clone().text());const reader=h.load('app/xlsx-template.ts');
  const workbook=reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer())),titles=Array.from({length:5},(_,index)=>reader.xlsxHeaders(workbook,profile.template.sheetName,profile.template.dataStartRow+index)[titleColumn]);
  assert.ok(titles.every(value=>value.includes(reviewedTitle)));assert.ok(titles[0].includes('직접 검토한 옵션'));
  const sourceExport=await h.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',product.id,profile.id);
  const projection=await h.load('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument({snapshot:profile.hubSchema,company,categoryId:profile.categoryId,categoryPath:profile.categoryPath,
   resolved:h.load('app/exports/quotation-source.ts').resolveQuotationExport(sourceExport)});
  assert.equal(projection.payload.displayCategoryCode,'69900');assert.equal(projection.payload.jsonDocument.length,5);assert.equal(projection.payload.docId,null);
  assert.ok(projection.payload.jsonDocument.every(doc=>doc.startPage.productName.includes(reviewedTitle)));
  assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get(job.id).payload,receiptBytes);assert.equal(f.protectedState(),protectedBefore);
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(product.id).supplier_hub_status,'미전송');
  for(const table of ['supplier_hub_receipts','supplier_hub_single_receipts'])assert.equal(h.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0);
  traces.push({company,fault,categoryId:profile.categoryId,collectionPosts:1,recoveryReadBeforeImport:true,immutableReceiptSha256:sha(receiptBytes),browserCaptures,options:6,exportedOptions:5,
   aiCalls:1,manualBlankPreserved:true,protectedProductPreserved:true,protectedProductSha256:sha(protectedBefore),xlsxTitles:titles,projectionDocuments:5,hubWrites:0,registered:false,liveSourceRequests:0});
 }finally{f.close();}
});
