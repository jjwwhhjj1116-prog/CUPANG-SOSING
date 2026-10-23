'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {QuotationFieldsView} from '@/app/quotation-schema';
import {guardSupplierHubLegalWrite,readSupplierHubLegalEditScope} from '@/app/supplier-hub-legal-edit-scope';
import {LegalDocumentsEditor} from '@/app/components/legal-documents-editor';

type Props={productId:string;profileId?:string;view:QuotationFieldsView;disabled:boolean;onBusyChange:(busy:boolean)=>void;onMutationSettled:(error?:string)=>void};
/** Explicit legal review only. Opening this panel never declares applicability. */
export function SupplierHubLegalReview(props:Props){
 const [policy,setPolicy]=useState<{allowed:boolean;message:string}|null>(null),[attempt,setAttempt]=useState(0);
 const current=useRef({props,mounted:true}),pending=useRef<AbortController|null>(null);
 useLayoutEffect(()=>{current.current={props,mounted:true};});
 useLayoutEffect(()=>()=>{current.current.mounted=false;pending.current?.abort();pending.current=null;},[]);
 useEffect(()=>{
  if(props.disabled)return;
  const controller=new AbortController();pending.current=controller;
  const alive=()=>current.current.mounted&&pending.current===controller&&!controller.signal.aborted;
  const timeout=setTimeout(()=>{if(!alive())return;setPolicy({allowed:false,message:'서류 편집 전 전송 이력 응답이 늦습니다. 다시 확인해주세요.'});controller.abort();},30000);
  void readSupplierHubLegalEditScope({productId:props.productId,profileId:props.profileId,expectedCategoryId:props.view.categoryContext.categoryId??undefined},props.view,controller.signal)
   .then(()=>{if(alive())setPolicy({allowed:true,message:''});})
   .catch(cause=>{if(alive())setPolicy({allowed:false,message:cause instanceof Error?cause.message:'서류 편집 전 전송 이력을 확인하지 못했습니다.'});})
   .finally(()=>clearTimeout(timeout));
  return()=>{clearTimeout(timeout);controller.abort();if(pending.current===controller)pending.current=null;};
 },[props.productId,props.profileId,props.view,props.disabled,attempt]);
 async function guardWrite(run:()=>Promise<Response>,signal:AbortSignal){
  const allowed=()=>current.current.mounted&&!current.current.props.disabled&&current.current.props.view===props.view&&current.current.props.productId===props.productId&&current.current.props.profileId===props.profileId;
  return guardSupplierHubLegalWrite({productId:props.productId,profileId:props.profileId,expectedCategoryId:props.view.categoryContext.categoryId??undefined},props.view,run,signal,allowed);
 }
 return <section className="panel-stack" aria-label="현재 상품 법적 서류 확인">
  <p>실제 상품에 필요한 서류인지 확인한 뒤 직접 선택하세요. 카테고리나 견적 초안만으로 해당없음으로 저장하지 않습니다.</p>
  {!policy&&<p role="status">서류 편집 전 현재 회사·견적·전송 이력을 확인하고 있습니다.</p>}
  {policy&&!policy.allowed&&<><p role="alert">{policy.message}</p><button type="button" className="btn ghost" disabled={props.disabled} onClick={()=>{if(!current.current.mounted||current.current.props.disabled)return;setPolicy(null);setAttempt(value=>value+1);}}>서류 편집 가능 여부 다시 확인</button></>}
  <LegalDocumentsEditor productId={props.productId} disabled={props.disabled||!policy?.allowed} open onSaved={()=>{}} guardWrite={guardWrite}
   onBusyChange={value=>{if(current.current.mounted)current.current.props.onBusyChange(value);}}
   onMutationSettled={message=>{if(current.current.mounted&&!current.current.props.disabled&&current.current.props.view===props.view)current.current.props.onMutationSettled(message);}}/>
 </section>;
}
