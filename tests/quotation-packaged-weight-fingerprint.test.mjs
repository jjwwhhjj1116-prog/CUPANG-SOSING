import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const path=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
const product={id:'local',owner_id:'owner',title:'LOCAL TEST ONLY',source_url:'https://detail.1688.com/offer/123456789.html',source_price_cny:10,exchange_rate:100,supply_margin:0,coupang_margin:0,supply_price:1000,sale_price:1000,msrp:1300,options_count:1,image_keys:'[]',created_at:'2026-09-24T00:00:00.000Z',updated_at:'2026-09-24T00:00:00.000Z'};
function fixture(company={code:'A01464742',name:'와이홉'}){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name}),q=h.load('app/quotation-schema.ts'),helper=h.load('app/quotation-packaged-weight.ts'),options=h.load('app/product-options.ts');
 const hubSchema={format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath:path,company,observedAt:1,inputBindings:'couplus-paths-v1',metadata:{kanCategoryId:2624,noticeNumber:4,scopeType:'Retail_Categorized_Single',version:188},
  schemaString:JSON.stringify({type:'object',properties:{startPage:{type:'object',properties:{productName:{type:'string',title:'상품명'},categoryPath:{type:'string',title:'카테고리'}}},productPage:{type:'object',properties:{}},legalPage:{type:'object',properties:{}},logisticsPage:{type:'object',properties:{skuUnitBoxWeight:{type:'string',title:'한 개 단품 포장 무게',minLength:1,requirement:'필수'}}}}})};
 const schema=q.getQuotationSchema('69900',path,hubSchema),wire=schema.fields.find(field=>field.numericText&&field.hubInput==='packagedWeightG');assert.ok(wire);
 const content=h.load('app/product-content.ts').emptyProductContent(product.id),settings=h.load('app/workspace-settings.ts').defaultSettings;
 const option=(id,weight=null,included=true)=>({...options.emptyOptionInput(id),unitCostCny:10,included,packagedWeightG:weight,
  provenance:Object.fromEntries(Object.keys(options.optionFieldNames).map(key=>[key,'unverified'])),updatedAt:product.updated_at});
 const input=(overrides,rows=[option('sku')])=>({categoryId:'69900',categoryPath:path,product,content,settings,options:{schemaVersion:1,productId:product.id,revision:0,updatedAt:null,rows},overrides,hubSchema});
 function compare(overrides,rows){
  const source=input(overrides,rows),beforeSource=JSON.stringify(source),current=q.resolveQuotationFields(source),actual=helper.quotationPackagedWeightManual;
  let previous;
  // Disabling only the added alias leaves the actual resolver's former own
  // option/common lookup and automatic values intact. No mirror resolver.
  try{helper.quotationPackagedWeightManual=()=>null;previous=q.resolveQuotationFields(source);}finally{helper.quotationPackagedWeightManual=actual;}
  let automaticReads=0;
  const automatic=()=>{automaticReads++;return q.resolveQuotationFields({...source,overrides:{common:{},options:{}}});};
  const marker=helper.quotationPackagedWeightBindingFingerprint(overrides,current,automatic);
  assert.equal(JSON.stringify(source),beforeSource,'source and stored overrides are immutable');
  assert.deepEqual(plain(current.schema),plain(previous.schema),'the schema contract is unchanged');
  return {source,current,previous,marker,automaticReads};
 }
 return {h,q,helper,wire,hubSchema,option,input,compare};
}

test('either one-sided g override changes actual resolved cells and only its selective fingerprint marker',async()=>{
 const f=fixture();try{
  for(const id of ['packagedWeightG',f.wire.id]){
   const result=f.compare({common:{[id]:'420'},options:{}}),peer=id==='packagedWeightG'?f.wire.id:'packagedWeightG';
   const before=result.previous.rows.find(row=>row.included),after=result.current.rows.find(row=>row.included);
   assert.equal(before.fields[peer].value,'');assert.equal(after.fields[peer].value,'420');assert.equal(after.fields[peer].validationIssues.length,0);
   assert.deepEqual(plain(result.marker),{packagedWeightBindingRevision:'exact-g-pair-v1'});assert.equal(result.automaticReads,1);
   const fingerprint=f.h.load('app/automation/model.ts').fingerprint,base={raw:result.source,schema:result.current.schema};
   assert.notEqual(await fingerprint({...base,...result.marker}),await fingerprint(base));
  }
 }finally{f.h.close();}
});

