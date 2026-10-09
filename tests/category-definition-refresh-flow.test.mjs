import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';

const plain=value=>JSON.parse(JSON.stringify(value)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const col=index=>{let out='';for(let n=index+1;n;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;');
const row=(number,values)=>`<row r="${number}">${values.map((value,index)=>`<c r="${col(index)}${number}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`;
// Synthetic contract bytes; no captured original, live company session or
// working product is used. Unsupported spare columns are not inferred fields.
function workbook(){
 const headers=['상품명','카테고리','공급가','브랜드','모델명','렌즈 유형','설치지원방식','소싱채널ID',...Array.from({length:12},(_,index)=>'지원불가 시험 열 '+index)],category=schemaPath.join('>')+' (991234)',sheetName='QF_3000_정의갱신시험';
 const sheet=`<worksheet><sheetData>${row(1,['','Retail_Categorized_Excel:Kan:3000:Notice17:Version190'])}${row(5,headers)}${row(6,headers.map((_,index)=>index<3?'필수':index===6?'조건부 필수':'선택'))}${row(7,headers.map((_,index)=>index===6?'해당 상품의 설치 지원 조건을 직접 확인하세요.':'실제 원본 값을 직접 확인하세요.'))}${row(8,headers.map((_,index)=>index===1?category:'예시'))}</sheetData><dataValidations><dataValidation type="list" sqref="B9:B1008" allowBlank="true"><formula1>"${category}"</formula1></dataValidation><dataValidation type="list" sqref="F9:F1008" allowBlank="true"><formula1>"해당사항없음,UV"</formula1></dataValidation><dataValidation type="list" sqref="G9:G1008" allowBlank="true"><formula1>"고객직접설치,방문설치(출장장착)"</formula1></dataValidation><dataValidation type="custom" sqref="I9:T1008"><formula1>LEN(I9)&lt;100</formula1></dataValidation></dataValidations></worksheet>`;
 const bytes=workbookArchive([
  ['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
  ['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',`<workbook xmlns:r="relationship"><sheets><sheet name="${sheetName}" r:id="one"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],['xl/worksheets/sheet1.xml',sheet],
 ]);
 return{bytes,headers,sheetName};
}
function nextSnapshot(source){
 const raw=JSON.parse(source.schemaString);raw.properties.productPage.properties.basicAttributes.properties.modelNumber.maxLength=12;
 raw.properties.productPage.properties.basicAttributes.properties.refreshNote={type:'string',title:'정의 갱신 메모',maxLength:30};
 return{...source,schemaString:JSON.stringify(raw),metadata:{...source.metadata,version:190},observedAt:Date.now()};
}
function refreshRequest(source,hubSchema,key=randomUUID(),extra={}){
 return new Request(`https://app.test/api/category-profiles/${source.id}/refresh-definition`,{method:'POST',headers:{'content-type':'application/json',...(key===null?{}:{'Idempotency-Key':key})},body:JSON.stringify({expectedRevision:source.revision,hubSchema,...extra})});
}
const profileRows=h=>JSON.stringify(h.sqlite.prepare('SELECT * FROM category_profiles ORDER BY id').all());
const workRows=h=>JSON.stringify(['products','product_options','product_content','product_quotation_fields','collection_jobs','collection_context','collection_results'].map(table=>h.sqlite.prepare('SELECT * FROM '+table+' ORDER BY 1').all()));
async function setup(company,{generic=false,intake=false}={}){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 try{
  const snapshot={...hubSchemaSnapshot(company,'991234'),metadata:{displayCategoryCode:'991234',kanCategoryId:3000,scopeType:'Retail_Categorized_Single',noticeNumber:17,version:189}},original=workbook();
  let bytes,template,mappings;
  if(generic){
   bytes=new TextEncoder().encode('렌즈 유형,모델,고정값\n');const fields=h.load('app/quotation-schema.ts').getQuotationSchema(snapshot.categoryId,snapshot.categoryPath,snapshot).fields;
   const choice=fields.find(field=>field.label==='렌즈 유형'),model=fields.find(field=>field.hubWire?.path.join('.')==='productPage.basicAttributes.modelNumber');assert.ok(choice&&model);
   template={format:'csv',sheetName:'',headerRow:1,headers:['렌즈 유형','모델','고정값']};mappings=[{column:0,field:choice.id,required:true,choiceFormat:'label'},{column:1,field:model.id,required:false},{column:2,field:'constant',constant:'직접 고정값',required:false}];
  }else{
   bytes=original.bytes;const connected=await h.load('app/official-hub-template.ts').connectOfficialWorkbookTemplate(bytes.buffer,snapshot);template=plain(connected.template);mappings=plain(connected.mappings);
   const choice=mappings.find(mapping=>mapping.column===5);assert.ok(choice);choice.required=false;choice.choiceFormat='label';mappings.push({column:8,field:'constant',constant:'직접 고정값',required:true});
  }
  const sha256=sha(bytes),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,template.format);
  await h.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:template.format}});
  const input={name:'정의 갱신 시험 '+company.name,categoryId:'991234',categoryPath:schemaPath,hubSchema:snapshot,template:{...template,sha256,storageKey,name:'synthetic-refresh.'+template.format},mappings};
  const api=h.load('app/api/category-profiles/route.ts'),profile=(await json(await api.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})),201)).profile;
  let product;
  if(intake){h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();product=h.sqlite.prepare('SELECT * FROM products').get();assert.ok(product);}
  const refresh=h.load('app/api/category-profiles/[id]/refresh-definition/route.ts'),post=(request,sourceId=profile.id)=>refresh.POST(request,{params:Promise.resolve({id:sourceId})});
  return{h,input,original,bytes,profile,api,post,product,target:nextSnapshot(snapshot)};
 }catch(error){h.close();throw error;}
}

