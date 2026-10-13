'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {normalizeManagedVendorNames,validateManagedStoreSettingsView,type ManagedStoreSettingsView} from '@/app/managed-store-settings';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import './managed-store-settings-panel.css';

type Props={company:SupplierHubCompany;accountContext:string;onClose:()=>void;onSaved?:()=>void;onBusyChange?:(busy:boolean)=>void};
type Attempt={before:ManagedStoreSettingsView;names:string[]};
const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
const reason=(body:unknown,fallback:string)=>body&&typeof body==='object'&&'error' in body&&typeof body.error==='string'?body.error:fallback;

export function ManagedStoreSettingsPanel({company,accountContext,onClose,onSaved,onBusyChange}:Props){
 const scope=JSON.stringify([company.code,company.name,accountContext]),live=useRef({scope,onClose,onSaved,onBusyChange}),mounted=useRef(true),active=useRef<AbortController|null>(null),generation=useRef(0);
 const savedRef=useRef<ManagedStoreSettingsView|null>(null),draftRef=useRef(''),pending=useRef<Attempt|null>(null),[snapshot,setSnapshot]=useState<{scope:string;view:ManagedStoreSettingsView}|null>(null),[draft,setDraft]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[completed,setCompleted]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[refresh,setRefresh]=useState(0);
 const endpoint='/api/managed-products/allowed-stores',readUrl=endpoint+'?expectedAccountContext='+encodeURIComponent(accountContext);
 useLayoutEffect(()=>{if(live.current.scope!==scope){active.current?.abort();live.current.onBusyChange?.(false);generation.current++;savedRef.current=null;draftRef.current='';pending.current=null;}live.current={scope,onClose,onSaved,onBusyChange};},[scope,onClose,onSaved,onBusyChange]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;active.current?.abort();live.current.onBusyChange?.(false);};},[]);
 const current=()=>mounted.current&&live.current.scope===scope;
 async function read(signal:AbortSignal){const response=await fetch(readUrl,{signal,cache:'no-store',credentials:'same-origin'}),body:unknown=await response.json();signal.throwIfAborted();if(!response.ok)throw Error(reason(body,'허용 스토어 설정을 읽지 못했습니다.'));return validateManagedStoreSettingsView(body,{company,accountContext});}
 function adopt(view:ManagedStoreSettingsView){generation.current++;savedRef.current=view;draftRef.current=view.allowedVendorNames.join(', ');setSnapshot({scope,view});setDraft(draftRef.current);}
 useEffect(()=>{
  const controller=new AbortController();active.current=controller;live.current.onBusyChange?.(true);queueMicrotask(()=>{if(current()&&!controller.signal.aborted){setLoading(true);setBusy(false);setUncertain(false);setCompleted(false);setError('');setMessage('');setSnapshot(null);}});
  void(async()=>{try{const view=await read(controller.signal);if(current()&&!controller.signal.aborted){adopt(view);pending.current=null;}}catch(cause){if(current()&&!controller.signal.aborted)setError(cause instanceof Error?cause.message:'허용 스토어를 읽지 못했습니다.');}finally{if(active.current===controller){active.current=null;if(current()&&!controller.signal.aborted){setLoading(false);live.current.onBusyChange?.(false);}}}})();return()=>controller.abort();
 // A changed owner/company gets only its own new authoritative snapshot.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[scope,refresh]);
 const view=snapshot?.scope===scope?snapshot.view:null,renderedGeneration=generation.current,dirty=!!view&&draft!==view.allowedVendorNames.join(', '),locked=loading||busy||uncertain||completed||!view;
 function edit(value:string){if(!current()||active.current||pending.current||locked||renderedGeneration!==generation.current||value===draftRef.current)return;generation.current++;draftRef.current=value;setDraft(value);setError('');setMessage('');}
 function confirm(attempt:Attempt,after:ManagedStoreSettingsView){
  const before=attempt.before,noOp=before.revision>0&&same(before.allowedVendorNames,attempt.names),expectedRevision=noOp?before.revision:before.revision+1;
  if(after.revision!==expectedRevision||!same(after.allowedVendorNames,attempt.names)
   ||(noOp?after.updatedAt!==before.updatedAt||after.inputFingerprint!==before.inputFingerprint:after.updatedAt===null||after.inputFingerprint===before.inputFingerprint||before.updatedAt!==null&&Date.parse(after.updatedAt)<=Date.parse(before.updatedAt)))throw Error('저장 결과가 검토한 허용 스토어와 다릅니다. 입력을 유지했습니다.');
 }
 function finish(view:ManagedStoreSettingsView){adopt(view);pending.current=null;setUncertain(false);setCompleted(true);setMessage('허용 스토어를 저장했습니다.');live.current.onBusyChange?.(false);live.current.onSaved?.();live.current.onClose();}
 async function save(){
  if(!current()||active.current||loading||completed||!view||savedRef.current!==view||renderedGeneration!==generation.current)return;
  let attempt=pending.current;if(!attempt){try{attempt={before:structuredClone(savedRef.current),names:normalizeManagedVendorNames(draftRef.current)};}catch(cause){setError(cause instanceof Error?cause.message:'허용 스토어 입력을 확인해주세요.');return;}}
  const controller=new AbortController();active.current=controller;live.current.onBusyChange?.(true);setBusy(true);setError('');setMessage('');
  try{
   if(pending.current){const latest=await read(controller.signal);if(!current()||controller.signal.aborted)return;
    // Only a byte-equivalent original unlocks a further, explicit save. A
    // committed attempt is confirmed by GET; recovery never repeats a PUT.
    const existingDesired=attempt.before.revision>0&&same(attempt.before.allowedVendorNames,attempt.names);
    if(same(latest,attempt.before)&&!existingDesired){pending.current=null;setUncertain(false);generation.current++;setMessage('저장되지 않은 원본을 확인했습니다. 입력을 검토한 뒤 저장해주세요.');return;}confirm(attempt,latest);finish(latest);return;}
   pending.current=attempt;generation.current++;setUncertain(true);
   const response=await fetch(endpoint,{method:'PUT',signal:controller.signal,credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({expectedAccountContext:accountContext,expectedRevision:attempt.before.revision,expectedInputFingerprint:attempt.before.inputFingerprint,allowedVendorNames:attempt.names})}),body:unknown=await response.json();controller.signal.throwIfAborted();
   if(!response.ok)throw Error(reason(body,'허용 스토어 저장 결과를 확인해주세요.'));const acknowledged=validateManagedStoreSettingsView(body,{company,accountContext});confirm(attempt,acknowledged);
   const latest=await read(controller.signal);if(!same(acknowledged,latest))throw Error('저장 응답과 현재 허용 스토어 설정이 다릅니다. 입력을 유지했습니다.');if(!current()||controller.signal.aborted)return;finish(latest);
  }catch(cause){if(current()&&!controller.signal.aborted){generation.current++;setError(cause instanceof Error?cause.message:'저장 결과를 확인하지 못했습니다. 입력을 유지했습니다.');}}
  finally{if(active.current===controller){active.current=null;if(current()&&!controller.signal.aborted){setBusy(false);live.current.onBusyChange?.(!!pending.current);}}}
 }
 function close(){if(!current()||active.current||renderedGeneration!==generation.current)return;pending.current=null;generation.current++;live.current.onBusyChange?.(false);live.current.onClose();}
 function reload(){if(!current()||active.current||pending.current||dirty||completed||renderedGeneration!==generation.current)return;generation.current++;setRefresh(value=>value+1);}
 return <div className="managed-store-overlay" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();close();}}}><section className="managed-store-dialog" role="dialog" aria-modal="true" aria-label="허용 스토어 설정" data-workspace-dirty={dirty} data-workspace-saving={busy||uncertain}>
  <header><div><h3>허용 스토어 설정</h3><p>{company.name} ({company.code})</p></div><button type="button" className="icon-close" aria-label="허용 스토어 설정 닫기" disabled={loading||busy} onClick={close}>×</button></header>
  <p><strong>타사매칭 확인에 사용할 허용 스토어를 설정해주세요.</strong></p><p>스토어 이름은 계정별로 저장합니다. 현재 상품 DB의 분류는 유지됩니다.</p>
  {loading&&<p role="status">현재 계정의 허용 스토어를 읽고 있습니다.</p>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  <label className="managed-store-input">허용 스토어 목록 (쉼표로 구분, 예: 마이브랜드, 곰곰, 탐사)<textarea aria-label="허용 스토어 목록" rows={4} placeholder="예: 마이브랜드, 곰곰, 탐사" value={view?draft:''} disabled={locked} onChange={event=>edit(event.target.value)}/></label>
  {view&&view.allowedVendorNames.length>0&&<div className="managed-store-current"><strong>현재 설정된 허용 스토어</strong><div>{view.allowedVendorNames.map((name,index)=><span key={index}>{name}</span>)}</div></div>}
  <footer><button type="button" className="btn ghost" disabled={loading||busy} onClick={close}>{uncertain?'닫기':'취소'}</button><button type="button" className="btn ghost" disabled={loading||busy||uncertain||completed||dirty} onClick={reload}>다시 조회</button><button type="button" className="btn primary" disabled={loading||busy||completed||!view} onClick={()=>void save()}>{uncertain?'저장 결과 확인':'저장'}</button></footer>
 </section></div>;
}
