import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

// Minimal public shapes from the live 69900 schema. The private capture is not a fixture.
const path=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
const raw=()=>({type:'object',properties:{
 startPage:{type:'object',properties:{productName:{type:'string',title:'상품명'},categoryPath:{type:'string',title:'카테고리'}}},
 productPage:{type:'object',properties:{commonAttributes:{type:'object',required:['msrp'],properties:{msrp:{type:['string','null'],requirement:'선택',title:'권장소비자가격'}}},unexposedAttributes:{type:'array',items:{},allOf:[{contains:{type:'object',properties:{attributeName:{type:'string',enum:['렌즈 종류'],requirement:'선택'},attributeValue:{type:['string','null'],enum:['일반렌즈','미러렌즈',null],dropdown:['일반렌즈','미러렌즈']}}}}]}}},
 imagePage:{type:'object',properties:{images:{type:'object',required:['mainImage','additionalImage'],properties:{mainImage:{type:'string',minLength:1},additionalImage:{type:['string','null'],requirement:'선택'}}},details:{type:'object',required:['detailedImage','htmlProductDetailContent','altText'],properties:{detailedImage:{type:['string','null'],requirement:'필수'},htmlProductDetailContent:{type:['string','null'],requirement:'선택'},altText:{type:['string'],requirement:'필수',maxLength:500}}}}},
 legalPage:{type:'object',required:['adCert'],properties:{adCert:{type:'string',title:'adCert'},productNoticeName:{type:'string',prefilled:true,minLength:1,title:'고시명'}}},
 logisticsPage:{type:'object',required:['skuUnitBoxWeight'],properties:{skuUnitBoxWeight:{type:'string',minLength:1,title:'한 개 단품 포장 무게',requirement:'필수'}}}
}});
const snapshot=(company,change=()=>{})=>{const schema=raw();change(schema);return{format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath:path,company,observedAt:Date.now(),schemaString:JSON.stringify(schema),metadata:{kanCategoryId:2624,noticeNumber:4,scopeType:'Retail_Categorized_Single',version:188},inputBindings:'couplus-paths-v1'};};
const company={code:'A01464742',name:'와이홉'};
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const at=(schema,path)=>schema.fields.find(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(path));
const sourcingPage=()=>({type:'object',hidden:true,required:['sourcingChannelType','sourcingChannelId'],properties:{
 sourcingChannelType:{type:['string','null'],hidden:true,requirement:'선택',title:'소싱 채널',examples:['Naver']},
 sourcingChannelId:{type:['string','null'],hidden:true,requirement:'선택',title:'소싱 채널 ID',examples:['N123']},
}});

test('only the observed hidden nullable sourcing pair is noneditable; changed constraints stay unsupported',()=>{
 const h=mobileIntakeHarness();try{
  const q=h.load('app/quotation-schema.ts'),get=change=>q.getQuotationSchema('69900',path,snapshot(company,r=>{r.properties.sourcingPage=sourcingPage();change?.(r.properties.sourcingPage,r);}));
  const valid=get();assert.equal(valid.status,'observed');assert.equal(valid.unsupportedFields.length,0);
  assert.deepEqual(JSON.parse(JSON.stringify(valid.fields)),JSON.parse(JSON.stringify(q.getQuotationSchema('69900',path,snapshot(company)).fields)),'no existing field or ID changes');
  const variants=[
   p=>p.hidden=false,p=>p.type=['object','null'],p=>delete p.required,p=>p.required=['sourcingChannelType'],p=>p.required.push('sourcingChannelId'),
   p=>p.properties.extra={type:['string','null'],hidden:true,requirement:'선택'},p=>delete p.properties.sourcingChannelId,
   p=>p.properties.sourcingChannelId.hidden=false,p=>p.properties.sourcingChannelId.requirement='필수',
   p=>p.properties.sourcingChannelId.type='string',p=>p.properties.sourcingChannelId.type=['string','null','number'],
   ...['minLength','maxLength','pattern','format','enum','dropdown','default','const','$ref','allOf','oneOf','anyOf','not','if','minimum'].map(key=>p=>{p.properties.sourcingChannelId[key]=key==='minLength'?1:[];}),
   ...['additionalProperties','minProperties','dependencies','allOf','$ref'].map(key=>p=>{p[key]=false;}),
  ];
  for(const [index,change] of variants.entries()){const schema=get(change);assert.equal(schema.status,'unconfirmed',String(index));assert.ok(schema.unsupportedFields.includes('sourcingPage'),String(index));}
  assert.ok(get((p,r)=>{r.properties.otherPage=p;delete r.properties.sourcingPage;}).unsupportedFields.includes('otherPage'));
 }finally{h.close();}
});

