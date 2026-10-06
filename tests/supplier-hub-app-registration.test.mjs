import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {refreshSupplierHubRegistration} from '../extensions/supplier-hub/app-registration.mjs';
import {verifySupplierHubCompany} from '../extensions/supplier-hub/company.mjs';
import {supplierHubStatusReady} from '../extensions/supplier-hub/hub-tab.mjs';
import {searchSupplierHubRegistration} from '../extensions/supplier-hub/registration-search.mjs';
import {readSupplierHubRegistration} from '../extensions/supplier-hub/registration-result.mjs';
import {canPromoteSupplierHubReceipt,canObserveSupplierHubRegistration,resultKey} from '../extensions/supplier-hub/handoff-store.mjs';
import {validateAppHubRequest} from '../extensions/supplier-hub/app-request.mjs';
import {transmitSupplierHubPackage} from '../extensions/supplier-hub/transmit.mjs';
import {hubCompanyMenuPage} from './helpers/hub-company-menu.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';

const identity={origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64)};
const company={code:'A01464742',name:'와이홉'};
const message={...identity,type:'YOOFAM_REFRESH_REGISTRATION'};
const sender={frameId:0,url:'http://localhost:3000/',tab:{id:7,windowId:17}};
function fixture(options={}){
 const calls=[],records=new Map(),pages=new Map();let companyChecks=0,resultReads=0,sourceChecks=0,searched=false;
 const currentCompany=options.company??company;
 const source={id:123,windowId:17,url:'https://supplier.coupang.com/qvt/registration',status:'complete',...options.source};
 const tabs=[...(options.closedSource?[]:[source]),...(options.tabs||[])];
 if(!options.noAttempt)records.set('attempt:123',{...identity,company:currentCompany,includedOptions:3,...options.attempt});
 const key=`result:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`;
 const saved={...identity,company:currentCompany,includedOptions:3,filename:`YOOFAM-${identity.fingerprint}.xlsx`,quotationId:'quote-123',state:'validation-complete',observedAt:Date.now(),registered:false,...options.saved};
 if(!options.missingLocal)records.set(key,saved);
 const receipt={schemaVersion:1,evidence:'chrome-observation',profileId:'profile',categoryId:identity.categoryId,fingerprint:identity.fingerprint,result:saved,...options.receipt};
 const row={title:'상품',submittedAt:'date',category:'cat',barcode:'',sourceQuotation:'file',skuId:'sku',status:'검수중',stage:'확인중'};
 const api={tabs:{query:async query=>{calls.push(['query',query]);return tabs;},get:async id=>{
  if(id===7)return {id:7,windowId:17,url:identity.origin+'/',...options.appTab};
  const tab=tabs.find(tab=>tab.id===id);return options.moved&&id===124?{...tab,windowId:18}:tab;
 },sendMessage:async(id,message,frame)=>{
  calls.push(['app-message',id,message,frame]);
  if(message.type==='YOOFAM_READ_QUOTATION_RECEIPT')return {ok:true,...message.expected,receipt:options.recover?receipt:null,checkedAt:Date.now(),...options.reply};
  sourceChecks++;return {ok:true,...message.expected,checkedAt:Date.now(),...((options.sourceChangedAt===sourceChecks||(searched&&options.sourceChangeAfterSearch))?{fingerprint:'b'.repeat(64)}:{})};
 },create:async value=>{calls.push(['create',value]);const tab={id:124,status:'complete',...value,...options.created};tabs.push(tab);return tab;}},scripting:{executeScript:async request=>{
  calls.push([request.func.name,request.target.tabId,request.args]);
  if(options.companyMenu&&[supplierHubStatusReady,verifySupplierHubCompany].includes(request.func)){
   const id=request.target.tabId;
   if(!pages.has(id))pages.set(id,hubCompanyMenuPage({company:id===124&&options.createdCompany?options.createdCompany:currentCompany,path:new URL(tabs.find(tab=>tab.id===id).url).pathname}));
   return [{result:await pages.get(id).run(request.func,request.args)}];
  }
  if(request.func===verifySupplierHubCompany)return [{result:{code:options.companyCodes?.[companyChecks++]??currentCompany.code}}];
  if(request.func===supplierHubStatusReady)return [{result:true}];
  if(request.func===searchSupplierHubRegistration){searched=true;await options.onSearch?.();return [{result:{state:'search-complete',quotationId:'quote-123',registered:false,...options.search}}];}
  if(request.func===readSupplierHubRegistration){resultReads++;if(options.changeSaved&&(!options.changeAfter||resultReads>=options.changeAfter))records.set(key,{...records.get(key),...options.changeSaved});return [{result:{quotationId:'quote-123',scope:'visible-page',registered:false,rows:[row],page:{current:null,hasNext:null,signature:JSON.stringify([row])},...options.result,...options.pages?.[resultReads-1]}}];}
  throw Error('unexpected script');
 }}};
 const store=async(action,key,value)=>{calls.push(['store',action,key]);if(action==='claim'){if(options.concurrent)records.set(key,{...value,...options.concurrent});if(records.has(key))return false;records.set(key,value);return true;}if(action==='promote'){
  if(options.concurrent)records.set(key,{...value.accepted,...options.concurrent});
  if(!canPromoteSupplierHubReceipt(identity,records.get(key),value.accepted)||JSON.stringify(records.get(key))!==JSON.stringify(value.expected))return false;
  records.set(key,value.accepted);return true;
 }if(action==='register'){
  if(JSON.stringify(records.get(key))!==JSON.stringify(value.expected)||!canObserveSupplierHubRegistration(value.expected,value.observation))return false;
  records.set(key,value.observation);return true;
 }if(action==='put')records.set(key,value);return records.get(key);};
 return {calls,records,key,tabs,pages,run:(who=sender,patch={})=>refreshSupplierHubRegistration({...message,...patch},who,api,store)};
}
test('app searches the saved exact quotation ID in an inactive tab in its existing Chrome window and reuses it',async()=>{
 const h=fixture();const first=await h.run();
 assert.equal(first.registration.quotationId,'quote-123');assert.equal(first.registration.includedOptions,3);assert.equal(first.registration.rows[0].skuId,'sku');assert.equal(first.registered,false);
 assert.deepEqual(h.calls.find(([name])=>name==='query'),['query',{windowId:17,url:['https://supplier.coupang.com/qvt/registration*','https://supplier.coupang.com/qvt/wims*']}]);
 assert.deepEqual(h.calls.find(([name])=>name==='create'),['create',{windowId:17,url:'https://supplier.coupang.com/qvt/wims',active:false}]);
 assert.deepEqual(h.calls.find(([name])=>name==='searchSupplierHubRegistration'),['searchSupplierHubRegistration',124,['quote-123',true]]);
 assert.equal(h.tabs[0].url,'https://supplier.coupang.com/qvt/registration','original upload tab untouched');
 assert.equal(h.records.get('attempt:123').purpose,undefined);assert.equal(h.records.get('attempt:124').purpose,'registration-status');
 await h.run();assert.equal(h.calls.filter(([name])=>name==='create').length,1);assert.equal(h.calls.filter(([name])=>name==='searchSupplierHubRegistration').length,2);
});
test('fresh SKU lookup tabs open and verify collapsed company menus before the exact-ID search',async()=>{
 for(const currentCompany of [company,{code:'A01526306',name:'유앤채'}]){
  const h=fixture({companyMenu:true,company:currentCompany}),record=await h.run();
  assert.equal(record.registration.quotationId,'quote-123');assert.equal(record.company.code,currentCompany.code);assert.equal(record.registration.rows[0].skuId,'sku');
  assert.equal(h.pages.get(124).clicks,1);
  const ready=h.calls.findIndex(([name,id])=>name==='supplierHubStatusReady'&&id===124);
  const verified=h.calls.findIndex(([name,id],index)=>index>ready&&name==='verifySupplierHubCompany'&&id===124);
  const searched=h.calls.findIndex(([name,id])=>name==='searchSupplierHubRegistration'&&id===124);
  assert.ok(ready>=0&&verified>ready&&searched>verified);
  assert.equal(h.calls.some(([name])=>name==='attachToSupplierHub'||name==='requestSupplierHubValidation'),false);
 }
 const wrong=fixture({companyMenu:true,createdCompany:{name:company.name,code:'A01526306'}});
 await assert.rejects(wrong.run(),/회사코드/);assert.equal(wrong.calls.some(([name])=>name==='searchSupplierHubRegistration'),false);assert.equal(wrong.records.get(wrong.key).registration,undefined);
});

