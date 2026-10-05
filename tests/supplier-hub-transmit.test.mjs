import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {transmitSupplierHubPackage,waitForSupplierHubAttachments} from '../extensions/supplier-hub/transmit.mjs';
import {attachToSupplierHub} from '../extensions/supplier-hub/attach.mjs';
import {verifySupplierHubCompany} from '../extensions/supplier-hub/company.mjs';
import {requestSupplierHubValidation} from '../extensions/supplier-hub/validate.mjs';
import {supplierHubUploadReady,supplierHubStatusReady} from '../extensions/supplier-hub/hub-tab.mjs';
import {prepareAttachments} from '../extensions/supplier-hub/package.mjs';
import {verifyAppQuotationSource} from '../extensions/supplier-hub/source-check.mjs';
import {claimSupplierHubTransmissionWindow} from '../extensions/supplier-hub/transmission-window.mjs';
import {validateAppHubRequest,isHubRegistrationTab} from '../extensions/supplier-hub/app-request.mjs';
import {resultKey,isStoredReceiptResult} from '../extensions/supplier-hub/handoff-store.mjs';
import {readSupplierHubValidation} from '../extensions/supplier-hub/result.mjs';
import {refreshSupplierHubRegistration} from '../extensions/supplier-hub/app-registration.mjs';
import {readSupplierHubRegistration} from '../extensions/supplier-hub/registration-result.mjs';
import {searchSupplierHubRegistration} from '../extensions/supplier-hub/registration-search.mjs';
import {assertAppSupplierHubNotSubmitted} from '../extensions/supplier-hub/receipt-recovery.mjs';
import {hubCompanyMenuPage} from './helpers/hub-company-menu.mjs';

