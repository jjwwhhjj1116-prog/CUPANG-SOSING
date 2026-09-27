'use client';

import { useEffect, useRef, useState } from 'react';
import { isQuotationFilename } from '@/app/exports/quotation-filename';
import { validatePackageReview, type PackageReview } from '@/app/submission-review-response';
import { QuotationReviewIssues } from '@/app/components/quotation-review-issues';
import type { QuotationNavigationTarget } from '@/app/quotation-navigation';
import { checkSupplierHubExtension, prepareSupplierHubHandoff } from '@/app/supplier-hub-handoff';

type Preview = {
  fingerprint:string; filename:string; headers:string[]; rows:(string|number)[][];
  submissionReview:PackageReview;
  report:{productId:string;categoryId:string|null;profileId:string;rowCount:number;warnings:string[];submissionReady:false};
};

/** Reuses the reviewed XLSX exporter. Preparing or downloading never marks a product submitted. */
export function SubmissionPackage({productId,profileId,categoryId,onInspect}:{productId:string;profileId:string;categoryId:string|null;onInspect:(profileId:string,target:QuotationNavigationTarget)=>void}) {
  const [preview,setPreview]=useState<Preview|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const active=useRef<AbortController|null>(null);
  useEffect(()=>()=>active.current?.abort(),[]);
  async function run(action:'preview'|'export'|'download'|'handoff') {
    if(active.current || (action!=='preview'&&!preview))return;
    const controller=new AbortController();active.current=controller;
    setBusy(true);setError('');setMessage('');
    if(action==='preview')setPreview(null);
    try {
      if(action==='handoff'){
        if(!categoryId||!preview?.filename.endsWith('.xlsx'))throw new Error('선택한 카테고리의 Excel 양식으로 견적서를 준비해주세요.');
        await checkSupplierHubExtension(controller.signal);
      }
      const response=await fetch(`/api/products/${encodeURIComponent(productId)}/quotation`,{
        method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},
        body:JSON.stringify({action:action==='handoff'?'export':action,...(profileId?{profileId}:{}),...(action!=='preview'?{fingerprint:preview!.fingerprint}:{})}),
      });
      if(!response.ok){
        const body=await response.json() as {error?:string};
        if(response.status===409)setPreview(null);
        throw new Error(typeof body?.error==='string'?body.error:'견적서 파일을 준비하지 못했습니다.');
      }
      if(action==='preview'){
        const data=await response.json() as Preview;
        if(!data || !/^[a-f0-9]{64}$/.test(data.fingerprint) || data.report?.productId!==productId
          || !isQuotationFilename(data.filename) || !data.filename.startsWith(`YOOFAM-${data.fingerprint}.`)
          || data.report.categoryId!==categoryId || data.report.submissionReady!==false
          || typeof data.report.profileId!=='string' || (profileId&&data.report.profileId!==profileId)
          || !Array.isArray(data.headers) || !data.headers.every(value=>typeof value==='string')
          || !Array.isArray(data.rows) || !data.rows.every(row=>Array.isArray(row)&&row.every(value=>typeof value==='string'||typeof value==='number'))
          || data.report.rowCount!==data.rows.length || !Array.isArray(data.report.warnings) || !data.report.warnings.every(value=>typeof value==='string')){
          throw new Error('검사한 상품·카테고리와 출력 자료가 다릅니다. 자료를 다시 검사해주세요.');
        }
        const submissionReview=validatePackageReview(data.submissionReview,productId,categoryId,data.fingerprint);
        if(!controller.signal.aborted)setPreview({...data,submissionReview});
      }else{
        if(action==='download'){
          const extension=preview!.filename.split('.').at(-1);
          const mime=extension==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':extension==='csv'?'text/csv':'text/tab-separated-values';
          if(response.headers.get('content-type')?.split(';')[0]!==mime
            || response.headers.get('x-quotation-fingerprint')!==preview!.fingerprint
            || response.headers.get('content-disposition')!==`attachment; filename="${preview!.filename}"`)throw new Error('검토한 견적서와 다운로드 파일이 일치하지 않습니다. 다시 준비해주세요.');
        }else if(!response.headers.get('content-type')?.startsWith('application/zip'))throw new Error('견적서 ZIP 응답을 확인하지 못했습니다.');
        const blob=await response.blob();if(controller.signal.aborted)return;
        if(action==='handoff'){
          await prepareSupplierHubHandoff(blob,{productId,categoryId:categoryId!,fingerprint:preview!.fingerprint},controller.signal);
          if(!controller.signal.aborted)setMessage('확장에 견적서와 첨부 파일을 준비했습니다. 같은 Chrome의 Supplier Hub 대량 등록 탭에서 확장을 눌러 파일을 전달하세요. 아직 등록되지 않았습니다.');
          return;
        }
        const url=URL.createObjectURL(blob);const anchor=document.createElement('a');
        anchor.href=url;anchor.download=action==='download'?preview!.filename:`YOOFAM-PLUS-quotation-${productId}.zip`;anchor.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
        setMessage(action==='download'?'검토한 견적서 파일을 내려받았습니다.':'작성된 견적서와 첨부 파일을 내려받았습니다. Supplier Hub 등록은 아직 실행되지 않았습니다.');
      }
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'견적서 준비 실패');}
    finally{if(active.current===controller){active.current=null;if(!controller.signal.aborted)setBusy(false);}}
  }
  return <section className="panel-stack" aria-label="견적서와 첨부 파일 준비" aria-busy={busy}>
    <button type="button" className="btn primary" disabled={busy} onClick={()=>void run('preview')}>{busy?'견적서 준비 중…':'견적서 + 첨부 파일 준비'}</button>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {preview&&<>
      <strong>저장된 양식으로 작성한 견적서 · {preview.report.rowCount}행</strong>
      <p style={{overflowWrap:'anywhere'}}>견적서 파일명: {preview.filename}</p>
      <strong>첨부 파일 검사 · 수정 필요 {preview.submissionReview.errorCount}개 · 확인 {preview.submissionReview.reviewCount}개</strong>
      <QuotationReviewIssues key={preview.fingerprint} issues={preview.submissionReview.issues} omittedIssueCount={preview.submissionReview.omittedIssueCount} disabled={busy} onInspect={target=>onInspect(preview.report.profileId,{...target,categoryId})}/>
      <details><summary>Excel 입력값 확인</summary><div className="table-wrap"><table><thead><tr>{preview.headers.map((header,index)=><th key={index}>{header||`${index+1}열`}</th>)}</tr></thead><tbody>{preview.rows.map((row,index)=><tr key={index}>{row.map((cell,column)=><td key={column}>{String(cell)||'—'}</td>)}</tr>)}</tbody></table></div></details>
      <details><summary>양식·첨부 확인 항목 ({preview.report.warnings.length})</summary><ul>{preview.report.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>
      <p>ZIP에는 작성된 Excel/CSV, 상품 이미지, 라벨과 업로드 준비 목록이 포함됩니다. 검토 후 저장값이 바뀌면 다시 준비해야 합니다.</p>
      <button type="button" className="btn primary" disabled={busy} onClick={()=>void run('download')}>견적서 파일 다운로드</button>
      <button type="button" className="btn primary" disabled={busy} onClick={()=>void run('export')}>확인한 견적서 + 첨부 ZIP 다운로드</button>
      <button type="button" className="btn primary" disabled={busy||!categoryId||!preview.filename.endsWith('.xlsx')||preview.submissionReview.errorCount>0} onClick={()=>void run('handoff')}>Supplier Hub 확장으로 파일 준비</button>
      <a href="/downloads/yoofam-plus-supplier-hub-extension-0.2.1.zip" download>첨부 확장 다운로드 (0.2.1)</a>
    </>}
  </section>;
}
