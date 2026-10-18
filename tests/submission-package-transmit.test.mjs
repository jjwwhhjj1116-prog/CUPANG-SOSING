import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {submissionPackageUI} from './helpers/submission-package-ui.mjs';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settle=async()=>{for(let index=0;index<8;index++)await new Promise(resolve=>setImmediate(resolve));};
const fingerprint='a'.repeat(64);
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];

// An isolated complete synthetic draft through the real API/SQLite/R2 and ZIP
// preparation bridge. No browser is opened and no bytes are delivered to Hub.
async function reviewedPackageFixture(company){
 const api=mobileIntakeHarness({companyCode:company.code,companyName:company.name}),json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
 try{
  const fields=['skuId','categoryId',...api.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)],workbook=new Uint8Array(quotationWorkbook(fields)),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex'),storageKey=api.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');
  await api.bindings.FILES.put(storageKey,workbook,{customMetadata:{sha256,format:'xlsx'}});
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'최종 수동 검토 전송 시험',categoryId:'80719',categoryPath:api.context.category.categoryPath,
   template:{name:'synthetic-explicit-transmit.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  api.context.category=profile;api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(api.context),'job');await api.intake();
  const product=api.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,images=JSON.parse(product.image_keys),content=(await json(await api.route(base+'/content'))).content;
  await json(await api.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{model:'SYNTHETIC-MANUAL-MODEL',material:'검토한 합성 재질'},assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
  const view=await json(await api.route(base+'/quotation-fields'));
  await json(await api.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
   {fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},{fieldKey:'packagedWeightG',optionId:null,value:'420'},{fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},{fieldKey:'storageMaterial',optionId:null,value:''},
  ]}}));
  const documents=await json(await api.route(base+'/legal-documents'));await json(await api.route(base+'/legal-documents',{method:'PATCH',body:{expectedRevision:documents.revision,applicability:'not-applicable'}}));
  const preview=await json(await api.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}));assert.equal(preview.submissionReview.errorCount,0,JSON.stringify(preview.submissionReview.issues));
  const retained=()=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','collection_context','category_profiles'].map(table=>api.sqlite.prepare('SELECT * FROM '+table).all()));
  const ui=submissionPackageUI({route:api.route,productId:product.id,profileId:profile.id});await ui.click('견적서 + 첨부 파일 준비');ui.choose();assert.equal(ui.button('등록 전송').props.disabled,false);
  return{api,product,base,profile,preview,ui,retained,json,workbook,storageKey};
 }catch(cause){api.close();throw cause;}
}
function harness({receiptReadStatus=200,receiptReadCode,receiptReadNetworkError=false,receiptStoreError=false,conflict=false,uncertain=false,preflightRejected=false,validationComplete=false,notStarted=false,manualWait=false,issued=false,registrationPatch,editDuringExport=false,company={code:'A01464742',name:'와이홉'},savedSubmission,resultPatch,recoveryError=false,legalDocuments,attached=false,resumeStates=[],missedLookup=false,holdRetry=false,history,localHistoryBlocked=false,historyLookupError=false}={}){
 const slots=[],calls=[],modules=new Map();let cursor=0,sourceChanged=false;
 let clock=0,editNext=false,resumeRetry;
 const preview={fingerprint,filename:`YOOFAM-${fingerprint}.xlsx`,headers:['상품명'],rows:[['상품']],report:{company,productId:'p',categoryId:'80719',profileId:'profile',rowCount:1,warnings:[],submissionReady:false,...(legalDocuments?{legalDocuments}:{})},submissionReview:{productId:'p',categoryId:'80719',inputFingerprint:fingerprint,submissionReady:false,transport:'not-connected',errorCount:0,reviewCount:0,omittedIssueCount:0,issues:[]}};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(effect,deps){const i=cursor++;if(!(i in slots)||JSON.stringify(slots[i].deps)!==JSON.stringify(deps)){slots[i]?.cleanup?.();slots[i]={deps,cleanup:effect()};}}};
 hooks.useLayoutEffect=hooks.useEffect;
 let editRecovery=false,lookupError=false,holdLookup=false,resumeLookup,historyReadError=false;
 const bridge={getSupplierHubProductHistory:async()=>{if(historyLookupError)throw Error('이전 Chrome 이력 조회 실패');return {records:[],blocked:localHistoryBlocked};},
  checkSupplierHubExtension:async(_signal,direct)=>calls.push(['check',direct]),prepareSupplierHubHandoff:async()=>calls.push(['prepare']),
  getSupplierHubSubmission:async identity=>{calls.push(['recover',identity]);if(recoveryError)throw Error('전송 기록 읽기 실패');if(editRecovery)sourceChanged=true;return savedSubmission||{attempt:null,result:null};},
  transmitSupplierHubPackage:async(blob,identity,reviewed)=>{
   calls.push(['transmit',identity,reviewed,await blob.text()]);
   if(preflightRejected){preflightRejected=false;throw Error('회원 회사와 Supplier Hub 회사코드가 일치하지 않습니다.');}
   if(!notStarted)savedSubmission={attempt:{state:uncertain?'unconfirmed':attached?'attached':'validation-requested',company,includedOptions:1,startedAt:Date.now(),registered:false,validationResume:true},result:null};
   if(uncertain)throw Error('응답 확인 불가');return {state:notStarted?'not-started':attached?'attached':'validation-requested',registered:false};
  },resumeSupplierHubValidation:async(identity,reviewed)=>{
   calls.push(['resume-validation',identity,reviewed]);const state=resumeStates.shift()||'validation-requested';
   if(savedSubmission)savedSubmission={...savedSubmission,attempt:{...savedSubmission.attempt,state}};
   return {state,registered:false,...(state==='attached'?{error:'검증 버튼 준비 중'}:{})};
  },getSupplierHubResult:async(identity,_signal,refresh)=>{
   calls.push(['result',identity,refresh]);if(refresh==='registration'&&editNext)sourceChanged=true;
   if(holdLookup)await new Promise(resolve=>{resumeLookup=resolve;});
   if(lookupError)throw Error('상품별 결과 응답 시간 초과');
   if(missedLookup){missedLookup=false;throw new bridge.SupplierHubLookupUnavailable('lookup reply lost');}
   const result={state:validationComplete?'validation-complete':'validation-pending',filename:preview.filename,company:preview.report.company,includedOptions:1,quotationId:validationComplete?'quote-123':undefined,observedAt:Date.now(),registered:false,...(refresh==='registration'?{registration:{quotationId:'quote-123',scope:'visible-page',rows:issued?[{title:'상품',submittedAt:'date',category:'cat',barcode:'',sourceQuotation:preview.filename,skuId:'sku-123',status:'상품 검수중',stage:'가격/정책'}]:[],includedOptions:1,observedAt:Date.now(),registered:false,...registrationPatch}}:{}),...resultPatch};
   if(savedSubmission)savedSubmission={...savedSubmission,result};return result;
  }};
 function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,URL,TextEncoder,setTimeout,fetch:async(url,init)=>{
   if(url.includes('supplier-hub-receipt')){
    if(init?.method!=='POST'&&receiptReadNetworkError)throw Error('network disconnected');
    if(init?.method!=='POST'&&receiptReadStatus!==200)return Response.json({error:'결과 조회 실패',code:receiptReadCode},{status:receiptReadStatus});
    if(url.includes('mode=history'))return historyReadError?Response.json({error:'상품 전체 이력 조회 실패'},{status:503}):Response.json({history:history??{schemaVersion:1,productId:'p',blocked:false,receipts:[]}});
    return receiptStoreError&&init?.method==='POST'?Response.json({error:'결과 보관 일시 실패'},{status:503}):Response.json(init?.method==='POST'?{saved:true,fingerprint,registered:false}:{receipt:null});
   }
   const body=JSON.parse(init.body);calls.push(['fetch',url,body]);
   if(body.action==='preview'||body.action==='source')return Response.json({...preview,...(sourceChanged?{fingerprint:'b'.repeat(64)}:{})});
   if(conflict)return Response.json({error:'저장값이 변경되었습니다.'},{status:409});
   if(body.action==='export'&&editDuringExport)sourceChanged=true;
   return new Response('ZIP bytes',{headers:{'content-type':'application/zip'}});
 },require(name){if(name==='react')return hooks;if(name==='@/app/supplier-hub-handoff')return bridge;if(name==='@/app/supplier-hub-tracking')return trackingBridge;if(name==='@/app/components/quotation-review-issues')return {QuotationReviewIssues:'issues'};if(name==='@/app/components/legal-documents-editor')return {LegalDocumentsEditor:'legal-documents'};if(name==='@/app/components/historical-supplier-hub-result')return {HistoricalSupplierHubResult:'historical-result'};return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});return exports;}
 bridge.validateSupplierHubResultForSource=load('app/supplier-hub-handoff.ts').validateSupplierHubResultForSource;
 bridge.SupplierHubResultInvalid=load('app/supplier-hub-handoff.ts').SupplierHubResultInvalid;
 bridge.SupplierHubLookupUnavailable=load('app/supplier-hub-handoff.ts').SupplierHubLookupUnavailable;
 bridge.supplierHubRegistrationEvidence=load('app/supplier-hub-handoff.ts').supplierHubRegistrationEvidence;
 bridge.validateRegistrationResult=load('app/supplier-hub-handoff.ts').validateRegistrationResult;
 const tracker=load('app/supplier-hub-tracking.ts');
 const trackingBridge={...tracker,followSupplierHubRegistration:(source,options)=>tracker.followSupplierHubRegistration(source,{...options,maxDurationMs:holdRetry?10000:1000,now:()=>clock,wait:async(ms,signal)=>{
  if(holdRetry){holdRetry=false;await new Promise((resolve,reject)=>{const abort=()=>reject(Error('paused'));signal.addEventListener('abort',abort,{once:true});resumeRetry=()=>{signal.removeEventListener('abort',abort);resolve();};});}
  if(manualWait)return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('paused')),{once:true}));
  clock+=ms;
 }})};
 const Component=load('app/components/submission-package.tsx').SubmissionPackage;
 const render=()=>{cursor=0;return Component({productId:'p',profileId:'profile',categoryId:'80719',onInspect(){}});};
 const button=text=>nodes(render()).find(node=>node.type==='button'&&node.props.children===text);
 const unmount=()=>{for(const slot of slots)slot?.cleanup?.();};
 return {render,calls,button,unmount,resumeRetry(){resumeRetry?.();},remount(){unmount();slots.length=0;},changeSource(){sourceChanged=true;},editDuringNextLookup(){editNext=true;},editDuringRecovery(){editRecovery=true;},recover(){recoveryError=false;receiptReadStatus=200;receiptReadNetworkError=false;},failReceiptRead(){receiptReadStatus=503;},failWholeHistory(){historyReadError=true;},recoverWholeHistory(){historyReadError=false;},failChromeRecovery(){recoveryError=true;},setSavedSubmission(value){savedSubmission=value;},failLookup(){lookupError=true;},holdLookup(){holdLookup=true;},resumeLookup(){holdLookup=false;resumeLookup?.();},setResultPatch(value){resultPatch=value;},complete(){validationComplete=true;issued=true;},hideSkus(){issued=false;},choose(){for(const input of nodes(render()).filter(node=>node.type==='input'))input.props.onChange({target:{checked:true}});}};
}