const identity={productId:'product',categoryId:'80719',fingerprint:'a'.repeat(64)};
const sender={tab:{id:7,windowId:17},frameId:0,url:'https://sourceflow.jjwwhhjj1116.workers.dev/'};
const agreements={priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true};
async function packageBytes(changes={},patchFiles=()=>{}){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/exports/zip.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,TextEncoder,Uint8Array,Uint32Array,DataView});
 const workbook=new Uint8Array([80,75,3,4,0,1]),filename=`YOOFAM-${identity.fingerprint}.xlsx`;
 const digest=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
 const plan={format:'sourceflow-supplier-hub-upload-plan-v1',destination:'https://supplier.coupang.com/qvt/registration',profileId:'profile',company:{code:'A01464742',name:'와이홉'},productId:identity.productId,categoryId:identity.categoryId,inputFingerprint:identity.fingerprint,quotation:{file:{filename,byteLength:workbook.length,sha256:digest}},productImages:[{archivePath:'assets/photo.png',filename:'photo.png'}],labelImages:[{archivePath:'assets/label.png',filename:'label.png'}],missingLabels:[],...changes};
 const image=new Uint8Array([137,80,78,71]),imageDigest=Buffer.from(await webcrypto.subtle.digest('SHA-256',image)).toString('hex');
 for(const entry of [...plan.productImages,...plan.labelImages])Object.assign(entry,{byteLength:image.length,sha256:imageDigest});
 const review={format:'sourceflow-quotation-review-v1',...identity,inputFingerprint:identity.fingerprint,submissionReady:false,transport:'not-connected',includedOptions:2,errorCount:0,reviewCount:0,omittedIssueCount:0,issues:[]};
 const files=[{name:filename,data:workbook},{name:'assets/photo.png',data:image},{name:'assets/label.png',data:image},{name:'submission-review.json',data:JSON.stringify(review)},{name:'supplier-hub-upload-plan.json',data:JSON.stringify(plan)}];
 patchFiles(files);
 return Buffer.from(exports.zipFiles(files)).toString('base64');
}
async function fixture(options={}){
 const calls=[],records=new Map(),pages=new Map();
 const tab={id:123,windowId:17,url:'https://supplier.coupang.com/qvt/registration',...options.tab};
 let checks=0,sourceChecks=0,preflightChecked=false;
 const tabs=options.tabs??[tab];let fresh;
 if(options.previous)records.set('attempt:123',{origin:new URL(sender.url).origin,...identity,company:options.plan?.company??{code:'A01464742',name:'와이홉'},includedOptions:2});
 const api={tabs:{query:async query=>{calls.push(['query',query]);return tabs;},get:async id=>id===7?{id:7,windowId:17,url:sender.url}:options.getTab??(id===124?fresh:tab),sendMessage:async(id,message,frame)=>{
   if(message.type==='YOOFAM_READ_TRANSMISSION_RECEIPT'){
    calls.push(['receipt',id,frame]);if(options.receiptError)throw Error('receipt response lost');
    const present=options.serverReceipt&&(!options.receiptAfterPreflight||preflightChecked);
    const receipt=present?{schemaVersion:1,evidence:'chrome-observation',profileId:'profile',categoryId:identity.categoryId,fingerprint:identity.fingerprint,
     result:{filename:`YOOFAM-${identity.fingerprint}.xlsx`,company:options.plan?.company??{code:'A01464742',name:'와이홉'},includedOptions:2,observedAt:Date.now(),registered:false,state:'validation-complete',quotationId:'quote-existing',...options.serverReceipt}}:null;
    return {ok:true,...message.expected,receipt,checkedAt:Date.now()};
   }
   calls.push(['source',id,frame]);sourceChecks++;return {ok:true,...message.expected,checkedAt:Date.now(),...(options.sourceChangedAt===sourceChecks?{fingerprint:'b'.repeat(64)}:{})};
  },create:async input=>{calls.push(['create',input]);fresh={id:124,status:'complete',...input,...options.created};tabs.push(fresh);return fresh;}},scripting:{executeScript:async request=>{
   calls.push([request.func.name,request.args,request.target.tabId]);
   if(options.serializedUpload&&request.target.tabId===124){
    if(!pages.has(124))pages.set(124,registrationPage(options.createdCompany??options.plan?.company??{code:'A01464742',name:'와이홉'}));
    return [{result:await pages.get(124).run(request.func,request.args)}];
   }
   if(options.companyMenu&&[supplierHubUploadReady,supplierHubStatusReady,verifySupplierHubCompany].includes(request.func)){
    const id=request.target.tabId;
    if(!pages.has(id))pages.set(id,hubCompanyMenuPage({company:id===124&&options.createdCompany?options.createdCompany:id===123&&options.dashboardCompany?options.dashboardCompany:options.plan?.company??{code:'A01464742',name:'와이홉'},path:new URL(id===124?fresh.url:tab.url).pathname}));
    return [{result:await pages.get(id).run(request.func,request.args)}];
   }
   if(request.func===supplierHubUploadReady||request.func===supplierHubStatusReady)return [{result:true}];
   if(request.func===verifySupplierHubCompany)return [{result:{code:options.companyCodes?.[checks++]??options.plan?.company?.code??'A01464742'}}];
   if(request.func===attachToSupplierHub){
     if(request.args[1]===true){preflightChecked=true;if(options.preflightError)throw Error('changed upload sections');return [{result:{state:options.occupied&&request.target.tabId===123?'occupied':'ready',registered:false}}];}
     await options.onAttach?.();if(options.attachError)throw Error('lost response');return [{result:{state:options.outcome??'dispatched',registered:false}}];
   }
   if(request.func===waitForSupplierHubAttachments)return [{result:options.uploadWait?await options.uploadWait(...request.args):options.ready??true}];
   if(request.func===requestSupplierHubValidation){assert.deepEqual(request.args,[agreements,true]);if(options.validationError)throw Error('button disabled');return [{result:{state:'validation-requested',validated:false,registered:false}}];}
   if(request.func===readSupplierHubValidation){await options.onResult?.();return [{result:{filename:options.validationFilename??`YOOFAM-${identity.fingerprint}.xlsx`,state:options.validationState??'validation-pending',registered:false,...(options.validationState==='validation-complete'?{quotationId:'quote-123'}:{})}}];}
   if(request.func===searchSupplierHubRegistration)return [{result:{state:'search-complete',quotationId:'quote-123',registered:false}}];
   if(request.func===readSupplierHubRegistration){
    const rows=['sku-1','sku-2'].map(skuId=>({title:'상품',submittedAt:'date',category:'cat',barcode:'',sourceQuotation:`YOOFAM-${identity.fingerprint}.xlsx`,skuId,status:'상품 검수중',stage:'가격/정책'}));
    return [{result:{quotationId:'quote-123',scope:'visible-page',registered:false,rows,page:{current:1,hasNext:false,signature:JSON.stringify(rows)}}}];
   }
   throw Error('unexpected script');
 }}};
 const store=async(action,key,value)=>{
   calls.push(['store',action,key]);
   if(action==='claim'){if(records.has(key))return false;records.set(key,value);return true;}
   if(action==='put'&&key.startsWith('attempt:')&&options.bindingError)throw Error('tab binding storage unavailable');
   if(action==='put')records.set(key,value);else return records.get(key);
 };
 const message={...identity,type:'YOOFAM_TRANSMIT_PACKAGE',reviewedAgreements:agreements,base64:await packageBytes(options.plan,options.patchFiles)};
 return {calls,records,pages,api,store,message,run:(patch={},who=sender)=>transmitSupplierHubPackage({...message,...patch},who,api,store)};
}

// Real serialized upload/validation functions and File objects; no Hub requests.
function registrationPage(company){
 let open=false;const events=[],dataset={};
 const titles=['작성이 완료된 견적서 Excel 파일을 업로드하십시오.','상품 이미지를 업로드하십시오.','제품 필수 표시사항을 업로드하십시오.'];
 const inputs=titles.map((title,index)=>({files:[],disabled:false,isConnected:true,closest:()=>null,parentElement:{innerText:title,querySelectorAll:()=>[{}]},dispatchEvent(event){assert.equal(event.type,'change');events.push('upload-'+index);open=false;}}));
 const terms=['제공된 권장소비자가격 또는 공식 판매처 가격 데이터에 대한 쿠팡 약관에 동의합니다.','상품 라벨 내 기재된 (010 이하) 연락처는 법인 명의 개통 번호이거나, 해당 브랜드의 공식 대외 창구로 지정된 업무용 연락처에 해당함을 확인하며, 당사는 해당 정보가 대외적으로 공개됨에 동의합니다.'];
 const checks=terms.map((text,index)=>({checked:false,disabled:false,labels:[{innerText:text}],click(){this.checked=true;open=false;events.push(index?'contact':'price');}}));
 const legal={checked:false,disabled:false,labels:[{innerText:'해당없음'}],click(){this.checked=true;open=false;events.push('legal-no');}};
 legal.parentElement={innerText:'상품 개별법령에 따른 필수 서류',querySelectorAll:selector=>selector.includes('radio')?[legal,{}]:[]};
 const menu={innerText:company.name,disabled:false,getClientRects:()=>[{}],click(){open=true;events.push('company-menu');}};
 const button={innerText:'파일 검증하기',get disabled(){return inputs.some(input=>!input.files.length)||checks.some(input=>!input.checked)||!legal.checked;},getClientRects:()=>[{}],getAttribute:()=>null,click(){events.push('validate');}};
 const document={documentElement:{dataset},body:{get innerText(){return [company.name,...titles,...(open?['Company Code: '+company.code]:[]),...inputs.flatMap(input=>Array.from(input.files,file=>file.name))].join('\n');}},querySelectorAll(selector){
  if(selector==='button')return [menu,button];if(selector==='input[type="file"]')return inputs;
  if(selector.includes('msrpAgreement'))return [checks[0]];if(selector.includes('labelContactAgreement'))return [checks[1]];if(selector.includes('undefined-N'))return [legal];return [];
 }};
 class Transfer{constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}}
 return {events,inputs,dataset,run:(func,args=[])=>vm.runInNewContext(`(${func.toString()})(...args)`,{document,args,location:{origin:'https://supplier.coupang.com',pathname:'/qvt/registration'},File,Event,DataTransfer:Transfer,Uint8Array,atob,setTimeout:callback=>queueMicrotask(callback)})};
}

