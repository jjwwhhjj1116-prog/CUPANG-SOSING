import {SingleDocumentError} from './single-document.mjs';
import {normalizeRejectionDetails,receiptRejectionDetailsValid} from './rejection-details.mjs';

// REA retained Hub source: ev_7bccb57e05307a52efc7ae3b1f8a61f5f96ef3cd32e29faeaf569b4b78483157.
// getRequests [2868035,2868195), K4 [4153982,4159515), source SHA256
// 6fc9c0fae51702e62e2d1376ac8854d0d97c0035b0bf96afeb42069c2a5abe11.
// This is a read-only normalization contract, not a live verification flag.
export const SINGLE_RECEIPT_URL='https://supplier.coupang.com/sr/draft/api/drafts/register-requested';
const STATES=Object.freeze({SUBMITTED:'pending',REJECTED:'rejected',FINISHED:'accepted'});
const COMPANIES=Object.freeze({A01526306:'유앤채',A01464742:'와이홉'});
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail=(code,message)=>{throw new SingleDocumentError(code,message);};
function record(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  return (proto===Object.prototype||proto===null)&&Reflect.ownKeys(value).every(key=>typeof key==='string')
    &&Object.values(Object.getOwnPropertyDescriptors(value)).every(field=>Object.hasOwn(field,'value'));
}
const denseArray=(value,limit)=>Array.isArray(value)&&value.length<=limit&&Reflect.ownKeys(value).length===value.length+1
  &&Object.keys(value).length===value.length&&Object.keys(value).every((key,index)=>key===String(index))
  &&Object.values(Object.getOwnPropertyDescriptors(value)).every(field=>Object.hasOwn(field,'value'));
const identifier=value=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]|\.\.\.|…/.test(value)
  ||Number.isSafeInteger(value)&&value>0;
const clock=value=>Number.isSafeInteger(value)&&value>0;
const index=value=>Number.isSafeInteger(value)&&value>=0;
const company=value=>record(value)&&Object.keys(value).length===2&&Object.hasOwn(value,'code')&&Object.hasOwn(value,'name')
  &&typeof value.code==='string'&&typeof value.name==='string'&&Object.hasOwn(COMPANIES,value.code)&&COMPANIES[value.code]===value.name;
