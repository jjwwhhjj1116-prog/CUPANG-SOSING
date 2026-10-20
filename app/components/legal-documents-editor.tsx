'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {LegalDocuments} from '@/app/legal-documents';
export function LegalDocumentsEditor({productId,disabled,onSaved,onBusyChange,guardWrite,onMutationSettled}:{productId:string;disabled:boolean;onSaved:()=>void;onBusyChange?:(busy:boolean)=>void;guardWrite?:(run:()=>Promise<Response>,signal:AbortSignal)=>Promise<Response>;onMutationSettled?:(error?:string)=>void}){
 const [saved,setSaved]=useState<{revision:number;documents:LegalDocuments}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef<AbortController|null>(null);
 const latest=useRef({disabled,onSaved,onBusyChange,guardWrite,onMutationSettled});useLayoutEffect(()=>{latest.current={disabled,onSaved,onBusyChange,guardWrite,onMutationSettled};});
 useEffect(()=>()=>active.current?.abort(),[]);
 async function request(method:'GET'|'POST'|'PATCH',body?:FormData|Record<string,unknown>){
  if(active.current||latest.current.disabled)return;const controller=new AbortController();active.current=controller;setBusy(true);setError('');latest.current.onBusyChange?.(true);let failure:string|undefined;
  try{
   const run=()=>{if(controller.signal.aborted||latest.current.disabled)throw Error('현재 서류 편집을 중단했습니다.');return fetch(`/api/products/${encodeURIComponent(productId)}/legal-documents`,{method,cache:'no-store',signal:controller.signal,...(body?{body:body instanceof FormData?body:JSON.stringify(body),...(body instanceof FormData?{}:{headers:{'content-type':'application/json'}})}:{})});};
   const response=method!=='GET'&&latest.current.guardWrite?await latest.current.guardWrite(run,controller.signal):await run();
   const data=await response.json() as {error?:string;revision?:number;documents?:LegalDocuments};if(!response.ok)throw Error(data.error||'서류를 저장하지 못했습니다.');
   if(!Number.isSafeInteger(data.revision)||!data.documents||!['unconfirmed','required','not-applicable'].includes(data.documents.applicability)||!Array.isArray(data.documents.files))throw Error('서류 목록을 확인하지 못했습니다.');
   if(!controller.signal.aborted){setSaved({revision:data.revision!,documents:data.documents});if(method!=='GET')latest.current.onSaved();}
  }catch(cause){failure=cause instanceof Error?cause.message:'서류를 확인하지 못했습니다.';if(!controller.signal.aborted)setError(failure);}
  finally{if(active.current===controller){active.current=null;setBusy(false);latest.current.onBusyChange?.(false);if(method!=='GET'&&!controller.signal.aborted)latest.current.onMutationSettled?.(failure);}}
 }
 return <details className="panel-stack"><summary>법적 필수서류 · 인증서/증빙 원본</summary>
  {!saved&&<button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void request('GET')}>서류 목록 불러오기</button>}
  {error&&<p role="alert">{error}</p>}
  {saved&&<fieldset disabled={disabled||busy}><legend>상품 개별법령에 따른 필수 서류</legend>
   <label>서류 해당 여부<select value={saved.documents.applicability} onChange={event=>void request('PATCH',{expectedRevision:saved.revision,applicability:event.target.value})}><option value="unconfirmed">선택해주세요</option><option value="required">해당함</option><option value="not-applicable">해당없음</option></select></label>
   <p>PDF·PNG·JPEG 원본을 첨부하세요. 파일당 5MB, 최대 10개·합계 8MB입니다. 서류의 필요 여부와 내용을 확인한 뒤 전송하세요.</p>
   <input aria-label="법적 필수서류 업로드" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;const form=new FormData();form.set('file',file);form.set('expectedRevision',String(saved.revision));void request('POST',form);}}/>
   <ul>{saved.documents.files.map(file=><li key={file.key}><a href={`/api/products/${encodeURIComponent(productId)}/legal-documents?key=${encodeURIComponent(file.key)}`}>{file.name}</a> · {Math.ceil(file.byteLength/1024)}KB <button type="button" className="btn ghost" onClick={()=>void request('PATCH',{expectedRevision:saved.revision,removeKey:file.key})}>첨부 제외</button></li>)}</ul>
   <button type="button" className="btn ghost" onClick={()=>void request('GET')}>목록 새로고침</button>
  </fieldset>}
 </details>;
}
