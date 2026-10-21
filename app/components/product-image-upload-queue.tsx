'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type ChangeEvent} from 'react';
import {PRODUCT_IMAGE_POOL_LIMIT} from '@/app/image-pool-limit';
import './product-image-upload-queue.css';
import {prepareProductImageFiles,readProductImageUploadBasis,sameProductImageUploadBasis,uploadProductImageQueueItem,recoverProductImageQueueItem,type ProductImageUploadItem,type ProductImageUploadBasis} from '@/app/product-image-upload-queue';

type Props={productId:string;ownerId:string;version:string;storedCount:number;stage:'additional'|'detail';active?:boolean;disabled?:boolean;immediate?:boolean;
 beforeUpload?:()=>boolean;onSaved?:()=>void;onBusyChange?:(busy:boolean)=>void};
const labels={pending:'대기',uploading:'업로드 중',uploaded:'파일 보관 · 연결 대기',attaching:'상품 연결 중',done:'추가 완료',failed:'확인 필요','uncertain-upload':'업로드 결과 확인 불가','uncertain-attachment':'연결 결과 확인 필요'};
export function ProductImageUploadQueue({productId,ownerId,version,storedCount,stage,active=true,disabled=false,immediate=false,beforeUpload,onSaved,onBusyChange}:Props){
 const identity=JSON.stringify([ownerId,productId,stage]),live=useRef({identity,version,active,disabled,mounted:true}),request=useRef<AbortController|null>(null);
 const [items,setItems]=useState<ProductImageUploadItem[]>([]),itemsRef=useRef<ProductImageUploadItem[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const callbacks=useRef({beforeUpload,onSaved,onBusyChange}),busyCallback=useRef<((busy:boolean)=>void)|null>(null),basisRef=useRef<ProductImageUploadBasis|null>(null);
 const update=useCallback((next:ProductImageUploadItem[]|((before:ProductImageUploadItem[])=>ProductImageUploadItem[]))=>{itemsRef.current=typeof next==='function'?next(itemsRef.current):next;setItems(itemsRef.current);},[]);
 useLayoutEffect(()=>{callbacks.current={beforeUpload,onSaved,onBusyChange};},[beforeUpload,onSaved,onBusyChange]);
 const stop=useCallback(()=>{
  request.current?.abort();request.current=null;busyCallback.current?.(false);busyCallback.current=null;
  update(before=>before.map(item=>item.phase==='uploading'?{...item,phase:'uncertain-upload',error:'화면이 변경되어 업로드 응답을 확인하지 못했습니다. 자동 재업로드하지 않습니다.'}:item.phase==='attaching'?{...item,phase:'uncertain-attachment',error:'화면이 변경되어 연결 응답을 확인하지 못했습니다. 저장 결과를 조회해주세요.'}:item));setBusy(false);
 },[update]);
 useLayoutEffect(()=>{
  const previous=live.current;live.current={identity,version,active,disabled,mounted:true};
  if(previous.identity!==identity){stop();update([]);basisRef.current=null;setError('');setMessage('');}
  else if((previous.active&&!active||previous.version!==version||!previous.disabled&&disabled)&&request.current)stop();
 },[identity,version,active,disabled,stop,update]);
 useEffect(()=>()=>{live.current.mounted=false;request.current?.abort();request.current=null;busyCallback.current?.(false);busyCallback.current=null;},[]);
 const allowed=()=>live.current.mounted&&live.current.identity===identity&&live.current.active&&!live.current.disabled&&!request.current;
 useLayoutEffect(()=>{live.current.disabled=disabled;},[disabled]);
 const begin=()=>{
  if(!allowed()||callbacks.current.beforeUpload?.()===false)return null;
  const controller=new AbortController(),capturedVersion=live.current.version;request.current=controller;setBusy(true);setError('');setMessage('');busyCallback.current=callbacks.current.onBusyChange??null;busyCallback.current?.(true);
  return {controller,current:()=>!controller.signal.aborted&&live.current.mounted&&live.current.identity===identity&&live.current.active&&!live.current.disabled&&live.current.version===capturedVersion};
 };
 const finish=(controller:AbortController)=>{if(request.current!==controller)return;request.current=null;busyCallback.current?.(false);busyCallback.current=null;if(live.current.mounted){setBusy(false);}};
 async function run(onlyId?:string){
  const operation=begin();if(!operation)return;const {controller,current}=operation,controls={current,fetcher:fetch,signal:controller.signal,onItem:(item:ProductImageUploadItem)=>{if(current())update(previous=>previous.map(value=>value.id===item.id?item:value));}};let completed=0;
  try{
   let basis=await readProductImageUploadBasis(productId,ownerId,controls);
   const retained=basisRef.current;
   if(basis.productVersion!==version&&(!retained||!sameProductImageUploadBasis(retained,basis)))throw Error('상품 저장본이 변경되었습니다. 새 파일을 업로드하지 않았습니다. 파일과 현재 상품을 다시 확인해주세요.');
   basisRef.current=basis;
   const selected=itemsRef.current.filter(item=>onlyId?item.id===onlyId&&item.phase==='uploaded'&&item.retryAttach:item.phase==='pending');
   if(basis.imageKeys.length+selected.length>PRODUCT_IMAGE_POOL_LIMIT)throw Error(`저장한 이미지와 대기 파일을 합해 ${PRODUCT_IMAGE_POOL_LIMIT}개를 넘을 수 없습니다.`);
   for(const queued of selected){
    if(!current())return;
    const result=await uploadProductImageQueueItem(basis,queued,controls);if(!current())return;
    basis=result.basis;basisRef.current=basis;if(result.item.phase==='done')completed++;
    if(result.stop)break;
   }
   if(current()){setMessage(completed?`${completed}개 이미지를 선택한 순서로 추가했습니다. 추가·상세 이미지에서 사용할 파일을 선택해주세요.`:'대기 파일의 처리 결과를 확인해주세요.');if(completed)callbacks.current.onSaved?.();}
  }catch(cause){if(current())setError(cause instanceof Error?cause.message:'이미지를 추가하지 못했습니다. 대기 파일은 유지했습니다.');}
  finally{finish(controller);}
 }
 async function select(event:ChangeEvent<HTMLInputElement>){
  const files=Array.from(event.target.files??[]);event.target.value='';if(!files.length||!allowed())return;
  const operation=begin();if(!operation)return;const {controller,current}=operation;
  let start=false;
  try{const added=await prepareProductImageFiles(files,itemsRef.current,storedCount);if(!current())return;update(previous=>[...previous,...added]);setMessage(`${added.length}개 파일을 선택했습니다.`);start=immediate;}
  catch(cause){if(current())setError(cause instanceof Error?cause.message:'선택한 파일을 확인해주세요.');}
  finally{finish(controller);}
  if(start&&current())void run();
 }
 async function recover(id:string){
  const item=itemsRef.current.find(value=>value.id===id);if(!item||!item.attachmentBasis||item.phase!=='uncertain-attachment'&&item.phase!=='uploaded')return;
  const operation=begin();if(!operation)return;const {controller,current}=operation;
  try{const result=await recoverProductImageQueueItem(item,{current,fetcher:fetch,signal:controller.signal});if(!current())return;update(previous=>previous.map(value=>value.id===id?result.item:value));basisRef.current=result.basis;setMessage(result.item.phase==='done'?'저장된 이미지 연결을 확인했습니다. 다시 업로드하지 않았습니다.':'파일은 보관되어 있습니다. 연결되지 않은 상태를 확인했습니다.');if(result.item.phase==='done')callbacks.current.onSaved?.();}
  catch(cause){if(current())setError(cause instanceof Error?cause.message:'저장 결과를 확인하지 못했습니다. 파일과 시도를 유지했습니다.');}finally{finish(controller);}
 }
 const pending=items.filter(item=>item.phase==='pending').length,dirty=items.some(item=>item.phase!=='done'&&!item.dismissed),blocked=busy||disabled||!active;
 return <section className="product-image-upload-queue" aria-label={stage==='additional'?'추가 이미지 파일 업로드':'상세 이미지 파일 업로드'} aria-busy={busy} data-quotation-source-step={stage==='additional'?'추가 이미지':'상세 이미지'} data-workspace-dirty={dirty} data-workspace-saving={busy}>
  <div className="quote-actions"><label className="btn primary upload-btn">＋ 이미지 업로드<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple aria-label={stage==='additional'?'추가 이미지 파일 선택':'상세 이미지 파일 선택'} disabled={blocked} onChange={event=>void select(event)}/></label>
   {!immediate&&<button type="button" className="btn primary" disabled={blocked||!pending} onClick={()=>void run()}>업로드 시작{pending?` (${pending})`:''}</button>}
   {immediate&&pending>0&&<button type="button" className="btn primary" disabled={blocked} onClick={()=>void run()}>남은 파일 업로드 ({pending})</button>}
  </div>
  {!!items.length&&<ul className="product-image-upload-files">{items.map(item=><li key={item.id}><span><strong>{item.file.name}</strong> · {(item.file.size/1024).toLocaleString('ko-KR',{maximumFractionDigits:1})}KB · {labels[item.phase]}</span>
   {item.error&&<small>{item.error}</small>}
   {item.phase==='pending'&&<button type="button" className="btn ghost" aria-label={`${item.file.name} 대기 목록에서 제외`} disabled={blocked} onClick={()=>{if(allowed())update(previous=>previous.filter(value=>value.id!==item.id));}}>제외</button>}
   {item.phase==='failed'&&<button type="button" className="btn ghost" disabled={blocked} onClick={()=>{if(allowed())update(previous=>previous.filter(value=>value.id!==item.id));}}>대기에서 제거</button>}
   {(item.phase==='uncertain-attachment'||item.phase==='uploaded'&&item.attachmentBasis&&!item.retryAttach)&&<button type="button" className="btn ghost" aria-label={`${item.file.name} 저장 결과 확인`} disabled={blocked} onClick={()=>void recover(item.id)}>저장 결과 확인</button>}
   {item.phase==='uploaded'&&item.retryAttach&&<button type="button" className="btn ghost" disabled={blocked} onClick={()=>void run(item.id)}>저장된 파일 연결</button>}
   {item.phase!=='done'&&item.phase!=='pending'&&item.phase!=='uploading'&&item.phase!=='attaching'&&!item.dismissed&&<button type="button" className="btn ghost" disabled={blocked} onClick={()=>{if(allowed())update(previous=>previous.map(value=>value.id===item.id?{...value,dismissed:true}:value));}}>확인·대기에서 제외</button>}
   {item.dismissed&&<small>대기에서 제외했습니다. 원격 파일은 삭제하지 않았습니다.</small>}
   {item.phase==='uncertain-upload'&&<small>업로드 결과가 불명확하여 자동으로 다시 올리지 않습니다.</small>}
  </li>)}</ul>}
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {!!items.length&&<small>PNG·JPEG·WebP·GIF·AVIF · 파일당 10MB 이하 · 저장된 이미지와 대기를 합해 {PRODUCT_IMAGE_POOL_LIMIT}개 이하. 대기 목록 제외는 원격 파일을 삭제하지 않습니다.</small>}
 </section>;
}
