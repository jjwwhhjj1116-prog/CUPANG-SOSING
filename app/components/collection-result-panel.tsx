'use client';
import { useEffect, useRef, useState } from 'react';
import { validateCollectionCapacity, collectionSelectionFits, type CollectionCapacity } from '@/app/collection-capacity';
import { runCollectionImport } from '@/app/collection-import';
import type { CollectionResult } from '@/app/collection-result';
type Props={jobId:string;productId?:string|null;onSaved:()=>void};
export function CollectionResultPanel(props:Props){return <CollectionResultContent key={props.jobId} {...props}/>;}
function CollectionResultContent({jobId,productId,onSaved}:Props){
 const [result,setResult]=useState<CollectionResult|null>(null);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 const [capacity,setCapacity]=useState<CollectionCapacity|null>(null);
 const [selectedImages,setSelectedImages]=useState<number[]>([]);
 const stop=useRef(false);const running=useRef(false);const mounted=useRef(true);
 const [importing,setImporting]=useState(false);
 const [stopping,setStopping]=useState(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;stop.current=true;};},[]);
 async function importAll(){
  if(!result||running.current)return;
  running.current=true;stop.current=false;setStopping(false);setBusy(true);setImporting(true);
  let outcome;
  try { outcome=await runCollectionImport(jobId,result.images.length,{imageIndices:selectedImages,shouldStop:()=>stop.current,onProgress:progress=>{
   if(mounted.current)setMessage(progress.stage==='product'?'상품·옵션 반영 중…':`원본 이미지 ${progress.completedImages}/${progress.totalImages}개 저장 확인…`);
  }}); } catch(cause) {
   running.current=false;
   if(mounted.current){setMessage(cause instanceof Error?cause.message:'이미지 선택을 확인해주세요.');setBusy(false);setImporting(false);setStopping(false);}
   return;
  }
  running.current=false;
  if(!mounted.current)return;
  setMessage(outcome.status==='completed'?`상품·옵션과 원본 이미지 ${outcome.completedImages}개 저장을 확인했습니다. 번역·등록은 실행하지 않았습니다.`:
   `${outcome.status==='stopped'?'중단됨':'실패'} · ${outcome.productId?'상품 반영 확인':'상품 반영 미확인'} · 이미지 ${outcome.completedImages}개 확인. ${outcome.error??''} 다시 실행하면 완료된 항목을 재사용합니다.`);
  setBusy(false);setImporting(false);setStopping(false);onSaved();
 }
 async function promote(){setBusy(true);setMessage('');try{const response=await fetch('/api/collection-jobs/'+encodeURIComponent(jobId)+'/product',{method:'POST'});const body=await response.json() as {error?:string;productId?:string};if(!response.ok)throw new Error(body.error||'상품 반영 실패');setMessage('상품 관리에 반영했습니다. 이미지·번역·등록은 아직 실행하지 않았습니다.');onSaved();}catch(cause){setMessage(cause instanceof Error?cause.message:'상품 반영 실패');}finally{setBusy(false);}}
 async function load(){setBusy(true);setMessage('');setResult(null);try{
 const response=await fetch(`/api/collection-jobs/${encodeURIComponent(jobId)}/result`,{cache:'no-store'});const body=await response.json() as {error?:string;message:string;receipt?:{result:CollectionResult}|null};
 if(!response.ok)throw new Error(body.error||'결과 조회 실패');const received=body.receipt?.result??null;
 setCapacity(null);setSelectedImages([]);
 if(received){const check=await fetch('/api/collection-jobs/'+encodeURIComponent(jobId)+'/capacity',{cache:'no-store'});const data=await check.json() as {capacity?:unknown;error?:string};if(!check.ok)throw new Error(data.error||'이미지 저장 여유 조회 실패');const current=validateCollectionCapacity(data.capacity,received.images.length);setCapacity(current);const all=received.images.map((_,index)=>index);setSelectedImages(all.length<=50&&collectionSelectionFits(current,all)?all:[]);}
 setResult(received);setMessage(productId?'상품에 반영한 원문입니다. 번역·이미지 다운로드·등록은 별도 단계입니다.':body.message);
 }catch(cause){setMessage(cause instanceof Error?cause.message:'결과 조회 실패');}finally{setBusy(false);}}
 return <details className="collection-receipt"><summary>수집 원문 확인</summary><button type="button" className="btn ghost" disabled={busy} onClick={()=>void load()}>{busy?'확인 중…':'수신 결과 조회'}</button>{message&&<p role="status">{message}</p>}{result&&<><h4>{result.title}</h4><button type="button" className="btn primary" disabled={busy||!!productId} onClick={()=>void promote()}>{productId?"상품 반영됨":"원문을 상품·옵션으로 반영"}</button><p>{result.provider} · {result.collectedAt}</p><a href={result.sourceUrl} target="_blank" rel="noreferrer">{result.sourceUrl}</a><div className="table-wrap"><table><thead><tr><th>SKU</th><th>원문 옵션</th><th>원문 색상</th><th>원문 사이즈</th><th>원가 CNY</th><th>최소 주문</th><th>재고</th><th>옵션 원본 이미지</th></tr></thead><tbody>{result.options.map(row=><tr key={row.sku}><td>{row.sku}</td><td>{row.name}</td><td>{row.color||'미확인'}</td><td>{row.size||'미확인'}</td><td>{row.unitPriceCny}</td><td>{row.minimumOrder}</td><td>{row.stock??'미확인'}</td><td>{row.imageIndex===undefined?'연결 정보 없음':`${row.imageIndex+1}번 · ${selectedImages.includes(row.imageIndex)?'저장 선택됨':'저장 미선택'}`}</td></tr>)}</tbody></table></div><p>이미지 주소 {result.images.length}개 · 원본 저장과 번역은 별도입니다.</p><fieldset disabled={busy} style={{border:0,padding:0}}><legend>저장할 원본 이미지 선택 · {selectedImages.length}/{result.images.length}개</legend><p>공통 이미지·기존 파일 {capacity?.usedSlots??0}개 / 전체 한도 50개. 새 이미지 여유 {50-(capacity?.usedSlots??50)}개이며 이미 저장된 원본은 재사용합니다. 실패한 이미지는 선택을 해제하고 재시도할 수 있습니다.</p><button type="button" className="btn ghost" disabled={result.images.length>50||!capacity||!collectionSelectionFits(capacity,result.images.map((_,index)=>index))} onClick={()=>setSelectedImages(result.images.map((_,index)=>index))}>전체 선택</button><button type="button" className="btn ghost" onClick={()=>setSelectedImages([])}>선택 해제</button><div style={{maxHeight:240,overflowY:'auto'}}>{result.images.map((image,index)=><div key={image.url}><label><input type="checkbox" checked={selectedImages.includes(index)} disabled={!selectedImages.includes(index)&&(selectedImages.length>=50||!capacity||!collectionSelectionFits(capacity,[...selectedImages,index]))} onChange={event=>setSelectedImages(previous=>event.target.checked?[...previous,index]:previous.filter(value=>value!==index))}/>{index+1}번 · {image.role==='main'?'대표':image.role==='additional'?'추가':'상세'}</label> <a href={image.url} target="_blank" rel="noreferrer" style={{overflowWrap:'anywhere'}}>{image.url}</a></div>)}</div></fieldset><button type="button" className="btn ghost" disabled={busy||!capacity||!collectionSelectionFits(capacity,selectedImages)||(result.images.length>0&&selectedImages.length===0)} onClick={()=>void importAll()}>상품·선택 이미지 {selectedImages.length}개 반영 · 재시도</button>{importing&&<button type="button" className="btn ghost" disabled={stopping} onClick={()=>{stop.current=true;setStopping(true);}}>{stopping?"현재 저장을 마친 뒤 중단합니다":"연속 작업 중단"}</button>}<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{result.description}</pre></>}</details>;
}
