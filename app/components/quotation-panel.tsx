'use client';

import { useEffect, useState } from 'react';
import type { CategoryProfile } from '@/app/category-profiles';

type Preview = {
  fingerprint:string;filename:string;headers:string[];rows:(string|number)[][];
  report:{rowCount:number;missingRequired:{row:number;column:number;header:string}[];warnings:string[];contentRevision:number;optionRevision:number;profileRevision:number};
};
export function QuotationPanel({productId,onManageCategories}:{productId:string;onManageCategories:()=>void}) {
  const [profiles,setProfiles]=useState<CategoryProfile[]>([]);
  const [profileId,setProfileId]=useState('');const [startRow,setStartRow]=useState(2);
  const [preview,setPreview]=useState<Preview|null>(null);const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');const [message,setMessage]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/category-profiles',{cache:'no-store',signal:controller.signal}).then(async response=>{
      const body=await response.json() as {profiles:CategoryProfile[];error?:string};if(!response.ok)throw new Error(body.error||'카테고리 목록을 읽지 못했습니다.');
      if(!controller.signal.aborted)setProfiles(body.profiles);
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'카테고리 연결 확인 실패');});
    return()=>controller.abort();
  },[]);
  async function request(action:'preview'|'export') {
    setBusy(true);setError('');setMessage('');
    try {
      const response=await fetch(`/api/products/${encodeURIComponent(productId)}/quotation`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,profileId,dataStartRow:startRow,...(action==='export'?{fingerprint:preview?.fingerprint}:{})})});
      if(!response.ok){const body=await response.json() as {error?:string};if(response.status===409)setPreview(null);throw new Error(body.error||'견적서 생성 실패');}
      if(action==='preview')setPreview(await response.json());
      else {
        const url=URL.createObjectURL(await response.blob());const anchor=document.createElement('a');anchor.href=url;anchor.download='SourceFlow-quotation-review.zip';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        setMessage('견적서와 첨부 자료를 내려받았습니다. Supplier Hub에 전송되지는 않았습니다.');
      }
    }catch(cause){setError(cause instanceof Error?cause.message:'견적서 생성 실패');}
    finally{setBusy(false);}
  }
  const selected=profiles.find(profile=>profile.id===profileId);
  return <section className="panel-stack" aria-busy={busy}>
    <div className="panel-note"><div><strong>저장한 양식으로 견적서 만들기</strong><p>상품·옵션·이미지 자료를 연결된 Excel 열에 채웁니다. 원본은 보존하고 채운 사본과 첨부 이미지를 ZIP으로 내려받습니다.</p></div></div>
    <label className="field"><span>카테고리·견적서 연결</span><select value={profileId} disabled={busy} onChange={event=>{setProfileId(event.target.value);setPreview(null);setStartRow((profiles.find(profile=>profile.id===event.target.value)?.template?.headerRow??1)+1);}}><option value="">저장한 연결 선택</option>{profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name}{profile.template?'':' · 양식 미연결'}</option>)}</select></label>
    {selected&&<p>{selected.categoryPath.join(' > ')}<br/>{selected.template?.name??'원본 양식을 먼저 연결해주세요.'}</p>}
    <label className="field"><span>상품 데이터 입력 시작 행</span><input type="number" min={2} max={10000} value={startRow} disabled={busy} onChange={event=>{setStartRow(Number(event.target.value));setPreview(null);}}/></label>
    <small>머리글 다음의 실제 입력 행을 지정하세요. 기존 수식이나 병합 셀을 덮어쓰는 요청은 중단합니다.</small>
    <div className="quote-actions"><button className="btn ghost" type="button" onClick={onManageCategories}>카테고리·양식 관리</button><button className="btn primary" type="button" disabled={busy||!selected?.template} onClick={()=>void request('preview')}>{busy?'자료 확인 중…':'견적 자료 검토'}</button></div>
    {error&&<p role="alert" className="collection-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {preview&&<>
      <h3>출력 미리보기 · {preview.report.rowCount}행</h3>
      <div className="table-wrap quote-preview"><table><thead><tr>{preview.headers.map((header,index)=><th key={index}>{header||`${index+1}열`}</th>)}</tr></thead><tbody>{preview.rows.map((row,index)=><tr key={index}>{row.map((value,column)=><td key={column}>{String(value)||'—'}</td>)}</tr>)}</tbody></table></div>
      {preview.report.missingRequired.length>0&&<div className="panel-note"><div><strong>필수 연결 값 {preview.report.missingRequired.length}개 미입력</strong><ul>{preview.report.missingRequired.map((field,index)=><li key={index}>{field.row}행 · {field.header||`${field.column}열`}</li>)}</ul></div></div>}
      <ul className="quote-warnings">{preview.report.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>
      <small>콘텐츠 v{preview.report.contentRevision} · 옵션 v{preview.report.optionRevision} · 카테고리 연결 v{preview.report.profileRevision}</small>
      <button className="btn primary" type="button" disabled={busy} onClick={()=>void request('export')}>채운 견적서 + 첨부 자료 ZIP 다운로드</button>
    </>}
  </section>;
}
