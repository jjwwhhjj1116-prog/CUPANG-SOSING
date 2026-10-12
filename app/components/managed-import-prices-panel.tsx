'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import './managed-import-prices-panel.css';

type Matching='sku'|'barcode';
type RecordRow={skuId:string;title:string;exposureId:string;date:string;price:string};
type Counts={total:number;added:number;replaced:number;unchanged:number};
type Context={company:SupplierHubCompany;accountContext:string};
type Preview=Context&{preview:true;matching:Matching;sha256:string;snapshot:string;counts:Counts;sample:RecordRow[]};
type History=Context&{records:RecordRow[];total:number;page:number;pageSize:number};
const sameContext=(value:Context,context:Context)=>value.accountContext===context.accountContext&&value.company?.code===context.company.code&&value.company.name===context.company.name;
const digest=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const rowValid=(value:RecordRow)=>value&&typeof value.skuId==='string'&&/^\d{1,30}$/.test(value.skuId)&&typeof value.title==='string'&&typeof value.exposureId==='string'&&typeof value.price==='string'&&/^\d+(?:\.\d+)?$/.test(value.price)&&typeof value.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.date);
const countsValid=(value:Counts)=>value&&['total','added','replaced','unchanged'].every(key=>Number.isSafeInteger(value[key as keyof Counts])&&value[key as keyof Counts]>=0)&&value.total===value.added+value.replaced+value.unchanged;