for(const company of companies)test(`agreements withdrawn during the final source await prevent dispatch of the reviewed package (${company.code})`,async()=>{
 for(const index of [0,1,2]){
  const f=await reviewedPackageFixture(company);try{
   const before=f.retained(),tree=f.ui.render(),checkbox=nodes(tree).filter(node=>node.type==='input')[index],gate=f.ui.deferNext('source');
   f.ui.button('등록 전송').props.onClick();await gate.arrived;
   checkbox.props.onChange({target:{checked:false}});gate.release();await f.ui.idle();
   assert.equal(f.ui.dispatches.length,0,'a valid source response cannot authorize withdrawn current agreements');assert.equal(f.retained(),before);
   f.ui.choose();await f.ui.click('등록 전송');assert.equal(f.ui.dispatches.length,1,'fresh manual consent and click can send the unchanged quotation once');
   const sent=f.ui.calls.find(call=>call.action==='transmit');assert.deepEqual(sent.files.company,company);assert.equal(sent.identity.fingerprint,f.preview.fingerprint);assert.equal(f.retained(),before);assert.ok(!f.api.network.includes('supplier.coupang.com'));
  }finally{f.api.close();}
 }
});

for(const company of companies)test(`document saves during the final source await block stale transmission and handoff dispatch (${company.code})`,async()=>{
 for(const label of ['등록 전송','확장에 첨부 파일 준비']){
  const f=await reviewedPackageFixture(company);try{
   const tree=f.ui.render(),gate=f.ui.deferNext('source');f.ui.button(label).props.onClick();await gate.arrived;
   const documents=await f.json(await f.api.route(f.base+'/legal-documents'));await f.json(await f.api.route(f.base+'/legal-documents',{method:'PATCH',body:{expectedRevision:documents.revision,applicability:'not-applicable'}}));
   const retained=f.retained();nodes(tree).find(node=>node.type==='legal-documents').props.onSaved();gate.release();await f.ui.idle();
   assert.equal(f.ui.dispatches.length,0,'an old source response cannot dispatch after the document save invalidates the preview');assert.equal(f.retained(),retained);
   await f.ui.click('견적서 + 첨부 파일 준비');assert.equal(f.ui.button('등록 전송').props.disabled,true);f.ui.choose();await f.ui.click('등록 전송');
   const sent=f.ui.calls.filter(call=>call.action==='transmit');assert.equal(sent.length,1);assert.notEqual(sent[0].identity.fingerprint,f.preview.fingerprint);assert.deepEqual(sent[0].files.company,company);assert.equal(f.retained(),retained);assert.ok(!f.api.network.includes('supplier.coupang.com'));
  }finally{f.api.close();}
 }
});

