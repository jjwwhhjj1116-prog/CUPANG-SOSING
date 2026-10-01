import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settle=async()=>{for(let index=0;index<8;index++)await new Promise(resolve=>setImmediate(resolve));};
const fingerprint='a'.repeat(64);
function harness({receiptReadStatus=200,receiptReadCode,receiptReadNetworkError=false,receiptStoreError=false,conflict=false,uncertain=false,validationComplete=false,notStarted=false,manualWait=false,issued=false,registrationPatch,editDuringExport=false,company={code:'A01464742',name:'와이홉'},savedSubmission,resultPatch,recoveryError=false}={}){
 const slots=[],calls=[],modules=new Map();let cursor=0,sourceChanged=false;
 let clock=0,editNext=false;
 const preview={fingerprint,filename:`YOOFAM-${fingerprint}.xlsx`,headers:['상품명'],rows:[['상품']],report:{company,productId:'p',categoryId:'80719',profileId:'profile',rowCount:1,warnings:[],submissionReady:false},submissionReview:{productId:'p',categoryId:'80719',inputFingerprint:fingerprint,submissionReady:false,transport:'not-connected',errorCount:0,reviewCount:0,omittedIssueCount:0,issues:[]}};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(){cursor++;}};
 let editRecovery=false,lookupError=false,holdLookup=false,resumeLookup;
 const bridge={checkSupplierHubExtension:async(_signal,direct)=>calls.push(['check',direct]),prepareSupplierHubHandoff:async()=>calls.push(['prepare']),
  getSupplierHubSubmission:async identity=>{calls.push(['recover',identity]);if(recoveryError)throw Error('전송 기록 읽기 실패');if(editRecovery)sourceChanged=true;return savedSubmission||{attempt:null,result:null};},
  transmitSupplierHubPackage:async(blob,identity,reviewed)=>{
   calls.push(['transmit',identity,reviewed,await blob.text()]);
   if(!notStarted)savedSubmission={attempt:{state:uncertain?'unconfirmed':'validation-requested',company,includedOptions:1,startedAt:Date.now(),registered:false},result:null};
   if(uncertain)throw Error('응답 확인 불가');return {state:notStarted?'not-started':'validation-requested',registered:false};
  },getSupplierHubResult:async(identity,_signal,refresh)=>{
   calls.push(['result',identity,refresh]);if(refresh==='registration'&&editNext)sourceChanged=true;
   if(holdLookup)await new Promise(resolve=>{resumeLookup=resolve;});
   if(lookupError)throw Error('상품별 결과 응답 시간 초과');
   const result={state:validationComplete?'validation-complete':'validation-pending',filename:preview.filename,company:preview.report.company,includedOptions:1,quotationId:validationComplete?'quote-123':undefined,observedAt:Date.now(),registered:false,...(refresh==='registration'?{registration:{quotationId:'quote-123',scope:'visible-page',rows:issued?[{title:'상품',submittedAt:'date',category:'cat',barcode:'',sourceQuotation:preview.filename,skuId:'sku-123',status:'상품 검수중',stage:'가격/정책'}]:[],includedOptions:1,observedAt:Date.now(),registered:false,...registrationPatch}}:{}),...resultPatch};
   if(savedSubmission)savedSubmission={...savedSubmission,result};return result;
  }};
 function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,URL,setTimeout,fetch:async(url,init)=>{
   if(url.includes('supplier-hub-receipt')){
    if(init?.method!=='POST'&&receiptReadNetworkError)throw Error('network disconnected');
    if(init?.method!=='POST'&&receiptReadStatus!==200)return Response.json({error:'결과 조회 실패',code:receiptReadCode},{status:receiptReadStatus});
    return receiptStoreError&&init?.method==='POST'?Response.json({error:'결과 보관 일시 실패'},{status:503}):Response.json(init?.method==='POST'?{saved:true,fingerprint,registered:false}:{receipt:null});
   }
   const body=JSON.parse(init.body);calls.push(['fetch',url,body]);
   if(body.action==='preview'||body.action==='source')return Response.json({...preview,...(sourceChanged?{fingerprint:'b'.repeat(64)}:{})});
   if(conflict)return Response.json({error:'저장값이 변경되었습니다.'},{status:409});
   if(body.action==='export'&&editDuringExport)sourceChanged=true;
   return new Response('ZIP bytes',{headers:{'content-type':'application/zip'}});
 },require(name){if(name==='react')return hooks;if(name==='@/app/supplier-hub-handoff')return bridge;if(name==='@/app/supplier-hub-tracking')return trackingBridge;if(name==='@/app/components/quotation-review-issues')return {QuotationReviewIssues:'issues'};return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});return exports;}
 bridge.validateSupplierHubResultForSource=load('app/supplier-hub-handoff.ts').validateSupplierHubResultForSource;
 bridge.SupplierHubResultInvalid=load('app/supplier-hub-handoff.ts').SupplierHubResultInvalid;
 bridge.supplierHubRegistrationEvidence=load('app/supplier-hub-handoff.ts').supplierHubRegistrationEvidence;
 bridge.validateRegistrationResult=load('app/supplier-hub-handoff.ts').validateRegistrationResult;
 const tracker=load('app/supplier-hub-tracking.ts');
 const trackingBridge={...tracker,followSupplierHubRegistration:(source,options)=>tracker.followSupplierHubRegistration(source,{...options,maxDurationMs:1000,now:()=>clock,wait:async(ms,signal)=>{
  if(manualWait)return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('paused')),{once:true}));
  clock+=ms;
 }})};
 const Component=load('app/components/submission-package.tsx').SubmissionPackage;
 const render=()=>{cursor=0;return Component({productId:'p',profileId:'profile',categoryId:'80719',onInspect(){}});};
 const button=text=>nodes(render()).find(node=>node.type==='button'&&node.props.children===text);
 return {render,calls,button,remount(){slots.length=0;},changeSource(){sourceChanged=true;},editDuringNextLookup(){editNext=true;},editDuringRecovery(){editRecovery=true;},recover(){recoveryError=false;receiptReadStatus=200;receiptReadNetworkError=false;},failLookup(){lookupError=true;},holdLookup(){holdLookup=true;},resumeLookup(){holdLookup=false;resumeLookup?.();},setResultPatch(value){resultPatch=value;},complete(){validationComplete=true;issued=true;},hideSkus(){issued=false;},choose(){for(const input of nodes(render()).filter(node=>node.type==='input'))input.props.onChange({target:{checked:true}});}};
}

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

test('a later manual SKU refresh cannot retain an earlier issuance summary for missing rows',async()=>{
 const h=harness({validationComplete:true,issued:true});h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
 const issuance=node=>node.props?.children==='전송한 옵션 수와 동일한 수의 고유 SKU ID가 조회됐습니다. 상품 검수 결과는 아래 상태를 기준으로 확인하세요.';
 assert.ok(nodes(h.render()).some(issuance));h.hideSkus();h.button('견적서 ID로 상품별 등록 상태 조회').props.onClick();await settle();
 assert.equal(nodes(h.render()).some(issuance),false);assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);
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
