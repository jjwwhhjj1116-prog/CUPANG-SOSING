import {verifySupplierHubCompany} from './company.mjs';
import {HANDOFF_ORIGINS} from './handoff-store.mjs';
import {SINGLE_DOCUMENT_ORIGIN,SingleDocumentError} from './single-document.mjs';
import {singleDocumentLoadPage} from './single-load-page.mjs';
import {observeSingleDraftLoad} from './single-load-observer.mjs';

const HASH=/^[a-f0-9]{64}$/;
const ID=/^\w[\w-]{0,99}$/;
const fail=(code,message)=>{throw new SingleDocumentError(code,message);};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const equal=(left,right)=>canonical(left)===canonical(right);
const copy=value=>structuredClone(value);
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
const allowedPath=path=>['/dashboard/KR','/qvt/registration','/qvt/wims','/sr/registration'].includes(path)||/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(path);
function validHubTab(tab,windowId){
  try{const url=new URL(tab.url);return Number.isSafeInteger(tab.id)&&tab.id>=0&&tab.windowId===windowId&&!tab.pendingUrl&&tab.status==='complete'
    &&url.origin===SINGLE_DOCUMENT_ORIGIN&&!url.username&&!url.password&&allowedPath(url.pathname);}catch{return false;}
}

/** Read current API output in the original app's own frame. No prepare POST,
 * public-image publication or Supplier Hub request is made here. */
export async function singleDocumentAppSourcePage(input){
  const expected=input.identity,canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
  if(!['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'].includes(location.origin)||location.origin!==expected.origin)throw Error('원래 앱의 저장본 조회가 아닙니다.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  const read=async path=>{
    const url=location.origin+path,response=await fetch(url,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,headers:{accept:'application/json'}});
    if(!response.ok||response.redirected||response.url!==url||!/\bapplication\/json\b/i.test(response.headers.get('content-type')||''))throw Error('현재 앱의 저장본 JSON 응답을 확인하지 못했습니다.');
    const text=await response.text();if(new TextEncoder().encode(text).length>6*1024*1024)throw Error('저장본 조회 응답이 너무 큽니다.');return JSON.parse(text);
  };
  const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
  try{
    const before=await read('/api/supplier-hub/catalog-context');
    if(before.ownerId!==expected.ownerId||canon(before.company)!==canon(expected.company))throw Error('현재 승인 회원·회사가 다릅니다.');
    const accountContext=await sha(JSON.stringify(['sourceflow-managed-product-account-v1',before.ownerId,before.company.code,before.company.name]));
    if(accountContext!==expected.accountContext)throw Error('현재 회원 회사 연결이 변경되었습니다.');
    const path='/api/products/'+encodeURIComponent(expected.productId)+'/supplier-hub-single-package?profileId='+encodeURIComponent(expected.profileId),view=await read(path);
    if(view?.format!=='yoofam-supplier-hub-single-package-v1'||view.prepared!==true||view.review?.canPrepare!==true||view.productId!==expected.productId||view.requestedProfileId!==expected.profileId
      ||view.fingerprint!==expected.fingerprint||view.schemaSha256!==expected.schemaSha256||canon(view.company)!==canon(expected.company)||view.source?.profileId!==expected.profileId
      ||view.registered!==false||view.remoteWrites!==false||view.submissionReady!==false||view.humanAgreementsConfirmed!==false||!Array.isArray(view.payload?.jsonDocument)
      ||view.payload.docId!==null||view.payload.scope!=='Retail_Categorized_Single'||view.payload.displayCategoryCode!==expected.categoryId||!Array.isArray(view.review.fields)
      ||view.review.issues?.some(issue=>issue.level==='error')||!Array.isArray(view.manifest)||view.manifest.some(item=>!Array.isArray(item.files)||item.files.some(file=>file.published!==true||file.verification!=='stored-body-sha256')))throw Error('명시적으로 준비한 최신 Single 자료를 확인하지 못했습니다.');
    const source=Object.fromEntries(['productVersion','contentRevision','optionRevision','quotationRevision','profileRevision'].map(key=>[key,view.source[key]]));
    if(canon(source)!==canon(expected.source))throw Error('상품·견적서 저장 버전이 변경되었습니다.');
    const rows=view.review.fields.filter(field=>Array.isArray(field.path)&&canon(field.path)===canon(['startPage','productName'])&&field.name===undefined);
    if(rows.length!==view.payload.jsonDocument.length||new Set(rows.map(row=>row.optionId)).size!==rows.length)throw Error('Single 포함 옵션과 문서 순서 연결이 다릅니다.');
    const matches=rows.map((row,index)=>({row,index})).filter(({row})=>row.optionId===expected.optionId);
    if(matches.length!==1)throw Error('선택한 저장 옵션이 최종 문서에 없습니다.');
    const document=view.payload.jsonDocument[matches[0].index],body={...view.payload,productName:document.startPage.productName,categoryPath:document.startPage.categoryPath,jsonDocument:[document]};
    const originalBodySha256=await sha(canon(body)),deferred=JSON.parse(JSON.stringify(body));
    for(const key of ['msrpAgree','labelContactAgreed'])if(deferred.jsonDocument[0].imagePage&&Object.hasOwn(deferred.jsonDocument[0].imagePage,key))deferred.jsonDocument[0].imagePage[key]=false;
    const preparedBodySha256=await sha(canon(deferred));
    if(originalBodySha256!==input.bodySha256||preparedBodySha256!==input.preparedBodySha256)throw Error('준비한 개별 옵션의 정확한 본문과 최신 GET 자료가 다릅니다.');
    const after=await read('/api/supplier-hub/catalog-context');if(canon(after)!==canon(before)||controller.signal.aborted)throw Error('조회 중 승인 회원 회사가 변경되었습니다.');
    return {current:true,identity:expected,bodySha256:originalBodySha256,preparedBodySha256,checkedAt:Date.now()};
  }finally{clearTimeout(timer);}
}

