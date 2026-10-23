'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {QuotationChange,QuotationFieldsView} from '@/app/quotation-schema';
import {quotationPackagingDraftChanges,quotationPackagingDraftInputs,packagingDraftAbstentionReason,type PackagingDraftResult,type PackagingDraftScope} from '@/app/quotation-packaging-draft';
import type {QuotationPackagingDraftInput} from '@/app/quotation-packaging-basis';

type Props={productId:string;profileId?:string;view:QuotationFieldsView;optionId:string|null;disabled:boolean;
 onBusyChange?:(busy:boolean)=>void;onApply:(changes:QuotationChange[],drafts:QuotationPackagingDraftInput[])=>boolean};
const origins={collected:'수집한 포장값','ai-estimate':'AI 추정값','couplus-fallback':'기본 초안'};
export function QuotationPackagingDraftPanel(props:Props){return <PackagingDraftPanel key={JSON.stringify([props.productId,props.profileId,props.view.productVersion,
 props.view.contentRevision,props.view.optionRevision,props.view.revision,props.view.inputFingerprint,props.optionId])} {...props}/>;}
function PackagingDraftPanel({productId,profileId,view,optionId,disabled,onBusyChange,onApply}:Props){
 const [all,setAll]=useState(true),[busy,setBusy]=useState(false),[result,setResult]=useState<PackagingDraftResult|null>(null),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('');
 const current=useRef({view,disabled,onApply}),pending=useRef(false),generation=useRef(0),running=useRef<AbortController|null>(null),callback=useRef(onBusyChange),ownedBusy=useRef(false);
 useLayoutEffect(()=>{current.current={view,disabled,onApply};callback.current=onBusyChange;return()=>{current.current={...current.current,disabled:true};};},[view,disabled,onApply,onBusyChange]);
 useEffect(()=>()=>{generation.current++;running.current?.abort();pending.current=false;if(ownedBusy.current){ownedBusy.current=false;callback.current?.(false);}},[]);
 const scope:PackagingDraftScope={optionId,applyToAllOptions:all};
 async function generate(){
  if(pending.current||current.current.disabled||!all&&optionId===null)return;
  const ticket=++generation.current,controller=new AbortController(),source=current.current.view;pending.current=true;running.current=controller;ownedBusy.current=true;
  setBusy(true);setError('');setResult(null);setConfirmed(false);callback.current?.(true);
  try{
   const response=await fetch(`/api/products/${encodeURIComponent(productId)}/quotation-packaging-draft`,{method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},
    body:JSON.stringify({action:'generate',profileId:profileId??null,expectedRevision:source.revision,expectedInputFingerprint:source.inputFingerprint,...scope})});
   const value=await response.json()as PackagingDraftResult&{error?:string};
   if(controller.signal.aborted||generation.current!==ticket||current.current.view!==source)return;
   if(!response.ok)throw Error(value.error||'포장 초안을 확인하지 못했습니다.');
   quotationPackagingDraftChanges(source,value,productId,scope);
   if(!Array.isArray(value.preserved)||!Array.isArray(value.warnings)||value.warnings.some(item=>typeof item!=='string'))throw Error('포장 초안의 안내 내용을 확인하지 못했습니다.');
   setResult(value);
  }catch(cause){if(!controller.signal.aborted&&generation.current===ticket)setError(cause instanceof Error?cause.message:'포장 초안 확인 실패');}
  finally{if(generation.current===ticket){pending.current=false;running.current=null;setBusy(false);if(ownedBusy.current){ownedBusy.current=false;callback.current?.(false);}}}
 }
 const estimated=!!result?.proposals.some(item=>item.origin!=='collected');
 function apply(){
  if(pending.current||current.current.disabled||!result||estimated&&!confirmed)return;
  try{const changes=quotationPackagingDraftChanges(current.current.view,result,productId,scope);if(!changes.length)return;
   if(!current.current.onApply(changes,quotationPackagingDraftInputs(current.current.view,result,productId,scope)))throw Error('입력란이 변경되었습니다. 최신 견적에서 초안을 다시 확인해주세요.');setResult(null);setConfirmed(false);
  }catch(cause){setError(cause instanceof Error?cause.message:'포장 초안을 다시 확인해주세요.');}
 }
 return <section className="quotation-fields-notice" aria-label="포장 규격 초안" aria-busy={busy}>
  <div className="quote-actions"><button type="button" className="btn primary" disabled={disabled||busy||!all&&optionId===null} onClick={()=>void generate()}>{busy?'포장 초안 작성 중…':'포장 규격 초안 작성'}</button>
   <label><input type="checkbox" checked={all} disabled={disabled||busy} onChange={event=>{if(pending.current||current.current.disabled)return;setAll(event.target.checked);setResult(null);setConfirmed(false);setError('');}}/> 모든 포함 옵션</label></div>
  <p>수집한 포장값과 직접 수정한 값·빈칸을 유지하고, 빠진 무게·사이즈만 초안으로 채웁니다.</p>
  {disabled&&!busy&&<p>수정 중인 견적 입력을 먼저 저장해주세요.</p>}
  {error&&<p role="alert">{error}</p>}
  {result&&<><p role="status">포장 초안 {result.proposals.length}개 · {all?'모든 포함 옵션':'선택 옵션'}</p>
   {result.proposals.length>0&&<div className="quotation-fields-bulk-table"><table><thead><tr><th>옵션 / 구성</th><th>항목</th><th>초안</th><th>기준</th></tr></thead><tbody>{result.proposals.map(item=><tr key={JSON.stringify([item.optionId,item.fieldKey])}>
    <td>{item.optionLabel} · {item.unitsPerPack}개입</td><td>{item.label}</td><td>{item.value.replaceAll('*',' × ')} {view.resolved.schema.fields.find(field=>field.id===item.fieldKey)?.unit}</td><td>{origins[item.origin]}<br/>{item.note}</td>
   </tr>)}</tbody></table></div>}
   {result.preserved.length>0&&<details><summary>기존 포장값 {result.preserved.length}개 유지</summary><ul>{result.preserved.map((item,index)=><li key={index}>{item.optionLabel} · {item.label}: {item.value||'(공란)'} · {item.reason}</li>)}</ul></details>}
   <ul>{result.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>
   {result.diagnostics&&<details><summary>AI 응답 확인: 요청 {result.diagnostics.expectedOptions}개 · 응답 {result.diagnostics.returnedOptions??'미확인'}개</summary>
    <p>프롬프트 {result.diagnostics.promptRevision} · {result.diagnostics.response==='parsed'?'응답 형식 확인':result.diagnostics.response==='invalid'?'응답 형식 오류':'응답 미확인'}</p>
    {'providerVersion'in result.diagnostics?<p>응답 계약 V{result.diagnostics.providerVersion} · {result.diagnostics.validationCode??(result.diagnostics.response==='parsed'?'검증 통과':'유효 응답 없음')}. 보류 사유는 AI가 선택한 설명이며 확인된 상품 사실이 아닙니다.</p>
     :<p>이전 응답 형식에는 추정 보류 사유가 없어 확인할 수 없습니다.</p>}
    <ul>{result.diagnostics.options.map(item=><li key={item.index}>요청 옵션 {item.index+1}: {item.returned?'항목 있음':'유효 항목 미확인'} · 무게 {item.weight?'있음':'없음'} · 가로 {item.width?'있음':'없음'} · 세로 {item.length?'있음':'없음'} · 높이 {item.height?'있음':'없음'}
     {'dimensionsReason'in item&&<>{item.dimensionsReason&&` · 사이즈 보류: ${packagingDraftAbstentionReason(item.dimensionsReason)}`}{item.weightReason&&` · 무게 보류: ${packagingDraftAbstentionReason(item.weightReason)}`}</>}
    </li>)}</ul>
   </details>}
   {estimated&&<label><input type="checkbox" checked={confirmed} disabled={disabled||busy} onChange={event=>setConfirmed(event.target.checked)}/> 추정·기본 초안이며 실측값이 아님을 확인했습니다.</label>}
   <div className="quote-actions"><button type="button" className="btn primary" disabled={disabled||busy||!result.proposals.length||estimated&&!confirmed} onClick={apply}>확인한 초안을 입력란에 적용</button></div>
  </>}
 </section>;
}