test('untrusted requests and non-complete, mismatched or unbounded validation never create or search a tab',async()=>{
 for(const who of [{...sender,frameId:1},{...sender,url:'https://evil.test/'},{...sender,tab:{id:7,windowId:-1}}]){const h=fixture();await assert.rejects(h.run(who));assert.equal(h.calls.length,0);}
 for(const saved of [{state:'validation-pending'},{productId:'other'},{categoryId:'999'},{filename:'other.xlsx'},{quotationId:''},{quotationId:' quote-123'},{quotationId:'x'.repeat(201)},{includedOptions:0},{registered:true}]){
  const h=fixture({saved});await assert.rejects(h.run());assert.equal(h.calls.some(([name])=>name==='query'||name==='create'||name==='searchSupplierHubRegistration'),false);
 }
 for(const config of [{source:{windowId:18}},{attempt:{fingerprint:'b'.repeat(64)}},{attempt:{company:{code:'A01526306',name:'유앤채'}}},{attempt:{includedOptions:2}}]){
  const h=fixture(config);await assert.rejects(h.run());assert.equal(h.calls.some(([name])=>name==='create'||name==='searchSupplierHubRegistration'),false);
 }
});
test('company change or tab movement never records another company or window result',async()=>{
 for(const options of [{companyCodes:['A01526306']},{companyCodes:[company.code,'A01526306']},{companyCodes:[company.code,company.code,company.code,'A01526306']},{companyCodes:[company.code,company.code,company.code,company.code,'A01526306']},{moved:true},{created:{windowId:18}},{created:{url:'https://supplier.coupang.com/login'}}]){
  const h=fixture(options);await assert.rejects(h.run());assert.equal(h.records.get(h.key).registration,undefined);
  assert.equal(h.calls.some(([name])=>name==='attachToSupplierHub'||name==='requestSupplierHubValidation'),false);
 }
});
test('unsettled search, wrong IDs and changed validation cannot be saved as fresh SKU evidence',async()=>{
 for(const config of [{search:{state:'search-requested'}},{search:{quotationId:'other'}},{search:{registered:true}},{result:{quotationId:'other'}},{result:{scope:'all'}},{result:{registered:true}},{result:{rows:[{}]}},{changeSaved:{quotationId:'other'}},{changeSaved:{state:'validation-rejected'}},{changeSaved:{company:{code:'A01526306',name:'유앤채'}}},{changeSaved:{includedOptions:2}}]){
  const h=fixture(config);await assert.rejects(h.run());assert.equal(h.records.get(h.key).registration,undefined);
 }
 const empty=fixture({result:{rows:[],page:{current:null,hasNext:null,signature:'[]'}}});assert.equal((await empty.run()).registration.rows.length,0);
});
test('app cannot start a second concurrent lookup or touch a different manually opened status search',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});const h=fixture({onSearch:()=>pending,tabs:[{id:999,windowId:17,url:'https://supplier.coupang.com/qvt/wims'}]});
 const first=h.run();for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(h.run(),/조회 중/);finish();await first;
 assert.equal(h.calls.some(([name,tabId])=>name==='searchSupplierHubRegistration'&&tabId===999),false);
});

