import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshSupplierHubRegistration} from '../extensions/supplier-hub/app-registration.mjs';
import {verifySupplierHubCompany} from '../extensions/supplier-hub/company.mjs';
import {supplierHubStatusReady} from '../extensions/supplier-hub/hub-tab.mjs';
import {searchSupplierHubRegistration} from '../extensions/supplier-hub/registration-search.mjs';
import {readSupplierHubRegistration} from '../extensions/supplier-hub/registration-result.mjs';

const identity={origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64)};
const company={code:'A01464742',name:'와이홉'};
const message={...identity,type:'YOOFAM_REFRESH_REGISTRATION'};
const sender={frameId:0,url:'http://localhost:3000/',tab:{id:7,windowId:17}};
function fixture(options={}){
 const calls=[],records=new Map();let companyChecks=0,resultReads=0;
 const source={id:123,windowId:17,url:'https://supplier.coupang.com/qvt/registration',status:'complete',...options.source};
 const tabs=[source,...(options.tabs||[])];
 records.set('attempt:123',{...identity,company,includedOptions:3,...options.attempt});
 const key=`result:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`;
 records.set(key,{...identity,company,includedOptions:3,filename:`YOOFAM-${identity.fingerprint}.xlsx`,quotationId:'quote-123',state:'validation-complete',observedAt:Date.now(),registered:false,...options.saved});
 const row={title:'상품',submittedAt:'date',category:'cat',barcode:'',sourceQuotation:'file',skuId:'sku',status:'검수중',stage:'확인중'};
 const api={tabs:{query:async query=>{calls.push(['query',query]);return tabs;},get:async id=>{
  const tab=tabs.find(tab=>tab.id===id);return options.moved&&id===124?{...tab,windowId:18}:tab;
 },create:async value=>{calls.push(['create',value]);const tab={id:124,status:'complete',...value,...options.created};tabs.push(tab);return tab;}},scripting:{executeScript:async request=>{
  calls.push([request.func.name,request.target.tabId,request.args]);
  if(request.func===verifySupplierHubCompany)return [{result:{code:options.companyCodes?.[companyChecks++]??company.code}}];
  if(request.func===supplierHubStatusReady)return [{result:true}];
  if(request.func===searchSupplierHubRegistration){await options.onSearch?.();return [{result:{state:'search-complete',quotationId:'quote-123',registered:false,...options.search}}];}
  if(request.func===readSupplierHubRegistration){resultReads++;if(options.changeSaved&&(!options.changeAfter||resultReads>=options.changeAfter))records.set(key,{...records.get(key),...options.changeSaved});return [{result:{quotationId:'quote-123',scope:'visible-page',registered:false,rows:[row],page:{current:null,hasNext:null,signature:JSON.stringify([row])},...options.result,...options.pages?.[resultReads-1]}}];}
  throw Error('unexpected script');
 }}};
 const store=async(action,key,value)=>{calls.push(['store',action,key]);if(action==='put')records.set(key,value);return records.get(key);};
 return {calls,records,key,tabs,run:(who=sender,patch={})=>refreshSupplierHubRegistration({...message,...patch},who,api,store)};
}
test('app searches the saved exact quotation ID in an inactive tab in its existing Chrome window and reuses it',async()=>{
 const h=fixture();const first=await h.run();
 assert.equal(first.registration.quotationId,'quote-123');assert.equal(first.registration.includedOptions,3);assert.equal(first.registration.rows[0].skuId,'sku');assert.equal(first.registered,false);
 assert.deepEqual(h.calls.find(([name])=>name==='query'),['query',{windowId:17}]);
 assert.deepEqual(h.calls.find(([name])=>name==='create'),['create',{windowId:17,url:'https://supplier.coupang.com/qvt/wims',active:false}]);
 assert.deepEqual(h.calls.find(([name])=>name==='searchSupplierHubRegistration'),['searchSupplierHubRegistration',124,['quote-123',true]]);
 assert.equal(h.tabs[0].url,'https://supplier.coupang.com/qvt/registration','original upload tab untouched');
 assert.equal(h.records.get('attempt:123').purpose,undefined);assert.equal(h.records.get('attempt:124').purpose,'registration-status');
 await h.run();assert.equal(h.calls.filter(([name])=>name==='create').length,1);assert.equal(h.calls.filter(([name])=>name==='searchSupplierHubRegistration').length,2);
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
