import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {observeSupplierHubResult} from '../extensions/supplier-hub/observe.mjs';
import {isRecoveredValidationBinding} from '../extensions/supplier-hub/validation-recovery.mjs';
import {canObserveSupplierHubValidation,canObserveSupplierHubRegistration,resultKey} from '../extensions/supplier-hub/handoff-store.mjs';
import {verifySupplierHubCompany} from '../extensions/supplier-hub/company.mjs';
import {readSupplierHubValidation} from '../extensions/supplier-hub/result.mjs';
import {supplierHubUploadReady} from '../extensions/supplier-hub/hub-tab.mjs';
import {supplierHubStatusReady} from '../extensions/supplier-hub/hub-tab.mjs';
import {refreshSupplierHubRegistration} from '../extensions/supplier-hub/app-registration.mjs';
import {searchSupplierHubRegistration} from '../extensions/supplier-hub/registration-search.mjs';
import {readSupplierHubRegistration} from '../extensions/supplier-hub/registration-result.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const identity={origin:'http://localhost:3000',productId:'product',categoryId:'69900',fingerprint:'a'.repeat(64)};
const sender={frameId:0,url:identity.origin+'/',tab:{id:7,windowId:17}};
const message={...identity,type:'YOOFAM_REFRESH_RESULT',kind:'validation'};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};

/** The actual IndexedDB transaction code with a private serialized in-memory
 * object store. No browser profile, cookies, seller data or provider is accessed. */
function memoryStore(){
 const rows=new Map(),writes=[];let queue=Promise.resolve();
 const db={close(){},transaction(_name,mode){const operations=[],tx={objectStore:()=>({
  get(key){const request={};operations.push(()=>{request.result=structuredClone(rows.get(key));request.onsuccess?.();});return request;},
  put(value,key){const request={};operations.push(()=>{assert.equal(mode,'readwrite');writes.push(key);rows.set(key,structuredClone(value));request.result=key;request.onsuccess?.();});return request;},
 })};queue=queue.then(()=>{try{while(operations.length)operations.shift()();tx.oncomplete?.();}catch(error){tx.error=error;tx.onerror?.();}});return tx;}};
 const indexedDB={open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}};
 const context=vm.createContext({indexedDB,URL,Date,TextEncoder});
 vm.runInContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-store.mjs',import.meta.url),'utf8').replace(/export (const|async function|function) /g,'$1 '),context);
 return {rows,writes,record:(...args)=>context.transferRecord(...args)};
}