for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(`explicit transmission from dashboard alone prepares one same-window tab and validates reviewed files (${company.code})`,async()=>{
 const dashboard={id:123,windowId:17,url:'https://supplier.coupang.com/dashboard/KR'},h=await fixture({tab:dashboard,plan:{company},companyMenu:true,serializedUpload:true});
 const before=JSON.stringify(await h.api.tabs.get(123)),result=await h.run();assert.equal(result.state,'validation-requested');assert.equal(result.registered,false);
 assert.deepEqual(h.calls.filter(([name])=>name==='create'),[['create',{windowId:17,url:'https://supplier.coupang.com/qvt/registration',active:false}]]);
 assert.equal(JSON.stringify(await h.api.tabs.get(123)),before);assert.equal(h.pages.get(123).clicks,1);assert.equal(h.pages.get(123).document.documentElement.dataset.yoofamAttachmentAttempt,undefined);
 assert.deepEqual(h.calls.find(([name,,id])=>name==='verifySupplierHubCompany'&&id===123)[1],[company,'catalog']);
 const page=h.pages.get(124);assert.deepEqual(page.events.filter(event=>event.startsWith('upload')||event==='validate'),['upload-0','upload-1','upload-2','validate']);
 assert.deepEqual(page.events.filter(event=>['price','contact','legal-no'].includes(event)),['legal-no','price','contact']);
 assert.deepEqual(page.inputs.map(input=>input.files[0].name),[`YOOFAM-${identity.fingerprint}.xlsx`,'photo.png','label.png']);
 const prepared=await prepareAttachments(Uint8Array.from(atob(h.message.base64),c=>c.charCodeAt(0)));
 for(const [index,group] of ['quotation','productImages','labelImages'].entries())assert.deepEqual(Buffer.from(await page.inputs[index].files[0].arrayBuffer()),Buffer.from(prepared[group][0].base64,'base64'));
 assert.equal(h.records.get('attempt:124').company.code,company.code);assert.equal(h.records.has('attempt:123'),false);
 assert.ok(h.calls.findIndex(([name])=>name==='create')>h.calls.findIndex(([name,,id])=>name==='verifySupplierHubCompany'&&id===123));
 await assert.rejects(h.run(),/이미 전송/);assert.equal(h.calls.filter(([name])=>name==='create').length,1);assert.equal(page.events.filter(event=>event==='validate').length,1);
});

test('dashboard fallback does not create or upload from another window, company, locale, login, or ambiguous tabs',async()=>{
 const dashboard={id:123,windowId:17,url:'https://supplier.coupang.com/dashboard/KR'};
 for(const options of [{tabs:[]},{tab:{...dashboard,windowId:18}},{tab:{...dashboard,url:'https://supplier.coupang.com/dashboard/US'}},{tab:{...dashboard,url:'https://supplier.coupang.com/dashboard'}},{tab:{...dashboard,url:'https://supplier.coupang.com/login'}},{tab:{...dashboard,pendingUrl:'https://supplier.coupang.com/login'}},{tab:dashboard,tabs:[dashboard,{...dashboard,id:125}]},{tab:dashboard,dashboardCompany:{code:'A01526306',name:'유앤채'}},{tab:dashboard,sourceChangedAt:1},{tab:dashboard,sourceChangedAt:2},{tab:dashboard,serverReceipt:{}},{tab:dashboard,receiptError:true}]){
  const h=await fixture({...options,companyMenu:true,serializedUpload:true});await assert.rejects(h.run());
  assert.equal(h.calls.some(([name])=>name==='create'||name==='attachToSupplierHub'||name==='requestSupplierHubValidation'),false);assert.equal([...h.records.keys()].some(key=>key.startsWith('transmission:')||key.startsWith('attempt:')),false);
 }
});

