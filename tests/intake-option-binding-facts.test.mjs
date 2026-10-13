import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const companies=[{companyCode:'A01526306',companyName:'유앤채'},{companyCode:'A01464742',companyName:'와이홉'}];
const offerId='638000000011',sourceUrl=`https://detail.1688.com/offer/${offerId}.html`;
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const payload=(h,table)=>JSON.parse(h.sqlite.prepare('SELECT payload FROM '+table).get().payload);
const immutable=h=>JSON.stringify(Object.fromEntries(['collection_results','collection_context','category_profiles'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()])));

// One small synthetic source proves the ordinary URL-to-draft flow. Auth, AI
// and XLSX fixture transport stay local; this does not read any real offer.
export async function bindingFactsFixture(company=companies[0],provider='workers-ai'){
 const queries=[],translations=new Map([['收纳篮','수납 바스켓'],['收纳篮商品说明','수납 바스켓 상품 설명'],['红色款','빨강형'],['灰色款','회색형'],['红色','빨강 1cm'],['灰色','회색'],['大型','대형']]);
 const h=mobileIntakeHarness({...company,translationFetcher:async target=>{
  const url=new URL(target),q=url.searchParams.get('q');queries.push(q);assert.equal(url.origin,'https://translate.googleapis.com');assert.ok(!q.includes('collected-'));
  const translate=text=>{assert.ok(translations.has(text),text);return translations.get(text);};
  const text=q.startsWith('[[YFTR')?q.split('\n').map(line=>{const match=/^(\[\[YFTR\d{6}\]\]) (.+)$/u.exec(line);assert.ok(match);return `${match[1]} ${translate(match[2])}`;}).join('\n'):translate(q);
  return Response.json([[[text,q]],null,'zh-CN']);
 }});
 try{
  h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=?,goal=? WHERE id=?').run(offerId,sourceUrl,'price','job');
  const receipt=h.load('app/collection-result.ts').validateCollectionResult({schemaVersion:1,sourceUrl,provider:'synthetic-local-v1',collectedAt:new Date().toISOString(),
   title:'收纳篮',description:'收纳篮商品说明',attributes:[],options:[
    {sku:'LOCAL63811',name:'红色款',unitPriceCny:12.5,minimumOrder:1,stock:5,color:'红色',size:'大型'},
    {sku:'LOCAL63812',name:'灰色款',unitPriceCny:6.5,minimumOrder:2,stock:0,color:'灰色',size:'12 cm'},
   ],images:[]},offerId);
  await h.load('db/collection-results.ts').storeCollectionResult('owner','job',receipt);
  const schema=h.load('app/quotation-schema.ts').getQuotationSchema('80719'),headers=['skuId','sourcePriceCny',...schema.fields.map(field=>field.id)],bytes=quotationWorkbook(headers),sha256=createHash('sha256').update(bytes).digest('hex'),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');
  h.objects.set(storageKey,bytes);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'LOCAL OPTION FACTS XLSX',categoryId:'80719',categoryPath:h.context.category.categoryPath,
   template:{name:'synthetic-option-facts.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers},mappings:headers.map((field,column)=>({field,column,required:false}))},'cat');
  h.context.category=profile;h.context.keywords='';h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));
  let source;
  h.bindings.AI.run=async(_model,input)=>{
   source=JSON.parse(input.messages[1].content);
   return {response:{title:'수납 바스켓',description:'수납 바스켓 상품 설명',keywords:['수납'],warnings:[],attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name,
    value:pair.name==='option-color:collected-1'?'빨강 1cm':pair.value==='红色款'?'빨강형':pair.value==='灰色款'?'회색형':pair.value==='红色'?'빨강':pair.value==='灰色'?'회색':pair.value==='大型'?'대형':pair.value}))}};
  };
  if(provider==='google-free'){h.bindings.SOURCEFLOW_TEXT_PROVIDER=provider;delete h.bindings.AI;}
  const product=()=>h.sqlite.prepare('SELECT * FROM products').get();
  const read=async()=>json(await h.route('/api/products/'+product().id+'/quotation-fields'));
  const workbook=async()=>{
   const base='/api/products/'+product().id,preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}})),download=await h.route(base+'/quotation',{method:'POST',body:{action:'download',fingerprint:preview.fingerprint}});
   assert.equal(download.status,200,await download.clone().text());const reader=h.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer()));
   return{preview,cells:preview.rows.map((_,index)=>reader.xlsxHeaders(sheet,'견적서',index+2))};
  };
  return{h,receipt,headers,bytes,storageKey,product,read,workbook,queries,get runs(){return h.sqlite.prepare('SELECT COUNT(*) AS n FROM translation_jobs WHERE started_at IS NOT NULL').get().n;},get source(){return source;}};
 }catch(error){h.close();throw error;}
}

