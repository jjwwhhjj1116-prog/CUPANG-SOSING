'use client';

import type { QuotationNavigationTarget } from '@/app/quotation-navigation';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CategoryProfile } from '@/app/category-profiles';
import type { SubmissionReview } from '@/app/submission-review';
import { QuotationReviewIssues } from '@/app/components/quotation-review-issues';
import { validateSubmissionReviewResponse } from '@/app/submission-review-response';
import { SubmissionPackage } from '@/app/components/submission-package';
import { SupplierHubProductSubmission } from '@/app/components/supplier-hub-product-submission';

type Target = {id:string;title:string;source_url:string;updated_at:string};
type Result = {id:string;report?:SubmissionReview;error?:string};
export function SubmissionReviewPanel({products,profiles,onEdit,onReceiptSaved,onLockChange,initialProfileId}:{products:Target[];profiles:CategoryProfile[];onEdit:(id:string,profileId?:string,target?:QuotationNavigationTarget)=>void;onReceiptSaved?:()=>void;onLockChange?:(locked:boolean,closeLocked?:boolean)=>void;initialProfileId?:string}) {
  const [profileId,setProfileId]=useState(initialProfileId??'');
  const [run,setRun]=useState(0);
  const [snapshot,setSnapshot]=useState<{key:string;results:Result[];finished:boolean}>({key:'',results:[],finished:false});
  const [legacyOpen,setLegacyOpen]=useState<{key:string;ids:string[]}>({key:'',ids:[]});
  const targetKey=JSON.stringify(products.map(product=>product.id));
  // A saved profile revision includes changes to the workbook and its column mappings.
  // Automatic category selection can resolve a different profile for each product.
  const profileKey=JSON.stringify(profiles.filter(profile=>!profileId||profile.id===profileId)
    .map(profile=>[profile.id,profile.revision,profile.categoryId]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
  const productKey=JSON.stringify(products.map(product=>[product.id,product.updated_at]));
  const requestKey=JSON.stringify([targetKey,productKey,profileId,profileKey,run]);
  const context=useMemo(()=>({key:requestKey}),[requestKey]);
  const currentContext=useRef<typeof context|null>(context);
  const activeReview=useRef<AbortController|null>(null);
  const [lockSnapshot,setLockSnapshot]=useState<{context:typeof context;source:boolean;close:boolean}|null>(null),lockCallback=useRef(onLockChange);
  const lockRegistry=useRef(new WeakMap<typeof context,Map<string,{source:boolean;close:boolean}>>()),retiredContexts=useRef(new WeakSet<typeof context>());
  useLayoutEffect(()=>{lockCallback.current=onLockChange;},[onLockChange]);
  const locks=()=>{const values=[...(lockRegistry.current.get(context)?.values()??[])];return{source:values.some(value=>value.source),close:values.some(value=>value.close)};};
  useLayoutEffect(()=>{const retired=retiredContexts.current;currentContext.current=context;retired.delete(context);const items=lockRegistry.current.get(context)??new Map();lockRegistry.current.set(context,items);
    const values=[...items.values()],value={source:values.some(value=>value.source),close:values.some(value=>value.close)};lockCallback.current?.(value.source,value.close);
    // A new child's layout may have already reported. Preserve that report;
    // refresh the visual snapshot after the commit rather than overwriting it.
    void Promise.resolve().then(()=>{if(currentContext.current!==context||retired.has(context))return;const latest=[...(lockRegistry.current.get(context)?.values()??[])],value={source:latest.some(item=>item.source),close:latest.some(item=>item.close)};setLockSnapshot(previous=>previous?.context===context&&previous.source===value.source&&previous.close===value.close?previous:{context,...value});});
    return()=>{retired.add(context);if(currentContext.current!==context)return;currentContext.current=null;lockCallback.current?.(false,false);
    const controller=activeReview.current;activeReview.current=null;if(controller&&!controller.signal.aborted)controller.abort();
  };},[context]);
  useLayoutEffect(()=>{if(currentContext.current!==context)return;const values=[...(lockRegistry.current.get(context)?.values()??[])];onLockChange?.(values.some(value=>value.source),values.some(value=>value.close));},[context,onLockChange]);
  function productLock(id:string,source:boolean,close=source){
    if(retiredContexts.current.has(context)||!products.some(product=>product.id===id))return;const registry=lockRegistry.current.get(context)??new Map();lockRegistry.current.set(context,registry);
    const before=registry.get(id);if(before?.source===source&&before.close===close)return;
    registry.set(id,{source,close});const value=locks();
    if(currentContext.current===context){setLockSnapshot(previous=>previous?.context===context&&previous.source===value.source&&previous.close===value.close?previous:{context,...value});lockCallback.current?.(value.source,value.close);}
  }
  const results=snapshot.key===requestKey?snapshot.results:[];
  const busy=products.length>0&&(snapshot.key!==requestKey||!snapshot.finished);
  useEffect(()=>{
    const ids=JSON.parse(targetKey) as string[];
    const controller=new AbortController();activeReview.current=controller;let next=0;
    async function worker() {
      while(next<ids.length && !controller.signal.aborted) {
        const id=ids[next++]; let result:Result;
        try {
          const response=await fetch(`/api/products/${encodeURIComponent(id)}/submission-review${profileId?`?profileId=${encodeURIComponent(profileId)}`:''}`,{cache:'no-store',signal:controller.signal});
          const body: unknown = await response.json();
          if(!response.ok)throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : '검사 실패');
          result={id,report:validateSubmissionReviewResponse(body,id,profileId||null)};
        }catch(error){result={id,error:error instanceof Error?error.message:'검사 실패'};}
        if(!controller.signal.aborted&&currentContext.current===context)setSnapshot(current=>({key:requestKey,results:[...(current.key===requestKey?current.results:[]),result],finished:false}));
      }
    }
    void Promise.all(Array.from({length:Math.min(3,ids.length)},()=>worker())).finally(()=>{if(!controller.signal.aborted&&currentContext.current===context)setSnapshot(current=>({key:requestKey,results:current.key===requestKey?current.results:[],finished:true}));});
    return()=>{if(activeReview.current===controller)activeReview.current=null;if(!controller.signal.aborted)controller.abort();};
  },[targetKey,profileId,requestKey,context]);
  function editCurrent(id:string,selectedProfileId?:string,target?:QuotationNavigationTarget) {
    if(currentContext.current!==context||locks().source||!products.some(product=>product.id===id))return;
    onEdit(id,selectedProfileId,target);
  }
  const sourceLocked=lockSnapshot?.context===context&&lockSnapshot.source,closeLocked=lockSnapshot?.context===context&&lockSnapshot.close;
  const safeUrl=(value:string)=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:undefined;}catch{return undefined;}};
  return <section className="panel-stack" aria-busy={busy||closeLocked} data-workspace-saving={closeLocked}>
    <p>선택한 상품 {products.length}건의 포함 옵션을 견적 문서 하나씩 구성합니다. 저장한 카테고리·상품명·가격·이미지를 확인한 뒤 등록 전송을 진행하세요.</p>
    {!products.length&&<p role="status">작업 보드에서 검사할 상품을 선택한 뒤 등록 전송을 눌러주세요.</p>}
    <label className="field"><span>검사에 적용할 카테고리</span><select value={profileId} disabled={sourceLocked} onChange={event=>{if(retiredContexts.current.has(context)||currentContext.current!==null&&currentContext.current!==context||locks().source)return;currentContext.current=null;setProfileId(event.target.value);setRun(value=>value+1);}}><option value="">상품 수집 시 선택한 카테고리</option>{profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name} · {profile.categoryId||'코드 미입력'}</option>)}</select></label>
    <small>검사에 선택한 카테고리를 견적 수정 화면에도 이어서 적용합니다.</small>
    <button type="button" className="btn ghost" disabled={busy||sourceLocked||!products.length} onClick={()=>{if(busy||locks().source||!products.length||currentContext.current!==context)return;currentContext.current=null;setRun(value=>value+1);}}>저장된 자료 다시 검사</button>
    {sourceLocked&&<p role="status">현재 문서의 전송·저장 결과를 확인하는 동안 카테고리와 견적 원본을 유지합니다. 미확정 결과는 같은 문서의 저장 결과 확인으로 이어가세요.</p>}
    {busy&&<p role="status">검사 중 · {results.length}/{products.length}건</p>}
    {products.map(product=>{
      const result=results.find(item=>item.id===product.id); const report=result?.report;
      return <article key={product.id} className="panel-stack">
        <h3>{report ? report.title.trim() ? report.title : '상품명 미입력' : product.title}</h3><a href={safeUrl(product.source_url)} target="_blank" rel="noreferrer" style={{overflowWrap:'anywhere'}}>{product.source_url}</a>
        <SupplierHubProductSubmission key={JSON.stringify([requestKey,product.id])} productId={product.id} profileId={profileId||undefined}
          expectedCategoryId={profileId?profiles.find(profile=>profile.id===profileId)?.categoryId||undefined:undefined}
          onLockChange={(locked,close)=>productLock(product.id,locked,close)}
          onReceiptSaved={()=>{if(currentContext.current===context)onReceiptSaved?.();}}/>
        <details aria-label="Excel 파일 전송 · 별도 방식" inert={sourceLocked} open={legacyOpen.key===requestKey&&legacyOpen.ids.includes(product.id)} onToggle={event=>{
          if(currentContext.current!==context||locks().source)return;
          const open=event.currentTarget.open;
          setLegacyOpen(current=>({key:requestKey,ids:open?[...new Set([...(current.key===requestKey?current.ids:[]),product.id])]:(current.key===requestKey?current.ids:[]).filter(id=>id!==product.id)}));
        }}><summary>Excel 파일 전송 · 별도 방식</summary>
        <p>공식 Excel 파일과 첨부 이미지를 대량 등록 화면으로 전달하는 별도 방식입니다. 전체 상품 문서 확인에 실패해도 자동으로 실행하지 않습니다.</p>
        {result?.error&&<p role="alert">Excel 자료 검사: {result.error}</p>}
        {report&&<>
          <p>{report.categoryPath.join(' › ')||'카테고리 미선택'} · 포함 옵션 {report.includedOptions}개</p>
          <strong>입력 오류 {report.errorCount}개 · 증빙 확인 {report.reviewCount}개</strong>
          <small>검사 시각: {new Date(report.checkedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} (한국시간)</small>
          <details><summary>수정·확인할 항목 보기</summary><QuotationReviewIssues key={requestKey} issues={report.issues} omittedIssueCount={report.omittedIssueCount} disabled={sourceLocked} onInspect={target=>editCurrent(product.id,profileId||undefined,{...target,categoryId:report.categoryId})}/></details>
          <details><summary>검사 범위</summary><ul>{report.limits.map(limit=><li key={limit}>{limit}</li>)}</ul></details>
          {legacyOpen.key===requestKey&&legacyOpen.ids.includes(product.id)&&<SubmissionPackage key={JSON.stringify([requestKey,report.fingerprint])} productId={product.id} profileId={profileId} categoryId={report.categoryId} onReceiptSaved={()=>{if(currentContext.current===context)onReceiptSaved?.();}} onInspect={(resolvedProfileId,target)=>editCurrent(product.id,resolvedProfileId,target)}/>}
        </>}
        </details>
        <button type="button" className="btn primary" disabled={sourceLocked} onClick={()=>editCurrent(product.id,profileId||undefined,report?{optionId:null,fieldId:'category',categoryId:report.categoryId}:undefined)}>견적서 수정하기</button>
      </article>;
    })}
  </section>;
}
