import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshSupplierHubRegistration} from '../extensions/supplier-hub/app-registration.mjs';
import {verifySupplierHubCompany} from '../extensions/supplier-hub/company.mjs';
import {supplierHubStatusReady} from '../extensions/supplier-hub/hub-tab.mjs';
import {searchSupplierHubRegistration} from '../extensions/supplier-hub/registration-search.mjs';
import {readSupplierHubRegistration} from '../extensions/supplier-hub/registration-result.mjs';
import {hubCompanyMenuPage} from './helpers/hub-company-menu.mjs';

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
 const store=async(action,key,value)=>{calls.push(['store',action,key]);if(action==='claim'){if(options.concurrent)records.set(key,{...value,...options.concurrent});if(records.has(key))return false;records.set(key,value);return true;}if(action==='put')records.set(key,value);return records.get(key);};
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
  if(patch.companyCodes||patch.sourceChangedAt||patch.concurrent)assert.equal(h.calls.some(([name])=>name==='create'||name==='searchSupplierHubRegistration'),false);
 }
});