function fixture(options={}){
 const company=options.company??companies[0],store=memoryStore(),calls=[],pages=new Map();
 const key=resultKey(identity),filename=`YOOFAM-${identity.fingerprint}.xlsx`,observedAt=Date.now()-10000;
 const pending={...identity,profileId:'profile',company,includedOptions:6,filename,state:'validation-pending',observedAt,registered:false};
 const receipt={schemaVersion:1,evidence:'chrome-observation',profileId:'profile',categoryId:identity.categoryId,fingerprint:identity.fingerprint,productVersion:'2026-10-01T00:00:00.000Z',recordedAt:'2026-10-01T00:01:00.000Z',result:pending,...options.receipt};
 const original={...identity,company,includedOptions:6};store.rows.set('attempt:123',original);
 if(options.local!==false)store.rows.set(key,{...pending,...options.local});
 const unrelated={id:999,windowId:17,url:'https://supplier.coupang.com/qvt/registration',status:'complete'};
 const unrelatedAttempt={...identity,productId:'other-product',fingerprint:'b'.repeat(64),company,includedOptions:2};
 store.rows.set('attempt:999',unrelatedAttempt);
 const tabs=options.withWork?[unrelated]:[];let sourceChecks=0,companyChecks=0,created=0;
 const controls={fileState:options.fileState??'validation-pending',quotationId:'fresh-full-quotation-id',failSource:false,registrationCount:6};
 function page(tab){
  const captions=['견적서 명','견적서 등록일','검증 상태','검증 결과','견적서 ID'];
  const status=()=>controls.fileState==='validation-complete'?'완료':controls.fileState==='validation-rejected'?'반려':'진행 중';
  const cells=()=>[filename,'합성 관찰 일시',status(),'합성 검증 결과',controls.fileState==='validation-complete'?controls.quotationId:''].map(innerText=>({innerText,querySelectorAll:()=>[]}));
  const table={getClientRects:()=>[{}],querySelectorAll:selector=>selector==='thead th'?captions.map(innerText=>({innerText})):selector==='tbody tr'&&controls.fileState!=='not-found'?[{querySelectorAll:()=>cells()}]:[]};
  const refresh={innerText:'새로고침',disabled:false,getClientRects:()=>[{}],getAttribute:()=>null,click(){calls.push(['file-table-refresh',tab.id]);}};
  const headings=['작성이 완료된 견적서 Excel 파일을 업로드하십시오.','상품 이미지를 업로드하십시오.','제품 필수 표시사항을 업로드하십시오.'];
  return {body:{get innerText(){return `Company Code: ${options.domCompany??company.code}\n`+headings.join('\n');}},querySelectorAll:selector=>selector==='table'?[table]:selector==='button'?[refresh]:selector==='input[type="file"]'?[{},{},{}]:selector==='input[id="quotationFile"][name="quotationFile"][type="text"]'?[{disabled:false,readOnly:false,getClientRects:()=>[{}]}]:selector==='label[for="quotationFile"]'?[{innerText:'견적서 ID',getClientRects:()=>[{}]}]:[],documentElement:{dataset:{}}};
 }
 const api={runtime:{id:'extension',getURL:name=>`chrome-extension://extension/${name}`},tabs:{
  query:async query=>{calls.push(['query',query]);return query.active?tabs.filter(tab=>tab.active===true):tabs;},
  get:async id=>{calls.push(['get',id]);if(id===7)return {id:7,windowId:17,url:identity.origin+'/',...options.appTab};return {...tabs.find(tab=>tab.id===id),...(options.tabChanges??{})};},
  create:async value=>{calls.push(['create',value]);await options.createWait?.promise;const tab={id:124+created++,status:'complete',...value,...options.created};tabs.push(tab);return tab;},
  update:async()=>{assert.fail('recovery cannot navigate an existing tab');},
  sendMessage:async(id,request,frame)=>{
   calls.push(['app-message',id,request,frame]);
   if(['YOOFAM_READ_TRANSMISSION_RECEIPT','YOOFAM_READ_QUOTATION_RECEIPT','YOOFAM_READ_HISTORICAL_TRANSMISSION_RECEIPT'].includes(request.type))return {ok:true,...request.expected,checkedAt:Date.now(),receipt:options.noReceipt?null:receipt,...options.reply};
   assert.equal(request.type,'YOOFAM_VERIFY_QUOTATION_SOURCE');sourceChecks++;
   return {ok:true,...request.expected,checkedAt:Date.now(),...((controls.failSource||sourceChecks===options.sourceChangedAt)?{fingerprint:'c'.repeat(64)}:{})};
  },
 },scripting:{executeScript:async request=>{
  calls.push(['script',request.func.name,request.target.tabId,request.args]);
  const tab=tabs.find(tab=>tab.id===request.target.tabId);assert.ok(tab);assert.notEqual(tab.id,999,'a different working form must stay untouched');
  if(request.func===searchSupplierHubRegistration)return [{result:{state:'search-complete',quotationId:request.args[0],registered:false}}];
  if(request.func===readSupplierHubRegistration){await options.onRegistrationRead?.({store,controls,calls});const rows=Array.from({length:controls.registrationCount},(_,index)=>({title:'합성 옵션 '+index,submittedAt:'합성 일시',category:'합성 분류',barcode:'',sourceQuotation:filename,skuId:'fresh-sku-'+index,status:'검수 중',stage:'상품 확인 중'}));return [{result:{quotationId:request.args[0],scope:'visible-page',registered:false,rows,page:{current:1,hasNext:false,signature:JSON.stringify(rows)}}}];}
  if(request.func===readSupplierHubValidation)await options.onRead?.({store,controls,calls});
  if(request.func===verifySupplierHubCompany){companyChecks++;if(options.companyChangedAt===companyChecks)return [{result:{code:companies.find(item=>item.code!==company.code).code}}];}
  assert.ok([readSupplierHubValidation,verifySupplierHubCompany,supplierHubUploadReady,supplierHubStatusReady].includes(request.func),'only read-only result/company/readiness scripts are allowed');
  if(!pages.has(tab.id))pages.set(tab.id,page(tab));
  const result=await vm.runInNewContext(`(${request.func.toString()})(...args)`,{args:request.args??[],document:pages.get(tab.id),location:{origin:'https://supplier.coupang.com',pathname:new URL(tab.url).pathname},MutationObserver:class{observe(){}disconnect(){}},setTimeout:callback=>{queueMicrotask(callback);return 1;},clearTimeout(){},Date,URL});
  return [{result}];
 }}};
 const record=async(action,name,value)=>{calls.push(['store',action,name]);if(action==='observe')await options.beforeAtomic?.({store,value,name});if(action==='register')await options.beforeRegistrationAtomic?.({store,value,name});return store.record(action,name,value);};
 return {calls,store,key,receipt,company,tabs,controls,original,unrelatedAttempt,pages,api,record,run:(who=sender,patch={})=>observeSupplierHubResult({...message,...patch},who,api,record)};
}

