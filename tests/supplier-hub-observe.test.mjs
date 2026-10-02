import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateAppHubRequest,isHubRegistrationTab} from '../extensions/supplier-hub/app-request.mjs';
import {isStoredReceiptResult,resultKey} from '../extensions/supplier-hub/handoff-store.mjs';
import {refreshSupplierHubRegistration} from '../extensions/supplier-hub/app-registration.mjs';
import {verifySupplierHubCompany} from '../extensions/supplier-hub/company.mjs';
import {readSupplierHubValidation} from '../extensions/supplier-hub/result.mjs';
import {supplierHubStatusReady} from '../extensions/supplier-hub/hub-tab.mjs';
import {searchSupplierHubRegistration} from '../extensions/supplier-hub/registration-search.mjs';
import {readSupplierHubRegistration} from '../extensions/supplier-hub/registration-result.mjs';
const source=fs.readFileSync(new URL('../extensions/supplier-hub/observe.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');

async function appObservation(changes={}){
 const identity={company:{code:'A01464742',name:'와이홉'},origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64),includedOptions:3};
 const tabs=[{id:123,windowId:17,url:'https://supplier.coupang.com/qvt/registration'},...(changes.extraTab?[{id:124,windowId:17,url:'https://supplier.coupang.com/qvt/registration'}]:[])];
 const reads=[],puts=[],scripts=[];let gets=0;
 const context=vm.createContext({Date,URL,validateAppHubRequest,isHubRegistrationTab,isStoredReceiptResult,verifySupplierHubCompany(){},readSupplierHubValidation(){},resultKey:()=> 'result:key',
   transferRecord:async(action,key,value)=>{if(action==='put')puts.push(value);else return key.startsWith('attempt:')?{...identity,...changes.identity}:null;},
   chrome:{tabs:{query:async args=>{reads.push(args);return tabs;},get:async()=>{gets++;return {...tabs[0],...(changes.move&&gets>1?{windowId:18}:{})};}},scripting:{executeScript:async input=>{scripts.push(input);return [{result:input.func===context.verifySupplierHubCompany?{code:'A01464742'}:{filename:`YOOFAM-${identity.fingerprint}.xlsx`,state:'validation-pending',registered:false,...changes.result}}];}}}
 });vm.runInContext(source,context);
 const message={type:'YOOFAM_REFRESH_RESULT',kind:'validation',productId:'p',categoryId:'80719',fingerprint:identity.fingerprint};
 const sender={frameId:0,url:'http://localhost:3000/',tab:{id:7,windowId:17},...changes.sender};
 return {reads,puts,scripts,run:()=>context.observeSupplierHubResult(message,sender)};
}

test('app refresh observes only its exact previously transmitted quotation in the same Chrome window',async()=>{
 const h=await appObservation();assert.equal((await h.run()).state,'validation-pending');
 assert.deepEqual(JSON.parse(JSON.stringify(h.reads)),[{windowId:17}]);assert.equal(h.puts.length,1);assert.equal(h.puts[0].fingerprint,'a'.repeat(64));
 const read=h.scripts.find(script=>script.func.name==='readSupplierHubValidation');assert.equal(read.target.tabId,123);assert.equal(read.args[0],`YOOFAM-${'a'.repeat(64)}.xlsx`);
});

