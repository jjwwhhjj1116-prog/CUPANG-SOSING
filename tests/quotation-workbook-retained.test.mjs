import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const request=(body,method='POST')=>new Request('https://app.test/api/category-profiles',{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const row=(number,values)=>`<row r="${number}">${values.map((value,index)=>`<c r="${String.fromCharCode(65+index)}${number}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`;
function workbook(help){
 const headers=['상품명','카테고리','공급가','검토 선택','직접 입력 A','직접 입력 B',...Array.from({length:14},(_,i)=>'합성 지원불가 '+i)],category=schemaPath.join('>')+' (991234)';
 return workbookArchive([
  ['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
  ['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml','<workbook xmlns:r="relationship"><sheets><sheet name="QF_3000_합성" r:id="one"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
  ['xl/worksheets/sheet1.xml',`<worksheet><sheetData>${row(1,['','Retail_Categorized_Excel:Kan:3000:Notice17:Version190'])}${row(5,headers)}${row(6,headers.map((_,i)=>i<3?'필수':i===3?'조건부 필수':'선택'))}${row(7,headers.map(()=>help))}${row(8,headers.map((_,i)=>i===1?category:'예시값'))}</sheetData><dataValidations count="3"><dataValidation type="list" allowBlank="true" sqref="B9:B1008"><formula1>"${category}"</formula1></dataValidation><dataValidation type="list" allowBlank="true" sqref="D9:D1008"><formula1>"기존 선택,새 선택"</formula1></dataValidation><dataValidation type="custom" sqref="G9:T1008"><formula1>LEN(G9)&lt;100</formula1></dataValidation></dataValidations></worksheet>`],
 ]);
}
// Synthetic category/Single/QF contract and synthetic source receipt. All
// handlers, profiles, overrides and generated XLSX run locally in real SQLite.
async function fixture(company=schemaCompanies[0]){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const schema={...hubSchemaSnapshot(company),metadata:{displayCategoryCode:'991234',kanCategoryId:3000,scopeType:'Retail_Categorized_Single',version:189}},api=h.load('app/api/category-profiles/route.ts');
  async function connect(bytes,name){const checked=await h.load('app/official-hub-template.ts').connectOfficialWorkbookTemplate(bytes.buffer,schema),sha256=digest(bytes),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');
   await h.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:'xlsx'}});return {name:'합성 보존 필드',categoryId:'991234',categoryPath:schemaPath,hubSchema:schema,template:{...plain(checked.template),name,sha256,storageKey},mappings:plain(checked.mappings)};}
  const oldBytes=workbook('이전 합성 작성 안내'),newBytes=workbook('개정 합성 작성 안내'),oldInput=await connect(oldBytes,'captured-synthetic.xlsx'),{profile}=await json(await api.POST(request(oldInput)),201);
  assert.deepEqual(profile.template.workbookFields.map(field=>field.column),[3,4,5]);
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body:{schemaVersion:1,sourceUrl:h.sourceUrl,provider:'step718-synthetic-local',collectedAt:new Date().toISOString(),title:'本地合成',description:'合成原文',attributes:[],
   options:[{sku:'SYNTHETIC-1',name:'合成1',unitPriceCny:25.6,minimumOrder:1,stock:1},{sku:'SYNTHETIC-2',name:'合成2',unitPriceCny:5.23,minimumOrder:1,stock:2},{sku:'SYNTHETIC-3',name:'合成3',unitPriceCny:6,minimumOrder:1,stock:3}],images:[]}}));
  const {productId}=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'})),base='/api/products/'+productId;
  const options=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(options.options);rows[2].included=false;
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
  const url=base+'/quotation-fields',read=()=>h.route(url+'?profileId='+profile.id).then(response=>json(response));let captured=await json(await h.route(url));
  const oldFields=profile.template.workbookFields,changes=[{fieldKey:oldFields[0].id,optionId:null,value:'기존 선택'},{fieldKey:oldFields[1].id,optionId:'collected-1',value:''},{fieldKey:oldFields[2].id,optionId:'collected-3',value:'제외 옵션의 보존값'}];
  captured=await json(await h.route(url,{method:'PUT',body:{expectedRevision:captured.revision,expectedInputFingerprint:captured.inputFingerprint,changes}}));
  const nextInput=await connect(newBytes,'current-synthetic.xlsx'),{profile:currentProfile}=await json(await api.PUT(request({id:profile.id,expectedRevision:profile.revision,profile:nextInput},'PUT')));
  const fixedSources=()=>JSON.stringify(['product_options','product_content','collection_results','collection_context','category_profiles','workspace_settings','product_price_policy'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()]));
  const allRows=()=>JSON.stringify(['products','product_quotation_fields'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()]));
  const objects=()=>JSON.stringify([...h.objects].map(([key,bytes])=>[key,Array.from(bytes)]));
  return {h,api,company,schema,profile,currentProfile,oldFields,captured,base,url,read,fixedSources,allRows,objects,oldBytes,newBytes};
 }catch(error){h.close();throw error;}
}

