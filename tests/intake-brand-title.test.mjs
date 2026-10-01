import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

function loader(overrides={}){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file);
  const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Error,URL,Response,TextEncoder,TextDecoder,Uint8Array,DataView,structuredClone,crypto:webcrypto,process:{env:{NODE_ENV:'development'}},require:name=>name in overrides?overrides[name]:name==='next/server'?{NextResponse:Response}:load(name.slice(2)+'.ts')});
  return exports;
 }
 return load;
}
const load=loader(),cm=load('app/product-content.ts'),adopt=load('app/translation-batch-adoption.ts').translationBatchAdoption;
const version='2026-10-01T01:00:00.000Z',jobId='11111111-1111-4111-8111-111111111111';
function fixture(){
 const content=cm.emptyProductContent('p');content.seo.title={value:'太阳镜',provenance:'collected',updatedAt:version};
 const options=load('app/product-options.ts').emptyProductOptions('p');
 const job={id:jobId,productId:'p',productVersion:version,contentRevision:0,status:'completed',review:{source:{attributes:[],category:{id:'80719',path:['바스켓']}}},result:{draft:{title:'우드 패턴 선글라스',description:'',keywords:[],attributes:[]}}};
 return {content,options,job};
}

test('captured brand prefixes the reviewed intake title and linked label without changing source facts',()=>{
 const {content,job}=fixture(),before=JSON.stringify({content,job});
 const plan=adopt(content,job,version,'와이홉');
 assert.equal(plan.input.patch.seo.title,'와이홉 우드 패턴 선글라스');
 assert.equal(plan.input.patch.label.productName,plan.input.patch.seo.title);
 assert.ok(plan.preview.some(row=>row.name==='상품명'&&row.after===plan.input.patch.seo.title));
 assert.ok(plan.preview.some(row=>row.name==='품명 · SEO 상품명 연동'&&row.after===plan.input.patch.seo.title));
 assert.equal(JSON.stringify({content,job}),before);
 const saved=cm.applyContentPatch(content,plan.input.patch,'next');
 assert.equal(saved.label.productName.value,saved.seo.title.value);
 assert.equal(adopt(saved,job,version,'다른 브랜드').input,null);
});

test('a generated brand prefix is not duplicated and a similar word is not mistaken for the brand',()=>{
 for(const [title,expected] of [['와이홉 우드 패턴 선글라스','와이홉 우드 패턴 선글라스'],['와이홉\t선글라스','와이홉\t선글라스'],['와이홉','와이홉'],['와이홉풍 선글라스','와이홉 와이홉풍 선글라스']]){
  const {content,job}=fixture();job.result.draft.title=title;
  assert.equal(adopt(content,job,version,' 와이홉 ').input.patch.seo.title,expected);
 }
});

test('missing or deliberately blank captured brand leaves the source draft title alone',()=>{
 for(const brand of [undefined,'','  ']){
  const {content,job}=fixture();assert.equal(adopt(content,job,version,brand).input.patch.seo.title,job.result.draft.title);
 }
 const {content,job}=fixture();job.result.draft.title='  ';
 const plan=adopt(content,job,version,'와이홉');
 assert.equal(plan.input?.patch.seo?.title,undefined);assert.ok(!plan.preview.some(row=>row.after==='와이홉'));
});

test('reviewed manual titles and unlinked label names including blank inputs remain authoritative',()=>{
 for(const title of ['직접 확인한 이름','']){
  const {content,job}=fixture();content.seo.title={value:title,provenance:'manual',updatedAt:version};
  content.labelProductNameLinked=false;content.label.productName={value:'별도 라벨 이름',provenance:'manual',updatedAt:version};
  assert.equal(adopt(content,job,version,'와이홉').input,null);
 }
 const {content,job}=fixture();content.labelProductNameLinked=false;content.label.productName={value:'라벨 이름',provenance:'manual',updatedAt:version};
 const plan=adopt(content,job,version,'와이홉'),saved=cm.applyContentPatch(content,plan.input.patch,'next');
 assert.equal(saved.seo.title.value,'와이홉 우드 패턴 선글라스');assert.equal(saved.label.productName.value,'라벨 이름');
});