for(const company of companies)test(`a stored pending receipt recovers a closed upload tab into one read-only result tab (${company.code})`,async()=>{
 const h=fixture({company,withWork:true}),before=plain(h.original),other=plain(h.unrelatedAttempt);
 const first=await h.run();assert.equal(first.state,'validation-pending');assert.equal(first.registered,false);
 assert.deepEqual(h.calls.find(([name])=>name==='create'),['create',{windowId:17,url:'https://supplier.coupang.com/qvt/registration',active:false}]);
 const binding=h.store.rows.get('attempt:124');assert.equal(isRecoveredValidationBinding(binding,identity),true);assert.equal(binding.purpose,'validation-status');assert.equal(binding.validationResume,undefined);assert.equal(binding.attachmentNames,undefined);
 assert.equal(binding.profileId,'profile');assert.equal(binding.includedOptions,6);assert.deepEqual(binding.company,company);assert.equal(binding.filename,`YOOFAM-${identity.fingerprint}.xlsx`);
 assert.deepEqual(h.store.rows.get('attempt:123'),before);assert.deepEqual(h.store.rows.get('attempt:999'),other);assert.equal(h.tabs[0].id,999);assert.equal(h.tabs[0].url,'https://supplier.coupang.com/qvt/registration');
 assert.equal([...h.store.rows.keys()].some(key=>key.startsWith('transmission:')),false);
 const receiptRead=h.calls.findIndex(([name,,request])=>name==='app-message'&&request.type==='YOOFAM_READ_TRANSMISSION_RECEIPT'),create=h.calls.findIndex(([name])=>name==='create');assert.ok(receiptRead>=0&&create>receiptRead);
 h.controls.fileState='validation-complete';const second=await h.run();assert.equal(second.quotationId,h.controls.quotationId);assert.equal(second.state,'validation-complete');assert.equal(h.store.rows.get(h.key).quotationId,h.controls.quotationId);
 assert.equal(h.calls.filter(([name])=>name==='create').length,1,'future checks reuse this exact read-only binding');
 assert.equal(h.calls.filter(([name,action])=>name==='store'&&action==='put').length,0,'new result observations always use conditional storage');
 assert.ok(h.calls.filter(([name])=>name==='script').every(([,name])=>['readSupplierHubValidation','verifySupplierHubCompany','supplierHubUploadReady'].includes(name)));
});