test('app aggregates later pages only in its owned tab and discards results changed during the last page',async()=>{
 const row=skuId=>({title:'상품',submittedAt:'date',category:'cat',barcode:'',sourceQuotation:'file',skuId,status:'검수중',stage:'확인중'});
 const pages=[['sku-1','sku-2'],['sku-3']].map((skus,index)=>{const rows=skus.map(row);return {rows,page:{current:index+1,hasNext:index===0,signature:JSON.stringify(rows)}};});
 const h=fixture({pages}),record=await h.run();assert.equal(record.registration.scope,'queried-pages');assert.equal(record.registration.pagesRead,2);
 assert.equal(record.registration.hasMore,false);assert.deepEqual(record.registration.rows.map(row=>row.skuId),['sku-1','sku-2','sku-3']);
 const reads=h.calls.filter(([name])=>name==='readSupplierHubRegistration');assert.equal(reads.length,2);assert.equal(reads[1][1],124);
 assert.deepEqual(reads[1][2],['quote-123',{company,advanceFrom:pages[0].page}]);
 const changed=fixture({pages,changeAfter:2,changeSaved:{quotationId:'other'}});await assert.rejects(changed.run(),/검증 결과가 변경/);
 assert.equal(changed.records.get(changed.key).registration,undefined);
});

test('both companies recover six fresh SKUs from the app receipt without an old upload tab or replaying files',async()=>{
 for(const currentCompany of [company,{code:'A01526306',name:'유앤채'}]){
  const rows=Array.from({length:6},(_,index)=>({title:'상품',submittedAt:'date',category:'cat',barcode:'',sourceQuotation:'file',skuId:`sku-${index+1}`,status:'검수중',stage:'확인중'}));
  const manual={id:999,windowId:17,url:'https://supplier.coupang.com/qvt/wims',manualSearch:'do-not-change'};
  const h=fixture({company:currentCompany,recover:true,missingLocal:true,closedSource:true,noAttempt:true,tabs:[manual],saved:{includedOptions:6,registration:{rows:[{skuId:'old'}]}},result:{rows,page:{current:1,hasNext:false,signature:JSON.stringify(rows)}}});
  const record=await h.run();assert.deepEqual(record.registration.rows.map(row=>row.skuId),rows.map(row=>row.skuId));
  assert.equal(record.quotationId,'quote-123');assert.deepEqual(record.company,currentCompany);assert.equal(record.receiptRecovered,true);assert.equal(record.profileId,'profile');
  assert.equal(h.records.has('attempt:123'),false);assert.equal([...h.records.keys()].some(key=>key.startsWith('transmission:')),false);
  assert.equal(h.calls.some(([name,id])=>name==='searchSupplierHubRegistration'&&id===999),false);assert.equal(manual.manualSearch,'do-not-change');
  const request=h.calls.find(([name])=>name==='app-message');assert.equal(request[1],7);assert.deepEqual(request[3],{frameId:0});
  await h.run();assert.equal(h.calls.filter(([name])=>name==='create').length,1);assert.equal(h.calls.some(([name])=>name==='attachToSupplierHub'||name==='requestSupplierHubValidation'),false);
 }
});

