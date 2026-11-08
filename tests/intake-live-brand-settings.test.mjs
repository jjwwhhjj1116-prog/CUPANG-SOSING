import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies} from './helpers/hub-schema.mjs';

const categoryPath=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};

for(const [index,company] of schemaCompanies.entries())test(`saved member brand supplies fresh native SEO, label and quotation (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 try{
  const settings=h.load('app/api/settings/route.ts'),jobs=h.load('app/api/collection-jobs/route.ts');
  const request=(path,method,body)=>new Request('https://app.test'+path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const manualManufacturer=index?'직접 지정한 제조사':'',brand=company.name+' 새브랜드',storedBrand=', '+brand+', 보조 브랜드';
  await json(await settings.PUT(request('/api/settings','PUT',{...h.settings,expectedOwnerId:'owner',brand:storedBrand,manufacturer:manualManufacturer,importer:''})));
  const saved=(await json(await settings.GET())).settings;
  assert.equal(saved.brand,storedBrand);assert.equal(saved.manufacturer,manualManufacturer);assert.equal(saved.importer,'');
  const schema={...hubSchemaSnapshot(company,'69900'),categoryPath,nativeSerializationPolicy:'supplier-hub-native-required-form-v1',inputBindings:'couplus-paths-v1',draftInitialization:'couplus-required-v1',settingsInitialization:'couplus-options-v1'};
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'브랜드 기본값 검증',categoryId:'69900',categoryPath,hubSchema:schema,template:null,mappings:[]});
  h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?, source_url=? WHERE id=?').run('813724060929','https://detail.1688.com/offer/813724060929.html','job');
  const requestBody={urls:[h.sourceUrl],goal:'price',profileId:profile.id,expectedProfileRevision:profile.revision,expectedSettings:saved};
  const {jobs:[queued]}=await json(await jobs.POST(request('/api/collection-jobs','POST',requestBody)));
  assert.equal(queued.context.settings.brand,storedBrand);
  assert.equal(JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get('job').payload).settings.brand,h.settings.brand,'a previously captured job keeps its settings');
  await h.intake(queued.id);
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const {content}=await json(await h.route(base+'/content'));
  assert.equal(content.label.manufacturer.value,manualManufacturer||brand+' 협력사');
  assert.equal(content.label.manufacturer.provenance,manualManufacturer?'manual':'generated');
  assert.equal(content.label.importer.value,brand);assert.equal(content.label.importer.provenance,'generated');
  assert.ok(content.seo.title.value.startsWith(brand+' '),content.seo.title.value);
  const label=await json(await h.route(base+'/product-labels'));
  assert.ok(label.rows.every(row=>row.values.manufacturer===(manualManufacturer||brand+' 협력사')&&row.values.importer===brand));
  const quote=await json(await h.route(base+'/quotation-fields'));
  assert.ok(quote.resolved.rows.every(row=>row.fields.brand.value===brand&&row.fields.title.value.startsWith(brand+' ')));
  const option=label.rows.find(row=>row.optionId&&row.included);
  await json(await h.route(base+'/product-labels',{method:'PUT',body:{expectedRevision:label.revision,expectedInputFingerprint:label.inputFingerprint,changes:[{optionId:option.optionId,fieldKey:'manufacturer',value:''},{optionId:option.optionId,fieldKey:'importer',value:'직접 입력한 수입판매원'}]}}));
  const reopened=(await json(await h.route(base+'/product-labels'))).rows.find(row=>row.optionId===option.optionId);
  assert.equal(reopened.values.manufacturer,'');assert.equal(reopened.values.importer,'직접 입력한 수입판매원');
  assert.equal(reopened.sources.manufacturer,'manual-option');assert.equal(reopened.sources.importer,'manual-option');
 }finally{h.close();}
});
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
