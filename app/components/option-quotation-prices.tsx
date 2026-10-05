'use client';
import { useEffect, useRef, useState } from 'react';
import { quotationPriceIssues, quotationValueIssues, type QuotationFieldsView, type QuotationChange } from '@/app/quotation-schema';

const prices = [['supplyPrice','공급가'],['salePrice','판매가'],['msrp','권장소비자가']] as const;
function verifyDraftRefresh(base:QuotationFieldsView,latest:QuotationFieldsView,edits:QuotationChange[]) {
 if(latest.revision<base.revision || JSON.stringify(base.categoryContext)!==JSON.stringify(latest.categoryContext))throw Error('가격의 카테고리 또는 저장 버전이 달라졌습니다. 입력은 유지했습니다.');
 for(const edit of edits){
  const before=base.resolved.rows.find(row=>row.optionId===edit.optionId),after=latest.resolved.rows.find(row=>row.optionId===edit.optionId);
  const oldField=base.resolved.schema.fields.find(field=>field.id===edit.fieldKey),newField=latest.resolved.schema.fields.find(field=>field.id===edit.fieldKey);
  if(!before?.included || !after?.included || JSON.stringify(oldField)!==JSON.stringify(newField))throw Error('수정 중인 옵션 또는 가격 항목이 변경되었습니다. 입력은 유지했습니다.');
  const manual=(view:QuotationFieldsView)=>edit.optionId===null?view.overrides.common[edit.fieldKey]??null:view.overrides.options[edit.optionId]?.[edit.fieldKey]??null;
  if(manual(base)!==manual(latest) && manual(latest)!==edit.value)throw Error('수정 중인 가격에 다른 저장값이 있습니다. 입력을 보관한 뒤 저장 가격과 비교해주세요.');
 }
}
export function OptionQuotationPrices({productId,version,profileId,onSaved,refreshToken}:{productId:string;version:string;profileId?:string;onSaved?:()=>void;refreshToken?:string}) {
 const [view,setView]=useState<QuotationFieldsView|null>(null);
 const [edits,setEdits]=useState<QuotationChange[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [loadedSource,setLoadedSource]=useState('');
 const request=useRef<AbortController|null>(null);
 const endpoint=`/api/products/${encodeURIComponent(productId)}/quotation-fields${profileId?`?profileId=${encodeURIComponent(profileId)}`:''}`;
 const sourceKey=JSON.stringify([endpoint,version,refreshToken]);
 const editingEndpoint=useRef(endpoint);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function load(keepEdits=false){
  if(request.current)return;
  const controller=new AbortController();request.current=controller;setBusy(true);setError('');
  try{const response=await fetch(endpoint,{cache:'no-store',signal:controller.signal});const body=await response.json() as QuotationFieldsView & {error?:string};
   if(controller.signal.aborted)return;
   if(!response.ok||body.productVersion!==version||!body.resolved?.rows||!body.automatic?.rows)throw Error(body.error||'저장된 옵션 가격을 읽지 못했습니다.');
   if(keepEdits){if(!view)throw Error('기존 가격을 확인하지 못했습니다.');verifyDraftRefresh(view,body,edits);}
   setView(body);setLoadedSource(sourceKey);if(!keepEdits)setEdits([]);setMessage(keepEdits?'입력을 유지하고 최신 가격을 불러왔습니다. 확인 후 옵션 가격을 저장해주세요.':'');
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'가격 조회 실패');}
  finally{if(request.current===controller)request.current=null;if(!controller.signal.aborted)setBusy(false);}
 }
 useEffect(()=>{
  let active=true;
  void Promise.resolve().then(()=>{
   if(!active)return;
   setBusy(false);
   // Preserve edits on a refresh of this quotation only. Another product or
   // category must never display or submit this quotation's pending prices.
   if(editingEndpoint.current!==endpoint){
    editingEndpoint.current=endpoint;setView(null);setEdits([]);setMessage('');void load();return;
   }
   if(edits.length)return;void load();
  });
  return()=>{active=false;request.current?.abort();request.current=null;};
 },[endpoint,version,refreshToken]);
 const rows=view?.resolved.rows.filter(row=>row.included)??[];
 function value(optionId:string|null,fieldKey:string){
  const edit=edits.find(change=>change.optionId===optionId&&change.fieldKey===fieldKey);
  if(edit?.value===null){const common=optionId===null?undefined:view?.overrides.common[fieldKey];return common??view?.automatic.rows.find(row=>row.optionId===optionId)?.fields[fieldKey]?.value??'';}
  return edit?.value??view?.resolved.rows.find(row=>row.optionId===optionId)?.fields[fieldKey]?.value??'';
 }
 function sourceIssues(optionId:string|null,fieldKey:string){
  const manual=(id:string|null)=>{
   const edit=edits.find(change=>change.optionId===id&&change.fieldKey===fieldKey);
   return edit?edit.value:(id===null?view?.overrides.common[fieldKey]:view?.overrides.options[id]?.[fieldKey])??null;
  };
  const reviewed=(optionId===null?null:manual(optionId))??manual(null);
  const automatic=view?.automatic.rows.find(row=>row.optionId===optionId)?.fields[fieldKey]
   ??view?.resolved.rows.find(row=>row.optionId===optionId)?.fields[fieldKey];
  // Restoration uses the same source diagnostics as stage seven. An optional
  // blank produced by a calculation failure is not a reviewed empty price.
  return reviewed!==null?[]:(automatic?.validationIssues??automatic?.issues??[])
   .filter(issue=>issue!=='판매가는 공급가보다 작을 수 없습니다.');
 }
 function change(optionId:string|null,fieldKey:string,value:string|null){
  if(request.current)return;
  setEdits(previous=>[...previous.filter(item=>item.optionId!==optionId||item.fieldKey!==fieldKey),{optionId,fieldKey,value}]);setMessage('');
 }
 const issues=view?rows.flatMap(row=>[
  ...prices.flatMap(([key,label])=>{const field=view.resolved.schema.fields.find(field=>field.id===key);
   return [...new Set([...sourceIssues(row.optionId,key),...(field?quotationValueIssues(field,value(row.optionId,key),view.imageKeys):[])])].map(issue=>`${row.optionLabel||'상품 공통'} · ${label}: ${issue}`);}),
  ...quotationPriceIssues(view.resolved.schema,value(row.optionId,'supplyPrice'),value(row.optionId,'salePrice')).map(issue=>`${row.optionLabel||'상품 공통'} · 판매가: ${issue}`),
 ]):[];
 async function save(){
  if(!view||!edits.length||issues.length||request.current)return;
  const controller=new AbortController();request.current=controller;setBusy(true);setError('');
  try{const response=await fetch(endpoint,{method:'PUT',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:edits})});const body=await response.json() as QuotationFieldsView & {error?:string};
   if(controller.signal.aborted)return;
   if(!response.ok||!body.resolved?.rows)throw Error(body.error||'가격을 저장하지 못했습니다. 입력은 유지됩니다.');
   setView(body);setEdits([]);setMessage('옵션 가격 저장 완료 · 7단계 견적서에 반영됩니다.');onSaved?.();
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'가격 저장 실패');}
  finally{if(request.current===controller)request.current=null;if(!controller.signal.aborted)setBusy(false);}
 }
 return <section aria-label="옵션별 견적 가격 편집" data-workspace-dirty={edits.length>0} data-workspace-saving={busy}>
  <h4>옵션별 가격</h4>
  {view&&<p>{view.categoryContext.categoryPath.join(' > ')} · {view.categoryContext.categoryId||'카테고리 미지정'}</p>}
  <p>7단계 견적서와 같은 가격입니다. 직접 입력한 값은 자동 계산보다 우선하며, 복원하면 공통 수정값 또는 자동 계산을 사용합니다.</p>
  {busy&&<p role="status">가격 처리 중…</p>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {!!edits.length&&view&&loadedSource!==sourceKey&&<p role="status">상품 정보가 변경됐습니다. 입력을 유지한 채 최신 가격을 조회한 뒤 저장해주세요.</p>}
  {!!rows.length&&<div className="table-wrap"><table><thead><tr><th>옵션</th>{prices.map(([key,label])=><th key={key}>{label} (원)</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.optionId??'common'}><th scope="row">{row.optionLabel||'상품 공통'}</th>{prices.map(([key,label])=><td key={key}><input aria-label={`${row.optionLabel||'상품 공통'} ${label}`} type="number" min={1} step={1} value={value(row.optionId,key)} disabled={busy} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}} onChange={event=>change(row.optionId,key,event.target.value)}/><button type="button" className="btn ghost" disabled={busy} onClick={()=>change(row.optionId,key,null)}>복원</button></td>)}</tr>)}</tbody></table></div>}
  {view&&!rows.length&&<p>견적서에 포함한 옵션이 없습니다.</p>}
  {!!issues.length&&<p role="alert">{[...new Set(issues)].join(' ')}</p>}
  <button type="button" className="btn primary" disabled={busy||!edits.length||!!issues.length} onClick={()=>void save()}>옵션 가격 저장</button>
  {!!edits.length&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>void load(true)}>입력 유지·최신 가격 조회</button>}
  <button type="button" className="btn ghost" disabled={busy} onClick={()=>void load()}>{edits.length?'입력 취소·저장 가격 다시 조회':'저장 가격 다시 조회'}</button>
 </section>;
}
