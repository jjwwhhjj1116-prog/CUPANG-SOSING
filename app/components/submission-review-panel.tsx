'use client';

import { useEffect, useState } from 'react';
import type { CategoryProfile } from '@/app/category-profiles';
import type { SubmissionReview } from '@/app/submission-review';

type Target = {id:string;title:string;source_url:string};
type Result = {id:string;report?:SubmissionReview;error?:string};
export function SubmissionReviewPanel({products,profiles,onEdit}:{products:Target[];profiles:CategoryProfile[];onEdit:(id:string,profileId?:string)=>void}) {
  const [profileId,setProfileId]=useState('');
  const [run,setRun]=useState(0);
  const [snapshot,setSnapshot]=useState<{key:string;results:Result[];finished:boolean}>({key:'',results:[],finished:false});
  const targetKey=JSON.stringify(products.map(product=>product.id));
  const requestKey=JSON.stringify([targetKey,profileId,run]);
  const results=snapshot.key===requestKey?snapshot.results:[];
  const busy=products.length>0&&(snapshot.key!==requestKey||!snapshot.finished);
  useEffect(()=>{
    const ids=JSON.parse(targetKey) as string[];
    const controller=new AbortController(); let next=0;
    async function worker() {
      while(next<ids.length && !controller.signal.aborted) {
        const id=ids[next++]; let result:Result;
        try {
          const response=await fetch(`/api/products/${encodeURIComponent(id)}/submission-review${profileId?`?profileId=${encodeURIComponent(profileId)}`:''}`,{cache:'no-store',signal:controller.signal});
          const body=await response.json() as SubmissionReview & {error?:string};
          if(!response.ok)throw new Error(body.error||'검사 실패');
          result={id,report:body as SubmissionReview};
        }catch(error){result={id,error:error instanceof Error?error.message:'검사 실패'};}
        if(!controller.signal.aborted)setSnapshot(current=>({key:requestKey,results:[...(current.key===requestKey?current.results:[]),result],finished:false}));
      }
    }
    void Promise.all(Array.from({length:Math.min(3,ids.length)},()=>worker())).finally(()=>{if(!controller.signal.aborted)setSnapshot(current=>({key:requestKey,results:current.key===requestKey?current.results:[],finished:true}));});
    return()=>controller.abort();
  },[targetKey,profileId,requestKey]);
  const safeUrl=(value:string)=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:undefined;}catch{return undefined;}};
  return <section className="panel-stack" aria-busy={busy}>
    <p>선택한 상품 {products.length}건의 저장된 견적 자료를 검사합니다. 실제 등록은 실행하지 않습니다.</p>
    {!products.length&&<p role="status">작업 보드에서 검사할 상품을 선택한 뒤 등록 전송을 눌러주세요.</p>}
    <label className="field"><span>검사에 적용할 카테고리</span><select value={profileId} onChange={event=>setProfileId(event.target.value)}><option value="">상품 수집 시 선택한 카테고리</option>{profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name} · {profile.categoryId||'코드 미입력'}</option>)}</select></label>
    <small>검사에 선택한 카테고리를 견적 수정 화면에도 이어서 적용합니다.</small>
    <button type="button" className="btn ghost" disabled={busy||!products.length} onClick={()=>setRun(value=>value+1)}>저장된 자료 다시 검사</button>
    {busy&&<p role="status">검사 중 · {results.length}/{products.length}건</p>}
    {products.map(product=>{
      const result=results.find(item=>item.id===product.id); const report=result?.report;
      return <article key={product.id} className="panel-stack">
        <h3>{product.title}</h3><a href={safeUrl(product.source_url)} target="_blank" rel="noreferrer" style={{overflowWrap:'anywhere'}}>{product.source_url}</a>
        {result?.error&&<p role="alert">{result.error}</p>}
        {report&&<>
          <p>{report.categoryPath.join(' › ')||'카테고리 미선택'} · 포함 옵션 {report.includedOptions}개</p>
          <strong>입력 오류 {report.errorCount}개 · 증빙 확인 {report.reviewCount}개 · 전송 연결 대기</strong>
          <small>검사 시각: {new Date(report.checkedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} (한국시간)</small>
          <details><summary>수정·확인할 항목 보기</summary><ul>{report.issues.map((issue,index)=><li key={index}><strong>{issue.kind==='error'?'수정':'확인'} · {issue.optionLabel}</strong> — {issue.message}</li>)}</ul>{report.omittedIssueCount>0&&<p>추가 {report.omittedIssueCount}개 항목이 있습니다. 표시된 항목부터 수정 후 다시 검사해주세요.</p>}</details>
          <details><summary>검사 범위</summary><ul>{report.limits.map(limit=><li key={limit}>{limit}</li>)}</ul></details>
        </>}
        <button type="button" className="btn primary" onClick={()=>onEdit(product.id,profileId||undefined)}>견적서 수정하기</button>
      </article>;
    })}
    <button type="button" className="btn rose" disabled>Supplier Hub 전송 · 연결 구현 대기</button>
  </section>;
}