test('an existing registration tab belonging to another company is not bypassed through a dashboard',async()=>{
 const registration={id:123,windowId:17,url:'https://supplier.coupang.com/qvt/registration'},dashboard={id:125,windowId:17,url:'https://supplier.coupang.com/dashboard/KR'};
 const h=await fixture({tabs:[registration,dashboard],companyMenu:true,serializedUpload:true});
 const otherAttempt={origin:new URL(sender.url).origin,...identity,company:{code:'A01526306',name:'유앤채'},includedOptions:2};h.records.set('attempt:123',otherAttempt);
 await assert.rejects(h.run(),/등록 탭/);assert.equal(h.records.get('attempt:123'),otherAttempt);assert.equal(h.records.size,1);
 assert.equal(h.calls.some(([name])=>name==='create'||name==='verifySupplierHubCompany'||name==='attachToSupplierHub'),false);assert.equal(h.calls.filter(([name])=>name==='query').length,1);
});

test('a new registration tab must independently match the reviewed company and registration route',async()=>{
 for(const options of [{createdCompany:{code:'A01526306',name:'유앤채'}},{created:{url:'https://supplier.coupang.com/login'}},{created:{windowId:18}}]){
  const h=await fixture({tab:{url:'https://supplier.coupang.com/dashboard/KR'},companyMenu:true,serializedUpload:true,...options});await assert.rejects(h.run());
  assert.equal(h.calls.filter(([name])=>name==='create').length,1);assert.equal(h.calls.some(([name])=>name==='attachToSupplierHub'||name==='requestSupplierHubValidation'),false);
  assert.equal([...h.records.keys()].some(key=>key.startsWith('transmission:')||key.startsWith('attempt:')),false);
 }
});