for(const company of schemaCompanies)test(`official definition refresh forks proof and preserves old capture/export/manual blank (${company.code})`,async()=>{
 const f=await setup(company,{intake:true});try{
  const base='/api/products/'+f.product.id,fieldsEndpoint=base+'/quotation-fields?profileId='+f.profile.id;
  let view=await json(await f.h.route(fieldsEndpoint));const blank=f.profile.template.workbookFields.find(field=>field.label==='소싱채널ID').id;
  view=await json(await f.h.route(fieldsEndpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:blank,optionId:null,value:''}]}}));
  const beforeView=plain(view),before=(await json(await f.h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}}))),oldRow=plain(f.h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(f.profile.id)),workBefore=workRows(f.h),key=randomUUID();
  const result=await json(await f.post(refreshRequest(f.profile,f.target,key)),201),fork=result.profile;
  assert.equal(result.sourceProfileId,f.profile.id);assert.equal(result.sourceRevision,f.profile.revision);assert.equal(fork.id,key);assert.notEqual(fork.id,f.profile.id);assert.equal(fork.revision,1);assert.equal(fork.categoryId,f.profile.categoryId);assert.deepEqual(fork.categoryPath,f.profile.categoryPath);assert.deepEqual(fork.hubSchema.company,company);assert.equal(fork._definitionSource,undefined,'internal retry provenance is not a client-editable profile field');
  assert.deepEqual(plain(f.h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(f.profile.id)),oldRow);assert.equal(workRows(f.h),workBefore);
  for(const field of ['sha256','storageKey','sheetName','headerRow','dataStartRow','headers'])assert.deepEqual(fork.template[field],f.profile.template[field]);
  assert.deepEqual(fork.template.workbookFields,f.profile.template.workbookFields);assert.equal(fork.template.workbookEvidence.templateSha256,f.profile.template.sha256);assert.equal(fork.template.workbookEvidence.sourceSchemaSha256,sha(new TextEncoder().encode(f.target.schemaString)));assert.notEqual(fork.template.workbookEvidence.sourceSchemaSha256,f.profile.template.workbookEvidence.sourceSchemaSha256);assert.equal(fork.template.workbookEvidence.excelSchemaVerified,false);
  for(const column of [5,8])assert.deepEqual(fork.mappings.find(mapping=>mapping.column===column),f.profile.mappings.find(mapping=>mapping.column===column));
  const replay=await json(await f.post(refreshRequest(f.profile,f.target,key)),201);assert.equal(replay.profile.id,fork.id);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) count FROM category_profiles').get().count,2);assert.equal(workRows(f.h),workBefore);
  const current=await json(await f.h.route(fieldsEndpoint));assert.deepEqual(current.resolved,beforeView.resolved);assert.equal(current.overrides.common[blank],'');assert.ok(current.resolved.rows.filter(row=>row.included).every(row=>row.fields[blank].value===''&&row.fields[blank].source==='manual-common'));
  const after=await json(await f.h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}}));assert.equal(after.fingerprint,before.fingerprint);assert.deepEqual(after.rows,before.rows);
  const download=await f.h.route(base+'/quotation',{method:'POST',body:{action:'download',profileId:f.profile.id,fingerprint:before.fingerprint}});assert.equal(download.status,200,await download.clone().text());
  // A fresh job/result is a fixture identity variant. It does not fetch a new
  // seller URL; it proves a future intake captures the new profile independently.
  const url='https://detail.1688.com/offer/813724060929.html',jobsApi=f.h.load('app/api/collection-jobs/route.ts');
  const queued=await json(await jobsApi.POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:[url],goal:'collect',profileId:fork.id,expectedProfileRevision:fork.revision})}))),job=queued.jobs[0];
  assert.equal(job.context.category.id,fork.id);assert.equal(job.context.category.hubSchema.schemaString,f.target.schemaString);
  const receipts=f.h.load('db/collection-results.ts'),receipt=await receipts.readCollectionResult('owner','job');await receipts.storeCollectionResult('owner',job.id,{...receipt.result,offerId:'813724060929',sourceUrl:url});
  const products=f.h.load('app/api/collection-jobs/[id]/product/route.ts'),created=await json(await products.POST(new Request(`https://app.test/api/collection-jobs/${job.id}/product`,{method:'POST'}),{params:Promise.resolve({id:job.id})}));
  const fresh=await json(await f.h.route('/api/products/'+created.productId+'/quotation-fields?profileId='+fork.id));
  assert.equal(fresh.categoryContext.profileId,fork.id);assert.equal(fresh.resolved.schema.fields.length,current.resolved.schema.fields.length+1);assert.ok(fresh.resolved.schema.fields.some(field=>field.label==='정의 갱신 메모'));
  const model=fresh.resolved.schema.fields.find(field=>field.hubWire?.path.join('.')==='productPage.basicAttributes.modelNumber');assert.equal(model.maxLength,12);
  assert.ok(fresh.resolved.rows.filter(row=>row.included).every(row=>row.fields[blank].source==='empty'&&row.fields[blank].value===''),'new product does not inherit old manual clear');
  assert.deepEqual(plain(f.h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(f.profile.id)),oldRow);assert.ok(!f.h.network.includes('supplier.coupang.com'));
 }finally{f.h.close();}
});

