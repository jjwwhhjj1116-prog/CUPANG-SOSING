import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const originalTitle='原文收纳商品',translatedTitle='원문 기준 수납 상품';
const reviewMessage='수집 원문의 중국어 상품명이 남아 있습니다.';
const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const retained=h=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','product_price_policy','collection_results','collection_context','translation_jobs','workspace_settings','supplier_hub_receipts'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));

/** Actual queue POST, receipt POST, import/translation/apply handlers and SQLite.
 * The source receipt, Workers response, auth and XLSX are synthetic and local.
 * This does not execute a source collector, fetch supplier images, use a real
 * company workbook or contact Workers AI/Google/Supplier Hub. */
async function fixture(company,returnedTitle=''){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name}),previews=[];
 try{
  await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(h.settings));
  const headers=['skuId','categoryId',...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)],bytes=quotationWorkbook(headers),sha256=createHash('sha256').update(bytes).digest('hex'),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');
  h.objects.set(storageKey,bytes);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{...h.context.category,name:'LOCAL TITLE COVERAGE',template:{name:'synthetic-title-722.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers},mappings:headers.map((field,column)=>({field,column,required:field==='title'}))});
  const sourceUrl='https://detail.1688.com/offer/630722000001.html';
  const {jobs}=await json(await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:[sourceUrl],goal:'work',profileId:profile.id,expectedProfileRevision:profile.revision,expectedSettings:h.settings})})));
  assert.equal(jobs.length,1);const job=jobs[0];assert.match(job.id,/^[a-f0-9-]{36}$/);
  await json(await h.route(`/api/collection-jobs/${job.id}/result`,{method:'POST',body:{schemaVersion:1,sourceUrl,provider:'synthetic-local-722',collectedAt:new Date().toISOString(),title:originalTitle,description:'原文商品说明',attributes:[],images:[],options:[
   {sku:'LOCAL722-GREY',name:'灰色款',color:'灰色',unitPriceCny:5,minimumOrder:2,stock:7},
   {sku:'LOCAL722-BLACK',name:'黑色款',color:'黑色',unitPriceCny:8,minimumOrder:1,stock:9},
  ]}}));
  const originals=()=>JSON.stringify(['collection_results','collection_context','workspace_settings','category_profiles'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])),beforeSource=originals();
  const dictionary=new Map([['灰色款','회색형'],['黑色款','검정형'],['灰色','회색'],['黑色','검정']]);
  h.bindings.AI.run=async(model,input)=>{assert.equal(model,h.bindings.SOURCEFLOW_TEXT_MODEL);const source=JSON.parse(input.messages[1].content);h.aiSources.push(source);return{response:{title:returnedTitle,description:'원문에 따른 한국어 상품 설명',keywords:['수납','상품'],warnings:[],attributes:source.attributes.map((pair,sourceIndex)=>{assert.ok(dictionary.has(pair.value),pair.value);return{sourceIndex,name:pair.name,value:dictionary.get(pair.value)};})}};};
  const fetcher=async(path,init={})=>{const response=await h.route(path,{method:init.method??'GET',body:init.body});if(path.endsWith('/translation-apply')&&JSON.parse(init.body).action==='preview'&&response.ok)previews.push(await response.clone().json());return response;};
  const current=()=>h.sqlite.prepare('SELECT * FROM products ORDER BY rowid DESC LIMIT 1').get(),base=()=>'/api/products/'+current().id;
  const collect=async()=>h.load('app/intake-collection.ts').collectIntakeProduct(await h.load('db/collection-jobs.ts').findCollectionJob('owner',job.id),{signal:new AbortController().signal,fetcher,onJob(){},onProgress(){}});
  const prepare=(request=fetcher,signal=new AbortController().signal)=>h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(current().id,request,signal);
  const content=async()=>(await json(await h.route(base()+'/content'))).content,fields=()=>h.route(base()+'/quotation-fields').then(response=>json(response));
  const put=async(changes)=>{const view=await fields();return json(await h.route(base()+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));};
  const verify=async()=>{assert.equal(originals(),beforeSource);assert.deepEqual(Buffer.from(h.objects.get(storageKey)),Buffer.from(bytes));assert.equal(h.aiSources.length,1);assert.deepEqual(h.network,[]);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM supplier_hub_receipts').get().n,0);assert.equal(current().supplier_hub_status,'미전송');const options=(await json(await h.route(base()+'/options'))).options;assert.deepEqual(plain(options.rows.map(row=>[row.supplierSku,row.unitCostCny,row.minimumOrderQuantity,row.stock,row.translatedName])),[['LOCAL722-GREY',5,2,7,'회색형'],['LOCAL722-BLACK',8,1,9,'검정형']]);const value=await content();assert.equal(value.seo.description.value,'원문에 따른 한국어 상품 설명');assert.deepEqual(plain(value.seo.keywords.value),['수납','상품']);};
  return{h,company,profile,previews,fetcher,current,base,collect,prepare,content,fields,put,verify};
 }catch(error){h.close();throw error;}
}