/** This function is serialized into the already selected Hub tab. It does
 * not import/execute vendor code and never reads cookies, tokens or storage.
 * A DOM marker contains only this task's identity and actual parsed ACKs. */
export async function singleDocumentHubRequestPage(input){
  const origin='https://supplier.coupang.com',data=document.documentElement.dataset;
  const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
  const same=(left,right)=>canon(left)===canon(right);
  const identifier=value=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]|\.\.\.|…/.test(value)||Number.isSafeInteger(value)&&value>0;
  const binding=input?.binding;
  const check=()=>{
    if(location.origin!==origin||!(['/dashboard/KR','/qvt/registration','/qvt/wims','/sr/registration'].includes(location.pathname)||/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(location.pathname)))throw Error('Supplier Hub 개별 등록 화면이 변경되었습니다.');
    const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
    if(!binding||!['identityDigest','packetDigest','preparedBodySha256','originalBodySha256'].every(key=>typeof binding[key]==='string'&&/^[a-f0-9]{64}$/.test(binding[key]))
      ||codes.length!==1||codes[0]!==binding.identity?.company?.code||!({A01526306:'유앤채',A01464742:'와이홉'})[codes[0]]
      ||({A01526306:'유앤채',A01464742:'와이홉'})[codes[0]]!==binding.identity.company.name)throw Error('개별 전송 회사·저장본의 연결을 확인해주세요.');
  };
  check();
  const documentRead=input.method==='GET'&&/^\/sr\/draft\/api\/get-by-id\/[^/?#]+$/.test(input.path);
  const known=input.method==='GET'&&input.path==='/sr/draft/api/drafts'||documentRead||input.method==='POST'&&(['/sr/draft/api/create','/sr/draft/api/update'].includes(input.path)||/^\/sr\/qvt\/api\/validate-step\/[2-5]$/.test(input.path));
  if(!known||input.method==='GET'&&Object.hasOwn(input,'body'))throw Error('확인된 개별 문서 경로에서만 요청할 수 있습니다.');
  let records={};try{records=JSON.parse(data.yoofamSingleDocumentRecords||'{}');}catch{throw Error('이 탭의 개별 전송 기록을 확인해주세요.');}
  if(!records||typeof records!=='object'||Array.isArray(records)||Object.keys(records).length>1000)throw Error('개별 전송 기록 범위를 확인해주세요.');
  const key=binding.packetDigest;let record=records[key];
  const save=()=>{records[key]=record;data.yoofamSingleDocumentRecords=JSON.stringify(records);};
  // The shipped Hub client uses get-by-id for document contents. A metadata
  // list is only a baseline; it cannot identify another user's draft to read.
  if(documentRead){
    let requested;try{requested=decodeURIComponent(input.path.slice('/sr/draft/api/get-by-id/'.length));}catch{throw Error('문서 조회 식별값을 확인해주세요.');}
    if(!record||!same(record.binding,binding)||!identifier(record.docId)||requested!==String(record.docId)
      ||record.baselineDocIds?.some(id=>same(id,record.docId)))throw Error('이 요청에서 새로 만든 정확한 문서만 조회할 수 있습니다.');
  }
  if(input.method==='POST'){
    if(typeof input.operationId!=='string'||!input.operationId.startsWith(binding.requestId+':'))throw Error('원래 개별 문서 요청을 확인해주세요.');
    if(input.path.endsWith('/create')){
      if(record)throw Error('문서 생성은 이미 요청했습니다. 읽기로 확인해주세요.');
      if(input.body?.docId!==null||input.body.scope!=='Retail_Categorized_Single'||!Array.isArray(input.body.jsonDocument)||input.body.jsonDocument.length!==1)throw Error('새 단일 옵션 문서가 아닙니다.');
      // Do not overwrite an existing form the user has been editing.
      const values=Array.from(document.querySelectorAll('.rsc-text-input input')).map(node=>node.value||'');
      if(values.some(value=>value.trim()))throw Error('현재 Supplier Hub에서 작업 중인 상품을 보존했습니다.');
      record={binding,docId:null,createOperationId:input.operationId,state:'create-requested',baselineDocIds:input.baselineDocIds??[]};save();
    }else{
      if(!record||!same(record.binding,binding)||!identifier(record.docId)||!same(record.docId,input.body?.docId))throw Error('이 요청에서 새로 만든 문서만 수정·검증할 수 있습니다.');
      if(input.path.endsWith('/update')){
        if(record.updateOperationId)throw Error('문서 수정은 이미 요청했습니다. 읽기로 확인해주세요.');
        record.updateOperationId=input.operationId;record.state='update-requested';save();
      }else{
        if(record.state!=='updated'&&record.state!=='validated')throw Error('새 문서 수정 결과를 먼저 확인해주세요.');
        const step=Number(input.path.at(-1));record.validation??={};
        if(record.validation[step])throw Error('이 단계 검증은 이미 요청했습니다. 읽기로 확인해주세요.');
        record.validation[step]={operationId:input.operationId,state:'requested'};save();
      }
    }
    const normalized=copyBody(input.body);if(input.path.endsWith('/create')||input.path.endsWith('/update')){
      normalized.docId=null;
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canon(normalized)))),byte=>byte.toString(16).padStart(2,'0')).join('');
      if(hash!==binding.preparedBodySha256)throw Error('준비한 정확한 문서 본문과 다릅니다.');
    }
  }
  check();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
    const url=origin+input.path,response=await fetch(url,{method:input.method,credentials:'include',redirect:'error',cache:'no-store',signal:controller.signal,
      headers:{accept:'application/json',...(input.method==='POST'?{'content-type':'application/json;charset=UTF-8'}:{})},...(input.method==='POST'?{body:JSON.stringify(input.body)}:{})});
    if(response.redirected||response.url!==url||!/\bapplication\/json\b/i.test(response.headers.get('content-type')||''))throw Error('개별 문서 응답의 출처·형식을 확인하지 못했습니다.');
    const reader=response.body?.getReader();if(!reader)throw Error('개별 문서 응답이 없습니다.');
    const parts=[];let size=0;try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>6*1024*1024)throw Error('개별 문서 응답이 너무 큽니다.');parts.push(part.value);}}finally{await reader.cancel();}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    const json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));check();
    const ok=response.ok&&!(json&&typeof json==='object'&&!Array.isArray(json)&&json.errorCode!==undefined&&json.errorCode!==null&&json.errorCode!=='')
      &&!(json&&typeof json==='object'&&!Array.isArray(json)&&json.code!==undefined&&json.code!==200);
    if(input.method==='POST'&&ok){
      if(input.path.endsWith('/create')){
        if(!identifier(json?.docId)||record.baselineDocIds.some(id=>same(id,json.docId)))throw Error('새 문서 생성 식별값을 확인하지 못했습니다.');
        record.docId=json.docId;record.state='created';save();
      }else if(input.path.endsWith('/update')){record.state='updated';save();}
      else{const step=Number(input.path.at(-1));record.validation[step]={operationId:input.operationId,state:'observed',response:json};record.state=json?.data?.[0]?.success===true?'validated':'validation-rejected';save();}
    }
    return {ok,status:response.status,json,...(record?{ownedRecord:record}:{})};
  }finally{clearTimeout(timer);}
  function copyBody(value){return JSON.parse(JSON.stringify(value));}
}

