import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {resumeSupplierHubValidation,readAttachedSupplierHubPackage} from '../extensions/supplier-hub/validation-resume.mjs';
import {requestSupplierHubValidation} from '../extensions/supplier-hub/validate.mjs';
import {verifySupplierHubCompany} from '../extensions/supplier-hub/company.mjs';

const identity={origin:'https://sourceflow.jjwwhhjj1116.workers.dev',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64)};
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const sender={frameId:0,url:identity.origin+'/',tab:{id:7,windowId:17}};
const key=`transmission:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`;
function harness(company=companies[0],required=false){
 const names=[`YOOFAM-${identity.fingerprint}.xlsx`,'photo.png','label.png',...(required?['legal-001.pdf']:[])];
 const record={...identity,company,includedOptions:2,profileId:'profile',filename:names[0],attachmentNames:names,legalDocuments:required?['legal-001.pdf']:[],legalDocumentsRequired:required,validationResume:true,windowId:17,tabId:123,state:'attached',startedAt:Date.now(),registered:false};
 const records=new Map([[key,record],['attempt:123',{...identity,company,includedOptions:2}]]),events=[],calls=[],dataset={yoofamAttachmentAttempt:JSON.stringify({state:'dispatched',company,files:names,...(required?{legalDocumentsRequired:true,legalDocuments:record.legalDocuments}:{})})};
 const controls={code:company.code,names,disabled:false,markerChange:false,executeError:false,lostReply:false,receiptError:false,sourceError:false,wrongWindow:false,wrongTab:false,submitted:false,menuVisible:true,menuClicks:0};
 const legalArea={innerText:'상품 개별법령에 따른 필수 서류\n'+(required?'legal-001.pdf':''),parentElement:null,querySelectorAll(selector){return selector.includes('radio')?[legal,{}]:required?[{files:[{name:'legal-001.pdf'}]}]:[];}};
 const legal={checked:required,disabled:false,parentElement:legalArea,labels:[{innerText:required?'해당함':'해당없음'}],click(){this.checked=true;events.push('legal');}};
 const checkboxes=[{checked:false,disabled:false,labels:[{innerText:'제공된 권장소비자가격 또는 공식 판매처 가격 데이터에 대한 쿠팡 약관에 동의합니다.'}],click(){this.checked=true;events.push('price');}},
  {checked:false,disabled:false,labels:[{innerText:'상품 라벨 내 기재된 (010 이하) 연락처는 법인 명의 개통 번호이거나, 해당 브랜드의 공식 대외 창구로 지정된 업무용 연락처에 해당함을 확인하며, 당사는 해당 정보가 대외적으로 공개됨에 동의합니다.'}],click(){this.checked=true;events.push('contact');}}];
 const button={innerText:'파일 검증하기',get disabled(){return controls.disabled;},getClientRects:()=>[{}],getAttribute:()=>null,click(){events.push('validate');}};
 const table={getClientRects:()=>[{}],querySelectorAll(selector){return selector==='thead th'?['견적서 명','견적서 등록일','검증 상태','검증 결과','견적서 ID'].map(innerText=>({innerText})):[{querySelectorAll:()=>[{innerText:names[0]}]}];}};
 const companyMenu={innerText:company.name,disabled:false,getClientRects:()=>[{}],click(){controls.menuVisible=true;controls.menuClicks++;}};
 const document={documentElement:{dataset},body:{get innerText(){return company.name+'\n'+(controls.menuVisible?'Company Code: '+controls.code+'\n':'')+controls.names.join('\n');}},querySelectorAll(selector){
  if(selector==='table')return controls.submitted?[table]:[];
  if(selector.includes(required?'undefined-Y':'undefined-N'))return [legal];
  if(selector.includes('msrpAgreement'))return [checkboxes[0]];if(selector.includes('labelContactAgreement'))return [checkboxes[1]];
  if(selector==='button')return [button,companyMenu];return [];
 }};
 const context=vm.createContext({document,location:{origin:'https://supplier.coupang.com',pathname:'/qvt/registration'},setTimeout});
 let held,resumeHeld,sourceCalls=0;
 const api={tabs:{get:async id=>({id,windowId:controls.wrongWindow?18:17,url:id===7?sender.url:controls.wrongTab?'https://supplier.coupang.com/qvt/other':'https://supplier.coupang.com/qvt/registration'}),
  query(){assert.fail('Resume must not enumerate or select other tabs');},create(){assert.fail('Resume must not create a tab');},sendMessage:async(id,message)=>{
   calls.push(['message',id,message.type]);if(message.type==='YOOFAM_VERIFY_QUOTATION_SOURCE'&&controls.sourceError)throw Error('latest source changed');
   if(message.type==='YOOFAM_VERIFY_QUOTATION_SOURCE'&&++sourceCalls===controls.closeOnSource)controls.menuVisible=false;
   if(message.type==='YOOFAM_READ_TRANSMISSION_RECEIPT'&&controls.receiptError)throw Error('server unavailable');
   return {ok:true,...message.expected,checkedAt:Date.now(),...(message.type==='YOOFAM_READ_TRANSMISSION_RECEIPT'?{receipt:null}:{})};
  }},scripting:{executeScript:async({target,func,args})=>{
   assert.equal(target.tabId,123);assert.ok([verifySupplierHubCompany,readAttachedSupplierHubPackage,requestSupplierHubValidation].includes(func),'no upload/attachment script');calls.push(['script',func.name]);
   if(held&&func===readAttachedSupplierHubPackage)await new Promise(resolve=>{resumeHeld=resolve;});
   if(func===requestSupplierHubValidation){if(controls.markerChange)dataset.yoofamAttachmentAttempt+=' ';if(controls.executeError)throw Error('execution reply unavailable');}
   const result=await vm.runInContext(`(${func.toString()})(...args)`,Object.assign(context,{args}));
   if(func===requestSupplierHubValidation&&controls.lostReply)throw Error('click reply lost');
   return [{result}];
  }}};
 const store=async(action,recordKey,value)=>{calls.push(['store',action,recordKey]);if(action==='get')return records.get(recordKey)??null;if(action==='claim'){if(records.has(recordKey))return false;records.set(recordKey,value);return true;}records.set(recordKey,value);return value;};
 const reviewedAgreements={priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:!required,...(required?{legalDocumentsRequired:true}:{})};
 const message={...identity,type:'YOOFAM_RESUME_VALIDATION',reviewedAgreements};
 return {records,record,controls,events,calls,dataset,checkboxes,legal,run:(patch={},who=sender)=>resumeSupplierHubValidation({...message,...patch},who,api,store),hold(){held=true;},release(){held=false;resumeHeld?.();}};
}

