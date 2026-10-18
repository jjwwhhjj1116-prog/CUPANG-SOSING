'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { QuotationFieldsView, QuotationChange } from '@/app/quotation-schema';
import { optionRegistrationLabel } from '@/app/product-registration';
import { quotationPriceTargets, type QuotationPriceInput, type QuotationPriceTargets } from '@/app/quotation-price-targets';
import { optionPriceChanges, optionPriceDraftIssues, optionPriceValue, verifyOptionPriceRefresh, verifyOptionPriceSave, verifyOptionPriceView } from '@/app/option-price-save';
import type { PricePolicy } from '@/app/pricing';
import { stageTwoMsrpEdits } from '@/app/stage-two-msrp';

const prices = [['supplyPrice','공급가'],['salePrice','판매가'],['msrp','권장소비자가']] as const;
type Operation = { notify?:boolean; coordinated?:boolean; expectedProductVersion?:string; expectedOptionRevision?:number };
export type OptionPriceController = {
  view:QuotationFieldsView|null; edits:readonly QuotationChange[]; targets:QuotationPriceTargets|undefined;
  busy:boolean; dirty:boolean; fresh:boolean; uncertain:boolean; issues:string[];
  current:()=>boolean; snapshot:()=>{view:QuotationFieldsView|null;edits:QuotationChange[];fresh:boolean;uncertain:boolean;busy:boolean};
  change:(optionId:string|null,input:QuotationPriceInput,value:string|null)=>void;
  refresh:(keepEdits?:boolean,explicitLatest?:boolean,operation?:Operation)=>Promise<QuotationFieldsView|null>;
  save:(operation?:Operation)=>Promise<QuotationFieldsView|null>;
};
export function OptionQuotationPrices({productId,version,profileId,onSaved,refreshToken,disabled=false,beforeEdit,beforeSave,renderGrid,onLockChange,stageTwoPricingPolicy}:{productId:string;version:string;profileId?:string;onSaved?:()=>void;refreshToken?:string;stageTwoPricingPolicy?:PricePolicy;
  disabled?:boolean;beforeEdit?:()=>boolean;beforeSave?:()=>boolean;onLockChange?:(locked:boolean)=>void;renderGrid?:(controller:OptionPriceController)=>ReactNode}) {
  const endpoint = `/api/products/${encodeURIComponent(productId)}/quotation-fields${profileId?`?profileId=${encodeURIComponent(profileId)}`:''}`;
  const sourceKey = JSON.stringify([endpoint,version,refreshToken]);
  const currentEndpoint = useRef(endpoint), currentSource = useRef(sourceKey), mounted = useRef(true), request = useRef<AbortController|null>(null);
  const generation=useMemo(()=>({sourceKey}),[sourceKey]),epoch=useRef(generation);
  const endpointScope=useMemo(()=>({endpoint}),[endpoint]);
  const uncertainRef=useRef(false),[uncertain,setUncertain]=useState(false);
  const blocked=useRef(disabled);useLayoutEffect(()=>{blocked.current=disabled;},[disabled]);
  const [saved,setSaved] = useState<{endpoint:string;scope:object;sourceKey:string;view:QuotationFieldsView}|null>(null), latestSaved = useRef<typeof saved>(null);
  const [pending,setPending] = useState<{endpoint:string;scope:object;edits:QuotationChange[]}>({endpoint,scope:endpointScope,edits:[]}), latestDraft = useRef({endpoint,scope:endpointScope,edits:[] as QuotationChange[]});
  // Keep the exact augmented write separate from the user's raw price edits.
  // An ACK lost after commit must recover both sale and its derived MSRP.
  const lastPriceWrite=useRef<{scope:object;revision:number;fingerprint:string;editing:string;changes:QuotationChange[]}|null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState('');
  const current = () => mounted.current && epoch.current===generation && currentEndpoint.current===endpoint && currentSource.current===sourceKey;
  useLayoutEffect(()=>{
    mounted.current=true;epoch.current=generation;currentEndpoint.current=endpoint;currentSource.current=sourceKey;
    if(latestDraft.current.scope!==endpointScope){latestDraft.current={endpoint,scope:endpointScope,edits:[]};lastPriceWrite.current=null;uncertainRef.current=false;setUncertain(false);}
    return()=>{mounted.current=false;request.current?.abort();request.current=null;};
  },[endpoint,sourceKey,generation,endpointScope]);
  const view = saved?.scope===endpointScope?saved.view:null, edits = pending.scope===endpointScope?pending.edits:[];
  const fresh = saved?.scope===endpointScope&&saved?.sourceKey===sourceKey;
  function store(body:QuotationFieldsView){latestSaved.current={endpoint,scope:endpointScope,sourceKey,view:body};setSaved(latestSaved.current);}
  function clearDraft(){latestDraft.current={endpoint,scope:endpointScope,edits:[]};lastPriceWrite.current=null;setPending(latestDraft.current);uncertainRef.current=false;setUncertain(false);}
  function finish(controller:AbortController){if(request.current===controller){request.current=null;if(!controller.signal.aborted&&current()){setBusy(false);onLockChange?.(uncertainRef.current);}}}
  async function load(keepEdits=false,explicitLatest=false,operation:Operation={}){
    if(request.current||!current()||!operation.coordinated&&disabled)return null;
    const controller=new AbortController();request.current=controller;setBusy(true);setError('');
    try{
      const response=await fetch(endpoint,{cache:'no-store',signal:controller.signal}),body=await response.json() as QuotationFieldsView & {error?:string};
      if(controller.signal.aborted||!current())return null;
      if(!response.ok)throw Error(body.error||'저장된 옵션 가격을 읽지 못했습니다.');verifyOptionPriceView(body,profileId);
      if(operation.expectedProductVersion&&body.productVersion!==operation.expectedProductVersion
        ||operation.expectedOptionRevision!==undefined&&body.optionRevision!==operation.expectedOptionRevision)throw Error('옵션 저장 후의 정확한 견적서 버전을 확인하지 못했습니다. 가격 입력은 유지했습니다.');
      const base=latestSaved.current?.scope===endpointScope?latestSaved.current.view:null,editing=latestDraft.current.scope===endpointScope?latestDraft.current.edits:[];
      const attempt=lastPriceWrite.current;
      const recoveryChanges=attempt?.scope===endpointScope&&attempt.revision===base?.revision&&attempt.fingerprint===base?.inputFingerprint&&attempt.editing===JSON.stringify(editing)?attempt.changes:editing;
      const verifiedReceiptRead=operation.coordinated===true&&typeof operation.expectedProductVersion==='string'&&operation.expectedOptionRevision!==undefined&&!base&&!editing.length;
      let recovered=false;
      if(keepEdits||explicitLatest){
        if(!base||Date.parse(body.productVersion)<Date.parse(version))throw Error('최신 상품 가격 저장 상태를 확인하지 못했습니다. 입력은 유지했습니다.');verifyOptionPriceRefresh(base,body,keepEdits?recoveryChanges:[]);
        if(keepEdits&&editing.length){try{verifyOptionPriceSave(base,body,recoveryChanges);recovered=true;}catch{/* Keep a disjoint refresh or an unresolved save outcome editable. */}}
      }else if(body.productVersion!==version&&!verifiedReceiptRead)throw Error('상품 저장 상태가 변경됐습니다. 최신 가격을 다시 확인해주세요.');
      store(body);if(!keepEdits||recovered)clearDraft();else{lastPriceWrite.current=null;uncertainRef.current=false;setUncertain(false);}
      setMessage(recovered?'저장된 옵션 가격을 확인했습니다.':keepEdits?'입력을 유지하고 최신 가격을 불러왔습니다. 확인 후 옵션 가격을 저장해주세요.':'');
      if(recovered&&operation.notify!==false)onSaved?.();return body;
    }catch(cause){if(!controller.signal.aborted&&current())setError(cause instanceof Error?cause.message:'가격 조회 실패');return null;}
    finally{finish(controller);}
  }
  useEffect(()=>{
    let active=true;
    void Promise.resolve().then(()=>{
      if(!active||!current())return;setBusy(false);setError('');setMessage('');
      if(latestDraft.current.scope===endpointScope&&latestDraft.current.edits.length&&latestSaved.current?.scope===endpointScope)return;
      void load();
    });
    return()=>{active=false;request.current?.abort();request.current=null;};
    // Source commits retain manual prices. Only explicit refresh/discard rebases
    // a dirty save base; changing product/category immediately hides old data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[endpoint,sourceKey]);
  useEffect(()=>{
    let active=true;void Promise.resolve().then(()=>{
      if(!active||disabled||!current()||request.current||latestSaved.current?.scope===endpointScope&&latestSaved.current?.sourceKey===sourceKey||latestDraft.current.scope===endpointScope&&latestDraft.current.edits.length)return;
      void load();
    });return()=>{active=false;};
    // A parent source-save lock must not abort the coordinated price request.
    // Retry only an unprepared clean read when that lock is released.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[disabled,endpoint,sourceKey]);
  const rows=view?.resolved.rows.filter(row=>row.included)??[];
  let targets:QuotationPriceTargets|undefined,targetError='';
  if(view)try{targets=quotationPriceTargets(view.resolved.schema.fields);}catch(cause){targetError=cause instanceof Error?cause.message:'가격 연결을 확인해주세요.';}
  const value=(optionId:string|null,fieldKey:string)=>view?optionPriceValue(view,optionId,fieldKey,edits):'';
  function change(optionId:string|null,input:QuotationPriceInput,newValue:string|null){
    const base=latestSaved.current;
    if(!base||base.scope!==endpointScope||request.current||!current()||blocked.current||uncertainRef.current||beforeEdit?.()===false||!base.view.resolved.rows.some(row=>row.optionId===optionId&&row.included))return;
    lastPriceWrite.current=null;
    const fields=quotationPriceTargets(base.view.resolved.schema.fields)[input].linked,previous=latestDraft.current.scope===endpointScope?latestDraft.current.edits:[];
    latestDraft.current={endpoint,scope:endpointScope,edits:[...previous.filter(item=>item.optionId!==optionId||!fields.includes(item.fieldKey)),...fields.map(fieldKey=>({optionId,fieldKey,value:newValue}))]};
    setPending(latestDraft.current);setMessage('');
  }
  let issues:string[]=[];
  if(view&&targets)try{issues=optionPriceDraftIssues(view,edits);}catch(cause){targetError=cause instanceof Error?cause.message:'가격 입력을 확인해주세요.';}
  const differences=targets?rows.flatMap(row=>prices.flatMap(([key,label])=>targets![key].linked.some(fieldKey=>value(row.optionId,fieldKey)!==value(row.optionId,targets![key].primary))
    ?[`${optionRegistrationLabel(row.optionId,row.optionLabel||'상품 공통',view?.optionRegistrationNumbers)} · ${label}: 이전 공통·직접 수정값과 Supplier Hub 가격이 다릅니다. 기존 값은 유지했습니다. 아래에서 가격을 직접 입력하면 두 항목에 함께 반영됩니다.`]:[])):[];
  async function save(operation:Operation={}){
    const base=latestSaved.current,editing=latestDraft.current.scope===endpointScope?latestDraft.current.edits:[];
    if(!base||base.scope!==endpointScope||!editing.length||request.current||!current()||uncertainRef.current||!operation.coordinated&&blocked.current||beforeSave?.()===false)return null;
    if(base.sourceKey!==sourceKey){setError('상품 정보가 변경됐습니다. 입력을 유지하고 최신 가격을 조회한 뒤 저장해주세요.');return null;}
    let changes,derivedOptionIds:string[]=[];try{
      const prepared=renderGrid&&stageTwoPricingPolicy?stageTwoMsrpEdits(base.view,editing,stageTwoPricingPolicy):{changes:editing,optionIds:[]};
      changes=optionPriceChanges(base.view,prepared.changes);derivedOptionIds=prepared.optionIds;
    }catch(cause){setError(cause instanceof Error?cause.message:'가격 입력을 확인해주세요.');return null;}
    lastPriceWrite.current={scope:endpointScope,revision:base.view.revision,fingerprint:base.view.inputFingerprint,editing:JSON.stringify(editing),changes};
    const controller=new AbortController();request.current=controller;onLockChange?.(true);setBusy(true);setError('');setMessage('');
    let rejected=false;
    try{
      const response=await fetch(endpoint,{method:'PUT',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:base.view.revision,expectedInputFingerprint:base.view.inputFingerprint,changes,...(derivedOptionIds.length?{stageTwoMsrp:derivedOptionIds}:{})})}),body=await response.json() as QuotationFieldsView & {error?:string};
      if(controller.signal.aborted||!current())return null;
      if(!response.ok){rejected=response.status<500;throw Error(body.error||'가격을 저장하지 못했습니다. 입력은 유지됩니다.');}verifyOptionPriceView(body,profileId);verifyOptionPriceSave(base.view,body,changes);
      store(body);clearDraft();setMessage('옵션 가격 저장 완료 · 7단계 견적서에 반영됩니다.');if(operation.notify!==false)onSaved?.();return body;
    }catch(cause){if(rejected)lastPriceWrite.current=null;if(!controller.signal.aborted&&current()){setError(cause instanceof Error?cause.message:'가격 저장 실패');if(renderGrid&&!rejected){uncertainRef.current=true;setUncertain(true);}}return null;}
    finally{finish(controller);}
  }
  const controller:OptionPriceController={view,edits,targets,busy,dirty:edits.length>0,fresh,uncertain,issues:[...issues,...(targetError?[targetError]:[])],current,
    snapshot:()=>({view:latestSaved.current?.scope===endpointScope?latestSaved.current.view:null,edits:latestDraft.current.scope===endpointScope?[...latestDraft.current.edits]:[],fresh:latestSaved.current?.scope===endpointScope&&latestSaved.current?.sourceKey===sourceKey,uncertain:uncertainRef.current,busy:request.current!==null}),change,refresh:load,save};
  // The renderer consumes state. Its live-ref functions are passed to event
  // handlers, never evaluated while building the grid.
  // eslint-disable-next-line react-hooks/refs
  const grid=renderGrid?.(controller);
  return <section aria-label="옵션별 견적 가격 편집" data-quotation-source-step="가격" data-workspace-dirty={edits.length>0} data-workspace-saving={busy}>
    <h4>옵션별 가격</h4>
    {view&&<p>{view.categoryContext.categoryPath.join(' > ')} · {view.categoryContext.categoryId||'카테고리 미지정'}</p>}
    <p>7단계 견적서의 Supplier Hub 가격입니다. 직접 입력하면 연결된 가격 항목에 함께 반영됩니다. 복원하면 각 항목의 공통 수정값 또는 자동 계산을 사용합니다. 공식 판매처 가격은 별도 항목으로 유지됩니다.</p>
    {renderGrid&&stageTwoPricingPolicy&&<p>판매가 저장 시 자동 권장소비자가도 다시 계산합니다. 직접 수정한 권장소비자가와 공란은 유지합니다.</p>}
    {busy&&<p role="status">가격 처리 중…</p>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {!!edits.length&&view&&!fresh&&<p role="status">상품 정보가 변경됐습니다. 입력을 유지한 채 최신 가격을 조회한 뒤 저장해주세요.</p>}
    {targetError&&<p role="alert">{targetError}</p>}{!!differences.length&&<p role="status">{differences.join(' ')}</p>}
    {renderGrid?grid:!!rows.length&&<div className="table-wrap"><table><thead><tr><th>옵션</th>{prices.map(([key,label])=><th key={key}>{label} (원)</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.optionId??'common'}><th scope="row">{optionRegistrationLabel(row.optionId,row.optionLabel||'상품 공통',view?.optionRegistrationNumbers)}</th>{prices.map(([key,label])=><td key={key}><input aria-label={`${row.optionLabel||'상품 공통'} ${label}`} type="number" min={1} step={1} value={value(row.optionId,targets?.[key].primary??key)} disabled={busy||disabled||!targets} onKeyDown={event=>{if(event.key==='Enter')event.preventDefault();}} onChange={event=>change(row.optionId,key,event.target.value)}/><button type="button" className="btn ghost" disabled={busy||disabled||!targets} onClick={()=>change(row.optionId,key,null)}>복원</button></td>)}</tr>)}</tbody></table></div>}
    {view&&!rows.length&&<p>견적서에 포함한 옵션이 없습니다.</p>}{!!issues.length&&<p role="alert">{[...new Set(issues)].join(' ')}</p>}
    {!renderGrid&&<button type="button" className="btn primary" disabled={busy||disabled||!targets||!!targetError||!edits.length||!!issues.length} onClick={()=>void save()}>옵션 가격 저장</button>}
    {renderGrid&&uncertain&&<p role="status">가격 저장 응답을 확인하지 못했습니다. 입력을 유지한 채 저장 결과를 조회해주세요.</p>}
    {!!edits.length&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>void load(true)}>입력 유지·최신 가격 조회</button>}
    <button type="button" className="btn ghost" disabled={busy} onClick={()=>void load(false,!!view)}>{edits.length?'입력 취소·저장 가격 다시 조회':'저장 가격 다시 조회'}</button>
  </section>;
}
