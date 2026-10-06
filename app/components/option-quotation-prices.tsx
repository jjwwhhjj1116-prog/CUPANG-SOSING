'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { QuotationFieldsView, QuotationChange } from '@/app/quotation-schema';
import { quotationPriceTargets, type QuotationPriceInput, type QuotationPriceTargets } from '@/app/quotation-price-targets';
import { optionPriceChanges, optionPriceDraftIssues, optionPriceValue, verifyOptionPriceRefresh, verifyOptionPriceSave, verifyOptionPriceView } from '@/app/option-price-save';

const prices = [['supplyPrice','공급가'],['salePrice','판매가'],['msrp','권장소비자가']] as const;
export function OptionQuotationPrices({productId,version,profileId,onSaved,refreshToken}:{productId:string;version:string;profileId?:string;onSaved?:()=>void;refreshToken?:string}) {
  const endpoint = `/api/products/${encodeURIComponent(productId)}/quotation-fields${profileId?`?profileId=${encodeURIComponent(profileId)}`:''}`;
  const sourceKey = JSON.stringify([endpoint,version,refreshToken]);
  const currentEndpoint = useRef(endpoint), currentSource = useRef(sourceKey), mounted = useRef(true), request = useRef<AbortController|null>(null);
  const [saved,setSaved] = useState<{endpoint:string;sourceKey:string;view:QuotationFieldsView}|null>(null), latestSaved = useRef<typeof saved>(null);
  const [pending,setPending] = useState<{endpoint:string;edits:QuotationChange[]}>({endpoint,edits:[]}), latestDraft = useRef({endpoint,edits:[] as QuotationChange[]});
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState('');
  const current = () => mounted.current && currentEndpoint.current===endpoint && currentSource.current===sourceKey;
  useLayoutEffect(()=>{
    mounted.current=true;currentEndpoint.current=endpoint;currentSource.current=sourceKey;
    if(latestDraft.current.endpoint!==endpoint)latestDraft.current={endpoint,edits:[]};
    return()=>{mounted.current=false;request.current?.abort();request.current=null;};
  },[endpoint,sourceKey]);
  const view = saved?.endpoint===endpoint?saved.view:null, edits = pending.endpoint===endpoint?pending.edits:[];
  const fresh = saved?.sourceKey===sourceKey;
  function store(body:QuotationFieldsView){latestSaved.current={endpoint,sourceKey,view:body};setSaved(latestSaved.current);}
  function clearDraft(){latestDraft.current={endpoint,edits:[]};setPending(latestDraft.current);}
  function finish(controller:AbortController){if(request.current===controller){request.current=null;if(!controller.signal.aborted&&current())setBusy(false);}}
  async function load(keepEdits=false,explicitLatest=false){
    if(request.current||!current())return;
    const controller=new AbortController();request.current=controller;setBusy(true);setError('');
    try{
      const response=await fetch(endpoint,{cache:'no-store',signal:controller.signal}),body=await response.json() as QuotationFieldsView & {error?:string};
      if(controller.signal.aborted||!current())return;
      if(!response.ok)throw Error(body.error||'저장된 옵션 가격을 읽지 못했습니다.');verifyOptionPriceView(body,profileId);
      const base=latestSaved.current?.endpoint===endpoint?latestSaved.current.view:null,editing=latestDraft.current.endpoint===endpoint?latestDraft.current.edits:[];
      let recovered=false;
      if(keepEdits||explicitLatest){
        if(!base||Date.parse(body.productVersion)<Date.parse(version))throw Error('최신 상품 가격 저장 상태를 확인하지 못했습니다. 입력은 유지했습니다.');verifyOptionPriceRefresh(base,body,keepEdits?editing:[]);
        if(keepEdits&&editing.length){try{verifyOptionPriceSave(base,body,editing);recovered=true;}catch{/* Keep a disjoint refresh or an unresolved save outcome editable. */}}
      }else if(body.productVersion!==version)throw Error('상품 저장 상태가 변경됐습니다. 최신 가격을 다시 확인해주세요.');
      store(body);if(!keepEdits||recovered)clearDraft();
      setMessage(recovered?'저장된 옵션 가격을 확인했습니다.':keepEdits?'입력을 유지하고 최신 가격을 불러왔습니다. 확인 후 옵션 가격을 저장해주세요.':'');
      if(recovered)onSaved?.();
    }catch(cause){if(!controller.signal.aborted&&current())setError(cause instanceof Error?cause.message:'가격 조회 실패');}
    finally{finish(controller);}
  }
  useEffect(()=>{
    let active=true;
    void Promise.resolve().then(()=>{
      if(!active||!current())return;setBusy(false);setError('');setMessage('');
      if(latestDraft.current.endpoint===endpoint&&latestDraft.current.edits.length&&latestSaved.current?.endpoint===endpoint)return;
      void load();
    });
    return()=>{active=false;request.current?.abort();request.current=null;};
    // Source commits retain manual prices. Only explicit refresh/discard rebases
    // a dirty save base; changing product/category immediately hides old data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[endpoint,sourceKey]);
  const rows=view?.resolved.rows.filter(row=>row.included)??[];
  let targets:QuotationPriceTargets|undefined,targetError='';
  if(view)try{targets=quotationPriceTargets(view.resolved.schema.fields);}catch(cause){targetError=cause instanceof Error?cause.message:'가격 연결을 확인해주세요.';}
  const value=(optionId:string|null,fieldKey:string)=>view?optionPriceValue(view,optionId,fieldKey,edits):'';
  function change(optionId:string|null,input:QuotationPriceInput,newValue:string|null){
    const base=latestSaved.current;
    if(!base||base.endpoint!==endpoint||request.current||!current()||!base.view.resolved.rows.some(row=>row.optionId===optionId&&row.included))return;
    const fields=quotationPriceTargets(base.view.resolved.schema.fields)[input].linked,previous=latestDraft.current.endpoint===endpoint?latestDraft.current.edits:[];
    latestDraft.current={endpoint,edits:[...previous.filter(item=>item.optionId!==optionId||!fields.includes(item.fieldKey)),...fields.map(fieldKey=>({optionId,fieldKey,value:newValue}))]};
    setPending(latestDraft.current);setMessage('');
  }
  let issues:string[]=[];
  if(view&&targets)try{issues=optionPriceDraftIssues(view,edits);}catch(cause){targetError=cause instanceof Error?cause.message:'가격 입력을 확인해주세요.';}
  const differences=targets?rows.flatMap(row=>prices.flatMap(([key,label])=>targets![key].linked.some(fieldKey=>value(row.optionId,fieldKey)!==value(row.optionId,targets![key].primary))
    ?[`${row.optionLabel||'상품 공통'} · ${label}: 이전 공통·직접 수정값과 Supplier Hub 가격이 다릅니다. 기존 값은 유지했습니다. 아래에서 가격을 직접 입력하면 두 항목에 함께 반영됩니다.`]:[])):[];
  async function save(){
    const base=latestSaved.current,editing=latestDraft.current.endpoint===endpoint?latestDraft.current.edits:[];
    if(!base||base.endpoint!==endpoint||!editing.length||request.current||!current())return;
    if(base.sourceKey!==sourceKey){setError('상품 정보가 변경됐습니다. 입력을 유지하고 최신 가격을 조회한 뒤 저장해주세요.');return;}
    let changes;try{changes=optionPriceChanges(base.view,editing);}catch(cause){setError(cause instanceof Error?cause.message:'가격 입력을 확인해주세요.');return;}
    const controller=new AbortController();request.current=controller;setBusy(true);setError('');setMessage('');
    try{
      const response=await fetch(endpoint,{method:'PUT',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:base.view.revision,expectedInputFingerprint:base.view.inputFingerprint,changes})}),body=await response.json() as QuotationFieldsView & {error?:string};
      if(controller.signal.aborted||!current())return;
      if(!response.ok)throw Error(body.error||'가격을 저장하지 못했습니다. 입력은 유지됩니다.');verifyOptionPriceView(body,profileId);verifyOptionPriceSave(base.view,body,changes);
      store(body);clearDraft();setMessage('옵션 가격 저장 완료 · 7단계 견적서에 반영됩니다.');onSaved?.();
    }catch(cause){if(!controller.signal.aborted&&current())setError(cause instanceof Error?cause.message:'가격 저장 실패');}
    finally{finish(controller);}
  }
  return <section aria-label="옵션별 견적 가격 편집" data-workspace-dirty={edits.length>0} data-workspace-saving={busy}>
    <h4>옵션별 가격</h4>
    {view&&<p>{view.categoryContext.categoryPath.join(' > ')} · {view.categoryContext.categoryId||'카테고리 미지정'}</p>}
    <p>7단계 견적서의 Supplier Hub 가격입니다. 직접 입력하면 연결된 가격 항목에 함께 반영됩니다. 복원하면 각 항목의 공통 수정값 또는 자동 계산을 사용합니다. 공식 판매처 가격은 별도 항목으로 유지됩니다.</p>
    {busy&&<p role="status">가격 처리 중…</p>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {!!edits.length&&view&&!fresh&&<p role="status">상품 정보가 변경됐습니다. 입력을 유지한 채 최신 가격을 조회한 뒤 저장해주세요.</p>}
    {targetError&&<p role="alert">{targetError}</p>}{!!differences.length&&<p role="status">{differences.join(' ')}</p>}
    {!!rows.length&&<div className="table-wrap"><table><thead><tr><th>옵션</th>{prices.map(([key,label])=><th key={key}>{label} (원)</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.optionId??'common'}><th scope="row">{row.optionLabel||'상품 공통'}</th>{prices.map(([key,label])=><td key={key}><input aria-label={`${row.optionLabel||'상품 공통'} ${label}`} type="number" min={1} step={1} value={value(row.optionId,targets?.[key].primary??key)} disabled={busy||!targets} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}} onChange={event=>change(row.optionId,key,event.target.value)}/><button type="button" className="btn ghost" disabled={busy||!targets} onClick={()=>change(row.optionId,key,null)}>복원</button></td>)}</tr>)}</tbody></table></div>}
    {view&&!rows.length&&<p>견적서에 포함한 옵션이 없습니다.</p>}{!!issues.length&&<p role="alert">{[...new Set(issues)].join(' ')}</p>}
    <button type="button" className="btn primary" disabled={busy||!targets||!!targetError||!edits.length||!!issues.length} onClick={()=>void save()}>옵션 가격 저장</button>
    {!!edits.length&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>void load(true)}>입력 유지·최신 가격 조회</button>}
    <button type="button" className="btn ghost" disabled={busy} onClick={()=>void load(false,!!view)}>{edits.length?'입력 취소·저장 가격 다시 조회':'저장 가격 다시 조회'}</button>
  </section>;
}