test('both companies advance stale pending or missing local rows from an exact accepted server receipt before fresh SKU lookup',async()=>{
 for(const currentCompany of [company,{code:'A01526306',name:'유앤채'}])for(const state of ['validation-pending','not-found']){
  const accepted=fixture({company:currentCompany}).records.get(`result:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`);
  const rows=Array.from({length:3},(_,index)=>({title:'합성 관측 '+index,submittedAt:'date',category:'cat',barcode:'',sourceQuotation:accepted.filename,skuId:'fresh-'+index,status:'검수중',stage:'확인중'}));
  const h=fixture({company:currentCompany,recover:true,companyMenu:true,closedSource:true,noAttempt:true,saved:{state,quotationId:undefined},receipt:{result:{...accepted,registration:{rows:[{skuId:'must-not-reuse'}]}}},result:{rows,page:{current:1,hasNext:false,signature:JSON.stringify(rows)}}});
  const record=await h.run();assert.equal(record.quotationId,accepted.quotationId);assert.deepEqual(record.registration.rows,rows);
  assert.equal(record.profileId,'profile');assert.equal(record.receiptRecovered,true);assert.deepEqual(record.company,currentCompany);
  const promoted=h.calls.findIndex(([name,action])=>name==='store'&&action==='promote');
  const sourceChecked=h.calls.findIndex(([name,,message])=>name==='app-message'&&message.type==='YOOFAM_VERIFY_QUOTATION_SOURCE');
  const liveCompany=h.calls.findIndex(([name])=>name==='verifySupplierHubCompany'),searched=h.calls.findIndex(([name])=>name==='searchSupplierHubRegistration');
  assert.ok(sourceChecked>=0&&liveCompany>sourceChecked&&promoted>liveCompany&&searched>promoted);
  assert.equal(h.calls.some(([name])=>name==='attachToSupplierHub'||name==='requestSupplierHubValidation'),false);
  assert.equal([...h.records.keys()].some(key=>key.startsWith('transmission:')),false);
 }
});

test('pending recovery preserves old state on unreadable or conflicting receipts, changed source/company, and competing accepted IDs',async()=>{
 const accepted=fixture().records.get(`result:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`);
 for(const patch of [{reply:{ok:false}},{recover:false},{receipt:{result:{...accepted,company:{code:'A01526306',name:'유앤채'}}}},
  {receipt:{result:{...accepted,includedOptions:2}}},{saved:{state:'validation-pending',quotationId:'different'}},
  {saved:{state:'validation-pending',profileId:'different'}},{sourceChangedAt:1},{sourceChangedAt:2},{companyCodes:['A01526306']},
  {concurrent:{quotationId:'newer-accepted'}},{concurrent:{state:'validation-rejected'}}]){
  const h=fixture({recover:true,closedSource:true,noAttempt:true,saved:{state:'validation-pending',quotationId:undefined},receipt:{result:accepted},...patch});
  const before=structuredClone(h.records.get(h.key));await assert.rejects(h.run());
  if(!patch.concurrent)assert.deepEqual(h.records.get(h.key),before);else assert.equal(h.records.get(h.key).quotationId,patch.concurrent.quotationId??accepted.quotationId);
  assert.equal(h.calls.some(([name])=>name==='searchSupplierHubRegistration'||name==='readSupplierHubRegistration'||name==='attachToSupplierHub'||name==='requestSupplierHubValidation'),false);
  assert.equal(h.calls.some(([name,action])=>name==='store'&&action==='put'),false);
  if(patch.reply||patch.recover===false||patch.receipt||patch.sourceChangedAt===1)assert.equal(h.calls.some(([name])=>name==='query'||name==='create'),false);
 }
 for(const saved of [{state:'validation-rejected'},{state:'validation-pending',observedAt:0},{state:'validation-pending',company:{code:company.code,name:'유앤채'}},{state:'validation-pending',registration:{rows:[]}},{state:'not-found',quotationId:'quote...'}]){
  const h=fixture({recover:true,saved,receipt:{result:accepted}}),before=structuredClone(h.records.get(h.key));await assert.rejects(h.run());
  assert.deepEqual(h.records.get(h.key),before);assert.equal(h.calls.some(([name])=>name==='app-message'||name==='query'),false);
 }
});

