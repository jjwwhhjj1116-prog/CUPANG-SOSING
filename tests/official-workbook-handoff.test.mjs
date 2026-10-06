import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {schemaCompanies,hubSchemaSnapshot} from './helpers/hub-schema.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';
import {submissionPackageUI} from './helpers/submission-package-ui.mjs';
import {prepareAttachments,readPackageZip} from '../extensions/supplier-hub/package.mjs';
import {attachToSupplierHub} from '../extensions/supplier-hub/attach.mjs';

const originalPath=new URL('../outputs/step573-official-sunglasses.zip',import.meta.url),schemaPath=new URL('../outputs/step573-live-69900-schema.json',import.meta.url);
const available=fs.existsSync(originalPath)&&fs.existsSync(schemaPath);
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const categoryPath=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
function attachmentPage(companyCode){
 const events=[],titles=['작성이 완료된 견적서 Excel 파일을 업로드하십시오.','상품 이미지를 업로드하십시오.','제품 필수 표시사항을 업로드하십시오.'];
 const inputs=titles.map((innerText,index)=>({files:[],disabled:false,isConnected:true,closest:()=>null,parentElement:{innerText,querySelectorAll:()=>[{}]},dispatchEvent(){events.push(index);}}));
 const document={body:{innerText:'Company Code: '+companyCode},documentElement:{dataset:{}},querySelectorAll:selector=>selector==='input[type="file"]'?inputs:[]};
 class DataTransfer{constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}}
 return {inputs,events,run:(payload,checkOnly=false)=>vm.runInNewContext(`(${attachToSupplierHub.toString()})(payload,checkOnly)`,{payload,checkOnly,document,location:{origin:'https://supplier.coupang.com',pathname:'/qvt/registration'},DataTransfer,File,Event,Uint8Array,atob})};
}