async function workbook(f,expectedTitles){
 const {h}=f,view=await f.fields(),preview=await json(await h.route(f.base()+'/quotation',{method:'POST',body:{action:'preview'}}));
 assert.deepEqual(preview.report.company,f.company);assert.equal(preview.report.submissionReady,false);assert.equal(preview.submissionReview.submissionReady,false);assert.equal(preview.submissionReview.transport,'not-connected');
 const column=field=>f.profile.mappings.find(mapping=>mapping.field===field).column;
 assert.deepEqual(preview.rows.map(row=>row[column('title')]),expectedTitles);
 assert.deepEqual(preview.rows.map(row=>['supplyPrice','salePrice','msrp'].map(field=>row[column(field)])),[[4750,7920,10300],[5800,9670,12570]]);
 const response=await h.route(f.base()+'/quotation',{method:'POST',body:{action:'download',fingerprint:preview.fingerprint}});assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('x-quotation-fingerprint'),preview.fingerprint);
 const reader=h.load('app/xlsx-template.ts'),book=reader.inspectXlsxArchive(await reader.readXlsxArchive(await response.arrayBuffer()));
 for(let i=0;i<2;i++){const row=reader.xlsxHeaders(book,'견적서',i+2);assert.equal(row[column('title')],expectedTitles[i]);for(const field of ['supplyPrice','salePrice','msrp'])assert.equal(row[column(field)],view.resolved.rows.find(row=>row.optionId==='collected-'+(i+1)).fields[field].value);}
 return preview;
}

for(const company of companies)test(`missing initial Workers title remains review-required through replay, quotation and explicit overrides (${company.code})`,async()=>{
 const f=await fixture(company),{h}=f;try{
  assert.match(await f.collect(),/검토 필요.*상품명 번역/);
  const canonical=h.sqlite.prepare("SELECT * FROM translation_jobs WHERE idempotency_key='intake-auto-v1'").get();assert.equal(canonical.status,'completed');assert.equal(JSON.parse(canonical.result).draft.title,'');
  assert.throws(()=>h.load('app/automation/translation.ts').validateTranslationDraft({title:'',description:'',keywords:[],attributes:[],warnings:[]},JSON.parse(canonical.review).source,'sourceflow-translation-v6'),error=>error.code==='EMPTY_MODEL_OUTPUT','both empty essential fields remain a terminal model-output error');
  const content=await f.content();assert.equal(content.seo.title.value,originalTitle);assert.equal(content.seo.title.provenance,'collected');
  const proof=f.previews[0];assert.equal(proof.intakeSeoCoverage.jobId,canonical.id);assert.equal(proof.intakeSeoCoverage.contentRevision,proof.contentRevision);assert.equal(proof.intakeSeoCoverage.missingTitle,true);
  const view=await f.fields();for(const row of view.resolved.rows.filter(row=>row.included)){assert.equal(row.fields.title.value,originalTitle);assert.equal(row.fields.title.source,'content');assert.equal(row.fields.title.needsReview,true);assert.deepEqual(plain(row.fields.title.validationIssues),[]);assert.ok(row.fields.title.reviewMessages.some(value=>value.includes(reviewMessage)));}
  const exported=await workbook(f,[originalTitle,originalTitle]);assert.ok(exported.submissionReview.issues.some(issue=>issue.kind==='review'&&issue.fieldId==='title'&&issue.message.includes(reviewMessage)));assert.ok(!exported.submissionReview.issues.some(issue=>issue.kind==='error'&&issue.fieldId==='title'));
  const before=retained(h),outcome=await f.prepare();assert.equal(outcome.completed,false);assert.equal(outcome.reviewRequired,true);assert.equal(outcome.manualReady,false);assert.match(outcome.message,/상품명 번역/);assert.equal(retained(h),before);
  // A missing, stale or foreign coverage acknowledgement cannot complete intake.
  for(const mutate of [value=>{delete value.intakeSeoCoverage;},value=>{value.intakeSeoCoverage.jobId='foreign';},value=>{value.intakeSeoCoverage.contentRevision++;},value=>{delete value.intakeSeoCoverage.missingTitle;}]){
   const result=await f.prepare(async(path,init)=>{const response=await f.fetcher(path,init);if(!path.endsWith('/translation-apply')||JSON.parse(init.body).action!=='preview')return response;const value=await response.json();mutate(value);return Response.json(value);});assert.equal(result.completed,false);assert.equal(result.reviewRequired,false);assert.match(result.message,/상품명.*누락 상태/);assert.equal(retained(h),before);
  }
  const cancelled=new AbortController(),stopped=await f.prepare(async(path,init)=>{const response=await f.fetcher(path,init);if(path.endsWith('/translation-apply'))cancelled.abort();return response;},cancelled.signal);assert.deepEqual(plain(stopped),{completed:false,reviewRequired:false,manualReady:false,message:''});assert.equal(retained(h),before);
  await f.put([{fieldKey:'title',optionId:null,value:'견적서 공통 확인 상품명'},{fieldKey:'title',optionId:'collected-2',value:''}]);
  const manual=await f.fields();assert.equal(manual.resolved.rows.find(row=>row.optionId==='collected-1').fields.title.source,'manual-common');const blank=manual.resolved.rows.find(row=>row.optionId==='collected-2').fields.title;assert.equal(blank.source,'manual-option');assert.equal(blank.value,'');assert.ok(blank.validationIssues.length>0,'manual blank retains the required-title error');assert.ok(manual.resolved.rows.every(row=>!row.fields.title.reviewMessages.some(value=>value.includes(reviewMessage))));
  const manualExport=await workbook(f,['견적서 공통 확인 상품명','']);assert.ok(manualExport.submissionReview.issues.some(issue=>issue.kind==='error'&&issue.fieldId==='title'&&issue.optionId==='collected-2'));assert.ok(!manualExport.submissionReview.issues.some(issue=>issue.fieldId==='title'&&issue.message.includes(reviewMessage)));
  await f.put([{fieldKey:'title',optionId:null,value:null},{fieldKey:'title',optionId:'collected-2',value:null}]);assert.ok((await f.fields()).resolved.rows.filter(row=>row.included).every(row=>row.fields.title.reviewMessages.some(value=>value.includes(reviewMessage))));assert.equal((await f.content()).seo.title.value,originalTitle);await f.verify();
 }finally{h.close();}
});