test('closing the last Hub tab restores the exact receipt into one inactive status tab in the existing app window',async()=>{
 for(const currentCompany of [company,{code:'A01526306',name:'유앤채'}])for(const missingLocal of [false,true]){
  const rows=Array.from({length:3},(_,index)=>({title:'상품',submittedAt:'date',category:'cat',barcode:'',sourceQuotation:'file',skuId:`sku-${index+1}`,status:'검수중',stage:'확인중'}));
  const h=fixture({company:currentCompany,companyMenu:true,recover:true,missingLocal,closedSource:true,noAttempt:true,saved:{profileId:'profile'},result:{rows,page:{current:1,hasNext:false,signature:JSON.stringify(rows)}}});
  const newer={...identity,fingerprint:'b'.repeat(64),company:currentCompany,includedOptions:2,purpose:'registration-status',quotationId:'newer-quote'};
  h.records.set('attempt:123',newer);h.records.set('result:newer',newer);
  const record=await h.run();assert.equal(record.quotationId,'quote-123');assert.equal(record.profileId,'profile');assert.equal(record.receiptRecovered,true);assert.equal(record.registered,false);
  assert.deepEqual(record.registration.rows,rows);assert.equal(record.registration.includedOptions,3);
  assert.deepEqual(h.calls.find(([name])=>name==='create'),['create',{windowId:17,url:'https://supplier.coupang.com/qvt/wims',active:false}]);
  const sourceCheck=h.calls.findIndex(([name,,message])=>name==='app-message'&&message.type==='YOOFAM_VERIFY_QUOTATION_SOURCE'),created=h.calls.findIndex(([name])=>name==='create');
  assert.ok(sourceCheck>=0&&created>sourceCheck);assert.equal(h.pages.get(124).clicks,1);
  assert.deepEqual(h.records.get('attempt:123'),newer);assert.deepEqual(h.records.get('result:newer'),newer);
  assert.equal([...h.records.keys()].some(key=>key.startsWith('transmission:')),false);
  assert.equal(h.calls.some(([name])=>name==='attachToSupplierHub'||name==='requestSupplierHubValidation'),false);
  await h.run();assert.equal(h.calls.filter(([name])=>name==='create').length,1,'the restored status tab is reused');
 }
});

test('closed-last-tab recovery verifies receipt and source before creating, and live login/company before searching',async()=>{
 for(const patch of [{recover:false},{reply:{ok:false}},{receipt:{profileId:'../wrong'}},{sourceChangedAt:1},{sourceChangedAt:2}]){
  const h=fixture({recover:true,missingLocal:true,closedSource:true,noAttempt:true,...patch});await assert.rejects(h.run());
  assert.equal(h.calls.some(([name])=>name==='create'||name==='searchSupplierHubRegistration'),false);assert.equal(h.records.has(h.key),false);
 }
 for(const patch of [{created:{url:'https://supplier.coupang.com/login'}},{created:{windowId:18}},{companyCodes:['A01526306']}]){
  const h=fixture({recover:true,missingLocal:true,closedSource:true,noAttempt:true,...patch});await assert.rejects(h.run());
  assert.equal(h.calls.filter(([name])=>name==='create').length,1);assert.equal(h.calls.some(([name])=>name==='searchSupplierHubRegistration'),false);
  assert.equal(h.records.has(h.key),false);assert.equal(h.records.has('attempt:124'),false);
 }
});

test('an accepted local receipt with closed bindings resumes only when the authenticated app confirms the same ID',async()=>{
 const h=fixture({closedSource:true,recover:true,tabs:[{id:999,windowId:17,url:'https://supplier.coupang.com/qvt/registration'}]});
 assert.equal((await h.run()).registration.quotationId,'quote-123');assert.equal(h.records.get('attempt:123').purpose,undefined);
 const conflict=fixture({closedSource:true,recover:true,tabs:[{id:999,windowId:17,url:'https://supplier.coupang.com/qvt/wims'}],receipt:{result:{...h.records.get(h.key),quotationId:'other'}}});
 await assert.rejects(conflict.run(),/접수 결과가 다릅니다/);assert.equal(conflict.calls.some(([name])=>name==='create'||name==='searchSupplierHubRegistration'),false);
});

test('invalid, stale, foreign or changed app receipts never query Hub tabs or claim a result',async()=>{
 for(const patch of [{recover:false},{receipt:{categoryId:'999'}},{receipt:{profileId:'../profile'}},{reply:{categoryId:'999'}},{reply:{checkedAt:0}},
  {saved:{state:'validation-pending'}},{saved:{quotationId:' other'}},{saved:{includedOptions:201}},{saved:{company:{code:company.code,name:'유앤채'}}},
  {saved:{observedAt:Date.now()+61000}},{appTab:{windowId:18}},{appTab:{url:'https://other.test/'}},{sourceChangedAt:1}]){
  const h=fixture({recover:true,missingLocal:true,...patch});await assert.rejects(h.run());
  assert.equal(h.calls.some(([name])=>['query','create','searchSupplierHubRegistration'].includes(name)),false);
  assert.equal(h.records.has(h.key),false);
 }
 const invalid=fixture({recover:true,saved:{state:'validation-rejected'}});await assert.rejects(invalid.run());assert.equal(invalid.calls.some(([name])=>name==='app-message'),false);
});