for(const company of schemaCompanies)test(`generic owned template refresh preserves constants and exact wire mapping without official claims (${company.code})`,async()=>{
 const f=await setup(company,{generic:true});try{
  const old=profileRows(f.h),result=await json(await f.post(refreshRequest(f.profile,f.target)),201),fork=result.profile;
  assert.deepEqual(fork.template,f.profile.template);assert.equal(fork.template.workbookEvidence,undefined);assert.equal(fork.template.workbookFields,undefined);assert.deepEqual(fork.mappings,f.profile.mappings);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) count FROM category_profiles').get().count,2);
  assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(f.profile.id)),JSON.stringify(JSON.parse(old)[0]));
  const model=f.h.load('app/quotation-schema.ts').getQuotationSchema(fork.categoryId,fork.categoryPath,fork.hubSchema).fields.find(field=>field.hubWire?.path.join('.')==='productPage.basicAttributes.modelNumber');assert.equal(model.maxLength,12);
  assert.deepEqual(Array.from(f.h.objects.get(fork.template.storageKey)),Array.from(f.bytes));
 }finally{f.h.close();}
});

test('refresh request requires a UUID key and exact changed Single category/company identity',async()=>{
 const f=await setup(schemaCompanies[0]);try{
  const before=profileRows(f.h),variants=[
   refreshRequest(f.profile,f.target,null),refreshRequest(f.profile,f.target,'invalid-key'),refreshRequest(f.profile,f.target,f.profile.id),refreshRequest(f.profile,f.target,randomUUID(),{template:f.input.template}),refreshRequest(f.profile,f.target,randomUUID(),{mappings:[]}),
   refreshRequest(f.profile,{...f.profile.hubSchema,observedAt:Date.now()+1}),
   refreshRequest(f.profile,{...f.target,company:schemaCompanies[1]}),
   refreshRequest(f.profile,{...f.target,categoryId:'991235',metadata:{...f.target.metadata,displayCategoryCode:'991235'}}),
   refreshRequest(f.profile,{...f.target,categoryPath:['다른 경로']}),
   refreshRequest(f.profile,{...f.target,metadata:{...f.target.metadata,scopeType:'Retail_Categorized_Excel'}}),
   refreshRequest(f.profile,{...f.target,metadata:{...f.target.metadata,kanCategoryId:3001}}),
   refreshRequest(f.profile,{...f.target,metadata:{...f.target.metadata,noticeNumber:18}}),
   refreshRequest(f.profile,{...f.target,metadata:{...f.target.metadata,productNoticeNumber:17,noticeNumber:18}}),
  ];
  for(const request of variants){await json(await f.post(request),400);assert.equal(profileRows(f.h),before);}
  await json(await f.post(refreshRequest({...f.profile,revision:0},f.target)),400);assert.equal(profileRows(f.h),before);
  const store=f.h.load('db/category-profiles.ts');await store.createCategoryProfile('foreign-owner',f.input,'foreign-source');
  const rows=profileRows(f.h);await json(await f.post(refreshRequest({...f.profile,id:'foreign-source'},f.target),'foreign-source'),404);assert.equal(profileRows(f.h),rows);
 }finally{f.h.close();}
});