for(const company of companies)test(`complete initial Workers title reaches the current workbook without missing-title coverage (${company.code})`,async()=>{
 const f=await fixture(company,translatedTitle),{h}=f;try{
  assert.match(await f.collect(),/SEO·옵션 초안을 생성해 반영했습니다/);const content=await f.content();assert.equal(content.seo.title.value,'검토 브랜드 '+translatedTitle);assert.equal(content.seo.title.provenance,'manual');
  const before=retained(h),outcome=await f.prepare();assert.equal(outcome.completed,true);assert.equal(outcome.reviewRequired,false);assert.equal(retained(h),before);assert.ok(f.previews.every(value=>value.intakeSeoCoverage===undefined));
  assert.ok((await f.fields()).resolved.rows.every(row=>!row.fields.title.reviewMessages.some(value=>value.includes(reviewMessage))));await workbook(f,['검토 브랜드 '+translatedTitle,'검토 브랜드 '+translatedTitle]);await f.verify();
 }finally{h.close();}
});

for(const company of companies)test(`manual title text and explicit blank resolve missing-model coverage without overwriting the saved choice (${company.code})`,async()=>{
 for(const title of ['직접 검토한 상품명','']){const f=await fixture(company),{h}=f;try{
  assert.match(await f.collect(),/검토 필요.*상품명 번역/);const content=await f.content();await json(await h.route(f.base()+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title}}}}));
  const before=retained(h),outcome=await f.prepare();assert.equal(outcome.completed,true);assert.equal(outcome.reviewRequired,false);assert.equal(outcome.manualReady,false);assert.equal(retained(h),before);assert.equal(f.previews.at(-1).intakeSeoCoverage.missingTitle,false);assert.equal(f.previews.at(-1).intakeSeoCoverage.contentRevision,f.previews.at(-1).contentRevision);
  const saved=await f.content();assert.equal(saved.seo.title.value,title);assert.equal(saved.seo.title.provenance,'manual');const expectedTitles=title?['직접 검토한 상품명, 회색형','직접 검토한 상품명, 검정형']:['',''];const view=await f.fields();for(const [index,row]of view.resolved.rows.filter(row=>row.included).entries()){assert.equal(row.fields.title.value,expectedTitles[index]);assert.ok(!row.fields.title.reviewMessages.some(value=>value.includes(reviewMessage)));assert.equal(row.fields.title.validationIssues.length>0,!title);}
  const preview=await workbook(f,expectedTitles);assert.equal(preview.submissionReview.issues.some(issue=>issue.kind==='error'&&issue.fieldId==='title'),!title);await f.verify();
 }finally{h.close();}}
});
