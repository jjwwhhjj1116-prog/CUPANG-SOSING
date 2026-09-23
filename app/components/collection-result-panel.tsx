'use client';
import { useEffect, useRef, useState } from 'react';
import { runCollectionImport } from '@/app/collection-import';
import type { CollectionResult } from '@/app/collection-result';
export function CollectionResultPanel({jobId,productId,onSaved}:{jobId:string;productId?:string|null;onSaved:()=>void}){
 const [result,setResult]=useState<CollectionResult|null>(null);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 const stop=useRef(false);const running=useRef(false);const mounted=useRef(true);
 const [importing,setImporting]=useState(false);
 const [stopping,setStopping]=useState(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;stop.current=true;};},[]);
 async function importAll(){
  if(!result||running.current)return;
  running.current=true;stop.current=false;setStopping(false);setBusy(true);setImporting(true);
  const outcome=await runCollectionImport(jobId,result.images.length,{shouldStop:()=>stop.current,onProgress:progress=>{
   if(mounted.current)setMessage(progress.stage==='product'?'상품·옵션 반영 중…':`원본 이미지 ${progress.completedImages}/${progress.totalImages}개 저장 확인…`);
  }});
  running.current=false;
  if(!mounted.current)return;
  setMessage(outcome.status==='completed'?`상품·옵션과 원본 이미지 ${outcome.completedImages}개 저장을 확인했습니다. 번역·등록은 실행하지 않았습니다.`:
   `${outcome.status==='stopped'?'중단됨':'실패'} · ${outcome.productId?'상품 반영 확인':'상품 반영 미확인'} · 이미지 ${outcome.completedImages}개 확인. ${outcome.error??''} 다시 실행하면 완료된 항목을 재사용합니다.`);
  setBusy(false);setImporting(false);setStopping(false);onSaved();
 }
 async function promote(){setBusy(true);setMessage('');try{const response=await fetch('/api/collection-jobs/'+encodeURIComponent(jobId)+'/product',{method:'POST'});const body=await response.json() as {error?:string;productId?:string};if(!response.ok)throw new Error(body.error||'상품 반영 실패');setMessage('상품 관리에 반영했습니다. 이미지·번역·등록은 아직 실행하지 않았습니다.');onSaved();}catch(cause){setMessage(cause instanceof Error?cause.message:'상품 반영 실패');}finally{setBusy(false);}}
 async function load(){setBusy(true);setMessage('');setResult(null);try{
 const response=await fetch(`/api/collection-jobs/${encodeURIComponent(jobId)}/result`,{cache:'no-store'});const body=await response.json() as {error?:string;message:string;receipt?:{result:CollectionResult}|null};
 if(!response.ok)throw new Error(body.error||'결과 조회 실패');setResult(body.receipt?.result??null);setMessage(productId?'상품에 반영한 원문입니다. 번역·이미지 다운로드·등록은 별도 단계입니다.':body.message);
 }catch(cause){setMessage(cause instanceof Error?cause.message:'결과 조회 실패');}finally{setBusy(false);}}
 return <details className="collection-receipt"><summary>수집 원문 확인</summary><button type="button" className="btn ghost" disabled={busy} onClick={()=>void load()}>{busy?'확인 중…':'수신 결과 조회'}</button>{message&&<p role="status">{message}</p>}{result&&<><h4>{result.title}</h4><button type="button" className="btn primary" disabled={busy||!!productId} onClick={()=>void promote()}>{productId?"상품 반영됨":"원문을 상품·옵션으로 반영"}</button><p>{result.provider} · {result.collectedAt}</p><a href={result.sourceUrl} target="_blank" rel="noreferrer">{result.sourceUrl}</a><div className="table-wrap"><table><thead><tr><th>SKU</th><th>원문 옵션</th><th>원가 CNY</th><th>최소 주문</th><th>재고</th></tr></thead><tbody>{result.options.map(row=><tr key={row.sku}><td>{row.sku}</td><td>{row.name}</td><td>{row.unitPriceCny}</td><td>{row.minimumOrder}</td><td>{row.stock??'미확인'}</td></tr>)}</tbody></table></div><p>이미지 주소 {result.images.length}개 · 원본 저장과 번역은 별도입니다.</p><button type="button" className="btn ghost" disabled={busy} onClick={()=>void importAll()}>상품·원본 이미지 한 번에 반영 · 재시도</button>{importing&&<button type="button" className="btn ghost" disabled={stopping} onClick={()=>{stop.current=true;setStopping(true);}}>{stopping?"현재 저장을 마친 뒤 중단합니다":"연속 작업 중단"}</button>}<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{result.description}</pre></>}</details>;
}
