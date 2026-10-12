import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {workbookArchive,quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {prepareAttachments,readPackageZip} from '../extensions/supplier-hub/package.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const hash=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
// Entirely synthetic official-layout bytes. The optional Single field and
// original Excel requirement intentionally differ; neither is a seller fact.
async function fixture(h,company,marker='필수'){
 const snapshot={...hubSchemaSnapshot(company),metadata:{displayCategoryCode:'991234',kanCategoryId:3000,scopeType:'Retail_Categorized_Single',noticeNumber:17,version:73}};
 const raw=JSON.parse(snapshot.schemaString),common=raw.properties.productPage.properties.commonAttributes;
 common.properties.purchasePrice={type:'integer',title:'공급가',minimum:1};common.properties.coupangSalePrice={type:'integer',title:'판매가',minimum:1};common.required=['purchasePrice','coupangSalePrice'];delete raw.properties.productPage.properties.price;snapshot.schemaString=JSON.stringify(raw);
 const schema=h.load('app/quotation-schema.ts').getQuotationSchema(snapshot.categoryId,schemaPath,snapshot),target=schema.fields.find(field=>field.label==='표면 처리');assert.equal(target.required,false);
 const headers=schema.fields.map(field=>field.label),column=headers.indexOf(target.label),sheetName='QF_3000_합성시험',category=schemaPath.join('>')+' (991234)';
 const letter=index=>{let result='';for(let value=index+1;value;value=Math.floor((value-1)/26))result=String.fromCharCode(65+(value-1)%26)+result;return result;};
 const row=(number,values)=>`<row r="${number}">${values.map((value,index)=>`<c r="${letter(index)}${number}" t="inlineStr"><is><t>${value.replaceAll('&','&amp;').replaceAll('<','&lt;')}</t></is></c>`).join('')}</row>`;
 const bytes=workbookArchive([
  ['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
  ['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',`<workbook xmlns:r="relationship"><sheets><sheet name="${sheetName}" r:id="one"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
  ['xl/worksheets/sheet1.xml',`<worksheet><sheetData>${row(1,['','Retail_Categorized_Excel:Kan:3000:Notice17:Version190'])}${row(5,headers)}${row(6,schema.fields.map((field,index)=>index===column?marker:field.required?'필수':'선택'))}${row(7,headers.map(()=>'원본 작성 안내'))}${row(8,headers.map((_value,index)=>index===1?category:'작성 예시'))}${row(9,headers.map(()=>''))}</sheetData><dataValidations><dataValidation type="list" sqref="B9:B1008"><formula1>"${category}"</formula1></dataValidation></dataValidations></worksheet>`],
 ]);
 const connected=await h.load('app/official-hub-template.ts').connectOfficialWorkbookTemplate(bytes.buffer,snapshot),sha256=await hash(bytes),storageKey=`owner/category-templates/${sha256}.xlsx`;
 await h.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:'xlsx'},httpMetadata:{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
 const input={name:'공식 필수 체크 해제 회귀',categoryId:snapshot.categoryId,categoryPath:schemaPath,hubSchema:snapshot,template:{...connected.template,name:'synthetic-original.xlsx',sha256,storageKey},mappings:connected.mappings.map(mapping=>mapping.column===column?{...mapping,required:false}:mapping)};
 assert.equal(input.mappings.find(mapping=>mapping.column===column).required,false);
 return {input,target,column,bytes,schema};
}

for(const company of schemaCompanies)test(`official required blanks survive draft editing but block preview/package handoff even when the saved checkbox is false (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const f=await fixture(h,company),categories=h.load('app/api/category-profiles/route.ts');
  const {profile}=await json(await categories.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(f.input)})),201);
  assert.equal(profile.mappings.find(mapping=>mapping.column===f.column).required,false);
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,content=(await json(await h.route(base+'/content'))).content;
  const images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(item=>item.object_key);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'검토한 합성 상품명',description:''},assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
  let view=await json(await h.route(base+'/quotation-fields'));
  const manual=field=>field.id==='title'?'검토한 합성 상품명':field.id==='salePrice'?'200':field.id==='packagedDimensionsMm'?'10*20*30':field.type==='number'?'17':field.type==='select'?field.choices.find(choice=>choice.value!=='')?.value:'합성 검토값';
  const changes=[...view.resolved.schema.fields.filter(field=>field.required&&field.id!=='category').map(field=>({fieldKey:field.id,optionId:null,value:manual(field)})),{fieldKey:'detailHtml',optionId:null,value:'<p>검토한 합성 설명</p>'},{fieldKey:f.target.id,optionId:null,value:''}];
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));
  view=await json(await h.route(base+'/quotation-fields'));assert.ok(view.resolved.rows.every(row=>row.fields[f.target.id].value===''&&row.fields[f.target.id].source==='manual-common'));
  assert.ok(view.resolved.rows.every(row=>row.fields[f.target.id].validationIssues.length===0),'the optional Single input can remain blank; the Excel requirement is independent');
  const retained=()=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','collection_context','category_profiles'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all())),before=retained();
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));
  const missing=preview.report.missingRequired.filter(cell=>cell.column===f.column+1);assert.equal(missing.length,6);assert.ok(missing.every(cell=>cell.header==='표면 처리'));assert.equal(preview.report.submissionReady,false);
  const issues=preview.submissionReview.issues.filter(issue=>issue.code==='EXCEL_REQUIRED_MISSING'&&issue.fieldId===f.target.id);assert.equal(issues.length,6);assert.equal(preview.submissionReview.errorCount,6);
  const response=await h.route(base+'/quotation',{method:'POST',body:{action:'export',profileId:profile.id,fingerprint:preview.fingerprint}});assert.equal(response.status,200,await response.clone().text());const exported=new Uint8Array(await response.arrayBuffer()),archive=readPackageZip(exported),review=JSON.parse(new TextDecoder().decode(archive.get('submission-review.json')));
  assert.equal(review.errorCount,6);await assert.rejects(prepareAttachments(exported),/수정이 필요한 오류/);
  const reader=h.load('app/xlsx-template.ts'),inspection=reader.inspectXlsxArchive(await reader.readXlsxArchive(archive.get(preview.filename).slice().buffer));assert.equal(reader.xlsxHeaders(inspection,profile.template.sheetName,9)[f.column]??'','');
  assert.equal(retained(),before);assert.deepEqual(Buffer.from(h.objects.get(profile.template.storageKey)),Buffer.from(f.bytes));assert.equal(product.supplier_hub_status,'미전송');
  view=await json(await h.route(base+'/quotation-fields'));await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:f.target.id,optionId:null,value:'직접 확인한 표면 처리'}]}}));
  const filled=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));assert.equal(filled.report.missingRequired.length,0);assert.equal(filled.submissionReview.errorCount,0);assert.ok(filled.rows.every(row=>row[f.column]==='직접 확인한 표면 처리'));
  const ready=await h.route(base+'/quotation',{method:'POST',body:{action:'export',profileId:profile.id,fingerprint:filled.fingerprint}});assert.equal(ready.status,200,await ready.clone().text());const files=await prepareAttachments(new Uint8Array(await ready.arrayBuffer()));assert.deepEqual(files.company,company);assert.equal(files.includedOptions,6);
  assert.equal((await h.load('db/category-profiles.ts').getCategoryProfile('owner',profile.id)).mappings.find(mapping=>mapping.column===f.column).required,false);assert.ok(!h.network.includes('supplier.coupang.com'));
 }finally{h.close();}
});

