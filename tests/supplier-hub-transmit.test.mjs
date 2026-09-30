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

const identity={productId:'product',categoryId:'80719',fingerprint:'a'.repeat(64)};
const sender={tab:{id:7,windowId:17},frameId:0,url:'https://sourceflow.jjwwhhjj1116.workers.dev/'};
const agreements={priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true};
async function packageBytes(changes={}){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/exports/zip.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,TextEncoder,Uint8Array,Uint32Array,DataView});
 const workbook=new Uint8Array([80,75,3,4,0,1]),filename=`YOOFAM-${identity.fingerprint}.xlsx`;
 const digest=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
 const plan={format:'sourceflow-supplier-hub-upload-plan-v1',destination:'https://supplier.coupang.com/qvt/registration',company:{code:'A01464742',name:'와이홉'},productId:identity.productId,categoryId:identity.categoryId,inputFingerprint:identity.fingerprint,quotation:{file:{filename,byteLength:workbook.length,sha256:digest}},productImages:[{archivePath:'assets/photo.png',filename:'photo.png'}],labelImages:[{archivePath:'assets/label.png',filename:'label.png'}],missingLabels:[],...changes};
 const review={format:'sourceflow-quotation-review-v1',...identity,inputFingerprint:identity.fingerprint,submissionReady:false,transport:'not-connected',includedOptions:2,errorCount:0,reviewCount:0,omittedIssueCount:0,issues:[]};
 return Buffer.from(exports.zipFiles([{name:filename,data:workbook},{name:'assets/photo.png',data:new Uint8Array([137,80,78,71])},{name:'assets/label.png',data:new Uint8Array([137,80,78,71])},{name:'submission-review.json',data:JSON.stringify(review)},{name:'supplier-hub-upload-plan.json',data:JSON.stringify(plan)}])).toString('base64');
}
async function fixture(options={}){
 const calls=[],records=new Map();
 const tab={id:123,windowId:17,url:'https://supplier.coupang.com/qvt/registration',...options.tab};
 let checks=0;
 const api={tabs:{query:async query=>{calls.push(['query',query]);return options.tabs??[tab];},get:async()=>options.getTab??tab},scripting:{executeScript:async request=>{
   assert.equal(request.target.tabId,123);calls.push([request.func.name,request.args]);
   if(request.func===verifySupplierHubCompany)return [{result:{code:options.companyCodes?.[checks++]??'A01464742'}}];
   if(request.func===attachToSupplierHub){
     if(request.args[1]===true){if(options.preflightError)throw Error('existing files');return [{result:{state:'ready',registered:false}}];}
     await options.onAttach?.();if(options.attachError)throw Error('lost response');return [{result:{state:options.outcome??'dispatched',registered:false}}];
   }
   if(request.func===waitForSupplierHubAttachments)return [{result:options.ready??true}];
   if(request.func===requestSupplierHubValidation){assert.deepEqual(request.args,[agreements,true]);if(options.validationError)throw Error('button disabled');return [{result:{state:'validation-requested',validated:false,registered:false}}];}
   throw Error('unexpected script');
 }}};
 const store=async(action,key,value)=>{
   calls.push(['store',action,key]);
   if(action==='claim'){if(records.has(key))return false;records.set(key,value);return true;}
   if(action==='put')records.set(key,value);else return records.get(key);
 };
 const message={...identity,type:'YOOFAM_TRANSMIT_PACKAGE',reviewedAgreements:agreements,base64:await packageBytes(options.plan)};
 return {calls,records,run:(patch={},who=sender)=>transmitSupplierHubPackage({...message,...patch},who,api,store)};
}

test('app transmission uses its existing Chrome window and binds attachment/validation to the reviewed package',async()=>{
 const h=await fixture();const result=await h.run();assert.equal(result.state,'validation-requested');assert.equal(result.registered,false);
 assert.deepEqual(h.calls[0],['query',{windowId:17}]);
 const attempt=h.records.get('attempt:123');assert.equal(attempt.productId,identity.productId);assert.equal(attempt.company.code,'A01464742');assert.equal(attempt.includedOptions,2);
 const scripts=h.calls.filter(([name])=>['attachToSupplierHub','waitForSupplierHubAttachments','requestSupplierHubValidation'].includes(name));
 assert.deepEqual(scripts.map(([name])=>name),['attachToSupplierHub','attachToSupplierHub','waitForSupplierHubAttachments','requestSupplierHubValidation']);
 assert.deepEqual(scripts[2][1][0],[`YOOFAM-${identity.fingerprint}.xlsx`,'photo.png','label.png']);
 await assert.rejects(h.run(),/이미 전송/);assert.equal(h.calls.filter(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true).length,1);
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
   assert.equal(h.records.has('attempt:123'),state==='attached');
   await assert.rejects(h.run());assert.equal(h.calls.filter(([name,args])=>name==='attachToSupplierHub'&&args[1]!==true).length,1);
 }
});

test('closing the caller cannot permit a second transmission while worker attachment is pending',async()=>{
 let finish;const held=new Promise(resolve=>{finish=resolve;});const h=await fixture({onAttach:()=>held});
 const first=h.run();await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(h.run(),/전송 중/);finish();assert.equal((await first).state,'validation-requested');
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