for(const company of schemaCompanies)test(`refresh rejects changed originals, headers, sheet, metadata and foreign R2 keys (${company.code})`,async()=>{
 const f=await setup(company);try{
  const row=f.h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(f.profile.id),before=profileRows(f.h);
  const restore=async()=>{f.h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(row.payload,f.profile.id);await f.h.bindings.FILES.put(f.input.template.storageKey,f.bytes,{customMetadata:{sha256:f.input.template.sha256,format:'xlsx'}});};
  const cases=[
   async()=>{const corrupted=f.bytes.slice();corrupted[60]^=1;await f.h.bindings.FILES.put(f.input.template.storageKey,corrupted,{customMetadata:{sha256:f.input.template.sha256,format:'xlsx'}});},
   async()=>{await f.h.bindings.FILES.put(f.input.template.storageKey,f.bytes,{customMetadata:{sha256:'0'.repeat(64),format:'xlsx'}});},
   async()=>{await f.h.bindings.FILES.put(f.input.template.storageKey,f.bytes,{customMetadata:{sha256:f.input.template.sha256,format:'csv'}});},
   async()=>{const input=plain(f.input);input.template.headers[0]='조작된 머리글';f.h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(input),f.profile.id);},
   async()=>{const input=plain(f.input);input.template.sheetName='다른 작성 시트';f.h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(input),f.profile.id);},
   async()=>{const input=plain(f.input);input.template.storageKey=input.template.storageKey.replace(/^owner\//,'foreign-owner/');f.h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(input),f.profile.id);},
  ];
  for(const tamper of cases){await restore();await tamper();const invalid=profileRows(f.h);await json(await f.post(refreshRequest(f.profile,f.target)),400);assert.equal(profileRows(f.h),invalid,'rejected refresh cannot create or update a profile');}
  await restore();assert.equal(profileRows(f.h),before);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) count FROM category_profiles').get().count,1);
 }finally{f.h.close();}
});

test('refresh parent revision CAS and conflicting idempotent payload cannot duplicate or overwrite definitions',async()=>{
 const f=await setup(schemaCompanies[0]);try{
  const key=randomUUID(),result=await json(await f.post(refreshRequest(f.profile,f.target,key)),201),fork=result.profile;
  const conflicting=nextSnapshot(f.target);conflicting.metadata.version=191;const before=profileRows(f.h);
  await json(await f.post(refreshRequest(f.profile,conflicting,key)),409);assert.equal(profileRows(f.h),before);
  f.h.sqlite.prepare('UPDATE category_profiles SET revision=revision+1 WHERE id=?').run(f.profile.id);
  const changed=profileRows(f.h);await json(await f.post(refreshRequest(f.profile,f.target)),409);await json(await f.post(refreshRequest(f.profile,f.target,key)),409);assert.equal(profileRows(f.h),changed);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) count FROM category_profiles').get().count,2);assert.equal(f.h.sqlite.prepare('SELECT revision FROM category_profiles WHERE id=?').get(fork.id).revision,1);
 }finally{f.h.close();}
});

