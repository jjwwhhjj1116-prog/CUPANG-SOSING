import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
const h=mobileIntakeHarness(),quotes=h.load('app/quotation-schema.ts'),compiler=h.load('app/supplier-hub-schema.ts');
test.after(()=>h.close());
const text=(title,extra={})=>({type:'string',title,...extra});
const number=title=>({type:'integer',title,minimum:0});
function snapshot(company=schemaCompanies[0],change=()=>{}){
 const value=hubSchemaSnapshot(company),raw=JSON.parse(value.schemaString);
 raw.required=['startPage','productPage','imagePage','legalPage','logisticsPage'];
 raw.properties.startPage.properties.categoryPath.title='카테고리 경로';
 raw.properties.productPage={type:'object',required:['modelNumber','brand','manufacturer','businessType','importType','searchTags','commonAttributes'],properties:{
  modelNumber:text('모델 번호'),brand:text('브랜드'),manufacturer:text('제조사'),businessType:text('거래 유형',{enum:['제조사','공식총판사']}),taxationSchema:text('과세 여부',{enum:['과세','면세']}),importType:text('수입 유형',{enum:['수입상품','수입대상아님']}),searchTags:text('검색 태그'),
  commonAttributes:{type:'object',required:['purchasePrice','coupangSalePrice','msrp'],properties:{purchasePrice:number('공급가(KRW)'),coupangSalePrice:number('판매가(KRW)'),msrp:number('권장가'),osrp:number('공식판매처가격'),productBarcode:text('바코드')}}
 }};
 raw.properties.imagePage={type:'object',properties:{images:{type:'object',properties:{mainImage:text('대표상품 이미지'),additionalImage:text('추가상품 이미지')}},details:{type:'object',properties:{detailedImage:text('상세상품 이미지'),htmlProductDetailContent:text('상세 HTML'),altText:text('대체 문구')}}}};
 raw.properties.logisticsPage={type:'object',required:['totalSKUsInBox','daysToExpiration','specialHandlingReason','skuUnitBoxWeight','skuUnitBoxDimension'],properties:{totalSKUsInBox:number('박스당 입수량'),daysToExpiration:number('유통기한(일)'),specialHandlingReason:text('특별 취급 사유',{enum:['해당사항없음','유리']}),skuUnitBoxWeight:number('상품 박스 무게(g)'),skuUnitBoxDimension:text('상품 박스 크기(mm)')}};
 change(raw);
 return {...value,draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1',schemaString:JSON.stringify(raw)};
}
const schemaFor=snap=>quotes.getQuotationSchema(snap.categoryId,schemaPath,snap);
const at=(schema,path)=>schema.fields.find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(path.split('.')));

test('public Couplus wire paths bind stage inputs even when the captured display labels differ',()=>{
 for(const company of schemaCompanies){const schema=schemaFor(snapshot(company));assert.equal(schema.status,'observed');
  for(const [path,id] of [['startPage.categoryPath','category'],['productPage.modelNumber','model'],['productPage.businessType','tradeType'],['productPage.importType','importType'],['productPage.commonAttributes.purchasePrice','supplyPrice'],['productPage.commonAttributes.coupangSalePrice','salePrice'],['imagePage.images.mainImage','mainImage'],['imagePage.details.htmlProductDetailContent','detailHtml'],['logisticsPage.totalSKUsInBox','boxSkuQuantity'],['logisticsPage.skuUnitBoxWeight','packagedWeightG']]){
   assert.equal(at(schema,path).id,id,path);assert.equal(at(schema,path).hubInput,id,path);
  }
  assert.equal(at(schema,'startPage.categoryPath').readOnly,true);assert.equal(at(schema,'imagePage.images.mainImage').type,'images');
 }
});
test('the complete wire path prevents same labels and dotted property names from claiming another input',()=>{
 const schema=schemaFor(snapshot(schemaCompanies[0],raw=>{
  raw.properties.productPage.properties.other={type:'object',properties:{brand:text('브랜드')}};
  raw.properties.productPage.properties['commonAttributes.purchasePrice']=number('공급가');
 }));
 assert.equal(schema.status,'observed');
 for(const path of [['productPage','other','brand'],['productPage','commonAttributes.purchasePrice']]){
  const field=schema.fields.find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(path));assert.match(field.id,/^live_991234_/);assert.equal(field.hubInput,undefined);
 }
});
test('MSRP and OSRP share the stage price source while retaining separate final editable fields independent of property order',()=>{
 for(const reverse of [false,true]){const schema=schemaFor(snapshot(schemaCompanies[0],raw=>{
  const fields=raw.properties.productPage.properties.commonAttributes.properties;
  fields.msrp.title=fields.osrp.title='권장가';if(reverse)raw.properties.productPage.properties.commonAttributes.properties={osrp:fields.osrp,...fields};
 }));
  assert.equal(schema.status,'observed');const msrp=at(schema,'productPage.commonAttributes.msrp'),osrp=at(schema,'productPage.commonAttributes.osrp');
  assert.equal(msrp.id,'msrp');assert.match(osrp.id,/^live_991234_/);assert.notEqual(msrp.id,osrp.id);assert.equal(osrp.hubInput,'msrp');
 }
});