function popup(h){
 let consumed=false;
 const saved={origin:new URL(sender.url).origin,...identity,createdAt:Date.now(),base64:h.message.base64,appTabId:7,windowId:17};
 const source=fs.readFileSync(new URL('../extensions/supplier-hub/dispatch.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
 const context=vm.createContext({Date,URL,Uint8Array,atob,prepareAttachments,attachToSupplierHub,verifySupplierHubCompany,verifyAppQuotationSource:(...args)=>verifyAppQuotationSource(...args,h.api),assertAppSupplierHubNotSubmitted:(...args)=>assertAppSupplierHubNotSubmitted(...args,h.api,h.store),claimSupplierHubTransmissionWindow,resultKey,isHubRegistrationTab,
  pendingPackage:async action=>{if(action==='get')return consumed?null:saved;if(action==='delete'){if(consumed)return false;consumed=true;return true;}throw Error('Unexpected package operation');},
  transferRecord:h.store,chrome:{...h.api,runtime:{id:'extension',getURL:name=>`chrome-extension://extension/${name}`}}});
 vm.runInContext(source,context);
 return ()=>context.dispatchPendingPackage({tabId:123,fingerprint:identity.fingerprint},{id:'extension',url:'chrome-extension://extension/popup.html'});
}

function observe(h){
 const source=fs.readFileSync(new URL('../extensions/supplier-hub/observe.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
 const context=vm.createContext({Date,URL,validateAppHubRequest,isHubRegistrationTab,verifySupplierHubCompany,readSupplierHubValidation,resultKey,isStoredReceiptResult,transferRecord:h.store,chrome:h.api});
 vm.runInContext(source,context);
 return ()=>context.observeSupplierHubResult({...identity,type:'YOOFAM_REFRESH_RESULT',kind:'validation'},sender);
}

for(const filename of ['photo.png','label.png'])for(const path of ['app','popup'])test(`${path} blocks substituted ${filename} before any Hub script, claim or attachment`,async()=>{
 const h=await fixture({patchFiles:files=>{files.find(file=>file.name==='assets/'+filename).data=new Uint8Array([137,80,78,70]);}});
 await assert.rejects(path==='app'?h.run():popup(h)(),/이미지.*변경/);
 assert.equal(h.records.size,0);
 assert.equal(h.calls.some(([name])=>name!=='query'),false,'popup may inspect its active tab but must not touch Hub inputs or claim a delivery');
 assert.equal(h.calls.length,path==='app'?0:1);
});

test('app transmission uses its existing Chrome window and binds attachment/validation to the reviewed package',async()=>{
 const h=await fixture();const result=await h.run();assert.equal(result.state,'validation-requested');assert.equal(result.registered,false);
 assert.deepEqual(h.calls.find(([name])=>name==='query'),['query',{windowId:17,url:'https://supplier.coupang.com/qvt/registration*'}]);
 const attempt=h.records.get('attempt:123');assert.equal(attempt.productId,identity.productId);assert.equal(attempt.company.code,'A01464742');assert.equal(attempt.includedOptions,2);
 const scripts=h.calls.filter(([name])=>['attachToSupplierHub','waitForSupplierHubAttachments','requestSupplierHubValidation'].includes(name));
 assert.deepEqual(scripts.map(([name])=>name),['attachToSupplierHub','attachToSupplierHub','waitForSupplierHubAttachments','requestSupplierHubValidation']);
 assert.deepEqual(scripts[2][1][0],[`YOOFAM-${identity.fingerprint}.xlsx`,'photo.png','label.png']);
 await assert.rejects(h.run(),/이미 전송/);assert.equal(h.calls.filter(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true).length,1);
});
test('restored accepted receipts stop both direct and popup upload paths without a fabricated upload claim',async()=>{
 for(const delivery of ['app','popup']){
  const h=await fixture(),key=resultKey({origin:new URL(sender.url).origin,...identity}),receipt={state:'validation-complete',quotationId:'quote-123',receiptRecovered:true};h.records.set(key,receipt);
  await assert.rejects(delivery==='app'?h.run():popup(h)(),/이미 접수/);assert.equal(h.records.get(key),receipt);
  assert.equal([...h.records.keys()].some(key=>key.startsWith('transmission:')||key.startsWith('attempt:')),false);
  assert.equal(h.calls.some(([name])=>name==='attachToSupplierHub'||name==='requestSupplierHubValidation'||name==='create'),false);
 }
});
for(const delivery of ['app','popup'])test(`server-only receipts block ${delivery} before touching Hub files or consuming the package`,async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])for(const state of ['validation-complete','validation-pending','validation-rejected']){
  const h=await fixture({plan:{company},serverReceipt:{state,...(state!=='validation-complete'?{quotationId:undefined}:{})}});
  await assert.rejects(delivery==='app'?h.run():popup(h)(),/접수|전송 기록/);
  const saved=h.records.get(resultKey({origin:new URL(sender.url).origin,...identity}));assert.equal(saved.state,state);assert.deepEqual(saved.company,company);
  assert.equal([...h.records.keys()].some(key=>key.startsWith('transmission:')||key.startsWith('attempt:')),false);
  assert.equal(h.calls.some(([name])=>name==='attachToSupplierHub'||name==='requestSupplierHubValidation'||name==='create'),false);
 }
});
test('a receipt saved during preflight blocks the final claim and attachment',async()=>{
 for(const delivery of ['app','popup']){
  const h=await fixture({serverReceipt:{},receiptAfterPreflight:true});
  await assert.rejects(delivery==='app'?h.run():popup(h)(),/접수|전송 기록/);
  assert.equal(h.calls.filter(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true).length,0);
  assert.equal([...h.records.keys()].some(key=>key.startsWith('transmission:')||key.startsWith('attempt:')),false);
 }
});

test('changed source before claim blocks upload; edits during upload block validation without repeating files',async()=>{
 for(const sourceChangedAt of [1,2,3]){
  const h=await fixture({sourceChangedAt});
  if(sourceChangedAt<3){await assert.rejects(h.run(),/최신 저장본/);assert.equal(h.records.size,0);}
  else{assert.equal((await h.run()).state,'attached');await assert.rejects(h.run(),/이미 전송/);}
  assert.equal(h.calls.filter(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true).length,sourceChangedAt===3?1:0);
  assert.equal(h.calls.some(([name])=>name==='requestSupplierHubValidation'),false);
 }
});

test('a second product or existing attachments get a fresh upload tab in the same window without replacing work',async()=>{
 for(const options of [{previous:true},{occupied:true}]){
  const h=await fixture(options);assert.equal((await h.run()).state,'validation-requested');
  assert.deepEqual(h.calls.find(([name])=>name==='create'),['create',{windowId:17,url:'https://supplier.coupang.com/qvt/registration',active:false}]);
  const uploads=h.calls.filter(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true);assert.equal(uploads.length,1);assert.equal(uploads[0][2],124);
  assert.equal(h.records.get('attempt:124').productId,identity.productId);
  await assert.rejects(h.run(),/이미 전송/);assert.equal(h.calls.filter(([name])=>name==='create').length,1);
 }
 for(const options of [{previous:true,created:{windowId:18}},{occupied:true,created:{url:'https://supplier.coupang.com/login'}},{previous:true,companyCodes:['A01526306']}]){
  const h=await fixture(options);await assert.rejects(h.run());assert.equal(h.calls.some(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true),false);
 }
});

test('fresh upload tabs open and verify their initially closed company menus before attaching once',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])for(const previous of [false,true]){
  const h=await fixture({companyMenu:true,plan:{company},previous,occupied:!previous});
  assert.equal((await h.run()).state,'validation-requested');assert.equal(h.pages.get(124).clicks,1);
  const ready=h.calls.findIndex(([name,,tabId])=>name==='supplierHubUploadReady'&&tabId===124);
  const verified=h.calls.findIndex(([name,,tabId],index)=>index>ready&&name==='verifySupplierHubCompany'&&tabId===124);
  const uploaded=h.calls.findIndex(([name,args,tabId])=>name==='attachToSupplierHub'&&args[1]!==true&&tabId===124);
  assert.ok(ready>=0&&verified>ready&&uploaded>verified);
  assert.equal(h.calls.filter(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true).length,1);
  assert.equal(h.records.get('attempt:124').company.code,company.code);
 }
 const wrong=await fixture({companyMenu:true,previous:true,createdCompany:{name:'와이홉',code:'A01526306'}});
 await assert.rejects(wrong.run(),/회사코드/);assert.equal(wrong.calls.some(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true),false);
 assert.equal([...wrong.records.keys()].some(key=>key.startsWith('transmission:')),false);
});

test('untrusted frames, missing agreements and mismatched products cannot reach Supplier Hub',async()=>{
 for(const who of [{...sender,url:'https://evil.example/'},{...sender,frameId:1},{...sender,tab:{id:7}},{...sender,tab:{id:7,windowId:-1}}]){const h=await fixture();await assert.rejects(h.run({},who));assert.equal(h.calls.length,0);}
 for(const patch of [{reviewedAgreements:{...agreements,priceData:false}},{reviewedAgreements:{...agreements,legalDocumentsNotApplicable:false}},{reviewedAgreements:{...agreements,extra:true}},{productId:'other'},{categoryId:'999'}]){const h=await fixture();await assert.rejects(h.run(patch));assert.equal(h.calls.length,0);}
});