test('refresh insert loses a real SQLite race when its source revision changes after preflight',async()=>{
 const f=await setup(schemaCompanies[1]);try{
  const originalPrepare=f.h.db.prepare.bind(f.h.db);let raced=false;
  f.h.db.prepare=sql=>{const statement=originalPrepare(sql);if(/INSERT\s+INTO\s+category_profiles/iu.test(sql)){
   const first=statement.first.bind(statement);statement.first=async()=>{if(!raced){raced=true;f.h.sqlite.prepare('UPDATE category_profiles SET revision=revision+1 WHERE id=?').run(f.profile.id);}return first();};
  }return statement;};
  await json(await f.post(refreshRequest(f.profile,f.target)),409);assert.equal(raced,true);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) count FROM category_profiles').get().count,1);assert.equal(f.h.sqlite.prepare('SELECT revision FROM category_profiles WHERE id=?').get(f.profile.id).revision,2);
 }finally{f.h.close();}
});

test('an exact refresh retry still rejects a parent revision race after its child was created',async()=>{
 const f=await setup(schemaCompanies[0]);try{
  const key=randomUUID(),child=(await json(await f.post(refreshRequest(f.profile,f.target,key)),201)).profile,before=plain(f.h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(child.id));
  const originalPrepare=f.h.db.prepare.bind(f.h.db);let raced=false;
  f.h.db.prepare=sql=>{const statement=originalPrepare(sql);if(/INSERT\s+INTO\s+category_profiles/iu.test(sql)){
   const first=statement.first.bind(statement);statement.first=async()=>{if(!raced){raced=true;f.h.sqlite.prepare('UPDATE category_profiles SET revision=revision+1 WHERE id=?').run(f.profile.id);}return first();};
  }return statement;};
  await json(await f.post(refreshRequest(f.profile,f.target,key)),409);assert.equal(raced,true);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) count FROM category_profiles').get().count,2);assert.deepEqual(plain(f.h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(child.id)),before);
 }finally{f.h.close();}
});

test('mapping carry follows exact Hub wires through label/limit changes and rejects changed primitive/numeric identities',async()=>{
 const f=await setup(schemaCompanies[1],{generic:true});try{
  const helper=f.h.load('app/category-definition-refresh.ts'),model=f.h.load('app/quotation-schema.ts'),target=raw=>({...f.input,hubSchema:{...f.target,schemaString:JSON.stringify(raw)}}),raw=JSON.parse(f.target.schemaString);
  raw.properties.productPage.properties.basicAttributes.properties.modelNumber.title='새 이름의 같은 모델 입력';
  const renamed=target(raw),carried=helper.carryCategoryDefinitionMappings(f.input,renamed),current=model.getQuotationSchema(renamed.categoryId,renamed.categoryPath,renamed.hubSchema).fields.find(field=>field.hubWire?.path.join('.')==='productPage.basicAttributes.modelNumber');
  assert.equal(carried[1].field,current.id);assert.equal(carried[1].required,false);assert.deepEqual(plain(carried[0]),f.input.mappings[0]);assert.deepEqual(plain(carried[2]),f.input.mappings[2]);assert.equal(current.maxLength,12);
  const changedType=JSON.parse(f.target.schemaString);changedType.properties.productPage.properties.basicAttributes.properties.modelNumber={type:'number',title:'모델명'};assert.throws(()=>helper.carryCategoryDefinitionMappings(f.input,target(changedType)));
  const changedPath=JSON.parse(f.target.schemaString),properties=changedPath.properties.productPage.properties.basicAttributes.properties;properties.otherModel=properties.modelNumber;delete properties.modelNumber;assert.throws(()=>helper.carryCategoryDefinitionMappings(f.input,target(changedPath)));
  const changedNumeric=JSON.parse(f.target.schemaString),value=changedNumeric.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf[1].contains.properties.value;value.type=['number','null'];value.enum=[null,1];assert.throws(()=>helper.carryCategoryDefinitionMappings(f.input,target(changedNumeric)));
  const duplicated=JSON.parse(f.target.schemaString),items=duplicated.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf;items.push(plain(items[1]));assert.throws(()=>helper.carryCategoryDefinitionMappings(f.input,target(duplicated)));
 }finally{f.h.close();}
});

