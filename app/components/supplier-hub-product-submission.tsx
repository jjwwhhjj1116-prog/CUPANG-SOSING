'use client';

import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {QuotationFieldsView} from '@/app/quotation-schema';
import {SupplierHubSingleReview} from '@/app/components/supplier-hub-single-review';
import {LegalDocumentsEditor} from '@/app/components/legal-documents-editor';
import {guardSupplierHubLegalWrite,readSupplierHubLegalEditScope,readSupplierHubProductSubmissionView} from '@/app/supplier-hub-legal-edit-scope';
export {readSupplierHubLegalEditScope,readSupplierHubProductSubmissionView} from '@/app/supplier-hub-legal-edit-scope';

type Props={productId:string;profileId?:string;expectedCategoryId?:string;onReceiptSaved?:()=>void;onLockChange?:(locked:boolean,closeLocked?:boolean)=>void;disabled?:boolean};
export function SupplierHubProductSubmission(props:Props){
  return <ProductSubmissionContent key={JSON.stringify([props.productId,props.profileId??null,props.expectedCategoryId??null,props.disabled===true])} {...props}/>;
}
function ProductSubmissionContent(props:Props){
  const {productId,profileId,expectedCategoryId,disabled}=props;
  const [view,setView]=useState<QuotationFieldsView|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const [legalBusy,setLegalBusy]=useState(false),[nativeLocked,setNativeLocked]=useState(false),[legalNotice,setLegalNotice]=useState('');
  const [legalOpen,setLegalOpen]=useState(false);
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
    return guardSupplierHubLegalWrite({productId,profileId,expectedCategoryId},saved,run,signal,allowed);
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
      <LegalDocumentsEditor productId={productId} open={legalOpen} disabled={Boolean(props.disabled||nativeLocked||legalPolicy?.view!==view||legalPolicy.blocked)} onSaved={()=>{}} onBusyChange={legalLock} guardWrite={guardLegalWrite} onMutationSettled={legalSettled}/>
      {legalPolicy?.view===view&&legalPolicy.message&&<p role="status">{legalPolicy.message}</p>}
      <small>필수 원본 서류는 여기서 확인·수정할 수 있습니다. 필수 서류가 있는 상품의 개별 문서 전송은 아직 검수 중이며, 서류 저장만으로 전송되지 않습니다.</small>
      <SupplierHubSingleReview primaryProduct productId={props.productId} profileId={props.profileId} view={view} disabled={legalBusy} onReviewLegal={()=>{if(current.current.mounted&&!current.current.props.disabled&&!current.current.nativeLocked&&current.current.view===view)setLegalOpen(true);}} onSourceChanged={legalSettled} onLockChange={nativeLock} onReceiptSaved={()=>{if(current.current.mounted&&!current.current.props.disabled&&current.current.view===view)current.current.props.onReceiptSaved?.();}}/>
    </>}
  </section>;
}