test('file proof requires original evidence and never treats an existing OSRP column as absent',async()=>{
 const h=mobileIntakeHarness();try{
  const snapshot=hubSchemaSnapshot();snapshot.inputBindings='couplus-paths-v1';snapshot.metadata={kanCategoryId:3000,scopeType:'Retail_Categorized_Single',noticeNumber:17,version:73};
  const raw=JSON.parse(snapshot.schemaString),common=raw.properties.productPage.properties.commonAttributes;
  delete raw.properties.productPage.properties.price;
  Object.assign(common.properties,{purchasePrice:{type:'integer',title:'공급가'},msrp:{type:['string','null'],title:'권장소비자가격'},osrp:{type:['string','null'],title:'공식 판매처 가격'}});
  const build=async(hasColumn=false,required=false,spaced=false)=>{
   common.required=['purchasePrice',...(required?['osrp']:[])];snapshot.schemaString=JSON.stringify(raw);
   const headers=[spaced?' 상품명 ':'상품명','카테고리','공급가','권장소비자가격',hasColumn?'공식 판매처 가격':'시험 항목',...Array.from({length:20},(_,index)=>'선택 '+index)],name='QF_3000_시험';
   const row=(n,values)=>`<row r="${n}">${values.map((value,index)=>`<c r="${String.fromCharCode(65+index)}${n}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`;
   const category=snapshot.categoryPath.join('>')+' ('+snapshot.categoryId+')';
   const bytes=workbookArchive([
    ['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
    ['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml',`<workbook xmlns:r="relationship"><sheets><sheet name="${name}" r:id="one"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml',`<worksheet><sheetData>${row(1,['','Retail_Categorized_Excel:Kan:3000:Notice17:Version190'])}${row(5,headers)}${row(6,headers.map((_,i)=>i<3?'필수':'선택'))}${row(7,headers.map(()=>'작성 안내'))}${row(8,headers.map((_,i)=>i===1?category:'예시'))}${row(9,headers.map(()=>''))}</sheetData><dataValidations><dataValidation type="list" sqref="B9:B1008"><formula1>"${category}"</formula1></dataValidation></dataValidations></worksheet>`],
   ]);
   const model=h.load('app/official-hub-template.ts'),connected=await model.connectOfficialWorkbookTemplate(bytes,snapshot),profile=h.load('app/category-profiles.ts').validateCategoryProfile({name:'SYNTHETIC CONTRACT',categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,hubSchema:structuredClone(snapshot),template:{...connected.template,name:'synthetic.xlsx',sha256:connected.template.workbookEvidence.templateSha256},mappings:connected.mappings});
   return {bytes,profile,verified:await model.verifyOfficialWorkbookTemplate(bytes,profile)};
  };
  const absent=await build();assert.match(absent.verified.optionalUnmappedOsrpFieldId,/^live_/);
  assert.equal((await build(false,false,true)).verified.optionalUnmappedOsrpFieldId,absent.verified.optionalUnmappedOsrpFieldId,'saved header trimming remains compatible with the original');
  assert.equal((await build(true)).verified.optionalUnmappedOsrpFieldId,null,'a real output column must be mapped');
  assert.equal((await build(false,true)).verified.optionalUnmappedOsrpFieldId,null,'required Single values are never exempt');
  const forged=structuredClone(absent.profile);forged.template.workbookEvidence.sourceSchemaSha256='0'.repeat(64);
  await assert.rejects(h.load('app/official-hub-template.ts').verifyOfficialWorkbookTemplate(absent.bytes,forged),/원본·Single 지문/);
 }finally{h.close();}
});

// Physical values, label bytes and authentication below are synthetic test
// inputs in memory SQLite. They never describe or update a real seller product.
for(const company of schemaCompanies)test(`official workbook evidence can prepare a locally reviewed six-option package (${company.code})`,{skip:!available},async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 try{
  const reader=h.load('app/xlsx-template.ts'),zip=fs.readFileSync(originalPath),bytes=await reader.unwrapOfficialXlsxDownload(zip.buffer.slice(zip.byteOffset,zip.byteOffset+zip.byteLength));
  const hubSchema={format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath,company,observedAt:Date.now(),schemaString:fs.readFileSync(schemaPath,'utf8'),metadata:{displayCategoryCode:'69900',kanCategoryId:2624,scopeType:'Retail_Categorized_Single',noticeNumber:4,version:188},draftInitialization:'couplus-required-v1',settingsInitialization:'couplus-options-v1',inputBindings:'couplus-paths-v1'};
  const form=new FormData();form.set('file',new File([bytes],'official.xlsx'));form.set('schema',JSON.stringify(hubSchema));form.set('action','workbook');
  const connected=await json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template',{method:'POST',body:form})),201);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'ISOLATED HANDOFF FIXTURE',categoryId:'69900',categoryPath,hubSchema,template:connected.template,mappings:connected.mappings});
  h.context.category=profile;h.context.settings.brand=company.name;h.sqlite.prepare("UPDATE collection_jobs SET goal='work' WHERE id='job'").run();h.sqlite.prepare("UPDATE collection_context SET payload=? WHERE job_id='job'").run(JSON.stringify(h.context));await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const content=(await json(await h.route(base+'/content'))).content,images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
  const options=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(options.options);
  for(const row of rows)Object.assign(row,{packagedWeightG:420,packagedWidthMm:100,packagedLengthMm:200,packagedHeightMm:300});
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
  let view=await json(await h.route(base+'/quotation-fields'));
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   {fieldKey:'altText',optionId:null,value:'ISOLATED TEST ALT TEXT'},
  ]}}));
  view=await json(await h.route(base+'/quotation-fields'));
  const osrp=view.resolved.schema.fields.find(field=>field.hubWire?.path.join('.')==='productPage.commonAttributes.osrp');assert.equal(osrp.required,false);
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));
  assert.equal(preview.report.missingRequired.length,0);
  assert.ok(preview.report.mappingCoverage.some(field=>field.fieldId===osrp.id&&field.workbookOnlyAutomatic===true));
  assert.equal(preview.submissionReview.issues.find(issue=>issue.code==='EXCEL_OPTIONAL_SINGLE_OMITTED').kind,'review');
  const coverage=h.load('app/exports/quotation-fields.ts');
  assert.ok(coverage.quotationMappingIssues(view.resolved,profile).some(issue=>issue.fieldId===osrp.id&&issue.kind==='error'),'the stored evidence flag alone is not proof of the actual original file');
  const verified=await h.load('app/official-hub-template.ts').verifyOfficialWorkbookTemplate(bytes,profile);
  for(const mutate of [
   resolved=>{resolved.schema.fields.find(field=>field.id===osrp.id).required=true;},
   resolved=>{resolved.schema.fields.find(field=>field.id===osrp.id).hubWire.path=['productPage','commonAttributes','otherPrice'];},
   resolved=>{for(const row of resolved.rows)row.fields[osrp.id].source='schema';},
  ]){const resolved=structuredClone(view.resolved);mutate(resolved);assert.ok(coverage.quotationMappingIssues(resolved,profile,verified).some(issue=>issue.fieldId===osrp.id&&issue.kind==='error'));}
  const empty=structuredClone(view.resolved);for(const row of empty.rows)row.fields[osrp.id]={...row.fields[osrp.id],value:'',source:'empty'};
  assert.ok(!coverage.quotationMappingIssues(empty,profile,verified).some(issue=>issue.fieldId===osrp.id),'an absent optional value remains acceptable');
  const response=await h.route(base+'/quotation',{method:'POST',body:{action:'export',profileId:profile.id,fingerprint:preview.fingerprint}});assert.equal(response.status,200,await response.clone().text());
  const archive=new Uint8Array(await response.arrayBuffer()),files=readPackageZip(archive),prepared=await prepareAttachments(archive);assert.equal(prepared.includedOptions,6);assert.equal(prepared.profileId,profile.id);assert.deepEqual(prepared.company,company);
  const document=JSON.parse(new TextDecoder().decode(files.get('quotation-fields.json')));
  for(const row of document.rows){assert.equal(row.fields[osrp.id].source,'pricing');assert.equal(row.fields[osrp.id].value,view.resolved.rows.find(source=>source.optionId===row.optionId).fields[osrp.id].value);}
  const output=reader.inspectXlsxArchive(await reader.readXlsxArchive(files.get(preview.filename))),msrpColumn=profile.template.headers.indexOf('권장소비자가격');
  for(let index=0;index<6;index++){const values=reader.xlsxHeaders(output,profile.template.sheetName,index+9);assert.equal(values[1],preview.rows[index][1]);assert.equal(values[msrpColumn],String(preview.rows[index][msrpColumn]));}
  assert.equal(preview.submissionReview.errorCount,0,JSON.stringify(preview.submissionReview.issues.filter(issue=>issue.kind==='error')));
  const retained=()=>JSON.stringify(['products','product_options','product_content','product_quotation_fields','collection_context','category_profiles'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all())),before=retained();
  // Rebuild and verify the full original workbook through the real API even
  // when other test processes are consuming CPU; ordinary UI tests retain 5s.
  const ui=submissionPackageUI({route:h.route,productId:product.id,profileId:profile.id,categoryId:'69900',requestTimeoutMs:30000});
  await ui.click('견적서 + 첨부 파일 준비');assert.equal(ui.button('등록 전송').props.disabled,true,'manual agreements are still required');
  await ui.click('확장에 첨부 파일 준비');assert.equal(ui.calls.filter(call=>call.action==='prepare').length,1);assert.equal(ui.calls.some(call=>call.action==='transmit'),false);
  ui.choose();await ui.click('등록 전송');assert.equal(ui.calls.filter(call=>call.action==='transmit').length,1);assert.deepEqual(ui.alerts(),[]);
  assert.equal(retained(),before);assert.ok(!h.network.includes('supplier.coupang.com'));assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
  const wrong=attachmentPage(schemaCompanies.find(item=>item.code!==company.code).code);assert.throws(()=>wrong.run(prepared),/회사코드/);assert.deepEqual(wrong.events,[]);
  const page=attachmentPage(company.code);assert.equal(page.run(prepared,true).state,'ready');assert.deepEqual(page.events,[]);
  assert.equal(page.run(prepared).state,'dispatched');assert.deepEqual(page.events,[0,1,2]);assert.equal(page.inputs[0].files[0].name,preview.filename);

  for(const [optionId,value] of [[null,'19900'],['collected-1','']]){
   view=await json(await h.route(base+'/quotation-fields'));
   await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:osrp.id,optionId,value}]}}));
   const manual=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));
   assert.ok(manual.submissionReview.issues.some(issue=>issue.fieldId===osrp.id&&issue.code==='EXCEL_FIELD_UNMAPPED'&&issue.kind==='error'),'manual nonempty and deliberate blank remain visible, unexported inputs');
   const blocked=await h.route(base+'/quotation',{method:'POST',body:{action:'export',profileId:profile.id,fingerprint:manual.fingerprint}});assert.equal(blocked.status,200);
   await assert.rejects(prepareAttachments(new Uint8Array(await blocked.arrayBuffer())),/수정이 필요한 오류/);
   view=await json(await h.route(base+'/quotation-fields'));
   assert.equal(view.resolved.rows.find(row=>row.optionId===(optionId??'collected-1')).fields[osrp.id].value,value);
   await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:osrp.id,optionId,value:null}]}}));
  }
  const saved=h.sqlite.prepare('SELECT payload FROM category_profiles WHERE id=?').get(profile.id).payload,forged=JSON.parse(saved);
  forged.template.workbookEvidence.sourceSchemaSha256='0'.repeat(64);h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(forged),profile.id);
  const rejected=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}),400);assert.match(rejected.error,/원본·Single 지문/);
  h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(saved,profile.id);
  const ordinary=JSON.parse(saved);delete ordinary.template.workbookEvidence;h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(ordinary),profile.id);
  const noEvidence=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));assert.ok(noEvidence.submissionReview.issues.some(issue=>issue.fieldId===osrp.id&&issue.kind==='error'));
  h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(saved,profile.id);
  assert.deepEqual(h.objects.get(profile.template.storageKey),new Uint8Array(bytes));
 }finally{h.close();}
});
