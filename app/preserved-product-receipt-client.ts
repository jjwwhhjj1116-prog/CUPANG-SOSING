import {readSingleCatalogContext} from '@/app/supplier-hub-single-client';
import {exchange} from '@/app/supplier-hub-handoff';
import {parseStoredProductReceipt,productReceiptCanonical,type ProductReceiptRecord} from '@/app/supplier-hub-product-receipt';
import {validateHistoricalProductReceiptCandidate,validateHistoricalProductReceiptTarget,type HistoricalReceiptCurrentSource} from '../extensions/supplier-hub/preserved-product-receipt.mjs';

export type PreservedProductReceiptSelection={requestId:string;productId:string;docId:string|number;qvtRequestId:string|number};
const ORIGINS=['https://sourceflow.jjwwhhjj1116.workers.dev','http://localhost:3000','http://127.0.0.1:3000'];
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const exact=(value:unknown,keys:readonly string[]):value is Record<string,unknown>=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const same=(left:unknown,right:unknown)=>productReceiptCanonical(left)===productReceiptCanonical(right);
const active=(signal:AbortSignal)=>{if(signal.aborted)throw Error('원래 문서의 접수 동기화를 취소했습니다. 저장 여부는 이력에서 확인해주세요.');};

/** Explicit receipt-only lookup followed by one local evidence import. The
 * extension keeps the original private request and reads official JSON; this
 * client has no create, upload, update, consent, resume or Hub-submit action. */
export async function syncPreservedProductReceipt(selection:PreservedProductReceiptSelection,ownerId:string,signal:AbortSignal):Promise<ProductReceiptRecord>{
  const origin=window.location.origin;
  if(!ORIGINS.includes(origin)||!/^[\w-]{1,100}$/.test(ownerId))throw Error('원래 YOOFAM 회원 작업 창에서 접수 기록을 확인해주세요.');
  active(signal);const selected=JSON.parse(productReceiptCanonical(selection)) as PreservedProductReceiptSelection;
  const before=await readSingleCatalogContext(signal);active(signal);
  if(before.ownerId!==ownerId)throw Error('로그인 회원이 변경됐습니다. 원래 문서의 접수 기록을 다시 확인해주세요.');
  const target=validateHistoricalProductReceiptTarget({...selected,company:before.company});
  const assertCurrent=async()=>{active(signal);const after=await readSingleCatalogContext(signal);active(signal);
    if(after.ownerId!==ownerId||!same(after,before))throw Error('접수 조회 중 로그인 회원·회사가 변경되었습니다. 이전 결과를 적용하지 않았습니다.');};
  try{
  const capability=await exchange('PING',null,signal);active(signal);
  const version=capability.version;
  if(typeof version!=='string'||!/^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){2}$/.test(version)||version.split('.').some(part=>Number(part)>65535)
    ||capability.preservedProductReceiptReconciliation!==true||version.localeCompare('2.1.77','en',{numeric:true})<0)
    throw Error('원래 접수 동기화를 지원하는 YOOFAM 확장 2.1.77 이상으로 새로고침하고 웹도 새로고침해주세요. 새 전송은 요청하지 않았습니다.');
  await assertCurrent();
  const result=await new Promise<unknown>((resolve,reject)=>{
    active(signal);const requestId=crypto.randomUUID();
    const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);signal.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(Error('원래 접수 조회를 취소했습니다. 새 전송은 요청하지 않았습니다.'));};
    const receive=(event:MessageEvent)=>{
      if(event.source!==window||event.origin!==origin||event.data?.channel!=='YOOFAM_HUB_HANDOFF_RESULT'||event.data.requestId!==requestId)return;
      cleanup();const envelope=event.data.result;
      if(!object(envelope)||envelope.ok!==true||!Object.hasOwn(envelope,'result'))reject(Error(typeof envelope?.error==='string'&&envelope.error.length<=2000?envelope.error:'원래 문서의 공식 접수 결과를 읽지 못했습니다.'));
      else resolve(envelope.result);
    };
    const timer=setTimeout(()=>{cleanup();reject(Error('원래 접수 조회의 확장 응답 시간이 초과됐습니다. 새 전송 없이 연결 상태를 확인해주세요.'));},120000);
    window.addEventListener('message',receive);signal.addEventListener('abort',abort,{once:true});
    try{window.postMessage({channel:'YOOFAM_HUB_HANDOFF',requestId,type:'PRESERVED_PRODUCT_RECEIPT',payload:{action:'reconcile',target}},origin);}
    catch{cleanup();reject(Error('원래 접수 조회 요청을 확장에 전달하지 못했습니다.'));}
  });
  await assertCurrent();productReceiptCanonical(result);
  if(!object(result)||!object(result.anchor)||!object(result.anchor.currentSource))throw Error('원래 접수 조회의 저장 원천을 확인하지 못했습니다.');
  const candidate=await validateHistoricalProductReceiptCandidate(result,{scope:{origin,ownerId,company:before.company},currentSource:result.anchor.currentSource as HistoricalReceiptCurrentSource});
  if(!same(candidate.anchor.target,target))throw Error('선택한 원래 요청·문서·등록 파일과 접수 조회 결과가 다릅니다.');
  await assertCurrent();
  const endpoint=`/api/products/${encodeURIComponent(target.productId)}/supplier-hub-product-history-import`;
  // This is the only POST, and it records local receipt evidence. A missing
  // response never retries either the import or the original Hub operation.
  const response=await fetch(endpoint,{method:'POST',signal,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({action:'import-history',candidate})});
  active(signal);let body:unknown;
  try{if(response.redirected||response.url!==origin+endpoint||!/^application\/json(?:\s*;[^\r\n]*)?$/i.test(response.headers.get('content-type')??''))throw Error();
    const text=await response.text();if(new TextEncoder().encode(text).length>512*1024)throw Error();body=JSON.parse(text);
  }catch{throw Error('접수 이력 저장 응답을 확인하지 못했습니다. 다시 전송하지 말고 보관된 이력을 조회해주세요.');}
  await assertCurrent();
  if(!response.ok||!exact(body,['format','receipt','remoteWrites','canResume'])||body.format!=='yoofam-historical-product-receipt-import-v1'||body.remoteWrites!==false||body.canResume!==false)
    throw Error(object(body)&&typeof body.error==='string'&&body.error.length<=2000?body.error:'원래 접수 결과의 보관을 확인하지 못했습니다. 새 전송 없이 이력을 확인해주세요.');
  const saved=parseStoredProductReceipt(body.receipt),anchor=candidate.anchor;
  if(saved.productId!==target.productId||saved.requestId!==target.requestId||saved.docId!==target.docId||saved.receipt.qvtRequestId!==target.qvtRequestId||!same(saved.company,before.company)
    ||!same(saved.identity,anchor.identity)||saved.identityDigest!==anchor.identityDigest||saved.packetDigest!==anchor.packetDigest||saved.originalBodySha256!==anchor.originalBodySha256||saved.preparedBodySha256!==anchor.preparedBodySha256
    ||saved.receipt.observedAt<candidate.receipt.observedAt||candidate.receipt.state==='accepted'&&saved.receipt.state==='pending'||candidate.receipt.state==='rejected'&&saved.receipt.state!=='rejected')
    throw Error('보관된 접수 결과가 원래 요청·문서·등록 파일과 다릅니다. 새 전송 없이 이력을 확인해주세요.');
  active(signal);return saved;
  }catch(cause){await assertCurrent();throw cause;}
}