test('peer option overrides displace old own common values while equal-layer conflicts preserve legacy identity',()=>{
 const f=fixture();try{
  for(const id of ['packagedWeightG',f.wire.id]){
   const peer=id==='packagedWeightG'?f.wire.id:'packagedWeightG',result=f.compare({common:{packagedWeightG:'420',[f.wire.id]:'500'},options:{sku:{[peer]:'550'}}});
   assert.equal(result.previous.rows.find(row=>row.included).fields[id].value,id==='packagedWeightG'?'420':'500');
   assert.equal(result.current.rows.find(row=>row.included).fields[id].value,'550');
   assert.deepEqual(plain(result.marker),{packagedWeightBindingRevision:'exact-g-pair-v1'});assert.equal(result.automaticReads,0);
  }
  for(const overrides of [{common:{packagedWeightG:'420',[f.wire.id]:'500'},options:{}},{common:{packagedWeightG:'420',[f.wire.id]:'500'},options:{sku:{packagedWeightG:'600',[f.wire.id]:'610'}}}]){
   const result=f.compare(overrides);assert.deepEqual(plain(result.marker),{});assert.equal(result.automaticReads,0);
  }
 }finally{f.h.close();}
});

test('unchanged automatic, own manual, equal alias and explicit blank outputs keep their exact legacy hash',async()=>{
 const f=fixture();try{
  const cases=[
   [{common:{},options:{}},null],
   [{common:{packagedWeightG:'420',[f.wire.id]:'420'},options:{}},null],
   [{common:{packagedWeightG:''},options:{}},null],
   [{common:{[f.wire.id]:''},options:{}},null],
   [{common:{packagedWeightG:'',[f.wire.id]:''},options:{}},420],
   [{common:{packagedWeightG:'420'},options:{}},420],
   [{common:{[f.wire.id]:'420'},options:{}},420],
  ];
  for(const [overrides,weight]of cases){
   const result=f.compare(overrides,[f.option('sku',weight)]);assert.deepEqual(plain(result.marker),{});
   const fingerprint=f.h.load('app/automation/model.ts').fingerprint,base={raw:result.source,schema:result.current.schema};
   assert.equal(await fingerprint({...base,...result.marker}),await fingerprint(base));assert.ok(result.automaticReads<=1);
  }
  // Same output intentionally retains identity even when the alias changes its
  // provenance. This helper versions exported values, not review-only messages.
  const equal=f.compare({common:{packagedWeightG:'420'},options:{}},[{...f.option('sku',420),packagingUnitsPerPack:2}]);
  assert.deepEqual(plain(equal.marker),{});assert.equal(equal.previous.rows.find(row=>row.included).fields[f.wire.id].source,'option');
  assert.equal(equal.current.rows.find(row=>row.included).fields[f.wire.id].source,'manual-common');
 }finally{f.h.close();}
});

test('a peer blank changes nonempty automatic output while excluded rows and unrelated overrides never change identity',()=>{
 const f=fixture();try{
  for(const id of ['packagedWeightG',f.wire.id]){
   const result=f.compare({common:{[id]:''},options:{}},[f.option('sku',420)]);
   assert.deepEqual(plain(result.marker),{packagedWeightBindingRevision:'exact-g-pair-v1'});assert.equal(result.automaticReads,1);
  }
  const excluded=f.compare({common:{},options:{sku:{packagedWeightG:'420'}}},[f.option('sku',null,false)]);
  assert.deepEqual(plain(excluded.marker),{});assert.equal(excluded.automaticReads,0);
  const mixed=f.compare({common:{},options:{excluded:{packagedWeightG:'420'}}},[f.option('excluded',null,false),f.option('included')]);
  assert.deepEqual(plain(mixed.marker),{});assert.equal(mixed.automaticReads,0);
  const other=f.compare({common:{supplyPrice:'2000'},options:{}});assert.deepEqual(plain(other.marker),{});assert.equal(other.automaticReads,0);
  const common=f.compare({common:{packagedWeightG:'420'},options:{}},[]);assert.equal(common.current.rows[0].included,true);
  assert.deepEqual(plain(common.marker),{packagedWeightBindingRevision:'exact-g-pair-v1'});assert.equal(common.automaticReads,1);
 }finally{f.h.close();}
});

test('inactive or ambiguous weight pairs never invoke automatic resolution and required comparison failures propagate',()=>{
 const f=fixture();try{
  const overrides={common:{packagedWeightG:'420'},options:{}},resolved=f.q.resolveQuotationFields(f.input(overrides));
  for(const mutate of [
   fields=>fields.splice(fields.findIndex(field=>field.id===f.wire.id),1),
   fields=>fields.find(field=>field.id===f.wire.id).hubWire.path=['logisticsPage','otherWeight'],
   fields=>fields.find(field=>field.id===f.wire.id).unit='kg',
   fields=>fields.find(field=>field.id===f.wire.id).visibility='hidden',
   fields=>fields.find(field=>field.id===f.wire.id).readOnly=true,
   fields=>fields.push({...fields.find(field=>field.id===f.wire.id),id:'duplicate'}),
  ]){
   const changed=plain(resolved);mutate(changed.schema.fields);
   assert.deepEqual(plain(f.helper.quotationPackagedWeightBindingFingerprint(overrides,changed,()=>assert.fail('inactive pair must not resolve automatic values'))),{});
  }
  assert.throws(()=>f.helper.quotationPackagedWeightBindingFingerprint(overrides,resolved,()=>{throw Error('automatic lookup failure');}),/automatic lookup failure/);
  assert.throws(()=>f.helper.quotationPackagedWeightBindingFingerprint(overrides,resolved,()=>({...resolved,rows:[]})),/자동 기준값/);
 }finally{f.h.close();}
});