test('path binding is frozen and versioned without changing older label-based category captures',()=>{
 const current=snapshot();assert.equal(compiler.validateHubSchemaSnapshot(current,current.categoryId,schemaPath).inputBindings,'couplus-paths-v1');
 const {inputBindings,...legacy}=current;assert.equal(inputBindings,'couplus-paths-v1');
 assert.match(at(schemaFor(legacy),'productPage.modelNumber').id,/^live_991234_/);
 assert.equal(at(schemaFor(legacy),'productPage.modelNumber').hubInput,undefined);
 assert.throws(()=>compiler.validateHubSchemaSnapshot({...current,inputBindings:'unknown'},current.categoryId,schemaPath),/입력 연결 버전/);
});
test('incompatible wire types remain unconfirmed instead of receiving unrelated price or image inputs',()=>{
 for(const change of [raw=>{raw.properties.productPage.properties.commonAttributes.properties.purchasePrice.type='boolean';},raw=>{raw.properties.imagePage.properties.images.properties.mainImage.type='number';}]){
  const schema=schemaFor(snapshot(schemaCompanies[0],change));assert.equal(schema.status,'unconfirmed');
  const field=at(schema,schema.unsupportedFields[0].split(' / ').join('.'));assert.equal(field.hubInput,undefined);
 }
});
test('an OSRP-only schema retains the shared stage price source without a duplicate editable price',()=>{
 const schema=schemaFor(snapshot(schemaCompanies[0],raw=>{
  const group=raw.properties.productPage.properties.commonAttributes;delete group.properties.msrp;group.required=group.required.filter(key=>key!=='msrp');
 }));
 assert.equal(schema.status,'observed');assert.equal(at(schema,'productPage.commonAttributes.osrp').id,'msrp');
 assert.equal(schema.fields.filter(field=>field.id==='msrp').length,1);
});
test('input links describe the captured source even for a separate OSRP field',()=>{
 const schema=schemaFor(snapshot()),links=h.load('app/quotation-input-links.ts');
 assert.match(links.quotationInputLink(at(schema,'productPage.commonAttributes.osrp')),/2단계/);
 assert.match(links.quotationInputLink(at(schema,'productPage.modelNumber')),/6단계/);
});
test('stage-five HTML keeps its editor capacity and respects an explicit captured limit',()=>{
 const field=at(schemaFor(snapshot()),'imagePage.details.htmlProductDetailContent');
 assert.equal(field.maxLength,150000);assert.equal(quotes.quotationValueIssues(field,'긴 설명'.repeat(1000)).length,0);
 const limited=at(schemaFor(snapshot(schemaCompanies[0],raw=>{raw.properties.imagePage.properties.details.properties.htmlProductDetailContent.maxLength=100;})),'imagePage.details.htmlProductDetailContent');
 assert.equal(limited.maxLength,100);assert.ok(quotes.quotationValueIssues(limited,'긴 설명'.repeat(1000)).length);
});

