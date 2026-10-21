'use client';

import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {QuotationFieldsView} from '@/app/quotation-schema';
import {readSingleCatalogContext} from '@/app/supplier-hub-single-client';
import {validOptionRegistrationNumbers} from '@/app/product-registration';
import {SupplierHubSingleReview} from '@/app/components/supplier-hub-single-review';
import {LegalDocumentsEditor} from '@/app/components/legal-documents-editor';
import {productRemovalDecision} from '@/app/product-removal-policy';
import {getSupplierHubProductHistory} from '@/app/supplier-hub-handoff';
import {productDocumentPendingKey,readProductDocumentPending,readProductDocumentRejections} from '@/app/supplier-hub-product-pending';

type Props={productId:string;profileId?:string;expectedCategoryId?:string;onReceiptSaved?:()=>void;onLockChange?:(locked:boolean,closeLocked?:boolean)=>void;disabled?:boolean};
const identifier=/^[A-Za-z0-9_-]{1,100}$/,hash=/^[a-f0-9]{64}$/;
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
function active(signal:AbortSignal){if(signal.aborted)throw Error('현재 상품 견적 확인을 취소했습니다.');}
async function readJson(path:string,signal:AbortSignal,request:typeof fetch):Promise<unknown>{
  active(signal);
  const response=await request(path,{method:'GET',cache:'no-store',credentials:'same-origin',redirect:'error',signal});active(signal);
  if(!response.ok||response.redirected||!response.headers.get('content-type')?.includes('application/json')
    ||response.url&&response.url!==window.location.origin+path)throw Error('현재 상품의 저장 자료를 확인하지 못했습니다.');
  const reader=response.body?.getReader();if(!reader)throw Error('현재 상품의 저장 자료가 비어 있습니다.');
  const chunks:Uint8Array[]=[];let length=0;const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{
    for(;;){active(signal);const part=await reader.read();active(signal);if(part.done)break;length+=part.value.byteLength;if(length>6*1024*1024)throw Error('현재 견적 자료가 처리 한도를 초과했습니다.');chunks.push(part.value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function productVersion(value:unknown,productId:string,ownerId:string):string{
  const product=object(value)&&object(value.product)?value.product:null;
  if(!product||product.id!==productId||product.owner_id!==ownerId||typeof product.updated_at!=='string'||!product.updated_at.trim())throw Error('현재 로그인한 회원의 상품 자료를 확인해주세요.');
  return product.updated_at;
}
function fields(value:unknown,props:Pick<Props,'profileId'|'expectedCategoryId'>,version:string):QuotationFieldsView{
  const view=value as QuotationFieldsView;
  const context=view?.categoryContext,rows=view?.resolved?.rows,schema=view?.resolved?.schema;
  if(!object(value)||!Number.isSafeInteger(view.revision)||view.revision<0||!hash.test(view.inputFingerprint)||view.productVersion!==version
    ||!Number.isSafeInteger(view.contentRevision)||view.contentRevision<0||!Number.isSafeInteger(view.optionRevision)||view.optionRevision<0||view.submissionReady!==false
    ||!context||!['profile','collection','unknown'].includes(context.source)||context.profileId!==null&&!identifier.test(context.profileId)
    ||typeof context.categoryId!=='string'||!context.categoryId||!Array.isArray(context.categoryPath)||!context.categoryPath.every(part=>typeof part==='string')
    ||props.profileId!==undefined&&context.profileId!==props.profileId||props.expectedCategoryId!==undefined&&context.categoryId!==props.expectedCategoryId
    ||!schema||schema.categoryId!==context.categoryId||JSON.stringify(schema.categoryPath)!==JSON.stringify(context.categoryPath)||schema.submissionReady!==false
    ||!view.automatic||view.automatic.schema?.categoryId!==context.categoryId||!object(view.overrides)||!object(view.overrides.common)||!object(view.overrides.options)
    ||!Array.isArray(view.imageKeys)||!view.imageKeys.every(key=>typeof key==='string')||!Array.isArray(rows)||!rows.length
    ||rows.some(row=>!object(row)||row.optionId!==null&&(typeof row.optionId!=='string'||!identifier.test(row.optionId))||typeof row.optionLabel!=='string'||typeof row.included!=='boolean'||!object(row.fields)
      ||Object.values(row.fields).some(field=>!object(field)||typeof field.value!=='string'))
    ||new Set(rows.map(row=>row.optionId)).size!==rows.length
    ||!validOptionRegistrationNumbers(view.optionRegistrationNumbers,rows.flatMap(row=>row.optionId===null?[]:[{id:row.optionId}])))throw Error('현재 상품의 카테고리·옵션·견적 연결을 다시 확인해주세요.');
  return view;
}
/** Read-only entry for the primary whole-product review. A captured category
 * stays queryless; a live saved profile is never silently substituted. */
export async function readSupplierHubProductSubmissionView(props:Pick<Props,'productId'|'profileId'|'expectedCategoryId'>,signal:AbortSignal,request:typeof fetch=fetch):Promise<QuotationFieldsView>{
  if(!identifier.test(props.productId)||props.profileId!==undefined&&!identifier.test(props.profileId)||props.expectedCategoryId!==undefined&&!props.expectedCategoryId)throw Error('확인할 상품과 카테고리를 다시 선택해주세요.');
  const productPath=`/api/products/${encodeURIComponent(props.productId)}`,path=productPath+'/quotation-fields'+(props.profileId?`?profileId=${encodeURIComponent(props.profileId)}`:'');
  active(signal);const before=await readSingleCatalogContext(signal,request);active(signal);
  const version=productVersion(await readJson(productPath,signal,request),props.productId,before.ownerId);
  const first=fields(await readJson(path,signal,request),props,version),snapshot=JSON.stringify(first);
  const next=fields(await readJson(path,signal,request),props,version);
  if(JSON.stringify(next)!==snapshot||productVersion(await readJson(productPath,signal,request),props.productId,before.ownerId)!==version)throw Error('확인 중 상품·옵션 또는 견적 저장값이 변경됐습니다. 최신 자료를 다시 확인해주세요.');
  const after=await readSingleCatalogContext(signal,request);active(signal);
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('확인 중 로그인한 회원 회사가 변경됐습니다. 최신 자료를 다시 확인해주세요.');
  return next;
}

/** Legal edits share the native product lock. Unknown/active history is never
 * permission to change the source of an already requested document. */
export async function readSupplierHubLegalEditScope(props:Pick<Props,'productId'|'profileId'|'expectedCategoryId'>,view:QuotationFieldsView,signal:AbortSignal,request:typeof fetch=fetch,history=getSupplierHubProductHistory){
  const actor=await readSingleCatalogContext(signal,request);active(signal);
  const value=await readJson(`/api/products/${encodeURIComponent(props.productId)}`,signal,request);
  productVersion(value,props.productId,actor.ownerId);
  if(!object(value)||!object(value.product)||productRemovalDecision(value.product).blocked)throw Error('전송 이력이 없거나 반려된 상품인지 확인한 뒤 서류를 수정해주세요. 처리 중·완료·미확인 전송의 원본은 유지합니다.');
  const scope={identity:{ownerId:actor.ownerId,company:actor.company,productId:props.productId}};
  const pending=()=>{readProductDocumentRejections(scope);if(readProductDocumentPending(scope))throw Error('이 상품의 원래 문서 전송 요청이 있습니다. 저장 결과를 확인하기 전에는 서류를 수정하지 않습니다.');};
  pending();
  const local=await history({productId:props.productId,categoryId:view.categoryContext.categoryId!,fingerprint:view.inputFingerprint},signal);active(signal);
  if(local.blocked)throw Error('Chrome에 이 상품의 전송 또는 미확정 시도가 있습니다. 원래 전송 결과를 먼저 확인해주세요.');
  const latest=await readSupplierHubProductSubmissionView(props,signal,request);
  const after=await readSingleCatalogContext(signal,request);active(signal);pending();
  if(JSON.stringify(actor)!==JSON.stringify(after)||JSON.stringify(latest)!==JSON.stringify(view))throw Error('회원 회사 또는 상품 견적이 변경되었습니다. 전체 상품 견적을 다시 확인해주세요.');
  return scope;
}

export function SupplierHubProductSubmission(props:Props){
  return <ProductSubmissionContent key={JSON.stringify([props.productId,props.profileId??null,props.expectedCategoryId??null,props.disabled===true])} {...props}/>;
}
function ProductSubmissionContent(props:Props){
  const {productId,profileId,expectedCategoryId,disabled}=props;
  const [view,setView]=useState<QuotationFieldsView|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [legalBusy,setLegalBusy]=useState(false),[nativeLocked,setNativeLocked]=useState(false),[legalNotice,setLegalNotice]=useState('');
  const [legalPolicy,setLegalPolicy]=useState<{view:QuotationFieldsView;blocked:boolean;message:string}|null>(null);
  const nativeToken=useMemo(()=>({view,disabled:props.disabled,legalBusy}),[view,props.disabled,legalBusy]),liveNativeToken=useRef(nativeToken);
  const nativeReports=useRef(new WeakMap<typeof nativeToken,{source:boolean;close:boolean}>()),retiredNativeTokens=useRef(new WeakSet<typeof nativeToken>());
  const current=useRef({mounted:true,props,view,legalBusy,nativeLocked}),pending=useRef<AbortController|null>(null),nativeCloseLocked=useRef(false);
  useLayoutEffect(()=>{const report=nativeReports.current.get(nativeToken);current.current={mounted:true,props,view,legalBusy,nativeLocked:report?.source??nativeLocked};if(report)nativeCloseLocked.current=report.close;});
  useLayoutEffect(()=>{if(liveNativeToken.current!==nativeToken)retiredNativeTokens.current.add(liveNativeToken.current);liveNativeToken.current=nativeToken;retiredNativeTokens.current.delete(nativeToken);
    const value=nativeReports.current.get(nativeToken)??{source:false,close:false};current.current.nativeLocked=value.source;nativeCloseLocked.current=value.close;
    current.current.props.onLockChange?.(current.current.legalBusy||value.source,current.current.legalBusy||value.close);
    void Promise.resolve().then(()=>{if(current.current.mounted&&liveNativeToken.current===nativeToken)setNativeLocked(nativeReports.current.get(nativeToken)?.source??false);});
  },[nativeToken]);
  const reportLock=useCallback(()=>{const value=current.current;if(value.mounted)value.props.onLockChange?.(value.legalBusy||value.nativeLocked,value.legalBusy||nativeCloseLocked.current);},[]);
  const nativeLock=useCallback((locked:boolean,closeLocked=locked)=>{if(!current.current.mounted||retiredNativeTokens.current.has(nativeToken))return;nativeReports.current.set(nativeToken,{source:locked,close:closeLocked});if(liveNativeToken.current!==nativeToken)return;current.current.nativeLocked=locked;nativeCloseLocked.current=closeLocked;setNativeLocked(locked);reportLock();},[reportLock,nativeToken]);
  const legalLock=useCallback((busy:boolean)=>{if(!current.current.mounted)return;current.current.legalBusy=busy;setLegalBusy(busy);reportLock();},[reportLock]);
  useLayoutEffect(()=>{reportLock();},[props.onLockChange,legalBusy,nativeLocked,reportLock]);
  useLayoutEffect(()=>()=>{current.current.mounted=false;pending.current?.abort();pending.current=null;current.current.props.onLockChange?.(false,false);},[]);
  useEffect(()=>{
    if(disabled)return;
    const controller=new AbortController();pending.current=controller;
    const alive=()=>current.current.mounted&&!current.current.props.disabled&&pending.current===controller&&!controller.signal.aborted;
    const timeout=setTimeout(()=>{if(!alive())return;setError('저장 자료의 응답이 늦습니다. 전체 상품 견적 다시 확인을 눌러 조회해주세요. 상품 전송은 실행하지 않았습니다.');controller.abort();},30000);
    void readSupplierHubProductSubmissionView({productId,profileId,expectedCategoryId},controller.signal,fetch).then(result=>{if(alive())setView(result);}).catch(cause=>{if(alive())setError(cause instanceof Error?cause.message:'전체 상품 견적을 읽지 못했습니다.');}).finally(()=>clearTimeout(timeout));
    return()=>{clearTimeout(timeout);controller.abort();if(pending.current===controller)pending.current=null;};
  },[productId,profileId,expectedCategoryId,disabled,attempt]);
  useEffect(()=>{
    if(!view||disabled)return;
    const controller=new AbortController(),timeout=setTimeout(()=>{if(!controller.signal.aborted){setLegalPolicy({view,blocked:true,message:'서류 편집 전 전송 이력 응답이 늦습니다. 전체 상품 견적 다시 확인으로 재조회해주세요.'});controller.abort();}},30000);
    void readSupplierHubLegalEditScope({productId,profileId,expectedCategoryId},view,controller.signal).then(()=>{if(!controller.signal.aborted)setLegalPolicy({view,blocked:false,message:''});}).catch(cause=>{if(!controller.signal.aborted)setLegalPolicy({view,blocked:true,message:cause instanceof Error?cause.message:'서류 편집 전 전송 이력을 확인하지 못했습니다.'});}).finally(()=>clearTimeout(timeout));
    return()=>{controller.abort();clearTimeout(timeout);};
  },[view,disabled,productId,profileId,expectedCategoryId]);
  async function guardLegalWrite(run:()=>Promise<Response>,signal:AbortSignal){
    const saved=current.current.view;
    const allowed=()=>current.current.mounted&&!current.current.props.disabled&&!current.current.nativeLocked&&current.current.view===saved&&saved!==null;
    if(!saved||!allowed())throw Error('현재 견적 전송 작업을 마친 뒤 서류를 수정해주세요.');
    const scope=await readSupplierHubLegalEditScope({productId,profileId,expectedCategoryId},saved,signal);
    const locks=window.navigator?.locks;if(!locks||typeof locks.request!=='function')throw Error('원본 서류 편집 잠금을 확인하지 못했습니다.');
    return locks.request(productDocumentPendingKey(scope),{mode:'exclusive',signal},async()=>{
      if(!allowed())throw Error('현재 상품의 서류 편집이 변경되었습니다.');
      await readSupplierHubLegalEditScope({productId,profileId,expectedCategoryId},saved,signal);
      active(signal);if(!allowed())throw Error('현재 상품의 서류 편집이 변경되었습니다.');
      return run();
    });
  }
  function legalSettled(message?:string){
    if(!current.current.mounted||current.current.props.disabled)return;
    current.current.view=null;setView(null);setLegalPolicy(null);setLegalNotice(message||'서류를 저장했습니다. 최신 서류와 견적 자료를 다시 확인합니다.');setAttempt(value=>value+1);
  }
  const ready=Boolean(view&&!props.disabled);
  return <section className="panel-stack" aria-label="전체 상품 견적 등록 준비" aria-busy={!props.disabled&&!view&&!error}>
    <h4>전체 상품 견적 등록</h4>
    <p>저장한 포함 옵션을 견적 문서 하나로 확인합니다. 회사·카테고리와 전체 옵션을 검토한 뒤 전송을 진행하세요.</p>
    {props.disabled&&<p role="status">현재 작업을 마친 뒤 전체 상품 견적을 확인해주세요.</p>}
    {!props.disabled&&!view&&!error&&<p role="status">현재 회원 회사와 저장된 견적을 확인하고 있습니다.</p>}
    {error&&<p role="alert">{error}</p>}
    {legalNotice&&<p role="status">{legalNotice}</p>}
    {(error||legalPolicy?.blocked)&&<button type="button" className="btn ghost" disabled={props.disabled||legalBusy||nativeLocked} onClick={()=>{if(!current.current.mounted||current.current.props.disabled||current.current.legalBusy||current.current.nativeLocked)return;pending.current?.abort();current.current.view=null;setView(null);setError('');setAttempt(value=>value+1);}}>전체 상품 견적 다시 확인</button>}
    {ready&&view&&<>
      <LegalDocumentsEditor productId={productId} disabled={Boolean(props.disabled||nativeLocked||legalPolicy?.view!==view||legalPolicy.blocked)} onSaved={()=>{}} onBusyChange={legalLock} guardWrite={guardLegalWrite} onMutationSettled={legalSettled}/>
      {legalPolicy?.view===view&&legalPolicy.message&&<p role="status">{legalPolicy.message}</p>}
      <small>필수 원본 서류는 여기서 확인·수정할 수 있습니다. 필수 서류가 있는 상품의 개별 문서 전송은 아직 검수 중이며, 서류 저장만으로 전송되지 않습니다.</small>
      <SupplierHubSingleReview primaryProduct productId={props.productId} profileId={props.profileId} view={view} disabled={legalBusy} onLockChange={nativeLock} onReceiptSaved={()=>{if(current.current.mounted&&!current.current.props.disabled&&current.current.view===view)current.current.props.onReceiptSaved?.();}}/>
    </>}
  </section>;
}
