'use client';
import { useState } from 'react';
import type { CollectionResult } from '@/app/collection-result';
export function CollectionResultPanel({jobId}:{jobId:string}){
 const [result,setResult]=useState<CollectionResult|null>(null);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 async function load(){setBusy(true);setMessage('');setResult(null);try{
 const response=await fetch(`/api/collection-jobs/${encodeURIComponent(jobId)}/result`,{cache:'no-store'});const body=await response.json() as {error?:string;message:string;receipt?:{result:CollectionResult}|null};
 if(!response.ok)throw new Error(body.error||'결과 조회 실패');setResult(body.receipt?.result??null);setMessage(body.message);
 }catch(cause){setMessage(cause instanceof Error?cause.message:'결과 조회 실패');}finally{setBusy(false);}}
 return <details className="collection-receipt"><summary>수집 원문 확인</summary><button type="button" className="btn ghost" disabled={busy} onClick={()=>void load()}>{busy?'확인 중…':'수신 결과 조회'}</button>{message&&<p role="status">{message}</p>}{result&&<><h4>{result.title}</h4><p>{result.provider} · {result.collectedAt}</p><a href={result.sourceUrl} target="_blank" rel="noreferrer">{result.sourceUrl}</a><div className="table-wrap"><table><thead><tr><th>SKU</th><th>원문 옵션</th><th>원가 CNY</th><th>최소 주문</th><th>재고</th></tr></thead><tbody>{result.options.map(row=><tr key={row.sku}><td>{row.sku}</td><td>{row.name}</td><td>{row.unitPriceCny}</td><td>{row.minimumOrder}</td><td>{row.stock??'미확인'}</td></tr>)}</tbody></table></div><p>이미지 주소 {result.images.length}개 · 아직 다운로드되지 않았습니다.</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{result.description}</pre></>}</details>;
}
