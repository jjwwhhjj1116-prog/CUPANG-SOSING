'use client';
import {useEffect,useRef,useState} from 'react';
import {defaultCompanyRegistrationQuery,loadCompanyRegistrationStatus,REGISTRATION_REVIEW_STATUSES,registrationStageSummary,type CompanyRegistrationQuery,type CompanyRegistrationStatus} from '@/app/company-registration-status';
export function CompanyRegistrationStatusPanel(){
 const [query,setQuery]=useState<CompanyRegistrationQuery>(()=>defaultCompanyRegistrationQuery()),[data,setData]=useState<CompanyRegistrationStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[page,setPage]=useState(1);
 const active=useRef<AbortController|null>(null),size=50;
 useEffect(()=>()=>{active.current?.abort();},[]);
 async function search(){if(active.current)return;const controller=new AbortController();active.current=controller;setBusy(true);setError('');setData(null);setPage(1);try{const result=await loadCompanyRegistrationStatus({...query,title:query.title.trim()},controller.signal);if(!controller.signal.aborted&&active.current===controller)setData(result);}catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'상품 등록 상태를 조회하지 못했습니다.');}finally{if(active.current===controller){active.current=null;if(!controller.signal.aborted)setBusy(false);}}}
 const current=data?.rows.slice((page-1)*size,page*size)??[];
 return <section className="company-registration-status" aria-label="상품 등록 상태">
  <form className="company-registration-query" onSubmit={event=>{event.preventDefault();void search();}}>
   <label>조회 시작일<input type="date" value={query.startDate} disabled={busy} onChange={event=>setQuery({...query,startDate:event.target.value})}/></label>
   <label>조회 종료일<input type="date" value={query.endDate} disabled={busy} onChange={event=>setQuery({...query,endDate:event.target.value})}/></label>
   <label>검수 상태<select value={query.status} disabled={busy} onChange={event=>setQuery({...query,status:event.target.value as CompanyRegistrationQuery['status']})}>{REGISTRATION_REVIEW_STATUSES.map(status=><option key={status}>{status}</option>)}</select></label>
   <label className="company-registration-name">상품명<input value={query.title} placeholder="상품명 일부" maxLength={200} disabled={busy} onChange={event=>setQuery({...query,title:event.target.value})}/></label>
   <button className="btn primary" disabled={busy}>{busy?'조회 중…':'조회'}</button>
  </form>
  <p className="company-registration-note">Supplier Hub에 표시되는 등록 심사 결과를 조회합니다. 검수를 통과해 판매가 시작된 상품은 이 목록에서 빠질 수 있습니다.</p>
  {busy&&<p role="status">쿠팡에서 등록 심사 상태를 불러오는 중입니다.</p>}{error&&<p role="alert">{error}</p>}
  {data&&<><div className="company-registration-summary"><strong>전체 {data.total.toLocaleString()}건</strong><span>상품 검수중 {data.rows.filter(row=>row.status==='상품 검수중').length.toLocaleString()}건</span><small>{data.company.name} · {new Date(data.observedAt).toLocaleString('ko-KR')} 조회</small></div>
   <div className="table-wrap"><table><thead><tr>{['상품명','등록일','검수 상태','진행 단계','사유'].map(title=><th key={title}>{title}</th>)}</tr></thead><tbody>{current.map((row,index)=>{const summary=registrationStageSummary(row);return <tr key={`${row.quotationId}:${row.skuId}:${(page-1)*size+index}`}><td><strong>{row.title}</strong><small>{row.barcode}</small></td><td>{row.submittedAt}</td><td>{row.status}</td><td>{summary.stage}</td><td>{summary.reason}<details><summary>전체 진행 단계</summary><p>{row.stage}</p><p>카테고리: {row.category} · 견적서 ID: {row.quotationId} · SKU ID: {row.skuId}</p></details></td></tr>;})}{!current.length&&<tr><td colSpan={5}>조회 조건에 맞는 등록 심사 상품이 없습니다.</td></tr>}</tbody></table></div>
   <footer><button className="btn ghost" disabled={page===1} onClick={()=>setPage(value=>value-1)}>이전</button><span>{page} / {Math.max(1,Math.ceil(data.total/size))}</span><button className="btn ghost" disabled={page*size>=data.total} onClick={()=>setPage(value=>value+1)}>다음</button></footer>
   <p className="company-registration-note">회사 전체 조회 결과입니다. YOOFAM PLUS 견적서의 전송·접수 이력은 각 상품의 견적서에서 확인합니다.</p>
  </>}
 </section>;
}
