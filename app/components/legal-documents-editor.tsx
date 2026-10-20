'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {LegalDocuments} from '@/app/legal-documents';

type NativeTargets={schemaSha256:string;categoryId:string;targets:{id:string;label:string;binding:unknown}[];issues?:{message:string}[]};
type Saved={productId:string;revision:number;documents:LegalDocuments;native:NativeTargets|null;nativeError?:string};
type Task={controller:AbortController;productId:string;mutation:boolean;finishBusy:()=>void};
function nativeTargets(value:unknown):NativeTargets|null{
 if(!value||typeof value!=='object')return null;
 const native=value as NativeTargets;
 if(!/^[a-f0-9]{64}$/.test(native.schemaSha256)||typeof native.categoryId!=='string'||!native.categoryId||!Array.isArray(native.targets)
  ||native.targets.some(target=>!target||typeof target.id!=='string'||!target.id||typeof target.label!=='string'||!target.label||!target.binding||typeof target.binding!=='object')
  ||new Set(native.targets.map(target=>target.id)).size!==native.targets.length
  ||native.issues!==undefined&&(!Array.isArray(native.issues)||native.issues.some(issue=>!issue||typeof issue.message!=='string')))return null;
 return native;
}
function savedBinding(file:LegalDocuments['files'][number]):unknown{return 'nativeBinding' in file?file.nativeBinding:undefined;}
function bindingHash(binding:unknown):string|null{return binding&&typeof binding==='object'&&'schemaSha256' in binding&&typeof binding.schemaSha256==='string'&&/^[a-f0-9]{64}$/.test(binding.schemaSha256)?binding.schemaSha256:null;}

