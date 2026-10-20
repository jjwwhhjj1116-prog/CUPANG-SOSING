'use client';
import {useLayoutEffect,useRef,useState} from 'react';
import {readSupplierHubNativeRegistration,type NativeRegistrationObservation} from '@/app/supplier-hub-native-registration';
import {productReceiptCanonical,type ProductReceiptRecord} from '@/app/supplier-hub-product-receipt';

type Props={receipt:ProductReceiptRecord;disabled:boolean};
const statusLabels={INSPECTION:'검수 중',INSPECTION_COMPLETE:'검수 완료',REJECTION:'반려'};
/** WIMS rows belong to the original registration file. Their order does not
 * establish a relationship to the option order in the submitted document. */
export function SupplierHubNativeRegistration({receipt,disabled}:Props){
  const scope=productReceiptCanonical(receipt);
  return <NativeRegistrationScope key={`${scope}:${disabled?'disabled':'enabled'}`} receipt={receipt} disabled={disabled} scope={scope}/>;
}
function NativeRegistrationScope({receipt,disabled,scope}:Props&{scope:string}){
  const [result,setResult]=useState<{scope:string;value:NativeRegistrationObservation}|null>(null);
  const [error,setError]=useState<{scope:string;message:string}|null>(null),[busy,setBusy]=useState(false);
  const current=useRef({scope,disabled,mounted:true}),pending=useRef<AbortController|null>(null);
  useLayoutEffect(()=>{current.current={scope,disabled,mounted:true};});
  useLayoutEffect(()=>()=>{current.current.mounted=false;pending.current?.abort();pending.current=null;},[]);
  async function read(){
    if(!current.current.mounted||current.current.disabled||current.current.scope!==scope||pending.current)return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setResult(null);setError(null);
    const active=()=>current.current.mounted&&!current.current.disabled&&current.current.scope===scope
      &&pending.current===controller&&!controller.signal.aborted;
    try{
      const value=await readSupplierHubNativeRegistration(receipt,controller.signal);
      if(active())setResult({scope,value});
    }catch(cause){
      if(active())setError({scope,message:cause instanceof Error?cause.message:'상품별 접수 상태를 확인하지 못했습니다.'});
    }finally{
      if(pending.current===controller){pending.current=null;if(current.current.mounted)setBusy(false);}
    }
  }
  function cancel(){
    if(!current.current.mounted||current.current.scope!==scope)return;
    pending.current?.abort();pending.current=null;setBusy(false);setResult(null);setError(null);
  }
  const observation=!disabled&&result?.scope===scope?result.value:null;
  const message=!disabled&&error?.scope===scope?error.message:null;
  return <section aria-label="상품별 접수 상태" aria-busy={busy}>
    <div className="quote-actions"><button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void read()}>상품별 접수 상태 조회</button>
      {busy&&<button type="button" className="btn ghost" disabled={disabled} onClick={cancel}>조회 취소</button>}</div>
    {message&&<p role="alert">{message}</p>}
    {observation&&<>
      <p role="status">등록 파일의 상품 {observation.total}건 · 조회한 페이지 {observation.pagesRead}개</p>
      {observation.rows.length>0?<table><caption>Supplier Hub 상품별 접수 결과</caption>
        <thead><tr><th scope="col">견적서 번호</th><th scope="col">SKU 번호</th><th scope="col">상품명</th><th scope="col">처리 상태</th></tr></thead>
        <tbody>{observation.rows.map((row,index)=><tr key={`${row.quotationId}:${row.skuId??'pending'}:${index}`}>
          <td>{row.quotationId}</td><td>{row.skuId??'미발급'}</td><td>{row.productName}</td><td>{statusLabels[row.status]}</td>
        </tr>)}</tbody></table>:<p>이 등록 파일에 연결된 상품 접수 결과가 아직 없습니다.</p>}
      <p>등록 파일 단위 조회 결과입니다. 원래 옵션과의 개별 연결은 확인 전입니다.</p>
    </>}
  </section>;
}
