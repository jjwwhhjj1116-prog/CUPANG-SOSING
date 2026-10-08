'use client';
import {useEffect,useRef,useState} from 'react';
import type {SupplierHubReceipt} from '@/app/supplier-hub-receipt';
import {getHistoricalSupplierHubResult,type SupplierHubResult} from '@/app/supplier-hub-handoff';

export function HistoricalSupplierHubResult({productId,receipt,onSaved}:{productId:string;receipt:SupplierHubReceipt;onSaved?:()=>void}){
  const [result,setResult]=useState<SupplierHubResult>(receipt.result),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const active=useRef<AbortController|null>(null);
  useEffect(()=>()=>active.current?.abort(),[]);
  async function read(registration:boolean){
    if(active.current)return;const controller=new AbortController();active.current=controller;setBusy(true);setError('');
    try{
      const found=await getHistoricalSupplierHubResult(productId,{...receipt,result},controller.signal,registration);if(controller.signal.aborted)return;
      setResult(found);
      const response=await fetch(`/api/products/${encodeURIComponent(productId)}/supplier-hub-receipt`,{method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},
        body:JSON.stringify({action:'observe-history',profileId:receipt.profileId,categoryId:receipt.categoryId,fingerprint:receipt.fingerprint,result:found})});
      const body=await response.json() as {saved?:boolean;fingerprint?:string;error?:string};if(controller.signal.aborted)return;
      if(!response.ok||body.saved!==true||body.fingerprint!==receipt.fingerprint)throw Error(body.error||'원래 전송 결과 보관을 확인하지 못했습니다. Chrome 조회 결과는 유지됩니다.');
      onSaved?.();
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'원래 전송 결과를 확인하지 못했습니다.');}
    finally{if(active.current===controller){active.current=null;if(!controller.signal.aborted)setBusy(false);}}
  }
  return <section className="panel-stack" aria-label="원래 전송한 견적서 결과" aria-busy={busy}>
    <strong>이전 전송 · {receipt.result.company?.name} · 포함 옵션 {receipt.result.includedOptions}개</strong><small style={{overflowWrap:'anywhere'}}>{receipt.result.filename}</small>
    <p>견적서 ID: {result.quotationId||'아직 미표시'} · {result.status||result.state}</p>
    <button type="button" className="btn ghost" disabled={busy} onClick={()=>void read(false)}>원래 견적서 검증 결과 조회</button>
    <button type="button" className="btn ghost" disabled={busy||result.state!=='validation-complete'||!result.quotationId} onClick={()=>void read(true)}>원래 견적서 상품별 상태 조회</button>
    <small>현재 수정본은 유지합니다. 이전 견적서 조회는 첨부·동의·검증 재요청을 실행하지 않습니다.</small>
    {error&&<p role="alert">{error}</p>}
    {result.registration&&<div className="table-wrap"><table><thead><tr><th>상품명</th><th>SKU ID</th><th>상태</th><th>등록 진행 단계</th></tr></thead><tbody>{result.registration.rows.map((row,index)=><tr key={index}><td>{row.title}</td><td>{row.skuId}</td><td>{row.status}</td><td>{row.stage}</td></tr>)}</tbody></table></div>}
  </section>;
}