test('definition refresh preserves an unconnected source without inventing a template or file proof',async()=>{
 const h=mobileIntakeHarness(),company=schemaCompanies[0];try{
  const snapshot={...hubSchemaSnapshot(company),metadata:{displayCategoryCode:'991234',kanCategoryId:3000,scopeType:'Retail_Categorized_Single',noticeNumber:17,version:189}},input={name:'아직 원본이 없는 시험 정의',categoryId:'991234',categoryPath:schemaPath,hubSchema:snapshot,template:null,mappings:[]};
  const source=await h.load('db/category-profiles.ts').createCategoryProfile('owner',input,'unconnected-source'),before=plain(h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(source.id)),endpoint=h.load('app/api/category-profiles/[id]/refresh-definition/route.ts');
  const result=await json(await endpoint.POST(refreshRequest(source,nextSnapshot(snapshot)),{params:Promise.resolve({id:source.id})}),201);
  assert.equal(result.profile.template,null);assert.deepEqual(result.profile.mappings,[]);assert.notEqual(result.profile.id,source.id);assert.equal(h.objects.size,0);assert.deepEqual(plain(h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(source.id)),before);
 }finally{h.close();}
});

test('generic refresh rejects a stored header mismatch rather than carrying a fabricated file connection',async()=>{
 const f=await setup(schemaCompanies[1],{generic:true});try{
  const input=plain(f.input);input.template.headers[0]='원본에 없는 머리글';f.h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(input),f.profile.id);
  const before=profileRows(f.h);await json(await f.post(refreshRequest(f.profile,f.target)),400);assert.equal(profileRows(f.h),before);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) count FROM category_profiles').get().count,1);
 }finally{f.h.close();}
});

for(const company of schemaCompanies)test(`ordinary PUT cannot replace a captured definition even with valid independently rebound proof (${company.code})`,async()=>{
 const f=await setup(company,{intake:true});try{
  const before=profileRows(f.h),workBefore=workRows(f.h),connection=await f.h.load('app/official-hub-template.ts').connectOfficialWorkbookTemplate(f.bytes.buffer,f.target);
  const rebound={...f.input,hubSchema:f.target,template:{...f.input.template,...plain(connection.template)},mappings:f.input.mappings};
  assert.equal(rebound.template.workbookEvidence.sourceSchemaSha256,sha(new TextEncoder().encode(f.target.schemaString)));
  const put=input=>f.api.PUT(new Request('https://app.test/api/category-profiles',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({id:f.profile.id,expectedRevision:f.profile.revision,profile:input})}));
  await json(await put(rebound),409);await json(await put({...f.input,hubSchema:f.target}),409);
  await json(await put({...f.input,hubSchema:{...f.input.hubSchema,metadata:{...f.input.hubSchema.metadata,version:190}}}),409);
  assert.equal(profileRows(f.h),before);assert.equal(workRows(f.h),workBefore);
  const preview=await f.h.route('/api/products/'+f.product.id+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}});assert.equal(preview.status,200,await preview.clone().text());
 }finally{f.h.close();}
});

test('refresh storage and database service failures remain 503 without mutating category definitions',async()=>{
 const f=await setup(schemaCompanies[0]);try{
  const before=profileRows(f.h),get=f.h.bindings.FILES.get,prepare=f.h.db.prepare;
  f.h.bindings.FILES.get=async()=>{throw Error('fixture storage interruption');};
  await json(await f.post(refreshRequest(f.profile,f.target)),503);assert.equal(profileRows(f.h),before);f.h.bindings.FILES.get=get;
  f.h.db.prepare=()=>{throw Error('fixture database interruption');};
  await json(await f.post(refreshRequest(f.profile,f.target)),503);assert.equal(profileRows(f.h),before);f.h.db.prepare=prepare;
 }finally{f.h.close();}
});

for(const company of schemaCompanies)test(`generic refresh rejects changed original data even when stored headers and metadata still match (${company.code})`,async()=>{
 const f=await setup(company,{generic:true});try{
  const before=profileRows(f.h),template=f.profile.template,altered=new TextEncoder().encode(new TextDecoder().decode(f.bytes)+'변경된 내용,새 모델,다른 값\n');
  await f.h.bindings.FILES.put(template.storageKey,altered,{customMetadata:{sha256:template.sha256,format:template.format}});
  const response=await json(await f.post(refreshRequest(f.profile,f.target)),400);assert.match(response.error,/원본 파일의 지문이 변경/);assert.equal(profileRows(f.h),before);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) count FROM category_profiles').get().count,1);assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) count FROM products').get().count,0);
 }finally{f.h.close();}
});
