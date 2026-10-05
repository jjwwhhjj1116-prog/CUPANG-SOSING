import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {categoryPickerUI} from './helpers/category-picker.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';

const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const column=index=>{let result='';for(let value=index+1;value;value=Math.floor((value-1)/26))result=String.fromCharCode(65+(value-1)%26)+result;return result;};
const row=(number,values)=>`<row r="${number}">${values.map((value,index)=>`<c r="${column(index)}${number}" t="inlineStr"><is><t>${value.replaceAll('&','&amp;').replaceAll('<','&lt;')}</t></is></c>`).join('')}</row>`;
// A synthetic official-layout contract, not a real supplier workbook or a
// decision that the recorded sunglasses belong in this test category.
function fixtureWorkbook(){
 const headers=['상품명','카테고리','공급가','판매가','렌즈 유형','렌즈 관리방법',...Array.from({length:19},(_,index)=>'시험 선택 항목 '+index)];
 const category=schemaPath.join('>')+' (991234)',sheetName='QF_3000_시험분류';
 const sheet=`<worksheet><sheetData>${row(1,['','Retail_Categorized_Excel:Kan:3000:Notice17:Version190'])}${row(5,headers)}${row(6,headers.map((_value,index)=>index<5?'필수':'선택'))}${row(7,headers.map(()=>'작성 안내'))}${row(8,headers.map((_value,index)=>index===1?category:'예시'))}${row(9,headers.map(()=>''))}</sheetData><dataValidations><dataValidation type="list" allowBlank="true" sqref="B9:B1008"><formula1>"${category}"</formula1></dataValidation><dataValidation type="list" allowBlank="true" sqref="E9:E1008"><formula1>"해당사항없음,UV"</formula1></dataValidation></dataValidations></worksheet>`;
 return {sheetName,bytes:workbookArchive([
  ['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
  ['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',`<workbook xmlns:r="relationship"><sheets><sheet name="${sheetName}" r:id="one"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],['xl/worksheets/sheet1.xml',sheet],
 ])};
}
function harness(api){
 const calls=[],downloads=[],modules=new Map(),slots=[],effects=[];let cursor=0,mode='',productId='',downloadBlob;
 const snapshot={...hubSchemaSnapshot(schemaCompanies.find(company=>company.code==='A01464742')),metadata:{displayCategoryCode:'991234',categoryId:3000,scope:'Retail_Categorized_Single',productNoticeNumber:17,version:73}};
 // Use the observed price paths consumed by current captured input rules;
 // the generic legacy helper also supports unrelated same-label price fields.
 const raw=JSON.parse(snapshot.schemaString),common=raw.properties.productPage.properties.commonAttributes;
 common.properties.purchasePrice={type:'integer',title:'공급가',minimum:1};common.properties.coupangSalePrice={type:'integer',title:'판매가',minimum:1};
 common.required=['purchasePrice','coupangSalePrice'];delete raw.properties.productPage.properties.price;snapshot.schemaString=JSON.stringify(raw);
 const parent={categoryId:'100',name:schemaPath[0],isLeaf:false},leaf={categoryId:snapshot.categoryId,name:schemaPath[1],isLeaf:true},workbook=fixtureWorkbook();
 const choice={key:'live',categoryId:snapshot.categoryId,path:schemaPath,isLeaf:true,supplierHub:{trail:[parent],ownerId:'owner',company:snapshot.company}};
 const branch=trail=>({source:'supplier-hub-category-api',ownerId:'owner',company:mode==='company'?schemaCompanies.find(company=>company.code!==snapshot.company.code):snapshot.company,observedAt:Date.now(),fullCatalogVerified:false,trail,children:trail.length?[leaf]:mode==='ambiguous'?[parent,{...parent,categoryId:'101'}]:mode==='missing'?[]:[parent]});
 const request=async(url,init={})=>{
  calls.push({url,method:init.method??'GET',body:typeof init.body==='string'?JSON.parse(init.body):undefined});
  if(mode==='http-list'&&url==='/api/category-profiles'&&!init.method||mode==='http-template'&&url==='/api/category-profiles/official-template'||mode==='http-link'&&url==='/api/category-profiles'&&init.method==='PUT')return new Response('<!DOCTYPE html><html>PRIVATE_ACCESS_TOKEN_AND_BODY</html>',{status:mode==='http-list'?503:mode==='http-link'?502:200,headers:{'content-type':'text/html'}});
  if(url==='/api/category-profiles')return api.load('app/api/category-profiles/route.ts')[init.method??'GET'](new Request('https://app.test'+url,init));
  if(url==='/api/category-profiles/official-template')return api.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test'+url,init));
  return api.route(url,{method:init.method??'GET',body:init.body});
 };
 const exchange=async(type,payload)=>{
  calls.push({type,payload});
  if(type==='PING')return{categoryCatalog:true,categorySchema:true,categoryTemplate:true,...(mode==='workbook-only'?{}:{categoryExcelSchema:true})};
  const found=branch(payload.trail);
  if(type==='CATEGORIES')return{branch:found};
  const schema=mode==='schema'?{...snapshot,metadata:{...snapshot.metadata,version:191}}:snapshot;
  if(type==='SCHEMA'){if(mode==='excel'&&payload.excelIdentity)throw Error('별도 Excel 상세 양식 조회 실패');return{branch:{...found,schema,...(payload.excelIdentity?{excelSchema:{...snapshot,metadata:{...snapshot.metadata,scope:'Retail_Categorized_Excel',version:190}}}:{})}};}
  assert.equal(type,'TEMPLATE');assert.deepEqual(plain(payload.expectedSchema),{schemaString:snapshot.schemaString,metadata:snapshot.metadata});
  if(mode==='download')throw Error('공식 원본 다운로드 실패');
  const bytes=workbook.bytes;
  return{branch:{...found,schema,template:{format:'supplier-hub-template-v1',categoryId:snapshot.categoryId,categoryPath:schemaPath,company:snapshot.company,kanCategoryId:'3000',sourceUrl:'https://supplier.coupang.com/qvt/v3/kan-categories/download-quotation?leafKanCategoryIds=3000&locale=ko',observedAt:Date.now(),name:`SupplierHub-${snapshot.company.code}-Kan3000.xlsx`,size:bytes.length,base64:Buffer.from(bytes).toString('base64'),sha256:Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),registered:false}}};
 };
 const Editor=()=>null;
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j]))){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
 function load(file){
  if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,Error,Date,AbortController,File,FormData,TextEncoder,TextDecoder,Uint8Array,crypto,atob,btoa,fetch:request,setTimeout:fn=>fn(),URL:{createObjectURL(blob){downloadBlob=blob;return'blob:fixture';},revokeObjectURL(){}},document:{createElement(){return{click(){downloads.push({name:this.download,blob:downloadBlob});}};}},require(name){
    if(name==='react')return hooks;
    if(name==='@/app/supplier-hub-handoff')return{exchange};
    if(name==='@/app/components/quotation-fields-editor')return{QuotationFieldsEditor:Editor};
    if(name.startsWith('@/app/components/'))return new Proxy({},{get:()=>()=>null});
    if(name==='@/app/load-category-profiles'||name==='@/app/supplier-hub-catalog')return load(name.slice(2)+'.ts');
    if(name.startsWith('@/'))return api.load(name.slice(2)+'.ts');
    return native(name);
   }});return exports;
 }
 const catalog=load('app/supplier-hub-catalog.ts'),Panel=load('app/components/quotation-panel.tsx').QuotationPanel;
 const render=()=>{cursor=0;const outer=Panel({productId,onManageCategories(){}}),tree=outer.type(outer.props);effects.splice(0).forEach(effect=>effect());return tree;};
 const settle=async()=>{const deadline=Date.now()+5000;for(let i=0;i<16||nodes(render()).some(node=>node.props?.['aria-busy']);i++){if(Date.now()>deadline)throw Error('Quotation request timeout');await new Promise(resolve=>setTimeout(resolve,1));render();}};
 return {calls,downloads,catalog,choice,snapshot,workbook,request,Editor,render,settle,setMode(value){mode=value;},async open(id){productId=id;render();await settle();},button(label){return nodes(render()).find(node=>node.type==='button'&&node.props.children===label);},close(){slots.forEach(slot=>slot?.cleanup?.());}};
}

test('live category enters URL drafts without XLSX, then explicit stage 7 preparation preserves frozen/manual values and produces the official workbook',async()=>{
 const api=mobileIntakeHarness(),ui=harness(api);try{
  ui.setMode('download');
  const picker=categoryPickerUI(ui.request,{catalog:ui.catalog});await picker.chooseLive(ui.choice);
  assert.equal(picker.selected.length,1,JSON.stringify(picker.alerts()));const selected=picker.selected[0];
  assert.equal(selected.template,null);assert.deepEqual(selected.mappings,[]);assert.equal(ui.calls.some(call=>call.type==='TEMPLATE'),false);
  assert.equal(selected.hubSchema.metadata.scope,'Retail_Categorized_Single');assert.equal(selected.hubSchema.metadata.version,73);
  api.context.category=selected;api.sqlite.prepare("UPDATE collection_context SET payload=? WHERE job_id='job'").run(JSON.stringify(api.context));
  await api.intake();const product=api.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  assert.equal(product.options_count,6);assert.equal(JSON.parse(product.image_keys).length,19);assert.equal(api.aiSources.length,1);
  let content=JSON.parse(api.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  await json(await api.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'직접 검토한 상품명',description:''},label:{material:''}}}}));
  let view=await json(await api.route(base+'/quotation-fields'));const lens=view.resolved.schema.fields.find(field=>field.label==='렌즈 유형'),notice=view.resolved.schema.fields.find(field=>field.label==='렌즈 관리방법');
  await json(await api.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:lens.id,optionId:null,value:'UV'},{fieldKey:notice.id,optionId:'collected-2',value:''}]}}));
  const retained=()=>JSON.stringify({product:api.sqlite.prepare('SELECT * FROM products').get(),content:api.sqlite.prepare('SELECT * FROM product_content').get(),options:api.sqlite.prepare('SELECT * FROM product_options').get(),fields:api.sqlite.prepare('SELECT * FROM product_quotation_fields').get(),context:api.sqlite.prepare('SELECT * FROM collection_context').get()});
  const before=retained();await ui.open(product.id);const prepare=ui.button('공식 견적 양식 준비');assert.ok(prepare&&!prepare.props.disabled);
  prepare.props.onClick();await ui.settle();assert.match(JSON.stringify(ui.render()),/공식 원본 다운로드 실패/);assert.equal(retained(),before);assert.equal((await api.load('db/category-profiles.ts').getCategoryProfile('owner',selected.id)).template,null);
  ui.setMode('');ui.button('공식 견적 양식 준비').props.onClick();await ui.settle();
  const saved=await api.load('db/category-profiles.ts').getCategoryProfile('owner',selected.id);
  assert.equal(saved.revision,selected.revision+1,JSON.stringify(nodes(ui.render()).filter(node=>node.props?.role==='alert')));assert.ok(saved.template);assert.deepEqual(plain(saved.hubSchema),selected.hubSchema);assert.equal(retained(),before);
  assert.equal(ui.button('공식 견적 양식 준비'),undefined,JSON.stringify(nodes(ui.render()).filter(node=>node.props?.role==='alert')));assert.equal(ui.button('견적 자료 검토').props.disabled,false);
  const source=await api.load('app/exports/quotation-source.ts').readMappedQuotationSource('owner',product.id,selected.id),resolved=api.load('app/exports/quotation-source.ts').resolveQuotationExport(source);
  const rows=api.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source,resolved,[]);
  const output=await api.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:ui.workbook.bytes.buffer,profile:source.profile,rows,dataStartRow:9});
  assert.equal(output.values.length,6);assert.equal(output.report.validationIssues.length,0);
  for(const [index,row]of output.values.entries()){assert.equal(row[0],'직접 검토한 상품명');assert.equal(row[1],schemaPath.join('>')+' (991234)');assert.equal(row[4],'UV');assert.equal(row[5],index===1?'':'해당사항없음');}
  const reader=api.load('app/xlsx-template.ts'),inspection=reader.inspectXlsxArchive(await reader.readXlsxArchive(output.bytes.buffer));
  assert.equal(reader.xlsxHeaders(inspection,ui.workbook.sheetName,10)[5],'');assert.deepEqual(api.objects.get(saved.template.storageKey),ui.workbook.bytes);
  assert.equal(product.supplier_hub_status,'미전송');assert.ok(!api.network.includes('supplier.coupang.com'));assert.equal(api.aiSources.length,1);
 }finally{ui.close();api.close();}
});

test('official preparation rejects changed company, ambiguous/missing exact paths and changed schema without replacing saved work',async()=>{
 const api=mobileIntakeHarness(),ui=harness(api);try{
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'시험',categoryId:ui.snapshot.categoryId,categoryPath:schemaPath,hubSchema:ui.snapshot,template:null,mappings:[]});
  const before=JSON.stringify(api.sqlite.prepare('SELECT * FROM category_profiles').all());
  for(const preparation of ['schema','workbook'])for(const mode of ['company','ambiguous','missing','schema']){
   ui.setMode(mode);ui.calls.length=0;await assert.rejects(ui.catalog.prepareOfficialHubProfileTemplate(profile,new AbortController().signal,preparation));
   assert.equal(ui.calls.some(call=>call.type==='TEMPLATE'||call.method==='PUT'||call.method==='POST'),false,mode);
   assert.equal(JSON.stringify(api.sqlite.prepare('SELECT * FROM category_profiles').all()),before);
  }
  ui.setMode('');const controller=new AbortController();controller.abort();ui.calls.length=0;
  await assert.rejects(ui.catalog.prepareOfficialHubProfileTemplate(profile,controller.signal));assert.equal(ui.calls.length,0);
  const changed=await api.load('db/category-profiles.ts').updateCategoryProfile('owner',profile.id,profile.revision,{...profile,name:'다른 화면의 수동 설정'});
  await assert.rejects(ui.catalog.prepareOfficialHubProfileTemplate(profile,new AbortController().signal),/변경/);
  assert.equal((await api.load('db/category-profiles.ts').getCategoryProfile('owner',profile.id)).name,changed.name);
 }finally{ui.close();api.close();}
});

test('explicit workbook mode uses existing TEMPLATE after Excel failure and downloads edited XLSX without a fallback or submission',async()=>{
 const api=mobileIntakeHarness(),ui=harness(api);try{
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'파일 근거 시험',categoryId:ui.snapshot.categoryId,categoryPath:schemaPath,hubSchema:ui.snapshot,template:null,mappings:[]});
  api.context.category=profile;api.sqlite.prepare("UPDATE collection_context SET payload=? WHERE job_id='job'").run(JSON.stringify(api.context));await api.intake();
  const product=api.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const content=(await json(await api.route(base+'/content'))).content;
  await json(await api.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'파일 연결 전에 저장한 제목',description:''},label:{material:''}}}}));
  const retained=()=>JSON.stringify(['products','product_options','product_content','product_quotation_fields','collection_context'].map(table=>api.sqlite.prepare('SELECT * FROM '+table).all())),before=retained();
  await ui.open(product.id);ui.setMode('excel');ui.button('공식 견적 양식 준비').props.onClick();await ui.settle();
  assert.match(JSON.stringify(ui.render()),/별도 Excel 상세 양식 조회 실패/);assert.equal((await api.load('db/category-profiles.ts').getCategoryProfile('owner',profile.id)).template,null);assert.equal(ui.calls.filter(call=>call.method==='PUT').length,0);
  ui.setMode('workbook-only');ui.calls.length=0;ui.button('공식 파일 기준으로 연결').props.onClick();await ui.settle();
  const saved=await api.load('db/category-profiles.ts').getCategoryProfile('owner',profile.id);assert.ok(saved.template,JSON.stringify(ui.render()));
  assert.equal(saved.template.workbookEvidence.excelSchemaVerified,false);assert.equal(saved.template.workbookEvidence.version,'190');assert.equal(saved.hubSchema.metadata.version,73);assert.equal(saved.template.workbookEvidence.templateSha256,saved.template.sha256);
  const categories=api.load('app/api/category-profiles/route.ts'),evidence=saved.template.workbookEvidence;
  for(const patch of [{version:'189'},{sourceSchemaSha256:'0'.repeat(64)},{companyCode:'A01526306'},{excelSchemaVerified:true},{unverifiedExtra:true}]){
   await json(await categories.PUT(new Request('https://app.test/api/category-profiles',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({id:saved.id,expectedRevision:saved.revision,profile:{...saved,template:{...saved.template,workbookEvidence:{...evidence,...patch}}}})})),400);
  }
  assert.equal((await api.load('db/category-profiles.ts').getCategoryProfile('owner',profile.id)).revision,saved.revision,'file/Single evidence cannot be forged on later save');
  assert.equal(ui.calls.filter(call=>call.type==='TEMPLATE').length,1);assert.ok(ui.calls.some(call=>call.type==='SCHEMA'));assert.equal(ui.calls.some(call=>call.payload?.excelIdentity),false);assert.equal(retained(),before);
  ui.button('견적 자료 검토').props.onClick();await ui.settle();assert.ok(ui.button('채운 견적서 파일 다운로드'),JSON.stringify(ui.render()));
  ui.button('채운 견적서 파일 다운로드').props.onClick();await ui.settle();assert.equal(ui.downloads.length,1,JSON.stringify(ui.render()));assert.match(ui.downloads[0].name,/\.xlsx$/);
  const reader=api.load('app/xlsx-template.ts'),inspection=reader.inspectXlsxArchive(await reader.readXlsxArchive(await ui.downloads[0].blob.arrayBuffer()));
  for(let row=9;row<15;row++)assert.equal(reader.xlsxHeaders(inspection,ui.workbook.sheetName,row)[0],'파일 연결 전에 저장한 제목');
  assert.deepEqual(api.objects.get(saved.template.storageKey),ui.workbook.bytes);assert.equal(retained(),before);assert.equal(api.aiSources.length,1);
  assert.equal(ui.calls.some(call=>['PREPARE','TRANSMIT','REGISTRATION'].includes(call.type)),false);assert.equal(product.supplier_hub_status,'미전송');
 }finally{ui.close();api.close();}
});

test('official workbook UI identifies the failed app HTTP step without exposing HTML or changing saved drafts',async()=>{
 const api=mobileIntakeHarness(),ui=harness(api);try{
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'응답 진단 시험',categoryId:ui.snapshot.categoryId,categoryPath:schemaPath,hubSchema:ui.snapshot,template:null,mappings:[]});
  api.context.category=profile;api.sqlite.prepare("UPDATE collection_context SET payload=? WHERE job_id='job'").run(JSON.stringify(api.context));await api.intake();
  const product=api.sqlite.prepare('SELECT * FROM products').get(),retained=()=>JSON.stringify(['products','product_options','product_content','product_quotation_fields','collection_context','category_profiles'].map(table=>api.sqlite.prepare('SELECT * FROM '+table).all())),before=retained();
  await ui.open(product.id);
  for(const [mode,stage,status]of [['http-list','카테고리 목록 조회',503],['http-template','공식 Excel 원본 저장',200],['http-link','공식 견적 양식 연결 저장',502]]){
   ui.setMode(mode);ui.calls.length=0;ui.button('공식 파일 기준으로 연결').props.onClick();await ui.settle();const rendered=JSON.stringify(ui.render());
   assert.ok(rendered.includes(stage),rendered);assert.ok(rendered.includes('HTTP '+status));assert.match(rendered,/HTML 응답/);assert.doesNotMatch(rendered,/PRIVATE_ACCESS_TOKEN|DOCTYPE|Unexpected token/);
   assert.equal(retained(),before);assert.equal(ui.button('공식 파일 기준으로 연결').props.disabled,false);
   if(mode!=='http-link')assert.equal(ui.calls.some(call=>call.method==='PUT'),false);
  }
 }finally{ui.close();api.close();}
});
