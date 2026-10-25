import {verifySupplierHubCompany} from './company.mjs';
import {HANDOFF_ORIGINS} from './handoff-store.mjs';
import {SINGLE_DOCUMENT_ORIGIN,SingleDocumentError} from './single-document.mjs';
import {singleDocumentLoadPage} from './single-load-page.mjs';
import {observeSingleDraftLoad} from './single-load-observer.mjs';
import {singleDocumentStageAgreementPage} from './single-stage-page.mjs';
import {createSingleDocumentWatch} from './single-document-watch.mjs';
import {singleDocumentWatchPage} from './single-watch-page.mjs';
import {normalizeSingleReceipt} from './single-receipt.mjs';
import {assertSingleOwnedTarget,createSingleOwnedTarget,waitSingleOwnedTarget} from './single-owned-target.mjs';
import {nativeProductAssetBytes,prepareAndUploadNativeProductAssets} from './native-product-assets.mjs';
import {readAppDocumentSource,sourceReadError,normalizeSourceReadFailure,currentSourceAppTab} from './product-document-source.mjs';
import {nativeAssetUploadPage} from './native-asset-upload-page.mjs';
import {nativeAssetRecoveryPage} from './native-asset-recovery-page.mjs';
import {singleDocumentRetryCreatePage} from './single-create-retry-page.mjs';
import {nativeAssetUploadPlanSha256,validateNativeAssetUploadDescriptors} from './native-asset-multipart.mjs';

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
export async function singleDocumentAppSourcePage(input,wholeProduct=false){
  const expected=input.identity,canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
  if(!['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'].includes(location.origin)||location.origin!==expected.origin)throw Error('원래 앱의 저장본 조회가 아닙니다.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  const read=async path=>{
    const resource=path==='/api/supplier-hub/catalog-context'?'catalog-context':'single-package',failure=(code,status)=>Object.assign(Error('현재 앱의 저장본 조회를 확인하지 못했습니다.'),{sourceFailure:{code,resource,...(status===undefined?{}:{status})}});
    const url=location.origin+path;let response;try{response=await fetch(url,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,headers:{accept:'application/json'}});}catch{throw failure(controller.signal.aborted?'SOURCE_READ_TIMEOUT':'SOURCE_READ_NETWORK');}
    if(!response.ok)throw failure('SOURCE_READ_HTTP',response.status);
    if(response.redirected||response.url!==url||!/\bapplication\/json\b/i.test(response.headers.get('content-type')||''))throw failure('SOURCE_READ_RESPONSE');
    let text;try{text=await response.text();}catch{throw failure(controller.signal.aborted?'SOURCE_READ_TIMEOUT':'SOURCE_READ_NETWORK');}if(controller.signal.aborted)throw failure('SOURCE_READ_TIMEOUT');if(new TextEncoder().encode(text).length>6*1024*1024)throw failure('SOURCE_READ_RESPONSE');try{return JSON.parse(text);}catch{throw failure('SOURCE_READ_RESPONSE');}
  };
  const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
  try{
    const before=await read('/api/supplier-hub/catalog-context');
    if(before.ownerId!==expected.ownerId||canon(before.company)!==canon(expected.company))throw Error('현재 승인 회원·회사가 다릅니다.');
    const accountContext=await sha(JSON.stringify(['sourceflow-managed-product-account-v1',before.ownerId,before.company.code,before.company.name]));
    if(accountContext!==expected.accountContext)throw Error('현재 회원 회사 연결이 변경되었습니다.');
    const requested=wholeProduct?expected.requestedProfileId:expected.profileId;
    const path='/api/products/'+encodeURIComponent(expected.productId)+'/supplier-hub-single-package'+(requested===null?'':'?profileId='+encodeURIComponent(requested)),view=await read(path);
    if(view?.format!=='yoofam-supplier-hub-single-package-v1'||view.prepared!==true||view.review?.canPrepare!==true||view.productId!==expected.productId||view.requestedProfileId!==requested
      ||view.fingerprint!==expected.fingerprint||view.schemaSha256!==expected.schemaSha256||canon(view.company)!==canon(expected.company)||view.source?.profileId!==expected.profileId
      ||view.registered!==false||view.remoteWrites!==false||view.submissionReady!==false||view.humanAgreementsConfirmed!==false||!Array.isArray(view.payload?.jsonDocument)
      ||view.payload.docId!==null||view.payload.scope!=='Retail_Categorized_Single'||view.payload.displayCategoryCode!==expected.categoryId||!Array.isArray(view.review.fields)
      ||view.review.issues?.some(issue=>issue.level==='error')||!Array.isArray(view.manifest)||view.manifest.some(item=>!Array.isArray(item.files)||item.files.some(file=>file.published!==true||file.verification!=='stored-body-sha256')))throw Error('명시적으로 준비한 최신 Single 자료를 확인하지 못했습니다.');
    const source=Object.fromEntries(['productVersion','contentRevision','optionRevision','quotationRevision','profileRevision'].map(key=>[key,view.source[key]]));
    if(canon(source)!==canon(expected.source))throw Error('상품·견적서 저장 버전이 변경되었습니다.');
    const rows=view.review.fields.filter(field=>Array.isArray(field.path)&&canon(field.path)===canon(['startPage','productName'])&&field.name===undefined);
    if(rows.length!==view.payload.jsonDocument.length||new Set(rows.map(row=>row.optionId)).size!==rows.length)throw Error('Single 포함 옵션과 문서 순서 연결이 다릅니다.');
    let body;
    if(wholeProduct){
      if(Object.hasOwn(expected,'optionId')||view.inputFingerprint!==expected.inputFingerprint||!Array.isArray(expected.members)||!expected.members.length
        ||expected.members.length>200||rows.length!==expected.members.length||!Array.isArray(view.options)||view.options.length!==rows.length
        ||rows.some((row,index)=>row.optionId!==expected.members[index].optionId||expected.members[index].documentIndex!==index
          ||view.options[index].optionId!==row.optionId||view.options[index].optionLabel!==expected.members[index].optionLabel))throw Error('포함 옵션 전체와 문서 순서가 변경되었습니다.');
      body=view.payload;
    }else{
      const matches=rows.map((row,index)=>({row,index})).filter(({row})=>row.optionId===expected.optionId);
      if(matches.length!==1)throw Error('선택한 저장 옵션이 최종 문서에 없습니다.');
      const document=view.payload.jsonDocument[matches[0].index];body={...view.payload,productName:document.startPage.productName,categoryPath:document.startPage.categoryPath,jsonDocument:[document]};
    }
    const originalBodySha256=await sha(canon(body)),deferred=JSON.parse(JSON.stringify(body));
    for(const document of deferred.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])if(document.imagePage&&Object.hasOwn(document.imagePage,key))document.imagePage[key]=false;
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
    const readOnlyReceipt=input.readOnlyReceipt===true&&input.method==='GET'&&input.path==='/sr/draft/api/drafts/register-requested';
    const watched=JSON.parse(data.yoofamSingleDocumentRecords||'{}')[binding?.packetDigest];if(!readOnlyReceipt&&watched?.watchToken!==undefined&&(watched.watchState!=='active'||Date.now()>=watched.watchExpiresAt))throw Error('현재 새 문서의 입력 관찰이 중단됐습니다.');
    const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
    if(!binding||!['identityDigest','packetDigest','preparedBodySha256','originalBodySha256'].every(key=>typeof binding[key]==='string'&&/^[a-f0-9]{64}$/.test(binding[key]))
      ||codes.length!==1||codes[0]!==binding.identity?.company?.code||!({A01526306:'유앤채',A01464742:'와이홉'})[codes[0]]
      ||({A01526306:'유앤채',A01464742:'와이홉'})[codes[0]]!==binding.identity.company.name)throw Error('개별 전송 회사·저장본의 연결을 확인해주세요.');
  };
  check();
  const receiptRead=input.method==='GET'&&input.path==='/sr/draft/api/drafts/register-requested';
  const documentRead=input.method==='GET'&&/^\/sr\/draft\/api\/get-by-id\/[^/?#]+$/.test(input.path);
  const known=input.method==='GET'&&input.path==='/sr/draft/api/drafts'||documentRead||receiptRead||input.method==='POST'&&(['/sr/draft/api/create','/sr/draft/api/update'].includes(input.path)||/^\/sr\/qvt\/api\/validate-step\/[2-5]$/.test(input.path));
  if(!known||input.method==='GET'&&Object.hasOwn(input,'body'))throw Error('확인된 개별 문서 경로에서만 요청할 수 있습니다.');
  let records={};try{records=JSON.parse(data.yoofamSingleDocumentRecords||'{}');}catch{throw Error('이 탭의 개별 전송 기록을 확인해주세요.');}
  if(!records||typeof records!=='object'||Array.isArray(records)||Object.keys(records).length>1000)throw Error('개별 전송 기록 범위를 확인해주세요.');
  const key=binding.packetDigest;let record=records[key];
  const save=()=>{records[key]=record;data.yoofamSingleDocumentRecords=JSON.stringify(records);};
  if(receiptRead&&(!record||!same(record.binding,binding)||!identifier(record.docId)||!same(record.loadedDocId,record.docId)||record.state!=='submit-requested'
    ||input.operationId!==record.submitOperationId||input.operationId!==binding.requestId+':submit'||!record.submitProof||!same(record.submitProof.docId,record.docId)
    ||record.submitProof.operationId!==input.operationId||record.baselineDocIds?.some(id=>same(id,record.docId))))throw Error('이 요청에서 제출한 정확한 새 문서의 결과만 조회할 수 있습니다.');
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
      const members=binding.identity.members,group=Array.isArray(members)&&!Object.hasOwn(binding.identity,'optionId');
      if(input.body?.docId!==null||input.body.scope!=='Retail_Categorized_Single'||!Array.isArray(input.body.jsonDocument)
        ||(group?members.length<1||members.length>200||members.some((member,index)=>member.documentIndex!==index)||input.body.jsonDocument.length!==members.length:input.body.jsonDocument.length!==1))throw Error('새 문서의 포함 옵션 구성이 다릅니다.');
      // Do not overwrite an existing form the user has been editing.
      const values=Array.from(document.querySelectorAll('.rsc-text-input input')).map(node=>node.value||'');
      if(values.some(value=>value.trim()))throw Error('현재 Supplier Hub에서 작업 중인 상품을 보존했습니다.');
      record={binding,docId:null,createOperationId:input.operationId,state:'create-requested',baselineDocIds:input.baselineDocIds??[]};save();
    }else{
      if(!record||!same(record.binding,binding)||!identifier(record.docId)||!same(record.docId,input.body?.docId))throw Error('이 요청에서 새로 만든 문서만 수정·검증할 수 있습니다.');
      if(input.path.endsWith('/update')){
        if(binding.nativeAssetSourcePlanSha256&&record.nativeAssets?.state!=='complete')throw Error('이 새 문서의 원본 파일 업로드·목록 확인을 먼저 마쳐주세요.');
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
    return {ok,status:response.status,json,...(record?{ownedRecord:record}:{}),...(receiptRead?{receiptProvenance:{method:'GET',url:response.url,status:response.status,redirected:response.redirected,contentType:response.headers.get('content-type'),cache:'no-store',readOnly:true,
      docId:record.docId,company:binding.identity.company,identityDigest:binding.identityDigest,preparedBodySha256:binding.preparedBodySha256,operationId:input.operationId}}:{})};
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
    if(record?.watchToken!==undefined&&(record.watchState!=='active'||Date.now()>=record.watchExpiresAt))throw Error('현재 새 문서의 입력 관찰이 중단됐습니다.');
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
    const checkboxes=Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(visible),stage=location.pathname.split('/').at(-1),known={productPage:'agreeMSRPTerm',imagePage:'agreeLabelContact'}[stage];
    if(known&&checkboxes.some(node=>node.id===known)&&!(input.stageConsents??[]).some(entry=>entry.stage===stage))return {docId:input.docId,company:input.binding.identity.company,productName:input.productName,readyForSubmit:false,readyForConsent:true,stage};
    if(checkboxes.some(node=>(node.required||['agreeMSRPTerm','agreeLabelContact'].includes(node.id))&&!node.checked))throw Error('현재 단계의 필수 동의를 확인해주세요. 자동으로 선택하지 않았습니다.');
    const buttons=Array.from(document.querySelectorAll('button[type="submit"]')).filter(node=>visible(node)&&!node.disabled&&node.getAttribute('aria-disabled')!=='true');
    if(buttons.length!==1)throw Error('다음 개별 등록 단계 버튼을 확인해주세요.');
    const currentRecord=check();if(currentRecord.nextOperations?.[stage])throw Error('이 단계의 다음 요청은 이미 실행했습니다. 화면을 읽기로 확인하고 다시 누르지 않았습니다.');
    currentRecord.nextOperations??={};currentRecord.nextOperations[stage]={next,state:'requested'};
    document.documentElement.dataset.yoofamSingleDocumentRecords=JSON.stringify({...JSON.parse(document.documentElement.dataset.yoofamSingleDocumentRecords||'{}'),[input.binding.packetDigest]:currentRecord});
    buttons[0].click();await wait(()=>(document.querySelector('#root__title')?.innerText||'').trim()===next);
    const advanced=check();advanced.nextOperations[stage].state='observed';
    document.documentElement.dataset.yoofamSingleDocumentRecords=JSON.stringify({...JSON.parse(document.documentElement.dataset.yoofamSingleDocumentRecords||'{}'),[input.binding.packetDigest]:advanced});
  }
  check();if(record.loadedDocId!==input.docId||(document.querySelector('#root__title')?.innerText||'').trim()!=='Logistics Page')throw Error('선택한 새 문서의 최종 단계를 확인하지 못했습니다.');
  return {docId:input.docId,company:input.binding.identity.company,productName:input.productName,readyForSubmit:true};
}