for(const company of schemaCompanies)test(`retained descriptors are read-only and an explicit current-field PUT alone reaches XLSX (${company.code})`,async()=>{
 const f=await fixture(company),{h}=f;try{
  const before=f.fixedSources(),rowsBefore=f.allRows(),objectsBefore=f.objects(),overridesBefore=plain(f.captured.overrides),io=[];
  for(const method of ['get','head','put']){const original=h.bindings.FILES[method];h.bindings.FILES[method]=(...args)=>{io.push(method);return original(...args);};}
  const current=await f.read(),again=await f.read(),queryless=await json(await h.route(f.url));
  assert.deepEqual(io,[],'describing retained fields performs no additional object request');
  assert.deepEqual(current.retainedWorkbook,{name:f.profile.template.name,sha256:f.profile.template.sha256,fields:f.oldFields});
  assert.deepEqual(Object.keys(current.retainedWorkbook).sort(),['fields','name','sha256']);assert.deepEqual(again,current);
  assert.equal(queryless.retainedWorkbook,undefined,'the original fields are already active in the captured default');
  assert.deepEqual(current.overrides,overridesBefore);assert.deepEqual(current.resolved.rows.map(row=>[row.optionId,row.included]),f.captured.resolved.rows.map(row=>[row.optionId,row.included]));
  for(const field of f.oldFields){assert.equal(current.resolved.schema.fields.some(item=>item.id===field.id),false);assert.equal(current.retainedWorkbook.fields.find(item=>item.id===field.id).help,field.help);}
  assert.equal(current.overrides.options['collected-1'][f.oldFields[1].id],'','own-property blank is retained');
  assert.equal(current.overrides.options['collected-3'][f.oldFields[2].id],'제외 옵션의 보존값','current excluded options still have their manual provenance');
  assert.equal(f.allRows(),rowsBefore);assert.equal(f.fixedSources(),before);assert.equal(f.objects(),objectsBefore);
  const target=f.currentProfile.template.workbookFields[0];assert.notEqual(target.id,f.oldFields[0].id);
  assert.ok(current.resolved.rows.every(row=>row.fields[target.id].value===''),'metadata must never auto-copy a same-column or same-label value');
  const wrong=await h.route(f.url+'?profileId='+f.profile.id,{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes:[{fieldKey:f.oldFields[0].id,optionId:'collected-1',value:'기존 선택'}]}});await json(wrong,400);assert.equal(f.allRows(),rowsBefore,'retained IDs do not become editable current field IDs');
  const saved=await json(await h.route(f.url+'?profileId='+f.profile.id,{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes:[{fieldKey:target.id,optionId:'collected-1',value:'새 선택'}]}}));
  assert.equal(saved.revision,current.revision+1);assert.notEqual(saved.inputFingerprint,current.inputFingerprint);assert.deepEqual(saved.retainedWorkbook,current.retainedWorkbook);
  for(const [key,value]of Object.entries(overridesBefore.common))assert.equal(saved.overrides.common[key],value);
  for(const [id,values]of Object.entries(overridesBefore.options))for(const [key,value]of Object.entries(values))assert.equal(saved.overrides.options[id][key],value);
  assert.equal(saved.overrides.options['collected-1'][target.id],'새 선택');assert.equal(f.fixedSources(),before);assert.equal(f.objects(),objectsBefore);
  const preview=await json(await h.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}}));assert.deepEqual(preview.report.company,company);assert.equal(preview.report.rowCount,2);
  assert.deepEqual(preview.rows.map(row=>row[target.column]),['새 선택','']);
  assert.ok(preview.report.warnings.some(warning=>warning.includes(f.oldFields[0].id)&&warning.includes('overrides')),'the existing generic export warning remains');
  const download=await h.route(f.base+'/quotation',{method:'POST',body:{action:'download',profileId:f.profile.id,fingerprint:preview.fingerprint}});assert.equal(download.status,200,await download.clone().text());
  const reader=h.load('app/xlsx-template.ts'),book=reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer()));
  assert.equal(reader.xlsxHeaders(book,f.currentProfile.template.sheetName,9)[target.column],'새 선택');assert.equal(reader.xlsxHeaders(book,f.currentProfile.template.sheetName,10)[target.column],'');
  assert.equal(f.fixedSources(),before);assert.equal(f.objects(),objectsBefore);assert.equal(h.network.length,0);assert.equal(h.aiSources.length,0);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM supplier_hub_receipts').get().n,0);
 }finally{h.close();}
});

