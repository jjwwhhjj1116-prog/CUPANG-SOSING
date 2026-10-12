import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {categoryPickerUI} from './helpers/category-picker.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const column=index=>{let result='';for(let value=index+1;value;value=Math.floor((value-1)/26))result=String.fromCharCode(65+(value-1)%26)+result;return result;};
const xmlRow=(number,values)=>`<row r="${number}">${values.map((value,index)=>`<c r="${column(index)}${number}" t="inlineStr"><is><t>${value.replaceAll('&','&amp;').replaceAll('<','&lt;')}</t></is></c>`).join('')}</row>`;
function workbook(){
 const headers=['상품명','카테고리','공급가','판매가','렌즈 유형','렌즈 관리방법',...Array.from({length:19},(_,index)=>'시험 선택 항목 '+index)];
 const category=schemaPath.join('>')+' (991234)',sheetName='QF_3000_시험분류';
 const sheet=`<worksheet><sheetData>${xmlRow(1,['','Retail_Categorized_Excel:Kan:3000:Notice17:Version190'])}${xmlRow(5,headers)}${xmlRow(6,headers.map((_value,index)=>index<5?'필수':'선택'))}${xmlRow(7,headers.map(()=>'작성 안내'))}${xmlRow(8,headers.map((_value,index)=>index===1?category:'예시'))}${xmlRow(9,headers.map(()=>''))}</sheetData><dataValidations><dataValidation type="list" allowBlank="true" sqref="B9:B1008"><formula1>"${category}"</formula1></dataValidation><dataValidation type="list" allowBlank="true" sqref="E9:E1008"><formula1>"해당사항없음,UV"</formula1></dataValidation></dataValidations></worksheet>`;
 return{sheetName,bytes:workbookArchive([
  ['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
  ['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',`<workbook xmlns:r="relationship"><sheets><sheet name="${sheetName}" r:id="one"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
  ['xl/worksheets/sheet1.xml',sheet],
 ])};
}

/** Actual picker, catalog client, profile/template APIs and in-memory bytes.
 * The Hub schema/workbook and a different 1688 offer are synthetic contracts. */
function harness(company){
 const api=mobileIntakeHarness({companyCode:company.code,companyName:company.name}),calls=[],modules=new Map(),file=workbook();let mode='',corruptAck=null;
 const snapshot={...hubSchemaSnapshot(company),metadata:{displayCategoryCode:'991234',categoryId:3000,scope:'Retail_Categorized_Single',productNoticeNumber:17,version:73}};
 const raw=JSON.parse(snapshot.schemaString),common=raw.properties.productPage.properties.commonAttributes;
 common.properties.purchasePrice={type:'integer',title:'공급가',minimum:1};common.properties.coupangSalePrice={type:'integer',title:'판매가',minimum:1};common.required=['purchasePrice','coupangSalePrice'];delete raw.properties.productPage.properties.price;snapshot.schemaString=JSON.stringify(raw);
 const parent={categoryId:'100',name:schemaPath[0],isLeaf:false},leaf={categoryId:snapshot.categoryId,name:schemaPath[1],isLeaf:true};
 const choice={key:'live',categoryId:leaf.categoryId,path:[...schemaPath],isLeaf:true,supplierHub:{trail:[parent],ownerId:'owner',company}};
 const branch=trail=>({source:'supplier-hub-category-api',ownerId:mode==='owner'&&trail.length?'changed-owner':'owner',company:mode==='company'?schemaCompanies.find(value=>value.code!==company.code):company,observedAt:Date.now(),fullCatalogVerified:false,trail,children:trail.length?[leaf]:mode==='path'?[{...parent,name:'다른 상위 경로'}]:[parent]});
 const request=async(url,init={})=>{
  calls.push({url,method:init.method??'GET',body:typeof init.body==='string'?JSON.parse(init.body):null});
  if(url==='/api/settings')return api.load('app/api/settings/route.ts').GET();
  if(url==='/api/category-profiles'){
   const response=await api.load('app/api/category-profiles/route.ts')[init.method??'GET'](new Request('https://app.test'+url,init));
   if(corruptAck&&init.method==='POST'&&response.ok){const body=await response.json();corruptAck(body.profile);return Response.json(body,{status:response.status});}
   return response;
  }
  if(url==='/api/category-profiles/official-template')return api.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test'+url,init));
  return api.route(url,{method:init.method??'GET',body:init.body});
 };
 const exchange=async(type,payload)=>{
  calls.push({type,payload:plain(payload)});
  if(type==='PING')return{categoryCatalog:true,categorySchema:true,categoryTemplate:true,categoryExcelSchema:true};
  const found=branch(payload.trail);
  if(type==='CATEGORIES')return{branch:found};
  if(type==='SCHEMA'){
   if(mode==='excel'&&payload.excelIdentity)throw Error('시험 Excel 상세 양식 확인 실패');
   return{branch:{...found,schema:snapshot,...(payload.excelIdentity?{excelSchema:{...snapshot,metadata:{...snapshot.metadata,scope:'Retail_Categorized_Excel',version:190}}}:{})}};
  }
  assert.equal(type,'TEMPLATE');assert.deepEqual(plain(payload.expectedSchema),{schemaString:snapshot.schemaString,metadata:snapshot.metadata});
  if(mode==='download')throw Error('시험 공식 원본 다운로드 실패');
  const sha256=Buffer.from(await crypto.subtle.digest('SHA-256',file.bytes)).toString('hex');
  return{branch:{...found,schema:snapshot,template:{format:'supplier-hub-template-v1',categoryId:leaf.categoryId,categoryPath:[...schemaPath],company,kanCategoryId:'3000',sourceUrl:'https://supplier.coupang.com/qvt/v3/kan-categories/download-quotation?leafKanCategoryIds=3000&locale=ko',observedAt:Date.now(),name:`SupplierHub-${company.code}-Kan3000.xlsx`,size:file.bytes.length,base64:Buffer.from(file.bytes).toString('base64'),sha256:mode==='bytes'?'0'.repeat(64):sha256,registered:false}}};
 };
 function load(file){
  if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {exports,Error,Date,File,FormData,TextEncoder,TextDecoder,Uint8Array,crypto,atob,btoa,fetch:request,require(name){if(name==='@/app/supplier-hub-handoff')return{exchange};if(name==='@/app/load-category-profiles')return load('app/load-category-profiles.ts');assert.ok(name.startsWith('@/'),name);return api.load(name.slice(2)+'.ts');}});return exports;
 }
 const catalog=load('app/supplier-hub-catalog.ts'),picker=categoryPickerUI(request,{catalog,workspaceOwnerId:'owner'});
 return{api,picker,calls,choice,snapshot,file,setMode(value){mode=value;},setAck(fn){corruptAck=fn;},close(){picker.close();api.close();}};
}

for(const company of schemaCompanies)test(`a new live category connects its exact official bytes before URL intake and stage-seven output (${company.code})`,async()=>{
 const h=harness(company);try{
  await h.picker.chooseLive(h.choice);assert.equal(h.picker.selected.length,1,JSON.stringify(h.picker.alerts()));const selected=h.picker.selected[0];
  assert.ok(selected.template,'the first category choice must include its official workbook without another stage-seven action');
  assert.ok(selected.mappings.length);assert.deepEqual(h.api.objects.get(selected.template.storageKey),h.file.bytes);assert.equal(selected.template.dataStartRow,9);
  assert.equal(selected.hubSchema.metadata.scope,'Retail_Categorized_Single');assert.equal(selected.hubSchema.metadata.version,73);assert.deepEqual(selected.hubSchema.company,company);
  assert.equal(h.calls.filter(call=>call.type==='TEMPLATE').length,1);assert.equal(h.calls.filter(call=>call.url==='/api/category-profiles'&&call.method==='POST').length,1);
  const sourceUrl='https://detail.1688.com/offer/625000000001.html';
  const queued=await json(await h.api.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:[sourceUrl],goal:'price',profileId:selected.id,expectedProfileRevision:selected.revision,features:'',keywords:''})})));
  const job=queued.jobs[0];assert.deepEqual(job.context.category.template,selected.template);assert.deepEqual(job.context.category.mappings,selected.mappings);assert.deepEqual(job.context.company,company);
  await json(await h.api.route(`/api/collection-jobs/${job.id}/result`,{method:'POST',body:{schemaVersion:1,sourceUrl,provider:'synthetic-local-fixture',collectedAt:new Date().toISOString(),title:'白色收纳盒',description:'收纳盒',options:[{sku:'625001',name:'White',unitPriceCny:5.5,minimumOrder:10,stock:null}],images:[],attributes:[]}}));
  await h.api.intake(job.id);const product=h.api.sqlite.prepare('SELECT * FROM products WHERE source_url=?').get(sourceUrl),base='/api/products/'+product.id;
  const content=await json(await h.api.route(base+'/content'));await json(await h.api.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.content.revision,patch:{seo:{title:'직접 검토한 시험 상품명',description:''},label:{material:''}}}}));
  const preview=await json(await h.api.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));assert.equal(preview.rows.length,1);assert.equal(preview.rows[0][0],'직접 검토한 시험 상품명');assert.equal(preview.rows[0][1],schemaPath.join('>')+' (991234)');
  const output=await h.api.route(base+'/quotation',{method:'POST',body:{action:'download',fingerprint:preview.fingerprint}});assert.equal(output.status,200,await output.clone().text());
  const reader=h.api.load('app/xlsx-template.ts'),inspection=reader.inspectXlsxArchive(await reader.readXlsxArchive(await output.arrayBuffer()));assert.equal(reader.xlsxHeaders(inspection,h.file.sheetName,9)[0],'직접 검토한 시험 상품명');
  assert.deepEqual(h.api.objects.get(selected.template.storageKey),h.file.bytes);assert.equal(product.supplier_hub_status,'미전송');assert.deepEqual(h.api.network,[]);
 }finally{h.close();}
});

test('official source failures preserve the selected leaf and cannot create an empty category configuration',async()=>{
 for(const mode of ['download','bytes','company','excel']){
  const h=harness(schemaCompanies[0]);try{
   h.setMode(mode);await h.picker.chooseLive(h.choice);assert.equal(h.picker.selected.length,0,mode+' must not open URL entry without its reviewed official connection');
   assert.equal(h.api.sqlite.prepare('SELECT COUNT(*) n FROM category_profiles').get().n,0);assert.equal(h.calls.some(call=>call.url==='/api/category-profiles'&&call.method==='POST'),false);assert.ok(h.picker.alerts().length);
   h.setMode('');await h.picker.confirm();assert.equal(h.picker.selected.length,1,JSON.stringify(h.picker.alerts()));assert.ok(h.picker.selected[0].template);
   assert.deepEqual(h.api.network,[]);
  }finally{h.close();}
 }
});

test('a saved category acknowledgement cannot silently drop or alter the exact automatic workbook or column mappings',async()=>{
 for(const corrupt of [profile=>{profile.template=null;},profile=>{profile.template.sha256='0'.repeat(64);},profile=>{profile.mappings=[];},profile=>{profile.mappings[0].field='constant';profile.mappings[0].constant='wrong';}]){
  const h=harness(schemaCompanies[0]);try{
   h.setAck(corrupt);await h.picker.chooseLive(h.choice);assert.equal(h.picker.selected.length,0,'an HTTP success alone cannot confirm the complete official source');assert.ok(h.picker.alerts().length);assert.deepEqual(h.api.network,[]);
  }finally{h.close();}
 }
});

test('matching existing custom profiles stay unchanged without an automatic replacement workbook in either company',async()=>{
 for(const company of schemaCompanies){
 const h=harness(company);try{
  const sha256=Buffer.from(await crypto.subtle.digest('SHA-256',h.file.bytes)).toString('hex'),storageKey=h.api.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');
  let template=null,mappings=[];
  {
   h.api.objects.set(storageKey,h.file.bytes);
   const reader=h.api.load('app/xlsx-template.ts'),inspection=reader.inspectXlsxArchive(await reader.readXlsxArchive(h.file.bytes.buffer));
   template={name:'직접 검토한 원본.xlsx',format:'xlsx',sha256,storageKey,sheetName:h.file.sheetName,headerRow:5,dataStartRow:9,headers:reader.xlsxHeaders(inspection,h.file.sheetName,5)};
   mappings=[{column:0,field:'constant',constant:'직접 정한 상품명',required:true},{column:1,field:'categoryId',required:false}];
  }
  const connection=await h.api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'기존 직접 연결한 설정',categoryId:'991234',categoryPath:[...schemaPath],hubSchema:{...h.snapshot,draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1',settingsInitialization:'couplus-options-v1'},template,mappings});
  const stored=JSON.stringify(h.api.sqlite.prepare('SELECT * FROM category_profiles').all()),bytes=JSON.stringify([...h.api.objects]);
  await h.picker.chooseLive(h.choice);assert.equal(h.picker.selected.length,1,JSON.stringify(h.picker.alerts()));assert.equal(h.picker.selected[0].id,connection.id);assert.deepEqual(plain(h.picker.selected[0].template),plain(connection.template));assert.deepEqual(plain(h.picker.selected[0].mappings),plain(connection.mappings));assert.equal(h.picker.selected[0].revision,connection.revision);
  assert.equal(h.calls.some(call=>call.type==='TEMPLATE'||call.url==='/api/category-profiles'&&call.method!=='GET'),false);assert.equal(JSON.stringify(h.api.sqlite.prepare('SELECT * FROM category_profiles').all()),stored);assert.equal(JSON.stringify([...h.api.objects]),bytes);
 }finally{h.close();}
 }
});

test('equivalent official ACK object order still confirms the exact workbook and mappings',async()=>{
 const h=harness(schemaCompanies[0]);try{
  const reverse=value=>Object.fromEntries(Object.entries(value).reverse());
  h.setAck(profile=>{profile.template=reverse(profile.template);profile.mappings=profile.mappings.map(reverse);});
  await h.picker.chooseLive(h.choice);assert.equal(h.picker.selected.length,1,JSON.stringify(h.picker.alerts()));assert.ok(h.picker.selected[0].template);assert.deepEqual(h.api.objects.get(h.picker.selected[0].template.storageKey),h.file.bytes);
 }finally{h.close();}
});

const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
async function chooseSaved(h,profile){
 h.picker.setProps({profiles:[profile],selectedId:profile.id});
 const select=nodes(h.picker.render()).find(node=>node.type==='select'&&nodes(node).some(child=>child.type==='option'&&child.props.children==='저장한 설정 선택'));
 assert.ok(select);select.props.onChange({target:{value:profile.id}});await h.picker.confirm();
}
for(const company of schemaCompanies)for(const via of ['live','saved'])test(`an empty saved Hub connection prepares a separate official selection without altering the old capture (${company.code}, ${via})`,async()=>{
 const h=harness(company);try{
  const source=await h.api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'작업 중인 기존 빈 설정',categoryId:'991234',categoryPath:[...schemaPath],hubSchema:{...h.snapshot,draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1',settingsInitialization:'couplus-options-v1'},template:null,mappings:[]});
  const sourceUrl='https://detail.1688.com/offer/627000000001.html';
  const queued=await json(await h.api.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:[sourceUrl],goal:'price',profileId:source.id,expectedProfileRevision:source.revision,features:'보존할 기존 입력',keywords:''})})));
  const original=JSON.stringify(h.api.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(source.id)),captures=JSON.stringify(h.api.sqlite.prepare('SELECT * FROM collection_context ORDER BY job_id').all()),products=JSON.stringify(h.api.sqlite.prepare('SELECT * FROM products ORDER BY id').all());
  if(via==='live')await h.picker.chooseLive(h.choice);else await chooseSaved(h,source);
  assert.equal(h.picker.selected.length,1,JSON.stringify(h.picker.alerts()));const selected=h.picker.selected[0];
  assert.ok(selected.template,'a selected Hub category must prepare its missing official workbook before URL entry');assert.notEqual(selected.id,source.id,'the old working profile must remain frozen');assert.equal(selected.revision,1);
  assert.ok(selected.mappings.length);assert.deepEqual(h.api.objects.get(selected.template.storageKey),h.file.bytes);assert.deepEqual(plain(selected.hubSchema.company),company);
  assert.equal(JSON.stringify(h.api.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(source.id)),original);assert.equal(JSON.stringify(h.api.sqlite.prepare('SELECT * FROM collection_context ORDER BY job_id').all()),captures);assert.equal(JSON.stringify(h.api.sqlite.prepare('SELECT * FROM products ORDER BY id').all()),products);
  assert.equal(queued.jobs[0].context.category.template,null);assert.equal(h.calls.some(call=>call.url==='/api/category-profiles'&&call.method==='PUT'),false);assert.equal(h.calls.filter(call=>call.type==='TEMPLATE').length,1);assert.deepEqual(h.api.network,[]);
  // A subsequent explicit live selection should reuse the one completed form,
  // rather than ask about the old empty sibling or create another workbook.
  h.picker.reopen();await h.picker.chooseLive(h.choice);assert.equal(h.picker.selected.at(-1).id,selected.id,JSON.stringify(h.picker.alerts()));assert.equal(h.calls.filter(call=>call.type==='TEMPLATE').length,1);assert.equal(h.calls.filter(call=>call.url==='/api/category-profiles'&&call.method==='POST').length,1);
 }finally{h.close();}
});

for(const company of schemaCompanies)test(`a live category selection supersedes only an unverified empty manual choice for new URL intake (${company.code})`,async()=>{
 const h=harness(company);try{
  const source=await h.api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'기존 수동 코드 설정',categoryId:'991234',categoryPath:[...schemaPath],template:null,mappings:[]});
  const original=JSON.stringify(h.api.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(source.id));
  await chooseSaved(h,source);assert.equal(h.picker.selected[0].id,source.id);assert.equal(h.picker.selected[0].template,null);assert.equal(h.calls.some(call=>call.type==='TEMPLATE'||call.type==='SCHEMA'),false,'manual codes never fabricate official evidence');
  h.picker.reopen();await h.picker.chooseLive(h.choice);const selected=h.picker.selected.at(-1);assert.notEqual(selected.id,source.id);assert.ok(selected.template);assert.ok(selected.mappings.length);
  assert.equal(JSON.stringify(h.api.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(source.id)),original);
  const sourceUrl='https://detail.1688.com/offer/627000000002.html',queued=await json(await h.api.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({urls:[sourceUrl],goal:'price',profileId:selected.id,expectedProfileRevision:selected.revision,features:'수동 상품 특징',keywords:'직접 검색어'})})));
  const job=queued.jobs[0];assert.equal(job.context.category.id,selected.id);assert.deepEqual(plain(job.context.category.template),plain(selected.template));assert.deepEqual(plain(job.context.category.mappings),plain(selected.mappings));assert.deepEqual(plain(job.context.company),company);
  await json(await h.api.route(`/api/collection-jobs/${job.id}/result`,{method:'POST',body:{schemaVersion:1,sourceUrl,provider:'synthetic-local-fixture',collectedAt:new Date().toISOString(),title:'수집한 시험 상품',description:'수집한 설명',options:[{sku:'627002',name:'수집한 옵션',unitPriceCny:5.5,minimumOrder:10,stock:null}],images:[],attributes:[]}}));
  h.api.bindings.AI.run=async(_model,input)=>{const source=JSON.parse(input.messages[1].content);h.api.aiSources.push(source);return{response:{title:source.title,description:source.description,keywords:['시험 상품'],warnings:[],attributes:source.attributes.map((pair,sourceIndex)=>({...pair,sourceIndex}))}};};
  await h.api.intake(job.id);const product=h.api.sqlite.prepare('SELECT * FROM products WHERE source_url=?').get(sourceUrl),view=await json(await h.api.route('/api/products/'+product.id+'/quotation-fields'));
  assert.equal(view.categoryContext.profileId,selected.id);assert.equal(view.resolved.schema.categoryId,selected.categoryId);assert.deepEqual(plain(view.resolved.schema.categoryPath),schemaPath);assert.ok(view.resolved.rows.some(row=>Object.values(row.fields).some(field=>field.value==='수집한 시험 상품')));
  assert.equal(view.resolved.rows[0].fields.brand.value,job.context.settings.brand);
  const price=h.api.load('app/pricing.ts').calculatePrice(5.5,job.context.settings),options=await json(await h.api.route('/api/products/'+product.id+'/options'));
  assert.equal(product.supply_price,price.supplyPrice);assert.equal(product.sale_price,price.salePrice);assert.equal(options.options.rows[0].supplierSku,'627002');assert.equal(options.options.rows[0].unitCostCny,5.5);assert.deepEqual(h.api.network,[]);
 }finally{h.close();}
});

for(const company of schemaCompanies)test(`a failed saved empty connection keeps the old profile and selection available for retry (${company.code})`,async()=>{
 for(const mode of ['download','bytes','company','excel','path','owner']){
  const h=harness(company);try{
   const source=await h.api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'보존할 빈 설정',categoryId:'991234',categoryPath:[...schemaPath],hubSchema:h.snapshot,template:null,mappings:[]}),original=JSON.stringify(h.api.sqlite.prepare('SELECT * FROM category_profiles').all());
   h.setMode(mode);await chooseSaved(h,source);assert.equal(h.picker.selected.length,0,mode);assert.ok(h.picker.alerts().length,mode);assert.equal(JSON.stringify(h.api.sqlite.prepare('SELECT * FROM category_profiles').all()),original);assert.equal(h.calls.some(call=>call.url==='/api/category-profiles'&&call.method!=='GET'),false,mode);
   h.setMode('');await h.picker.confirm();assert.equal(h.picker.selected.length,1,JSON.stringify(h.picker.alerts()));assert.ok(h.picker.selected[0].template);assert.notEqual(h.picker.selected[0].id,source.id);assert.deepEqual(h.api.network,[]);
  }finally{h.close();}
 }
});

test('preparing an empty connection verifies its new identity, version, exact schema, workbook and mappings before selection',async()=>{
 for(const mutate of [(profile,source)=>{profile.id=source.id;},profile=>{profile.revision=2;},profile=>{profile.name='다른 설정';},profile=>{profile.template=null;},profile=>{profile.mappings=[];},profile=>{profile.hubSchema.metadata.version=74;},profile=>{delete profile.hubSchema.settingsInitialization;}]){
  const h=harness(schemaCompanies[0]);try{
   const source=await h.api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'기존',categoryId:'991234',categoryPath:[...schemaPath],hubSchema:h.snapshot,template:null,mappings:[]}),original=JSON.stringify(h.api.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(source.id));
   h.setAck(profile=>mutate(profile,source));await h.picker.chooseLive(h.choice);assert.equal(h.picker.selected.length,0);assert.ok(h.picker.alerts().length);assert.equal(JSON.stringify(h.api.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(source.id)),original);assert.deepEqual(h.api.network,[]);
  }finally{h.close();}
 }
});
