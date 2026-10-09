import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const row=(number,values)=>`<row r="${number}">${values.map((value,index)=>`<c r="${String.fromCharCode(65+index)}${number}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`;
const request=body=>new Request('https://app.test/api/category-profiles',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function setup(company){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 try{
  const headers=['상품명','카테고리','공급가',...Array.from({length:17},(_,index)=>'시험 선택 열 '+index)],category=schemaPath.join('>')+' (991234)',sheetName='QF_3000_시험분류';
  const bytes=workbookArchive([
   ['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
   ['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
   ['xl/workbook.xml',`<workbook xmlns:r="relationship"><sheets><sheet name="${sheetName}" r:id="one"/></sheets></workbook>`],
   ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
   ['xl/worksheets/sheet1.xml',`<worksheet><sheetData>${row(1,['','Retail_Categorized_Excel:Kan:3000:Notice17:Version190'])}${row(5,headers)}${row(6,headers.map((_value,index)=>index<3?'필수':'선택'))}${row(7,headers.map(()=>'실제 상품 확인'))}${row(8,headers.map((_value,index)=>index===1?category:'예시'))}</sheetData><dataValidations count="1"><dataValidation type="list" allowBlank="true" sqref="B9:B1008"><formula1>"${category}"</formula1></dataValidation></dataValidations></worksheet>`],
  ]);
  const schema={...hubSchemaSnapshot(company),metadata:{displayCategoryCode:'991234',kanCategoryId:3000,scopeType:'Retail_Categorized_Single',version:189}},official=h.load('app/official-hub-template.ts'),connected=await official.connectOfficialWorkbookTemplate(bytes.buffer,schema),sha256=createHash('sha256').update(bytes).digest('hex'),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');
  await h.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:'xlsx'}});
  const input={name:'합성 원본 갱신 검증',categoryId:'991234',categoryPath:schemaPath,hubSchema:schema,template:{...plain(connected.template),name:'synthetic-refresh.xlsx',sha256,storageKey},mappings:plain(connected.mappings)},api=h.load('app/api/category-profiles/route.ts');
  const {profile}=await json(await api.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})),201);
  return{h,api,bytes,schema,official,input,profile};
 }catch(error){h.close();throw error;}
}

// Isolated audit of the current picker request shape. This never contacts a
// live Hub or changes an existing product; all files/auth/SQLite are synthetic.
for(const company of schemaCompanies){
 test(`same-definition rule updates retain valid workbook proof (${company.code})`,async()=>{
  const f=await setup(company);try{
   const current={...f.schema,draftInitialization:'couplus-required-v1'};
   const mappings=f.h.load('app/hub-rule-version-mappings.ts').translateHubRuleVersionMappings(f.profile.mappings,f.schema,current);
   const derived=await f.official.connectOfficialWorkbookTemplate(f.bytes.buffer,current);
   assert.deepEqual(plain(derived.template.workbookEvidence),f.profile.template.workbookEvidence);
   assert.deepEqual(plain(derived.template.workbookFields),f.profile.template.workbookFields);
   const {profile}=await json(await f.api.PUT(request({id:f.profile.id,expectedRevision:f.profile.revision,profile:{...f.input,hubSchema:current,mappings}})));
   assert.deepEqual(profile.template,f.profile.template);assert.equal(profile.revision,2);
   await f.official.verifyOfficialWorkbookTemplateEvidence(f.bytes.buffer,profile.template,current);
  }finally{f.h.close();}
 });

 test(`changed schema source rejects the picker-style stale evidence without changing its original profile (${company.code})`,async()=>{
  const f=await setup(company);try{
   const raw=JSON.parse(f.schema.schemaString);raw.properties.productPage.properties.basicAttributes.properties.modelNumber.maxLength=49;
   const current={...f.schema,schemaString:JSON.stringify(raw)},before=JSON.stringify(f.h.sqlite.prepare('SELECT * FROM category_profiles').all());
   const response=await f.api.PUT(request({id:f.profile.id,expectedRevision:f.profile.revision,profile:{...f.input,hubSchema:current}}));
   assert.equal(response.status,409);assert.match((await response.json()).error,/기존 상품의 견적서는 보존/);
   assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM category_profiles').all()),before);
   assert.equal(f.h.sqlite.prepare('SELECT count(*) count FROM products').get().count,0);
  }finally{f.h.close();}
 });

 test(`rebinding proof to new Single source is insufficient for the old frozen source (${company.code})`,async()=>{
  const f=await setup(company);try{
   const raw=JSON.parse(f.schema.schemaString);raw.properties.productPage.properties.basicAttributes.properties.modelNumber.maxLength=49;
   const current={...f.schema,schemaString:JSON.stringify(raw)},checked=await f.official.connectOfficialWorkbookTemplate(f.bytes.buffer,current),rebound={...f.profile.template,workbookEvidence:plain(checked.template.workbookEvidence)};
   assert.notEqual(rebound.workbookEvidence.sourceSchemaSha256,f.profile.template.workbookEvidence.sourceSchemaSha256);
   await f.official.verifyOfficialWorkbookTemplateEvidence(f.bytes.buffer,rebound,current);
   await assert.rejects(f.official.verifyOfficialWorkbookTemplateEvidence(f.bytes.buffer,rebound,f.schema),/Single 지문/);
   await f.official.verifyOfficialWorkbookTemplateEvidence(f.bytes.buffer,f.profile.template,f.schema);
   assert.deepEqual(plain(checked.template.workbookFields),f.profile.template.workbookFields);
  }finally{f.h.close();}
 });
}