test('app refresh cannot read another identity or save a result from a moved tab or different file',async()=>{
 for(const changes of [{identity:{productId:'other'}},{identity:{origin:'http://127.0.0.1:3000'}},{sender:{frameId:1}},{extraTab:true},{move:true},{result:{filename:'other.xlsx'}}]){
   const h=await appObservation(changes);await assert.rejects(h.run());assert.equal(h.puts.length,0);
   if(changes.identity||changes.sender||changes.extraTab)assert.equal(h.scripts.length,0);
 }
});
function setup({kind='validation',senderChanges={},tabChanges={},resultChanges={},onExecute,missing=false,savedChanges={},identityChanges={},companyCodes,legacy=false}={}){
 const identity={company:{code:'A01464742',name:'와이홉'},origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64),includedOptions:3,...identityChanges};
 const saved={...identity,filename:`YOOFAM-${identity.fingerprint}.xlsx`,quotationId:'quote-1',state:'validation-complete',observedAt:Date.now(),registered:false,...savedChanges};
 const result=kind==='validation'?{...saved,...resultChanges}:{quotationId:'quote-1',scope:'visible-page',rows:[{title:'상품',skuId:'sku-1'}],registered:false,...resultChanges};
 if(legacy)delete identity.company;
 const puts=[],scripts=[];let companyChecks=0;
 const context=vm.createContext({Date,URL,isStoredReceiptResult,verifySupplierHubCompany(){},openSupplierHubRegistrationStatus:async()=>{},searchSupplierHubRegistration(){},readSupplierHubValidation(){},readSupplierHubRegistration(){},resultKey:()=> 'result:key',
  transferRecord:async(action,key,value)=>{if(action==='put')puts.push(value);else return key==='attempt:123'?(missing?null:identity):saved;},
  chrome:{runtime:{id:'extension',getURL:name=>`chrome-extension://extension/${name}`},tabs:{query:async()=>[{id:123,url:'https://supplier.coupang.com'+(kind==='validation'?'/qvt/registration':'/qvt/wims'),...tabChanges}]},scripting:{executeScript:async input=>{if(input.func===context.verifySupplierHubCompany){const code=companyCodes?.[companyChecks++]??'A01464742';return [{result:{code}}];}scripts.push(input);await onExecute?.();return [{result}];}}}
 });
 vm.runInContext(source,context);
 return {puts,scripts,run:()=>context.observeSupplierHubResult({tabId:123,kind},{id:'extension',url:'chrome-extension://extension/popup.html',...senderChanges})};
}
test('worker persists validation and SKU observations without a popup callback',async()=>{
 for(const kind of ['validation','registration']){
  let finish;const pending=new Promise(resolve=>{finish=resolve;});const h=setup({kind,onExecute:()=>pending});
  const job=h.run();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.puts.length,0);
  await assert.rejects(h.run(),/확인 중/);assert.equal(h.scripts.length,1);
  finish();await job;assert.equal(h.puts.length,1);assert.equal(h.puts[0].productId,'p');
  assert.equal(h.puts[0].registered,false);if(kind==='registration'){assert.equal(h.puts[0].registration.quotationId,'quote-1');assert.equal(h.puts[0].registration.includedOptions,3);assert.equal(h.puts[0].registration.rows.length,1);}
  await h.run();assert.equal(h.puts.length,2,'lock released after successful observation');
 }
});
test('only own popup can observe the selected matching Hub screen',async()=>{
 for(const opts of [{senderChanges:{id:'other'}},{senderChanges:{url:'https://app.test'}},{senderChanges:{tab:{id:123}}},{tabChanges:{id:456}},{tabChanges:{url:'https://supplier.coupang.com/qvt/wims'}}]){
  const h=setup(opts);await assert.rejects(h.run());assert.equal(h.scripts.length,0);assert.equal(h.puts.length,0);
 }
});
test('mismatched or invalid results never become saved registration evidence',async()=>{
 for(const opts of [{kind:'registration',missing:true},{kind:'registration',resultChanges:{quotationId:'different'}},{kind:'registration',resultChanges:{scope:'all'}},{kind:'registration',resultChanges:{registered:true}},{resultChanges:{registered:true}},{resultChanges:{state:'unknown'}}]){
  const h=setup(opts);await assert.rejects(h.run());assert.equal(h.puts.length,0);
  await assert.rejects(h.run(),error=>!error.message.includes('확인 중'),'failed requests release the lock');
 }
 const h=setup({resultChanges:{filename:'other.xlsx'}});await h.run();assert.equal(h.puts.length,0);
});
test('invalid option count cannot be attached to a validation or registration result',async()=>{
 for(const options of [{kind:'validation',identityChanges:{includedOptions:0}},{kind:'registration',savedChanges:{includedOptions:0}}]){
  const h=setup(options);await assert.rejects(h.run(),/옵션 수/);assert.equal(h.puts.length,0);
 }
});


