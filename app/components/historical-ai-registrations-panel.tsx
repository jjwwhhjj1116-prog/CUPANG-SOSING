'use client';
import {useEffect,useRef,useState} from 'react';
import type {HistoricalAiCounts,HistoricalAiList,HistoricalAiQuote} from '@/app/historical-ai-registrations';
type Preview={sha256:string;counts:HistoricalAiCounts;sample:{registrationId:string;optionId:string;title:string;kind:string}[]};
export default function HistoricalAiRegistrationsPanel(){
 const [data,setData]=useState<HistoricalAiList|null>(null),[page,setPage]=useState(1),[search,setSearch]=useState(''),[draft,setDraft]=useState(''),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(''),[forbidden,setForbidden]=useState(false);
 const [files,setFiles]=useState<File[]>([]),[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[selected,setSelected]=useState<string|null>(null),[quotes,setQuotes]=useState<HistoricalAiQuote[]>([]),[quoteError,setQuoteError]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>active.current?.abort(),[]);
 useEffect(()=>{
  const controller=new AbortController();queueMicrotask(()=>{if(!controller.signal.aborted){setLoading(true);setError('');}});
  void(async()=>{try{
   const response=await fetch('/api/historical-ai-registrations?'+new URLSearchParams({page:String(page),search}),{signal:controller.signal,cache:'no-store'});
   if(response.status===403){if(!controller.signal.aborted){setForbidden(true);setData(null);setSelected(null);}return;}
   const body=await response.json() as HistoricalAiList&{error?:string};if(!response.ok)throw Error(body.error??'기록을 읽지 못했습니다.');if(!controller.signal.aborted)setData(body);
  }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'기록을 읽지 못했습니다.');}finally{if(!controller.signal.aborted)setLoading(false);}})();return()=>controller.abort();
 },[page,search,refresh]);
 useEffect(()=>{
  const controller=new AbortController();queueMicrotask(()=>{if(!controller.signal.aborted){setQuotes([]);setQuoteError('');}});
  if(selected)void(async()=>{try{const response=await fetch('/api/historical-ai-registrations?'+new URLSearchParams({registrationId:selected}),{signal:controller.signal,cache:'no-store'}),body=await response.json() as {quotes:HistoricalAiQuote[];error?:string};if(!response.ok)throw Error(body.error??'견적 자료를 읽지 못했습니다.');if(!controller.signal.aborted)setQuotes(body.quotes);}catch(cause){if(!controller.signal.aborted)setQuoteError(cause instanceof Error?cause.message:'견적 자료를 읽지 못했습니다.');}})();return()=>controller.abort();
 },[selected,refresh]);
 async function upload(commit:boolean){
  if(active.current||!files.length||commit&&!preview)return;
  const controller=new AbortController();active.current=controller;setBusy(true);setMessage('');
  try{
   if(files.length>100||files.reduce((size,file)=>size+file.size,0)>1500000)throw Error('JSON 파일은 한 번에 100개, 합계 1.5MB 이하로 선택해주세요. 나머지 페이지는 이어서 보관할 수 있습니다.');
   const documents=await Promise.all(files.map(async file=>({name:file.name,text:await file.text()})));controller.signal.throwIfAborted();
   const response=await fetch('/api/historical-ai-registrations',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',signal:controller.signal,body:JSON.stringify({action:commit?'import':'preview',documents,...commit?{expectedSha256:preview!.sha256}:{}})}),body=await response.json() as Preview&{error?:string};
   if(!response.ok)throw Error(body.error??'원본 기록 가져오기를 확인하지 못했습니다.');
   if(controller.signal.aborted)return;
   if(commit){setPreview(null);setMessage(`신규 ${body.counts.added}개 기록을 보관했습니다. 동일한 원본 ${body.counts.unchanged}개는 유지했습니다.`);setRefresh(value=>value+1);}else setPreview(body);
  }catch(cause){if(!controller.signal.aborted)setMessage(cause instanceof Error?cause.message:'응답을 확인하지 못했습니다. 같은 파일로 다시 확인해주세요.');}
  finally{active.current=null;if(!controller.signal.aborted)setBusy(false);}
 }
 if(forbidden)return null;
 return <section className="panel" aria-label="쿠플러스 원본 AI 등록 기록">
  <h2>쿠플러스 원본 AI 등록 기록</h2><p>와이홉 계정에서 보관한 등록 목록과 부분 견적자료입니다. 단계 상태와 옵션 개수는 원본 화면에 표시된 값입니다.</p>
  {error&&<p role="alert">{error}</p>}
  <details><summary>원본 JSON 가져오기</summary><p>목록 페이지와 해당 등록번호의 견적 JSON을 함께 선택할 수 있습니다. 같은 원본은 중복 보관하지 않습니다.</p>
   <input aria-label="쿠플러스 원본 JSON 파일" type="file" multiple accept=".json,application/json" disabled={busy} onChange={event=>{if(active.current)return;setFiles(Array.from(event.target.files??[]));setPreview(null);setMessage('');}}/>
   <button className="btn" disabled={busy||!files.length} onClick={()=>void upload(false)}>기록 미리보기</button>
   {preview&&<div><p>원본 등록 목록 {preview.counts.registrations}개 · 부분 견적자료 {preview.counts.quotations}개 · 신규 {preview.counts.added}개 · 동일 {preview.counts.unchanged}개</p><ul>{preview.sample.map(row=><li key={JSON.stringify([row.kind,row.registrationId,row.optionId])}>{row.registrationId} {row.title||'부분 견적자료'}</li>)}</ul><button className="btn primary" disabled={busy} onClick={()=>void upload(true)}>원본 기록 보관</button></div>}
   {message&&<p role="status">{message}</p>}
  </details>
  <form onSubmit={event=>{event.preventDefault();setSearch(draft.trim());setPage(1);}}><label>상품명·등록번호 <input value={draft} maxLength={200} onChange={event=>setDraft(event.target.value)}/></label><button className="btn ghost">검색</button><button className="btn ghost" type="button" disabled={loading} onClick={()=>setRefresh(value=>value+1)}>새로고침</button></form>
  <p>원본 등록 기록 {data?.total??0}개 · 원본에 표시된 옵션 수 합계 {data?.reportedOptions??0}개</p>
  <div className="table-wrap" aria-busy={loading}><table><thead><tr><th>원본 등록번호</th><th>상품명</th><th>표시 옵션 수</th><th>원본 단계 상태</th><th>원본 등록 상태</th><th>부분 견적자료</th><th>원본 URL</th></tr></thead><tbody>
   {data?.records.map(row=><tr key={row.registrationId}><td>{row.registrationId}</td><td>{row.title}</td><td>{row.optionCount}</td><td><details><summary>원본 상태 보기</summary><ol>{row.raw.cells.slice(5,13).map((value,index)=><li key={index}>원본 {index+1}열: {value||'빈칸'}</li>)}</ol></details></td><td>{row.status}</td><td>{row.quoteCount?<button className="btn ghost" onClick={()=>setSelected(row.registrationId)}>자료 {row.quoteCount}개 보기</button>:'미보관'}</td><td><a href={row.sourceUrl} target="_blank" rel="noopener noreferrer">1688 원본</a></td></tr>)}
   {!loading&&!data?.records.length&&<tr><td colSpan={7}>보관된 원본 기록이 없습니다.</td></tr>}
  </tbody></table></div>
  <p><button className="btn ghost" disabled={loading||page===1} onClick={()=>setPage(value=>value-1)}>이전</button> {page} / {Math.max(1,Math.ceil((data?.total??0)/25))} <button className="btn ghost" disabled={loading||page*25>=(data?.total??0)} onClick={()=>setPage(value=>value+1)}>다음</button></p>
  {selected&&<section aria-label="부분 견적자료"><h3>등록번호 {selected} · 부분 견적자료</h3><button className="btn ghost" onClick={()=>setSelected(null)}>닫기</button>{quoteError&&<p role="alert">{quoteError}</p>}{quotes.map(quote=><div key={quote.sourceOptionId}><p>원본 옵션번호 {quote.sourceOptionId} · 카테고리 {quote.categoryCode} · 관찰 {quote.collectedAt}</p><dl>{quote.controls.map(control=><div key={control.index}><dt>{control.label||`원본 입력 ${control.index+1}`}</dt><dd>{typeof control.value==='boolean'?(control.value?'선택':'선택 안 함'):control.value||'빈칸'}</dd></div>)}</dl></div>)}</section>}
 </section>;
}
