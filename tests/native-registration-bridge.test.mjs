import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {querySupplierHubNativeRegistrations} from '../extensions/supplier-hub/native-registration-page.mjs';
import {readAppNativeRegistrations} from '../extensions/supplier-hub/native-registration.mjs';
const plain=value=>JSON.parse(JSON.stringify(value)),companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}],origin='http://localhost:3000';
const scope=(company=companies[0])=>({productId:'new-synthetic-product',requestId:'11111111-1111-4111-8111-111111111111',identityDigest:'a'.repeat(64),preparedBodySha256:'b'.repeat(64),docId:73,qvtRequestId:81,sourceStatus:'FINISHED',company,ownerId:'approved-owner',categoryId:'69617',membersCount:2,recordedAt:new Date().toISOString(),receiptObservedAt:Date.now()-60000,sourceProductVersion:new Date(Date.now()-86400000).toISOString()});
const row=(changes={})=>({qvtRequestId:81,scope:'SIMPLE_REGISTRATION',quotationId:'CID-22222222-2222-4222-8222-222222222222',skuId:'1001',productName:'합성 검수 상품',state:'INSPECTION',...changes});
function pageHarness(value=scope(),options={}){
 const calls=[],timers=new Set();let vendorReads=0,pageReads=0,company=value.company.code;
 const context={scope:value,location:{origin:'https://supplier.coupang.com',pathname:'/qvt/wims'},document:{body:{get innerText(){return 'Company Code: '+company;}}},Date,AbortController,TextEncoder,TextDecoder,Uint8Array,
  setTimeout(fn){timers.add(fn);return fn;},clearTimeout(fn){timers.delete(fn);},fetch:async(url,request)=>{calls.push({url,request});const vendor=url.endsWith('/qvt/vendor/id'),page=vendor?null:JSON.parse(request.body),items=options.pages?.[pageReads]??options.items??[row(),row({skuId:null})];
   let payload=vendor?(options.vendors?.[vendorReads++]??value.company.code):{items,pageNavigator:{currentPage:++pageReads,elementCountPerPage:50,totalElements:options.total??items.length}};
   if(options.mutate)payload=options.mutate(payload,{vendor,page,pageReads});if(options.companyAfterRead===calls.length)company=companies[1].code;
   const text=options.raw?.(payload,{vendor})??JSON.stringify(payload),headers={'content-type':vendor?(options.vendorType??'application/json'):'application/json',...(options.length?{'content-length':options.length}:{})};
   return{ok:true,status:200,redirected:options.redirected??false,url:options.responseUrl??url,headers:{get:key=>headers[key]??null},text:async()=>text};}};
 return {calls,timers,run:()=>vm.runInNewContext(`(${querySupplierHubNativeRegistrations.toString()})(scope)`,context)};
}
test('native bridge queries only exact request ID for both approved companies; file/SKU observations stay unregistered and members unmatched',async()=>{
 for(const company of companies){const h=pageHarness(scope(company),{items:[row({qvtRequestId:'81',skuId:'wrong-type'}),row(),row({skuId:null})]}),result=await h.run();assert.equal(result.total,2);assert.equal(result.optionMapping,'unverified');assert.equal(result.registered,false);assert.equal(result.mutated,false);assert.equal(result.rows[0].quotationId,'22222222-2222-4222-8222-222222222222');assert.equal(result.rows[1].skuId,null);assert.equal(h.timers.size,0);const post=h.calls.find(call=>call.request.method==='POST'),body=JSON.parse(post.request.body);assert.equal(post.url,'https://supplier.coupang.com/qvt/v2/wims/vendorSearch');assert.deepEqual(body.conditions,{vendorId:company.code,state:'',skuId:'',sourcingChannelId:'',quotationId:'',estimationId:'',progress:'',productName:'',categoryCode:'',barcode:'',isReplyNeeded:false,imageAuthStatus:''});assert.match(body.startDate,/^\d+000$/);assert.match(body.endDate,/^\d+000$/);assert.equal(body.sizePerPage,50);assert.equal(body.page,1);assert.equal(h.calls.length,3);}
});
test('bounded plain vendor code is supported without accepting HTML or vendor objects',async()=>{
 for(const vendorType of ['application/json','text/plain; charset=utf-8']){const h=pageHarness(scope(),{vendorType,raw:(payload,{vendor})=>vendor?payload:JSON.stringify(payload)});assert.equal((await h.run()).total,2);}
 for(const options of [{vendorType:'text/html'},{vendors:[companies[1].code]},{vendors:[companies[0].code,companies[1].code]},{vendors:[{vendorId:companies[0].code}]},{raw:(payload,{vendor})=>vendor?'<html>login</html>':JSON.stringify(payload)}])await assert.rejects(pageHarness(scope(),options).run());
});
test('same request rows across every bounded page join, unrelated quotation/request aliases never join',async()=>{
 const first=Array.from({length:50},(_,index)=>row({qvtRequestId:1000+index,skuId:'unrelated-'+index})),last=[row()];
 const h=pageHarness(scope(),{pages:[first,last],total:51}),result=await h.run();assert.equal(result.pagesRead,2);assert.equal(result.total,1);assert.equal(h.calls.filter(call=>call.request.method==='POST').length,2);
 const none=await pageHarness(scope(),{items:[row({qvtRequestId:'81'}),row({qvtRequestId:99,quotationId:'CID-00000081-2222-4222-8222-222222222222'})]}).run();assert.equal(none.total,0);
});
test('later receipt refresh cannot move the query start past the original source day',async()=>{
 const value={...scope(),sourceProductVersion:'2026-01-31T16:00:00.000Z'},h=pageHarness(value);await h.run();const body=JSON.parse(h.calls.find(call=>call.request.method==='POST').request.body);assert.equal(body.startDate,String(Date.parse('2026-02-01T00:00:00+09:00')));
 const invalid=pageHarness({...scope(),sourceProductVersion:'2999-01-01T00:00:00.000Z'});await assert.rejects(invalid.run());assert.equal(invalid.calls.length,0);
});
test('a repeated non-target row at the page boundary cannot hide the requested file behind a false empty result',async()=>{
 const first=Array.from({length:50},(_,index)=>row({qvtRequestId:1000+index,skuId:String(2000+index)}));
 // Exact fallback fingerprint is key-order independent when no native ID exists.
 const reordered=Object.fromEntries(Object.entries(first[0]).reverse());
 for(const repeated of [first[0],reordered])await assert.rejects(pageHarness(scope(),{pages:[first,[repeated]],total:51}).run(),/중복/);
 // The observed native row identity also rejects a stale row whose status changed.
 const identified=first.map((item,index)=>({...item,uniqueItemId:'native-row-'+index}));
 await assert.rejects(pageHarness(scope(),{pages:[identified,[{...identified[0],state:'INSPECTION_COMPLETE'}]],total:51}).run(),/중복/);
 const valid=pageHarness(scope(),{pages:[identified,[row({uniqueItemId:'native-row-50'})]],total:51});assert.equal((await valid.run()).total,1);
});
test('duplicate SKU, excess matching members, unsupported raw identity/status and malformed pagination fail without partial success',async()=>{
 const variants=[{items:[row(),row()]},{items:[row(),row({skuId:'1002'}),row({skuId:'1003'})]},{items:[row({quotationId:'81'})]},{items:[row({quotationId:'22222222-2222-4222-8222-222222222222'})]},{items:[row({skuId:42})]},{items:[row({skuId:'abc...'})]},{items:[row({skuId:'sku-1'})]},{items:[row({skuId:'0'})]},{items:[row({state:'UNKNOWN'})]},{items:[row({productName:''})]},{items:[row({productName:' padded'})]},{items:[row({productName:'a\nb'})]},{total:2001},{items:[],total:1},{mutate:(payload,{vendor})=>vendor?payload:{...payload,pageNavigator:{...payload.pageNavigator,currentPage:2}}},{mutate:(payload,{vendor})=>vendor?payload:{data:payload}}];
 for(const options of variants){const h=pageHarness(scope(),options);await assert.rejects(h.run());assert.equal(h.timers.size,0);}
});
test('redirects, HTML, oversized body and a company switch during a response are not observations',async()=>{
 for(const options of [{redirected:true},{responseUrl:'https://supplier.coupang.com/login'},{length:String(4*1024*1024+1)},{companyAfterRead:2},{raw:(payload,{vendor})=>vendor?JSON.stringify(payload):' '.repeat(4*1024*1024+1)}])await assert.rejects(pageHarness(scope(),options).run());
});
test('same request ID in an absent or different native scope cannot establish a Quick Listing SKU relationship',async()=>{
 for(const nativeScope of [undefined,'Retail_Categorized_Excel','Retail_Categorized_Single','CBQF',''])await assert.rejects(pageHarness(scope(),{items:[row({scope:nativeScope})]}).run());
});
function workerHarness(options={}){
 const original=scope(),calls=[],sender={frameId:0,url:origin+'/',tab:{id:1,windowId:7}},tabs=new Map([[1,{id:1,windowId:7,url:sender.url}],[2,{id:2,windowId:7,url:'https://supplier.coupang.com/dashboard/KR'}]]);let reads=0;
 const api={tabs:{async get(id){return options.changeTab?.(id)??tabs.get(id);},async query(value){calls.push(['query',value]);return options.tabs??[tabs.get(2)];},async sendMessage(id,message){calls.push(['scope',id,message]);return options.scopes?.[reads++]??{ok:true,scope:original};},async create(value){calls.push(['create',value]);const tab={id:3,status:'complete',...value};tabs.set(3,tab);return tab;},async remove(id){calls.push(['remove',id]);tabs.delete(id);}},scripting:{async executeScript({target,func}){calls.push(['script',target.tabId,func.name]);if(func.name==='supplierHubStatusReady')return[{result:true}];if(func.name==='verifySupplierHubCompany')return[{result:{code:options.observedCode??original.company.code}}];return[{result:options.result?.(original)??{source:'supplier-hub-native-registration-v1',...original,rows:[],total:0,pagesRead:1,registered:false,mutated:false,optionMapping:'unverified',observedAt:Date.now()}}];}}};
 const message={type:'YOOFAM_QUERY_NATIVE_REGISTRATIONS',productId:original.productId,requestId:original.requestId,identityDigest:original.identityDigest,preparedBodySha256:original.preparedBodySha256};return{calls,sender,tabs,message,run:()=>readAppNativeRegistrations(message,sender,api),original};
}
test('worker resolves authenticated receipt first, opens only a same-window owned read tab and preserves old tabs',async()=>{
 const h=workerHarness(),result=await h.run();assert.equal(result.total,0);assert.equal(h.calls[0][0],'scope');assert.equal(h.calls[0][2].type,'YOOFAM_READ_NATIVE_RECEIPT_SCOPE');assert.equal(h.tabs.has(2),true);assert.equal(h.tabs.has(3),false);assert.deepEqual(h.calls.find(call=>call[0]==='create')[1],{windowId:7,url:'https://supplier.coupang.com/qvt/wims',active:false});assert.equal(h.calls.some(call=>call[0]==='script'&&/submit|attach|agreement|capture/i.test(call[2])),false);
});
test('missing/rebound authenticated receipt, wrong company/window and altered output never reach or escape the read bridge',async()=>{
 const s=scope();for(const options of [{scopes:[{ok:false,error:'missing'}]},{scopes:[{ok:true,scope:s},{ok:true,scope:{...s,ownerId:'other'}}]},{observedCode:companies[1].code},{tabs:[{id:2,windowId:8,url:'https://supplier.coupang.com/qvt/wims'}]},{result:value=>({...value,source:'supplier-hub-native-registration-v1',rows:[],total:0,pagesRead:1,registered:true,mutated:false,optionMapping:'unverified'})}]){const h=workerHarness(options);await assert.rejects(h.run());assert.equal(h.tabs.has(2),true);}
 const missing=workerHarness({scopes:[{ok:false}]});await assert.rejects(missing.run());assert.equal(missing.calls.some(call=>call[0]==='query'||call[0]==='create'||call[0]==='script'),false);
});
test('invalid app frame and untrusted extra request identity are rejected before any access',async()=>{
 for(const mutate of [h=>{h.sender.frameId=1;},h=>{h.message.qvtRequestId=81;},h=>{h.message.requestId='not-request';}]){const h=workerHarness();mutate(h);await assert.rejects(h.run());assert.equal(h.calls.length,0);}
});
function contentHarness(options={}){
 const s=scope(),member={optionId:'o1',optionLabel:'합성 옵션',documentIndex:0},receipt={format:'yoofam-product-document-receipt-v1',recordType:'product-document',evidence:'chrome-observation',registered:false,productId:s.productId,requestId:s.requestId,identityDigest:s.identityDigest,preparedBodySha256:s.preparedBodySha256,docId:s.docId,company:s.company,categoryId:s.categoryId,members:[member],recordedAt:s.recordedAt,identity:{origin,ownerId:s.ownerId,company:s.company,productId:s.productId,categoryId:s.categoryId,members:[member]},receipt:{docId:s.docId,qvtRequestId:s.qvtRequestId,receiptId:s.qvtRequestId,company:s.company,identityDigest:s.identityDigest,preparedBodySha256:s.preparedBodySha256,sourceStatus:'FINISHED',state:'accepted',evidence:'document-receipt',registered:false,observedAt:s.receiptObservedAt}},calls=[];let contexts=0;
 receipt.source={productVersion:s.sourceProductVersion};receipt.identity.source=receipt.source;
 const record=options.record?.(plain(receipt))??receipt,context=vm.createContext({location:{origin},window:{addEventListener(){}},chrome:{runtime:{id:'extension',onMessage:{addListener(){}}}},AbortController,TextEncoder,URL,Date,setTimeout,clearTimeout,fetch:async path=>{calls.push(path);let body;if(path==='/api/supplier-hub/catalog-context')body=options.contexts?.[contexts++]??{ownerId:s.ownerId,company:s.company};else body={format:'yoofam-native-receipt-history-v1',productId:s.productId,receipts:options.records??[record]};return{ok:true,redirected:false,url:origin+path,headers:{get:()=>options.contentType??'application/json'},text:async()=>JSON.stringify(body)};}});
 vm.runInContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),context);
 return {calls,run:()=>vm.runInContext('readCurrentNativeReceiptScope(expected)',Object.assign(context,{expected:{origin,productId:s.productId,requestId:s.requestId,identityDigest:s.identityDigest,preparedBodySha256:s.preparedBodySha256}})),receipt};
}
test('app content selects exactly one authenticated whole-product receipt and never requests Supplier Hub or source URLs',async()=>{
 const h=contentHarness(),result=await h.run();assert.equal(result.scope.docId,73);assert.equal(result.scope.qvtRequestId,81);assert.equal(result.scope.membersCount,1);assert.equal(h.calls.length,3);assert.equal(h.calls.some(path=>path.includes('1688')||path.includes('supplier.coupang.com')),false);
});
test('app content rejects unknown/duplicated receipt, company/member/digest rebinding and non-JSON history',async()=>{
 const base=contentHarness().receipt;
 for(const options of [{records:[]},{records:[base,base]},{record:r=>({...r,identityDigest:'c'.repeat(64)})},{record:r=>({...r,identity:{...r.identity,ownerId:'other'}})},{record:r=>({...r,members:[...r.members,...r.members]})},{record:r=>({...r,receipt:{...r.receipt,qvtRequestId:'81'}})},{contexts:[{ownerId:'approved-owner',company:companies[0]},{ownerId:'other',company:companies[0]}]},{contentType:'text/html'}])await assert.rejects(contentHarness(options).run());
});