for(const company of companies)for(const provider of ['workers-ai','google-free'])test(`unsupported option-ID number stays original while valid SEO/options reach quotation and XLSX (${company.companyCode}, ${provider})`,async()=>{
 const f=await bindingFactsFixture(company,provider),{h}=f;
 try{
  const sourceBefore=immutable(h),objects=new Map([...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes)]));
  const outcome=await h.intake();assert.match(outcome,/검토 필요/);assert.match(outcome,/누락 1개/);assert.equal(f.runs,1);
  assert.equal(h.network.length,f.queries.length);assert.ok(h.network.every(host=>host==='translate.googleapis.com'));assert.equal(immutable(h),sourceBefore,'captured source and category/template data stay intact');
  const content=payload(h,'product_content'),options=payload(h,'product_options'),policy=h.load('app/pricing.ts').pricePolicy(h.settings),view=await f.read();
  assert.equal(content.seo.title.value,'검토 브랜드 수납 바스켓');assert.equal(content.seo.description.value,'수납 바스켓 상품 설명');assert.deepEqual(content.seo.keywords.value,provider==='google-free'?['수납','바스켓']:['수납']);
  assert.equal(options.rows[0].translatedName,'빨강형');assert.equal(options.rows[0].color,'红色');assert.equal(options.rows[0].provenance.color,'collected');assert.equal(options.rows[0].size,'대형');
  assert.equal(options.rows[1].translatedName,'회색형');assert.equal(options.rows[1].color,'회색');assert.equal(options.rows[1].size,'12 cm');
  const job=h.sqlite.prepare("SELECT * FROM translation_jobs WHERE idempotency_key='intake-auto-v1'").get(),result=JSON.parse(job.result);
  assert.equal(job.status,'completed');assert.deepEqual(result.draft.attributes.map(item=>item.sourceIndex),[0,2,3,4,5]);assert.match(result.draft.warnings.join(' '),/원문에 없는 숫자.*1개/);
  for(const [index,row]of options.rows.entries()){
   const original=f.receipt.options[index],fields=view.resolved.rows.find(value=>value.optionId===row.id).fields,calculated=h.load('app/pricing.ts').calculatePrice(original.unitPriceCny,policy,row.unitsPerPack);
   assert.equal(row.unitCostCny,original.unitPriceCny);assert.equal(row.minimumOrderQuantity,original.minimumOrder);assert.equal(row.stock,original.stock);assert.equal(row.supplierSku,original.sku);
   for(const key of ['supplyPrice','salePrice','msrp'])assert.equal(fields[key].value,String(calculated[key]));
   assert.equal(fields.color.value,index===0?'红色':'회색');
  }
  const exported=await f.workbook();assert.equal(exported.cells.length,2);assert.deepEqual(exported.preview.report.company,{code:company.companyCode,name:company.companyName});
  assert.deepEqual(exported.cells.map(row=>row[f.headers.indexOf('color')]),['红色','회색']);assert.ok(exported.cells.every(row=>!row.includes('빨강 1cm')));
  assert.deepEqual(exported.cells.map(row=>row[f.headers.indexOf('title')]),[content.seo.title.value,content.seo.title.value]);
  for(const [index,row]of exported.cells.entries())for(const key of ['supplyPrice','salePrice','msrp'])assert.equal(row[f.headers.indexOf(key)],view.resolved.rows.find(value=>value.optionId===options.rows[index].id).fields[key].value);
  for(const [key,bytes]of objects)assert.deepEqual(Buffer.from(h.objects.get(key)),bytes);assert.equal(h.objects.size,objects.size);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_receipts').get().n,0);assert.equal(f.product().supplier_hub_status,'미전송');
 }finally{h.close();}
});

for(const company of companies)for(const provider of ['workers-ai','google-free'])test(`retry preserves manual options, deliberate blanks and price overrides without accepting an old ID-number result (${company.companyCode}, ${provider})`,async()=>{
 const f=await bindingFactsFixture(company,provider),{h}=f;
 try{
  await h.intake();const base='/api/products/'+f.product().id;
  let state=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(state.options);rows[0].color='직접 확인한 빨강';rows[0].unitCostCny=15;rows[0].unitsPerPack=3;rows[1].included=false;
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:state.options.revision,expectedProductVersion:state.productVersion,rows}}));
  state=await json(await h.route(base+'/options'));rows=h.load('app/product-options.ts').optionInputs(state.options);rows[0].color='';rows[0].translatedName='';
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:state.options.revision,expectedProductVersion:state.productVersion,rows}}));
  let view=await f.read();await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'salePrice',optionId:'collected-1',value:'45000'}]}}));
  const preserved=JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_quotation_fields','collection_results','collection_context','translation_jobs','product_price_policy'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()]))),runs=f.runs,queries=f.queries.length;
  await h.intake();assert.equal(f.runs,runs);assert.equal(JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_quotation_fields','collection_results','collection_context','translation_jobs','product_price_policy'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()]))),preserved);
  const current=payload(h,'product_options');assert.equal(current.rows[0].color,'');assert.equal(current.rows[0].provenance.color,'manual');assert.equal(current.rows[0].translatedName,'');assert.equal(current.rows[0].unitCostCny,15);assert.equal(current.rows[0].unitsPerPack,3);assert.equal(current.rows[1].included,false);
  view=await f.read();assert.equal(view.resolved.rows.find(row=>row.optionId==='collected-1').fields.salePrice.value,'45000');
  const exported=await f.workbook();assert.equal(exported.cells.length,1);assert.equal(exported.cells[0][f.headers.indexOf('color')],'');assert.equal(exported.cells[0][f.headers.indexOf('salePrice')],'45000');
  assert.equal(f.queries.length,queries);assert.equal(h.network.length,queries);assert.ok(h.network.every(host=>host==='translate.googleapis.com'));assert.equal(f.product().supplier_hub_status,'미전송');
 }finally{h.close();}
});