for(const company of companies)test(`the recovered pending file can advance to accepted ID and exact six-SKU lookup without touching another form (${company.code})`,async()=>{
 const h=fixture({company,withWork:true});await h.run();h.controls.fileState='validation-complete';await h.run();
 const accepted=h.store.rows.get(h.key);assert.equal(accepted.state,'validation-complete');assert.equal(accepted.receiptRecovered,undefined,'the CAS result is not implicitly treated as an already re-read server receipt');
 h.receipt.result={...accepted};const before=h.calls.length,other=plain(h.store.rows.get('attempt:999'));
 const result=await refreshSupplierHubRegistration({...identity,type:'YOOFAM_REFRESH_REGISTRATION'},sender,h.api,h.record);
 assert.equal(result.quotationId,h.controls.quotationId);assert.equal(result.registration.rows.length,6);assert.equal(result.registration.includedOptions,6);assert.deepEqual(result.registration.rows.map(row=>row.skuId),Array.from({length:6},(_,index)=>'fresh-sku-'+index));
 const follow=h.calls.slice(before);assert.ok(follow.some(([name,,request])=>name==='app-message'&&request.type==='YOOFAM_VERIFY_QUOTATION_SOURCE'),'a readonly recovered binding still rechecks its exact current source');
 assert.deepEqual(follow.find(([name])=>name==='create'),['create',{windowId:17,url:'https://supplier.coupang.com/qvt/wims',active:false}]);
 assert.ok(follow.filter(([name])=>name==='script').every(([,name,id])=>id!==999&&!['attachToSupplierHub','requestSupplierHubValidation'].includes(name)));
 assert.deepEqual(h.store.rows.get('attempt:999'),other);assert.equal(h.tabs.find(tab=>tab.id===124).url,'https://supplier.coupang.com/qvt/registration');assert.equal(h.store.rows.get('attempt:124').purpose,'validation-status');assert.equal(h.store.rows.get('attempt:125').purpose,'registration-status');
});

for(const company of companies)test(`historical pending A stays readable after draft B changes and advances to six original SKUs without submitting again (${company.code})`,async()=>{
 const h=fixture({company,withWork:true}),other=plain(h.store.rows.get('attempt:999')),original=plain(h.store.rows.get('attempt:123'));
 h.controls.failSource=true;const bKey=resultKey({...identity,fingerprint:'b'.repeat(64)}),b={manualTitle:'수정본 B 보존',manualPrice:'',version:'2026-10-07T00:00:00.000Z'};h.store.rows.set(bKey,b);
 const pending=await h.run(sender,{historical:true});assert.equal(pending.state,'validation-pending');assert.equal(h.store.rows.get(h.key).historicalReceipt,true);
 assert.equal(h.store.rows.get('attempt:124').receiptProductVersion,h.receipt.productVersion);
 h.controls.fileState='validation-complete';const accepted=await h.run(sender,{historical:true});assert.equal(accepted.quotationId,h.controls.quotationId);
 h.receipt.result={...h.store.rows.get(h.key)};
 const result=await refreshSupplierHubRegistration({...identity,type:'YOOFAM_REFRESH_REGISTRATION',historical:true},sender,h.api,h.record);
 assert.equal(result.registration.rows.length,6);assert.equal(result.registration.includedOptions,6);assert.equal(result.quotationId,h.controls.quotationId);
 assert.deepEqual(result.registration.rows.map(row=>row.skuId),Array.from({length:6},(_,index)=>'fresh-sku-'+index));assert.deepEqual(h.store.rows.get(bKey),b);
 assert.deepEqual(h.store.rows.get('attempt:123'),original);assert.deepEqual(h.store.rows.get('attempt:999'),other);
 assert.ok(h.calls.filter(([name])=>name==='app-message').every(([, ,request])=>request.type==='YOOFAM_READ_HISTORICAL_TRANSMISSION_RECEIPT'),'an original receipt read must never export or compare the current changed draft');
 assert.ok(h.calls.filter(([name])=>name==='script').every(([,name,id])=>id!==999&&['verifySupplierHubCompany','supplierHubUploadReady','supplierHubStatusReady','readSupplierHubValidation','searchSupplierHubRegistration','readSupplierHubRegistration'].includes(name)));
 assert.equal([...h.store.rows.keys()].some(key=>key.startsWith('transmission:')),false);
});