for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(`actual weight source/edit APIs reject a changed legacy identity while preserving old receipt bytes (${company.code})`,async()=>{
 const f=fixture(company),h=f.h,json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
 try{
  const headers=['title','category',f.wire.id],bytes=quotationWorkbook(headers),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,bytes);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'SYNTHETIC weight identity regression',categoryId:'69900',categoryPath:path,hubSchema:f.hubSchema,
   template:{name:'synthetic-weight.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers},mappings:headers.map((field,column)=>({field,column,required:false}))},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const p=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+p.id,endpoint=base+'/quotation-fields';let view=await json(await h.route(endpoint));
  const save=async changes=>view=await json(await h.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));
  await save([{fieldKey:'packagedWeightG',optionId:null,value:'420'}]);
  const exporter=h.load('app/exports/quotation-source.ts'),model=h.load('app/automation/model.ts'),normalize=h.load('app/settings-fingerprint.ts').savedProductFingerprintSettings,price=h.load('app/product-options.ts').optionPriceCalculationRevision;
  const oldIdentities=async()=>{
   const saved=await exporter.readMappedQuotationSource('owner',p.id,'cat');
   const legacyExport=await model.fingerprint({format:'sourceflow-quotation-fields-v1',saved:{...saved,settings:normalize(saved.settings)},dataStartRow:2,schema:f.q.getQuotationSchema('69900',path,saved.hubSchema),...price(saved.product,saved.options.rows,saved.settings,saved.state.overrides)});
   const inputs={categoryId:'69900',categoryPath:path,product:saved.product,content:saved.content,options:saved.options,settings:normalize(saved.settings),hubSchema:saved.hubSchema};
   const legacyInput=await model.fingerprint({inputs,schema:view.automatic.schema,categoryContext:view.categoryContext,profileRevision:null,settingsPayload:saved.source.settingsPayload,collection:saved.source.collection,...price(saved.product,saved.options.rows,saved.settings)});
   return{saved,legacyExport,legacyInput};
  };
  const before=await oldIdentities(),current=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  assert.notEqual(current.fingerprint,before.legacyExport);assert.notEqual(view.inputFingerprint,before.legacyInput);assert.equal(current.rows.length,6);assert.ok(current.rows.every(row=>row[2]==='420'));
  // This temporary synthetic receipt models a pre-deployment record. It is
  // never a claimed real Hub submission and contains no invented product facts.
  const receipt={schemaVersion:1,evidence:'chrome-observation',profileId:'cat',categoryId:'69900',fingerprint:before.legacyExport,productVersion:p.updated_at,recordedAt:new Date().toISOString(),
   result:{state:'validation-complete',filename:`YOOFAM-${before.legacyExport}.xlsx`,company,includedOptions:6,quotationId:'synthetic-prior-quote-'+company.code,observedAt:Date.now(),registered:false}};
  assert.equal(await h.load('db/supplier-hub-receipts.ts').saveSupplierHubReceipt('owner',p.id,receipt,before.saved.source,before.saved.state.revision),true);
  const oldReceipt=h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload,stateBefore=h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(),productBefore=h.sqlite.prepare('SELECT * FROM products').get();
  await json(await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:before.legacyExport}}),409);
  await json(await h.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:before.legacyInput,changes:[{fieldKey:'brand',optionId:null,value:'must-not-save'}]}}),409);
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(),stateBefore);assert.deepEqual(h.sqlite.prepare('SELECT * FROM products').get(),productBefore);
  assert.equal(h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload,oldReceipt);
  const download=await h.route(base+'/quotation',{method:'POST',body:{action:'download',fingerprint:current.fingerprint}});assert.equal(download.status,200,await download.clone().text());
  const reader=h.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer()));
  for(let row=2;row<=7;row++)assert.equal(reader.xlsxHeaders(sheet,'견적서',row)[2],'420','saved fixture grams reach the actual XLSX');
  for(const value of ['420','']){
   await save([{fieldKey:'packagedWeightG',optionId:null,value},{fieldKey:f.wire.id,optionId:null,value}]);
   const unchanged=await oldIdentities(),source=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'source'}}));
   assert.equal(source.fingerprint,unchanged.legacyExport);assert.equal(view.inputFingerprint,unchanged.legacyInput,'unchanged own values keep the exact former edit identity');
  }
  const preserved=await json(await h.route(base+'/supplier-hub-receipt?fingerprint='+before.legacyExport));assert.equal(preserved.receipt.result.quotationId,receipt.result.quotationId);
  assert.equal(h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload,oldReceipt);
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
  assert.equal(h.network.some(host=>host==='supplier.coupang.com'),false);
 }finally{h.close();}
});
