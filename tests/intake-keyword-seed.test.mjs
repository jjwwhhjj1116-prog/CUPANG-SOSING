import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const modules=new Map();
function load(file){
 if(modules.has(file))return modules.get(file);
 const exports={};modules.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Date,Error,TextEncoder,TextDecoder,Uint8Array,DataView,structuredClone,require:name=>load(name.slice(2)+'.ts')});
 return exports;
}
const model=load('app/product-content.ts'),adopt=load('app/translation-batch-adoption.ts').translationBatchAdoption;
function fixture(){
 const now='2026-10-01T01:00:00.000Z',settings=load('app/workspace-settings.ts').defaultSettings;
 const collection={id:'job',offer_id:'813724060928',context:{category:{id:'cat',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']},settings,features:'',keywords:' 상품\n상품 ',capturedAt:now},goal:'price'};
 const receipt={schemaVersion:1,offerId:collection.offer_id,sourceUrl:'https://detail.1688.com/offer/813724060928.html',provider:'fixture',collectedAt:now,title:'太阳镜',description:'商品说明',attributes:[],images:[],options:[{sku:'a',name:'黑',unitPriceCny:3.6,minimumOrder:1,stock:10}]};
 const prepared=load('app/collection-product.ts').prepareCollectionProduct('owner',collection,receipt,'p',now);
 const source=load('app/collected-seo-source.ts').collectedSeoSource(receipt,collection,prepared.options).source;
 const job={id:'translation',productId:'p',productVersion:'v',contentRevision:prepared.content.revision,status:'completed',review:{source},result:{draft:{title:'선글라스',description:'검토 설명',keywords:['선글라스','우드 패턴','남녀공용'],attributes:[]}}};
 return {...prepared,job};
}

test('product-add target guidance becomes generated SEO tags on the first matching source draft',()=>{
 const {content,job}=fixture(),before=JSON.stringify({content,job});
 const plan=adopt(content,job,'v');
 assert.deepEqual(Array.from(plan.input.patch.seo.keywords),job.result.draft.keywords);
 assert.ok(plan.preview.some(row=>row.name==='검색어'&&row.before==='상품'&&row.after==='선글라스, 우드 패턴, 남녀공용'));
 const saved=model.applyContentPatch(content,plan.input.patch,'2026-10-01T02:00:00.000Z');
 assert.equal(saved.intakeKeywordSeed,undefined);
 assert.equal(saved.seo.keywords.provenance,'manual');
 assert.equal(JSON.stringify({content,job}),before);
 assert.equal(adopt(saved,job,'v').input,null);
});

for(const keywords of [['상품'],['직접 검색어'],[]])test(`an explicit stage-one keyword save consumes guidance even for ${JSON.stringify(keywords)}`,()=>{
 const {content,job}=fixture();
 const saved=model.applyContentPatch(content,{seo:{keywords}},'2026-10-01T02:00:00.000Z');
 assert.equal(saved.intakeKeywordSeed,undefined);
 const plan=adopt(saved,job,'v');
 assert.equal(plan.input.patch.seo.keywords,undefined);
 assert.ok(plan.skipped.some(message=>message.startsWith('검색어:')));
 assert.deepEqual(Array.from(saved.seo.keywords.value),keywords);
});

test('unrelated stage edits preserve the unconfirmed target guidance for the initial AI draft',()=>{
 const {content,job}=fixture();
 const saved=model.applyContentPatch(content,{seo:{title:'직접 제목'},label:{material:'확인 재질'}},'2026-10-01T02:00:00.000Z');
 assert.ok(saved.intakeKeywordSeed);
 const plan=adopt(saved,job,'v');
 assert.equal(plan.input.patch.seo.title,undefined);
 assert.deepEqual(Array.from(plan.input.patch.seo.keywords),job.result.draft.keywords);
 assert.equal(plan.input.patch.label?.material,undefined);
});

test('legacy manual keywords and changed seed identity, value or timestamp remain protected',()=>{
 for(const change of [
  ({content})=>delete content.intakeKeywordSeed,
  ({content})=>{content.seo.keywords.value=['직접 저장'];},
  ({content})=>{content.seo.keywords.updatedAt='2026-10-01T03:00:00.000Z';},
  ({job})=>{job.review.source.guidance.keywords='다른 입력';},
  ({job})=>{job.review.source.reference='다른 상품의 원문';},
  ({job})=>delete job.review.source.guidance,
 ]){
  const data=fixture();change(data);
  assert.equal(adopt(data.content,data.job,'v').input.patch.seo.keywords,undefined);
 }
});

test('the seed marker is server-owned and cannot be restored by an editor patch',()=>{
 assert.throws(()=>model.validateContentInput({expectedRevision:0,patch:{intakeKeywordSeed:{value:['상품']}}},[],'owner'),/지원하지 않는/);
});

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`URL target guidance reaches generated and manually reviewed quotation tags and XLSX (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company),generated=['선글라스','우드 패턴','남녀공용'];
 try{
  h.context.keywords='상품';h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  const run=h.bindings.AI.run;h.bindings.AI.run=async(...args)=>{const result=await run(...args);result.response.keywords=generated;return result;};
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  assert.equal(h.aiSources.length,1);assert.equal(h.aiSources[0].guidance.keywords,'상품');
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  assert.deepEqual(content.seo.keywords.value,generated);assert.equal(content.intakeKeywordSeed,undefined);
  let view=await json(await h.route(base+'/quotation-fields'));
  assert.equal(view.categoryContext.categoryId,'80719');assert.equal(view.resolved.rows.length,7);
  assert.ok(view.resolved.rows.every(row=>row.fields.searchTags.value===generated.join(', ')));
  const reviewed=['검토한 선글라스','케이스'];
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{keywords:reviewed}}}}));
  const requests=h.network.length;await h.intake();assert.equal(h.aiSources.length,1);assert.equal(h.network.length,requests);
  view=await json(await h.route(base+'/quotation-fields'));assert.ok(view.resolved.rows.every(row=>row.fields.searchTags.value===reviewed.join(', ')));
  const fields=['skuId','categoryId','sourceUrl','searchTags'],workbook=quotationWorkbook(fields);
  const sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 키워드 양식 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,template:{name:'synthetic.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  const downloaded=await h.route(base+'/quotation',{method:'POST',body:{action:'download',fingerprint:preview.fingerprint}});
  assert.equal(downloaded.status,200,await downloaded.clone().text());
  const reader=h.load('app/xlsx-template.ts'),archive=await reader.readXlsxArchive(await downloaded.arrayBuffer());
  for(let index=0;index<6;index++){
   const cells=reader.xlsxHeaders(reader.inspectXlsxArchive(archive),'견적서',index+2);
   assert.equal(cells[1],'80719');assert.equal(cells[2],h.sourceUrl);assert.equal(cells[3],reviewed.join(', '));
  }
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{h.close();}
});