async function setup(local,snap){
 const input={name:'시험 최종분류',categoryId:snap.categoryId,categoryPath:schemaPath,template:null,mappings:[],hubSchema:snap};
 const api=local.load('app/api/category-profiles/route.ts');
 const response=await api.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(input)}));
 assert.equal(response.status,201,await response.clone().text());const {profile}=await response.json();
 local.context.category=profile;local.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(local.context),'job');
 assert.match(await local.intake(),/상품 초안 저장됨/);
 const product=local.sqlite.prepare('SELECT * FROM products').get();
 return {profile,input,api,product,base:'/api/products/'+product.id};
}
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
for(const company of schemaCompanies)test(`stage content and final wire cells reach the same reviewed CSV for ${company.code}`,async()=>{
 const local=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const f=await setup(local,snapshot(company)),read=()=>local.route(f.base+'/quotation-fields').then(json);
  const images=local.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
  const {content}=await json(await local.route(f.base+'/content'));
  const description='5단계에서 수정한 긴 상세 설명 '.repeat(200).trim();
  await json(await local.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'1단계 수정 상품명',keywords:['검토 검색어']},detail:{description},label:{model:'6-STAGE-MODEL',manufacturer:'6단계 수정 제조사'},assets:{main:[images[0]],additional:[images[1],images[2]],detail:[images[3]]}}}}));
  const options=await json(await local.route(f.base+'/options')),rows=local.load('app/product-options.ts').optionInputs(options.options);
  rows[0].packagedWeightG=420;rows[0].packagedWidthMm=100;rows[0].packagedLengthMm=200;rows[0].packagedHeightMm=300;rows[0].imageKey=images[4];
  await json(await local.route(f.base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
  let view=await read();const schema=view.resolved.schema,option=view.resolved.rows.find(row=>row.optionId!==null),osrp=at(schema,'productPage.commonAttributes.osrp');
  assert.equal(view.resolved.rows.filter(row=>row.optionId!==null).length,6);
  assert.equal(option.fields.model.value,'6-STAGE-MODEL');assert.equal(option.fields.manufacturer.value,'6단계 수정 제조사');
  assert.equal(option.fields.title.value,'1단계 수정 상품명');assert.equal(option.fields.searchTags.value,'검토 검색어');
  assert.equal(option.fields.tradeType.value,local.settings.tradeType);assert.equal(option.fields.boxSkuQuantity.value,String(local.settings.boxSkuQuantity));
  assert.equal(option.fields.packagedWeightG.value,'420');assert.equal(option.fields.packagedDimensionsMm.value,'100*200*300');
  assert.equal(option.fields.mainImage.value,images[4]);assert.equal(option.fields.additionalImages.value,images.slice(1,3).join('\n'));assert.equal(option.fields.detailImages.value,images[3]);
  assert.equal(option.fields.detailHtml.value,'<p>'+description+'</p>');assert.equal(option.fields.detailHtml.validationIssues.length,0);
  assert.ok(Number(option.fields.supplyPrice.value)>0);assert.equal(option.fields.supplyPrice.source,'pricing');
  assert.equal(option.fields[osrp.id].value,option.fields.msrp.value);assert.equal(option.fields[osrp.id].source,'pricing');
  view=await json(await local.route(f.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   {fieldKey:'supplyPrice',optionId:option.optionId,value:'17920'},{fieldKey:'salePrice',optionId:option.optionId,value:'29870'},
   {fieldKey:'msrp',optionId:option.optionId,value:'38830'},{fieldKey:osrp.id,optionId:option.optionId,value:''},
   {fieldKey:'model',optionId:option.optionId,value:''},{fieldKey:'additionalImages',optionId:option.optionId,value:''},
  ]}}));
  const final=view.resolved.rows.find(row=>row.optionId===option.optionId);assert.equal(final.fields[osrp.id].source,'manual-option');assert.equal(final.fields.model.value,'');
  const source=await local.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',f.product.id,f.profile.id);
  const resolved=local.load('app/exports/quotation-source.ts').resolveQuotationExport(source);
  const assets=images.map((key,index)=>({key,name:'images/'+index+'.png',bytes:new Uint8Array([1]),contentType:'image/png'}));
  const output=local.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source,resolved,assets);
  const keys=['title','model','supplyPrice','salePrice','msrp',osrp.id,'mainImage','additionalImages','detailImages','packagedWeightG','packagedDimensionsMm','detailHtml'];
  const expected=['1단계 수정 상품명','',17920,29870,38830,'','4.png','','3.png',420,'100*200*300','<p>'+description+'</p>'];
  assert.deepEqual(JSON.parse(JSON.stringify(keys.map(key=>output[0][key]))),expected);
  const bytes=new TextEncoder().encode(keys.join(',')+'\n').buffer,sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const profile={...f.profile,template:{name:'synthetic-stage-inputs.csv',format:'csv',sheetName:'',headerRow:1,headers:keys,sha256},mappings:keys.map((field,column)=>({field,column,required:false}))};
  const mapped=await local.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:bytes,profile,rows:output,dataStartRow:2});
  assert.deepEqual(JSON.parse(JSON.stringify(mapped.values[0])),expected);
  assert.equal(source.hubSchema.inputBindings,'couplus-paths-v1');assert.ok(!local.network.includes('supplier.coupang.com'));
 }finally{local.close();}
});
test('refreshing the category profile does not introduce path bindings into an older collected work product',async()=>{
 const local=mobileIntakeHarness();try{
  const current=snapshot(),{inputBindings,...legacy}=current,f=await setup(local,legacy);
  const path=f.base+'/quotation-fields',before=await json(await local.route(path));
  const update=await f.api.PUT(new Request('https://app.test/api/category-profiles',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({id:f.profile.id,expectedRevision:f.profile.revision,profile:{...f.input,hubSchema:{...legacy,inputBindings}}})}));
  assert.equal(update.status,200,await update.clone().text());const after=await json(await local.route(path));
  assert.deepEqual(after.resolved.rows,before.resolved.rows);assert.deepEqual(after.resolved.schema,before.resolved.schema);assert.equal(after.inputFingerprint,before.inputFingerprint);
 }finally{local.close();}
});