test('historical lookup rejects missing server anchor and original metadata mismatches before result writes',async()=>{
 for(const options of [{noReceipt:true},{receipt:{productVersion:'bad clock'}},{receipt:{fingerprint:'b'.repeat(64)}},{receipt:{profileId:'../other'}},{local:{company:companies[1]}},{local:{includedOptions:5}},{appTab:{windowId:18}}]){
  const h=fixture(options),before=plain([...h.store.rows]);h.controls.failSource=true;await assert.rejects(h.run(sender,{historical:true}));assert.deepEqual(plain([...h.store.rows]),before);assert.equal(h.store.writes.length,0);assert.equal(h.calls.some(([name])=>name==='create'),false);
 }
});

test('recovery refuses missing, unreadable or changed pending receipt identity before opening any Hub tab',async()=>{
 const base=fixture().receipt;
 for(const patch of [{noReceipt:true},{reply:{ok:false}},{reply:{checkedAt:0}},{receipt:{categoryId:'999'}},{receipt:{fingerprint:'b'.repeat(64)}},{receipt:{profileId:'../other'}},
  {receipt:{result:{...base.result,state:'validation-complete',quotationId:'accepted'}}},{receipt:{result:{...base.result,state:'validation-rejected'}}},
  {receipt:{result:{...base.result,company:{code:'A01464742',name:'유앤채'}}}},{receipt:{result:{...base.result,includedOptions:0}}},
  {sourceChangedAt:1},{sourceChangedAt:2},{appTab:{windowId:18}},{appTab:{url:'https://other.test/'}},{appTab:{pendingUrl:'https://other.test/'}},
  {local:{company:companies[1]}},{local:{includedOptions:5}},{local:{profileId:'other-profile'}},{local:{state:'validation-rejected'}},
 ]){
  const h=fixture(patch),before=plain([...h.store.rows]);await assert.rejects(h.run());assert.equal(h.calls.some(([name])=>name==='create'),false);assert.deepEqual(plain([...h.store.rows]),before);assert.equal(h.store.writes.length,0);
 }
});

test('new tabs still require the original window, live login/company and unchanged source before a binding or result is saved',async()=>{
 for(const patch of [{created:{windowId:18}},{created:{url:'https://supplier.coupang.com/login'}},{tabChanges:{windowId:18}},{tabChanges:{pendingUrl:'https://supplier.coupang.com/login'}},
  {domCompany:'A01526306'},{sourceChangedAt:3},{sourceChangedAt:4},{companyChangedAt:1},
 ]){
  const h=fixture(patch),before=plain([...h.store.rows]);await assert.rejects(h.run());assert.equal(h.calls.filter(([name])=>name==='create').length,1);assert.deepEqual(plain([...h.store.rows]),before);assert.equal(h.store.writes.length,0);
  assert.equal(h.calls.some(([name,script])=>name==='script'&&script==='readSupplierHubValidation'),false);
 }
});

test('a source change during the recovered file read preserves the saved pending evidence without another write',async()=>{
 const h=fixture({onRead:({controls})=>{controls.failSource=true;}}),before=plain(h.store.rows.get(h.key));await assert.rejects(h.run());
 assert.deepEqual(h.store.rows.get(h.key),before);assert.equal(h.store.writes.filter(key=>key===h.key).length,0);assert.equal(h.store.rows.get('attempt:124').purpose,'validation-status');
});