export function LegalDocumentsEditor({productId,disabled,onSaved,onBusyChange,guardWrite,onMutationSettled}:{productId:string;disabled:boolean;onSaved:()=>void;onBusyChange?:(busy:boolean)=>void;guardWrite?:(run:()=>Promise<Response>,signal:AbortSignal)=>Promise<Response>;onMutationSettled?:(error?:string)=>void}){
 const [saved,setSaved]=useState<Saved|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef<Task|null>(null),mounted=useRef(true),scope=useRef(productId),currentSaved=useRef<Saved|null>(null);
 const visible=saved?.productId===productId?saved:null;
 const latest=useRef({productId,disabled,onSaved,onBusyChange,guardWrite,onMutationSettled});useLayoutEffect(()=>{latest.current={productId,disabled,onSaved,onBusyChange,guardWrite,onMutationSettled};currentSaved.current=visible;});
 useLayoutEffect(()=>{
  if(active.current&&(active.current.productId!==productId||disabled)){const task=active.current;active.current=null;task.controller.abort();task.finishBusy();setBusy(false);}
  if(scope.current!==productId){scope.current=productId;setSaved(null);setError('');}
 },[productId,disabled]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;const task=active.current;active.current=null;task?.controller.abort();task?.finishBusy();};},[]);
 async function request(method:'GET'|'POST'|'PATCH',body?:FormData|Record<string,unknown>){
  if(active.current||latest.current.disabled||latest.current.productId!==productId||!mounted.current)return;
  const before=currentSaved.current;
  if(method!=='GET'){
   const expected=body instanceof FormData?Number(body.get('expectedRevision')):body?.expectedRevision;
   if(!before||expected!==before.revision){setError('서류 목록이 변경되었습니다. 최신 목록을 확인해주세요.');return;}
  }
  const controller=new AbortController(),notifyBusy=latest.current.onBusyChange;let finished=false;
  const task:Task={controller,productId,mutation:method!=='GET',finishBusy:()=>{if(!finished){finished=true;notifyBusy?.(false);}}};
  active.current=task;setBusy(true);setError('');notifyBusy?.(true);let failure:string|undefined;
  const fresh=()=>mounted.current&&active.current===task&&!controller.signal.aborted&&!latest.current.disabled&&latest.current.productId===productId;
  try{
   const run=()=>{if(!fresh()||method!=='GET'&&currentSaved.current!==before)throw Error('현재 서류 편집을 중단했습니다.');return fetch(`/api/products/${encodeURIComponent(productId)}/legal-documents`,{method,cache:'no-store',signal:controller.signal,...(body?{body:body instanceof FormData?body:JSON.stringify(body),...(body instanceof FormData?{}:{headers:{'content-type':'application/json'}})}:{})});};
   const response=method!=='GET'&&latest.current.guardWrite?await latest.current.guardWrite(run,controller.signal):await run();
   const data=await response.json() as {error?:string;revision?:number;documents?:LegalDocuments;native?:unknown;nativeError?:string};if(!response.ok)throw Error(data.error||'서류를 저장하지 못했습니다.');
   if(!Number.isSafeInteger(data.revision)||!data.documents||!['unconfirmed','required','not-applicable'].includes(data.documents.applicability)||!Array.isArray(data.documents.files))throw Error('서류 목록을 확인하지 못했습니다.');
   if(fresh()){setSaved({productId,revision:data.revision!,documents:data.documents,native:nativeTargets(data.native),...(typeof data.nativeError==='string'?{nativeError:data.nativeError}:{})});if(method!=='GET')latest.current.onSaved();}
  }catch(cause){failure=cause instanceof Error?cause.message:'서류를 확인하지 못했습니다.';if(fresh())setError(failure);}
  finally{if(active.current===task){active.current=null;if(mounted.current)setBusy(false);task.finishBusy();if(method!=='GET'&&mounted.current&&!controller.signal.aborted&&latest.current.productId===productId&&!latest.current.disabled)latest.current.onMutationSettled?.(failure);}}
 }
 function mapDocument(file:LegalDocuments['files'][number],targetId:string){
  if(!visible||currentSaved.current!==visible||active.current||latest.current.disabled||latest.current.productId!==productId||!mounted.current)return;
  const native=visible.native,target=targetId?native?.targets.find(target=>target.id===targetId):undefined;
  if(targetId&&!target){setError('현재 첨부 항목을 다시 확인해주세요.');return;}
  const expectedSchemaSha256=target?native!.schemaSha256:bindingHash(savedBinding(file));
  if(!expectedSchemaSha256){setError('저장된 서류 연결을 확인하지 못했습니다. 목록을 다시 불러와주세요.');return;}
  void request('PATCH',{expectedRevision:visible.revision,binding:{key:file.key,targetId:target?.id??null,expectedSchemaSha256}});
 }
 return <details className="panel-stack"><summary>법적 필수서류 · 인증서/증빙 원본</summary>
  {!visible&&<button type="button" className="btn ghost" disabled={disabled||busy} onClick={()=>void request('GET')}>서류 목록 불러오기</button>}
  {error&&<p role="alert">{error}</p>}
  {busy&&<button type="button" className="btn ghost" onClick={()=>{const task=active.current;if(!task)return;active.current=null;task.controller.abort();task.finishBusy();setBusy(false);const message='확인을 중단했습니다. 목록을 다시 불러와 저장 상태를 확인해주세요.';setError(message);if(task.mutation&&mounted.current&&latest.current.productId===task.productId&&!latest.current.disabled)latest.current.onMutationSettled?.(message);}}>서류 작업 중단</button>}
  {visible&&<fieldset disabled={disabled||busy}><legend>상품 개별법령에 따른 필수 서류</legend>
   <label>서류 해당 여부<select value={visible.documents.applicability} onChange={event=>void request('PATCH',{expectedRevision:visible.revision,applicability:event.target.value})}><option value="unconfirmed">선택해주세요</option><option value="required">해당함</option><option value="not-applicable">해당없음</option></select></label>
   <p>PDF·PNG·JPEG 원본을 첨부하세요. 파일당 5MB, 최대 10개·합계 8MB입니다. 서류의 필요 여부와 내용을 확인한 뒤 전송하세요.</p>
   <p>서플라이허브에 첨부할 PDF마다 연결 항목을 직접 선택하세요. 파일 첨부나 연결 저장만으로 견적서가 전송되거나 약관에 동의되지 않습니다.</p>
   {visible.nativeError&&<p role="status">{visible.nativeError}</p>}
   {visible.native?.issues?.filter(issue=>typeof issue.message==='string').map((issue,index)=><p key={index} role="status">{issue.message}</p>)}
   <input aria-label="법적 필수서류 업로드" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;const form=new FormData();form.set('file',file);form.set('expectedRevision',String(visible.revision));void request('POST',form);}}/>
   <ul>{visible.documents.files.map(file=>{
    const binding=savedBinding(file),target=binding?visible.native?.targets.find(target=>JSON.stringify(target.binding)===JSON.stringify(binding)):undefined;
    const bound=Boolean(binding),canUnlink=bound&&Boolean(bindingHash(binding));
    return <li key={file.key}><a href={`/api/products/${encodeURIComponent(productId)}/legal-documents?key=${encodeURIComponent(file.key)}`}>{file.name}</a> · {Math.ceil(file.byteLength/1024)}KB
     {file.type==='pdf'?<label>서플라이허브 첨부 항목<select aria-label={`${file.name} 서플라이허브 첨부 항목`} disabled={disabled||busy||!visible.native?.targets.length&&!canUnlink} value={target?.id??(bound?'__saved_binding__':'')} onChange={event=>mapDocument(file,event.target.value)}>
      <option value="">미연결</option>{bound&&!target&&<option value="__saved_binding__" disabled>저장된 연결 재확인</option>}{visible.native?.targets.map(target=><option key={target.id} value={target.id}>{target.label}</option>)}
     </select>{bound&&!target&&<small>저장된 연결 항목을 현재 양식에서 확인하지 못했습니다. 연결을 해제하거나 현재 항목을 다시 선택하세요.</small>}</label>:<small>서플라이허브 첨부 항목에 연결하려면 PDF 원본이 필요합니다. 이 이미지 원본은 그대로 보관됩니다.</small>}
     <button type="button" className="btn ghost" onClick={()=>void request('PATCH',{expectedRevision:visible.revision,removeKey:file.key})}>첨부 제외</button>
    </li>;
   })}</ul>
   <button type="button" className="btn ghost" onClick={()=>void request('GET')}>목록 새로고침</button>
  </fieldset>}
 </details>;
}