/** The source spreadsheet and import review are distinct from supplier receipts. */
export function ManagedImportPricesPanel({company,accountContext,initialSkuId='',onClose,onImported}:{company:SupplierHubCompany;accountContext:string;initialSkuId?:string;onClose:()=>void;onImported:()=>void}){
 const context={company,accountContext},contextRef=useRef(context);
 const [tab,setTab]=useState<'upload'|'history'>(initialSkuId?'history':'upload'),[matching,setMatching]=useState<Matching>('sku'),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null),[confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[history,setHistory]=useState<History|null>(null),[historyLoading,setHistoryLoading]=useState(false),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(10),[skuDraft,setSkuDraft]=useState(initialSkuId),[skuId,setSkuId]=useState(initialSkuId),[refresh,setRefresh]=useState(0);
 const active=useRef<AbortController|null>(null),fileRef=useRef<{file:File|null;matching:Matching}>({file:null,matching:'sku'}),previewRef=useRef<Preview|null>(null),confirmedRef=useRef(false),closeButton=useRef<HTMLButtonElement|null>(null),exportSkuRef=useRef(initialSkuId);
 const contextKey=JSON.stringify([accountContext,company.code,company.name]);
 const currentPreview=preview&&sameContext(preview,context)&&preview.matching===matching?preview:null;
 const currentHistory=history&&sameContext(history,context)?history:null;
 useLayoutEffect(()=>{contextRef.current={company,accountContext};},[company,accountContext]);
 useLayoutEffect(()=>{exportSkuRef.current=skuId;},[skuId]);
 useEffect(()=>{closeButton.current?.focus();return()=>active.current?.abort();},[]);
 useEffect(()=>{active.current?.abort();active.current=null;fileRef.current={file:null,matching:'sku'};previewRef.current=null;confirmedRef.current=false;queueMicrotask(()=>{setFile(null);setPreview(null);setConfirmed(false);setBusy(false);setError('');setMessage('');setHistory(null);setPage(1);});},[contextKey]);
 useEffect(()=>{
  if(tab!=='history')return;const controller=new AbortController(),captured={company:{...company},accountContext};
  queueMicrotask(()=>{if(!controller.signal.aborted){setHistoryLoading(true);setError('');}});
  void(async()=>{try{
   const params=new URLSearchParams({page:String(page),pageSize:String(pageSize),...(skuId?{skuId}:{}),expectedAccountContext:accountContext}),response=await fetch('/api/managed-products/import-prices?'+params,{signal:controller.signal,cache:'no-store'}),body=await response.json() as History&{error?:string};
   if(!response.ok)throw Error(body.error||'매입정보를 읽지 못했습니다.');
   if(!sameContext(body,captured)||!Array.isArray(body.records)||body.records.some(row=>!rowValid(row))||!Number.isSafeInteger(body.total)||body.total<0||body.page!==page||body.pageSize!==pageSize||body.records.length>pageSize)throw Error('현재 회사의 매입정보 응답을 확인하지 못했습니다.');
   if(!controller.signal.aborted&&sameContext(contextRef.current,captured))setHistory(body);
  }catch(cause){if(!controller.signal.aborted&&sameContext(contextRef.current,captured)){setHistory(null);setError(cause instanceof Error?cause.message:'매입정보 조회 실패');}}
  finally{if(!controller.signal.aborted&&sameContext(contextRef.current,captured))setHistoryLoading(false);}})();return()=>controller.abort();
 },[contextKey,tab,page,pageSize,skuId,refresh,accountContext,company]);
 function chooseFile(next:File|null,mode:Matching){if(active.current)return;fileRef.current={file:next,matching:mode};previewRef.current=null;confirmedRef.current=false;setFile(next);setMatching(mode);setPreview(null);setConfirmed(false);setError('');setMessage('');}
 async function upload(commit:boolean){
  const source=fileRef.current,captured={company:{...company},accountContext},review=previewRef.current;
  if(active.current||!source.file||!sameContext(contextRef.current,captured)||commit&&(!review||!sameContext(review,captured)||review.matching!==source.matching||!confirmedRef.current))return;
  const controller=new AbortController();active.current=controller;setBusy(true);setError('');setMessage('');
  try{
   const form=new FormData();form.set('file',source.file);form.set('action',commit?'import':'preview');form.set('matching',source.matching);
   if(commit){form.set('expectedSha256',review!.sha256);form.set('expectedAccountContext',review!.accountContext);form.set('expectedSnapshot',review!.snapshot);}
   const response=await fetch('/api/managed-products/import-prices',{method:'POST',body:form,signal:controller.signal,credentials:'same-origin'}),body=await response.json() as Preview&{error?:string};
   if(!response.ok)throw Error(body.error||'매입정보 업로드를 확인하지 못했습니다.');
   if(!sameContext(body,captured)||body.preview!==!commit||body.matching!==source.matching||!countsValid(body.counts)||!digest(body.sha256)||!commit&&(!digest(body.snapshot)||!Array.isArray(body.sample)||body.sample.length>10||body.sample.some(row=>!rowValid(row))))throw Error('현재 회사와 매입정보 결과를 확인하지 못했습니다.');
   if(controller.signal.aborted||active.current!==controller||!sameContext(contextRef.current,captured)||fileRef.current!==source)return;
   if(commit){previewRef.current=null;confirmedRef.current=false;setPreview(null);setConfirmed(false);setMessage(`매입정보 ${body.counts.total.toLocaleString()}개 확인: 신규 ${body.counts.added.toLocaleString()}개, 교체 ${body.counts.replaced.toLocaleString()}개, 동일 ${body.counts.unchanged.toLocaleString()}개.`);setRefresh(value=>value+1);onImported();}
   else{previewRef.current=body;confirmedRef.current=false;setPreview(body);setConfirmed(false);}
  }catch(cause){if(!controller.signal.aborted&&sameContext(contextRef.current,captured)){previewRef.current=null;confirmedRef.current=false;setPreview(null);setConfirmed(false);setError(cause instanceof Error?cause.message:'업로드 응답을 확인하지 못했습니다. 같은 파일을 다시 미리보기해주세요.');}}
  finally{if(active.current===controller){active.current=null;if(!controller.signal.aborted)setBusy(false);}}
 }
 async function downloadTemplate(mode:Matching){
  if(active.current)return;const captured={company:{...company},accountContext},controller=new AbortController();active.current=controller;setBusy(true);setError('');
  try{
   const params=new URLSearchParams({matching:mode,expectedAccountContext:accountContext}),response=await fetch('/api/managed-products/import-prices/template?'+params,{signal:controller.signal,cache:'no-store'});
   if(!response.ok){const body=await response.json() as {error?:string};throw Error(body.error||'매입정보 양식을 내려받지 못했습니다.');}
   const filename=`YOOFAM-${company.code}-import-prices-${mode}.xlsx`;
   if(response.headers.get('content-type')?.split(';')[0]!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'||response.headers.get('x-managed-account-context')!==accountContext||response.headers.get('content-disposition')!==`attachment; filename="${filename}"`)throw Error('현재 회사의 매입정보 양식을 확인하지 못했습니다.');
   const blob=await response.blob();if(controller.signal.aborted||!sameContext(contextRef.current,captured))return;const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(cause){if(!controller.signal.aborted&&sameContext(contextRef.current,captured))setError(cause instanceof Error?cause.message:'매입정보 양식 다운로드 실패');}
  finally{if(active.current===controller){active.current=null;if(!controller.signal.aborted)setBusy(false);}}
 }
 async function downloadHistory(){
  if(active.current||historyLoading||!currentHistory?.total)return;const captured={company:{...company},accountContext},capturedSku=skuId,controller=new AbortController();active.current=controller;setBusy(true);setError('');
  try{
   const params=new URLSearchParams({expectedAccountContext:accountContext,...(capturedSku?{skuId:capturedSku}:{})}),response=await fetch('/api/managed-products/import-prices/export?'+params,{signal:controller.signal,cache:'no-store'});
   if(!response.ok){const body=await response.json() as {error?:string};throw Error(body.error||'매입정보 다운로드를 확인하지 못했습니다.');}
   const filename=`YOOFAM-${company.code}-import-prices.xlsx`;if(response.headers.get('content-type')?.split(';')[0]!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'||response.headers.get('x-managed-account-context')!==accountContext||response.headers.get('content-disposition')!==`attachment; filename="${filename}"`)throw Error('현재 회사의 매입정보 파일을 확인하지 못했습니다.');
   const blob=await response.blob();if(controller.signal.aborted||!sameContext(contextRef.current,captured)||exportSkuRef.current!==capturedSku)return;const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('현재 조건의 전체 매입정보를 Excel로 내려받았습니다.');
  }catch(cause){if(!controller.signal.aborted&&sameContext(contextRef.current,captured)&&exportSkuRef.current===capturedSku)setError(cause instanceof Error?cause.message:'매입정보 다운로드 실패');}
  finally{if(active.current===controller){active.current=null;if(!controller.signal.aborted)setBusy(false);}}
 }
 return <div className="managed-price-backdrop" onKeyDown={event=>{if(event.key==='Escape'&&!busy)onClose();}}><section className="managed-price-dialog" role="dialog" aria-modal="true" aria-labelledby="managed-price-title">
  <header><h3 id="managed-price-title">매입정보 관리</h3><button ref={closeButton} type="button" className="icon-close" aria-label="매입정보 관리 닫기" disabled={busy} onClick={onClose}>×</button></header>
  <p className="managed-price-company">{company.name} ({company.code})</p>
  <div role="tablist" aria-label="매입정보 메뉴" className="managed-price-tabs"><button role="tab" id="managed-price-upload-tab" aria-controls="managed-price-upload" aria-selected={tab==='upload'} disabled={busy} onClick={()=>setTab('upload')}>일괄 업로드</button><button role="tab" id="managed-price-history-tab" aria-controls="managed-price-history" aria-selected={tab==='history'} disabled={busy} onClick={()=>setTab('history')}>매입정보 관리</button></div>
  {error&&<p role="alert" className="managed-price-error">{error}</p>}{message&&<p role="status">{message}</p>}
  <div role="tabpanel" id="managed-price-upload" aria-labelledby="managed-price-upload-tab" hidden={tab!=='upload'}>
   <p><strong>[업로드 방법]</strong></p><p>1. 엑셀업로드 포맷 다운로드 → 2. 엑셀 파일에서 매입정보 업데이트 → 3. 업데이트된 엑셀 파일 업로드</p><p>* 동일 상품의 동일 날짜 데이터가 있으면 새 데이터로 교체됩니다.</p><p>매입일자별 금액을 저장합니다. 목록의 마진·ROI는 상품 DB 원본 값입니다.</p>
   {(['sku','barcode'] as Matching[]).map(mode=><section className="managed-price-upload-section" key={mode}><h4>{mode==='sku'?'SKU ID로 매칭':'바코드(barcode)로 매칭'}</h4><div><label>엑셀 포맷 다운로드<button type="button" aria-label={`${mode==='sku'?'SKU ID':'바코드'} 포맷 다운로드`} className="btn ghost" disabled={busy} onClick={()=>void downloadTemplate(mode)}>{mode==='sku'?'SKU ID':'바코드'} 포맷 다운로드</button></label><label>엑셀 파일 업로드<input type="file" aria-label={`${mode==='sku'?'SKU ID':'바코드'} 매입정보 XLSX`} accept=".xlsx" disabled={busy} onChange={event=>chooseFile(event.target.files?.[0]??null,mode)}/></label></div></section>)}
   {file&&<p>선택 파일: {file.name} · {matching==='sku'?'SKU ID':'바코드'}로 매칭</p>}
   <button type="button" className="btn primary" disabled={!file||busy} onClick={()=>void upload(false)}>{busy?'처리 중…':'업로드 미리보기'}</button>
   {currentPreview&&<div className="managed-price-preview"><strong>{company.name} · {currentPreview.counts.total.toLocaleString()}개 매입정보</strong><p>신규 {currentPreview.counts.added.toLocaleString()}개 · 같은 날짜 교체 {currentPreview.counts.replaced.toLocaleString()}개 · 동일 {currentPreview.counts.unchanged.toLocaleString()}개</p><div className="managed-price-table"><table><thead><tr><th>노출ID</th><th>SKU ID</th><th>상품명</th><th>매입일자</th><th>매입가</th></tr></thead><tbody>{currentPreview.sample.map(row=><tr key={row.skuId+'-'+row.date}><td>{row.exposureId||'—'}</td><td>{row.skuId}</td><td>{row.title}</td><td>{row.date}</td><td>{row.price}</td></tr>)}</tbody></table></div><label className="managed-price-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>{if(active.current||!sameContext(contextRef.current,currentPreview))return;confirmedRef.current=event.target.checked;setConfirmed(event.target.checked);}}/>{company.name}의 매칭 상품·날짜·매입가와 교체할 항목을 확인했습니다.</label><button type="button" className="btn primary" disabled={busy||!confirmed} onClick={()=>void upload(true)}>매입정보 적용</button></div>}
  </div>
  <div role="tabpanel" id="managed-price-history" aria-labelledby="managed-price-history-tab" hidden={tab!=='history'} aria-busy={historyLoading}>
   <button type="button" className="btn ghost" disabled={busy||historyLoading||!currentHistory?.total} onClick={()=>void downloadHistory()}>엑셀 다운로드</button>
   <form className="managed-price-search" onSubmit={event=>{event.preventDefault();if(skuDraft&&!/^\d{1,30}$/.test(skuDraft)){setError('검색할 SKU ID는 숫자로 입력해주세요.');return;}setSkuId(skuDraft);setPage(1);setError('');}}><label>SKU ID 검색<input value={skuDraft} maxLength={30} onChange={event=>setSkuDraft(event.target.value)}/></label><button className="btn ghost">검색</button><button type="button" className="btn ghost" onClick={()=>{setSkuDraft('');setSkuId('');setPage(1);}}>전체 보기</button><label>페이지당<select aria-label="매입정보 페이지당 수" value={pageSize} onChange={event=>{setPageSize(Number(event.target.value));setPage(1);}}>{[10,25,50,100].map(value=><option key={value} value={value}>{value}개</option>)}</select></label></form>
   <div className="managed-price-table"><table><thead><tr><th>노출ID</th><th>SKU ID</th><th>상품명</th><th>매입일자</th><th>매입가</th></tr></thead><tbody>{currentHistory?.records.map(row=><tr key={row.skuId+'-'+row.date}><td>{row.exposureId||'—'}</td><td>{row.skuId}</td><td>{row.title}</td><td>{row.date}</td><td>{row.price}</td></tr>)}{!historyLoading&&!currentHistory?.records.length&&<tr><td colSpan={5}>매입정보가 없습니다.</td></tr>}</tbody></table></div>
   <footer><button type="button" className="btn ghost" disabled={historyLoading||page===1} onClick={()=>setPage(value=>value-1)}>이전</button><span>{page} / {Math.max(1,Math.ceil((currentHistory?.total??0)/pageSize))} 페이지 · 총 {currentHistory?.total??0}개의 매입정보</span><button type="button" className="btn ghost" disabled={historyLoading||page*pageSize>=(currentHistory?.total??0)} onClick={()=>setPage(value=>value+1)}>다음</button></footer>
  </div>
 </section></div>;
}