test('prefixed titles obey content limits without truncation or partially mutating the draft',()=>{
 const {content,job}=fixture();job.result.draft.title='가'.repeat(496);const before=JSON.stringify({content,job});
 assert.throws(()=>adopt(content,job,version,'와이홉브랜드'),/500/);
 assert.equal(JSON.stringify({content,job}),before);
 job.result.draft.title='가'.repeat(496);assert.equal(adopt(content,job,version,'와이홉').input.patch.seo.title.length,500);
});

test('option-only continuation cannot alter a title or label using a captured brand',()=>{
 const {content,options,job}=fixture();
 const plan=load('app/translation-integrated-adoption.ts').integratedTranslationPlan(content,options,job,version,'options',false,'와이홉');
 assert.equal(plan.patch,null);assert.equal(plan.preview.length,0);
});

test('API review binds the brand to the exact captured intake and rejects a changed snapshot before saving',async()=>{
 const {content,options,job}=fixture();let captured={brand:'와이홉'},saves=0;
 const api=loader({
  '@/app/chatgpt-auth':{getWorkspaceOwnerId:async()=>'owner'},
  '@/db/queries':{findProduct:async()=>({id:'p',updated_at:version,image_keys:'[]',source_url:'https://detail.1688.com/offer/813724060928.html'})},
  '@/db/product-content':{readProductContent:async()=>content},'@/db/product-options':{readProductOptions:async()=>options},
  '@/db/translation-jobs':{getTranslationJob:async()=>job},
  '@/db/translation-category-source':{readTranslationCategorySource:async()=>({offerId:'813724060928',snapshot:{linked:true,payload:JSON.stringify({settings:captured})}})},
  '@/db/quotation-attribute-rules':{getAttributeRules:async()=>null},
  '@/db/translation-adoption':{saveIntegratedTranslation:async(_owner,next)=>{saves++;assert.equal(next.seo.title.value,'와이홉 우드 패턴 선글라스');return true;}},
 })('app/api/products/[id]/translation-apply/route.ts');
 const call=body=>api.POST(new Request('https://app.test/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId,expectedVersion:version,...body})}),{params:Promise.resolve({id:'p'})});
 const response=await call({action:'preview'});assert.equal(response.status,200);const preview=await response.json();
 assert.ok(preview.preview.some(row=>row.name==='상품명'&&row.after==='와이홉 우드 패턴 선글라스'));assert.equal(saves,0);
 assert.equal((await call({action:'preview',intakeBrand:'요청에 끼운 브랜드'})).status,400);assert.equal(saves,0);
 captured={brand:'다른 브랜드'};assert.equal((await call({action:'apply',fingerprint:preview.fingerprint})).status,409);assert.equal(saves,0);
 captured={brand:'와이홉'};assert.equal((await call({action:'apply',fingerprint:preview.fingerprint})).status,200);assert.equal(saves,1);
});

test('API leaves missing and explicitly empty intake brands blank without reading later account settings',async()=>{
 for(const snapshot of [null,{linked:true,payload:'{}'},{linked:true,payload:JSON.stringify({settings:{}})},{linked:true,payload:JSON.stringify({settings:{brand:''}})}]){
  const {content,options,job}=fixture();
  const api=loader({
   '@/app/chatgpt-auth':{getWorkspaceOwnerId:async()=>'owner'},
   '@/db/queries':{findProduct:async()=>({id:'p',updated_at:version,image_keys:'[]',source_url:'https://detail.1688.com/offer/813724060928.html'}),getSettings:async()=>{throw Error('Must not substitute later workspace settings');}},
   '@/db/product-content':{readProductContent:async()=>content},'@/db/product-options':{readProductOptions:async()=>options},
   '@/db/translation-jobs':{getTranslationJob:async()=>job},
   '@/db/translation-category-source':{readTranslationCategorySource:async()=>({offerId:'813724060928',snapshot})},
   '@/db/quotation-attribute-rules':{getAttributeRules:async()=>null},'@/db/translation-adoption':{saveIntegratedTranslation:async()=>{throw Error('Preview must not save');}},
  })('app/api/products/[id]/translation-apply/route.ts');
  const response=await api.POST(new Request('https://app.test/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'preview',jobId,expectedVersion:version})}),{params:Promise.resolve({id:'p'})});
  assert.equal(response.status,200,await response.clone().text());assert.ok((await response.json()).preview.some(row=>row.name==='상품명'&&row.after==='우드 패턴 선글라스'));
 }
});

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`captured brand and reviewed title stay linked across URL intake, all SKU quotations and XLSX (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company),generated=company.companyName+' 우드 패턴 다리 선글라스';
 try{
  h.context.settings={...h.context.settings,brand:company.companyName};
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  await h.load('db/queries.ts').saveSettings('owner',JSON.stringify({...h.settings,brand:'수집 후 계정 브랜드'}));
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload),original=JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload);
  assert.equal(product.title,original.title);assert.equal(h.aiSources[0].title,original.title);assert.equal(h.aiSources.length,1);
  assert.equal(content.seo.title.value,generated);assert.equal(content.label.productName.value,generated);
  let view=await json(await h.route(base+'/quotation-fields'));assert.equal(view.resolved.rows.length,7);
  for(const row of view.resolved.rows){assert.equal(row.fields.title.value,generated);assert.equal(row.fields.brand.value,company.companyName);assert.equal(row.fields.noticeNameModel.value,generated);assert.equal(row.fields.model.value,'');}
  const listed=await json(await h.load('app/api/products/route.ts').GET());assert.equal(listed.products[0].content_summary.seoTitle,generated);
  const detail=()=>h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test'+base),{params:Promise.resolve({id:product.id})});
  let workspace=await json(await detail());assert.deepEqual(workspace.product.content_summary,listed.products[0].content_summary);assert.equal(workspace.product.title,original.title);
  const reviewed='검토자가 확정한 선글라스';
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:reviewed}}}}));
  const requests=h.network.length;await h.intake();assert.equal(h.aiSources.length,1);assert.equal(h.network.length,requests);
  view=await json(await h.route(base+'/quotation-fields'));
  for(const row of view.resolved.rows){assert.equal(row.fields.title.value,reviewed);assert.equal(row.fields.noticeNameModel.value,reviewed);assert.equal(row.fields.brand.value,company.companyName);}
  workspace=await json(await detail());assert.equal(workspace.product.content_summary.seoTitle,reviewed);assert.equal(workspace.product.title,original.title);
  const fields=['skuId','categoryId','sourceUrl','title','brand','noticeNameModel'],workbook=quotationWorkbook(fields);
  const sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const key=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(key,workbook);
  await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 브랜드 연결 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,template:{name:'synthetic.xlsx',format:'xlsx',sha256,storageKey:key,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  const downloaded=await h.route(base+'/quotation',{method:'POST',body:{action:'download',fingerprint:preview.fingerprint}});assert.equal(downloaded.status,200,await downloaded.clone().text());
  const reader=h.load('app/xlsx-template.ts'),archive=await reader.readXlsxArchive(await downloaded.arrayBuffer());
  for(let index=0;index<6;index++){
   const cells=reader.xlsxHeaders(reader.inspectXlsxArchive(archive),'견적서',index+2);
   assert.equal(cells[1],'80719');assert.equal(cells[2],h.sourceUrl);assert.equal(cells[3],reviewed);assert.equal(cells[4],company.companyName);assert.equal(cells[5],reviewed);
  }
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
  const current=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:current.revision,patch:{seo:{title:''}}}}));
  workspace=await json(await detail());assert.equal(workspace.product.content_summary.seoTitle,'');assert.equal(workspace.product.title,original.title);
  const missing=await h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test/api/products/foreign'),{params:Promise.resolve({id:'foreign'})});assert.equal(missing.status,404);
 }finally{h.close();}
});