test('registration search uses only the saved validated ID and does not save search as a result',async()=>{
 const h=setup({kind:'registration-search',resultChanges:{state:'search-requested'}});
 const result=await h.run();assert.equal(result.state,'search-requested');assert.equal(h.puts.length,0);
 assert.equal(h.scripts[0].args[0],'quote-1');
 for(const opts of [{missing:true},{savedChanges:{state:'validation-pending'}},{savedChanges:{filename:'other.xlsx'}},{resultChanges:{state:'unknown'}},{resultChanges:{state:'search-requested',quotationId:'other'}},{resultChanges:{state:'search-requested',registered:true}},{senderChanges:{id:'other'}}]){
  const bad=setup({kind:'registration-search',...opts});await assert.rejects(bad.run());assert.equal(bad.puts.length,0);
 }
});


test('validated search may start on the same upload tab, but missing validation never navigates',async()=>{
 const h=setup({kind:'registration-search',tabChanges:{url:'https://supplier.coupang.com/qvt/registration'},resultChanges:{state:'search-requested'}});
 assert.equal((await h.run()).state,'search-requested');assert.equal(h.scripts.length,1);
 const missing=setup({kind:'registration-search',missing:true,tabChanges:{url:'https://supplier.coupang.com/qvt/registration'}});
 await assert.rejects(missing.run());assert.equal(missing.scripts.length,0);
});

test('company switches cannot read or save another company result',async()=>{
 for(const kind of ['validation','registration','registration-search']){
  const before=setup({kind,companyCodes:['A01526306']});
  await assert.rejects(before.run(),/회사/);assert.equal(before.scripts.length,0);assert.equal(before.puts.length,0);
  const during=setup({kind,companyCodes:['A01464742','A01526306'],resultChanges:kind==='registration-search'?{state:'search-requested'}:{}});
  await assert.rejects(during.run(),/회사/);assert.equal(during.puts.length,0);
  if(kind==='registration-search')assert.equal(during.scripts.length,0,'company rechecked after navigation before searching');
 }
});

test('legacy attempts and company-mismatched validation cannot initiate a registration search',async()=>{
 for(const options of [{legacy:true},{savedChanges:{company:{code:'A01526306',name:'유앤채'}}},{savedChanges:{company:undefined}}]){
  const h=setup({kind:'registration-search',...options});await assert.rejects(h.run(),/회사/);
  assert.equal(h.scripts.length,0);assert.equal(h.puts.length,0);
 }
});

