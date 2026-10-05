import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {readSupplierHubTemplate} from '../extensions/supplier-hub/template-page.mjs';
import {readAppSupplierHubCatalog} from '../extensions/supplier-hub/catalog.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const h=mobileIntakeHarness();test.after(()=>h.close());
const encode=value=>new TextEncoder().encode(value);
const column=index=>{let out='';for(let n=index+1;n;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
const escape=text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;');
const row=(number,values)=>`<row r="${number}">${values.map((value,index)=>`<c r="${column(index)}${number}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')}</row>`;
/** Synthetic OOXML contract fixture; not an authenticated workbook or a seller category decision. */
function workbook({kan='3000',version='190',notice='17',category='991234',path=schemaPath,duplicate=false,broken=false,duplicateDropdown=false}={}){
 const headers=['상품명','카테고리','공급가','판매가','렌즈 유형','렌즈 관리방법',...Array.from({length:19},(_,index)=>'시험 선택 항목 '+index)];
 const categoryValue=path.join('>')+` (${category})`,sheetName=`QF_${kan}_시험분류`;
 const sheet=`<worksheet><sheetData>${row(1,['',`Retail_Categorized_Excel:Kan:${kan}:Notice${notice}:Version${version}`])}${row(5,headers)}${row(6,headers.map((_value,index)=>broken?'unknown':index<5?'필수':'선택'))}${row(7,headers.map(()=> '작성 안내'))}${row(8,headers.map((_value,index)=>index===1?categoryValue:'예시'))}${row(9,headers.map(()=>''))}</sheetData><dataValidations count="2"><dataValidation type="list" allowBlank="true" sqref="B9:B1008"><formula1>"${categoryValue}${duplicateDropdown?',다른경로 ('+category+')':''}"</formula1></dataValidation><dataValidation type="list" allowBlank="true" sqref="E9:E1008"><formula1>"해당사항없음,UV"</formula1></dataValidation></dataValidations></worksheet>`;
 const entries=[['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',`<workbook xmlns:r="relationship"><sheets><sheet name="${sheetName}" r:id="one"/>${duplicate?`<sheet name="${sheetName}_두번째" r:id="two"/>`:''}</sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels',`<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/>${duplicate?'<Relationship Id="two" Type="x/worksheet" Target="worksheets/sheet2.xml"/>':''}</Relationships>`],['xl/worksheets/sheet1.xml',sheet],...(duplicate?[['xl/worksheets/sheet2.xml',sheet]]:[])];
 return {bytes:workbookArchive(entries),headers,sheetName};
}
function snap(company=schemaCompanies[0]){return {...hubSchemaSnapshot(company),metadata:{displayCategoryCode:'991234',categoryId:3000,scope:'Retail_Categorized_Excel',productNoticeNumber:17,version:190}};}
async function download(snapshot,bytes){return {format:'supplier-hub-template-v1',categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,company:snapshot.company,kanCategoryId:'3000',sourceUrl:'https://supplier.coupang.com/qvt/v3/kan-categories/download-quotation?leafKanCategoryIds=3000&locale=ko',observedAt:Date.now(),name:`SupplierHub-${snapshot.company.code}-Kan3000.xlsx`,size:bytes.length,base64:Buffer.from(bytes).toString('base64'),sha256:Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),registered:false};}
function page(snapshot,bytes,{response,after,path='/qvt/registration'}={}){
 const calls=[],document={body:{innerText:'Company Code: '+snapshot.company.code}},location={origin:'https://supplier.coupang.com',pathname:path};
 return {calls,run:()=>vm.runInNewContext(`(${readSupplierHubTemplate.toString()})(snapshot)`,{snapshot,document,location,Date,crypto,btoa,AbortController,setTimeout,clearTimeout,TextEncoder,Uint8Array,fetch:async(url,init)=>{calls.push({url,...init});const r=response?response(url):new Response(bytes,{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});Object.defineProperty(r,'url',{value:url});after?.(document,location);return r;}})};
}
test('official workbook GET uses schema kan ID rather than display code, in the existing approved company page',async()=>{
 for(const company of schemaCompanies){const snapshot=snap(company),bytes=workbook().bytes,p=page(snapshot,bytes),result=await p.run();
  assert.equal(result.sourceUrl,'https://supplier.coupang.com/qvt/v3/kan-categories/download-quotation?leafKanCategoryIds=3000&locale=ko');assert.equal(result.categoryId,'991234');assert.equal(result.kanCategoryId,'3000');assert.deepEqual(plain(result.company),company);assert.equal(result.base64,Buffer.from(bytes).toString('base64'));assert.equal(result.sha256,(await download(snapshot,bytes)).sha256);assert.equal(result.registered,false);
  assert.equal(p.calls.length,1);assert.equal(p.calls[0].method,'GET');assert.equal(p.calls[0].body,undefined);assert.equal(p.calls[0].redirect,'error');assert.equal(p.calls[0].credentials,'same-origin');
 }
});
test('missing/conflicting kan IDs, login HTML, bad ZIP/oversize and company/navigation changes do not return a workbook',async()=>{
 const snapshot=snap(),bytes=workbook().bytes;
 for(const meta of [{},{...snapshot.metadata,kanCategoryId:3001},{...snapshot.metadata,categoryId:'0'}]){const p=page({...snapshot,metadata:meta},bytes);await assert.rejects(p.run());assert.equal(p.calls.length,0);}
 for(const config of [{path:'/login'},{after:doc=>{doc.body.innerText='Company Code: A01526306';}},{after:(_doc,location)=>{location.pathname='/settings';}},{response:()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}})},{response:()=>new Response(bytes,{status:401})},{response:()=>new Response('fake workbook',{headers:{'content-type':'application/octet-stream'}})},{response:()=>new Response(bytes,{headers:{'content-type':'application/octet-stream','content-length':'5000001'}})},{response:()=>new Response(new Uint8Array(5000001),{headers:{'content-type':'application/octet-stream'}})}])await assert.rejects(page(snapshot,bytes,config).run());
});
test('official connection verifies unique raw category dropdown/path, kan, notice/version and entry rows',async()=>{
 const service=h.load('app/official-hub-template.ts'),snapshot=snap(),original=workbook(),result=await service.connectOfficialHubTemplate(original.bytes.buffer,snapshot);
 assert.equal(result.template.sheetName,original.sheetName);assert.equal(result.template.headerRow,5);assert.equal(result.template.dataStartRow,9);assert.equal(result.report.kanCategoryId,'3000');assert.equal(result.report.categoryValue,schemaPath.join('>')+' (991234)');assert.equal(result.report.registered,false);
 assert.equal(result.mappings.find(mapping=>mapping.column===4).choiceFormat,'label');assert.match(result.mappings.find(mapping=>mapping.column===4).field,/^live_991234_/);
 for(const change of [{kan:'991234'},{version:'191'},{notice:'18'},{category:'991235'},{path:['같은 이름의 다른 경로',schemaPath[1]]},{duplicate:true},{broken:true},{duplicateDropdown:true}])await assert.rejects(service.connectOfficialHubTemplate(workbook(change).bytes.buffer,snapshot));
 await assert.rejects(service.connectOfficialHubTemplate(original.bytes.buffer,{...snapshot,metadata:{...snapshot.metadata,scope:'OTHER'}}));
});
test('template dispatcher verifies live leaf, unchanged schema and app member before returning the same-window workbook',async()=>{
 const parent={categoryId:'100',name:schemaPath[0],isLeaf:false},leaf={categoryId:'991234',name:schemaPath[1],isLeaf:true};
 for(const company of schemaCompanies){const snapshot=snap(company),template=await download(snapshot,workbook().bytes),calls=[];let changedMember=false,changedSchema=false,notLeaf=false;
  const sender={url:'http://localhost:3000/',frameId:0,tab:{id:1,windowId:7}},api={tabs:{get:async id=>({id,windowId:7,url:id===1?sender.url:'https://supplier.coupang.com/qvt/registration'}),query:async query=>{assert.equal(query.windowId,7);assert.ok(query.url.every(url=>url.startsWith('https://supplier.coupang.com/')));return[{id:2,windowId:7,url:'https://supplier.coupang.com/qvt/registration'}];},sendMessage:async()=>({ok:true,ownerId:changedMember&&calls.includes('readSupplierHubTemplate')?'other':'owner',company})},scripting:{executeScript:async({func,target,args})=>{assert.equal(target.tabId,2);calls.push(func.name);return[{result:func.name==='verifySupplierHubCompany'?{code:company.code}:func.name==='readSupplierHubSchema'?{...snapshot,...(changedSchema?{schemaString:'changed'}:{})}:func.name==='readSupplierHubTemplate'?(assert.deepEqual(args,[snapshot]),template):{source:'supplier-hub-category-api',company,trail:[parent],children:[{...leaf,isLeaf:!notLeaf}],observedAt:Date.now(),fullCatalogVerified:false}}];}}};
  const message={type:'YOOFAM_READ_CATEGORY_TEMPLATE',trail:[parent],selection:{categoryId:leaf.categoryId,name:leaf.name},expectedSchema:{schemaString:snapshot.schemaString,metadata:snapshot.metadata}};
  const result=await readAppSupplierHubCatalog(message,sender,api);assert.equal(result.template.sha256,template.sha256);assert.deepEqual(calls,['verifySupplierHubCompany','readSupplierHubCategoryBranch','readSupplierHubSchema','readSupplierHubTemplate']);
  calls.length=0;changedSchema=true;await assert.rejects(readAppSupplierHubCatalog(message,sender,api));assert.ok(!calls.includes('readSupplierHubTemplate'));
  changedSchema=false;notLeaf=true;calls.length=0;await assert.rejects(readAppSupplierHubCatalog(message,sender,api));assert.ok(!calls.includes('readSupplierHubTemplate'));
  notLeaf=false;changedMember=true;calls.length=0;await assert.rejects(readAppSupplierHubCatalog(message,sender,api));
 }
});
const request=(snapshot,bytes,{duplicateFile=false,extra=false}={})=>{const form=new FormData();form.set('file',new File([bytes],'official.xlsx'));form.set('schema',JSON.stringify(snapshot));if(duplicateFile)form.append('file',new File([bytes],'other.xlsx'));if(extra)form.set('url','https://invalid.example');return new Request('https://app.test/api/category-profiles/official-template',{method:'POST',body:form});};
test('official import endpoint stores original bytes in the owning workspace and rejects mismatches before storage',async()=>{
 const snapshot=snap(),bytes=workbook().bytes,api=h.load('app/api/category-profiles/official-template/route.ts');
 const response=await api.POST(request(snapshot,bytes));assert.equal(response.status,201,await response.clone().text());const result=await response.json();assert.equal(result.template.sha256,(await download(snapshot,bytes)).sha256);assert.match(result.template.storageKey,/^owner\/category-templates\/.*\.xlsx$/);assert.deepEqual(h.objects.get(result.template.storageKey),bytes);
 const before=h.objects.size;
 for(const [raw,binary,options] of [[snap(schemaCompanies[1]),bytes],[snapshot,workbook({category:'991235'}).bytes],[snapshot,bytes,{extra:true}],[snapshot,bytes,{duplicateFile:true}],[snapshot,encode('bad xlsx')]]){const failed=await api.POST(request(raw,binary,options));assert.equal(failed.status,400,await failed.clone().text());assert.equal(h.objects.size,before);}
});
test('official download archive errors report only bounded entry counts, never filenames or file contents',async()=>{
 const api=h.load('app/api/category-profiles/official-template/route.ts'),before=h.objects.size;
 const bytes=workbookArchive([['PRIVATE_COMPANY_ORIGINAL.xlsx',workbook().bytes],['PRIVATE_SERVER_MESSAGE.txt','DO_NOT_EXPOSE']]);
 const response=await api.POST(request(snap(),bytes));assert.equal(response.status,400);
 const body=await response.json();assert.match(body.error,/압축 파일 2개/);assert.match(body.error,/XLSX 1개/);assert.match(body.error,/ZIP 0개/);assert.match(body.error,/기타 1개/);
 assert.doesNotMatch(body.error,/PRIVATE_COMPANY|PRIVATE_SERVER|DO_NOT_EXPOSE/);assert.equal(h.objects.size,before);
});
function client(local,snapshot,template,{mutate,capability=true,afterExchange,excelSchema,excelCapability=true}={}){
 const exported={},parent={categoryId:'100',name:schemaPath[0],isLeaf:false},leaf={categoryId:snapshot.categoryId,name:schemaPath[1],isLeaf:true},calls=[];
 let branch={source:'supplier-hub-category-api',ownerId:'owner',company:snapshot.company,trail:[parent],children:[leaf],observedAt:Date.now(),fullCatalogVerified:false,schema:snapshot,template,...(excelSchema?{excelSchema}:{})};mutate?.(branch);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-catalog.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exported,Date,Error,File,FormData,TextDecoder,Uint8Array,crypto,atob,btoa,fetch:async(url,init)=>{calls.push({url,action:init.body.get('action')});return local.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test'+url,init));},require:name=>name==='@/app/supplier-hub-schema'?local.load('app/supplier-hub-schema.ts'):name==='@/app/request-body'?local.load('app/request-body.ts'):name==='@/app/xlsx-template'?local.load('app/xlsx-template.ts'):{exchange:async(type,payload)=>{calls.push({type,...(payload?.excelIdentity?{identity:plain(payload.excelIdentity)}:{})});if(type==='PING')return{categoryTemplate:capability,categoryExcelSchema:excelCapability};afterExchange?.();return{branch};}}});
 return {calls,run:signal=>exported.loadLiveHubCategoryTemplate({key:'live',categoryId:snapshot.categoryId,path:schemaPath,isLeaf:true,supplierHub:{trail:[parent],ownerId:'owner',company:snapshot.company}},snapshot,signal)};
}
test('client checks byte hash, company/path/leaf/member and cancellation before uploading official bytes',async()=>{
 const snapshot=snap(),template=await download(snapshot,workbook().bytes);
 const badCases=[branch=>{branch.ownerId='other';},branch=>{branch.company=schemaCompanies[1];},branch=>{branch.children[0].isLeaf=false;},branch=>{branch.schema={...snapshot,metadata:{...snapshot.metadata,version:191}};},branch=>{branch.template={...template,sha256:'a'.repeat(64)};},branch=>{branch.template={...template,size:template.size+1};},branch=>{branch.template={...template,sourceUrl:'https://invalid.example'};},branch=>{branch.template={...template,categoryPath:['different']};}];
 for(const mutate of badCases){const c=client(h,snapshot,template,{mutate});await assert.rejects(c.run(new AbortController().signal));assert.ok(!c.calls.some(call=>call.url));}
 const missing=client(h,snapshot,template,{capability:false});await assert.rejects(missing.run(new AbortController().signal));assert.deepEqual(missing.calls,[{type:'PING'}]);
 const controller=new AbortController(),cancelled=client(h,snapshot,template,{afterExchange:()=>controller.abort()});await assert.rejects(cancelled.run(controller.signal));assert.ok(!cancelled.calls.some(call=>call.url));
});
test('Single import requires the new capability and rejects wrong Excel response before storage while accepting metadata key reordering',async()=>{
 const single={...snap(),metadata:{...snap().metadata,scope:'Retail_Categorized_Single',version:73}},excel=snap(),template=await download(single,workbook().bytes),before=h.objects.size;
 const old=client(h,single,template,{excelCapability:false});await assert.rejects(old.run(new AbortController().signal),/Single·Excel/);assert.deepEqual(old.calls,[{type:'PING'}]);
 const wrong=client(h,single,template,{excelSchema:{...excel,metadata:{...excel.metadata,version:73}}});await assert.rejects(wrong.run(new AbortController().signal),/버전/);assert.equal(h.objects.size,before);assert.deepEqual(wrong.calls.filter(call=>call.url).map(call=>call.action),['inspect']);
 const reordered=client(h,single,template,{excelSchema:excel,mutate:branch=>{branch.schema={...single,metadata:Object.fromEntries(Object.entries(single.metadata).reverse())};}});
 assert.ok((await reordered.run(new AbortController().signal)).template);
});
for(const company of schemaCompanies)for(const mode of ['Excel','Single','Single wrapper'])test(`automatic official import links ${mode} URL draft and manual changes to original XLSX for ${company.code}`,async()=>{
 const local=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const separate=mode!=='Excel',excel=snap(company),snapshot=separate?{...excel,metadata:{...excel.metadata,scope:'Retail_Categorized_Single',version:73}}:excel,original=workbook(),bytes=mode==='Single wrapper'?workbookArchive([['download/official.XLSX',original.bytes],['download/readme.txt','original download sidecar']]):original.bytes,template=await download(snapshot,bytes),before=JSON.stringify(snapshot),c=client(local,snapshot,template,{excelSchema:separate?excel:undefined}),connected=await c.run(new AbortController().signal);
  assert.equal(connected.template.sha256,(await download(snapshot,original.bytes)).sha256);
  if(mode==='Single wrapper')assert.notEqual(connected.template.sha256,template.sha256);
  assert.equal(JSON.stringify(snapshot),before);assert.deepEqual(c.calls.filter(call=>call.url).map(call=>call.action),separate?['inspect',null]:[null]);
  if(separate)assert.deepEqual(c.calls.find(call=>call.identity).identity,{scopeType:'Retail_Categorized_Excel',kanCategoryId:'3000',noticeNumber:'17',version:'190'});
  const api=local.load('app/api/category-profiles/route.ts'),created=await api.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({name:'자동 공식 연결 시험',categoryId:snapshot.categoryId,categoryPath:schemaPath,hubSchema:snapshot,...connected})}));
  assert.equal(created.status,201,await created.clone().text());const {profile}=await created.json();local.context.category=profile;local.sqlite.prepare("UPDATE collection_context SET payload=? WHERE job_id='job'").run(JSON.stringify(local.context));
  await local.intake();const product=local.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  let view=await (await local.route(base+'/quotation-fields')).json();const lens=view.resolved.schema.fields.find(field=>field.label==='렌즈 유형'),notice=view.resolved.schema.fields.find(field=>field.label==='렌즈 관리방법');
  const content=JSON.parse(local.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  const edited=await local.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'직접 검토한 상품명'}}}});assert.equal(edited.status,200);
  view=await (await local.route(base+'/quotation-fields')).json();const changed=await local.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:lens.id,optionId:null,value:'UV'},{fieldKey:notice.id,optionId:'collected-2',value:''}]}});assert.equal(changed.status,200,await changed.clone().text());
  const source=await local.load('app/exports/quotation-source.ts').readMappedQuotationSource('owner',product.id,profile.id),resolved=local.load('app/exports/quotation-source.ts').resolveQuotationExport(source),rows=local.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source,resolved,[]);
  assert.deepEqual(plain(source.profile.hubSchema.metadata),snapshot.metadata);assert.equal(source.profile.hubSchema.schemaString,snapshot.schemaString);
  const output=await local.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:original.bytes.buffer,profile:source.profile,rows,dataStartRow:9});assert.equal(output.values.length,6);assert.equal(output.report.validationIssues.length,0);
  for(let index=0;index<6;index++){assert.equal(output.values[index][0],'직접 검토한 상품명');assert.equal(output.values[index][1],schemaPath.join('>')+' (991234)');assert.equal(output.values[index][4],'UV');assert.equal(output.values[index][5],index===1?'':'해당사항없음');}
  const archive=await local.load('app/xlsx-template.ts').readXlsxArchive(output.bytes.buffer),inspection=local.load('app/xlsx-template.ts').inspectXlsxArchive(archive);assert.deepEqual(plain(local.load('app/xlsx-template.ts').xlsxHeaders(inspection,original.sheetName,7)),original.headers.map(()=> '작성 안내'));assert.deepEqual(local.objects.get(profile.template.storageKey),original.bytes);
  assert.equal(local.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');assert.ok(!local.network.includes('supplier.coupang.com'));
 }finally{local.close();}
});
