import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const bundle={bundleEnabled:true,bundleCriterion:'supplyMargin',bundleMinimumSupplyMargin:3000,bundleMinimumCoupangMargin:3000};
const savedOptions=h=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}]){
 test(`enabled captured bundle criteria reach recorded SKU quotation prices without altering unit facts (${company.companyCode})`,async()=>{
  const h=mobileIntakeHarness(company);try{
   Object.assign(h.context.settings,bundle);
   h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));
   await h.intake();
   const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
   const receipt=JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload);
   const options=savedOptions(h),price=h.load('app/pricing.ts'),policy=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_price_policy').get().payload);
   assert.equal(options.rows.length,6);
   assert.deepEqual(options.rows.map(row=>row.unitsPerPack),[3,3,3,3,3,3]);
   for(const [index,row] of options.rows.entries()){
    assert.equal(row.supplierSku,receipt.options[index].sku);assert.equal(row.unitCostCny,receipt.options[index].unitPriceCny);
    assert.equal(row.minimumOrderQuantity,receipt.options[index].minimumOrder);assert.equal(row.stock,receipt.options[index].stock);
    assert.equal(row.packagedWeightG,null);assert.equal(row.packagedWidthMm,null);
   }
   assert.equal(product.source_price_cny,3.6);
   assert.equal(product.supply_price,price.calculatePrice(3.6,policy).supplyPrice,'representative unit price keeps the existing formula');
   const quote=await json(await h.route(base+'/quotation-fields'));
   for(const row of quote.resolved.rows.filter(row=>row.optionId)){
    const source=options.rows.find(option=>option.id===row.optionId),calculation=price.calculatePrice(source.unitCostCny,policy,3);
    assert.equal(row.fields.quantity.value,'3');assert.equal(row.fields.supplyPrice.value,String(calculation.supplyPrice));assert.equal(row.fields.salePrice.value,String(calculation.salePrice));
   }
   const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{...h.context.category,name:'번들 견적 회귀'},'cat');
   const sourceModule=h.load('app/exports/quotation-source.ts'),source=await sourceModule.readQuotationExportSource('owner',product.id,profile.id);
   assert.equal(source.company.code,company.companyCode);
   const resolved=sourceModule.resolveQuotationExport(source),rows=h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source,resolved,[]);
   const fields=['skuId','quantity','supplyPrice','salePrice'],workbook=quotationWorkbook(fields);
   const sha256=Buffer.from(await crypto.subtle.digest('SHA-256',workbook)).toString('hex');
   const output=await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:workbook,profile:{...profile,template:{name:'bundle.xlsx',format:'xlsx',sheetName:'견적서',headerRow:1,headers:fields,sha256},mappings:fields.map((field,column)=>({field,column,required:false}))},rows,dataStartRow:2});
   const reader=h.load('app/xlsx-template.ts'),sheets=reader.inspectXlsxArchive(await reader.readXlsxArchive(output.bytes));
   for(const [index,option] of options.rows.entries()){
    const calculation=price.calculatePrice(option.unitCostCny,policy,3);
    assert.deepEqual(Array.from(reader.xlsxHeaders(sheets,'견적서',index+2)),[option.supplierSku,'3',String(calculation.supplyPrice),String(calculation.salePrice)]);
   }
   // Existing WIP is only changed by its explicit option save, never by another
   // collection retry or workspace setting change.
   const current=await json(await h.route(base+'/options')),manual=h.load('app/product-options.ts').optionInputs(current.options);
   manual[0].unitsPerPack=2;manual[0].translatedName='';manual[0].size='';
   await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:current.options.revision,expectedProductVersion:current.productVersion,rows:manual}}));
   const quoteEdit=await json(await h.route(base+'/quotation-fields'));
   await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:quoteEdit.revision,expectedInputFingerprint:quoteEdit.inputFingerprint,changes:[{fieldKey:'quantity',optionId:manual[0].id,value:''},{fieldKey:'supplyPrice',optionId:manual[0].id,value:''}]}}));
   const latest=await json(await h.route(base+'/options')),inputs=h.load('app/product-options.ts').optionInputs(latest.options),tools=h.load('app/option-editor-tools.ts');
   const preview=tools.previewOptionBulk(inputs,[manual[0].id],{type:'autoBundle',value:{...bundle,bundleMinimumSupplyMargin:4000}},latest.pricing.policy);
   assert.equal(preview.rows[0].unitsPerPack,5);
   const rowsToSave=tools.applyOptionBulk(inputs,preview,latest.pricing.policy);
   await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:latest.options.revision,expectedProductVersion:latest.productVersion,rows:rowsToSave}}));
   const manualQuote=(await json(await h.route(base+'/quotation-fields'))).resolved.rows.find(row=>row.optionId===manual[0].id);
   assert.equal(manualQuote.fields.quantity.value,'');assert.equal(manualQuote.fields.supplyPrice.value,'');
   assert.equal(savedOptions(h).rows[0].translatedName,'');assert.equal(savedOptions(h).rows[0].size,'');
   const before=JSON.stringify(savedOptions(h));
   await h.load('db/queries.ts').saveSettings('owner',JSON.stringify({...h.settings,...bundle,bundleMinimumSupplyMargin:9000}));
   await json(await h.route('/api/collection-jobs/job/product',{method:'POST'}));
   assert.equal(JSON.stringify(savedOptions(h)),before);
   assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
  }finally{h.close();}
 });
}
