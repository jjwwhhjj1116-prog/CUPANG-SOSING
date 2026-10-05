import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readSupplierHubSchema} from '../extensions/supplier-hub/schema-page.mjs';
import {readAppSupplierHubCatalog} from '../extensions/supplier-hub/catalog.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {workbookArchive} from './helpers/quotation-workbook.mjs';

// Scope-specific response fixtures follow the preserved public SR fetchSchema /
// getSchemaForDraft contract. They are not authenticated endpoint responses.
const plain=value=>JSON.parse(JSON.stringify(value));
const identity={scopeType:'Retail_Categorized_Excel',kanCategoryId:'3000',noticeNumber:'17',version:'190'};
const snapshot=(company=schemaCompanies[0],scope='Retail_Categorized_Single',version=73)=>({...hubSchemaSnapshot(company),metadata:{kanCategoryId:3000,scopeType:scope,noticeNumber:17,version}});
const single=snapshot(),excel=snapshot(single.company,'Retail_Categorized_Excel',190);
const change=(snapshot,fn)=>{const raw=JSON.parse(snapshot.schemaString);fn(raw);return {...snapshot,schemaString:JSON.stringify(raw)};};
const fixture=()=>{
 const headers=['상품명','카테고리','공급가','판매가','렌즈 유형','렌즈 관리방법',...Array.from({length:19},(_,i)=>`미연결 ${i}`)],category=schemaPath.join('>')+' (991234)';
 const row=(number,values)=>`<row r="${number}">${values.map((value,i)=>`<c r="${String.fromCharCode(65+i)}${number}" t="inlineStr"><is><t>${value.replaceAll('&','&amp;').replaceAll('<','&lt;')}</t></is></c>`).join('')}</row>`;
 return workbookArchive([
  ['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
  ['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml','<workbook xmlns:r="relationship"><sheets><sheet name="QF_3000_시험분류" r:id="one"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
  ['xl/worksheets/sheet1.xml',`<worksheet><sheetData>${row(1,['','Retail_Categorized_Excel:Kan:3000:Notice17:Version190'])}${row(5,headers)}${row(6,headers.map((_,i)=>i<5?'필수':'선택'))}${row(7,headers.map(()=>'작성 안내'))}${row(8,headers.map((_,i)=>i===1?category:'예시'))}${row(9,headers.map(()=>''))}</sheetData><dataValidations><dataValidation type="list" sqref="B9:B1008"><formula1>"${category}"</formula1></dataValidation><dataValidation type="list" sqref="E9:E1008"><formula1>"해당사항없음,UV"</formula1></dataValidation></dataValidations></worksheet>`],
 ]);
};
function page(source,{body,after,query=identity,diagnostic=false,response}={}){
 const calls=[],location={origin:'https://supplier.coupang.com',pathname:'/dashboard/KR'},document={body:{innerText:'Company Code: '+source.company.code}};
 return {calls,run:()=>vm.runInNewContext(`(${readSupplierHubSchema.toString()})(source.categoryId,source.categoryPath,source.company,query,diagnostic)`,{source,query,diagnostic,location,document,Date,setTimeout,clearTimeout,AbortController,TextEncoder,TextDecoder,Uint8Array,fetch:async(url,init)=>{calls.push({url,init});const loaded=response?response():Response.json(body??{schemaString:source.schemaString,...source.metadata});Object.defineProperty(loaded,'url',{value:url});after?.(document,location);return loaded;}})};
}

test('injected Excel failures return fixed diagnostic codes without response bodies or raw errors',async()=>{
 const secret='PRIVATE_RESPONSE_OR_TOKEN';
 const variants=[
  [{response:()=>new Response(secret,{status:404,headers:{'content-type':'application/json'}})},'HTTP_STATUS',404],
  [{response:()=>new Response(secret,{headers:{'content-type':'text/html'}})},'RESPONSE_TYPE',200],
  [{response:()=>new Response(secret,{headers:{'content-type':'application/json'}})},'BODY_JSON',200],
  [{body:{message:secret}},'SCHEMA_MISSING',200],
  [{body:{schemaString:JSON.stringify({properties:{private:secret}}),...excel.metadata}},'SCHEMA_PAGES',200],
  [{body:{schemaString:excel.schemaString,...excel.metadata,version:189,private:secret}},'EXCEL_VERSION',200],
  [{response:()=>{throw Error(secret);}},'NETWORK',undefined],
 ];
 for(const [config,code,status] of variants){
  await assert.rejects(page(excel,config).run());
  const result=plain(await page(excel,{...config,diagnostic:true}).run());
  assert.deepEqual(result,{format:'supplier-hub-schema-error-v1',code,...(status?{httpStatus:status}:{})});
  assert.ok(!JSON.stringify(result).includes(secret));
 }
 const valid=await page(excel,{diagnostic:true}).run();assert.equal(valid.schemaString,excel.schemaString);assert.equal(valid.format,'supplier-hub-schema-v1');
});
test('separate Excel GET uses the exact preserved SR contract and verifies both metadata aliases without writing',async()=>{
 for(const company of schemaCompanies){const source=snapshot(company,'Retail_Categorized_Excel',190),p=page(source),loaded=await p.run();
  assert.equal(loaded.schemaString,source.schemaString);assert.deepEqual(plain(loaded.metadata),source.metadata);
  assert.equal(p.calls.length,1);assert.equal(p.calls[0].url,'https://supplier.coupang.com/sr/schema/api/get-specified-schemaform-with-all-options?internalDisplayCode=991234&kanCategoryId=3000&scopeType=Retail_Categorized_Excel&noticeNumber=17&version=190&useCustomizedJsonSchema=true');
  assert.equal(p.calls[0].init.method,'GET');assert.equal(p.calls[0].init.body,undefined);assert.equal(p.calls[0].init.redirect,'error');
 }
 for(const patch of [{scopeType:'Retail_Categorized_Single'},{version:73},{noticeNumber:18},{kanCategoryId:3001},{scope:'OTHER'},{categoryId:3001},{productNoticeNumber:18},{internalDisplayCode:'991235'}])await assert.rejects(page(excel,{body:{schemaString:excel.schemaString,...excel.metadata,...patch}}).run());
 for(const query of [null,{...identity,scopeType:'Retail_Categorized_Single'},{...identity,version:'190&other=x'},{...identity,url:'https://invalid.test'}]){const p=page(excel,{query});await assert.rejects(p.run());assert.equal(p.calls.length,0);}
 await assert.rejects(page(excel,{after:document=>{document.body.innerText='Company Code: A01526306';}}).run());
});
test('Excel dispatcher rechecks the original Single snapshot and keeps the original tab/member bound across both schema reads',async()=>{
 const parent={categoryId:'100',name:schemaPath[0],isLeaf:false},leaf={categoryId:single.categoryId,name:schemaPath[1],isLeaf:true},sender={url:'http://localhost:3000/',frameId:0,tab:{id:1,windowId:7}};
 let stale=false,changedOwner=false,reads=0;const calls=[];
 const api={tabs:{get:async id=>({id,windowId:7,url:id===1?sender.url:'https://supplier.coupang.com/dashboard/KR'}),query:async()=>[{id:2,windowId:7,url:'https://supplier.coupang.com/dashboard/KR'}],sendMessage:async()=>({ok:true,ownerId:changedOwner&&reads===2?'other':'owner',company:single.company})},scripting:{executeScript:async({func,target,args})=>{
  assert.equal(target.tabId,2);calls.push(func.name);
  if(func.name==='verifySupplierHubCompany')return[{result:{code:single.company.code}}];
  if(func.name==='readSupplierHubCategoryBranch')return[{result:{source:'supplier-hub-category-api',trail:[parent],children:[leaf],company:single.company,observedAt:Date.now(),fullCatalogVerified:false}}];
  reads++;if(args.length===3)return[{result:stale?{...single,schemaString:excel.schemaString+' '}:single}];
  assert.deepEqual(plain(args),[single.categoryId,schemaPath,single.company,identity,true]);return[{result:await page(excel,{diagnostic:args[4]}).run()}];
 }}};
 const message={type:'YOOFAM_READ_CATEGORY_SCHEMA',trail:[parent],selection:{categoryId:leaf.categoryId,name:leaf.name},expectedSchema:{schemaString:single.schemaString,metadata:Object.fromEntries(Object.entries(single.metadata).reverse())},excelIdentity:identity};
 const loaded=await readAppSupplierHubCatalog(message,sender,api);assert.equal(loaded.schema.metadata.scopeType,'Retail_Categorized_Single');assert.equal(loaded.excelSchema.metadata.scopeType,'Retail_Categorized_Excel');assert.equal(reads,2);
 reads=0;stale=true;await assert.rejects(readAppSupplierHubCatalog(message,sender,api),/Single/);assert.equal(reads,1);
 reads=0;stale=false;changedOwner=true;await assert.rejects(readAppSupplierHubCatalog(message,sender,api),/회원/);assert.equal(reads,2);
  changedOwner=false;reads=0;await assert.rejects(readAppSupplierHubCatalog({...message,expectedSchema:{...message.expectedSchema,metadata:{...single.metadata,version:String(single.metadata.version)}}},sender,api),/Single/);assert.equal(reads,1);
});

test('Chrome-shaped missing injection results become actionable only when the Excel reader returns its safe diagnostic',async()=>{
 const parent={categoryId:'100',name:schemaPath[0],isLeaf:false},leaf={categoryId:single.categoryId,name:schemaPath[1],isLeaf:true},sender={url:'http://localhost:3000/',frameId:0,tab:{id:1,windowId:7}};
 let preserveFailure=false,calls=0;
 const api={tabs:{get:async id=>({id,windowId:7,url:id===1?sender.url:'https://supplier.coupang.com/dashboard/KR'}),query:async()=>[{id:2,windowId:7,url:'https://supplier.coupang.com/dashboard/KR'}],sendMessage:async()=>({ok:true,ownerId:'owner',company:single.company})},scripting:{executeScript:async({func,args})=>{
  if(func.name==='verifySupplierHubCompany')return[{result:{code:single.company.code}}];
  if(func.name==='readSupplierHubCategoryBranch')return[{result:{source:'supplier-hub-category-api',trail:[parent],children:[leaf],company:single.company,observedAt:Date.now(),fullCatalogVerified:false}}];
  if(args.length===3)return[{result:single}];
  calls++;try{return[{result:await page(excel,{diagnostic:preserveFailure&&args[4],response:()=>new Response('PRIVATE_SERVER_BODY',{status:404,headers:{'content-type':'application/json'}})}).run()}];}catch{return[{result:null}];}
 }}};
 const message={type:'YOOFAM_READ_CATEGORY_SCHEMA',trail:[parent],selection:{categoryId:leaf.categoryId,name:leaf.name},expectedSchema:{schemaString:single.schemaString,metadata:single.metadata},excelIdentity:identity};
 await assert.rejects(readAppSupplierHubCatalog(message,sender,api),/선택한 회사·분류의 별도 Excel 양식인지/);
 preserveFailure=true;
 await assert.rejects(readAppSupplierHubCatalog(message,sender,api),error=>{assert.match(error.message,/HTTP_STATUS \/ HTTP 404/);assert.doesNotMatch(error.message,/PRIVATE_SERVER_BODY/);return true;});
 assert.equal(calls,2,'each explicit attempt makes exactly one Excel GET');
});
test('actual API inspects without storage, rejects absent/wrong Excel metadata, and preserves the original Single snapshot',async()=>{
 const h=mobileIntakeHarness();try{
  const api=h.load('app/api/category-profiles/official-template/route.ts'),bytes=fixture(),before=JSON.stringify(single);
  const submit=async({action,source=single,other}={})=>{const form=new FormData();form.set('file',new File([bytes],'official.xlsx'));form.set('schema',JSON.stringify(source));if(action)form.set('action',action);if(other)form.set('excelSchema',JSON.stringify(other));return api.POST(new Request('https://app.test/api/category-profiles/official-template',{method:'POST',body:form}));};
  const inspected=await submit({action:'inspect'});assert.equal(inspected.status,200,await inspected.clone().text());assert.deepEqual((await inspected.json()).identity,identity);assert.equal(h.objects.size,0);
  for(const other of [undefined,single,{...excel,company:schemaCompanies[1]},{...excel,metadata:{...excel.metadata,version:73}},{...excel,metadata:{...excel.metadata,noticeNumber:18}},{...excel,metadata:{...excel.metadata,categoryId:3001}},{...excel,categoryPath:['wrong']}]){const failed=await submit({other});assert.equal(failed.status,400,await failed.clone().text());assert.equal(h.objects.size,0);}
  const connected=await submit({other:excel});assert.equal(connected.status,201,await connected.clone().text());const saved=await connected.json();assert.equal(saved.report.version,'190');assert.deepEqual(h.objects.get(saved.template.storageKey),bytes);assert.equal(JSON.stringify(single),before);
 }finally{h.close();}
});
test('only exact compatible wire mappings bridge scopes; changed constraints and same-label different paths stay unconnected',async()=>{
 const h=mobileIntakeHarness();try{
  const service=h.load('app/official-hub-template.ts'),bytes=fixture(),before=JSON.stringify(single),match=await service.connectOfficialHubTemplate(bytes.buffer,single,excel);
  assert.ok(match.mappings.some(mapping=>mapping.column===4));assert.ok(match.mappings.some(mapping=>mapping.column===5));
  for(const altered of [
   change(excel,raw=>{raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf[1].contains.properties.value.enum=[null,'Other'];}),
   change(excel,raw=>{raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf[1].contains.properties.value.maxLength=3;}),
   change(excel,raw=>{const common=raw.properties.productPage.properties.commonAttributes.properties;common.unexposedAttributes.allOf.push(common.exposedAttributes.allOf.pop());}),
   change(excel,raw=>{raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf[1].contains.properties.value.pattern='[A-Z]';}),
  ]){const result=await service.connectOfficialHubTemplate(bytes.buffer,single,altered);assert.equal(result.mappings.some(mapping=>mapping.column===4),false);assert.ok(result.report.unmatchedColumns.includes(4));assert.ok(result.mappings.some(mapping=>mapping.column===5));}
  assert.equal(JSON.stringify(single),before);
 }finally{h.close();}
});