test('both companies resume the original XLSX, images and required/exempt evidence without uploading again',async()=>{
 for(const company of companies)for(const required of [false,true]){
  const h=harness(company,required),before=h.dataset.yoofamAttachmentAttempt;
  const result=await h.run();assert.equal(result.state,'validation-requested');assert.equal(result.registered,false);
  assert.equal(h.events.filter(event=>event==='validate').length,1);assert.notEqual(h.dataset.yoofamAttachmentAttempt,before);
  assert.equal(h.records.get(key).state,'validation-requested');assert.equal(h.records.get(key+':validation').state,'validation-requested');
  assert.deepEqual(h.record.attachmentNames,JSON.parse(h.dataset.yoofamAttachmentAttempt).files);
  await h.run();assert.equal(h.events.filter(event=>event==='validate').length,1);
 }
});

test('returning to attached files with a collapsed company menu resumes only after reading the original company code',async()=>{
 for(const company of companies)for(const required of [false,true]){
  const h=harness(company,required);h.controls.menuVisible=false;
  assert.equal((await h.run()).state,'validation-requested');assert.equal(h.controls.menuClicks,1);
  assert.equal(h.events.filter(event=>event==='validate').length,1);assert.deepEqual(h.record.attachmentNames,JSON.parse(h.dataset.yoofamAttachmentAttempt).files);
  assert.equal(h.calls.find(call=>call[0]==='script')[1],'verifySupplierHubCompany');
 }
});

test('a lost validation reply reconciles its original marker even after the user closes the company menu',async()=>{
 const h=harness();h.controls.lostReply=true;assert.equal((await h.run()).state,'unconfirmed');
 h.controls.lostReply=false;h.controls.menuVisible=false;
 assert.equal((await h.run()).state,'validation-requested');assert.equal(h.controls.menuClicks,1);assert.equal(h.events.filter(event=>event==='validate').length,1);
});

