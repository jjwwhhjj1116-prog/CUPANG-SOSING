import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const profileFile=new URL('../outputs/step604-unand-profile-read.json',import.meta.url);
const originalFile=new URL('../outputs/step603-official-unand-2624.xlsx',import.meta.url);
const available=fs.existsSync(profileFile)&&fs.existsSync(originalFile);
const description='原文商品说明';
const reviewMessage='수집 원문의 중국어 상세 설명이 남아 있습니다.';
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const retained=h=>JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_quotation_fields','product_price_policy','collection_results','collection_context','translation_jobs','workspace_settings','supplier_hub_receipts'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));

/** New queue/request and actual API/SQLite with the recorded Unand Single69900 /
 * original2624 workbook. Waihop reuses that public contract in isolation, not
 * a newly fetched Waihop form. Seller facts, worker response and auth are local;
 * no source/Google/AI/Supplier Hub service is contacted. */
export async function workersDescriptionFixture(company=companies[0],sourceDescription=description,returnedDescription=''){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name}),previews=[];
 try{
  await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(h.settings));
  const saved=JSON.parse(JSON.parse(fs.readFileSync(profileFile,'utf8'))[0].results[0].payload),hubSchema=structuredClone(saved.hubSchema),bytes=new Uint8Array(fs.readFileSync(originalFile));hubSchema.company={...company};
  const form=new FormData();form.set('file',new File([bytes],'recorded-original.xlsx'));form.set('schema',JSON.stringify(hubSchema));form.set('action','workbook');
  const linked=await json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template',{method:'POST',body:form})),201);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'LOCAL WORKERS DESCRIPTION COVERAGE',categoryId:saved.categoryId,categoryPath:saved.categoryPath,hubSchema,template:linked.template,mappings:linked.mappings});
  const sourceUrl='https://detail.1688.com/offer/642000000001.html';
  const {jobs}=await json(await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:[sourceUrl],goal:'work',profileId:profile.id,expectedProfileRevision:profile.revision,expectedSettings:h.settings})})));
  assert.equal(jobs.length,1);const job=jobs[0];
  await json(await h.route(`/api/collection-jobs/${job.id}/result`,{method:'POST',body:{schemaVersion:1,sourceUrl,provider:'synthetic-local-642',collectedAt:new Date().toISOString(),title:'原文商品',description:sourceDescription,attributes:[],
   options:[{sku:'LOCAL642-GREY',name:'灰色',color:'灰色',unitPriceCny:5,minimumOrder:2,stock:7},{sku:'LOCAL642-BLACK',name:'黑色',color:'黑色',unitPriceCny:8,minimumOrder:1,stock:9}],images:[]}}));
  const originals=JSON.stringify({result:h.sqlite.prepare('SELECT * FROM collection_results').all(),context:h.sqlite.prepare('SELECT * FROM collection_context').all(),settings:h.sqlite.prepare('SELECT * FROM workspace_settings').all()}),rawOptions=structuredClone((await h.load('db/collection-results.ts').readCollectionResult('owner',job.id)).result.options);
  h.bindings.AI.run=async(model,input)=>{assert.equal(model,h.bindings.SOURCEFLOW_TEXT_MODEL);const source=JSON.parse(input.messages[1].content);h.aiSources.push(source);return{response:{title:'원문 기준 상품',description:returnedDescription,keywords:['상품'],warnings:[],attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name,value:pair.value==='黑色'?'검정':'회색'}))}};};
  const fetcher=async(path,init={})=>{const response=await h.route(path,{method:init.method??'GET',body:init.body});if(path.endsWith('/translation-apply')&&JSON.parse(init.body).action==='preview'&&response.ok)previews.push(await response.clone().json());return response;};
  const current=()=>h.sqlite.prepare('SELECT * FROM products ORDER BY rowid DESC LIMIT 1').get();
  const intake=async()=>h.load('app/intake-collection.ts').collectIntakeProduct(await h.load('db/collection-jobs.ts').findCollectionJob('owner',job.id),{signal:new AbortController().signal,fetcher,onJob(){},onProgress(){}});
  const base=()=>'/api/products/'+current().id,content=async()=>(await json(await h.route(base()+'/content'))).content;
  const prepare=()=>h.load('app/intake-seo.ts').prepareIntakeSeoOutcome(current().id,fetcher,new AbortController().signal);
  const verifyOriginals=()=>{assert.equal(JSON.stringify({result:h.sqlite.prepare('SELECT * FROM collection_results').all(),context:h.sqlite.prepare('SELECT * FROM collection_context').all(),settings:h.sqlite.prepare('SELECT * FROM workspace_settings').all()}),originals);assert.deepEqual(Buffer.from(h.objects.get(profile.template.storageKey)),Buffer.from(bytes));assert.deepEqual(h.network,[]);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM supplier_hub_receipts').get().n,0);};
  return{h,company,profile,rawOptions,previews,intake,current,base,content,prepare,verifyOriginals};
 }catch(error){h.close();throw error;}
}