test('wrong window, ambiguous tabs, wrong company and work in progress are rejected before claiming or uploading',async()=>{
 for(const opts of [{tab:{windowId:18}},{tab:{url:'https://supplier.coupang.com/qvt/wims'}},{tabs:[{id:123,windowId:17,url:'https://supplier.coupang.com/qvt/registration'},{id:124,windowId:17,url:'https://supplier.coupang.com/qvt/registration'}]},{companyCodes:['A01526306']},{preflightError:true}]){
   const h=await fixture(opts);await assert.rejects(h.run());assert.equal(h.records.size,0);assert.equal(h.calls.some(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true),false);
 }
});

test('partial uploads, lost responses and upload timeout never repeat attachment or validation',async()=>{
 for(const [opts,state] of [[{outcome:'partial'},'partial'],[{attachError:true},'unconfirmed'],[{ready:false},'attached'],[{validationError:true},'attached'],[{companyCodes:['A01464742','A01526306']},'attached']]){
   const h=await fixture(opts);const result=await h.run();assert.equal(result.state,state);assert.equal(result.registered,false);
   assert.equal(h.calls.filter(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true).length,1);
   assert.equal(h.records.has('attempt:123'),true);
   await assert.rejects(h.run());assert.equal(h.calls.filter(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true).length,1);
 }
});

test('failed recovery binding stops before any upload and preserves the durable no-replay claim',async()=>{
 const h=await fixture({bindingError:true});const result=await h.run();
 assert.equal(result.state,'unconfirmed');assert.match(result.error,/binding storage/);
 assert.equal(h.records.has('attempt:123'),false);
 assert.equal(h.calls.some(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true),false);
 assert.equal(h.calls.some(([name])=>name==='requestSupplierHubValidation'),false);
 await assert.rejects(h.run(),/이미 전송/);
});

test('both companies bind the recoverable upload tab before partial attachment or a lost response',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  for(const options of [{outcome:'partial'},{attachError:true}]){
   let beforeUpload;
   const h=await fixture({...options,plan:{company},companyCodes:[company.code,company.code],onAttach:()=>{
    beforeUpload=h.records.get('attempt:123');
   }});
   assert.equal((await h.run()).state,options.outcome||'unconfirmed');
   assert.ok(beforeUpload,'the tab must already be recoverable when the first upload can start');
   assert.equal(beforeUpload.company.code,company.code);assert.equal(beforeUpload.company.name,company.name);
   assert.equal(beforeUpload.productId,identity.productId);assert.equal(beforeUpload.categoryId,identity.categoryId);
   assert.equal(beforeUpload.fingerprint,identity.fingerprint);assert.equal(beforeUpload.includedOptions,2);
   assert.equal(h.records.get('attempt:123').company.code,company.code);
   const claim=h.calls.findIndex(([name,action])=>name==='store'&&action==='claim');
   const binding=h.calls.findIndex(([name,action,key])=>name==='store'&&action==='put'&&key==='attempt:123');
   const upload=h.calls.findIndex(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true);
   assert.ok(claim<binding&&binding<upload);
   await assert.rejects(h.run(),/이미 전송/);
   assert.equal(h.calls.filter(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true).length,1);
   assert.equal(h.calls.some(([name])=>name==='requestSupplierHubValidation'),false);
  }
 }
});

test('both delivery paths recover failed acknowledgements into exact-company validation and SKU lookup without uploading again',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  for(const path of ['app','popup']){
   for(const failure of [{outcome:'partial'},{attachError:true}]){
    const options={...failure,plan:{company},companyCodes:Array(30).fill(company.code)};
    const h=await fixture(options),deliver=path==='app'?()=>h.run():popup(h);
    if(path==='popup'&&failure.attachError)await assert.rejects(deliver(),/lost response/);else await deliver();
    const uploads=()=>h.calls.filter(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true).length;
    assert.equal(uploads(),1);
    const lookup=observe(h);assert.equal((await lookup()).state,'validation-pending');
    const key=resultKey({origin:new URL(sender.url).origin,...identity});
    assert.equal(h.records.get(key).company.code,company.code);assert.equal(h.records.get(key).includedOptions,2);
    options.validationState='validation-complete';await lookup();
    const result=await refreshSupplierHubRegistration({...identity,type:'YOOFAM_REFRESH_REGISTRATION'},sender,h.api,h.store);
    assert.equal(result.company.code,company.code);assert.equal(result.company.name,company.name);
    assert.equal(result.registration.quotationId,'quote-123');assert.equal(result.registration.includedOptions,2);
    assert.deepEqual(result.registration.rows.map(row=>row.skuId),['sku-1','sku-2']);
    assert.equal(result.registration.hasMore,false);assert.equal(result.registered,false);
    assert.equal(uploads(),1);assert.equal(h.calls.some(([name])=>name==='requestSupplierHubValidation'),false,'read-only recovery must not request or replay validation');
    const sourceTab=h.records.get('attempt:123');assert.equal(sourceTab.purpose,undefined);assert.equal(sourceTab.company.code,company.code);
    await assert.rejects(h.run(),/이미 전송/);assert.equal(uploads(),1);
   }
  }
 }
});