test('a result racing the recovered observation wins the atomic compare-and-set, including a newer accepted ID',async()=>{
 const h=fixture({beforeAtomic:({store,name})=>{store.rows.set(name,{...fixture().receipt.result,state:'validation-complete',quotationId:'newer-accepted-id',observedAt:Date.now()});}});
 await assert.rejects(h.run());assert.equal(h.store.rows.get(h.key).quotationId,'newer-accepted-id');assert.equal(h.store.writes.filter(key=>key===h.key).length,0);
 assert.equal(h.calls.filter(([name])=>name==='create').length,1);assert.equal([...h.store.rows.keys()].some(key=>key.startsWith('transmission:')),false);
});

test('concurrent recovery cannot create a second result tab while the first same-window recovery is pending',async()=>{
 const wait=deferred(),h=fixture({createWait:wait}),first=h.run();await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(h.run(),/복구 중/);assert.equal(h.calls.filter(([name])=>name==='create').length,1);wait.resolve();await first;
 assert.equal(h.calls.filter(([name])=>name==='create').length,1);assert.equal(h.store.rows.get('attempt:124').purpose,'validation-status');
});

test('accepted IDs and cached SKU observations cannot regress under the read-only observation CAS',async()=>{
 const h=fixture(),binding={...identity,company:h.company,includedOptions:6,filename:h.receipt.result.filename,profileId:'profile',purpose:'validation-status',recoveredAt:Date.now(),registered:false};
 const accepted={...binding,state:'validation-complete',quotationId:'accepted',observedAt:Date.now()-1000,registration:{quotationId:'accepted',rows:[{skuId:'existing-sku'}],observedAt:1}};
 for(const patch of [{state:'validation-pending',quotationId:undefined},{state:'not-found',quotationId:undefined},{state:'validation-rejected',quotationId:undefined},{quotationId:'different'},
  {company:companies[1]},{includedOptions:5},{profileId:'another-profile'},{registration:undefined},{registration:{...accepted.registration,rows:[{skuId:'different-sku'}]}}]){
  assert.equal(canObserveSupplierHubValidation(accepted,{...accepted,observedAt:Date.now(),...patch}),false);
 }
 h.store.rows.set(h.key,accepted);const refreshed={...accepted,observedAt:Date.now()};assert.equal(canObserveSupplierHubValidation(accepted,refreshed),true);
 assert.equal(await h.store.record('observe',h.key,{expected:accepted,observation:refreshed}),true);assert.equal(h.store.rows.get(h.key).quotationId,'accepted');assert.deepEqual(h.store.rows.get(h.key).registration,accepted.registration);
 const writes=h.store.writes.length;assert.equal(await h.store.record('observe',h.key,{expected:accepted,observation:refreshed}),false,'an outdated expected row cannot rewrite an already advanced receipt');assert.equal(h.store.writes.length,writes);
 for(const key of ['attempt:124',`transmission:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`])await assert.rejects(h.store.record('observe',key,{expected:refreshed,observation:refreshed}));
});

function fullerRegistration(record){
 const rows=Array.from({length:record.includedOptions},(_,index)=>({title:'더 최신 합성 옵션 '+index,submittedAt:'합성 일시',category:'합성 분류',barcode:'',sourceQuotation:record.filename,skuId:'newer-sku-'+index,status:'검수 완료',stage:'등록 완료'}));
 return {...record,registration:{quotationId:record.quotationId,includedOptions:record.includedOptions,registered:false,scope:'queried-pages',pagesRead:1,hasMore:false,observedAt:Date.now(),rows}};
}