for(const company of companies)test(`withdrawn current agreements block a retained send handler before any export or dispatch (${company.code})`,async()=>{
 const f=await reviewedPackageFixture(company);try{
  const before=f.retained();
  for(const index of [0,1,2]){
   f.ui.choose();const rendered=f.ui.render(),send=nodes(rendered).find(node=>node.type==='button'&&node.props.children==='등록 전송').props.onClick,checkbox=nodes(rendered).filter(node=>node.type==='input')[index],start=f.ui.calls.length;
   checkbox.props.onChange({target:{checked:false}});send();await f.ui.idle();
   assert.ok(f.ui.calls.slice(start).every(call=>!['export','transmit','prepare'].includes(call.action)),'a captured checked choice does not override the current unchecked intent');
   assert.equal(f.retained(),before);assert.equal(f.ui.button('등록 전송').props.disabled,true);
  }
  f.ui.choose();await f.ui.click('등록 전송');const sent=f.ui.calls.filter(call=>call.action==='transmit');assert.equal(sent.length,1);assert.deepEqual(sent[0].files.company,company);assert.equal(sent[0].files.profileId,f.profile.id);assert.equal(sent[0].identity.fingerprint,f.preview.fingerprint);assert.equal(sent[0].identity.productId,f.product.id);assert.equal(sent[0].identity.categoryId,'80719');assert.equal(sent[0].files.quotation[0].name,f.preview.filename);assert.equal(sent[0].files.includedOptions,6);
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].agreements)),{priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true});assert.equal(f.retained(),before);assert.deepEqual(f.api.objects.get(f.storageKey),f.workbook);assert.ok(!f.api.network.includes('supplier.coupang.com'));
 }finally{f.api.close();}
});

for(const company of companies)test(`document saves invalidate old package actions and issue navigation before React commits (${company.code})`,async()=>{
 const f=await reviewedPackageFixture(company);try{
  const tree=f.ui.render(),oldActions=['등록 전송','확장에 첨부 파일 준비','견적서 파일 다운로드','확인한 견적서 + 첨부 ZIP 다운로드'].map(label=>nodes(tree).find(node=>node.type==='button'&&node.props.children===label).props.onClick),oldInspect=nodes(tree).find(node=>node.type==='issues').props.onInspect;
  const documents=await f.json(await f.api.route(f.base+'/legal-documents'));await f.json(await f.api.route(f.base+'/legal-documents',{method:'PATCH',body:{expectedRevision:documents.revision,applicability:'not-applicable'}}));
  const before=f.retained(),start=f.ui.calls.length;nodes(tree).find(node=>node.type==='legal-documents').props.onSaved();
  for(const action of oldActions){action();await f.ui.idle();}oldInspect({optionId:null,fieldId:'handlingReason'});
  assert.equal(f.ui.calls.length,start,'invalidated preview callbacks do not export, query receipt stores, transmit, or reopen an obsolete field');assert.equal(f.retained(),before);
  assert.equal(f.ui.button('등록 전송'),undefined);await f.ui.click('견적서 + 첨부 파일 준비');assert.equal(f.ui.button('등록 전송').props.disabled,true,'a new document revision requires fresh manual consent');
  const changed=await f.json(await f.api.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}}));assert.notEqual(changed.fingerprint,f.preview.fingerprint);
  f.ui.choose();await f.ui.click('등록 전송');const sent=f.ui.calls.filter(call=>call.action==='transmit');assert.equal(sent.length,1);assert.equal(sent[0].identity.fingerprint,changed.fingerprint);assert.equal(sent[0].files.quotation[0].name,changed.filename);assert.deepEqual(sent[0].files.company,company);assert.equal(f.retained(),before);assert.ok(!f.api.network.includes('supplier.coupang.com'));
 }finally{f.api.close();}
});

for(const company of companies)test(`pausing a dispatched quotation cannot reactivate a retained send or preparation handler (${company.code})`,async()=>{
 const h=harness({company,manualWait:true});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();
 const oldSend=h.button('등록 전송').props.onClick,oldPrepare=h.button('확장에 첨부 파일 준비').props.onClick;oldSend();await settle();assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
 h.button('결과 확인 일시정지').props.onClick();await settle();const start=h.calls.length;
 oldPrepare();await settle();oldSend();await settle();
 assert.equal(h.calls.length,start,'the original attempt remains locked after result tracking is paused');assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
 h.button('전송 결과 계속 확인').props.onClick();await settle();h.button('결과 확인 일시정지').props.onClick();await settle();assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
});

for(const company of companies)test(`failed receipt recovery invalidates an earlier checked send handler even with the same rebuilt fingerprint (${company.code})`,async()=>{
 const h=harness({company});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();const oldSend=h.button('등록 전송').props.onClick;
 h.failReceiptRead();h.failChromeRecovery();const tree=h.render();
 // Recovery is the same explicit action used when the cached checked flag is
 // invalidated. A retained callback must not keep its old successful check.
 const prepare=nodes(tree).find(node=>node.type==='button'&&node.props.children==='견적서 + 첨부 파일 준비');prepare.props.onClick();await settle();
 const start=h.calls.length;oldSend();await settle();assert.equal(h.calls.length,start);assert.equal(h.calls.some(([name])=>name==='transmit'||name==='prepare'),false);
});

for(const company of companies)test(`closed package handlers stay inactive after reopening the same company draft (${company.code})`,async()=>{
 const h=harness({company});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();
 const oldSend=h.button('등록 전송').props.onClick,oldPrepare=h.button('확장에 첨부 파일 준비').props.onClick,start=h.calls.length;
 h.unmount();oldSend();oldPrepare();await settle();assert.equal(h.calls.length,start);
 h.remount();h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();const restored=h.calls.length;
 oldSend();oldPrepare();await settle();assert.equal(h.calls.length,restored,'remounting never revives callbacks from the previous component');
 assert.equal(h.button('등록 전송').props.disabled,true);h.choose();h.button('등록 전송').props.onClick();await settle();assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);h.unmount();
});

for(const company of companies)test(`failed whole-history recheck never reuses an earlier verified history for a new send (${company.code})`,async()=>{
 const h=harness({company,recoveryError:true});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
 const retainedRecover=h.button('전송 기록 다시 확인').props.onClick;h.recover();retainedRecover();await settle();h.choose();assert.equal(h.button('등록 전송').props.disabled,false);
 const retainedSend=h.button('등록 전송').props.onClick;h.failWholeHistory();retainedRecover();await settle();
 assert.equal(h.button('등록 전송').props.disabled,true,'individual empty receipt stores cannot replace an unavailable whole-product history');
 const start=h.calls.length;retainedSend();await settle();assert.ok(h.calls.slice(start).every(([name,,body])=>name!=='transmit'&&!(name==='fetch'&&body.action==='export')));assert.equal(h.calls.some(([name])=>name==='transmit'),false);
 h.recoverWholeHistory();retainedRecover();await settle();assert.equal(h.button('등록 전송').props.disabled,false,'a fresh complete history scan permits an explicit manual send');
 h.button('등록 전송').props.onClick();await settle();assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
});