for(const company of companies)test(`Workers missing description remains review-required in intake, replay and original package (${company.code})`,{skip:!available},async()=>{
 const f=await workersDescriptionFixture(company),{h}=f;try{
  const message=await f.intake();assert.match(message,/검토 필요.*상품 설명 번역/);assert.doesNotMatch(message,/SEO·옵션 초안을 생성해 반영했습니다/);
  const content=await f.content();assert.ok(content.seo.title.value.includes('원문 기준 상품'));assert.equal(content.seo.description.value,description);assert.equal(content.seo.description.provenance,'collected');
  const options=(await json(await h.route(f.base()+'/options'))).options;assert.deepEqual(options.rows.map(row=>row.translatedName),['회색','검정']);assert.deepEqual(options.rows.map(row=>[row.supplierSku,row.unitCostCny,row.minimumOrderQuantity,row.stock]),f.rawOptions.map(row=>[row.sku,row.unitPriceCny,row.minimumOrder,row.stock]));
  assert.equal(f.previews[0].intakeSeoCoverage.missingDescription,true);assert.equal(f.previews[0].intakeSeoCoverage.contentRevision,f.previews[0].contentRevision);
  const fields=await json(await h.route(f.base()+'/quotation-fields')),detail=fields.resolved.rows[0].fields.detailHtml;assert.equal(detail.value,'<p>'+description+'</p>');assert.equal(detail.needsReview,true);assert.ok(detail.reviewMessages.some(value=>value.includes(reviewMessage)));assert.deepEqual(detail.validationIssues,[]);
  const exported=await json(await h.route(f.base()+'/quotation',{method:'POST',body:{action:'preview'}}));assert.ok(exported.submissionReview.issues.some(issue=>issue.kind==='review'&&issue.fieldId==='detailHtml'&&issue.message.includes(reviewMessage)));
  const downloaded=await h.route(f.base()+'/quotation',{method:'POST',body:{action:'download',fingerprint:exported.fingerprint}});assert.equal(downloaded.status,200,await downloaded.clone().text());const reader=h.load('app/xlsx-template.ts'),book=reader.inspectXlsxArchive(await reader.readXlsxArchive(await downloaded.arrayBuffer()));
  const title=f.profile.mappings.find(mapping=>mapping.field==='title');for(let i=0;i<2;i++)assert.equal(reader.xlsxHeaders(book,f.profile.template.sheetName,9+i)[title.column],exported.rows[i][title.column]);
  const packaged=await h.route(f.base()+'/quotation',{method:'POST',body:{action:'export',fingerprint:exported.fingerprint}});assert.equal(packaged.status,200);const archive=await reader.readXlsxArchive(await packaged.arrayBuffer());const review=JSON.parse(new TextDecoder().decode(archive.get('submission-review.json')));assert.ok(review.issues.some(issue=>issue.kind==='review'&&issue.fieldId==='detailHtml'&&issue.message.includes(reviewMessage)));
  const before=retained(h),outcome=await f.prepare();assert.equal(outcome.completed,false);assert.equal(outcome.reviewRequired,true);assert.equal(outcome.manualReady,false);assert.match(outcome.message,/상품 설명 번역/);await f.intake();assert.equal(retained(h),before);assert.equal(h.aiSources.length,1);f.verifyOriginals();
 }finally{h.close();}
});

for(const company of companies)test(`manual description, deliberate blanks and exact quotation overrides stay authoritative (${company.code})`,{skip:!available},async()=>{
 for(const manual of ['직접 확인한 한국어 설명','']){const f=await workersDescriptionFixture(company),{h}=f;try{
  await f.intake();const content=await f.content();await json(await h.route(f.base()+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{description:manual}}}}));
  let quote=await json(await h.route(f.base()+'/quotation-fields'));const saleField=h.load('app/quotation-price-targets.ts').quotationPriceTargets(quote.resolved.schema.fields).salePrice.primary,manualHtml=manual?'<p>用户保留</p>':'';await json(await h.route(f.base()+'/quotation-fields',{method:'PUT',body:{expectedRevision:quote.revision,expectedInputFingerprint:quote.inputFingerprint,changes:[{fieldKey:saleField,optionId:'collected-1',value:'45670'},{fieldKey:'detailHtml',optionId:'collected-2',value:manualHtml}]}}));
  const before=retained(h),outcome=await f.prepare();assert.equal(outcome.completed,true);assert.equal(outcome.reviewRequired,false);assert.equal(f.previews.at(-1).intakeSeoCoverage.missingDescription,false);assert.equal(retained(h),before);assert.equal(h.aiSources.length,1);
  quote=await json(await h.route(f.base()+'/quotation-fields'));const first=quote.resolved.rows.find(row=>row.optionId==='collected-1'),second=quote.resolved.rows.find(row=>row.optionId==='collected-2');assert.equal(first.fields[saleField].value,'45670');assert.equal(first.fields.detailHtml.value,manual?'<p>'+manual+'</p>':'');assert.ok(!first.fields.detailHtml.reviewMessages.some(value=>value.includes(reviewMessage)));assert.equal(second.fields.detailHtml.source,'manual-option');assert.equal(second.fields.detailHtml.value,manualHtml);assert.ok(!second.fields.detailHtml.reviewMessages.some(value=>value.includes(reviewMessage)));f.verifyOriginals();
 }finally{h.close();}}
});

for(const company of companies)test(`absent source description and a complete Korean description do not invent missing coverage (${company.code})`,{skip:!available},async()=>{
 for(const [source,translated]of [['',''],[description,'원문에 따른 한국어 설명']]){const f=await workersDescriptionFixture(company,source,translated),{h}=f;try{
  await f.intake();const outcome=await f.prepare();assert.equal(outcome.completed,true);assert.equal(outcome.reviewRequired,false);assert.ok(f.previews.every(value=>value.intakeSeoCoverage===undefined));const content=await f.content();assert.equal(content.seo.description.value,translated);assert.equal(h.aiSources.length,1);f.verifyOriginals();
 }finally{h.close();}}
});