test('receipt recovery rejects wrong Hub companies, source changes during search and competing IDs without uploading',async()=>{
 for(const patch of [{companyCodes:['A01526306']},{sourceChangedAt:2},{sourceChangeAfterSearch:true},{concurrent:{quotationId:'other'}}]){
  const h=fixture({recover:true,missingLocal:true,noAttempt:true,...patch});await assert.rejects(h.run());
  assert.equal(h.records.get(h.key)?.registration,undefined);assert.equal(h.calls.some(([name])=>name==='attachToSupplierHub'||name==='requestSupplierHubValidation'),false);
  assert.equal(h.calls.some(([name,id])=>['verifySupplierHubCompany','supplierHubStatusReady','searchSupplierHubRegistration','readSupplierHubRegistration'].includes(name)&&id===123),false,'the unrelated unbound working form is never read or changed');
  if(patch.companyCodes){
   assert.deepEqual(h.calls.filter(([name])=>name==='create'),[['create',{windowId:17,url:'https://supplier.coupang.com/qvt/wims',active:false}]]);
   assert.equal(h.calls.some(([name])=>name==='searchSupplierHubRegistration'),false);assert.equal(h.records.has(h.key),false);assert.equal(h.records.has('attempt:124'),false);
   assert.equal(h.calls.some(([name,action])=>name==='store'&&['put','claim','promote','register'].includes(action)),false,'fresh live company verification precedes any receipt/binding write');
  }else if(patch.sourceChangedAt)assert.equal(h.calls.some(([name])=>name==='create'||name==='searchSupplierHubRegistration'),false);
  else if(patch.concurrent){assert.equal(h.calls.filter(([name])=>name==='create').length,1);assert.equal(h.calls.some(([name])=>name==='searchSupplierHubRegistration'),false);}
 }
});

// Actual API/SQLite, serialized app bridge/worker, transactional store and
// serialized visible DOM readers. Every ID, SKU and physical value below is a
// synthetic fixture; no browser, supplier write or provider call is performed.
function boundaryStore(){
 const rows=new Map();let serial=Promise.resolve();
 const db={close(){},transaction(_name,mode){const operations=[],tx={objectStore:()=>({
  get(key){const request={};operations.push(()=>{request.result=structuredClone(rows.get(key));request.onsuccess?.();});return request;},
  put(value,key){const request={};operations.push(()=>{assert.equal(mode,'readwrite');rows.set(key,structuredClone(value));request.result=key;request.onsuccess?.();});return request;},
 })};serial=serial.then(()=>{try{while(operations.length)operations.shift()();tx.oncomplete?.();}catch(error){tx.error=error;tx.onerror?.();}});return tx;}};
 const indexedDB={open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}};
 const context=vm.createContext({indexedDB,URL,Date});vm.runInContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-store.mjs',import.meta.url),'utf8').replace(/export (const|async function|function) /g,'$1 '),context);
 return {rows,record:(...args)=>context.transferRecord(...args)};
}
function boundaryStatus(company,quotationId,filename){
 let menuOpen=false,observer,searches=0,visibleRows=[];
 const show=()=>[{}],headings=['상품명','상품 등록일','카테고리','바코드','원본 견적서','견적서 ID','SKU ID','상태','등록 진행 단계'];
 const fresh=Array.from({length:6},(_,index)=>['합성 SKU '+index,'2026-10-06','합성 양식','',''+filename,quotationId,'synthetic-fresh-'+company.code+'-'+index,'상품 검수중','가격/정책']);
 const table={getClientRects:show,contains:node=>node===table,querySelectorAll:selector=>selector==='thead th'?headings.map(innerText=>({innerText})):visibleRows.map(values=>({getClientRects:show,querySelectorAll:()=>values.map((value,index)=>({innerText:[5,6].includes(index)?value.slice(0,8)+'...':value,querySelectorAll:()=>[5,6].includes(index)?[{getClientRects:show,getAttribute:()=>value}]:[]}))}))};
 class Input {get value(){return this.current??'';}set value(value){this.current=value;}}
 const input=new Input();Object.assign(input,{isConnected:true,disabled:false,readOnly:false,getClientRects:show,dispatchEvent(){}});
 const filters=new Map(['input#productName','input#barcode','input#skuId','input#sourcingChannelId','select#state','select#progress','input#isReplyNeeded'].map(selector=>[selector,{value:'',type:selector.endsWith('isReplyNeeded')?'checkbox':'text',checked:false,getClientRects:show}]));
 const menu={innerText:company.name,disabled:false,getClientRects:show,click(){menuOpen=!menuOpen;}},reset={innerText:'재설정',getClientRects:show,getAttribute:()=>null,click(){input.value='';}},search={innerText:'검색',isConnected:true,getClientRects:show,getAttribute:()=>null,click(){searches++;visibleRows=fresh;observer?.([{type:'childList',target:table,addedNodes:[]}]);}};
 const current={innerText:'1',getClientRects:show},last={innerText:'다음',disabled:true,getClientRects:show,getAttribute:()=>null,closest:()=>null},pager={getClientRects:show,matches:selector=>selector==='.pagination',contains:()=>false,querySelectorAll:selector=>selector.includes('aria-current')?[current]:[last]};
 const document={body:{get innerText(){return company.name+(menuOpen?'\nCompany Code: '+company.code:'');}},documentElement:{dataset:{}},querySelectorAll(selector){
  if(selector==='button')return [menu,reset,search];if(selector==='table')return [table];if(selector==='input[id="quotationFile"][name="quotationFile"][type="text"]')return [input];if(selector==='label[for="quotationFile"]')return [{innerText:'견적서 ID',getClientRects:show}];if(filters.has(selector))return [filters.get(selector)];if(selector.startsWith('.pagination'))return [pager];return [];
 }};
 return {get searches(){return searches;},script:async(func,args=[])=>vm.runInNewContext(`(${func.toString()})(...args)`,{document,args,URL,HTMLInputElement:Input,Event:class{},location:{origin:'https://supplier.coupang.com',pathname:'/qvt/wims'},MutationObserver:class{constructor(callback){observer=callback;}observe(){}disconnect(){observer=undefined;}},setTimeout:(callback,ms)=>{if(ms!==8000)queueMicrotask(callback);return callback;},clearTimeout(){}})};
}