/** Recovery reads the current owned stage without another next-step click. */
export function singleDocumentNavigationReadPage(input){
  const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
  const record=JSON.parse(document.documentElement.dataset.yoofamSingleDocumentRecords||'{}')[input.binding.packetDigest],codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),m=>m[1]),stage=location.pathname.split('/').at(-1);
  if(location.origin!=='https://supplier.coupang.com'||codes.length!==1||codes[0]!==input.binding.identity.company.code||!record||canon(record.binding)!==canon(input.binding)||record.docId!==input.docId||record.loadedDocId!==input.docId)throw Error('원래 새 문서의 현재 단계를 읽기로 확인해주세요.');
  const base={docId:input.docId,company:input.binding.identity.company,productName:input.productName};
  if(stage==='logisticsPage'&&(document.querySelector('#root__title')?.innerText||'').trim()==='Logistics Page')return {...base,readyForSubmit:true};
  const known={productPage:'agreeMSRPTerm',imagePage:'agreeLabelContact'}[stage];
  if(known&&(input.stageConsents??[]).at(-1)?.stage===stage&&record.stageConsentOperations?.[stage]?.state==='observed'&&!record.nextOperations?.[stage]){
    const checked=Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(node=>node.getClientRects().length&&node.id===known&&!node.disabled&&node.checked);
    if(checked.length===1)return {...base,stage,readyForSubmit:false,readyForConsent:false,readyForContinue:true};
  }
  if(known&&!(input.stageConsents??[]).some(entry=>entry.stage===stage)&&Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(node=>node.getClientRects().length&&node.id===known).length===1)return {...base,readyForSubmit:false,readyForConsent:true,stage};
  throw Error('이 단계의 요청 결과가 불명확합니다. 읽기로 확인했으며 다음 버튼을 다시 누르지 않았습니다.');
}

