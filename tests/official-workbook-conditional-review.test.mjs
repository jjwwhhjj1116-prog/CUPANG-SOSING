import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const choices=['고객직접설치','방문설치(출장장착)'];
const guide='로켓설치 상품인 경우 설치지원방식을 선택하세요.\n고객직접설치: 고객이 직접 설치하는 경우\n방문설치(출장장착): 설치기사가 설치해주는 경우';
const col=index=>{let out='';for(let n=index+1;n;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;');
const row=(number,values)=>`<row r="${number}">${values.map((value,index)=>`<c r="${col(index)}${number}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`;

// Synthetic official layout, including the original conditional marker and a
// static allowBlank list. Neither examples nor category names prove applicability.
async function fixture(company,categoryId){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 const snapshot={...hubSchemaSnapshot(company,categoryId),metadata:{displayCategoryCode:categoryId,kanCategoryId:3000,scopeType:'Retail_Categorized_Single',noticeNumber:17,version:189}};
 const headers=['상품명','카테고리','공급가','설치지원방식','소싱채널',...Array.from({length:15},(_,index)=>'지원불가 시험 열 '+index)],sheetName='QF_3000_조건부시험';
 const category=schemaPath.join('>')+` (${categoryId})`;
 const validation=`<dataValidations><dataValidation type="list" sqref="B9:B1008" allowBlank="true"><formula1>"${category}"</formula1></dataValidation><dataValidation type="list" sqref="D9:D1008" allowBlank="true" showErrorMessage="false"><formula1>"${choices.join(',')}"</formula1></dataValidation><dataValidation type="custom" sqref="F9:T1008"><formula1>LEN(F9)&lt;100</formula1></dataValidation></dataValidations>`;
 const worksheet=`<worksheet><sheetData>${row(1,['','Retail_Categorized_Excel:Kan:3000:Notice17:Version190'])}${row(5,headers)}${row(6,headers.map((_,index)=>index<3?'필수':index===3?'조건부 필수':'선택'))}${row(7,headers.map((_,index)=>index===3?guide:'실제 상품을 직접 확인하세요.'))}${row(8,headers.map((_,index)=>index===1?category:index===3?choices[1]:'예시'))}</sheetData>${validation}</worksheet>`;
 const bytes=workbookArchive([
  ['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
  ['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',`<workbook xmlns:r="relationship"><sheets><sheet name="${sheetName}" r:id="one"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
  ['xl/worksheets/sheet1.xml',worksheet],
 ]);
 const connected=await h.load('app/official-hub-template.ts').connectOfficialWorkbookTemplate(bytes.buffer,snapshot),sha256=createHash('sha256').update(bytes).digest('hex');
 const template={...plain(connected.template),sha256,name:'synthetic-conditional.xlsx',storageKey:`owner/category-templates/${sha256}.xlsx`};
 const profile={name:'시험 조건 확인',categoryId,categoryPath:schemaPath,hubSchema:snapshot,template,mappings:plain(connected.mappings)};
 const model=h.load('app/quotation-schema.ts'),content=h.load('app/product-content.ts').emptyProductContent('conditional-product'),optionModel=h.load('app/product-options.ts');
 const options=optionModel.applyOptionRows(optionModel.emptyProductOptions('conditional-product'),['first','second','excluded'].map((id,index)=>({...optionModel.emptyOptionInput(id),originalName:id,unitCostCny:4.5,included:index<2})),'2026-10-10T00:00:00.000Z');
 const product={id:'conditional-product',title:'확인한 시험 상품',supply_price:2000,sale_price:3000,msrp:4000,exchange_rate:350,supply_margin:50,coupang_margin:40,image_keys:'[]',created_at:'2026-10-10T00:00:00.000Z'};
 const inputs={categoryId,categoryPath:schemaPath,hubSchema:snapshot,template,product,content,options,settings:h.settings};
 const conditional=template.workbookFields.find(field=>field.requirement==='conditional'),optional=template.workbookFields.find(field=>field.label==='소싱채널');
 const resolve=overrides=>model.resolveQuotationFields({...inputs,overrides});
 return {h,model,bytes,profile,conditional,optional,resolve,validation,guide,inspect:resolved=>h.load('app/submission-review.ts').inspectSubmission(resolved,[])};
}

for(const company of schemaCompanies)for(const categoryId of ['991234','998877'])test(`conditional applicability review preserves empty, selected and manual scope (${company.code}/${categoryId})`,async()=>{
 const f=await fixture(company,categoryId);try{
  const original=JSON.stringify(f.profile),empty=f.model.emptyQuotationOverrides(),definition=f.resolve(empty).schema.fields.find(field=>field.id===f.conditional.id);
  assert.equal(definition.hubWire,undefined);assert.equal(definition.required,false);assert.equal(definition.workbookWire.requirement,'conditional');assert.deepEqual(Array.from(definition.choices,choice=>choice.value),choices);
  const variants=[
   {overrides:empty,value:'',source:'empty'},
   {overrides:{common:{[f.conditional.id]:''},options:{}},value:'',source:'manual-common'},
   {overrides:{common:{[f.conditional.id]:choices[0]},options:{}},value:choices[0],source:'manual-common'},
   {overrides:{common:{[f.conditional.id]:choices[0]},options:{first:{[f.conditional.id]:''}}},value:'',source:'manual-option'},
  ];
  for(const {overrides,value,source} of variants){
   const before=JSON.stringify(overrides),resolved=f.resolve(overrides),first=resolved.rows.find(row=>row.optionId==='first').fields[f.conditional.id];
   assert.equal(first.value,value);assert.equal(first.source,source);assert.equal(first.needsReview,true);assert.deepEqual(Array.from(first.validationIssues),[]);assert.equal(first.reviewMessages.length,1);assert.ok(first.reviewMessages[0].includes(guide));assert.match(first.reviewMessages[0],/해당 상품에 조건이 적용되는지 확인/);
   const review=f.inspect(resolved),issues=review.issues.filter(issue=>issue.fieldId===f.conditional.id);
   assert.equal(issues.length,2,'one review per included option; excluded/common rows do not duplicate it');
   for(const issue of issues){assert.equal(issue.kind,'review');assert.equal(issue.code,'EVIDENCE_REVIEW');assert.ok(issue.message.includes(guide));assert.match(issue.message,/해당 상품에 조건이 적용되는지 확인/);assert.ok(['first','second'].includes(issue.optionId));}
   assert.equal(review.issues.filter(issue=>issue.fieldId===f.optional.id).length,0,'ordinary optional blanks remain quiet');
   assert.equal(JSON.stringify(overrides),before);assert.equal(JSON.stringify(f.profile),original);
  }
  const manual={common:{[f.conditional.id]:choices[0]},options:{first:{[f.conditional.id]:''}}};
  const restored=f.model.applyQuotationChanges(manual,f.model.validateQuotationChanges([{fieldKey:f.conditional.id,optionId:'first',value:null}],{schema:f.resolve(manual).schema,optionIds:['first','second','excluded'],overrides:manual}));
  const first=f.resolve(restored).rows.find(row=>row.optionId==='first').fields[f.conditional.id];assert.equal(first.value,choices[0]);assert.equal(first.source,'manual-common');assert.equal(first.reviewMessages.length,1);
 }finally{f.h.close();}
});

for(const company of schemaCompanies)test(`conditional blanks remain allowed in exact original XLSX while applicability stays in review (${company.code})`,async()=>{
 const f=await fixture(company,'998877');try{
  const field=f.conditional.id,rows=['',choices[0]].map(value=>Object.fromEntries(f.profile.mappings.map(mapping=>[mapping.field,mapping.column===0?'확인한 상품':mapping.column===1?schemaPath.join('>'):mapping.column===2?1000:mapping.field===field?value:''])));
  const output=await f.h.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:f.bytes.buffer,profile:f.profile,rows,dataStartRow:9});
  assert.equal(output.report.validationIssues.some(issue=>issue.column===4),false);assert.equal(output.report.missingRequired.some(issue=>issue.column===4),false);assert.equal(output.values[0][3],'');assert.equal(output.values[1][3],choices[0]);
  const reader=f.h.load('app/xlsx-template.ts'),files=await reader.readXlsxArchive(output.bytes.buffer),inspection=reader.inspectXlsxArchive(files),source=new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml'));
  assert.ok(source.includes(f.validation));assert.equal(reader.xlsxHeaders(inspection,f.profile.template.sheetName,9)[3],'');assert.equal(reader.xlsxHeaders(inspection,f.profile.template.sheetName,10)[3],choices[0]);
  const resolved=f.resolve({common:{},options:{first:{[field]:''},second:{[field]:choices[0]}}}),review=f.inspect(resolved);
  assert.equal(review.issues.filter(issue=>issue.fieldId===field&&issue.kind==='review').length,2);assert.equal(review.issues.filter(issue=>issue.fieldId===field&&issue.kind==='error').length,0);
 }finally{f.h.close();}
});

test('unsupported installation choices retain validation errors alongside one conditional review',async()=>{
 const f=await fixture(schemaCompanies[0],'998877');try{
  const overrides={common:{[f.conditional.id]:'알 수 없는 설치방식'},options:{}},resolved=f.resolve(overrides),definition=resolved.schema.fields.find(field=>field.id===f.conditional.id);
  assert.throws(()=>f.model.validateQuotationChanges([{fieldKey:definition.id,optionId:null,value:'알 수 없는 설치방식'}],{schema:resolved.schema,optionIds:['first','second','excluded'],overrides}),/선택값/);
  const issues=f.inspect(resolved).issues.filter(issue=>issue.fieldId===definition.id);
  assert.equal(issues.filter(issue=>issue.kind==='error').length,2);assert.equal(issues.filter(issue=>issue.kind==='review').length,2);assert.ok(issues.filter(issue=>issue.kind==='error').every(issue=>issue.code==='FIELD_INVALID'));
  const first=resolved.rows.find(row=>row.optionId==='first').fields[definition.id];assert.equal(first.value,'알 수 없는 설치방식');assert.equal(first.source,'manual-common');assert.equal(first.reviewMessages.length,1);assert.ok(first.validationIssues.length>0);
 }finally{f.h.close();}
});
