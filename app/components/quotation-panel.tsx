'use client';

import type { QuotationNavigationTarget } from '@/app/quotation-navigation';

import { useEffect, useState } from 'react';
import type { CategoryProfile } from '@/app/category-profiles';
import { QuotationFieldsEditor } from '@/app/components/quotation-fields-editor';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { selectQuotationProfile } from '@/app/quotation-profile-selection';

type Preview = {
  fingerprint:string;filename:string;headers:string[];rows:(string|number)[][];
  report:{mappingCoverage?:{fieldId:string;label:string;required:boolean;manualOptions:{optionId:string|null;optionLabel:string}[]}[];rowCount:number;missingRequired:{row:number;column:number;header:string}[];warnings:string[];contentRevision:number;optionRevision:number;profileRevision:number};
};
type QuotationPanelProps = {navigationTarget?:QuotationNavigationTarget;productId:string;onManageCategories:()=>void;refreshToken?:string;preferredProfileId?:string};
export function QuotationPanel(props: QuotationPanelProps) {
  return <QuotationPanelContent key={`${props.productId}:${props.preferredProfileId ?? ''}`} {...props}/>;
}
function QuotationPanelContent({productId,onManageCategories,refreshToken,preferredProfileId,navigationTarget}: QuotationPanelProps) {
  const [profiles,setProfiles]=useState<CategoryProfile[]>([]);
  const [profileId,setProfileId]=useState('');const [startRow,setStartRow]=useState(2);
  const [preview,setPreview]=useState<Preview|null>(null);const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');const [message,setMessage]=useState('');
  const [dirty,setDirty]=useState(false);
  const [overrideProfileId,setOverrideProfileId]=useState<string|undefined>();
  const [contextLoaded,setContextLoaded]=useState(false);
  const [contextError,setContextError]=useState('');
  const [connectionWarning,setConnectionWarning]=useState('');
  const [loadAttempt,setLoadAttempt]=useState(0);
  const [capturedCategoryId,setCapturedCategoryId]=useState<string|null>(null);
  useEffect(()=>{
    const controller=new AbortController();

    Promise.all([
      fetch('/api/category-profiles',{cache:'no-store',signal:controller.signal}).then(async response=>{
        const body=await response.json() as {profiles:CategoryProfile[];error?:string};if(!response.ok)throw new Error(body.error||'카테고리 목록을 읽지 못했습니다.');return body.profiles;
      }),
      fetch(`/api/products/${encodeURIComponent(productId)}/quotation-fields`,{cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json() as QuotationFieldsView & {error?:string};if(!response.ok)throw new Error(body.error||'수집 당시 카테고리를 읽지 못했습니다.');return body;}),
    ]).then(([savedProfiles,data])=>{
      if(controller.signal.aborted)return;
      const selection=selectQuotationProfile(savedProfiles,data.categoryContext,preferredProfileId);
      const savedId=selection.profileId;
      setConnectionWarning(selection.warning);
      setProfiles(savedProfiles);setProfileId(savedId);setOverrideProfileId(savedId||undefined);
      setCapturedCategoryId(data?.categoryContext.categoryId ?? null);
      setStartRow((savedProfiles.find(profile=>profile.id===savedId)?.template?.headerRow??1)+1);
    }).catch(cause=>{if(!controller.signal.aborted)setContextError(cause instanceof Error?cause.message:'카테고리 연결 확인 실패');})
      .finally(()=>{if(!controller.signal.aborted)setContextLoaded(true);});
    return()=>controller.abort();
  },[productId,preferredProfileId,loadAttempt]);
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
  if(contextError)return <section className="panel-stack"><p role="alert">{contextError}</p><button type="button" className="btn primary" onClick={()=>{setContextError('');setContextLoaded(false);setLoadAttempt(value=>value+1);}}>카테고리 연결 다시 확인</button><button type="button" className="btn ghost" onClick={onManageCategories}>카테고리·양식 설정 확인</button></section>;
  return <section className="panel-stack" aria-busy={busy}>
    {connectionWarning && !overrideProfileId && <p role="status" className="panel-note">{connectionWarning}</p>}
    {contextLoaded?<QuotationFieldsEditor navigationTarget={navigationTarget} productId={productId} profileId={overrideProfileId} refreshToken={refreshToken} onDirtyChange={setDirty} onSaved={()=>setPreview(null)}/>:<p role="status">선택한 카테고리와 견적서 설정을 불러오고 있습니다.</p>}
    <a className={`btn primary${dirty||!contextLoaded?' disabled':''}`} aria-disabled={dirty||!contextLoaded} tabIndex={dirty||!contextLoaded?-1:undefined} href={dirty||!contextLoaded?undefined:`/api/products/${encodeURIComponent(productId)}/bundle${overrideProfileId?`?profileId=${encodeURIComponent(overrideProfileId)}`:''}`}>견적 입력 내용 + 첨부 자료 다운로드</a>
    <p className="panel-note">ZIP 압축을 푼 뒤 supplier-hub-upload.html을 열면 상품 이미지와 라벨을 구분해서 확인할 수 있습니다. 옵션별 연결과 누락 라벨을 확인한 뒤, 공식 견적서 및 서류를 별도로 검토해주세요.</p>
    {dirty&&<small>편집 내용을 저장하면 다운로드에 반영됩니다.</small>}
    <details><summary>Excel 원본 양식에 출력하기</summary>
    <div className="panel-note"><div><strong>공식 Excel 양식 준비</strong><ol>
      <li><a href="https://supplier.coupang.com/qvt/registration" target="_blank" rel="noreferrer">Supplier Hub 대량 상품 등록</a>에서 ‘최신 견적서 파일 다운로드’를 누르세요.</li>
      <li>다운로드 창에서 실제 상품의 마지막 카테고리를 선택하세요. 한 번에 최대 6개를 선택할 수 있습니다.</li>
      <li>내려받은 원본을 아래 ‘카테고리·양식 관리’에서 연결하고 시트·머리글·입력 시작 행을 확인하세요.</li>
    </ol>
    {(selected?.categoryId ?? capturedCategoryId)==='80719' && <p>바스켓 이름으로 확인한 공식 탐색 경로: 주방용품 → 주방수납/잡화 → 건조대/진열대/정리대 → 주방수납바구니/바스켓</p>}
    <small>2026-09-23 다운로드 화면 관찰 기준입니다. 이 화면의 ‘칸 카테고리 아이디’와 앱의 상품 카테고리 코드는 동일하다고 검증되지 않았습니다. 코드가 검색되지 않으면 분류명으로 탐색하세요. 경로 안내만으로 Excel 원본 연결이 완료되지는 않습니다.</small></div></div>
    <div className="panel-note"><div><strong>저장한 양식으로 견적서 만들기</strong><p>상품·옵션·이미지 자료를 연결된 Excel 열에 채웁니다. 원본은 보존하고 채운 사본과 첨부 이미지를 ZIP으로 내려받습니다.</p></div></div>
    <label className="field"><span>카테고리·견적서 연결</span><select value={profileId} disabled={busy||dirty} onChange={event=>{setProfileId(event.target.value);setOverrideProfileId(event.target.value||undefined);setPreview(null);setStartRow((profiles.find(profile=>profile.id===event.target.value)?.template?.headerRow??1)+1);}}><option value="">수집할 때 선택한 카테고리 사용</option>{profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name}{profile.template?'':' · 양식 미연결'}</option>)}</select></label>
    {selected&&<p>{selected.categoryPath.join(' > ')}<br/>{selected.template?.name??'원본 양식을 먼저 연결해주세요.'}</p>}
    <label className="field"><span>상품 데이터 입력 시작 행</span><input type="number" min={2} max={10000} value={startRow} disabled={busy} onChange={event=>{setStartRow(Number(event.target.value));setPreview(null);}}/></label>
    <small>머리글 다음의 실제 입력 행을 지정하세요. 기존 수식이나 병합 셀을 덮어쓰는 요청은 중단합니다.</small>
    <div className="quote-actions"><button className="btn ghost" type="button" disabled={dirty} onClick={onManageCategories}>카테고리·양식 관리</button><button className="btn primary" type="button" disabled={busy||dirty||!selected?.template} onClick={()=>void request('preview')}>{busy?'자료 확인 중…':'견적 자료 검토'}</button></div>
    {error&&<p role="alert" className="collection-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {preview&&<>
      <h3>출력 미리보기 · {preview.report.rowCount}행</h3>
      <div className="table-wrap quote-preview"><table><thead><tr>{preview.headers.map((header,index)=><th key={index}>{header||`${index+1}열`}</th>)}</tr></thead><tbody>{preview.rows.map((row,index)=><tr key={index}>{row.map((value,column)=><td key={column}>{String(value)||'—'}</td>)}</tr>)}</tbody></table></div>
      {preview.report.missingRequired.length>0&&<div className="panel-note"><div><strong>필수 연결 값 {preview.report.missingRequired.length}개 미입력</strong><ul>{preview.report.missingRequired.map((field,index)=><li key={index}>{field.row}행 · {field.header||`${field.column}열`}</li>)}</ul></div></div>}
      {!!preview.report.mappingCoverage?.length && <div className="panel-note"><strong>Excel 열 연결 확인 {preview.report.mappingCoverage.length}개</strong><ul>{preview.report.mappingCoverage.map(field=><li key={field.fieldId}>{field.label} · {field.required?'카테고리 필수':'수동 수정'}{field.manualOptions.length>0?` · 직접 수정한 옵션 ${field.manualOptions.length}개`:''}</li>)}</ul><button type="button" className="btn ghost" disabled={busy||dirty} onClick={onManageCategories}>카테고리·양식 연결 수정</button></div>}
      <ul className="quote-warnings">{preview.report.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>
      <small>콘텐츠 v{preview.report.contentRevision} · 옵션 v{preview.report.optionRevision} · 카테고리 연결 v{preview.report.profileRevision}</small>
      <button className="btn primary" type="button" disabled={busy||dirty} onClick={()=>void request('export')}>채운 견적서 + 첨부 자료 ZIP 다운로드</button>
    </>}</details>
  </section>;
}