test('app and popup share the existing-window lock until the pending attachment settles',async()=>{
 for(const firstPath of ['app','popup']){
  let finish,entered;const held=new Promise(resolve=>{finish=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  const h=await fixture({onAttach:()=>{entered();return held;}}),fromPopup=popup(h);
  const first=firstPath==='app'?h.run():fromPopup();
  let binding;
  try{
   await Promise.race([started,first.then(()=>assert.fail('delivery ended before the held attachment'))]);
   binding=h.records.get('attempt:123');assert.ok(binding);
   await assert.rejects(firstPath==='app'?fromPopup():h.run(),/전송 중/);
  }finally{finish();await first;}
  assert.equal(h.records.get('attempt:123'),binding);
  assert.equal(h.calls.filter(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true).length,1);
  const other=await fixture();assert.equal((await other.run()).state,'validation-requested','the window lock must release after either path');
 }
});

test('previous-version claims recover their exact tab into validation and SKU lookup for both companies',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  const options={outcome:'partial',plan:{company},companyCodes:Array(30).fill(company.code),validationState:'not-found'};
  const h=await fixture(options);await h.run();h.records.delete('attempt:123');
  const lookup=observe(h);assert.equal((await lookup()).state,'not-found');
  assert.equal(h.records.get('attempt:123').company.code,company.code);
  await assert.rejects(refreshSupplierHubRegistration({...identity,type:'YOOFAM_REFRESH_REGISTRATION'},sender,h.api,h.store),/검증 완료/);
  options.validationState='validation-complete';await lookup();
  const result=await refreshSupplierHubRegistration({...identity,type:'YOOFAM_REFRESH_REGISTRATION'},sender,h.api,h.store);
  assert.equal(result.company.code,company.code);assert.equal(result.registration.rows.length,2);assert.equal(result.registered,false);
  assert.equal(h.calls.filter(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true).length,1);
  assert.equal(h.calls.some(([name])=>name==='requestSupplierHubValidation'),false);
 }
});

test('legacy recovery cannot overwrite newer work or accept another identity, company, window or malformed claim',async()=>{
 for(const patch of [{productId:'other'},{categoryId:'999'},{origin:'http://localhost:3000'},{fingerprint:'b'.repeat(64)},{tabId:999},{windowId:18},{company:{code:'A01464742',name:'유앤채'}},{company:{code:'A01526306',name:'유앤채'}},{includedOptions:0},{includedOptions:201},{startedAt:Infinity},{registered:true},{state:'registered'}]){
  const h=await fixture({outcome:'partial'});await h.run();h.records.delete('attempt:123');
  const key=`transmission:${new URL(sender.url).origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`;
  h.records.set(key,{...h.records.get(key),...patch});const before=h.calls.length;
  await assert.rejects(observe(h)());assert.equal(h.records.has('attempt:123'),false);
  assert.equal(h.calls.slice(before).some(([name])=>name==='readSupplierHubValidation'),false);
  assert.equal(h.records.has(resultKey({origin:new URL(sender.url).origin,...identity})),false);
 }
 const newer=await fixture({outcome:'partial'});await newer.run();
 const next={...newer.records.get('attempt:123'),productId:'newer-product'};newer.records.set('attempt:123',next);
 await assert.rejects(observe(newer)());assert.equal(newer.records.get('attempt:123'),next);
});

test('a changed tab assignment or different filename during legacy lookup cannot bind or publish results',async()=>{
 for(const mode of ['changed-assignment','different-file']){
  const options={outcome:'partial',...(mode==='different-file'?{validationFilename:'other.xlsx'}:{})};
  const h=await fixture(options);await h.run();h.records.delete('attempt:123');
  if(mode==='changed-assignment')options.onResult=()=>h.records.set('attempt:123',{origin:new URL(sender.url).origin,...identity,productId:'new-work',company:{code:'A01464742',name:'와이홉'},includedOptions:2});
  await assert.rejects(observe(h)(),mode==='changed-assignment'?/견적서가 변경/:/현재 견적서/);
  assert.equal(h.records.has(resultKey({origin:new URL(sender.url).origin,...identity})),false);
  assert.equal(h.records.get('attempt:123')?.productId,mode==='changed-assignment'?'new-work':undefined);
 }
});

test('atomic legacy tab recovery loses to a newer assignment without overwriting it',async()=>{
 const h=await fixture({outcome:'partial'});await h.run();h.records.delete('attempt:123');
 const store=h.store,newer={origin:new URL(sender.url).origin,...identity,productId:'new-work',company:{code:'A01464742',name:'와이홉'},includedOptions:2};
 h.store=async(action,key,value)=>{if(action==='claim'&&key==='attempt:123')h.records.set(key,newer);return store(action,key,value);};
 await assert.rejects(observe(h)(),/견적서가 변경/);assert.equal(h.records.get('attempt:123'),newer);
 assert.equal(h.records.has(resultKey({origin:new URL(sender.url).origin,...identity})),false);
});