test('rejected files and SKU rows unlock document correction while the original quotation stays blocked from retransmission',async()=>{
 for(const company of companies)for(const rejectedFile of [true,false]){
  const result={state:rejectedFile?'validation-rejected':'validation-complete',filename:`YOOFAM-${fingerprint}.xlsx`,company,includedOptions:1,observedAt:Date.now(),registered:false,
   ...(rejectedFile?{status:'검증 실패',detail:'서류 수정 필요'}:{quotationId:'quote-123',registration:{quotationId:'quote-123',scope:'visible-page',includedOptions:1,observedAt:Date.now(),registered:false,rows:[{title:'상품',submittedAt:'date',category:'cat',barcode:'',sourceQuotation:`YOOFAM-${fingerprint}.xlsx`,skuId:'',status:'반려',stage:'서류 확인'}]}})};
  const h=harness({company,savedSubmission:{attempt:null,result}});
  h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
  assert.equal(nodes(h.render()).find(node=>node.type==='legal-documents').props.disabled,false);
  assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
  assert.equal(h.button('확장에 첨부 파일 준비').props.disabled,true);
  assert.equal(h.calls.some(([name])=>name==='transmit'||name==='prepare'),false);
 }
});

for(const company of companies)test(`a new preview keeps old pending A visible and cannot transmit edited B despite fresh manual agreements (${company.code})`,async()=>{
 const oldFingerprint='c'.repeat(64),receipt={schemaVersion:1,evidence:'chrome-observation',profileId:'original-profile',categoryId:'69900',fingerprint:oldFingerprint,productVersion:'2026-10-01T00:00:00.000Z',recordedAt:'2026-10-01T00:00:01.000Z',result:{state:'validation-pending',filename:`YOOFAM-${oldFingerprint}.xlsx`,company,includedOptions:6,observedAt:Date.now(),registered:false}},before=JSON.stringify(receipt);
 const h=harness({company,history:{schemaVersion:1,productId:'p',blocked:true,receipts:[receipt]}});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();
 assert.equal(h.button('등록 전송').props.disabled,true);assert.equal(h.button('확장에 첨부 파일 준비').props.disabled,true);assert.equal(h.button('견적서 파일 다운로드').props.disabled,false);
 const panel=nodes(h.render()).find(node=>node.type==='historical-result');assert.equal(panel.props.receipt.fingerprint,oldFingerprint);assert.equal(panel.props.receipt.categoryId,'69900');assert.equal(panel.props.receipt.result.includedOptions,6);assert.equal(panel.props.productId,'p');
 assert.equal(JSON.stringify(receipt),before);assert.equal(h.calls.some(([action])=>['transmit','prepare','result'].includes(action)),false);assert.equal(h.calls.some(([name,,body])=>name==='fetch'&&body.action==='export'),false);
});
test('Chrome-only uncertain history and unreadable whole history lock new sends while retained results remain available',async()=>{
 for(const options of [{localHistoryBlocked:true},{historyLookupError:true}]){
  const h=harness(options);h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();assert.equal(h.button('등록 전송').props.disabled,true);assert.equal(h.button('확장에 첨부 파일 준비').props.disabled,true);assert.equal(h.button('견적서 파일 다운로드').props.disabled,false);
  assert.equal(h.calls.some(([action])=>['transmit','prepare'].includes(action)),false);if(options.historyLookupError)assert.equal(h.button('전송 기록 다시 확인').props.disabled,false);
 }
});

test('pending, accepted and uncertain transmissions keep document correction locked',async()=>{
 const company=companies[0];
 for(const state of ['validation-pending','validation-complete',null]){
  const result=state?{state,filename:`YOOFAM-${fingerprint}.xlsx`,company,includedOptions:1,observedAt:Date.now(),registered:false,...(state==='validation-complete'?{quotationId:'quote-123'}:{})}:null;
  const h=harness({savedSubmission:{attempt:{state:'unconfirmed',company,includedOptions:1,startedAt:Date.now(),registered:false},result}});
  h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
  assert.equal(nodes(h.render()).find(node=>node.type==='legal-documents').props.disabled,true);
  assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
 }
});

test('document rejection correction creates a newly reviewed fingerprint without replacing the old receipt or manual values',async()=>{
 const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
 for(const company of companies)for(const rejectedFile of [true,false]){
  const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
  try{
   const fields=['skuId','categoryId',...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)];
   const workbook=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
   const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
   const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'반려 수정 합성 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,
    template:{name:'synthetic.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
   h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
   const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
   const content=(await json(await h.route(base+'/content'))).content,images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
   await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{model:'MANUAL-KEEP',material:'나일론'},assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
   const view=await json(await h.route(base+'/quotation-fields'));
   await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[
    {fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},{fieldKey:'packagedWeightG',optionId:null,value:'420'},{fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},{fieldKey:'storageMaterial',optionId:null,value:''},
   ]}}));
   const documents=h.load('app/api/products/[id]/legal-documents/route.ts'),context={params:Promise.resolve({id:product.id})};
   const upload=async revision=>{const body=new FormData();body.set('expectedRevision',String(revision));body.set('file',new File([`%PDF-1.7\n% synthetic revision ${revision}\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n`],'증빙.pdf'));return json(await documents.POST(new Request('https://app.test'+base+'/legal-documents',{method:'POST',body}),context),201);};
   const original=await upload((await json(await h.route(base+'/legal-documents'))).revision);
   const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));assert.equal(preview.submissionReview.errorCount,0);
   const result={state:rejectedFile?'validation-rejected':'validation-complete',filename:preview.filename,company,includedOptions:preview.report.rowCount,observedAt:Date.now(),registered:false,
    ...(rejectedFile?{detail:'증빙 수정 필요'}:{quotationId:'old-quote',registration:{quotationId:'old-quote',scope:'queried-pages',pagesRead:1,hasMore:false,includedOptions:preview.report.rowCount,observedAt:Date.now(),registered:false,
     rows:preview.rows.map((_,index)=>({title:'검토 상품 '+index,submittedAt:'2026-10-01',category:'합성 폼 시험',barcode:'',sourceQuotation:preview.filename,skuId:'',status:'반려',stage:'서류 확인'}))}})};
   await json(await h.route(base+'/supplier-hub-receipt',{method:'POST',body:{profileId:'cat',categoryId:'80719',fingerprint:preview.fingerprint,result}}));
   const priorReceipt=h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get().payload;
   const beforeContent=(await json(await h.route(base+'/content'))).content,beforeOptions=h.sqlite.prepare('SELECT * FROM product_options ORDER BY product_id').all(),beforeOverrides=h.sqlite.prepare('SELECT * FROM product_quotation_fields').all();
   const ui=submissionPackageUI({route:h.route,productId:product.id});await ui.click('견적서 + 첨부 파일 준비');
   const editor=nodes(ui.render()).find(node=>node.type==='legal-documents');assert.equal(editor.props.disabled,false);
   assert.equal(ui.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
   const replacement=await upload(original.revision);
   await json(await h.route(base+'/legal-documents',{method:'PATCH',body:{expectedRevision:replacement.revision,removeKey:original.documents.files[0].key}}));editor.props.onSaved();
   assert.equal(ui.button('등록 전송'),undefined);await ui.click('견적서 + 첨부 파일 준비');
   assert.equal(ui.button('등록 전송').props.disabled,true,'the corrected quotation needs fresh manual agreements');ui.choose();assert.equal(ui.button('등록 전송').props.disabled,!rejectedFile,'an assigned quotation ID stays blocked even when its SKU rows were rejected');
   const corrected=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));assert.notEqual(corrected.fingerprint,preview.fingerprint);assert.deepEqual(corrected.rows,preview.rows);
   assert.equal((await json(await h.route(base+'/supplier-hub-receipt?fingerprint='+corrected.fingerprint))).receipt,null);
   if(!rejectedFile){
    assert.equal(ui.button('확장에 첨부 파일 준비').props.disabled,true);assert.equal(ui.calls.some(call=>call.action==='transmit'||call.action==='prepare'),false);
    const originalPanel=nodes(ui.render()).find(node=>node.type==='historical-result');assert.equal(originalPanel.props.receipt.fingerprint,preview.fingerprint);assert.equal(originalPanel.props.receipt.result.quotationId,'old-quote');
    assert.equal(h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts WHERE fingerprint=?').get(preview.fingerprint).payload,priorReceipt);
    assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_options ORDER BY product_id').all(),beforeOptions);assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_quotation_fields').all(),beforeOverrides);
    continue;
   }
   await ui.click('등록 전송');assert.deepEqual(ui.alerts(),[]);
   const delivered=ui.calls.filter(call=>call.action==='transmit');assert.equal(delivered.length,1);assert.equal(delivered[0].files.quotation[0].name,corrected.filename);assert.equal(delivered[0].files.legalDocuments.length,1);
   const newFile=replacement.documents.files.at(-1);assert.deepEqual(Buffer.from(delivered[0].files.legalDocuments[0].base64,'base64'),Buffer.from(h.objects.get(newFile.key)));
   assert.equal(h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts WHERE fingerprint=?').get(preview.fingerprint).payload,priorReceipt);
   const afterContent=(await json(await h.route(base+'/content'))).content;for(const key of ['label','seo','assets'])assert.deepEqual(afterContent[key],beforeContent[key]);
   assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_options ORDER BY product_id').all(),beforeOptions);assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_quotation_fields').all(),beforeOverrides);
   assert.ok(h.objects.has(original.documents.files[0].key),'old evidence bytes stay available');
   ui.remount();await ui.click('견적서 + 첨부 파일 준비');assert.equal(ui.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);assert.equal(ui.calls.filter(call=>call.action==='transmit').length,1);
  }finally{h.close();}
 }
});