/** Read current displayed legal terms; known IDs alone do not establish their
 * meaning. The app shows these exact texts for explicit current confirmation. */
export function singleDocumentAgreementPage(input){
  const data=document.documentElement.dataset,canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
  if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/sr/registration/step/logisticsPage')throw Error('개별 상품의 최종 등록 화면을 확인해주세요.');
  const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]);
  const records=JSON.parse(data.yoofamSingleDocumentRecords||'{}'),record=records[input.binding.packetDigest];
  if(record?.watchToken!==undefined&&(record.watchState!=='active'||Date.now()>=record.watchExpiresAt))throw Error('현재 새 문서의 입력 관찰이 중단됐습니다.');
  if(codes.length!==1||codes[0]!==input.binding.identity.company.code||!record||canon(record.binding)!==canon(input.binding)||record.docId!==input.docId||record.loadedDocId!==input.docId)throw Error('새 개별 문서의 회사·화면 연결을 확인해주세요.');
  const visible=node=>Boolean(node&&node.getClientRects().length);
  const items=Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(visible).map(node=>{
    const texts=Array.from(node.labels||[]).filter(visible).map(label=>(label.innerText||label.textContent||'').trim()).filter(Boolean);
    if(!node.id||texts.length!==1||node.disabled)throw Error('동의 항목의 정확한 문구를 확인하지 못했습니다.');
    return {key:node.id,id:node.id,text:texts[0],required:node.required===true||node.id==='agreeLabelContact',checked:node.checked===true,enabled:true};
  });
  const stageConfirmed=['productPage','imagePage'].every(stage=>record.stageConsentOperations?.[stage]?.state==='observed');
  if(!items.length&&!stageConfirmed||new Set(items.map(item=>item.id)).size!==items.length||items.length&&!items.some(item=>item.required))throw Error('현재 최종 단계의 필수 동의 문구를 확인하지 못했습니다.');
  if(input.action==='confirm'){
    const expected=input.challenge?.items;
    if(!Array.isArray(expected)||canon(items.map(({key,id,text,required})=>({key,id,text,required})))!==canon(expected)
      ||input.confirmation?.challengeId!==input.challenge.id||input.confirmation?.userInitiated!==true||Date.now()>input.challenge.expiresAt
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
  // Match the prepared packet's numeric wire domain without changing its type.
  const numeric=value=>Number.isSafeInteger(value)&&value>=0||typeof value==='string'&&/^\d{1,20}$/.test(value);
  if(location.origin!=='https://supplier.coupang.com'||location.pathname!=='/sr/registration/step/logisticsPage')throw Error('최종 개별 등록 화면이 변경되었습니다.');
  const codes=Array.from((document.body.innerText||'').matchAll(/Company Code:\s*(A\d+)\b/g),match=>match[1]),data=document.documentElement.dataset;
  const records=JSON.parse(data.yoofamSingleDocumentRecords||'{}'),record=records[input.binding.packetDigest];
  if(record?.watchToken!==undefined&&(record.watchState!=='active'||Date.now()>=record.watchExpiresAt))throw Error('현재 새 문서의 입력 관찰이 중단됐습니다.');
  if(codes.length!==1||codes[0]!==input.binding.identity.company.code||!record||canon(record.binding)!==canon(input.binding)||record.docId!==input.docId||record.loadedDocId!==input.docId
    ||record.confirmedChallengeId!==input.challenge.id||record.submitOperationId)throw Error('원래 새 문서의 제출 확인을 읽기로 확인해주세요.');
  const visible=node=>Boolean(node&&node.getClientRects().length);
  for(const item of input.challenge.items.filter(item=>item.required)){
    const nodes=Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(node=>visible(node)&&node.id===item.id);
    if(nodes.length!==1||nodes[0].disabled||!nodes[0].checked||!Array.from(nodes[0].labels||[]).some(label=>(label.innerText||label.textContent||'').trim()===item.text))throw Error('제출 직전 동의 항목이 변경되었습니다.');
  }
  const buttons=Array.from(document.querySelectorAll('button[type="submit"]')).filter(node=>visible(node)&&!node.disabled&&node.getAttribute('aria-disabled')!=='true');if(buttons.length!==1)throw Error('최종 등록 버튼을 확인하지 못했습니다.');
  if(input.expectedBody?.docId!==input.docId||input.expectedBody?.productName!==input.expectedBody?.jsonDocument?.[0]?.startPage?.productName
    ||input.expectedBody?.categoryPath!==input.expectedBody?.jsonDocument?.[0]?.startPage?.categoryPath||!numeric(input.expectedBody?.version))throw Error('제출한 새 문서의 상품·카테고리·버전을 확인해주세요.');
  record.submitProof={docId:input.docId,operationId:input.operationId,identityDigest:input.binding.identityDigest,preparedBodySha256:input.binding.preparedBodySha256,
    version:input.expectedBody.version,productName:input.expectedBody.productName,categoryPath:input.expectedBody.categoryPath,requestedAt:Date.now()};
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

export function createSingleDocumentBrowserAdapter(options={}){
  return createSupplierHubDocumentBrowserAdapter(options,{wholeProduct:false});
}
export function createSupplierHubDocumentBrowserAdapter({api=globalThis.chrome,now=Date.now,nativeAssets,sourceAppTabId}={},contract){
  if(!contract||Object.keys(contract).length!==1||typeof contract.wholeProduct!=='boolean')throw new TypeError('A trusted browser source contract is required.');
  const wholeProduct=contract.wholeProduct,nativeSha=nativeAssets?.sourcePlanSha256;
  if(nativeAssets!==undefined&&(!wholeProduct||!nativeAssets||Object.keys(nativeAssets).length!==1||typeof nativeSha!=='string'||!HASH.test(nativeSha)))throw new TypeError('An independently verified native source-plan constructor is required.');
  if(sourceAppTabId!==undefined&&(!nativeSha||!Number.isSafeInteger(sourceAppTabId)||sourceAppTabId<0))throw new TypeError('Only a trusted native source context may replace a closed app tab.');
  const sourceType=nativeSha?'YOOFAM_VERIFY_NATIVE_PRODUCT_DOCUMENT_SOURCE':wholeProduct?'YOOFAM_VERIFY_PRODUCT_DOCUMENT_SOURCE':'YOOFAM_VERIFY_SINGLE_DOCUMENT_SOURCE',confirmationType=nativeSha?'YOOFAM_CONFIRM_NATIVE_PRODUCT_DOCUMENT_ACTION':wholeProduct?'YOOFAM_CONFIRM_PRODUCT_DOCUMENT_ACTION':'YOOFAM_CONFIRM_SINGLE_DOCUMENT_ACTION';
  if(!api?.tabs||!api?.scripting||['get','create','update','sendMessage'].some(key=>typeof api.tabs[key]!=='function')||typeof api.scripting.executeScript!=='function')throw new TypeError('Owned Chrome tab adapter is required.');
  const sourceBindings=new Map(),baselines=new Map(),pageRecords=new Map(),frameDocuments=new Map(),liveWatches=new Map();
  const mutable=identity=>{if(sourceBindings.get(canonical(identity))?.readOnlyReceipt)fail('READ_ONLY_RECEIPT','이미 제출한 원래 문서의 읽기 확인에서는 수정·동의·재제출하지 않습니다.');};
  const requireWatch=entry=>{try{entry.watch.assertCurrent(entry.expected);}catch{fail('TAB_CHANGED','불러온 새 문서의 관찰이 중단됐습니다. 다른 문서를 클릭하거나 전송하지 않았습니다.');}};
  async function appCurrent(identity){
    if(!HANDOFF_ORIGINS.includes(identity?.origin)||!Number.isSafeInteger(identity.appTabId)||!Number.isSafeInteger(identity.windowId))fail('SOURCE_CHANGED','원래 앱 탭을 확인해주세요.');
    await currentSourceAppTab(api,identity,sourceAppTabId);
  }
  async function readSourceUnchecked(input){
    await appCurrent(input.identity);
    if(nativeSha&&input.identity.fingerprint!==nativeSha)fail('SOURCE_CHANGED','별도로 검토한 파일명 원본 계획이 다릅니다.');
    if(wholeProduct?Object.hasOwn(input.identity,'optionId')||!Array.isArray(input.identity.members):Object.hasOwn(input.identity,'members'))fail('SOURCE_CHANGED','문서 전송 방식이 다릅니다.');
    const response=await api.tabs.sendMessage(sourceAppTabId??input.identity.appTabId,{type:sourceType,expected:copy(input)},{frameId:0});await appCurrent(input.identity);
    if(response?.ok!==true&&normalizeSourceReadFailure(response?.sourceFailure))throw sourceReadError(response.sourceFailure);
    const good=response?.ok===true&&response.current===true&&response.submissionReady===true&&response.priorDocumentClear===true
      &&equal(response.identity,input.identity)&&response.bodySha256===input.bodySha256&&HASH.test(input.preparedBodySha256||'')&&HASH.test(input.packetDigest||'')
      &&ID.test(response.sessionId||'')&&Number.isSafeInteger(response.checkedAt)&&Math.abs(now()-response.checkedAt)<=60000;
    if(!good){sourceBindings.delete(canonical(input.identity));return {current:false,submissionReady:false,priorDocumentClear:false,identity:input.identity,bodySha256:input.bodySha256,sessionId:'invalid-source'};}
    const fresh=wholeProduct?{frameId:0,result:await readAppDocumentSource(api,input.identity,input,nativeSha?'native':'legacy',sourceAppTabId)}:(await api.scripting.executeScript({target:{tabId:input.identity.appTabId,frameIds:[0]},func:singleDocumentAppSourcePage,args:[copy(input),wholeProduct]}))[0];await appCurrent(input.identity);
    if(fresh?.frameId!==undefined&&fresh.frameId!==0||fresh?.result?.current!==true||!equal(fresh.result.identity,input.identity)||fresh.result.bodySha256!==input.bodySha256||fresh.result.preparedBodySha256!==input.preparedBodySha256)fail('SOURCE_CHANGED','최신 Single 준비 GET의 정확한 본문을 확인하지 못했습니다.');
    const after=await api.tabs.sendMessage(sourceAppTabId??input.identity.appTabId,{type:sourceType,expected:copy(input)},{frameId:0});await appCurrent(input.identity);
    if(after?.ok!==true&&normalizeSourceReadFailure(after?.sourceFailure))throw sourceReadError(after.sourceFailure);
    if(after?.ok!==true||after.sessionId!==response.sessionId||!equal(after.identity,input.identity)||after.current!==true||after.submissionReady!==true||after.priorDocumentClear!==true
      ||after.bodySha256!==input.bodySha256||!Number.isSafeInteger(after.checkedAt)||Math.abs(now()-after.checkedAt)>60000)fail('SOURCE_CHANGED','조회 중 회원 세션·개별 전송 연결이 변경되었습니다.');
    const recovery=input.receiptRecovery;
    if(recovery!==undefined&&(!nativeSha||!recovery||Object.keys(recovery).sort().join(',')!=='sessionId,submitRequestedAt'||!ID.test(recovery.sessionId||'')||!Number.isSafeInteger(recovery.submitRequestedAt)||recovery.submitRequestedAt<1||recovery.submitRequestedAt>now()+5000||input.docId===null||input.docId===undefined))fail('SOURCE_CHANGED','이미 제출한 원래 문서의 읽기 확인 연결이 다릅니다.');
    const binding={identity:copy(input.identity),identityDigest:await digest(input.identity),packetDigest:input.packetDigest,preparedBodySha256:input.preparedBodySha256,originalBodySha256:input.bodySha256,sessionId:recovery?.sessionId??response.sessionId,requestId:input.requestId,...(nativeSha?{nativeAssetSourcePlanSha256:nativeSha}:{})};
    sourceBindings.set(canonical(input.identity),{input:copy(input),binding,readOnlyReceipt:recovery!==undefined,...(nativeSha?{nativeSourcePlan:copy(fresh.result.sourcePlan)}:{})});
    return {current:true,submissionReady:true,priorDocumentClear:true,identity:copy(response.identity),bodySha256:response.bodySha256,sessionId:response.sessionId};
  }
  async function readSource(input){
    try{return await readSourceUnchecked(input);}catch(error){
      sourceBindings.delete(canonical(input.identity));
      if(normalizeSourceReadFailure(error?.sourceFailure)){
        const failure=sourceReadError(error.sourceFailure);
        if(!nativeSha)fail('SOURCE_CHANGED',failure.message);
        throw Object.assign(new SingleDocumentError(failure.code,failure.message),{sourceFailure:failure.sourceFailure});
      }
      fail('SOURCE_CHANGED','현재 앱의 회원·회사·Single 준비 GET을 다시 확인해주세요.');
    }
  }
  async function bindingFor(identity,sessionId){
    const prior=sourceBindings.get(canonical(identity));if(!prior)fail('SOURCE_CHANGED','현재 앱의 개별 견적서 저장본을 먼저 확인해주세요.');
    const proof=await readSource(prior.input),current=sourceBindings.get(canonical(identity));if(!proof.current||sessionId!==undefined&&(current?.readOnlyReceipt?current.binding.sessionId:proof.sessionId)!==sessionId)fail('SOURCE_CHANGED','현재 회원 세션·준비한 개별 견적서가 변경되었습니다.');
    return sourceBindings.get(canonical(identity)).binding;
  }
  async function execute(tab,identity,func,args,documentId){
    const binding=sourceBindings.get(canonical(identity))?.binding;if(!binding)fail('SOURCE_CHANGED','원래 앱의 전송 연결을 확인해주세요.');
    assertSingleOwnedTarget(tab,binding);
    const entry=liveWatches.get(tab.tabId);if(entry){requireWatch(entry);documentId=entry.expected.documentId;}
    const before=await api.tabs.get(tab.tabId);if(!validHubTab(before,identity.windowId))fail('TAB_CHANGED','선택한 Supplier Hub 탭이 이동되었습니다.');
    const target={tabId:tab.tabId,...(documentId?{documentIds:[documentId]}:{frameIds:[0]})};
    const [company]=await api.scripting.executeScript({target,func:verifySupplierHubCompany,args:[identity.company,'catalog']});
    if(company?.frameId!==undefined&&company.frameId!==0||company?.result?.code!==identity.company.code)fail('TAB_CHANGED','현재 Supplier Hub 회사가 다릅니다.');
    if(documentId&&company?.documentId!==documentId)fail('TAB_CHANGED','새 문서를 불러오는 브라우저 문서가 변경되었습니다.');
    if(entry?.ready){
      requireWatch(entry);const [guard]=await api.scripting.executeScript({target,func:singleDocumentWatchPage,args:[{...entry.page,action:'check'}]});
      if(guard?.documentId!==documentId||guard?.result?.current!==true)fail('TAB_CHANGED','현재 새 문서의 입력 관찰을 확인하지 못했습니다.');
    }
    const [execution]=await api.scripting.executeScript({target,func,args});
    const after=await api.tabs.get(tab.tabId);if(!validHubTab(after,identity.windowId)||execution?.frameId!==undefined&&execution.frameId!==0)fail('TAB_CHANGED','개별 등록 탭·프레임이 변경되었습니다.');
    if(documentId&&execution?.documentId!==documentId)fail('TAB_CHANGED','새 문서를 불러오는 브라우저 문서가 변경되었습니다.');
    if(entry){requireWatch(entry);if(entry.ready){const [guard]=await api.scripting.executeScript({target,func:singleDocumentWatchPage,args:[{...entry.page,action:'check'}]});if(guard?.result?.current!==true)fail('TAB_CHANGED','입력 중 소유 문서 관찰이 변경되었습니다.');}}
    if(execution?.frameId===0&&typeof execution.documentId==='string')frameDocuments.set(tab.tabId,execution.documentId);
    return execution?.result;
  }
  async function readTab(input){
    const binding=sourceBindings.get(canonical(input.identity))?.binding;if(!binding)fail('SOURCE_CHANGED','원래 앱의 전송 연결을 확인해주세요.');
    assertSingleOwnedTarget(input.tab,binding);
    if(input.tab.authenticated!==true)await waitSingleOwnedTarget(api,input.tab,binding);
    const tab=await api.tabs.get(input.tab.tabId);if(!validHubTab(tab,input.identity.windowId))fail('TAB_CHANGED','원래 Supplier Hub 탭을 확인해주세요.');
    await execute(input.tab,input.identity,verifySupplierHubCompany,[input.identity.company,'catalog']);
    return {...copy(input.tab),tabId:tab.id,windowId:tab.windowId,origin:SINGLE_DOCUMENT_ORIGIN,authenticated:true,company:copy(input.identity.company)};
  }
  async function owned(input){
    const binding=await bindingFor(input.identity,input.sessionId),record=await execute(input.tab,input.identity,singleDocumentOwnedRecordPage,[binding]);
    if(!record||record.binding.identityDigest!==binding.identityDigest||record.binding.packetDigest!==binding.packetDigest||input.docId!==null&&input.docId!==undefined&&!equal(record.docId,input.docId))fail('READBACK_UNCONFIRMED','현재 요청에서 생성한 새 문서의 식별값이 없습니다.');
    if(record.loadedDocId!==undefined){const entry=liveWatches.get(input.tab.tabId),readOnly=sourceBindings.get(canonical(input.identity))?.readOnlyReceipt;
      if(readOnly&&!entry){
        if(record.state!=='submit-requested'||!equal(record.loadedDocId,record.docId)||record.submitOperationId!==binding.requestId+':submit'||record.submitProof?.operationId!==record.submitOperationId
          ||!equal(record.submitProof.docId,record.docId)||record.submitProof.identityDigest!==binding.identityDigest||record.submitProof.preparedBodySha256!==binding.preparedBodySha256
          ||record.loadObservation?.documentId!==frameDocuments.get(input.tab.tabId))fail('TAB_CHANGED','이미 제출한 원래 문서와 현재 브라우저 프레임의 읽기 연결을 확인해주세요.');
      }else{if(!entry||!entry.ready||entry.expected.packetDigest!==binding.packetDigest||entry.expected.identityDigest!==binding.identityDigest||!equal(entry.expected.docId,record.docId))fail('TAB_CHANGED','이전 문서 기록만으로 관찰을 복구하지 않았습니다.');requireWatch(entry);}
    }
    return {binding,record};
  }
  async function hubRequest(input){
    const binding=await bindingFor(input.identity,input.sessionId);
    if(input.method==='POST')mutable(input.identity);
    if(input.method==='POST'&&!input.path.endsWith('/create'))await owned({...input,docId:input.body?.docId});
    if(nativeSha&&input.method==='POST'&&input.path==='/sr/draft/api/update'){
      const readCurrent=async()=>{const current=await owned({...input,docId:input.body?.docId}),record=current.record,sourcePlan=sourceBindings.get(canonical(input.identity))?.nativeSourcePlan;
        return{binding:current.binding,sourcePlan,target:{docId:record.docId,requestId:current.binding.requestId,packetDigest:current.binding.packetDigest,preparedBodySha256:current.binding.preparedBodySha256,createOperationId:record.createOperationId,baselineDocIds:copy(record.baselineDocIds)}};};
      const current=await readCurrent(),scope=sourceBindings.get(canonical(input.identity)),privateBytes=new Map();
      const readPrivate=async(action,file)=>{const key=canonical([file.key,file.sha256,file.byteLength,file.contentType]),cached=privateBytes.get(key);if(cached)return cached.slice();await appCurrent(input.identity);const reply={frameId:0,result:await readAppDocumentSource(api,input.identity,{...copy(scope.input),action,file:copy(file)},'native',sourceAppTabId)};await appCurrent(input.identity);
        if(reply?.frameId!==undefined&&reply.frameId!==0||reply?.result?.current!==true||!equal(reply.result.identity,input.identity)||!equal(reply.result.sourcePlan,current.sourcePlan)||reply.result.bodySha256!==binding.originalBodySha256||reply.result.preparedBodySha256!==binding.preparedBodySha256||reply.result.file?.sha256!==file.sha256||reply.result.file?.byteLength!==file.byteLength)fail('SOURCE_CHANGED','현재 앱의 원본 파일·버전 연결을 확인하지 못했습니다.');const bytes=nativeProductAssetBytes(reply.result.file.base64);privateBytes.set(key,bytes);return bytes.slice();};
      await prepareAndUploadNativeProductAssets({...current,readCurrent,readImage:file=>readPrivate('image',file),readOriginal:file=>readPrivate('legal',file),executeGroup:async args=>{
        const result=await execute(input.tab,input.identity,nativeAssetUploadPage,[args]);if(result?.ownedRecord)pageRecords.set(binding.packetDigest,copy(result.ownedRecord));return result;
      }});
    }
    if(input.retryCreateApproval&&(!nativeSha||input.method!=='POST'||input.path!=='/sr/draft/api/create'))fail('CREATE_RETRY_SCOPE','원본을 확인한 새 초안의 생성 재시도만 허용됩니다.');
    let verifiedBodyCanonical;
    if(input.retryCreateApproval){verifiedBodyCanonical=canonical(input.body);if(await digest(input.body)!==binding.preparedBodySha256)fail('CREATE_RETRY_BODY_CHANGED','원래 검토한 견적서와 재시도 본문이 다릅니다. 생성하지 않았습니다.');}
    const value=await execute(input.tab,input.identity,input.retryCreateApproval?singleDocumentRetryCreatePage:singleDocumentHubRequestPage,[{binding,method:input.method,path:input.path,...(input.body===undefined?{}:{body:input.body}),
      ...(input.retryCreateApproval?{retryCreateApproval:copy(input.retryCreateApproval),verifiedBodyCanonical}:{}),
      ...(input.operationId===undefined?{}:{operationId:input.operationId}),...(input.path.endsWith('/create')?{baselineDocIds:input.retryCreateApproval?copy(input.baselineDocIds):baselines.get(binding.packetDigest)??[]}:{})}]);
    if(input.retryCreateApproval&&value?.createRetryFailure){const failed=value.createRetryFailure;
      if(!failed||Object.keys(failed).sort().join(',')!=='canContinue,dispatched,format,identityDigest,operationId,packetDigest,phase,requestId'||failed.format!=='yoofam-create-retry-failure-v1'
        ||failed.requestId!==binding.requestId||failed.operationId!==input.operationId||failed.packetDigest!==binding.packetDigest||failed.identityDigest!==binding.identityDigest
        ||!['scope','baseline-input','body-shape','body-match','list-unfinished','list-requested','duplicate','baseline','final-scope','create'].includes(failed.phase)
        ||typeof failed.dispatched!=='boolean'||typeof failed.canContinue!=='boolean'||failed.canContinue&&failed.dispatched)fail('CREATE_RETRY_UNCONFIRMED','재시도 전 확인 응답의 원래 요청 연결을 검증하지 못했습니다.');
      const labels={scope:'승인·회사·탭','baseline-input':'원래 기준 식별값','body-shape':'원래 본문·옵션 구조','body-match':'검증한 원래 본문','list-unfinished':'중간저장 목록','list-requested':'제출요청 목록',duplicate:'동일 상품 문서',baseline:'원래 중간저장 기준','final-scope':'최종 탭·회사',create:'생성 응답'};
      fail(failed.canContinue?'CREATE_RETRY_PRECHECK_NOT_SENT':failed.dispatched?'CREATE_RETRY_ACK_UNCERTAIN':'CREATE_RETRY_PRECHECK_BLOCKED',
        `재시도 ${labels[failed.phase]} 확인에서 중단했습니다. ${failed.canContinue?'이 확인에서는 생성 요청을 보내지 않았습니다. 같은 승인 범위로 준비를 이어갈 수 있습니다.':'생성을 반복하지 말고 원래 저장 결과를 확인해주세요.'}`);
    }
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
      ||!['UNFINISHED','REJECTED'].includes(document.status)||!Array.isArray(document.jsonDocument)||document.jsonDocument.length!==(wholeProduct?input.identity.members.length:1)
      ||document.scope!=='Retail_Categorized_Single')return null;
    const fields=['docId','productName','categoryPath','categoryId','displayCategoryCode','jsonDocument','scope','productNoticeNumber','version','remark'];
    const body=Object.fromEntries(fields.filter(key=>Object.hasOwn(document,key)).map(key=>[key,document[key]]));
    return {docId,company:copy(input.identity.company),identityDigest:binding.identityDigest,body,...(recovery?{readOnly:true,operationId:input.operationId}:{})};
  }
  async function inspectCreateRetry(input){
    if(!nativeSha||input.docId!==null||input.createRetryApproval?.attempt!==1||input.createRetryApproval.resumeUsed!==true)fail('CREATE_RETRY_SCOPE','원래 승인된 생성 확인 범위가 아닙니다.');
    const binding=await bindingFor(input.identity,input.sessionId);
    const record=await execute(input.tab,input.identity,singleDocumentOwnedRecordPage,[binding]);
    if(record)return null; // Existing attempt markers always use ordinary read recovery.
    const verifiedBodyCanonical=canonical(input.expectedBody);
    if(await digest(input.expectedBody)!==binding.preparedBodySha256)fail('CREATE_RETRY_BODY_CHANGED','원래 승인한 견적서와 현재 본문이 다릅니다.');
    const value=await execute(input.tab,input.identity,singleDocumentRetryCreatePage,[{binding,method:'POST',path:'/sr/draft/api/create',operationId:input.operationId,
      body:copy(input.expectedBody),baselineDocIds:copy(input.baselineDocIds),retryCreateApproval:copy(input.createRetryApproval),verifiedBodyCanonical,inspectOnly:true}]);
    const proof=value?.json?.retryPrecheck;
    if(value?.ok!==true||value.status!==200||!proof||Object.keys(proof).sort().join(',')!=='baselineMatched,checkedAt,duplicateMatches,format,identityDigest,markerAbsent,operationId,packetDigest,preparedBodySha256,remoteWrites,requestId'
      ||proof.format!=='yoofam-create-retry-precheck-v1'||proof.requestId!==binding.requestId||proof.operationId!==input.operationId
      ||proof.packetDigest!==binding.packetDigest||proof.identityDigest!==binding.identityDigest||proof.preparedBodySha256!==binding.preparedBodySha256
      ||proof.markerAbsent!==true||proof.baselineMatched!==true||proof.duplicateMatches!==0||proof.remoteWrites!==false||!Number.isSafeInteger(proof.checkedAt)||Math.abs(now()-proof.checkedAt)>60000)
      fail('CREATE_RETRY_INSPECTION_BLOCKED','원래 생성 요청의 본문·생성 기록·중복 목록 확인을 통과하지 못했습니다. 새 문서를 만들지 않았습니다.');
    return copy(proof);
  }
  async function qualifyPreparedDraft(input){
    if(!nativeSha)fail('NATIVE_PREPARED_UNCONFIRMED','원본 파일을 확인한 새 문서만 등록 단계를 확인할 수 있습니다.');
    const {binding,record}=await owned(input),sourcePlan=sourceBindings.get(canonical(input.identity))?.nativeSourcePlan;mutable(input.identity);
    if(!sourcePlan||!['updated','validated'].includes(record.state)||record.updateOperationId!==binding.requestId+':update'||record.nativeAssets?.state!=='complete')fail('NATIVE_PREPARED_UNCONFIRMED','원래 새 문서의 저장·원본 업로드 완료 기록을 확인해주세요.');
    const target={docId:record.docId,requestId:binding.requestId,packetDigest:binding.packetDigest,preparedBodySha256:binding.preparedBodySha256,createOperationId:record.createOperationId,baselineDocIds:copy(record.baselineDocIds)},
      plan={format:'yoofam-native-asset-upload-plan-v1',identity:copy(sourcePlan.identity),identityDigest:sourcePlan.identityDigest,target,images:copy(sourcePlan.images),nativeLegalAttachmentPlan:sourcePlan.nativeLegalAttachmentPlan?copy(sourcePlan.nativeLegalAttachmentPlan):null,planSha256:null,registered:false,remoteWrites:false,submissionReady:false,transportReady:false};
    plan.planSha256=await nativeAssetUploadPlanSha256(plan);
    const observation=await execute(input.tab,input.identity,nativeAssetRecoveryPage,[{binding,target,plan},true]);
    const expectedGroups=[...['MAIN','ADDITIONAL','SIZECHART','LABEL','DETAIL'].filter(type=>plan.images.some(file=>file.imageType===type)).map(type=>({key:'image:'+type,kind:'image',files:plan.images.filter(file=>file.imageType===type)})),
      ...(plan.nativeLegalAttachmentPlan?.groups??[]).map(group=>({key:'legal:'+group.nativeType,kind:'legal',files:plan.nativeLegalAttachmentPlan.files.filter(file=>file.nativeType===group.nativeType)}))];
    if(!observation||observation.format!=='yoofam-native-prepared-files-v1'||observation.requestId!==binding.requestId||!equal(observation.docId,record.docId)||observation.packetDigest!==binding.packetDigest||observation.identityDigest!==binding.identityDigest
      ||observation.sourcePlanSha256!==nativeSha||observation.planSha256!==plan.planSha256||observation.readOnly!==true||observation.ledgerMutated!==false||observation.unresolved!==false||observation.canContinue!==false
      ||['remoteWrites','actualUploadVerified','remoteBytesVerified','registered'].some(key=>observation[key]!==false)||!Number.isSafeInteger(observation.observedAt)||Math.abs(now()-observation.observedAt)>60000||!Array.isArray(observation.groups)||observation.groups.length!==expectedGroups.length)fail('NATIVE_PREPARED_UNCONFIRMED','원래 문서의 현재 파일 목록과 업로드 응답이 다릅니다.');
    for(let index=0;index<expectedGroups.length;index++){const expected=expectedGroups[index],group=observation.groups[index];
      if(group?.groupKey!==expected.key||group.operationId!==binding.requestId+':assets:'+expected.key||group.requestState!=='observed'||group.state!=='metadata-current'
        ||!equal(group.expectedFiles,expected.files.map(file=>({transportName:file.transportName,sha256:file.sha256,byteLength:file.byteLength,contentType:file.contentType}))))fail('NATIVE_PREPARED_UNCONFIRMED','새 문서의 역할별 원본 파일 연결이 다릅니다.');
      validateNativeAssetUploadDescriptors(group.listedFiles,{kind:expected.kind,expectedFiles:expected.files});
    }
    const after=await owned(input);if(!equal(after.record,record)||!equal(sourceBindings.get(canonical(input.identity))?.nativeSourcePlan,sourcePlan))fail('NATIVE_PREPARED_UNCONFIRMED','파일 조회 중 원래 새 문서·원본이 변경되었습니다.');
    return {readOnly:true,docId:record.docId,company:copy(input.identity.company),identityDigest:binding.identityDigest,packetDigest:binding.packetDigest,sourcePlanSha256:nativeSha,metadataObserved:true,checkedAt:observation.observedAt};
  }
  return Object.freeze({readSource,
    qualifyPreparedDraft,...(nativeSha?{inspectCreateRetry}:{}),
    createTarget:async input=>{
      const binding=await bindingFor(input.identity);
      mutable(input.identity);
      if(binding.requestId!==input.requestId||binding.packetDigest!==input.packetDigest)fail('SOURCE_CHANGED','원래 새 탭 생성 요청을 확인해주세요.');
      return createSingleOwnedTarget(api,binding);
    },readTab,hubRequest,readDocument:input=>readDocument(input),recoverWrite:input=>readDocument(input,true),
    readValidation:async input=>{const {record}=await owned(input),observation=record.validation?.[input.step];return observation?.state==='observed'&&observation.operationId===input.operationId
      ?{readOnly:true,operationId:input.operationId,docId:record.docId,company:copy(input.identity.company),step:input.step,response:observation.response}:null;},
    navigate:async input=>{
      const {binding,record}=await owned(input);if(!equal(record.docId,input.docId))fail('NAVIGATION','원래 새 문서만 불러올 수 있습니다.');
      mutable(input.identity);
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
        if(liveWatches.has(input.tab.tabId))fail('NAVIGATION','이 탭의 이전 관찰을 보존했습니다. 새로 불러오지 않았습니다.');
        let entry;
        const watch=createSingleDocumentWatch({api,tabId:input.tab.tabId,windowId:input.identity.windowId,documentId,docId:input.docId,packetDigest:binding.packetDigest,identityDigest:binding.identityDigest,company:input.identity.company,now,
          onInvalid:()=>{if(entry?.ready)api.scripting.executeScript({target:{tabId:input.tab.tabId,documentIds:[documentId]},func:singleDocumentWatchPage,args:[{...entry.page,action:'invalid'}]}).catch(()=>{});}});
        const status=watch.getStatus();entry={watch,expected:{tabId:input.tab.tabId,windowId:input.identity.windowId,frameId:0,documentId,docId:input.docId,packetDigest:binding.packetDigest,identityDigest:binding.identityDigest,company:copy(input.identity.company),token:watch.token},page:{binding,docId:input.docId,documentId,token:watch.token,expiresAt:status.expiresAt},ready:false};
        liveWatches.set(input.tab.tabId,entry);
        let observed;try{observed=await observeSingleDraftLoad({api,tabId:input.tab.tabId,documentId,docId:input.docId},()=>execute(input.tab,input.identity,singleDocumentLoadPage,[{...base,action:'load'}],documentId));}catch(error){watch.invalid('load-unconfirmed');throw error;}
        if(observed.loaded?.loaded!==true||!equal(observed.loaded.docId,input.docId))fail('NAVIGATION','새 문서 화면의 불러오기를 확인하지 못했습니다.');
        await bindingFor(input.identity,input.sessionId);
        const readback=await readDocument(input);
        // Repeat the receiver's exact-body check after the page's own loader;
        // replacing only the server-assigned ID restores the prepared body.
        const body=readback?.body?copy(readback.body):null;if(!body)fail('READBACK_UNCONFIRMED','불러온 새 문서의 본문을 확인하지 못했습니다.');body.docId=null;
        if(await digest(body)!==binding.preparedBodySha256)fail('READBACK_UNCONFIRMED','불러오는 동안 새 문서 본문이 변경되었습니다.');
        await execute(input.tab,input.identity,singleDocumentLoadPage,[{...base,action:'confirm',observation:observed.observation}],documentId);
        await execute(input.tab,input.identity,singleDocumentWatchPage,[{...entry.page,action:'arm'}],documentId);entry.ready=true;
      }
      await bindingFor(input.identity,input.sessionId);return execute(input.tab,input.identity,singleDocumentNavigatePage,[{binding,docId:input.docId,productName:input.productName,stageConsents:input.stageConsents??[]}]);
    },
    readNavigation:async input=>{const {binding}=await owned(input);return execute(input.tab,input.identity,singleDocumentNavigationReadPage,[{binding,docId:input.docId,productName:input.productName,stageConsents:input.stageConsents??[]}]);},
    readStageAgreements:async input=>{const {binding}=await owned(input);return execute(input.tab,input.identity,singleDocumentStageAgreementPage,[{binding,docId:input.docId,stage:input.stage,action:'read'}]);},
    confirmStageAgreements:async input=>{const {binding}=await owned(input);mutable(input.identity);return execute(input.tab,input.identity,singleDocumentStageAgreementPage,[{binding,docId:input.docId,stage:input.stage,action:'confirm',challenge:input.challenge,confirmation:input.confirmation,operationId:input.operationId}]);},
    recoverStageConsent:async input=>{const {binding}=await owned(input);return execute(input.tab,input.identity,singleDocumentStageAgreementPage,[{binding,docId:input.docId,stage:input.stage,action:'recover',challenge:input.challenge,operationId:input.operationId}]);},
    readAgreements:async input=>{const {binding}=await owned(input);return execute(input.tab,input.identity,singleDocumentAgreementPage,[{binding,docId:input.docId,action:'read'}]);},
    verifyHumanConfirmation:async input=>{
      const first=await bindingFor(input.identity),prior=sourceBindings.get(canonical(input.identity));
      mutable(input.identity);
      await appCurrent(input.identity);const response=await api.tabs.sendMessage(sourceAppTabId??input.identity.appTabId,{type:confirmationType,expected:{...copy(input),sourceExpected:copy(prior.input),sessionId:first.sessionId,identityDigest:first.identityDigest}},{frameId:0});await appCurrent(input.identity);
      const binding=await bindingFor(input.identity);
      return {confirmed:response?.ok===true&&response.userInitiated===true&&response.challengeId===input.challenge.id&&response.identityDigest===binding.identityDigest
        &&first.sessionId===binding.sessionId&&Number.isSafeInteger(response.checkedAt)&&Math.abs(now()-response.checkedAt)<=5000,challengeId:input.challenge.id,identityDigest:binding.identityDigest,confirmedAt:response.checkedAt};
    },
    confirmAgreements:async input=>{const {binding}=await owned(input);mutable(input.identity);return execute(input.tab,input.identity,singleDocumentAgreementPage,[{binding,docId:input.docId,action:'confirm',challenge:input.challenge,confirmation:input.confirmation}]);},
    submit:async input=>{const {binding}=await owned(input);mutable(input.identity);return execute(input.tab,input.identity,singleDocumentSubmitPage,[{binding,docId:input.docId,operationId:input.operationId,challenge:input.challenge,expectedBody:input.expectedBody}]);},
    observeReceipt:async input=>{
      const {binding,record}=await owned(input),proof=record.submitProof,entry=liveWatches.get(input.tab.tabId),freshRead=sourceBindings.get(canonical(input.identity))?.readOnlyReceipt===true&&!entry,
        documentId=freshRead?record.loadObservation?.documentId:entry?.expected.documentId;
      if(!proof||record.submitOperationId!==input.operationId||proof.operationId!==input.operationId||input.operationId!==binding.requestId+':submit'||!equal(proof.docId,input.docId)
        ||proof.identityDigest!==binding.identityDigest||proof.preparedBodySha256!==binding.preparedBodySha256||input.identityDigest!==binding.identityDigest||input.preparedBodySha256!==binding.preparedBodySha256
        ||!Number.isSafeInteger(input.submitRequestedAt)||input.submitRequestedAt<1||!Number.isSafeInteger(proof.requestedAt)||proof.requestedAt<input.submitRequestedAt||proof.requestedAt>now()+5000
        ||proof.productName!==input.expectedBody?.productName||proof.categoryPath!==input.expectedBody?.categoryPath||proof.version!==input.expectedBody?.version||(!freshRead&&!entry?.ready)||typeof documentId!=='string')fail('RECEIPT_UNCONFIRMED','원래 새 문서의 제출 요청 기록을 확인하지 못했습니다. 다시 제출하지 않았습니다.');
      const response=await execute(input.tab,input.identity,singleDocumentHubRequestPage,[{binding,method:'GET',path:'/sr/draft/api/drafts/register-requested',operationId:input.operationId,...(freshRead?{readOnlyReceipt:true}:{})}],documentId);
      const after=await owned(input);if(freshRead){if(!equal(after.record.submitProof,proof)||!equal(after.record.loadObservation,record.loadObservation))fail('RECEIPT_UNCONFIRMED','조회 중 원래 제출·브라우저 문서 연결이 변경되었습니다.');}else requireWatch(entry);const observedAt=now();
      return normalizeSingleReceipt({response:{ok:response?.ok,status:response?.status,json:response?.json},expected:{docId:input.docId,ownedDocId:record.docId,baselineDocIds:record.baselineDocIds,productName:proof.productName,categoryPath:proof.categoryPath,
        company:copy(input.identity.company),identityDigest:binding.identityDigest,preparedBodySha256:binding.preparedBodySha256,tabId:input.tab.tabId,windowId:input.identity.windowId,documentId,operationId:input.operationId,submitRequestedAt:input.submitRequestedAt},
        provenance:{...response?.receiptProvenance,tabId:input.tab.tabId,windowId:input.identity.windowId,documentId},observedAt,...(input.previousReceipt?{previousReceipt:input.previousReceipt}:{})});
    },
    dispose:()=>{for(const [tabId,entry] of liveWatches){entry.watch.close();if(entry.ready)api.scripting.executeScript({target:{tabId,documentIds:[entry.expected.documentId]},func:singleDocumentWatchPage,args:[{...entry.page,action:'close'}]}).catch(()=>{});}liveWatches.clear();},
  });
}