for(const currentCompany of [company,{code:'A01526306',name:'유앤채'}])test(`actual API and serialized worker recover a lost preflight reply then a server accepted receipt over local pending (${currentCompany.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:currentCompany.code,companyName:currentCompany.name});try{
  const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
  const fields=['skuId','categoryId',...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)],workbook=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 전송 복구 경계',categoryId:'80719',categoryPath:h.context.category.categoryPath,template:{name:'synthetic.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,content=(await json(await h.route(base+'/content'))).content,images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{model:'SYNTHETIC',material:'나일론'},assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
  const view=await json(await h.route(base+'/quotation-fields'));
  await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},{fieldKey:'packagedWeightG',optionId:null,value:'420'},{fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},{fieldKey:'storageMaterial',optionId:null,value:''}]}}));
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:'cat'}}));assert.equal(preview.submissionReview.errorCount,0);assert.equal(preview.report.rowCount,6);
  const originalSources={product:h.sqlite.prepare('SELECT * FROM products').all(),content:h.sqlite.prepare('SELECT * FROM product_content').all(),options:h.sqlite.prepare('SELECT * FROM product_options').all(),fields:h.sqlite.prepare('SELECT * FROM product_quotation_fields').all()};
  const origin='http://localhost:3000',identity={origin,productId:product.id,categoryId:'80719',fingerprint:preview.fingerprint},sender={frameId:0,url:origin+'/',tab:{id:7,windowId:17}},store=boundaryStore(),calls=[],listeners=new Set();
  let contentListener,workerListener,dropPreflightReply=true,statusPage;
  const tabs=[{id:123,windowId:17,url:'https://supplier.coupang.com/qvt/registration',status:'complete'}];
  const win={location:{origin},addEventListener(type,listener){if(type==='message')listeners.add(listener);},removeEventListener(type,listener){if(type==='message')listeners.delete(listener);},postMessage(data){queueMicrotask(()=>{for(const listener of [...listeners])void listener({source:win,origin,data});});}};
  const fetcher=async(path,init={})=>{calls.push(['api',path,init.method??'GET']);const response=await h.route(path,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});Object.defineProperty(response,'url',{value:origin+path});return response;};
  const api={tabs:{query:async query=>{calls.push(['tabs',query]);return tabs.filter(tab=>new URL(tab.url).pathname==='/qvt/registration'||new URL(tab.url).pathname==='/qvt/wims');},get:async id=>id===7?{id,windowId:17,url:origin+'/'}:tabs.find(tab=>tab.id===id),create:async value=>{const tab={id:124,status:'complete',...value};tabs.push(tab);return tab;},sendMessage:async(id,message,frame)=>{assert.equal(id,7);assert.deepEqual(frame,{frameId:0});return new Promise(resolve=>assert.equal(contentListener(message,{id:'extension'},resolve),true));}},scripting:{executeScript:async request=>{
   calls.push(['script',request.func.name]);
   if(new URL(tabs.find(tab=>tab.id===request.target.tabId).url).pathname==='/qvt/registration')return [{result:await vm.runInNewContext(`(${request.func.toString()})(...args)`,{args:request.args,location:{origin:'https://supplier.coupang.com',pathname:'/qvt/registration'},document:{body:{innerText:'Company Code: '+(currentCompany.code===company.code?'A01526306':company.code)}}})}];
   return [{result:await statusPage.script(request.func,request.args)}];
  }}};
  const contentContext={window:win,location:win.location,URL,Date,AbortController,setTimeout,clearTimeout,fetch:fetcher,chrome:{runtime:{id:'extension',getManifest:()=>JSON.parse(fs.readFileSync(new URL('../extensions/supplier-hub/manifest.json',import.meta.url),'utf8')),onMessage:{addListener(listener){contentListener=listener;}},sendMessage:async message=>{
   const reply=await new Promise(resolve=>assert.equal(workerListener(message,sender,resolve),true));calls.push(['worker',message.type,reply]);
   if(dropPreflightReply&&reply.result?.state==='not-started'){dropPreflightReply=false;throw Error('합성 시험: 확정된 전송 전 오류 응답 유실');}return reply;
  }}}};
  vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),contentContext);
  vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-worker.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,''),{chrome:{runtime:{onMessage:{addListener(listener){workerListener=listener;}}}},resultKey,validateAppHubRequest,transferRecord:store.record,
   transmitSupplierHubPackage:(message,who)=>transmitSupplierHubPackage(message,who,api,store.record),refreshSupplierHubRegistration:(message,who)=>refreshSupplierHubRegistration(message,who,api,store.record)});
  const native=createRequire(import.meta.url),slots=[],modules=new Map();let cursor=0;
  const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>slots[index]=typeof value==='function'?value(slots[index]):value];},useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];},useEffect(){cursor++;}};
  function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,window:win,crypto:webcrypto,Uint8Array,btoa,Error,AbortController,URL,setTimeout,clearTimeout,fetch:fetcher,require(name){if(name==='react')return hooks;if(name==='@/app/components/quotation-review-issues')return {QuotationReviewIssues:'issues'};if(name==='@/app/components/legal-documents-editor')return {LegalDocumentsEditor:'legal-documents'};return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});return exports;}
  const Component=load('app/components/submission-package.tsx').SubmissionPackage,nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[],render=()=>{cursor=0;return Component({productId:product.id,profileId:'cat',categoryId:'80719',onInspect(){}});},button=label=>nodes(render()).find(node=>node.type==='button'&&node.props.children===label);
  const click=async label=>{const target=button(label);assert.ok(target&&!target.props.disabled,label);target.props.onClick();const deadline=Date.now()+10000;while(render().props['aria-busy']){assert.ok(Date.now()<deadline,'fixture UI completion');await new Promise(resolve=>setTimeout(resolve,1));}};
  const choose=()=>{for(const input of nodes(render()).filter(node=>node.type==='input'))input.props.onChange({target:{checked:true}});};
  await click('견적서 + 첨부 파일 준비');choose();await click('등록 전송');
  assert.equal(calls.find(([name,type])=>name==='worker'&&type==='YOOFAM_TRANSMIT_PACKAGE')[2].result.state,'not-started');assert.equal(store.rows.size,0);assert.equal(button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
  await click('견적서 + 첨부 파일 준비');choose();const retriable=button('등록 전송');assert.ok(retriable,'a lost preflight acknowledgement must unlock after fresh source and two verified empty receipt stores');assert.equal(retriable.props.disabled,false);
  const quotationId='synthetic-accepted-'+currentCompany.code,accepted={state:'validation-complete',filename:preview.filename,company:currentCompany,includedOptions:6,quotationId,observedAt:Date.now(),registered:false};
  await json(await h.route(base+'/supplier-hub-receipt',{method:'POST',body:{profileId:'cat',categoryId:'80719',fingerprint:preview.fingerprint,result:accepted}}));
  await store.record('put',resultKey(identity),{...identity,...accepted,state:'validation-pending',quotationId:''});
  tabs.length=0;statusPage=boundaryStatus(currentCompany,quotationId,preview.filename);slots.length=0;
  await click('견적서 + 첨부 파일 준비');assert.equal(button('전송 시도됨 · 검증 결과 확인').props.disabled,true);await click('견적서 ID로 상품별 등록 상태 조회');
  assert.equal(statusPage.searches,1);assert.equal(nodes(render()).filter(node=>node.type==='td'&&String(node.props.children).startsWith('synthetic-fresh-')).length,6);
  const receipt=await json(await h.route(base+'/supplier-hub-receipt?fingerprint='+preview.fingerprint));assert.equal(receipt.receipt.result.quotationId,quotationId);assert.equal(receipt.receipt.result.registration.rows.length,6);assert.equal(receipt.receipt.result.registered,false);
  assert.deepEqual(Array.from(receipt.receipt.result.registration.rows,row=>row.skuId),Array.from({length:6},(_,index)=>'synthetic-fresh-'+currentCompany.code+'-'+index));
  assert.equal(calls.filter(([name,type])=>name==='worker'&&type==='YOOFAM_TRANSMIT_PACKAGE').length,1);assert.equal(calls.some(([name,type])=>name==='script'&&['attachToSupplierHub','requestSupplierHubValidation'].includes(type)),false);
  assert.deepEqual({product:h.sqlite.prepare('SELECT * FROM products').all(),content:h.sqlite.prepare('SELECT * FROM product_content').all(),options:h.sqlite.prepare('SELECT * FROM product_options').all(),fields:h.sqlite.prepare('SELECT * FROM product_quotation_fields').all()},originalSources);
  slots.length=0;await click('견적서 + 첨부 파일 준비');assert.equal(nodes(render()).filter(node=>node.type==='td'&&String(node.props.children).startsWith('synthetic-fresh-')).length,6);assert.equal(statusPage.searches,1,'reopening reads the stored receipt without a new Hub query');
 }finally{h.close();}
});