test('transmission UI survives a lost lookup reply and reaches fresh SKU results with only one upload',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  const h=harness({company,missedLookup:true,holdRetry:true,validationComplete:true,issued:true});
  h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
  assert.ok(nodes(h.render()).some(node=>node.props?.children==='Supplier Hub 검증 결과 응답이 늦어 3초 후 다시 확인합니다 (1/3).'));
  assert.equal(h.calls.filter(([name])=>name==='result').length,1);
  assert.equal(nodes(h.render()).some(node=>node.type==='td'&&node.props.children==='sku-123'),false);
  h.resumeRetry();await settle();
  assert.ok(nodes(h.render()).some(node=>node.type==='td'&&node.props.children==='sku-123'));
  assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);assert.equal(h.calls.filter(([name])=>name==='resume-validation').length,0);
  assert.equal(h.calls.filter(([name,,body])=>name==='fetch'&&body.action==='export').length,1);
  assert.deepEqual(h.calls.filter(([name])=>name==='result').map(([, ,mode])=>mode),[true,true,'registration']);
 }
});

test('attached draft resumes validation without another export, upload or automatic retry',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  const h=harness({company,attached:true,resumeStates:['attached','validation-requested']});
  h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
  assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);assert.equal(h.button('첨부 파일 확인 후 검증 재개').props.disabled,false);
  assert.equal(h.calls.filter(([name])=>name==='resume-validation').length,0);
  h.button('첨부 파일 확인 후 검증 재개').props.onClick();await settle();assert.equal(h.button('첨부 파일 확인 후 검증 재개').props.disabled,false);
  h.button('첨부 파일 확인 후 검증 재개').props.onClick();await settle();assert.equal(h.button('첨부 파일 확인 후 검증 재개'),undefined);
  assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);assert.equal(h.calls.filter(([name,,body])=>name==='fetch'&&body.action==='export').length,1);
  assert.equal(h.calls.filter(([name])=>name==='resume-validation').length,2);
  assert.ok(h.calls.filter(([name])=>name==='resume-validation').every(([,id,reviewed])=>id.fingerprint===fingerprint&&reviewed.priceData&&reviewed.labelBusinessContact));
 }
});
test('restored attachments require fresh manual choices and changed drafts cannot request validation',async()=>{
 const company={code:'A01464742',name:'와이홉'},savedSubmission={attempt:{state:'attached',validationResume:true,company,includedOptions:1,startedAt:Date.now(),registered:false},result:null};
 const h=harness({savedSubmission});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
 assert.equal(h.button('첨부 파일 확인 후 검증 재개').props.disabled,true);h.choose();assert.equal(h.button('첨부 파일 확인 후 검증 재개').props.disabled,false);
 h.changeSource();h.button('첨부 파일 확인 후 검증 재개').props.onClick();await settle();assert.equal(h.calls.some(([name])=>name==='resume-validation'),false);
 assert.equal(h.calls.some(([name,,body])=>name==='fetch'&&body.action==='export'),false);
 for(const state of ['partial','started','validation-requested']){const v=harness({savedSubmission:{...savedSubmission,attempt:{...savedSubmission.attempt,state}}});v.button('견적서 + 첨부 파일 준비').props.onClick();await settle();assert.equal(v.button('첨부 파일 확인 후 검증 재개'),undefined);}
 const legacy=harness({savedSubmission:{...savedSubmission,attempt:{...savedSubmission.attempt,validationResume:undefined}}});legacy.button('견적서 + 첨부 파일 준비').props.onClick();await settle();assert.equal(legacy.button('첨부 파일 확인 후 검증 재개'),undefined);
});
test('a slow or failed manual lookup preserves the previously verified SKU receipt and never repeats delivery',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  const h=harness({company,validationComplete:true,issued:true});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
  h.holdLookup();h.button('견적서 ID로 상품별 등록 상태 조회').props.onClick();await settle();
  assert.ok(nodes(h.render()).some(node=>node.type==='td'&&node.props.children==='sku-123'),'receipt stays visible while lookup is pending');
  h.failLookup();h.resumeLookup();await settle();
  assert.ok(nodes(h.render()).some(node=>node.type==='td'&&node.props.children==='sku-123'),'a transport error cannot erase verified evidence');
  assert.ok(nodes(h.render()).some(node=>node.props?.children==='전송한 옵션 수와 동일한 수의 고유 SKU ID가 조회됐습니다. 상품 검수 결과는 아래 상태를 기준으로 확인하세요.'));
  assert.ok(nodes(h.render()).some(node=>node.props?.children==='상품별 결과 응답 시간 초과'));
  assert.equal(h.button('견적서 ID로 상품별 등록 상태 조회').props.disabled,false);
  assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
  assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
 }
});

