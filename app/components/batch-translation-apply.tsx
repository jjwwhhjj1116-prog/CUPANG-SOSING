'use client';
import { useEffect, useRef, useState } from 'react';
import { readBatchTranslationTarget } from '@/app/batch-translation';
import { applyBatchTranslations, previewBatchTranslation, type ReviewedTranslation } from '@/app/batch-translation-apply';

type Item={id:string;title:string};
type Row={id:string;review?:ReviewedTranslation;error?:string;saved?:boolean};
export function BatchTranslationApply({products,disabled,onBusyChange}:{products:Item[];disabled:boolean;onBusyChange:(busy:boolean)=>void}){
 const [rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[message,setMessage]=useState('');
 const active=useRef(false),stop=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;stop.current=true;};},[]);
 function begin(){if(active.current||disabled)return false;active.current=true;stop.current=false;setBusy(true);setMessage('');onBusyChange(true);return true;}
 function finish(){active.current=false;if(mounted.current){setBusy(false);onBusyChange(false);}}
 async function preview(){
  if(!begin())return;
  setReady(false);setRows([]);const controller=new AbortController();const next:Row[]=[];
  try{
   for(const product of products){
    if(stop.current)break;
    let row:Row;
    try{
     const target=await readBatchTranslationTarget(product.id,fetch,controller.signal);
     if(stop.current)break;
     row=target?.jobId?{id:product.id,review:await previewBatchTranslation(target,fetch)}:{id:product.id,error:'현재 상품 버전에 일치하는 완료 번역이 없습니다.'};
    }catch(error){row={id:product.id,error:error instanceof Error?error.message:'조회 실패'};}
    if(stop.current)break;next.push(row);if(mounted.current)setRows([...next]);
   }
   if(mounted.current){setReady(!stop.current);setMessage(stop.current?'조회 중단됨':'아래 상품별 변경 내용을 확인한 뒤 함께 저장하세요.');}
  }finally{finish();}
 }
 async function apply(){
  if(!ready||!begin())return;setReady(false);
  try{
   const outcome=await applyBatchTranslations(rows.flatMap(row=>row.review?[row.review]:[]),{fetcher:fetch,shouldStop:()=>stop.current,onSaved:id=>{if(mounted.current)setRows(previous=>previous.map(row=>row.id===id?{...row,saved:true}:row));}});
   if(mounted.current)setMessage(outcome.status==='failed'?`${outcome.saved.length}개 저장 확인 후 중단 · ${outcome.error}`:outcome.status==='stopped'?`${outcome.saved.length}개 저장 확인 후 중단했습니다.`:`${outcome.saved.length}개 상품의 번역을 저장했습니다.`);
  }catch(error){if(mounted.current)setMessage(error instanceof Error?error.message:'저장본을 다시 조회해주세요.');}finally{finish();}
 }
 const count=rows.filter(row=>row.review?.plan.preview.length).length;
 return <section className="translation-review" aria-label="완료 번역 일괄 저장" aria-busy={busy}>
  <h4>완료 번역 한 번에 적용</h4>
  <button type="button" className="btn blue" disabled={disabled||busy||!products.length} onClick={()=>void preview()}>선택 상품 전체 적용 미리보기</button>
  {message&&<p role="status">{message}</p>}
  {rows.map(row=><details key={row.id}><summary>{products.find(product=>product.id===row.id)?.title} · {row.saved?'저장 확인':row.error?'검토 불가':`${row.review?.plan.preview.length??0}개 변경`}</summary>
   {row.error&&<p role="alert">{row.error}</p>}
   {row.review&&<><table><thead><tr><th>항목</th><th>현재 값</th><th>저장할 값</th></tr></thead><tbody>{row.review.plan.preview.map((change,index)=><tr key={index}><th>{change.name}</th><td style={{whiteSpace:'pre-wrap'}}>{change.before||'(공란)'}</td><td style={{whiteSpace:'pre-wrap'}}>{change.after||'(공란)'}</td></tr>)}</tbody></table><ul>{row.review.plan.skipped.map((text,index)=><li key={index}>{text}</li>)}</ul></>}
  </details>)}
  <button type="button" className="btn blue" disabled={disabled||busy||!ready||!count} onClick={()=>void apply()}>검토한 {count}개 상품 함께 저장</button>
  {busy&&<button type="button" className="btn ghost" onClick={()=>{stop.current=true;setMessage('현재 요청을 마친 뒤 중단합니다.');}}>연속 작업 중단</button>}
 </section>;
}