for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(`hidden sourcing metadata leaves saved quotation values and frozen source untouched (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const snap=snapshot(company,r=>{r.required=['sourcingPage'];r.properties.sourcingPage=sourcingPage();}),profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'숨김 소싱 메타데이터',categoryId:'69900',categoryPath:path,hubSchema:snap,mappings:[],template:null},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),url='/api/products/'+product.id+'/quotation-fields';let view=await json(await h.route(url));
  assert.equal(view.resolved.schema.status,'observed');assert.ok(!view.resolved.validationIssues.some(issue=>issue.includes('스키마가 아직')||issue.includes('sourcingPage')));
  const field=at(view.resolved.schema,['logisticsPage','skuUnitBoxWeight']),option=view.resolved.rows.find(row=>row.optionId);
  view=await json(await h.route(url,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:field.id,optionId:null,value:'420'},{fieldKey:field.id,optionId:option.optionId,value:''}]}}));
  const before=JSON.stringify({product:h.sqlite.prepare('SELECT * FROM products').get(),options:h.sqlite.prepare('SELECT * FROM product_options').get(),context:h.sqlite.prepare('SELECT * FROM collection_context').get()});
  const reread=await json(await h.route(url));assert.equal(reread.resolved.rows.find(row=>row.optionId===option.optionId).fields[field.id].value,'');assert.equal(reread.resolved.rows.find(row=>row.optionId===option.optionId).fields[field.id].source,'manual-option');
  assert.equal(reread.resolved.rows.find(row=>row.optionId!==option.optionId).fields[field.id].value,'420');assert.deepEqual(reread.overrides,view.overrides);
  const source=await h.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',product.id,profile.id);assert.equal(source.hubSchema.schemaString,snap.schemaString);
  assert.equal(JSON.stringify({product:h.sqlite.prepare('SELECT * FROM products').get(),options:h.sqlite.prepare('SELECT * FROM product_options').get(),context:h.sqlite.prepare('SELECT * FROM collection_context').get()}),before);
 }finally{h.close();}
});

test('nullable enum dropdown may omit null only; values, order and real contradictions remain checked',()=>{
 const h=mobileIntakeHarness();try{
  const get=snap=>h.load('app/quotation-schema.ts').getQuotationSchema('69900',path,snap),valid=get(snapshot(company));
  assert.ok(!valid.unsupportedFields.some(path=>path.endsWith('렌즈 종류')));
  const field=valid.fields.find(field=>field.label==='렌즈 종류');assert.deepEqual(Array.from(field.choices,choice=>choice.value),['일반렌즈','미러렌즈','']);
  for(const mutate of [v=>v.dropdown=['일반렌즈'],v=>v.dropdown=['미러렌즈','일반렌즈'],v=>v.dropdown=['일반렌즈','없는 값'],v=>v.type='string']){
   const snap=snapshot(company,r=>mutate(r.properties.productPage.properties.unexposedAttributes.allOf[0].contains.properties.attributeValue));assert.ok(get(snap).unsupportedFields.some(path=>path.endsWith('렌즈 종류')));
  }
 }finally{h.close();}
});

test('only observed optional nullable wires and the additional-document control allow blank; real basic required fields stay required',()=>{
 const h=mobileIntakeHarness();try{
  const q=h.load('app/quotation-schema.ts'),schema=q.getQuotationSchema('69900',path,snapshot(company));
  for(const p of [['productPage','commonAttributes','msrp'],['imagePage','images','additionalImage'],['imagePage','details','htmlProductDetailContent'],['legalPage','adCert']]){const field=at(schema,p);assert.equal(field.required,false,p.join('.'));assert.equal(q.quotationValueIssues(field,'').length,0,p.join('.'));}
  for(const id of ['mainImage','detailImages','altText']){const field=schema.fields.find(f=>f.id===id);assert.equal(field.required,true);assert.ok(q.quotationValueIssues(field,'').length);}
  const notice=at(schema,['legalPage','productNoticeName']);assert.equal(notice.minLength,1,'prefilled formula behavior is a separate implementation');
  for(const change of [r=>r.properties.imagePage.properties.images.properties.additionalImage.requirement='필수',r=>r.properties.imagePage.properties.images.properties.additionalImage.type='string',r=>r.properties.imagePage.properties.images.properties.additionalImage.enum=['required-value']]){const altered=q.getQuotationSchema('69900',path,snapshot(company,change));assert.equal(at(altered,['imagePage','images','additionalImage']).required,true);}
  const constrained=q.getQuotationSchema('69900',path,snapshot(company,r=>{r.properties.legalPage.properties.adCert.minLength=1;}));assert.equal(at(constrained,['legalPage','adCert']).required,true);
 }finally{h.close();}
});

for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(`string packaging weight links saved option grams through actual quotation API without changing manual overrides (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const snap=snapshot(company),schema=h.load('app/quotation-schema.ts').getQuotationSchema('69900',path,snap),field=at(schema,['logisticsPage','skuUnitBoxWeight']);
  assert.equal(field.id,'live_69900_4841a27a756d93e6');assert.equal(field.hubInput,'packagedWeightG');assert.equal(field.numericText,true);assert.equal(field.type,'text');assert.equal(field.integer,true);assert.equal(field.min,1);assert.equal(field.max,1e9);
  const headers=['한 개 단품 포장 무게'],bytes=quotationWorkbook(headers),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),storageKey=`owner/category-templates/${sha256}.xlsx`,mappings=h.load('app/quotation-mapping.ts').suggestQuotationMappings(headers,'69900',null,snap).mappings;assert.equal(mappings[0].field,field.id);
  await h.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:'xlsx'}});
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'포장 무게 연결',categoryId:'69900',categoryPath:path,hubSchema:snap,mappings,template:{name:'weight.xlsx',format:'xlsx',sheetName:'견적서',headerRow:1,headers,sha256,storageKey}},'cat');h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,options=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(options.options);for(const row of rows)row.packagedWeightG=420;
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
  let view=await json(await h.route(base+'/quotation-fields'));const option=view.resolved.rows.find(row=>row.optionId);
  assert.equal(option.fields[field.id].value,'420');assert.equal(option.fields[field.id].source,'option');
  for(const value of ['0','-1','1.5','1e3','1000000001','420g']){const invalid=await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:field.id,optionId:option.optionId,value}]}});assert.equal(invalid.status,400,value);}
  const preview=()=>h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}).then(json);let report=await preview();assert.ok(!report.report.mappingCoverage.some(item=>item.fieldId==='packagedWeightG'));assert.equal(report.rows[0][0],'420');
  view=await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:field.id,optionId:option.optionId,value:''}]}}));
  report=await preview();assert.equal(report.rows[0][0],'');assert.ok(!report.report.mappingCoverage.some(item=>item.fieldId==='packagedWeightG'));
  const blank=view.resolved.rows.find(row=>row.optionId===option.optionId);assert.equal(blank.fields[field.id].source,'manual-option');assert.equal(blank.fields.packagedWeightG.value,'');
  assert.ok(report.submissionReview.issues.some(issue=>issue.code==='FIELD_INVALID'&&issue.optionId===option.optionId&&issue.fieldId==='packagedWeightG'),'the exact weight pair is mapped but its required blank still blocks submission');
  assert.equal(JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload).rows[0].packagedWeightG,420);
  const save=async changes=>view=await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));
  await save([{fieldKey:field.id,optionId:option.optionId,value:null},{fieldKey:'packagedWeightG',optionId:null,value:'420'},{fieldKey:'packagedWeightG',optionId:option.optionId,value:'420'}]);
  const label=view.resolved.schema.fields.find(field=>field.id==='packagedWeightG').label,decode=bytes=>new TextDecoder().decode(bytes);
  const exportedFields=async()=>{
   const report=await preview(),response=await h.route(base+'/quotation',{method:'POST',body:{action:'export',profileId:profile.id,fingerprint:report.fingerprint}});assert.equal(response.status,200,await response.clone().text());
   const files=unzipSync(new Uint8Array(await response.arrayBuffer())),document=JSON.parse(decode(files['quotation-fields.json'])),csv=decode(files['quotation-overrides.csv']);
   const canonicalRows=csv.split(/\r?\n/).filter(row=>row.includes('"packagedWeightG"'));
   return{report,files,document,canonicalRows,connections:canonicalRows.map(row=>row.match(/"([^"]*)"$/)?.[1]),warnings:document.warnings.filter(message=>message.includes(label+': Excel 열 미연결.'))};
  };
  const aligned=await exportedFields(),reader=h.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(aligned.files[aligned.report.filename]));
  for(let index=0;index<6;index++)assert.equal(reader.xlsxHeaders(sheet,'견적서',index+2)[0],'420','the real XLSX includes the canonical manual weight through its exact live wire');
  assert.equal(aligned.document.overrides.common.packagedWeightG,'420');assert.equal(aligned.document.overrides.options[option.optionId].packagedWeightG,'420');
  assert.deepEqual({connections:aligned.connections,warnings:aligned.warnings},{connections:['연결','연결'],warnings:[]});
  await save([{fieldKey:field.id,optionId:option.optionId,value:'500'}]);
  const divergent=await exportedFields();assert.equal(divergent.report.rows[0][0],'500');assert.ok(divergent.report.report.mappingCoverage.some(item=>item.fieldId==='packagedWeightG'));
  assert.deepEqual(divergent.connections,['미연결','미연결']);assert.equal(divergent.warnings.length,2);
  await save([{fieldKey:'packagedWeightG',optionId:option.optionId,value:''},{fieldKey:field.id,optionId:option.optionId,value:'420'}]);
  const manualBlank=await exportedFields();assert.equal(manualBlank.document.overrides.options[option.optionId].packagedWeightG,'');assert.equal(manualBlank.report.rows[0][0],'420');assert.deepEqual(manualBlank.connections,['미연결','미연결']);
  await save([{fieldKey:'packagedWeightG',optionId:option.optionId,value:'500'},{fieldKey:field.id,optionId:option.optionId,value:'510'}]);
  const latestOptions=await json(await h.route(base+'/options')),remaining=h.load('app/product-options.ts').optionInputs(latestOptions.options);remaining.find(row=>row.id===option.optionId).included=false;
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:latestOptions.options.revision,expectedProductVersion:latestOptions.productVersion,rows:remaining}}));
  const excluded=await exportedFields();assert.equal(excluded.report.rows.length,5);assert.ok(!excluded.report.report.mappingCoverage.some(item=>item.fieldId==='packagedWeightG'));
  assert.deepEqual(excluded.connections,['연결','미연결']);assert.equal(excluded.warnings.length,1);assert.ok(excluded.canonicalRows[1].includes('"제외"'));assert.equal(excluded.document.overrides.options[option.optionId].packagedWeightG,'500');
 }finally{h.close();}
});