test('temporary receipt read outages restore only existing Chrome attempts and block a new upload when absence is unknown',async()=>{
 for(const receiptReadStatus of [408,429,500,502,503,504]){
  const company={code:'A01464742',name:'와이홉'},result={state:'validation-complete',filename:`YOOFAM-${fingerprint}.xlsx`,company,includedOptions:1,quotationId:'quote-123',observedAt:Date.now(),registered:false};
  const h=harness({receiptReadStatus,savedSubmission:{attempt:null,result}});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
  assert.equal(h.button('전송 시도됨 · 검증 결과 확인')?.props.disabled,true);
  assert.equal(h.button('견적서 ID로 상품별 등록 상태 조회').props.disabled,false);
  assert.equal(h.calls.filter(([name])=>name==='recover').length,1);
  assert.equal(h.calls.some(([name])=>name==='transmit'||name==='prepare'||name==='result'),false);
 }
 for(const outage of [{receiptReadStatus:503},{receiptReadNetworkError:true}]){
  const h=harness(outage);h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();
  assert.equal(h.button('등록 전송').props.disabled,true);assert.equal(h.button('확장에 첨부 파일 준비').props.disabled,true);
  assert.equal(h.calls.filter(([name])=>name==='recover').length,1);
  h.recover();h.button('전송 기록 다시 확인').props.onClick();await settle();
  assert.equal(h.button('등록 전송').props.disabled,false);
  assert.equal(h.calls.some(([name])=>name==='transmit'||name==='prepare'),false);
 }
});

test('authorization and source errors do not fall back to a different receipt store',async()=>{
 for(const settings of [400,401,403,404,409,422].map(receiptReadStatus=>({receiptReadStatus})).concat({receiptReadStatus:503,receiptReadCode:'AUTH_REQUIRED'})){
  const h=harness(settings);h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
  assert.equal(h.calls.some(([name])=>name==='recover'),false);
  assert.equal(h.calls.some(([name])=>name==='transmit'||name==='prepare'),false);
  assert.equal(h.button('등록 전송')?.props.disabled??true,true);
 }
});

test('outage recovery still checks the saved draft, company and option count before exposing cached results',async()=>{
 const company={code:'A01464742',name:'와이홉'},result={state:'validation-complete',filename:`YOOFAM-${fingerprint}.xlsx`,company,includedOptions:1,quotationId:'quote-123',observedAt:Date.now(),registered:false};
 for(const patch of [{company:{code:'A01526306',name:'유앤채'}},{includedOptions:2}]){
  const h=harness({receiptReadStatus:503,savedSubmission:{attempt:null,result:{...result,...patch}}});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
  assert.equal(h.button('등록 전송').props.disabled,true);assert.equal(h.button('견적서 ID로 상품별 등록 상태 조회').props.disabled,true);
  assert.equal(h.calls.some(([name])=>name==='transmit'||name==='prepare'||name==='result'),false);
 }
 const h=harness({receiptReadNetworkError:true,savedSubmission:{attempt:null,result}});h.editDuringRecovery();h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
 assert.equal(h.button('등록 전송'),undefined);assert.equal(h.calls.some(([name])=>name==='transmit'||name==='prepare'||name==='result'),false);
});

test('an uncertain cached attempt resumes read-only lookup through a server outage without another attachment',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  const h=harness({company,receiptReadStatus:503,receiptStoreError:true,validationComplete:true,issued:true,savedSubmission:{attempt:{state:'unconfirmed',company,includedOptions:1,startedAt:Date.now(),registered:false},result:null}});
  h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
  assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
  h.button('전송 결과 계속 확인').props.onClick();await settle();
  assert.ok(nodes(h.render()).some(node=>node.type==='td'&&node.props.children==='sku-123'));
  assert.equal(h.calls.some(([name])=>name==='transmit'||name==='prepare'),false);
  assert.equal(h.calls.some(([name,,body])=>name==='fetch'&&body.action==='export'),false);
 }
});

test('editing while the ZIP is being returned blocks both direct transmission and pending preparation',async()=>{
 for(const action of ['등록 전송','확장에 첨부 파일 준비']){
  const h=harness({editDuringExport:true});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();
  h.button(action).props.onClick();await settle();
  assert.equal(h.calls.some(([name])=>name==='transmit'||name==='prepare'),false);
  assert.equal(h.button('등록 전송'),undefined);assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'));
 }
 const h=harness();h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
 h.button('확장에 첨부 파일 준비').props.onClick();await settle();
 assert.equal(h.calls.filter(([name])=>name==='prepare').length,1);
 assert.equal(h.calls.findIndex(([name,,body])=>name==='fetch'&&body.action==='source')<h.calls.findIndex(([name])=>name==='prepare'),true);
});

test('receipt storage outage keeps live SKU follow-up and Chrome recovery without repeating attachments',async()=>{
 const h=harness({receiptStoreError:true,validationComplete:true,issued:true});
 h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
 assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);assert.ok(nodes(h.render()).some(node=>node.type==='td'&&node.props.children==='sku-123'));
 assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'&&String(node.props.children).includes('결과 보관 일시 실패')));
 h.remount();h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
 assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
});

test('reviewed registration sends the current export and choices, refreshes evidence and disables repeat transmission',async()=>{
 const h=harness();await h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
 assert.equal(h.button('등록 전송').props.disabled,true);h.choose();assert.equal(h.button('등록 전송').props.disabled,false);
 h.button('등록 전송').props.onClick();await settle();
 const transmitted=h.calls.find(([name])=>name==='transmit');assert.deepEqual(JSON.parse(JSON.stringify(transmitted[1])),{productId:'p',categoryId:'80719',fingerprint});
 assert.deepEqual(JSON.parse(JSON.stringify(transmitted[2])),{priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true});assert.equal(transmitted[3],'ZIP bytes');
 assert.equal(h.calls.find(([name])=>name==='result')[2],true);assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
 const exportRequest=h.calls.find(([name,,body])=>name==='fetch'&&body.action==='export');assert.equal(exportRequest[2].fingerprint,fingerprint);
 h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
});

test('required document review sends the required choice and document edits invalidate that review',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  const h=harness({company,legalDocuments:{applicability:'required',count:1}});
  h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();
  assert.equal(h.button('등록 전송').props.disabled,false);
  nodes(h.render()).find(node=>node.type==='legal-documents').props.onSaved();
  assert.equal(h.button('등록 전송'),undefined);assert.equal(h.calls.some(([name])=>name==='transmit'),false);
  h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
  assert.equal(h.button('등록 전송').props.disabled,true);h.choose();h.button('등록 전송').props.onClick();await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(([name])=>name==='transmit')[2])),{priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:false,legalDocumentsRequired:true});
  assert.equal(nodes(h.render()).find(node=>node.type==='legal-documents').props.disabled,true);
  assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
 }
});

test('registration status lookup requires completed validation and rechecks current saved source before Chrome',async()=>{
 for(const validationComplete of [false,true]){
  const h=harness({validationComplete});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
  assert.equal(h.button('견적서 ID로 상품별 등록 상태 조회').props.disabled,!validationComplete);
  if(validationComplete){const checks=h.calls.filter(([name,,body])=>name==='fetch'&&body.action==='source').length;
   assert.equal(h.calls.filter(([name,,mode])=>name==='result'&&mode==='registration').length,1,'transmission automatically reaches the SKU lookup');
   h.button('견적서 ID로 상품별 등록 상태 조회').props.onClick();await settle();
   const call=h.calls.find(([name,,mode])=>name==='result'&&mode==='registration');assert.equal(call[1].fingerprint,fingerprint);
   assert.equal(h.calls.filter(([name,,body])=>name==='fetch'&&body.action==='source').length,checks+2);
   h.changeSource();h.button('견적서 ID로 상품별 등록 상태 조회').props.onClick();await settle();
   assert.equal(h.calls.filter(([name,,mode])=>name==='result'&&mode==='registration').length,2);assert.equal(h.button('견적서 ID로 상품별 등록 상태 조회'),undefined);
  }
 }
});

