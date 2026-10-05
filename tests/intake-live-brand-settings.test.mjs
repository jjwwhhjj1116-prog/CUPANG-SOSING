import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const categoryPath=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(`live free-text brand keeps captured settings through intake, manual review and quotation (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  // Only the observed public 69900 paths and brand constraints, no private profile.
  const hubSchema={format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath,company,observedAt:Date.now(),metadata:{kanCategoryId:2624,noticeNumber:4,scopeType:'Retail_Categorized_Single',version:188},inputBindings:'couplus-paths-v1',draftInitialization:'couplus-required-v1',settingsInitialization:'couplus-options-v1',schemaString:JSON.stringify({type:'object',required:['startPage','productPage'],properties:{startPage:{type:'object',required:['productName','categoryPath'],properties:{productName:{type:'string',title:'상품명'},categoryPath:{type:'string',title:'카테고리'}}},productPage:{type:'object',required:['brand'],properties:{brand:{type:'string',title:'브랜드',minLength:1,dropdown:['브랜드 없음'],examples:['탐사']},manufacturer:{type:'string',title:'제조사'}}},legalPage:{type:'object',properties:{}}}})};
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'관찰 브랜드 입력',categoryId:'69900',categoryPath,hubSchema,template:null,mappings:[]},'cat');
  h.context.category=profile;h.context.settings={...h.context.settings,brand:company.name};
  const captured=JSON.stringify(h.context);h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(captured,'job');
  await h.load('db/queries.ts').saveSettings('owner',JSON.stringify({...h.settings,brand:'나중에 저장한 브랜드'}));
  await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,url=base+'/quotation-fields';
  const originals=h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,options=h.sqlite.prepare('SELECT payload FROM product_options').get().payload;
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  assert.ok(content.seo.title.value.startsWith(company.name+' '));
  let view=await json(await h.route(url));assert.equal(view.resolved.rows.length,7);
  for(const row of view.resolved.rows){assert.equal(row.fields.brand.value,company.name);assert.equal(row.fields.brand.source,'settings');}
  const quote=h.load('app/exports/quotation-source.ts'),fields=h.load('app/exports/quotation-fields.ts');
  const exported=async()=>{const source=await quote.readQuotationExportSource('owner',product.id,profile.id);assert.equal(source.hubSchema.schemaString,hubSchema.schemaString);return fields.resolvedQuotationRows(source,quote.resolveQuotationExport(source),[]);};
  for(const row of await exported())assert.equal(row.brand,company.name);
  const optionId=view.resolved.rows.find(row=>row.optionId).optionId;
  view=await json(await h.route(url,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'brand',optionId:null,value:'직접 확인한 브랜드'},{fieldKey:'brand',optionId,value:''}]}}));
  const requests=h.aiSources.length;await h.intake();assert.equal(h.aiSources.length,requests);
  view=await json(await h.route(url));
  for(const row of view.resolved.rows){assert.equal(row.fields.brand.value,row.optionId===optionId?'':'직접 확인한 브랜드');assert.equal(row.fields.brand.source,row.optionId===optionId?'manual-option':'manual-common');}
  const rows=await exported();assert.equal(rows[0].brand,'');assert.ok(rows.slice(1).every(row=>row.brand==='직접 확인한 브랜드'));
  assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,originals);
  assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,options);
  assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,captured);
 }finally{h.close();}
});