/** Only observed response data is recoverable. A lost in-tab ACK with no new
 * docId cannot be replaced by a name/position/time guess from existing drafts. */
export function singleDocumentOwnedRecordPage(binding){
  if(location.origin!=='https://supplier.coupang.com')throw Error('Supplier Hub 탭을 확인해주세요.');
  const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
  if(codes.length!==1||codes[0]!==binding.identity.company.code)throw Error('현재 Supplier Hub 회사가 다릅니다.');
  let records;try{records=JSON.parse(document.documentElement.dataset.yoofamSingleDocumentRecords||'{}');}catch{return null;}
  const record=records[binding.packetDigest];
  if(!record||JSON.stringify(record.binding)!==JSON.stringify(binding))return null;
  return record;
}

/** Carry only this previously observed own ACK across an authorized same-tab
 * navigation. Browser navigation clears datasets; it does not create ownership. */
export function singleDocumentRestoreOwnedRecordPage(input){
  if(location.origin!=='https://supplier.coupang.com'||!/^\/sr\/registration\/step\//.test(location.pathname))throw Error('원래 개별 등록 탭이 아닙니다.');
  const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
  if(codes.length!==1||codes[0]!==input.binding.identity.company.code||JSON.stringify(input.record?.binding)!==JSON.stringify(input.binding)||!input.record.docId)throw Error('원래 새 문서의 관찰 기록을 확인해주세요.');
  const data=document.documentElement.dataset,records=JSON.parse(data.yoofamSingleDocumentRecords||'{}'),previous=records[input.binding.packetDigest];
  if(previous&&JSON.stringify(previous)!==JSON.stringify(input.record))throw Error('더 최신 개별 전송 기록을 보존했습니다.');
  records[input.binding.packetDigest]=input.record;data.yoofamSingleDocumentRecords=JSON.stringify(records);return true;
}

/** Advance only the owned document after its read-only UI load was correlated
 * with the exact browser request. Never auto-select terms or edit fields. */
export async function singleDocumentNavigatePage(input){
  const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
  const visible=node=>Boolean(node&&node.getClientRects().length);
  let companyVerified=false;
  const check=()=>{
    if(location.origin!=='https://supplier.coupang.com'||!/^\/sr\/registration\/step\/(startPage|productPage|imagePage|legalPage|logisticsPage)$/.test(location.pathname))throw Error('개별 등록 단계 화면이 변경되었습니다.');
    const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
    const names=Array.from(document.querySelectorAll('button')).filter(node=>visible(node)&&!node.disabled&&(node.innerText||'').trim()===input.binding.identity.company.name);
    if(codes.length>1||codes.length===1&&codes[0]!==input.binding.identity.company.code||!codes.length&&(!companyVerified||names.length!==1))throw Error('개별 등록 회사가 변경되었습니다.');
    if(codes.length===1)companyVerified=true;
    const record=JSON.parse(document.documentElement.dataset.yoofamSingleDocumentRecords||'{}')[input.binding.packetDigest];
    if(!record||canon(record.binding)!==canon(input.binding)||canon(record.docId)!==canon(input.docId))throw Error('이 요청이 생성한 정확한 문서가 아닙니다.');
    return record;
  };
  const wait=async predicate=>{for(let count=0;count<80;count++){check();if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('개별 등록 화면이 준비되지 않았습니다. 읽기로 확인해주세요.');};
  const record=check();
  // Never advance an already open user form merely because its title matches.
  if(record.loadedDocId!==input.docId)throw Error('이 요청에서 불러온 새 문서 화면이 아니므로 기존 작성 단계를 유지했습니다.');
  const pages=['Product Page','Image Page','Legal Page','Logistics Page'];
  for(const next of pages){
    const current=(document.querySelector('#root__title')?.innerText||'').trim();if(pages.indexOf(current)>=pages.indexOf(next))continue;
    check();
    // A required unchecked term can block intermediate navigation. Stop here;
    // its action-time confirmation needs an observed UI contract of its own.
    if(Array.from(document.querySelectorAll('input[type="checkbox"]')).some(node=>visible(node)&&(node.required||['agreeMSRPTerm','agreeLabelContact'].includes(node.id))&&!node.checked))throw Error('현재 단계의 필수 동의는 사용자가 직접 확인해야 합니다. 자동으로 선택하지 않았습니다.');
    const buttons=Array.from(document.querySelectorAll('button[type="submit"]')).filter(node=>visible(node)&&!node.disabled&&node.getAttribute('aria-disabled')!=='true');
    if(buttons.length!==1)throw Error('다음 개별 등록 단계 버튼을 확인해주세요.');buttons[0].click();await wait(()=>(document.querySelector('#root__title')?.innerText||'').trim()===next);
  }
  check();if(record.loadedDocId!==input.docId||(document.querySelector('#root__title')?.innerText||'').trim()!=='Logistics Page')throw Error('선택한 새 문서의 최종 단계를 확인하지 못했습니다.');
  return {docId:input.docId,company:input.binding.identity.company,productName:input.productName,readyForSubmit:true};
}

/** Read current displayed legal terms; known IDs alone do not establish their
 * meaning. The app shows these exact texts for explicit current confirmation. */
export function singleDocumentAgreementPage(input){
  const data=document.documentElement.dataset,canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
  if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/sr/registration/step/logisticsPage')throw Error('개별 상품의 최종 등록 화면을 확인해주세요.');
  const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
  const records=JSON.parse(data.yoofamSingleDocumentRecords||'{}'),record=records[input.binding.packetDigest];
  if(codes.length!==1||codes[0]!==input.binding.identity.company.code||!record||canon(record.binding)!==canon(input.binding)||record.docId!==input.docId||record.loadedDocId!==input.docId)throw Error('새 개별 문서의 회사·화면 연결을 확인해주세요.');
  const visible=node=>Boolean(node&&node.getClientRects().length);
  const items=Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(visible).map(node=>{
    const texts=Array.from(node.labels||[]).filter(visible).map(label=>(label.innerText||label.textContent||'').trim()).filter(Boolean);
    if(!node.id||texts.length!==1||node.disabled)throw Error('동의 항목의 정확한 문구를 확인하지 못했습니다.');
    return {key:node.id,id:node.id,text:texts[0],required:node.required===true||node.id==='agreeLabelContact',checked:node.checked===true,enabled:true};
  });
  if(!items.length||new Set(items.map(item=>item.id)).size!==items.length||!items.some(item=>item.required))throw Error('현재 최종 단계의 필수 동의 문구를 확인하지 못했습니다.');
  if(input.action==='confirm'){
    const expected=input.challenge?.items;
    if(!Array.isArray(expected)||canon(items.map(({key,id,text,required})=>({key,id,text,required})))!==canon(expected)
      ||input.confirmation?.challengeId!==input.challenge.id||input.confirmation?.userInitiated!==true
      ||canon([...input.confirmation.approvedKeys].sort())!==canon(items.filter(item=>item.required).map(item=>item.key).sort()))throw Error('현재 사용자가 확인한 동의 항목과 다릅니다.');
    for(const item of items.filter(item=>item.required)){
      const candidates=Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(node=>visible(node)&&node.id===item.id);if(candidates.length!==1||candidates[0].disabled)throw Error('동의 선택 항목이 변경되었습니다.');
      if(!candidates[0].checked)candidates[0].click();if(!candidates[0].checked)throw Error('동의 선택이 반영되지 않았습니다.');item.checked=true;
    }
    record.confirmedChallengeId=input.challenge.id;records[input.binding.packetDigest]=record;data.yoofamSingleDocumentRecords=JSON.stringify(records);
  }
  return {docId:input.docId,company:input.binding.identity.company,readyForSubmit:true,items};
}

export function singleDocumentSubmitPage(input){
  const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
  if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/sr/registration/step/logisticsPage')throw Error('최종 개별 등록 화면이 변경되었습니다.');
  const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]),data=document.documentElement.dataset;
  const records=JSON.parse(data.yoofamSingleDocumentRecords||'{}'),record=records[input.binding.packetDigest];
  if(codes.length!==1||codes[0]!==input.binding.identity.company.code||!record||canon(record.binding)!==canon(input.binding)||record.docId!==input.docId||record.loadedDocId!==input.docId
    ||record.confirmedChallengeId!==input.challenge.id||record.submitOperationId)throw Error('원래 새 문서의 제출 확인을 읽기로 확인해주세요.');
  const visible=node=>Boolean(node&&node.getClientRects().length);
  for(const item of input.challenge.items.filter(item=>item.required)){
    const nodes=Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(node=>visible(node)&&node.id===item.id);
    if(nodes.length!==1||nodes[0].disabled||!nodes[0].checked||!Array.from(nodes[0].labels||[]).some(label=>(label.innerText||label.textContent||'').trim()===item.text))throw Error('제출 직전 동의 항목이 변경되었습니다.');
  }
  const buttons=Array.from(document.querySelectorAll('button[type="submit"]')).filter(node=>visible(node)&&!node.disabled&&node.getAttribute('aria-disabled')!=='true');if(buttons.length!==1)throw Error('최종 등록 버튼을 확인하지 못했습니다.');
  record.submitOperationId=input.operationId;record.state='submit-requested';records[input.binding.packetDigest]=record;data.yoofamSingleDocumentRecords=JSON.stringify(records);
  buttons[0].click();return {dispatched:true,registered:false};
}