test('changed saved data never reaches Chrome; uncertain acknowledgement leaves transmission disabled',async()=>{
 for(const option of [{conflict:true},{uncertain:true}]){
   const h=harness(option);h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
   if(option.conflict){assert.equal(h.calls.some(([name])=>name==='transmit'),false);assert.equal(h.button('등록 전송'),undefined);}
   else {assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);assert.equal(h.calls.some(([name])=>name==='result'),false);}
 }
});

test('proven preflight failure permits user retry while uncertain transmission stays protected',async()=>{
 const h=harness({notStarted:true});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
 assert.equal(h.button('등록 전송').props.disabled,false);assert.equal(h.calls.some(([name])=>name==='result'),false);
 h.button('등록 전송').props.onClick();await settle();assert.equal(h.calls.filter(([name])=>name==='transmit').length,2,'retry is an explicit user click');
});

test('both companies unlock a preflight error only after preparing the same source and verifying two empty receipt stores',async()=>{
 for(const company of companies){
  const h=harness({company,preflightRejected:true,validationComplete:true,issued:true});
  h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
  assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true,'an error alone does not prove no upload');
  assert.equal(h.calls.filter(([name])=>name==='result').length,0);
  h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
  assert.equal(h.button('등록 전송').props.disabled,true,'fresh manual agreement review remains required');h.choose();assert.equal(h.button('등록 전송').props.disabled,false);
  assert.equal(h.calls.filter(([name])=>name==='recover').length,2);assert.equal(h.calls.filter(([name])=>name==='transmit').length,1,'recovery is read only');
  h.button('등록 전송').props.onClick();await settle();assert.equal(h.calls.filter(([name])=>name==='transmit').length,2);
  assert.ok(nodes(h.render()).some(node=>node.type==='td'&&node.props.children==='sku-123'));
 }
});

test('preflight lock stays closed when absence is uncertain, the source changed, or Chrome retains a durable attempt or receipt',async()=>{
 for(const mode of ['server-outage','chrome-error','changed-source','durable-attempt','accepted-receipt']){
  const h=harness({preflightRejected:true});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
  if(mode==='server-outage')h.failReceiptRead();if(mode==='chrome-error')h.failChromeRecovery();if(mode==='changed-source')h.editDuringRecovery();
  if(mode==='durable-attempt')h.setSavedSubmission({attempt:{state:'unconfirmed',company:companies[0],includedOptions:1,startedAt:Date.now(),registered:false},result:null});
  if(mode==='accepted-receipt')h.setSavedSubmission({attempt:null,result:{state:'validation-complete',filename:`YOOFAM-${fingerprint}.xlsx`,company:companies[0],includedOptions:1,quotationId:'synthetic-accepted',observedAt:Date.now(),registered:false}});
  h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();
  assert.equal(h.button('등록 전송')?.props.disabled??h.button('전송 시도됨 · 검증 결과 확인')?.props.disabled??true,true);
  assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);assert.equal(h.calls.filter(([name])=>name==='result').length,0);
 }
});

test('registration transmission continues into SKU lookup without another user click or another export',async()=>{
 const h=harness({validationComplete:true,issued:true});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
 assert.deepEqual(h.calls.filter(([name])=>name==='result').map(([, ,mode])=>mode),[true,'registration']);
 assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
 assert.equal(h.calls.filter(([name,,body])=>name==='fetch'&&body.action==='export').length,1);
 assert.ok(nodes(h.render()).some(node=>node.props?.children==='전송한 옵션 수와 동일한 수의 고유 SKU ID가 조회됐습니다. 상품 검수 결과는 아래 상태를 기준으로 확인하세요.'));
 assert.equal(h.button('결과 확인 일시정지'),undefined);
});

test('pausing and resuming checks preserves one transmission and requires no new agreements or ZIP',async()=>{
 const h=harness({manualWait:true});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
 assert.equal(h.button('등록 결과 확인 중…').props.disabled,true);
 h.button('결과 확인 일시정지').props.onClick();await settle();
 assert.equal(h.button('전송 결과 계속 확인').props.disabled,false);
 assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
 h.complete();h.button('전송 결과 계속 확인').props.onClick();await settle();
 assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
 assert.equal(h.calls.filter(([name,,body])=>name==='fetch'&&body.action==='export').length,1);
 assert.deepEqual(h.calls.filter(([name])=>name==='result').map(([, ,mode])=>mode),[true,true,'registration']);
 assert.equal(h.button('결과 확인 일시정지'),undefined);
});

test('editing a quotation after pausing invalidates the old source before follow-up can reach Chrome',async()=>{
 const h=harness({manualWait:true});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
 h.button('결과 확인 일시정지').props.onClick();await settle();h.changeSource();h.button('전송 결과 계속 확인').props.onClick();await settle();
 assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
 assert.equal(h.calls.filter(([name])=>name==='result').length,1);
 assert.equal(h.button('전송 결과 계속 확인'),undefined);
 assert.equal(h.button('견적서 + 첨부 파일 준비').props.disabled,false);
});

test('a later incomplete manual SKU refresh preserves the earlier issued SKU evidence',async()=>{
 const h=harness({validationComplete:true,issued:true});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
 const issuance=node=>node.props?.children==='전송한 옵션 수와 동일한 수의 고유 SKU ID가 조회됐습니다. 상품 검수 결과는 아래 상태를 기준으로 확인하세요.';
 assert.ok(nodes(h.render()).some(issuance));h.hideSkus();h.button('견적서 ID로 상품별 등록 상태 조회').props.onClick();await settle();
 assert.equal(nodes(h.render()).some(issuance),true);
 assert.ok(nodes(h.render()).some(node=>node.type==='td'&&node.props.children==='sku-123'));
 assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'&&String(node.props.children).includes('기존 결과를 유지')));
 assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
 assert.equal(h.calls.filter(([name,,body])=>name==='fetch'&&body.action==='export').length,1);
});

test('the registration UI reports aggregate pages and never labels a partial scan as the last page',async()=>{
 for(const hasMore of [true,false,null]){
  const h=harness({validationComplete:true,issued:true,registrationPatch:{scope:'queried-pages',pagesRead:2,hasMore}});
  h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
  const small=nodes(h.render()).filter(node=>node.type==='small').map(node=>String(node.props.children)).join(' ');
  assert.equal(small.includes('마지막 페이지까지 조회했습니다.'),hasMore===false);
  assert.equal(small.includes('다음 페이지가 남아 있습니다.'),hasMore===true);
  assert.equal(small.includes('추가 페이지 유무를 확인하지 못했습니다.'),hasMore===null);
  assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
 }
});

test('manual multi-page lookup discards its result if the saved draft changes during Chrome reading',async()=>{
 const h=harness({validationComplete:true,issued:true,registrationPatch:{scope:'queried-pages',pagesRead:2,hasMore:false}});
 h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
 h.editDuringNextLookup();h.button('견적서 ID로 상품별 등록 상태 조회').props.onClick();await settle();
 assert.equal(h.button('견적서 ID로 상품별 등록 상태 조회'),undefined);
 assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
 assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'));
});

