import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';
// Only the public field types/paths needed from the 2026-10-05 live 69900
// capture. No private profile, owner, source descriptions or credentials.
const path=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
const priceKeys=['purchasePrice','coupangSalePrice','msrp','osrp'],inputs=['supplyPrice','salePrice','msrp','msrp'];
const shape={type:'object',properties:{startPage:{type:'object',required:['productName','categoryPath'],properties:{productName:{type:'string',title:'상품명'},categoryPath:{type:'string',title:'카테고리'}}},productPage:{type:'object',properties:{commonAttributes:{type:'object',required:['purchasePrice','coupangSalePrice','msrp'],properties:{
 purchasePrice:{type:'string',title:'공급가'},coupangSalePrice:{type:'string',title:'쿠팡 판매가'},msrp:{type:['string','null'],title:'권장소비자가격'},osrp:{type:['string','null'],title:'공식 판매처 가격'},
 exposedAttributes:{type:'array',items:{},allOf:[{contains:{type:'object',properties:{name:{type:'string',enum:['색상']},value:{type:['string','null'],enum:[null,'검정']}}}}]},
}}}},legalPage:{type:'object',properties:{}}}};
const snapshot=(company,patch=()=>{})=>{const raw=structuredClone(shape);patch(raw);return{format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath:path,company,observedAt:Date.now(),schemaString:JSON.stringify(raw),metadata:{kanCategoryId:2624,noticeNumber:4,scopeType:'Retail_Categorized_Single',version:188},inputBindings:'couplus-paths-v1'};};
const priceFields=schema=>priceKeys.map(key=>schema.fields.find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(['productPage','commonAttributes',key])));
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
function officialWorkbook(){
 const headers=['상품명','카테고리','공급가','쿠팡 판매가','권장소비자가격','공식 판매처 가격',...Array.from({length:19},(_,i)=>'추가 항목 '+i)],category=path.join('>')+' (69900)';
 const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;'),column=i=>String.fromCharCode(65+i),row=(r,values)=>`<row r="${r}">${values.map((value,i)=>`<c r="${column(i)}${r}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`;
 const bytes=workbookArchive([['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],['xl/workbook.xml','<workbook xmlns:r="relationship"><sheets><sheet name="QF_2624_test" r:id="one"/></sheets></workbook>'],['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],['xl/worksheets/sheet1.xml',`<worksheet><sheetData>${row(1,['','Retail_Categorized_Excel:Kan:2624:Notice4:Version190'])}${row(5,headers)}${row(6,headers.map((_,i)=>i<5?'필수':'선택'))}${row(7,headers.map(()=> '작성 안내'))}${row(8,headers.map((_,i)=>i===1?category:'예시'))}${row(9,headers.map(()=>''))}</sheetData><dataValidations count="1"><dataValidation type="list" allowBlank="true" sqref="B9:B1008"><formula1>"${category}"</formula1></dataValidation></dataValidations></worksheet>`]]);
 return {bytes,headers};
}
for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(`live 69900 string prices use stage-two calculations and preserve manual wire IDs through XLSX (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const snap=snapshot(company),quotes=h.load('app/quotation-schema.ts'),schema=quotes.getQuotationSchema(snap.categoryId,path,snap),fields=priceFields(schema);
  assert.deepEqual(fields.map(field=>field.hubInput),inputs);
  // The old rejected-path compiler used stable wire IDs, which manual edits reference.
  assert.deepEqual(fields.map(field=>field.id),['live_69900_6a20ed8e27dd58e4','live_69900_579761a752ad27ed','live_69900_6e653b6087dbacf6','live_69900_435a1796977ab36c']);
  for(const field of fields){assert.equal(field.type,'text');assert.equal(field.numericText,true);assert.equal(field.integer,true);assert.equal(field.min,1);assert.equal(field.max,Number.MAX_SAFE_INTEGER);}
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'관찰 가격 형식',categoryId:'69900',categoryPath:path,hubSchema:snap,template:null,mappings:[]},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),url='/api/products/'+product.id+'/quotation-fields',view=await json(await h.route(url));
  const optionRows=view.resolved.rows.filter(row=>row.optionId);assert.equal(optionRows.length,6);
  for(const row of optionRows)for(const [i,field]of fields.entries()){assert.equal(row.fields[field.id].value,row.fields[inputs[i]].value);assert.equal(row.fields[field.id].source,'pricing');}
  for(const value of ['abc','0','-1','1.5','9007199254740992']){const result=await h.route(url,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:fields[0].id,optionId:optionRows[0].optionId,value}]}});assert.equal(result.status,400,value);}
  const saved=await json(await h.route(url,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:fields[0].id,optionId:optionRows[0].optionId,value:'12345'},{fieldKey:fields[1].id,optionId:optionRows[0].optionId,value:''},{fieldKey:fields[3].id,optionId:null,value:''}]}}));
  assert.equal(saved.resolved.rows.find(row=>row.optionId===optionRows[0].optionId).fields[fields[1].id].source,'manual-option');
  const before=h.sqlite.prepare('SELECT payload FROM product_options').get().payload,source=await h.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',product.id,profile.id),resolved=h.load('app/exports/quotation-source.ts').resolveQuotationExport(source),rows=h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source,resolved,[]);
  assert.equal(rows[0][fields[0].id],'12345');assert.equal(rows[0][fields[1].id],'');assert.equal(rows[1][fields[3].id],'');assert.equal(typeof rows[1][fields[0].id],'string');
  const {bytes:originalBytes}=officialWorkbook(),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',originalBytes)).toString('hex'),excel={...snap,metadata:{...snap.metadata,scopeType:'Retail_Categorized_Excel',version:190}},connected=await h.load('app/official-hub-template.ts').connectOfficialHubTemplate(originalBytes.buffer,snap,excel);
  const output=await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes,profile:{...profile,...connected,template:{...connected.template,name:'price.xlsx',sha256}},rows,dataStartRow:9});
  const reader=h.load('app/xlsx-template.ts'),files=await reader.readXlsxArchive(output.bytes),sheet=reader.inspectXlsxArchive(files);assert.equal(reader.xlsxHeaders(sheet,'QF_2624_test',9)[2],'12345');assert.equal(reader.xlsxHeaders(sheet,'QF_2624_test',9)[3],'');assert.equal(reader.xlsxHeaders(sheet,'QF_2624_test',10)[2],rows[1][fields[0].id]);
  assert.equal(source.hubSchema.schemaString,snap.schemaString);assert.equal(h.sqlite.prepare('SELECT payload FROM product_options').get().payload,before);
 }finally{h.close();}
});

test('official Single/Excel mapping uses exact wire price IDs without replacing saved manual connections',async()=>{
 const h=mobileIntakeHarness();try{
  const single=snapshot({code:'A01464742',name:'와이홉'},raw=>{raw.properties.startPage={type:'object',required:['productName','categoryPath'],properties:{productName:{type:'string',title:'상품명'},categoryPath:{type:'string',title:'카테고리'}}};}),excel={...single,metadata:{...single.metadata,scopeType:'Retail_Categorized_Excel',version:190}},original=officialWorkbook(),mapper=h.load('app/quotation-mapping.ts'),schema=h.load('app/quotation-schema.ts').getQuotationSchema('69900',path,single),fields=priceFields(schema);
  const suggested=mapper.suggestQuotationMappings(original.headers,'69900',null,single);
  assert.deepEqual(Array.from(suggested.mappings.filter(mapping=>mapping.column>=2&&mapping.column<=5),mapping=>mapping.field),fields.map(field=>field.id));
  const kept=mapper.refreshCategoryMappings(original.headers,'69900',[{column:2,field:'supplyPrice',required:false}],[],new Set(),null,single);assert.equal(kept.mappings.find(mapping=>mapping.column===2).field,'supplyPrice');
  const connected=await h.load('app/official-hub-template.ts').connectOfficialHubTemplate(original.bytes.buffer,single,excel);assert.equal(connected.mappings.find(mapping=>mapping.column===2).field,fields[0].id);assert.equal(connected.report.ambiguousColumns.length,0);
  const wrong=structuredClone(excel),raw=JSON.parse(wrong.schemaString);raw.properties.productPage.properties.commonAttributes.properties.purchasePrice.maxLength=2;wrong.schemaString=JSON.stringify(raw);
  await assert.rejects(h.load('app/official-hub-template.ts').connectOfficialHubTemplate(original.bytes.buffer,single,wrong),/공급가/);
  const ambiguous=snapshot(single.company,raw=>{raw.properties.productPage.properties.other={type:'string',title:'공급가'};});assert.ok(mapper.suggestQuotationMappings(['공급가'],'69900',null,ambiguous).ambiguousColumns.includes(0));
 }finally{h.close();}
});

test('only the exact brand suggestion dropdown allows manual brand text and explicit blank',async()=>{
 const h=mobileIntakeHarness();try{
  const snap={...snapshot({code:'A01464742',name:'와이홉'},raw=>{raw.properties.productPage.properties.brand={type:'string',title:'브랜드',minLength:1,dropdown:['브랜드 없음']};raw.properties.productPage.required=['brand'];raw.required=['productPage'];}),draftInitialization:'couplus-required-v1',settingsInitialization:'couplus-options-v1'},quotes=h.load('app/quotation-schema.ts'),schema=quotes.getQuotationSchema('69900',path,snap),brand=schema.fields.find(field=>field.id==='brand');
  assert.equal(brand.type,'text');assert.equal(brand.choices,undefined);assert.equal(brand.draftDefault,'브랜드 없음');assert.deepEqual(Array.from(brand.couplusSetting.values),['브랜드 없음']);assert.equal(quotes.quotationValueIssues(brand,'와이홉').length,0);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'브랜드 추천',categoryId:'69900',categoryPath:path,hubSchema:snap,template:null,mappings:[]},'cat');h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),url='/api/products/'+product.id+'/quotation-fields';let view=await json(await h.route(url));
  view=await json(await h.route(url,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'brand',optionId:null,value:'와이홉'},{fieldKey:'brand',optionId:view.resolved.rows.find(row=>row.optionId).optionId,value:''}]}}));
  assert.equal(view.resolved.rows.find(row=>!row.optionId).fields.brand.value,'와이홉');assert.equal(view.resolved.rows.find(row=>row.optionId).fields.brand.value,'');assert.equal(view.resolved.rows.find(row=>row.optionId).fields.brand.source,'manual-option');
  for(const change of [raw=>{raw.properties.productPage.properties.brand.enum=['브랜드 없음'];},raw=>{raw.properties.productPage.properties.other={type:'object',properties:{brand:raw.properties.productPage.properties.brand}};delete raw.properties.productPage.properties.brand;}]){const altered=JSON.parse(snap.schemaString);change(altered);const result=quotes.getQuotationSchema('69900',path,{...snap,schemaString:JSON.stringify(altered)}),field=result.fields.find(field=>field.hubWire?.path.at(-1)==='brand');assert.equal(field.type,'select');assert.ok(quotes.quotationValueIssues(field,'와이홉').length);}
 }finally{h.close();}
});

test('only exact string price paths bind and allOf items empty object adds no unsupported constraint',()=>{
 const h=mobileIntakeHarness();try{
  const q=h.load('app/quotation-schema.ts'),company={code:'A01464742',name:'와이홉'},snap=snapshot(company),get=value=>q.getQuotationSchema('69900',path,value);
  assert.equal(get(snap).unsupportedFields.length,0);
  for(const items of [{type:'string'},false,[],null]){const altered=snapshot(company,raw=>{raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.items=items;});assert.ok(get(altered).unsupportedFields.includes('productPage / commonAttributes / exposedAttributes'));}
  for(const type of ['boolean',['string','number'],['string','boolean']]){const altered=snapshot(company,raw=>{raw.properties.productPage.properties.commonAttributes.properties.purchasePrice.type=type;});assert.equal(priceFields(get(altered))[0].hubInput,undefined);}
  const unrelated=snapshot(company,raw=>{raw.properties.productPage.properties.other={type:'string',title:'공급가'};});assert.equal(get(unrelated).fields.find(field=>field.hubWire?.path.at(-1)==='other').hubInput,undefined);
  const limited=snapshot(company,raw=>{Object.assign(raw.properties.productPage.properties.commonAttributes.properties.purchasePrice,{minLength:3,maxLength:4,minimum:10,maximum:20});});
  const field=priceFields(get(limited))[0];assert.equal(field.min,1);assert.equal(field.max,Number.MAX_SAFE_INTEGER);assert.equal(field.minLength,3);assert.equal(field.maxLength,4);
  assert.equal(q.quotationValueIssues(field,'123').length,0,'JSON numeric bounds do not constrain a string');assert.ok(q.quotationValueIssues(field,'12').length);assert.ok(q.quotationValueIssues(field,'12345').length);
 }finally{h.close();}
});

for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(`actual quotation preview covers equivalent primary wire prices but preserves divergent manual prices (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const snap=snapshot(company),excel={...snap,metadata:{...snap.metadata,scopeType:'Retail_Categorized_Excel',version:190}},original=officialWorkbook(),connected=await h.load('app/official-hub-template.ts').connectOfficialHubTemplate(original.bytes.buffer,snap,excel),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',original.bytes)).toString('hex'),storageKey=`owner/category-templates/${sha256}.xlsx`;
  await h.bindings.FILES.put(storageKey,original.bytes,{customMetadata:{sha256,format:'xlsx'}});
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'가격 최종연결',categoryId:'69900',categoryPath:path,hubSchema:snap,...connected,template:{...connected.template,name:'prices.xlsx',sha256,storageKey}},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,preview=()=>h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}).then(json),qurl=base+'/quotation-fields';
  const first=await preview(),prices=['supplyPrice','salePrice','msrp'];
  assert.deepEqual(first.report.mappingCoverage.filter(field=>prices.includes(field.fieldId)),[]);
  assert.deepEqual(first.submissionReview.issues.filter(issue=>issue.code==='EXCEL_FIELD_UNMAPPED'&&prices.includes(issue.fieldId)),[]);
  let view=await json(await h.route(qurl));const row=view.resolved.rows.find(row=>row.optionId),wire=priceFields(view.resolved.schema)[0];
  const coverage=h.load('app/exports/quotation-fields.ts').quotationMappingCoverage,msrp=priceFields(view.resolved.schema)[2];
  assert.ok(coverage(view.resolved,{...profile,mappings:profile.mappings.filter(mapping=>mapping.field!==msrp.id)}).some(field=>field.fieldId==='msrp'),'the separate OSRP wire cannot stand in for MSRP');
  const save=async changes=>{view=await json(await h.route(qurl,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));};
  await save([{fieldKey:'supplyPrice',optionId:row.optionId,value:''}]);
  assert.ok((await preview()).report.mappingCoverage.some(field=>field.fieldId==='supplyPrice'),'explicit canonical blank remains unexported while wire price is nonempty');
  await save([{fieldKey:'supplyPrice',optionId:row.optionId,value:row.fields[wire.id].value}]);
  assert.ok(!(await preview()).report.mappingCoverage.some(field=>field.fieldId==='supplyPrice'),'same-value manual price is represented by the exact wire');
  await save([{fieldKey:wire.id,optionId:row.optionId,value:'12345'}]);
  const changed=await preview();assert.ok(changed.report.mappingCoverage.some(field=>field.fieldId==='supplyPrice'));assert.equal(changed.rows[0][2],'12345');
  const excluded=structuredClone(view.resolved);excluded.rows.find(value=>value.optionId===row.optionId).included=false;assert.ok(!coverage(excluded,profile).some(field=>field.fieldId==='supplyPrice'),'excluded option values do not block the included output');
  await save([{fieldKey:'supplyPrice',optionId:row.optionId,value:'12345'}]);
  const aligned=await preview();assert.ok(!aligned.report.mappingCoverage.some(field=>field.fieldId==='supplyPrice'));
  const download=await h.route(base+'/quotation',{method:'POST',body:{action:'download',profileId:profile.id,fingerprint:aligned.fingerprint}});assert.equal(download.status,200,await download.clone().text());
  const reader=h.load('app/xlsx-template.ts'),files=await reader.readXlsxArchive(await download.arrayBuffer()),sheet=reader.inspectXlsxArchive(files);assert.equal(reader.xlsxHeaders(sheet,'QF_2624_test',9)[2],'12345');
 }finally{h.close();}
});