test('original exact required markers add one error while optional/conditional blanks and generic mapping flags keep their meaning',async()=>{
 const h=mobileIntakeHarness();try{
  for(const marker of ['필수','조건부 필수','선택']){
   const f=await fixture(h,schemaCompanies[0],marker),rows=[Object.fromEntries(f.input.mappings.map(mapping=>[mapping.field,mapping.column===f.column?'':'합성 채움']))];rows[0].title='합성 상품';rows[0].category=schemaPath.join('>')+' (991234)';rows[0].supplyPrice=17;
   const input={originalBytes:f.bytes.buffer,profile:f.input,rows,dataStartRow:9},before=JSON.stringify(input.profile);
   for(const required of [false,true]){
    const result=await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({...input,profile:{...f.input,mappings:f.input.mappings.map(mapping=>mapping.column===f.column?{...mapping,required}:mapping)}});
    assert.equal(result.report.missingRequired.filter(cell=>cell.column===f.column+1).length,marker==='필수'||required?1:0);
    assert.equal(result.values[0][f.column],'');
   }
   assert.equal(JSON.stringify(input.profile),before);
  }
  for(const format of ['xlsx','csv']){
   const bytes=format==='xlsx'?quotationWorkbook(['메모']):new TextEncoder().encode('메모\n'),sha256=await hash(bytes);
   const profile={name:'일반 필수 옵션',categoryId:'synthetic',categoryPath:['합성'],template:{name:'generic.'+format,format,sha256,sheetName:format==='xlsx'?'견적서':'',headerRow:1,headers:['메모']},mappings:[{column:0,field:'constant',constant:'',required:false}]};
   const result=await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:bytes.buffer,profile,rows:[{}],dataStartRow:2});assert.deepEqual(plain(result.report.missingRequired),[]);
   const required=await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:bytes.buffer,profile:{...profile,mappings:[{...profile.mappings[0],required:true}]},rows:[{}],dataStartRow:2});assert.equal(required.report.missingRequired.length,1);
  }
 }finally{h.close();}
});
