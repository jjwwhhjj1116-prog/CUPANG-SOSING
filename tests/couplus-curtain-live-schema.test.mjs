import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {schemaCompanies} from './helpers/hub-schema.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {readPackageZip} from '../extensions/supplier-hub/package.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const path=['합성 대분류','압축봉'];
const hidden=[
 ['수량'],['구성품'],['최장 길이'],
 ['색상계열',['블랙계열','네이비계열','그레이계열','실버계열','레드계열','오렌지계열','옐로우계열','그린계열','블루계열','바이올렛/보라계열','핑크계열','화이트계열','브라운계열','골드계열','베이지계열','멀티(혼합)컬러','투명계열','아이보리 계열']],
 ['외경지름'],['커튼레일형태',['일자형','라운드형']],['커튼 설치방식',['일반설치','압축봉설치','창틀설치(무타공)']],
 ['커튼 구성',['커튼봉','커튼봉+브라켓','브라켓']],['커튼봉 소재',['플라스틱','스테인리스','알루미늄','기타','스틸']],
 ['Global Trade Item Number'],['Parent Manufacturer Part Number'],['Manufacturer Part Number'],
];
const notices=['품명 및 모델명','인증/허가 사항','제조국(원산지)','제조자(수입자)','소비자상담 관련 전화번호'];
// Labels/visible choices, the blank 50-character model and five notices were
// observed in outputs/step617-couplus-quote.txt:410-535,570-581 (category 78260).
// This is a synthetic schema transcription, not an authenticated Hub schema.
// Its full category path is synthetic and no observed seller facts, prices,
// packaging 100g/100*100*100 or certification decisions become defaults.
// Exact key evidence: cached public outputs/step546-public-methods.json,
// extractSchemaInfoForQuotation accesses attributeName/attributeValue and
// noticeItemName/noticeItemValue; createCompleteArrayStructure creates those
// named records and initializes hidden values to null, other arrays to N/A.
const named=(label,value,legal=false,reversed=false)=>{
 const nameKey=legal?'noticeItemName':'attributeName',valueKey=legal?'noticeItemValue':'attributeValue';
 const name={type:'string',enum:[label],requirement:legal?'필수':'선택'};
 return {contains:{type:'object',required:[nameKey,valueKey],properties:reversed?{[valueKey]:value,[nameKey]:name}:{[nameKey]:name,[valueKey]:value}}};
};
function snapshot(company,{singleton=false,reversed=false}={}){
 const raw={type:'object',required:['startPage','productPage','legalPage','logisticsPage'],properties:{
  startPage:{type:'object',required:['productName','categoryPath'],properties:{productName:{type:'string',title:'상품명'},categoryPath:{type:'string',title:'카테고리'}}},
  productPage:{type:'object',required:['modelNumber','commonAttributes','unexposedAttributes'],properties:{
   modelNumber:{type:'string',title:'모델명',maxLength:50},
   commonAttributes:{type:'object',required:['purchasePrice','coupangSalePrice','exposedAttributes'],properties:{
    purchasePrice:{type:'integer',title:'공급가',minimum:1},coupangSalePrice:{type:'integer',title:'판매가',minimum:1},
    exposedAttributes:{type:'array',allOf:[named('색상',singleton?{type:'string',enum:['합성 허용값']}:{type:'string'},false,reversed),named('사이즈',{type:'string'},false,reversed)]},
   }},
   unexposedAttributes:{type:'array',allOf:hidden.map(([label,values])=>named(label,{type:['string','null'],...(values?{enum:[null,...values],dropdown:values}:{})},false,reversed))},
  }},
  legalPage:{type:'object',required:['notices'],properties:{notices:{type:'array',allOf:notices.map(label=>named(label,{type:'string',...(singleton&&label==='인증/허가 사항'?{enum:['해당사항없음']}:{})},true,reversed))}}},
  logisticsPage:{type:'object',required:['skuUnitBoxWeight','skuUnitBoxDimension'],properties:{skuUnitBoxWeight:{type:'string',title:'한 개 단품 포장 무게',minLength:1},skuUnitBoxDimension:{type:'string',title:'한 개 단품 포장 사이즈',minLength:1}}},
 }};
 return {format:'supplier-hub-schema-v1',categoryId:'78260',categoryPath:path,company,observedAt:Date.now(),schemaString:JSON.stringify(raw),metadata:{displayCategoryCode:'78260'},draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1'};
}
const local=mobileIntakeHarness(),compiler=local.load('app/supplier-hub-schema.ts'),quotes=local.load('app/quotation-schema.ts');
test.after(()=>local.close());
const field=(schema,label)=>schema.fields.find(item=>item.hubWire?.name===label);

test('recorded 78260 shape uses the general live path with exact choices, five notices and no inferred product defaults',()=>{
 for(const company of schemaCompanies){
  const snap=snapshot(company),schema=quotes.getQuotationSchema('78260',path,snap);
  assert.equal(schema.status,'observed');assert.equal(quotes.getQuotationSchema('78260',path).status,'unconfirmed','there is no new builtin');
  assert.equal(schema.fields.filter(item=>item.visibility==='exposed').length,2);assert.equal(schema.fields.filter(item=>item.visibility==='hidden').length,12);
  assert.deepEqual(schema.fields.filter(item=>item.hubWire?.path.at(-1)==='notices').map(item=>item.label),notices);
  for(const [label,values] of hidden){const item=field(schema,label);assert.equal(item.draftDefault,'');if(values)assert.deepEqual(plain(item.choices),[{value:'',label:'해당사항없음'},...values.map(value=>({value,label:value}))]);}
  for(const label of notices)assert.equal(field(schema,label).draftDefault,'해당사항없음');
  const input={categoryId:'78260',categoryPath:path,hubSchema:snap,product:{id:'p',title:'검토 상품',image_keys:'[]',supply_price:123,sale_price:246,pricing_policy:JSON.stringify(local.settings)},settings:local.settings,content:local.load('app/product-content.ts').emptyProductContent('p'),options:local.load('app/product-options.ts').emptyProductOptions('p')};
  const before=JSON.stringify(input),row=quotes.resolveQuotationFields(input).rows[0];assert.equal(row.fields.model.value,'');assert.equal(row.fields.model.source,'couplus-default');assert.equal(row.fields.model.validationIssues.length>0,true);
  for(const item of schema.fields.filter(item=>['packagedWeightG','packagedDimensionsMm'].includes(item.hubInput)))assert.equal(row.fields[item.id].value,'');
  assert.equal(row.fields.supplyPrice.value,'123');assert.equal(row.fields.salePrice.value,'246');assert.equal(JSON.stringify(input),before);
 }
});

test('documented attribute and notice keys preserve singleton choices and stable field IDs in either JSON order',()=>{
 const before=compiler.compileHubQuotationSchema(snapshot(schemaCompanies[0],{singleton:true}));
 const after=compiler.compileHubQuotationSchema(snapshot(schemaCompanies[0],{singleton:true,reversed:true}));
 assert.deepEqual(plain(after),plain(before));assert.deepEqual(plain(after.unsupported),[]);
 for(const [label,nameKey,valueKey,value] of [['색상','attributeName','attributeValue','합성 허용값'],['인증/허가 사항','noticeItemName','noticeItemValue','해당사항없음']]){
  const item=field(after,label);assert.ok(item,label);assert.equal(item.hubWire.nameKey,nameKey);assert.equal(item.hubWire.valueKey,valueKey);assert.deepEqual(plain(item.choices),[{value,label:value}]);
  assert.equal(quotes.quotationValueIssues(item,value).length,0);assert.ok(quotes.quotationValueIssues(item,'허용되지 않은 값').length);
 }
});

test('unknown singleton pairs and malformed documented names stay unsupported instead of choosing property order',()=>{
 for(const properties of [{customName:{type:'string',enum:['속성']},customValue:{type:'string',enum:['값']}},{customValue:{type:'string',enum:['값']},customName:{type:'string',enum:['속성']}},{attributeName:{type:'string',enum:['이름1','이름2']},attributeValue:{type:'string',enum:['값']}}]){
  const snap=snapshot(schemaCompanies[0]),raw=JSON.parse(snap.schemaString);raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf=[{contains:{type:'object',properties}}];snap.schemaString=JSON.stringify(raw);
  const result=compiler.compileHubQuotationSchema(snap);assert.ok(result.unsupported.includes('productPage / commonAttributes / exposedAttributes'));assert.ok(!result.fields.some(item=>item.hubWire.path.at(-1)==='exposedAttributes'));
 }
});

for(const company of schemaCompanies)test(`documented singleton fields survive profile/intake/manual blanks and actual XLSX/ZIP output (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const snap=snapshot(company,{singleton:true,reversed:true}),schema=quotes.getQuotationSchema('78260',path,snap),color=field(schema,'색상'),permission=field(schema,'인증/허가 사항'),installation=field(schema,'커튼 설치방식');
  assert.ok(color&&permission,'both documented singleton fields must exist before creating the profile');
  const selected=[color,permission,installation,schema.fields.find(item=>item.id==='model')],headers=selected.map(item=>item.label),bytes=quotationWorkbook(headers),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),storageKey=`owner/category-templates/${sha256}.xlsx`;
  await h.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:'xlsx'},httpMetadata:{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
  const input={name:'78260 배열 구조 합성 검수',categoryId:'78260',categoryPath:path,hubSchema:snap,template:{name:'synthetic.xlsx',format:'xlsx',sheetName:'견적서',headerRow:1,headers,sha256,storageKey},mappings:selected.map((item,column)=>({column,field:item.id,required:false}))};
  const post=await h.load('app/api/category-profiles/route.ts').POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(input)}));assert.equal(post.status,201,await post.clone().text());const {profile}=await post.json();assert.equal(profile.hubSchema.schemaString,snap.schemaString);
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,frozen=h.sqlite.prepare('SELECT payload FROM collection_context').get().payload;
  const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};let view=await json(await h.route(base+'/quotation-fields'));
  assert.equal(view.resolved.schema.status,'observed');assert.equal(view.resolved.schema.fields.filter(item=>item.hubWire?.path.at(-1)==='notices').length,5);
  const option=view.resolved.rows.find(row=>row.included),changes=[{fieldKey:color.id,optionId:null,value:'합성 허용값'},{fieldKey:permission.id,optionId:option.optionId,value:''},{fieldKey:installation.id,optionId:null,value:'창틀설치(무타공)'},{fieldKey:'model',optionId:option.optionId,value:''}];
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));view=await json(await h.route(base+'/quotation-fields'));
  const manual=view.resolved.rows.find(row=>row.optionId===option.optionId);assert.equal(manual.fields[permission.id].value,'');assert.equal(manual.fields[permission.id].source,'manual-option');assert.ok(manual.fields[permission.id].validationIssues.length);assert.equal(manual.fields.model.source,'manual-option');
  const retained=()=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','collection_context','category_profiles'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all())),before=retained();
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));assert.equal(preview.report.submissionReady,false);assert.ok(!preview.submissionReview.issues.some(issue=>issue.code==='SCHEMA_UNCONFIRMED'));assert.ok(preview.submissionReview.errorCount>0,'saved required blanks remain errors');assert.deepEqual(preview.rows[0],['합성 허용값','','창틀설치(무타공)','']);assert.deepEqual(preview.rows[1],['합성 허용값','해당사항없음','창틀설치(무타공)','']);
  const response=await h.route(base+'/quotation',{method:'POST',body:{action:'export',profileId:profile.id,fingerprint:preview.fingerprint}});assert.equal(response.status,200,await response.clone().text());const archive=readPackageZip(new Uint8Array(await response.arrayBuffer())),document=JSON.parse(new TextDecoder().decode(archive.get('quotation-fields.json')));
  assert.equal(document.schema.fields.find(item=>item.id===color.id).hubWire.nameKey,'attributeName');assert.equal(document.schema.fields.find(item=>item.id===permission.id).hubWire.valueKey,'noticeItemValue');assert.equal(document.rows[0].fields[permission.id].source,'manual-option');assert.equal(document.rows[1].fields[permission.id].value,'해당사항없음');
  const reader=h.load('app/xlsx-template.ts'),output=reader.inspectXlsxArchive(await reader.readXlsxArchive(archive.get(preview.filename).slice().buffer));assert.deepEqual(plain(reader.xlsxHeaders(output,'견적서',2)),preview.rows[0]);assert.deepEqual(plain(reader.xlsxHeaders(output,'견적서',3)),preview.rows[1]);
  assert.equal(retained(),before);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,frozen);assert.deepEqual(Buffer.from(h.objects.get(storageKey)),Buffer.from(bytes));assert.equal(product.supplier_hub_status,'미전송');assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});