test('both companies recover a prior receipt on remount without another ZIP, upload or live Hub request',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  const h=harness({company,validationComplete:true,issued:true});
  h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
  const before=h.calls.filter(([name])=>name==='result').length;
  h.remount();h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
  assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
  assert.equal(h.button('확장에 첨부 파일 준비').props.disabled,true);
  assert.equal(h.button('견적서 ID로 상품별 등록 상태 조회').props.disabled,false);
  assert.equal(h.button('전송 결과 계속 확인').props.disabled,false);
  assert.equal(h.calls.filter(([name])=>name==='result').length,before,'restoration only reads the local extension record');
  assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
  assert.equal(h.calls.filter(([name,,body])=>name==='fetch'&&body.action==='export').length,1);
  assert.ok(nodes(h.render()).some(node=>node.type==='td'&&node.props.children==='sku-123'));
 }
});

test('a restored SKU receipt retains its confirmed summary when continuation fails before a fresh lookup',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  const h=harness({company,validationComplete:true,issued:true});
  h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
  h.remount();h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
  const issuance=node=>node.props?.children==='전송한 옵션 수와 동일한 수의 고유 SKU ID가 조회됐습니다. 상품 검수 결과는 아래 상태를 기준으로 확인하세요.';
  assert.ok(nodes(h.render()).some(issuance),'stored evidence is summarized without a fresh lookup');
  const before=h.calls.filter(([name])=>name==='result').length;
  h.failLookup();h.button('전송 결과 계속 확인').props.onClick();await settle();
  assert.ok(nodes(h.render()).some(issuance));
  assert.ok(nodes(h.render()).some(node=>node.type==='td'&&node.props.children==='sku-123'));
  assert.deepEqual(h.calls.filter(([name])=>name==='result').slice(before).map(([, ,mode])=>mode),['registration']);
  assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
  assert.equal(h.calls.filter(([name,,body])=>name==='fetch'&&body.action==='export').length,1);
 }
});

test('continuation and file refresh cannot switch a receipt to a different quotation ID',async()=>{
 for(const action of ['전송 결과 계속 확인','Supplier Hub 검증 결과 불러오기']){
  const h=harness({validationComplete:true,issued:true});
  h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
  h.setResultPatch({quotationId:'other-quote'});h.button(action).props.onClick();await settle();
  assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'));
  assert.equal(nodes(h.render()).some(node=>node.type==='td'&&node.props.children==='sku-123'),false);
  assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
 }
});

test('an unacknowledged attempt stays protected after remount and can resume read-only follow-up',async()=>{
 const h=harness({uncertain:true});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
 h.remount();h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
 assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
 assert.equal(h.calls.filter(([name])=>name==='result').length,0);
 h.complete();h.button('전송 결과 계속 확인').props.onClick();await settle();
 assert.deepEqual(h.calls.filter(([name])=>name==='result').map(([, ,mode])=>mode),[true,'registration']);
 assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
 assert.equal(h.calls.filter(([name,,body])=>name==='fetch'&&body.action==='export').length,1);
});

test('cached rejected and partial transmissions cannot become new uploads after reopening',async()=>{
 for(const state of ['started','attached','partial','unconfirmed','validation-requested']){
  const attempt={state,company:{code:'A01464742',name:'와이홉'},includedOptions:1,startedAt:Date.now(),registered:false};
  const result=state==='validation-requested'?{state:'validation-rejected',filename:`YOOFAM-${fingerprint}.xlsx`,company:attempt.company,includedOptions:1,detail:'원가 오류',observedAt:Date.now(),registered:false}:null;
  const h=harness({savedSubmission:{attempt,result}});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
  assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
  assert.equal(h.calls.some(([name])=>name==='transmit'||name==='prepare'||name==='result'),false);
  if(result)assert.ok(nodes(h.render()).some(node=>node.props?.children==='원가 오류'));
 }
});

test('a storage read failure preserves the preview and prevents sending until explicit recovery succeeds',async()=>{
 const h=harness({recoveryError:true});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
 assert.equal(h.button('등록 전송').props.disabled,true);assert.equal(h.button('확장에 첨부 파일 준비').props.disabled,true);
 assert.equal(h.button('견적서 파일 다운로드').props.disabled,false);
 assert.ok(nodes(h.render()).some(node=>node.props?.children==='전송 기록 읽기 실패'));
 h.recover();h.button('전송 기록 다시 확인').props.onClick();await settle();
 assert.equal(h.button('등록 전송').props.disabled,true,'recovery cannot create user agreement choices');h.choose();
 assert.equal(h.button('등록 전송').props.disabled,false);
 assert.equal(h.calls.filter(([name,,body])=>name==='fetch'&&body.action==='preview').length,1);
 assert.equal(h.calls.some(([name])=>name==='transmit'||name==='prepare'),false);
});

test('cached claims or receipts for another company or option count are never displayed or resent',async()=>{
 const company={code:'A01464742',name:'와이홉'};
 for(const patch of [{company:{code:'A01526306',name:'유앤채'}},{company:{...company,name:'다른 회사'}},{includedOptions:2}]){
  for(const cached of ['attempt','result']){
   const attempt={state:'attached',company,includedOptions:1,startedAt:Date.now(),registered:false,...patch};
   const result={state:'validation-complete',filename:`YOOFAM-${fingerprint}.xlsx`,company,includedOptions:1,quotationId:'wrong-receipt',observedAt:Date.now(),registered:false,...patch};
   const h=harness({savedSubmission:{attempt:cached==='attempt'?attempt:null,result:cached==='result'?result:null}});
   h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
   assert.equal(h.button('등록 전송').props.disabled,true);
   assert.equal(h.button('견적서 ID로 상품별 등록 상태 조회').props.disabled,true);
   assert.equal(nodes(h.render()).some(node=>String(node.props?.children).includes('wrong-receipt')),false);
   assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'));
  }
 }
});

test('editing during cached recovery discards the preview before permitting any upload',async()=>{
 const h=harness();h.editDuringRecovery();h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
 assert.equal(h.button('등록 전송'),undefined);assert.equal(h.calls.some(([name])=>name==='transmit'||name==='prepare'),false);
 assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'));
});

test('manual validation and SKU results reject a different company, count or quotation ID and clear stale evidence',async()=>{
 for(const action of ['Supplier Hub 검증 결과 불러오기','견적서 ID로 상품별 등록 상태 조회']){
  for(const patch of [{company:{code:'A01526306',name:'유앤채'}},{company:undefined},{includedOptions:2},...(action.startsWith('견적서 ID')?[{quotationId:'other-quote'}]:[])]){
   const h=harness({validationComplete:true,issued:true});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
   h.setResultPatch(patch);h.button(action).props.onClick();await settle();
   assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'));
   assert.equal(nodes(h.render()).some(node=>node.type==='td'&&node.props.children==='sku-123'),false);
   assert.equal(h.button('견적서 ID로 상품별 등록 상태 조회').props.disabled,true);
   assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
  }
 }
});