/** Current retained evidence proves only a completion string, not a document
 * + receipt + SKU relationship. Keep it as diagnostic data, never acceptance. */
export function singleDocumentReceiptPage(input){
  if(location.origin!=='https://supplier.coupang.com')throw Error('Supplier Hub 탭을 확인해주세요.');
  const text=(document.querySelector('.text-primary')?.innerText||'').trim();
  return {registered:false,receiptVerified:false,docId:input.docId,completionText:text==='상품 등록 완료'?text:null};
}

export function createSingleDocumentBrowserAdapter({api=globalThis.chrome,now=Date.now}={}){
  if(!api?.tabs||!api?.scripting||['get','query','update','sendMessage'].some(key=>typeof api.tabs[key]!=='function')||typeof api.scripting.executeScript!=='function')throw new TypeError('Existing Chrome tab adapter is required.');
  const sourceBindings=new Map(),baselines=new Map(),pageRecords=new Map(),frameDocuments=new Map();
  async function appCurrent(identity){
    if(!HANDOFF_ORIGINS.includes(identity?.origin)||!Number.isSafeInteger(identity.appTabId)||!Number.isSafeInteger(identity.windowId))fail('SOURCE_CHANGED','원래 앱 탭을 확인해주세요.');
    const tab=await api.tabs.get(identity.appTabId);let url;try{url=new URL(tab?.url);}catch{fail('SOURCE_CHANGED','원래 앱 탭을 같은 Chrome 창에 열어두세요.');}
    if(tab.id!==identity.appTabId||tab.windowId!==identity.windowId||tab.pendingUrl||url.origin!==identity.origin||url.username||url.password)fail('SOURCE_CHANGED','원래 앱 탭 또는 Chrome 창이 변경되었습니다.');
  }
  async function readSourceUnchecked(input){
    await appCurrent(input.identity);
    const response=await api.tabs.sendMessage(input.identity.appTabId,{type:'YOOFAM_VERIFY_SINGLE_DOCUMENT_SOURCE',expected:copy(input)},{frameId:0});await appCurrent(input.identity);
    const good=response?.ok===true&&response.current===true&&response.submissionReady===true&&response.priorDocumentClear===true
      &&equal(response.identity,input.identity)&&response.bodySha256===input.bodySha256&&HASH.test(input.preparedBodySha256||'')&&HASH.test(input.packetDigest||'')
      &&ID.test(response.sessionId||'')&&Number.isSafeInteger(response.checkedAt)&&Math.abs(now()-response.checkedAt)<=60000;
    if(!good){sourceBindings.delete(canonical(input.identity));return {current:false,submissionReady:false,priorDocumentClear:false,identity:input.identity,bodySha256:input.bodySha256,sessionId:'invalid-source'};}
    const [fresh]=await api.scripting.executeScript({target:{tabId:input.identity.appTabId,frameIds:[0]},func:singleDocumentAppSourcePage,args:[copy(input)]});await appCurrent(input.identity);
    if(fresh?.frameId!==undefined&&fresh.frameId!==0||fresh?.result?.current!==true||!equal(fresh.result.identity,input.identity)||fresh.result.bodySha256!==input.bodySha256||fresh.result.preparedBodySha256!==input.preparedBodySha256)fail('SOURCE_CHANGED','최신 Single 준비 GET의 정확한 본문을 확인하지 못했습니다.');
    const after=await api.tabs.sendMessage(input.identity.appTabId,{type:'YOOFAM_VERIFY_SINGLE_DOCUMENT_SOURCE',expected:copy(input)},{frameId:0});await appCurrent(input.identity);
    if(after?.ok!==true||after.sessionId!==response.sessionId||!equal(after.identity,input.identity)||after.current!==true||after.submissionReady!==true||after.priorDocumentClear!==true
      ||after.bodySha256!==input.bodySha256||!Number.isSafeInteger(after.checkedAt)||Math.abs(now()-after.checkedAt)>60000)fail('SOURCE_CHANGED','조회 중 회원 세션·개별 전송 연결이 변경되었습니다.');
    const binding={identity:copy(input.identity),identityDigest:await digest(input.identity),packetDigest:input.packetDigest,preparedBodySha256:input.preparedBodySha256,originalBodySha256:input.bodySha256,sessionId:response.sessionId,requestId:input.requestId};
    sourceBindings.set(canonical(input.identity),{input:copy(input),binding});
    return {current:true,submissionReady:true,priorDocumentClear:true,identity:copy(response.identity),bodySha256:response.bodySha256,sessionId:response.sessionId};
  }
  async function readSource(input){
    try{return await readSourceUnchecked(input);}catch{
      sourceBindings.delete(canonical(input.identity));fail('SOURCE_CHANGED','현재 앱의 회원·회사·Single 준비 GET을 다시 확인해주세요.');
    }
  }
  async function bindingFor(identity,sessionId){
    const prior=sourceBindings.get(canonical(identity));if(!prior)fail('SOURCE_CHANGED','현재 앱의 개별 견적서 저장본을 먼저 확인해주세요.');
    const proof=await readSource(prior.input);if(!proof.current||sessionId!==undefined&&proof.sessionId!==sessionId)fail('SOURCE_CHANGED','현재 회원 세션·준비한 개별 견적서가 변경되었습니다.');
    return sourceBindings.get(canonical(identity)).binding;
  }
  async function execute(tab,identity,func,args,documentId){
    const before=await api.tabs.get(tab.tabId);if(!validHubTab(before,identity.windowId))fail('TAB_CHANGED','선택한 Supplier Hub 탭이 이동되었습니다.');
    const target={tabId:tab.tabId,...(documentId?{documentIds:[documentId]}:{frameIds:[0]})};
    const [company]=await api.scripting.executeScript({target,func:verifySupplierHubCompany,args:[identity.company,'catalog']});
    if(company?.frameId!==undefined&&company.frameId!==0||company?.result?.code!==identity.company.code)fail('TAB_CHANGED','현재 Supplier Hub 회사가 다릅니다.');
    if(documentId&&company?.documentId!==documentId)fail('TAB_CHANGED','새 문서를 불러오는 브라우저 문서가 변경되었습니다.');
    const [execution]=await api.scripting.executeScript({target,func,args});
    const after=await api.tabs.get(tab.tabId);if(!validHubTab(after,identity.windowId)||execution?.frameId!==undefined&&execution.frameId!==0)fail('TAB_CHANGED','개별 등록 탭·프레임이 변경되었습니다.');
    if(documentId&&execution?.documentId!==documentId)fail('TAB_CHANGED','새 문서를 불러오는 브라우저 문서가 변경되었습니다.');
    if(execution?.frameId===0&&typeof execution.documentId==='string')frameDocuments.set(tab.tabId,execution.documentId);
    return execution?.result;
  }
  async function readTab(input){
    const tab=await api.tabs.get(input.tab.tabId);if(!validHubTab(tab,input.identity.windowId))fail('TAB_CHANGED','원래 Supplier Hub 탭을 확인해주세요.');
    await execute(input.tab,input.identity,verifySupplierHubCompany,[input.identity.company,'catalog']);
    return {tabId:tab.id,windowId:tab.windowId,origin:SINGLE_DOCUMENT_ORIGIN,authenticated:true,company:copy(input.identity.company)};
  }
  async function owned(input){
    const binding=await bindingFor(input.identity,input.sessionId),record=await execute(input.tab,input.identity,singleDocumentOwnedRecordPage,[binding]);
    if(!record||record.binding.identityDigest!==binding.identityDigest||record.binding.packetDigest!==binding.packetDigest||input.docId!==null&&input.docId!==undefined&&!equal(record.docId,input.docId))fail('READBACK_UNCONFIRMED','현재 요청에서 생성한 새 문서의 식별값이 없습니다.');return {binding,record};
  }
  async function hubRequest(input){
    const binding=await bindingFor(input.identity,input.sessionId);
    if(input.method==='POST'&&!input.path.endsWith('/create'))await owned({...input,docId:input.body?.docId});
    const value=await execute(input.tab,input.identity,singleDocumentHubRequestPage,[{binding,method:input.method,path:input.path,...(input.body===undefined?{}:{body:input.body}),
      ...(input.operationId===undefined?{}:{operationId:input.operationId}),...(input.path.endsWith('/create')?{baselineDocIds:baselines.get(binding.packetDigest)??[]}:{})}]);
    if(input.method==='GET'&&input.path==='/sr/draft/api/drafts'&&value?.ok===true&&Array.isArray(value.json)&&!baselines.has(binding.packetDigest))baselines.set(binding.packetDigest,value.json.map(row=>row.docId));
    if(value?.ownedRecord)pageRecords.set(binding.packetDigest,copy(value.ownedRecord));
    return value;
  }
  async function readDocument(input,recovery=false){
    const {binding,record}=await owned(input),docId=record.docId;
    if(!docId||record.baselineDocIds?.some(id=>equal(id,docId))||recovery&&record[input.operation==='create'?'createOperationId':'updateOperationId']!==input.operationId)return null;
    const response=await execute(input.tab,input.identity,singleDocumentHubRequestPage,[{binding,method:'GET',path:'/sr/draft/api/get-by-id/'+encodeURIComponent(String(docId))}]);
    const document=response?.json;
    // Axios' response.data is the document itself in the observed Hub loader;
    // do not accept a guessed {data, body, document} wrapper or a list row.
    if(response?.ok!==true||!document||typeof document!=='object'||Array.isArray(document)||!equal(document.docId,docId)
      ||!['UNFINISHED','REJECTED'].includes(document.status)||!Array.isArray(document.jsonDocument)||document.jsonDocument.length!==1
      ||document.scope!=='Retail_Categorized_Single')return null;
    const fields=['docId','productName','categoryPath','categoryId','displayCategoryCode','jsonDocument','scope','productNoticeNumber','version','remark'];
    const body=Object.fromEntries(fields.filter(key=>Object.hasOwn(document,key)).map(key=>[key,document[key]]));
    return {docId,company:copy(input.identity.company),identityDigest:binding.identityDigest,body,...(recovery?{readOnly:true,operationId:input.operationId}:{})};
  }
  return Object.freeze({readSource,
    selectTab:async input=>{
      await bindingFor(input.identity);const tabs=await api.tabs.query({windowId:input.windowId,url:'https://supplier.coupang.com/*'}),matches=[];
      for(const tab of tabs.filter(tab=>validHubTab(tab,input.windowId))){
        const candidate={tabId:tab.id,windowId:tab.windowId,origin:SINGLE_DOCUMENT_ORIGIN,authenticated:true,company:input.identity.company};
        try{await readTab({tab:candidate,identity:input.identity});matches.push(candidate);}catch(error){if(error instanceof SingleDocumentError&&error.code==='SOURCE_CHANGED')throw error;}
      }
      if(matches.length!==1)fail('TAB_CHANGED','같은 Chrome 창의 요청 회사 Supplier Hub 탭을 하나로 확인해주세요.');return copy(matches[0]);
    },readTab,hubRequest,readDocument:input=>readDocument(input),recoverWrite:input=>readDocument(input,true),
    readValidation:async input=>{const {record}=await owned(input),observation=record.validation?.[input.step];return observation?.state==='observed'&&observation.operationId===input.operationId
      ?{readOnly:true,operationId:input.operationId,docId:record.docId,company:copy(input.identity.company),step:input.step,response:observation.response}:null;},
    navigate:async input=>{
      const {binding,record}=await owned(input);if(!equal(record.docId,input.docId))fail('NAVIGATION','원래 새 문서만 불러올 수 있습니다.');
      const tab=await api.tabs.get(input.tab.tabId),url=new URL(tab.url);
      if(!/^\/sr\/registration\/step\//.test(url.pathname)){
        await bindingFor(input.identity,input.sessionId);await api.tabs.update(input.tab.tabId,{url:SINGLE_DOCUMENT_ORIGIN+'/sr/registration/step/startPage'});
        let ready=false;for(let count=0;count<80;count++){const current=await api.tabs.get(input.tab.tabId);if(validHubTab(current,input.identity.windowId)&&new URL(current.url).pathname==='/sr/registration/step/startPage'){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}
        if(!ready)fail('NAVIGATION','개별 등록 시작 화면이 준비되지 않았습니다.');
        const carried=pageRecords.get(binding.packetDigest);
        if(!carried||!equal(carried.docId,record.docId)||!equal(carried.binding,binding))fail('NAVIGATION','같은 탭의 원래 문서 응답 기록이 없습니다.');
        await execute(input.tab,input.identity,singleDocumentRestoreOwnedRecordPage,[{binding,record:carried}]);
      }
      const current=await api.tabs.get(input.tab.tabId);
      if(new URL(current.url).pathname==='/sr/registration/step/startPage'){
        await owned(input);const documentId=frameDocuments.get(input.tab.tabId),attemptId=crypto.randomUUID();
        const readList=async()=>{
          const response=await hubRequest({...input,method:'GET',path:'/sr/draft/api/drafts'});
          if(response?.ok!==true||!Array.isArray(response.json))fail('NAVIGATION','원문 중간 저장 목록을 확인하지 못했습니다.');
          return response.json.map(row=>({docId:row.docId,productName:row.productName,categoryPath:row.categoryPath,modifiedAt:row.modifiedAt,remark:Boolean(row.remark)}));
        };
        const drafts=await readList(),base={binding,docId:input.docId,productName:input.productName,attemptId,drafts};
        await execute(input.tab,input.identity,singleDocumentLoadPage,[{...base,action:'prepare'}],documentId);
        const after=await readList();if(!equal(after,drafts))fail('NAVIGATION','문서 목록이 변경되었습니다. 다른 문서를 선택하지 않았습니다.');
        const observed=await observeSingleDraftLoad({api,tabId:input.tab.tabId,documentId,docId:input.docId},()=>execute(input.tab,input.identity,singleDocumentLoadPage,[{...base,action:'load'}],documentId));
        if(observed.loaded?.loaded!==true||!equal(observed.loaded.docId,input.docId))fail('NAVIGATION','새 문서 화면의 불러오기를 확인하지 못했습니다.');
        await bindingFor(input.identity,input.sessionId);
        const readback=await readDocument(input);
        // Repeat the receiver's exact-body check after the page's own loader;
        // replacing only the server-assigned ID restores the prepared body.
        const body=readback?.body?copy(readback.body):null;if(!body)fail('READBACK_UNCONFIRMED','불러온 새 문서의 본문을 확인하지 못했습니다.');body.docId=null;
        if(await digest(body)!==binding.preparedBodySha256)fail('READBACK_UNCONFIRMED','불러오는 동안 새 문서 본문이 변경되었습니다.');
        await execute(input.tab,input.identity,singleDocumentLoadPage,[{...base,action:'confirm',observation:observed.observation}],documentId);
      }
      await bindingFor(input.identity,input.sessionId);return execute(input.tab,input.identity,singleDocumentNavigatePage,[{binding,docId:input.docId,productName:input.productName}]);
    },
    readAgreements:async input=>{const {binding}=await owned(input);return execute(input.tab,input.identity,singleDocumentAgreementPage,[{binding,docId:input.docId,action:'read'}]);},
    verifyHumanConfirmation:async input=>{
      await appCurrent(input.identity);const response=await api.tabs.sendMessage(input.identity.appTabId,{type:'YOOFAM_CONFIRM_SINGLE_DOCUMENT_ACTION',expected:copy(input)},{frameId:0});await appCurrent(input.identity);
      const binding=await bindingFor(input.identity);
      return {confirmed:response?.ok===true&&response.userInitiated===true&&response.challengeId===input.challenge.id&&response.identityDigest===binding.identityDigest
        &&Number.isSafeInteger(response.checkedAt)&&Math.abs(now()-response.checkedAt)<=5000,challengeId:input.challenge.id,identityDigest:binding.identityDigest};
    },
    confirmAgreements:async input=>{const {binding}=await owned(input);return execute(input.tab,input.identity,singleDocumentAgreementPage,[{binding,docId:input.docId,action:'confirm',challenge:input.challenge,confirmation:input.confirmation}]);},
    submit:async input=>{const {binding}=await owned(input);return execute(input.tab,input.identity,singleDocumentSubmitPage,[{binding,docId:input.docId,operationId:input.operationId,challenge:input.challenge}]);},
    observeReceipt:async input=>{
      const {binding}=await owned(input),diagnostic=await execute(input.tab,input.identity,singleDocumentReceiptPage,[{binding,docId:input.docId}]);
      // The completion text is not sufficient. Until an exact receipt/SKU DOM
      // contract is independently recorded, never return an accepted result.
      if(diagnostic?.receiptVerified!==true)fail('RECEIPT_UNCONFIRMED','완료 문구만으로 접수·SKU를 확정하지 않습니다. 원래 문서의 실제 접수를 확인해주세요.');
      return diagnostic;
    },
  });
}