const sameCompany=(left,right)=>company(left)&&company(right)&&left.code===right.code&&left.name===right.name;
function exact(value,required,optional=[]){
  return record(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
}
function expectedValid(value){
  return exact(value,['docId','ownedDocId','baselineDocIds','productName','categoryPath','company','identityDigest','preparedBodySha256','tabId','windowId','documentId','operationId','submitRequestedAt'])
    &&identifier(value.docId)&&value.ownedDocId===value.docId&&denseArray(value.baselineDocIds,10000)&&value.baselineDocIds.every(identifier)
    // A native ID changing JSON type cannot make an old document newly owned.
    &&!value.baselineDocIds.some(id=>String(id)===String(value.docId))
    &&typeof value.productName==='string'&&value.productName.trim().length>0&&value.productName.length<=500
    &&typeof value.categoryPath==='string'&&value.categoryPath.trim().length>0&&value.categoryPath.length<=10000
    &&company(value.company)&&typeof value.identityDigest==='string'&&HASH.test(value.identityDigest)&&typeof value.preparedBodySha256==='string'&&HASH.test(value.preparedBodySha256)
    &&index(value.tabId)&&index(value.windowId)&&typeof value.documentId==='string'&&UUID.test(value.documentId)
    &&typeof value.operationId==='string'&&/^\w[\w-]{0,99}:submit$/.test(value.operationId)&&clock(value.submitRequestedAt);
}
function provenanceValid(value,expected){
  return exact(value,['method','url','status','redirected','contentType','cache','readOnly','docId','company','identityDigest','preparedBodySha256','tabId','windowId','documentId','operationId'])
    &&value.method==='GET'&&value.url===SINGLE_RECEIPT_URL&&value.status===200&&value.redirected===false
    &&typeof value.contentType==='string'&&/^application\/json(?:\s*;[^\r\n]*)?$/i.test(value.contentType.trim())
    &&value.cache==='no-store'&&value.readOnly===true&&value.docId===expected.docId&&sameCompany(value.company,expected.company)
    &&['identityDigest','preparedBodySha256','tabId','windowId','documentId','operationId'].every(key=>value[key]===expected[key]);
}
function previousValid(value,expected,observedAt){
  return exact(value,['state','docId','company','identityDigest','preparedBodySha256','observedAt','receiptId','evidence'],['registered','sourceStatus','qvtRequestId','rejectionDetails'])
    &&receiptRejectionDetailsValid(value)
    &&['pending','rejected','accepted'].includes(value.state)&&value.docId===expected.docId&&sameCompany(value.company,expected.company)
    &&value.identityDigest===expected.identityDigest&&value.preparedBodySha256===expected.preparedBodySha256&&clock(value.observedAt)&&value.observedAt>=expected.submitRequestedAt&&value.observedAt<=observedAt
    &&identifier(value.receiptId)&&value.evidence==='document-receipt'&&(value.registered===undefined||value.registered===false)
    &&(value.qvtRequestId===undefined||value.qvtRequestId===value.receiptId)
    &&(value.sourceStatus===undefined||typeof value.sourceStatus==='string'&&Object.hasOwn(STATES,value.sourceStatus)&&STATES[value.sourceStatus]===value.state);
}

/** Normalize only a fresh native GET response bound by the adapter to its
 * exact newly owned document and current source/company/browser context.
 * Provenance is a trusted adapter result; this pure helper cannot establish
 * network freshness or site execution itself. Company is copied from that
 * checked context, never inferred from or added to the native response row.
 * A registration-file receipt is not evidence of a catalog SKU relationship. */
export function normalizeSingleReceipt(input){
  if(!exact(input,['response','expected','provenance','observedAt'],['previousReceipt'])||!expectedValid(input.expected)||!clock(input.observedAt)||input.observedAt<input.expected.submitRequestedAt)
    fail('RECEIPT_UNCONFIRMED','새 문서의 원래 접수 조회 범위를 확인해주세요.');
  const {response,expected,provenance,observedAt,previousReceipt}=input;
  if(!provenanceValid(provenance,expected)||!exact(response,['ok','status','json'],['ownedRecord'])||response.ok!==true||response.status!==200)
    fail('RECEIPT_UNCONFIRMED','같은 회사·문서의 현재 접수 JSON 응답을 확인하지 못했습니다.');
  const rows=response.json;
  if(!denseArray(rows,10000)||rows.some(row=>!record(row)||!Object.hasOwn(row,'docId')||!identifier(row.docId)))
    fail('RECEIPT_UNCONFIRMED','등록 요청 목록의 원문 배열을 확인하지 못했습니다.');
  const keys=rows.map(row=>String(row.docId));
  if(new Set(keys).size!==keys.length)fail('RECEIPT_UNCONFIRMED','접수 목록의 문서 식별값이 중복되었습니다.');
  const matches=rows.filter(row=>row.docId===expected.docId);
  if(matches.length!==1)fail('RECEIPT_UNCONFIRMED','원래 새 문서의 현재 등록 요청을 확인하지 못했습니다.');
  const row=matches[0];
  if(row.productName!==expected.productName||row.categoryPath!==expected.categoryPath||typeof row.status!=='string'||!Object.hasOwn(STATES,row.status)||!identifier(row.qvtRequestId))
    fail('RECEIPT_UNCONFIRMED','새 문서의 상품명·카테고리·등록 파일 ID·상태를 확인해주세요.');
  if(previousReceipt!==undefined){
    if(!previousValid(previousReceipt,expected,observedAt))fail('RECEIPT_UNCONFIRMED','원래 확인한 접수 기록과 현재 조회 범위가 다릅니다.');
    if(previousReceipt.receiptId!==row.qvtRequestId||previousReceipt.state==='accepted'&&STATES[row.status]==='pending')
      fail('RECEIPT_CHANGED','원래 확인한 등록 파일 ID·완료 상태를 다른 조회로 바꿀 수 없습니다.');
  }
  return Object.freeze({state:STATES[row.status],docId:expected.docId,company:Object.freeze({code:expected.company.code,name:expected.company.name}),
    identityDigest:expected.identityDigest,preparedBodySha256:expected.preparedBodySha256,observedAt,receiptId:row.qvtRequestId,qvtRequestId:row.qvtRequestId,sourceStatus:row.status,evidence:'document-receipt',registered:false,
    ...(row.status==='REJECTED'?{rejectionDetails:normalizeRejectionDetails(row.remark)}:{})});
}