for(const actor of ['app','popup'])test(`${actor} SKU reads preserve a concurrent fuller observation during DOM reads and at final atomic storage`,async()=>{
 for(const boundary of ['read','commit']){
  const reached=deferred(),resume=deferred();let incoming,baseline;
  const hold=async()=>{reached.resolve();await resume.promise;};
  const h=fixture({...(boundary==='read'?{onRegistrationRead:hold}:{beforeRegistrationAtomic:hold})});
  await h.run();h.controls.fileState='validation-complete';await h.run();h.controls.registrationCount=1;
  baseline=plain(h.store.rows.get(h.key));h.receipt.result={...baseline};
  let pending;
  if(actor==='app')pending=refreshSupplierHubRegistration({...identity,type:'YOOFAM_REFRESH_REGISTRATION'},sender,h.api,h.record);
  else{
   h.tabs.push({id:125,windowId:17,url:'https://supplier.coupang.com/qvt/wims',status:'complete',active:true});
   h.store.rows.set('attempt:125',{...identity,company:h.company,includedOptions:6,purpose:'registration-status',quotationId:baseline.quotationId});
   pending=observeSupplierHubResult({tabId:125,kind:'registration'},{id:'extension',url:'chrome-extension://extension/popup.html'},h.api,h.record);
  }
  const completion=assert.rejects(pending,/변경되었습니다|더 최신 상품별 결과/);
  await Promise.race([reached.promise,pending.then(()=>assert.fail('the read-only observation finished before the intended race boundary'),error=>{throw error;})]);incoming=fullerRegistration(baseline);
  assert.equal(await h.store.record('register',h.key,{expected:baseline,observation:incoming}),true,'the competing exact accepted result commits through the actual IndexedDB CAS');
  const writeCount=h.store.writes.filter(key=>key===h.key).length;resume.resolve();await completion;
  assert.deepEqual(h.store.rows.get(h.key),incoming);assert.equal(h.store.rows.get(h.key).registration.rows.length,6);
  assert.equal(h.store.writes.filter(key=>key===h.key).length,writeCount,'the held older one-row observation never performs a second result write');
  assert.equal(h.store.rows.get(h.key).quotationId,baseline.quotationId);assert.equal([...h.store.rows.keys()].some(key=>key.startsWith('transmission:')),false);
  assert.equal(h.calls.some(([name,script])=>name==='script'&&['attachToSupplierHub','requestSupplierHubValidation'].includes(script)),false);
 }
});

test('SKU observation CAS preserves exact accepted validation identity and rejects stale clocks or storage keys',async()=>{
 const h=fixture();await h.run();h.controls.fileState='validation-complete';await h.run();const accepted=plain(h.store.rows.get(h.key)),fresh=fullerRegistration(accepted);
 for(const patch of [{productId:'other'},{categoryId:'1'},{fingerprint:'b'.repeat(64)},{company:companies[1]},{includedOptions:5},{quotationId:'different'},{state:'validation-pending'},
  {filename:'different.xlsx'},{profileId:'other-profile'},{observedAt:accepted.observedAt+1},{registration:{...fresh.registration,quotationId:'different'}},{registration:{...fresh.registration,includedOptions:5}},{registration:{...fresh.registration,registered:true}}])assert.equal(canObserveSupplierHubRegistration(accepted,{...fresh,...patch}),false);
 assert.equal(canObserveSupplierHubRegistration(accepted,fresh),true);assert.equal(await h.store.record('register',h.key,{expected:accepted,observation:fresh}),true);
 const writes=h.store.writes.length;assert.equal(await h.store.record('register',h.key,{expected:accepted,observation:fresh}),false);assert.equal(h.store.writes.length,writes);
 assert.equal(canObserveSupplierHubRegistration(fresh,{...fresh,registration:{...fresh.registration,observedAt:fresh.registration.observedAt-1}}),false);
 for(const key of ['attempt:125',`transmission:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`])await assert.rejects(h.store.record('register',key,{expected:fresh,observation:fresh}));
});