test('resumption reopens a menu closed during source recheck and rejects a revealed wrong company before claiming validation',async()=>{
 const h=harness();h.controls.menuVisible=false;h.controls.closeOnSource=2;
 assert.equal((await h.run()).state,'validation-requested');assert.equal(h.controls.menuClicks,2);assert.equal(h.events.filter(event=>event==='validate').length,1);
 for(const company of companies){const wrong=harness(company);wrong.controls.menuVisible=false;wrong.controls.code=companies.find(value=>value.code!==company.code).code;
  await assert.rejects(wrong.run(),/회사코드/);assert.equal(wrong.events.length,0);assert.equal(wrong.records.has(key+':validation'),false);assert.equal(wrong.records.get(key).state,'attached');
 }
});
test('slow file visibility keeps every attachment and allows only a later explicit validation request',async()=>{
 const h=harness();h.controls.names=h.record.attachmentNames.slice(0,1);
 assert.equal((await h.run()).state,'attached');assert.deepEqual(h.events,[]);assert.equal(h.records.has(key+':validation'),false);
 h.controls.names=h.record.attachmentNames;assert.equal((await h.run()).state,'validation-requested');assert.equal(h.events.filter(e=>e==='validate').length,1);
});
test('disabled button proves no click, persists a retryable claim and later requests validation exactly once',async()=>{
 const h=harness();h.controls.disabled=true;
 assert.equal((await h.run()).state,'attached');assert.deepEqual(h.events,[]);assert.equal(h.records.get(key+':validation').state,'not-started');
 h.controls.disabled=false;assert.equal((await h.run()).state,'validation-requested');await h.run();assert.equal(h.events.filter(e=>e==='validate').length,1);
});
test('lost reply after a real serialized click reconciles the marker after worker restart without another click',async()=>{
 const h=harness();h.controls.lostReply=true;assert.equal((await h.run()).state,'unconfirmed');assert.equal(h.records.get(key+':validation').state,'started');
 h.controls.lostReply=false;assert.equal((await h.run()).state,'validation-requested');assert.equal(h.events.filter(e=>e==='validate').length,1);
});
test('an unanswered execution with no click evidence stays sealed across later requests',async()=>{
 const h=harness();h.controls.executeError=true;assert.equal((await h.run()).state,'unconfirmed');
 h.controls.executeError=false;assert.equal((await h.run()).state,'unconfirmed');assert.deepEqual(h.events,[]);
 assert.equal(h.calls.filter(c=>c[0]==='script'&&c[1]==='requestSupplierHubValidation').length,1);
});
test('same-window single-flight rejects concurrent resumption and releases after completion',async()=>{
 const h=harness();h.hold();const first=h.run();for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(h.run(),/다른 견적서/);h.release();assert.equal((await first).state,'validation-requested');assert.equal(h.events.filter(e=>e==='validate').length,1);
});
test('category, product, fingerprint, window and original tab binding cannot be switched',async()=>{
 for(const patch of [{categoryId:'123'},{productId:'other'},{fingerprint:'b'.repeat(64)}]){const h=harness();await assert.rejects(h.run(patch));assert.deepEqual(h.events,[]);}
 for(const name of ['wrongWindow','wrongTab']){const h=harness();h.controls[name]=true;await assert.rejects(h.run());assert.deepEqual(h.events,[]);}
 const h=harness();h.records.set('attempt:123',{...h.records.get('attempt:123'),productId:'other'});await assert.rejects(h.run(),/다른 견적서/);assert.deepEqual(h.events,[]);
 await assert.rejects(h.run({}, {...sender,tab:{id:7,windowId:18}}));
});
test('changed company, file names, legal originals or partial/legacy claims never request validation',async()=>{
 for(const modify of [h=>h.controls.code='A01526306',h=>{const value=JSON.parse(h.dataset.yoofamAttachmentAttempt);value.files[1]='other.png';h.dataset.yoofamAttachmentAttempt=JSON.stringify(value);},h=>{const value=JSON.parse(h.dataset.yoofamAttachmentAttempt);value.legalDocuments=['legal-002.pdf'];h.dataset.yoofamAttachmentAttempt=JSON.stringify(value);},h=>h.records.set(key,{...h.record,state:'partial'}),h=>h.records.set(key,{...h.record,validationResume:undefined})]){
  const h=harness(companies[0],true);modify(h);await assert.rejects(h.run());assert.deepEqual(h.events,[]);
 }
});
test('latest-source mismatch, saved receipt and unavailable server prevent remote changes',async()=>{
 for(const flag of ['sourceError','receiptError']){const h=harness();h.controls[flag]=true;await assert.rejects(h.run());assert.deepEqual(h.events,[]);assert.equal(h.records.has(key+':validation'),false);}
 for(const state of ['validation-pending','validation-complete','validation-rejected']){const h=harness();h.records.set(key.replace('transmission:','result:'),{state});await assert.rejects(h.run(),/이미 검증 결과/);assert.deepEqual(h.events,[]);}
});
test('visible existing validation row resumes result tracking without accepting agreements or requesting twice',async()=>{
 const h=harness();h.controls.submitted=true;assert.equal((await h.run()).state,'validation-requested');assert.deepEqual(h.events,[]);assert.equal(h.records.has(key+':validation'),false);
});
test('a changed attachment marker between inspection and validation cannot pass the serialized click guard',async()=>{
 const h=harness();h.controls.markerChange=true;assert.equal((await h.run()).state,'unconfirmed');assert.deepEqual(h.events,[]);
});
test('fresh explicit agreements and original required-document applicability are mandatory',async()=>{
 for(const reviewedAgreements of [{priceData:false,labelBusinessContact:true,legalDocumentsNotApplicable:true},{priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true,extra:true},{priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true,legalDocumentsRequired:true}]){
  const h=harness();await assert.rejects(h.run({reviewedAgreements}));assert.deepEqual(h.calls,[]);
 }
 const h=harness(companies[0],true);await assert.rejects(h.run({reviewedAgreements:{priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true}}),/필수 서류/);assert.deepEqual(h.events,[]);
});
test('company or attachment changes caused by agreement updates are checked again before clicking validation',async()=>{
 for(const change of [h=>h.controls.code='A01526306',h=>h.controls.names=h.record.attachmentNames.slice(0,1),h=>h.dataset.yoofamAttachmentAttempt+=' ']){
  const h=harness();const original=h.checkboxes[0].click;h.checkboxes[0].click=function(){original.call(this);change(h);};
  assert.equal((await h.run()).state,'unconfirmed');assert.ok(!h.events.includes('validate'));assert.equal(h.records.get(key+':validation').state,'started');
 }
});
test('app bridge forwards only the validation command and worker preserves uncertain failures without treating them as a fresh upload',async()=>{
 const windows=[],messages=[],responses=[];
 const window={addEventListener:(_event,listener)=>windows.push(listener),postMessage:(message,origin)=>responses.push({message,origin})};
 const context={window,location:{origin:identity.origin},chrome:{runtime:{sendMessage:async message=>{messages.push(message);return {ok:true};},onMessage:{addListener(){}}}}};
 vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),context);
 await windows[0]({source:window,origin:identity.origin,data:{channel:'YOOFAM_HUB_HANDOFF',type:'VALIDATE',requestId:'a'.repeat(36),payload:{...identity,type:'YOOFAM_TRANSMIT_PACKAGE'}}});
 assert.equal(messages[0].type,'YOOFAM_RESUME_VALIDATION');assert.equal(messages[0].base64,undefined);assert.equal(responses[0].origin,identity.origin);
 let listener,calls=0,fail=false;
 vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-worker.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,''),{
  chrome:{runtime:{onMessage:{addListener:fn=>{listener=fn;}}}},resumeSupplierHubValidation:async(message,who)=>{calls++;assert.equal(message.type,'YOOFAM_RESUME_VALIDATION');assert.equal(who,sender);if(fail)throw Error('unknown validation reply');return {state:'validation-requested',registered:false};},
 });
 const reply=await new Promise(resolve=>assert.equal(listener({...identity,type:'YOOFAM_RESUME_VALIDATION'},sender,resolve),true));assert.equal(reply.result.state,'validation-requested');assert.equal(reply.registered,false);
 fail=true;const error=await new Promise(resolve=>listener({...identity,type:'YOOFAM_RESUME_VALIDATION'},sender,resolve));assert.equal(error.ok,false);assert.equal(error.error,'unknown validation reply');assert.equal(error.result,undefined);assert.equal(calls,2);
});