test('closing the caller cannot permit a second transmission while worker attachment is pending',async()=>{
 let finish,entered;const held=new Promise(resolve=>{finish=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 const h=await fixture({onAttach:()=>{entered();return held;}}),first=h.run();
 try{
  await Promise.race([started,first.then(()=>assert.fail('delivery ended before the held attachment'))]);
  await assert.rejects(h.run(),/전송 중/);
 }finally{finish();await first;}
 assert.equal((await first).state,'validation-requested');
 assert.equal(h.calls.filter(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true).length,1);
});

test('upload readiness waits for all exact names and aborts if the company or attempt changes',async()=>{
 const names=['quotation.xlsx','label.png'],company={code:'A01464742',name:'와이홉'};
 for(const mode of ['ready','timeout','switch','changed']){
   let waits=0;const document={body:{innerText:'Company Code: A01464742 quotation.xlsx'},documentElement:{dataset:{yoofamAttachmentAttempt:JSON.stringify({state:'dispatched',company,files:names})}}};
   const result=vm.runInNewContext(`(${waitForSupplierHubAttachments.toString()})(names,company)`,{document,names,company,location:{origin:'https://supplier.coupang.com',pathname:'/qvt/registration'},setTimeout(callback){waits++;if(mode==='ready')document.body.innerText+=' label.png';if(mode==='switch')document.body.innerText='Company Code: A01526306 quotation.xlsx label.png';if(mode==='changed')document.documentElement.dataset.yoofamAttachmentAttempt=JSON.stringify({state:'validation-requested',company,files:names});queueMicrotask(callback);}});
   if(['switch','changed'].includes(mode))await assert.rejects(result);else assert.equal(await result,mode==='ready');
   assert.ok(waits>0);assert.ok(waits<=80);
 }
});

test('upload redraws can close the company menu while exact original attachments finish appearing',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  const names=['quotation.xlsx','photo.png','label.png'];let shown=names.slice(0,1),open=true,waits=0,menuClicks=0;
  const dataset={yoofamAttachmentAttempt:JSON.stringify({state:'dispatched',company,files:names})};
  const menu={innerText:company.name,disabled:false,getClientRects:()=>[{}],click(){menuClicks++;open=true;}};
  const document={documentElement:{dataset},body:{get innerText(){return [company.name,...(open?['Company Code: '+company.code]:[]),...shown].join('\n');}},querySelectorAll:selector=>selector==='button'?[menu]:[]};
  const result=await vm.runInNewContext(`(${waitForSupplierHubAttachments.toString()})(names,company)`,{document,names,company,location:{origin:'https://supplier.coupang.com',pathname:'/qvt/registration'},setTimeout(callback){waits++;open=false;shown=names.slice(0,Math.min(names.length,waits+1));queueMicrotask(callback);}});
  assert.equal(result,true);assert.equal(menuClicks,2);assert.equal(waits,2);assert.equal(JSON.parse(dataset.yoofamAttachmentAttempt).state,'dispatched');
 }
});

test('upload wait requires a revealed exact code after reopening and remains bounded without changing files',async()=>{
 for(const mode of ['delayed','wrong','ambiguous','marker','page','never']){
  const company={code:'A01464742',name:'와이홉'},names=['quotation.xlsx','label.png'];let shown=false,waits=0,clicks=0;
  const location={origin:'https://supplier.coupang.com',pathname:'/qvt/registration'};
  const dataset={yoofamAttachmentAttempt:JSON.stringify({state:'dispatched',company,files:names})};
  const menu={innerText:company.name,disabled:false,getClientRects:()=>[{}],click(){clicks++;if(mode==='marker')dataset.yoofamAttachmentAttempt='changed';if(mode==='page')location.pathname='/qvt/wims';}};
  const document={documentElement:{dataset},body:{get innerText(){return company.name+'\n'+names.join('\n')+(shown?'\nCompany Code: '+(mode==='wrong'?'A01526306':company.code)+(mode==='ambiguous'?'\nCompany Code: A01526306':''):'');}},querySelectorAll:()=>[menu]};
  const pending=vm.runInNewContext(`(${waitForSupplierHubAttachments.toString()})(names,company)`,{document,names,company,location,setTimeout(callback){waits++;if(mode!=='never')shown=true;queueMicrotask(callback);}});
  if(mode==='delayed')assert.equal(await pending,true);else if(mode==='never')assert.equal(await pending,false);else await assert.rejects(pending);
  assert.equal(clicks,1);assert.ok(waits<=80);if(mode==='never')assert.equal(waits,80);
 }
});

test('the direct route survives upload-menu redraws and never repeats delivery on a revealed wrong company',async()=>{
 for(const wrongCompany of [false,true]){
  let polls=0,menuClicks=0;
  const h=await fixture({uploadWait:async(names,company)=>{
   let open=true,shown=names.slice(0,1);
   const dataset={yoofamAttachmentAttempt:JSON.stringify({state:'dispatched',company,files:names})};
   const menu={innerText:company.name,disabled:false,getClientRects:()=>[{}],click(){menuClicks++;open=true;}};
   const document={documentElement:{dataset},body:{get innerText(){return company.name+'\n'+shown.join('\n')+(open?'\nCompany Code: '+(wrongCompany&&polls?'A01526306':company.code):'');}},querySelectorAll:()=>[menu]};
   return vm.runInNewContext(`(${waitForSupplierHubAttachments.toString()})(names,company)`,{document,names,company,location:{origin:'https://supplier.coupang.com',pathname:'/qvt/registration'},setTimeout(callback){polls++;open=false;shown=names;queueMicrotask(callback);}});
  }});
  const outcome=await h.run();assert.equal(outcome.state,wrongCompany?'attached':'validation-requested');assert.equal(menuClicks,1);
  assert.equal(h.records.get(`transmission:${new URL(sender.url).origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`).state,outcome.state);
  assert.equal(h.calls.filter(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true).length,1);
  assert.equal(h.calls.filter(([name])=>name==='requestSupplierHubValidation').length,wrongCompany?0:1);
  await assert.rejects(h.run(),/이미 전송/);assert.equal(h.calls.filter(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true).length,1);
 }
});