test('a version refresh with an incompatible manually connected legacy field preserves the profile and working product for review',async()=>{
 const local=mobileIntakeHarness();try{
  const current=snapshot(),{inputBindings,...legacy}=current,f=await setup(local,legacy),path=f.base+'/quotation-fields';
  let view=await json(await local.route(path));
  const oldField=at(view.resolved.schema,'productPage.modelNumber');assert.match(oldField.id,/^live_/);assert.equal(at(schemaFor(current),'productPage.modelNumber').id,'model');
  view=await json(await local.route(path,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:oldField.id,optionId:null,value:'기존 수동 모델'}]}}));
  const bytes=new TextEncoder().encode('모델 번호\n'),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),storageKey=`owner/category-templates/${sha256}.csv`;
  await local.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:'csv'}});
  const input={...f.input,template:{name:'legacy.csv',format:'csv',sheetName:'',headerRow:1,headers:['모델 번호'],sha256,storageKey},mappings:[{column:0,field:oldField.id,required:false}]};
  const request=(revision,profile)=>new Request('https://app.test/api/category-profiles',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({id:f.profile.id,expectedRevision:revision,profile})});
  const {profile}=await json(await f.api.PUT(request(f.profile.revision,input)));
  const before={profile:local.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(profile.id),product:local.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.product.id),quotation:local.sqlite.prepare('SELECT * FROM product_quotation_fields WHERE product_id=?').get(f.product.id)};
  const response=await f.api.PUT(request(profile.revision,{...input,hubSchema:{...legacy,inputBindings}}));
  assert.equal(response.status,400);assert.match((await response.json()).error,/현재 카테고리의 견적 항목에 없습니다/);
  assert.deepEqual(local.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(profile.id),before.profile);
  assert.deepEqual(local.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.product.id),before.product);
  assert.deepEqual(local.sqlite.prepare('SELECT * FROM product_quotation_fields WHERE product_id=?').get(f.product.id),before.quotation);
  const after=await json(await local.route(path));assert.deepEqual(after.resolved,view.resolved);assert.equal(after.resolved.rows[0].fields[oldField.id].value,'기존 수동 모델');assert.ok(!local.network.includes('supplier.coupang.com'));
 }finally{local.close();}
});