test('a file-table miss preserves the accepted receipt and its clocks for the next fresh exact-ID SKU lookup',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  const identity={origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64),company,includedOptions:1};
  const filename=`YOOFAM-${identity.fingerprint}.xlsx`,observedAt=Date.now()-10000,quotationId='accepted-quote';
  const row={title:'상품',submittedAt:'date',category:'cat',barcode:'',sourceQuotation:filename,skuId:'sku-original',status:'검수중',stage:'확인중'};
  const accepted={...identity,filename,quotationId,state:'validation-complete',observedAt,registered:false,profileId:'original-profile',registration:{quotationId,scope:'visible-page',observedAt,includedOptions:1,registered:false,rows:[row]}};
  const key=resultKey(identity),records=new Map([[key,accepted],['attempt:123',identity]]),calls=[];
  const store=async(action,name,value)=>{calls.push(['store',action,name]);if(action==='put')records.set(name,value);if(action==='claim'){if(records.has(name))return false;records.set(name,value);return true;}return records.get(name);};
  const tabs=[{id:123,windowId:17,url:'https://supplier.coupang.com/qvt/registration',status:'complete'}],sender={frameId:0,url:identity.origin+'/',tab:{id:7,windowId:17}};
  const table={getClientRects:()=>[{}],querySelectorAll:selector=>selector==='thead th'?['견적서 명','견적서 등록일','검증 상태','검증 결과','견적서 ID'].map(innerText=>({innerText})):[]};
  const refresh={innerText:'새로고침',disabled:false,getClientRects:()=>[{}],getAttribute:()=>null,click(){calls.push(['file-refresh']);}};
  const document={body:{},querySelectorAll:selector=>selector==='table'?[table]:[refresh]};
  const api={tabs:{query:async()=>tabs,get:async id=>id===7?{id:7,windowId:17,url:identity.origin+'/'}:tabs.find(tab=>tab.id===id),
   create:async value=>{const tab={id:124,status:'complete',...value};tabs.push(tab);return tab;},sendMessage:async()=>{assert.fail('the exact local accepted receipt and original tab remain available');}},
   scripting:{executeScript:async({func,args})=>{
    calls.push(['script',func.name,args]);
    if(func===verifySupplierHubCompany)return [{result:{code:company.code}}];
    if(func===readSupplierHubValidation)return [{result:await vm.runInNewContext(`(${func.toString()})(filename)`,{filename,document,location:{origin:'https://supplier.coupang.com',pathname:'/qvt/registration'},MutationObserver:class{observe(){}disconnect(){}},setTimeout:callback=>{queueMicrotask(callback);return 1;},clearTimeout(){}})}];
    if(func===supplierHubStatusReady)return [{result:true}];
    if(func===searchSupplierHubRegistration){assert.deepEqual(args,[quotationId,true]);return [{result:{state:'search-complete',quotationId,registered:false}}];}
    if(func===readSupplierHubRegistration){const rows=[{...row,stage:'상품 검수 완료'}];return [{result:{quotationId,scope:'visible-page',registered:false,rows,page:{current:1,hasNext:false,signature:JSON.stringify(rows)}}}];}
    assert.fail('unexpected script '+func.name);
   }}};
  const context=vm.createContext({Date,URL,validateAppHubRequest,isHubRegistrationTab,isStoredReceiptResult,resultKey,transferRecord:store,verifySupplierHubCompany,readSupplierHubValidation,chrome:api});vm.runInContext(source,context);
  assert.equal((await context.observeSupplierHubResult({...identity,type:'YOOFAM_REFRESH_RESULT',kind:'validation'},sender)).state,'not-found');
  assert.deepEqual(records.get(key),accepted);assert.equal(calls.some(([name,action])=>name==='store'&&action==='put'),false,'absence is not a fresh acceptance observation');
  const result=await refreshSupplierHubRegistration({...identity,type:'YOOFAM_REFRESH_REGISTRATION'},sender,api,store);
  assert.equal(result.quotationId,quotationId);assert.equal(result.profileId,'original-profile');assert.equal(result.observedAt,observedAt);
  assert.equal(result.registration.rows[0].stage,'상품 검수 완료');assert.ok(result.registration.observedAt>observedAt);
  assert.deepEqual(records.get('attempt:123'),identity);assert.equal(calls.some(([name,func])=>name==='script'&&/attach|Validation$/.test(func)&&func!=='readSupplierHubValidation'),false);
 }
});

test('explicit rejection and mismatched prior receipts are never hidden by acceptance preservation',async()=>{
 for(const state of ['validation-pending','validation-rejected']){const h=setup({resultChanges:{state}});await h.run();assert.equal(h.puts[0].state,state);}
 const matching=setup({resultChanges:{state:'not-found'}});await matching.run();assert.equal(matching.puts.length,0,'a valid original receipt need not have an optional profile ID');
 for(const savedChanges of [{fingerprint:'b'.repeat(64)},{productId:'other'},{categoryId:'999'},{company:{code:'A01526306',name:'유앤채'}},{includedOptions:2},{includedOptions:201},{filename:'another.xlsx'},
  {registered:true},{observedAt:0},{observedAt:Date.now()+61000},{observedAt:Infinity},{quotationId:''},{quotationId:' quote-1'},{quotationId:'x'.repeat(201)},
  {profileId:''},{profileId:'../other'},{profileId:123},{state:'validation-rejected'},{state:'validation-pending'}]){
  const h=setup({savedChanges,resultChanges:{state:'not-found',registered:false,filename:`YOOFAM-${'a'.repeat(64)}.xlsx`}});await h.run();assert.equal(h.puts.length,1);assert.equal(h.puts[0].state,'not-found');
 }
 const switched=setup({identityChanges:{profileId:'other-profile'},savedChanges:{profileId:'original-profile'},resultChanges:{state:'not-found'}});await switched.run();assert.equal(switched.puts.length,1);
});