for(const company of schemaCompanies)test(`same-category company and profile mismatches cannot expose retained descriptors (${company.code})`,async()=>{
 const f=await fixture(company),{h}=f;try{
  const before=f.allRows(),fixed=f.fixedSources(),objects=f.objects();
  await h.load('db/category-profiles.ts').createCategoryProfile('owner',{...f.currentProfile,name:'다른 프로필'},'other-same-category');
  const withOther=f.fixedSources();const wrong=await json(await h.route(f.url+'?profileId=other-same-category'),409);assert.equal(wrong.retainedWorkbook,undefined);assert.equal(wrong.overrides,undefined);
  h.setCompany(schemaCompanies.find(item=>item.code!==company.code));
  for(const url of [f.url,f.url+'?profileId='+f.profile.id]){const rejected=await json(await h.route(url),409);assert.equal(rejected.retainedWorkbook,undefined);assert.equal(rejected.overrides,undefined);}
  assert.equal(f.allRows(),before);assert.equal(f.fixedSources(),withOther);assert.notEqual(withOther,fixed);assert.equal(f.objects(),objects);assert.equal(h.network.length,0);
 }finally{h.close();}
});

test('retained helper filters exact own manual properties and actual option UUIDs without changing its inputs',async()=>{
 const f=await fixture(),{h}=f;try{
  const helper=h.load('app/quotation-workbook-retained.ts').retainedQuotationWorkbook,current=await f.read(),old=f.profile.template,next=f.currentProfile.template,field=f.oldFields[0],args=[old,next,current.resolved.schema],snapshot=JSON.stringify([old,next,current]);
  const run=(overrides,ids=['collected-1'])=>helper(...args,overrides,ids,f.schema);
  assert.equal(run({common:{},options:{deleted:{[field.id]:'ghost'}}}),undefined);
  assert.equal(run({common:Object.create({[field.id]:'inherited'}),options:{}}),undefined);
  assert.deepEqual(plain(run({common:{[field.id]:''},options:{}}).fields),[field]);
  assert.deepEqual(plain(run({common:{},options:{'collected-1':{[field.id]:'기존 선택'}}}).fields),[field]);
  assert.equal(helper(old,old,current.resolved.schema,current.overrides,['collected-1'],f.schema),undefined);
  assert.equal(helper({...old,workbookFields:undefined},next,current.resolved.schema,current.overrides,['collected-1'],f.schema),undefined);
  assert.equal(helper(old,next,{...current.resolved.schema,fields:[...current.resolved.schema.fields,{id:field.id}]},current.overrides,['collected-1'],f.schema)?.fields.some(item=>item.id===field.id)??false,false);
  assert.equal(JSON.stringify([old,next,current]),snapshot);
 }finally{h.close();}
});

test('retained helper validates old SHA descriptors and company evidence before exposing metadata',async()=>{
 const f=await fixture(),{h}=f;try{
  const helper=h.load('app/quotation-workbook-retained.ts').retainedQuotationWorkbook,current=await f.read(),old=f.profile.template,next=f.currentProfile.template,args=[next,current.resolved.schema,current.overrides,['collected-1'],f.schema];
  assert.throws(()=>helper({...old,workbookFields:[{...f.oldFields[0],id:f.currentProfile.template.workbookFields[0].id}]},...args),/원본/);
  assert.throws(()=>helper({...old,workbookEvidence:{...old.workbookEvidence,companyCode:schemaCompanies[1].code}},...args),/회사/);
  const output=helper(old,...args);output.fields[0].choices.push('반환값만 변경');assert.deepEqual(old.workbookFields,f.oldFields,'returned choices do not mutate the captured source');
 }finally{h.close();}
});

for(const company of schemaCompanies)test(`unlinked manual and legacy captured templates retain generic warnings without inferred descriptors (${company.code})`,async()=>{
 const f=await fixture(company),{h}=f;try{
  const context=h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,legacy=JSON.parse(context);delete legacy.category.template.workbookFields;legacy.category.mappings=legacy.category.mappings.filter(mapping=>!mapping.field.startsWith('workbook_'));
  h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(legacy));const old=await f.read();assert.equal(old.retainedWorkbook,undefined);assert.equal(old.overrides.common[f.oldFields[0].id],'기존 선택');
  h.sqlite.prepare('UPDATE collection_context SET payload=?').run(context);h.sqlite.prepare('UPDATE products SET source_url=?').run('synthetic://step718-unlinked');
  const manual=await f.read();assert.equal(manual.retainedWorkbook,undefined);assert.equal(manual.overrides.common[f.oldFields[0].id],'기존 선택');
  const source=await h.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',h.sqlite.prepare('SELECT id FROM products').get().id,f.profile.id),resolved=h.load('app/exports/quotation-source.ts').resolveQuotationExport(source);
  const warnings=h.load('app/exports/quotation-fields.ts').quotationFieldFiles(source,resolved,[],manual.inputFingerprint).warnings;assert.ok(warnings.some(text=>text.includes(f.oldFields[0].id)&&text.includes('overrides')));
  assert.equal(h.network.length,0);assert.equal(h.aiSources.length,0);
 }finally{h.close();}
});
