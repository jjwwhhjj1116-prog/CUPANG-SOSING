'use client';
import {useLayoutEffect,useRef,useState} from 'react';
import type {QuotationFieldsView} from '@/app/quotation-schema';
import {singlePackageCurrent,type SinglePackageView} from '@/app/supplier-hub-single-client';

type Props={productId:string;profileId?:string;view:QuotationFieldsView;disabled:boolean};
export function SupplierHubSingleReview(props:Props){const {productId,profileId,view}=props;return <SingleReviewContent key={JSON.stringify([productId,profileId,view.productVersion,view.contentRevision,view.optionRevision,view.revision,view.inputFingerprint])} {...props}/>;}
function SingleReviewContent({productId,profileId,view,disabled}:Props){
  const [data,setData]=useState<SinglePackageView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const key=JSON.stringify([productId,profileId,view.productVersion,view.contentRevision,view.optionRevision,view.revision,view.inputFingerprint]);
  const current=useRef({key,view,disabled}),pending=useRef<AbortController|null>(null),generation=useRef(0);
  useLayoutEffect(()=>{current.current={key,view,disabled};return()=>{current.current.disabled=true;};},[key,view,disabled]);
  useLayoutEffect(()=>{const invalidate=()=>{generation.current++;pending.current?.abort();};return invalidate;},[key]);
  async function read(prepare=false){
    if(pending.current||current.current.disabled||prepare&&(!data||!data.review.canPrepare||!singlePackageCurrent(data,current.current.view,productId)))return;
    const controller=new AbortController(),sequence=++generation.current,sourceKey=current.current.key;pending.current=controller;setBusy(true);setError('');
    try{
      const url=`/api/products/${encodeURIComponent(productId)}/supplier-hub-single-package${profileId?`?profileId=${encodeURIComponent(profileId)}`:''}`;
      const response=await fetch(url,{cache:'no-store',signal:controller.signal,...(prepare?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'prepare',expectedFingerprint:data!.fingerprint})}:{})});
      const result=await response.json() as SinglePackageView&{error?:string};
      if(controller.signal.aborted||generation.current!==sequence||current.current.key!==sourceKey)return;
      if(!response.ok)throw Error(result.error||'개별 견적 자료를 확인하지 못했습니다.');
      if(!singlePackageCurrent(result,current.current.view,productId))throw Error('저장한 상품·카테고리가 바뀌었습니다. 최신 견적 입력을 확인해주세요.');
      setData(result);
    }catch(cause){if(!controller.signal.aborted&&generation.current===sequence){setData(null);setError(cause instanceof Error?cause.message:'개별 견적 자료 확인 실패');}}
    finally{if(generation.current===sequence){pending.current=null;setBusy(false);}}
  }
  return <section className="quotation-fields-notice" aria-label="개별 견적서 전송 자료" aria-busy={busy}>
    <div className="quote-actions"><button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void read()}>개별 견적 자료 검토</button>
      <button type="button" className="btn primary" disabled={disabled||busy||!data?.review.canPrepare||data.prepared} onClick={()=>void read(true)}>이미지 전송 자료 준비</button></div>
    {error&&<p role="alert">{error}</p>}
    {data&&<><p>{data.company.name} · {data.payload.categoryPath} · 포함 옵션 {data.options.length}개</p>
      <p>{data.prepared?'저장한 값과 이미지 파일의 전송 자료가 준비됐습니다.':'저장한 값과 이미지 파일을 확인한 뒤 자료를 준비하세요.'} Supplier Hub 접수는 아직 실행되지 않았습니다.</p>
      {data.review.issues.length>0&&<ul>{data.review.issues.map((issue,index)=><li key={index}>{issue.message}</li>)}</ul>}
      <div className="quotation-fields-bulk-table"><table><thead><tr><th>옵션</th><th>대표·추가·상세·표시사항 이미지</th></tr></thead><tbody>{data.options.map(option=><tr key={option.optionId??'common'}><td>{option.optionLabel}</td><td>{data.manifest.filter(item=>item.optionId===option.optionId).map(item=>`${({main:'대표',additional:'추가',detail:'상세',label:'표시사항'})[item.role as 'main']??item.role} ${item.files.length}개`).join(' · ')}</td></tr>)}</tbody></table></div></>}
  </section>;
}
