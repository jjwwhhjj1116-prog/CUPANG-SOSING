import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const column=index=>{let name='';for(let n=index+1;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;};
const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;');
const row=(number,values)=>`<row r="${number}">${values.map((value,index)=>`<c r="${column(index)}${number}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`;
const labels=['설치지원방식','소싱채널','소싱채널ID'],choices=['판매자설치','구매자설치'];

// Synthetic QF layout and Single schema contract, never a captured official
// workbook or a commercial classification of the recorded sunglasses source.
// Dummy columns have unsupported custom validation and must remain unmapped.
function workbook({guidance='실제 소싱채널을 직접 입력하세요.'}={}){
 const headers=['상품명','카테고리','공급가','판매가','렌즈 유형','렌즈 관리방법',...labels,...Array.from({length:11},(_,index)=>'시험 지원불가 열 '+index)];
 const category=schemaPath.join('>')+' (991234)',sheetName='QF_3000_시험분류';
 const markers=headers.map((_value,index)=>index<3?'필수':index===6?'조건부 필수':'선택');
 const guides=headers.map((_value,index)=>index===6?'설치 지원 대상 상품이면 지원방식을 확인하세요.':index===7?guidance:'실제 상품을 확인한 뒤 직접 입력하세요.');
 const examples=headers.map((_value,index)=>index===1?category:index===6?'예시 설치값':index===7?'EXAMPLE-SOURCE':index===8?'EXAMPLE-ID':'예시');
 const validation=`<dataValidations count="4"><dataValidation type="list" allowBlank="true" sqref="B9:B1008"><formula1>"${category}"</formula1></dataValidation><dataValidation type="list" allowBlank="true" sqref="E9:E1008"><formula1>"해당사항없음,UV"</formula1></dataValidation><dataValidation type="list" allowBlank="true" sqref="G9:G1008"><formula1>"${choices.join(',')}"</formula1></dataValidation><dataValidation type="custom" allowBlank="true" sqref="J9:T1008"><formula1>LEN(J9)&lt;100</formula1></dataValidation></dataValidations>`;
 const formula='<c r="U9"><f>1+1</f><v>2</v></c>';
 const sheet=`<worksheet><sheetData>${row(1,['', 'Retail_Categorized_Excel:Kan:3000:Notice17:Version190'])}${row(5,headers)}${row(6,markers)}${row(7,guides)}${row(8,examples)}<row r="9">${formula}</row></sheetData>${validation}</worksheet>`;
 const bytes=workbookArchive([
  ['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
  ['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',`<workbook xmlns:r="relationship"><sheets><sheet name="${sheetName}" r:id="one"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
  ['xl/worksheets/sheet1.xml',sheet],
 ]);
 return{bytes,headers,sheetName,validation,formula,guides,examples};
}

const request=(body,method='POST')=>new Request('https://app.test/api/category-profiles',{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function connect(h,company,original=workbook()){
 const snapshot={...hubSchemaSnapshot(company,'991234'),metadata:{displayCategoryCode:'991234',kanCategoryId:3000,scopeType:'Retail_Categorized_Single',noticeNumber:17,version:189}};
 const connected=await h.load('app/official-hub-template.ts').connectOfficialWorkbookTemplate(original.bytes.buffer,snapshot),sha256=digest(original.bytes);
 const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');
 await h.bindings.FILES.put(storageKey,original.bytes,{customMetadata:{sha256,format:'xlsx'}});
 const input={name:'합성 원본 추가 항목 '+company.name,categoryId:'991234',categoryPath:schemaPath,hubSchema:snapshot,
  template:{...plain(connected.template),name:'synthetic-'+company.code+'.xlsx',sha256,storageKey},mappings:plain(connected.mappings)};
 return{original,input,connected};
}
async function setup(company,{intake=false}={}){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 try{
  const connection=await connect(h,company),api=h.load('app/api/category-profiles/route.ts'),saved=await json(await api.POST(request(connection.input)),201),profile=saved.profile;
  const fields=profile.template.workbookFields;
  assert.deepEqual(fields.map(field=>field.label),labels,'only supported unmatched original columns become inputs');
  if(intake){
   h.context.category=profile;h.sqlite.prepare("UPDATE collection_context SET payload=? WHERE job_id='job'").run(JSON.stringify(h.context));
   await h.intake();
  }
  const product=intake?h.sqlite.prepare('SELECT * FROM products').get():null;
  return{h,api,...connection,profile,fields,product,base:product?'/api/products/'+product.id:null};
 }catch(error){h.close();throw error;}
}
const field=(f,label)=>f.fields.find(field=>field.label===label);
const cell=(view,optionId,id)=>view.resolved.rows.find(row=>row.optionId===optionId).fields[id];
const view=f=>f.h.route(f.base+'/quotation-fields?profileId='+f.profile.id).then(json);
async function save(f,current,changes){return json(await f.h.route(f.base+'/quotation-fields?profileId='+f.profile.id,{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes}}));}
const change=(fieldKey,value,optionId=null)=>({fieldKey,value,optionId});
const profileRows=h=>JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles ORDER BY id').all());
const productWork=h=>JSON.stringify({products:h.sqlite.prepare('SELECT * FROM products ORDER BY id').all(),content:h.sqlite.prepare('SELECT * FROM product_content ORDER BY product_id').all(),options:h.sqlite.prepare('SELECT * FROM product_options ORDER BY product_id').all(),quotes:h.sqlite.prepare('SELECT * FROM product_quotation_fields ORDER BY product_id').all(),context:h.sqlite.prepare('SELECT * FROM collection_context ORDER BY job_id').all()});

for(const company of schemaCompanies){
 test(`verified original descriptors reach the captured editable draft without example defaults (${company.code})`,async()=>{
  const f=await setup(company,{intake:true});try{
   const current=await view(f),before=productWork(f.h),install=field(f,labels[0]);
   assert.equal(f.profile.hubSchema.metadata.scopeType,'Retail_Categorized_Single');assert.equal(f.profile.template.workbookEvidence.excelSchemaVerified,false);
   for(const descriptor of f.fields){
    assert.equal(descriptor.id,`workbook_991234_${f.profile.template.sha256}_${descriptor.column}`);
    const definition=current.resolved.schema.fields.find(field=>field.id===descriptor.id);assert.ok(definition);
    assert.equal(definition.hubWire,undefined,'original Excel-only fields never fabricate a Hub wire');
    assert.equal(definition.workbookWire.requirement,descriptor.requirement);
    assert.equal(definition.required,false,'conditional applicability is not guessed');
    for(const row of current.resolved.rows){assert.equal(row.fields[descriptor.id].value,'');assert.equal(row.fields[descriptor.id].source,'empty');}
   }
   assert.equal(install.type,'select');assert.equal(install.requirement,'conditional');assert.deepEqual(install.choices,choices);
   assert.match(current.resolved.schema.fields.find(field=>field.id===install.id).help,/조건부 필수/);
   assert.ok(f.fields.slice(1).every(field=>field.requirement==='optional'&&field.type==='text'));
   assert.equal(current.categoryContext.profileId,f.profile.id);assert.equal(current.resolved.rows.filter(row=>row.included).length,6);
   const automatic=await json(await f.h.route(f.base+'/quotation-fields'));assert.ok(automatic.resolved.schema.fields.some(field=>field.id===install.id),'captured template fields also work without an explicit profile query');
   assert.equal(productWork(f.h),before);assert.equal(f.product.supplier_hub_status,'미전송');
  }finally{f.h.close();}
 });

 test(`common and option edits, intentional blanks and reset reach exact row9 XLSX columns (${company.code})`,async()=>{
  const f=await setup(company,{intake:true});try{
   const [install,source,sourceId]=f.fields.map(field=>field.id),profilesBefore=profileRows(f.h);let current=await view(f);
   const ids=current.resolved.rows.filter(row=>row.included).map(row=>row.optionId);assert.equal(ids.length,6);
   current=await save(f,current,[change(install,choices[0]),change(source,'공통 소싱'),change(sourceId,'COMMON-ID'),change(install,choices[1],ids[0]),change(source,'옵션 소싱',ids[0]),change(sourceId,'',ids[0]),change(source,'',ids[1]),change(source,'초기 옵션값',ids[2])]);
   current=await save(f,current,[change(source,null,ids[2])]);
   assert.equal(cell(current,ids[0],sourceId).source,'manual-option');assert.equal(cell(current,ids[0],sourceId).value,'');
   assert.equal(cell(current,ids[1],source).value,'');assert.equal(cell(current,ids[2],source).value,'공통 소싱');assert.equal(cell(current,ids[2],source).source,'manual-common');
   assert.equal(Object.hasOwn(current.overrides.options[ids[2]]??{},source),false,'reset removes only the option override');
   const preview=await json(await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}}));
   assert.equal(preview.report.dataStartRow,9);assert.equal(preview.rows.length,6);
   for(let index=0;index<6;index++)assert.deepEqual(preview.rows[index].slice(6,9),[index===0?choices[1]:choices[0],index===0?'옵션 소싱':index===1?'':'공통 소싱',index===0?'':'COMMON-ID']);
   const download=await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'download',profileId:f.profile.id,fingerprint:preview.fingerprint}});
   assert.equal(download.status,200,await download.clone().text());assert.equal(download.headers.get('x-quotation-fingerprint'),preview.fingerprint);
   const reader=f.h.load('app/xlsx-template.ts'),files=await reader.readXlsxArchive(await download.arrayBuffer()),inspection=reader.inspectXlsxArchive(files),sheet=new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml'));
   assert.deepEqual(Array.from(reader.xlsxHeaders(inspection,f.original.sheetName,7)),f.original.guides);assert.deepEqual(Array.from(reader.xlsxHeaders(inspection,f.original.sheetName,8)),f.original.examples);
   assert.ok(sheet.includes(f.original.validation));assert.ok(sheet.includes(f.original.formula));
   for(let index=0;index<6;index++)assert.deepEqual(Array.from(reader.xlsxHeaders(inspection,f.original.sheetName,index+9)).slice(6,9),preview.rows[index].slice(6,9));
   // The raw snapshot route has no selected profile. It must retain the
   // captured template context rather than drop Excel-only manual fields.
   const bundle=await f.h.route(f.base+'/bundle');assert.equal(bundle.status,200,await bundle.clone().text());
   const archived=await reader.readXlsxArchive(await bundle.arrayBuffer()),document=JSON.parse(new TextDecoder().decode(archived.get('quotation-fields.json'))),scopeArchive=JSON.parse(new TextDecoder().decode(archived.get('quotation-saved-scopes.json')));
   assert.equal(document.profileRevision,null);assert.equal(document.categoryContext.source,'collection');assert.equal(document.categoryContext.profileId,f.profile.id);
   for(const extra of f.fields)assert.ok(document.schema.fields.some(field=>field.id===extra.id));
   for(let index=0;index<ids.length;index++){
    const fields=document.rows.find(row=>row.optionId===ids[index]).fields;
    assert.deepEqual([fields[install].value,fields[source].value,fields[sourceId].value],preview.rows[index].slice(6,9));
   }
   assert.equal(document.overrides.options[ids[0]][sourceId],'');assert.equal(document.overrides.options[ids[1]][source],'');
   const stored=f.h.load('app/quotation-scopes.ts').scopedQuotationOverrides(scopeArchive.saved,'991234');
   assert.equal(stored.common[source],'공통 소싱');assert.equal(stored.options[ids[0]][sourceId],'');
   assert.ok(new TextDecoder().decode(archived.get('quotation-overrides.csv')).includes(sourceId));
   assert.equal(profileRows(f.h),profilesBefore);assert.equal(f.h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
  }finally{f.h.close();}
 });

 test(`stored original bytes reject forged field rules, company and owner metadata before profile mutation (${company.code})`,async()=>{
  const f=await setup(company);try{
   const before=profileRows(f.h),other=schemaCompanies.find(value=>value.code!==company.code);
   const forgeries=[
    input=>input.template.workbookFields[0].help='원본에 없는 안내',
    input=>input.template.workbookFields[0].choices=['원본에 없는 선택값','다른 선택값'],
    input=>{input.template.workbookFields[0].required=true;},
    input=>{input.template.storageKey=input.template.storageKey.replace(/^owner\//,'other-owner/');},
    input=>{input.hubSchema.company=other;},
   ];
   for(const forge of forgeries){const input=plain(f.input);forge(input);const response=await f.api.PUT(request({id:f.profile.id,expectedRevision:f.profile.revision,profile:input},'PUT'));assert.equal(response.status,400,await response.clone().text());assert.equal(profileRows(f.h),before);}
   const changed=workbook({guidance:'원본 바이트 변경'});await f.h.bindings.FILES.put(f.input.template.storageKey,changed.bytes,{customMetadata:{sha256:f.input.template.sha256,format:'xlsx'}});
   const response=await f.api.PUT(request({id:f.profile.id,expectedRevision:f.profile.revision,profile:f.input},'PUT'));assert.equal(response.status,400,await response.clone().text());assert.equal(profileRows(f.h),before,'matching metadata cannot approve changed original bytes');
  }finally{f.h.close();}
 });

 test(`new original SHA leaves old manual fields inactive and rejects stale write/download fingerprints (${company.code})`,async()=>{
  const f=await setup(company,{intake:true});try{
   const originalFields=f.fields.map(field=>field.id);let current=await view(f);
   current=await save(f,current,[change(originalFields[0],choices[0]),change(originalFields[1],'기존 원본 직접 입력'),change(originalFields[2],'OLD-ID')]);
   const stale=current,preview=await json(await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}})),workBefore=productWork(f.h);
   const replacement=await connect(f.h,company,workbook({guidance:'새 원본에서 확인한 소싱채널 안내'}));assert.notEqual(replacement.input.template.sha256,f.profile.template.sha256);
   const saved=await json(await f.api.PUT(request({id:f.profile.id,expectedRevision:f.profile.revision,profile:replacement.input},'PUT')));f.profile=saved.profile;
   current=await view(f);
   for(const old of originalFields)assert.ok(!current.resolved.schema.fields.some(field=>field.id===old),'old SHA identifiers must not reactivate on another original');
   for(const extra of f.profile.template.workbookFields)assert.equal(cell(current,null,extra.id).value,'');
   for(const [index,old] of originalFields.entries())assert.equal(current.overrides.common[old],[choices[0],'기존 원본 직접 입력','OLD-ID'][index],'inactive saved values are retained');
   const staleWrite=await f.h.route(f.base+'/quotation-fields?profileId='+f.profile.id,{method:'PUT',body:{expectedRevision:stale.revision,expectedInputFingerprint:stale.inputFingerprint,changes:[change(f.profile.template.workbookFields[1].id,'stale attempt')]}});assert.equal(staleWrite.status,409);
   const staleDownload=await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'download',profileId:f.profile.id,fingerprint:preview.fingerprint}});assert.equal(staleDownload.status,409);
   assert.equal(productWork(f.h),workBefore,'template change and rejected stale actions do not rewrite product/content/options/manual saved scopes');
  }finally{f.h.close();}
 });
}
