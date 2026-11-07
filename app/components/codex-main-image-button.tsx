'use client';
import {useLayoutEffect,useRef,useState} from 'react';
import {readCliScope,sameCliScope} from '@/app/cli-bridge-client';
import {requestCodexMainImageEdit,type CodexMainImage} from '@/app/codex-main-image-channel';
import {readProductImageUploadBasis,prepareProductImageFiles,uploadProductImageQueueItem,recoverProductImageQueueItem,type ProductImageUploadItem} from '@/app/product-image-upload-queue';
import {mainImageValue} from '@/app/quotation-main-image';
import type {RegistrationUiReads,UiMutation} from '@/app/registration-ui-reads';
type Props={uiReads?:RegistrationUiReads;onBeginSourceWrite?:()=>UiMutation|undefined;productId:string;optionId:string;profileId?:string;sourceKey:string;version:string;disabled:boolean;stage?:'main'|'detail';onSaved?:()=>void};
const mainPrompt='실제 제품의 형태·색상·구성은 유지하고, 쿠팡 대표이미지에 적합하게 흰 배경과 깔끔한 구도로 편집해주세요.';
const detailPrompt='이 상세 이미지의 중국어 설명만 자연스러운 한국어로 바꿔 같은 구도의 완성 이미지로 저장하세요. 제품 사진, 브랜드 표기, 수치와 단위, 배경, 구성과 순서를 보존하고 확인할 수 없는 정보를 만들지 마세요.';
async function referenceImage(key:string,signal:AbortSignal,detail:boolean):Promise<CodexMainImage>{
 const response=await fetch('/api/files/'+key.split('/').map(encodeURIComponent).join('/'),{signal,cache:'no-store',credentials:'same-origin',redirect:'error'});
 if(!response.ok)throw Error('현재 이미지를 읽지 못했습니다.');const blob=await response.blob();if(!blob.size||blob.size>10*1024*1024)throw Error('원본 이미지 크기를 확인해주세요.');
 const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');
 try{const scale=Math.min(1,(detail?4096:1536)/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext('2d');if(!context)throw Error('참조 이미지를 준비하지 못했습니다.');context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  let mimeType:CodexMainImage['mimeType']='image/png',data=canvas.toDataURL(mimeType).split(',')[1];
  if(detail&&data&&data.length>5_592_408){mimeType='image/jpeg';data=canvas.toDataURL(mimeType,0.9).split(',')[1];}
  if(!data||data.length>5_592_408)throw Error('Codex 참조 이미지는 4MB 이하여야 합니다.');return{mimeType,data};
 }finally{bitmap.close();canvas.width=canvas.height=0;}
}
export function CodexMainImageButton({uiReads,onBeginSourceWrite,productId,optionId,profileId,sourceKey,version,disabled,stage='main',onSaved}:Props){
 const uiMutation=useRef<UiMutation|null>(null);
 const detail=stage==='detail',subject=detail?'상세 이미지':'대표이미지';
 const [open,setOpen]=useState(false),[prompt,setPrompt]=useState(detail?detailPrompt:mainPrompt),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const active=useRef<AbortController|null>(null),retained=useRef<ProductImageUploadItem|null>(null);
 const [held,setHeld]=useState<ProductImageUploadItem|null>(null);
 const retain=(item:ProductImageUploadItem|null)=>{retained.current=item;setHeld(item);};
 const scope=JSON.stringify([productId,optionId,profileId,sourceKey,version,stage]),live=useRef(scope),available=useRef(!disabled);
 useLayoutEffect(()=>{live.current=scope;return()=>{active.current?.abort();active.current=null;};},[scope]);
 useLayoutEffect(()=>{available.current=!disabled;},[disabled]);
 async function start(){
  if(disabled||busy||active.current||retained.current||!prompt.trim())return;const controller=new AbortController();active.current=controller;setBusy(true);setMessage(`선택한 ${subject}를 준비하고 있습니다.`);
  const sameRequest=()=>!controller.signal.aborted&&live.current===scope&&active.current===controller;
  const current=()=>sameRequest()&&(!detail||available.current),controls={signal:controller.signal,current};
  try{
   const owner=await readCliScope(fetch,controller.signal),target={optionId,...(profileId?{profileId}:{})},basis=await readProductImageUploadBasis(productId,owner.ownerId,controls,{target,stage,...(detail?{replaceSourceKey:sourceKey}:{})});
   if(basis.productVersion!==version||!basis.quotation||!detail&&mainImageValue(basis.quotation,optionId)!==sourceKey)throw Error(`${subject} 선택이 변경됐습니다. 최신 저장본을 확인해주세요.`);
   const image=await referenceImage(sourceKey,controller.signal,detail);
   await requestCodexMainImageEdit({productId,optionId,profileId:profileId??null,sourceKey,prompt:prompt.trim(),image},owner,{stage,signal:controller.signal,onStatus:setMessage,onApply:async result=>{
    if(!current()||!sameCliScope(owner,await readCliScope(fetch,controller.signal))||!current())throw Error('이미지 요청의 회원·회사 또는 편집 상태가 변경됐습니다.');
    const bytes=Uint8Array.from(atob(result.data),char=>char.charCodeAt(0)),file=new File([bytes],`codex-${stage}.`+(result.mimeType==='image/png'?'png':'jpg'),{type:result.mimeType});
    const [item]=await prepareProductImageFiles([file],[],basis.imageKeys.length);retain(item);
    uiMutation.current??=onBeginSourceWrite?.()??uiReads?.beginMutation()??null;
    const saved=await uploadProductImageQueueItem(basis,item,{...controls,onItem:value=>{retain(value);if(['uncertain-upload','uncertain-attachment'].includes(value.phase))setUncertain(true);}});
    retain(saved.item);
    if(saved.item.phase!=='done'||!saved.item.key){
     if(detail&&saved.item.phase==='failed'&&!saved.item.key)retain(null);
     setUncertain(['uncertain-upload','uncertain-attachment'].includes(saved.item.phase));throw Error(saved.item.error||'Codex 이미지 저장 결과를 확인해주세요.');
    }
    return{key:saved.item.key,productVersion:saved.basis.productVersion};
   }});
   if(current()){setMessage(`이 옵션의 ${subject}를 저장했습니다.`);retain(null);setUncertain(false);uiMutation.current?.confirm();uiMutation.current=null;onSaved?.();}
  }catch(cause){if(sameRequest())setMessage(cause instanceof Error?cause.message:`Codex ${subject} 요청을 확인해주세요.`);}
  finally{if(active.current===controller){active.current=null;setBusy(false);}}
 }
 async function recover(){if(!retained.current||busy)return;const controller=new AbortController();active.current=controller;setBusy(true);
  try{const result=await recoverProductImageQueueItem(retained.current,{signal:controller.signal,current:()=>live.current===scope&&!controller.signal.aborted});retain(result.item);setMessage(result.item.phase==='done'?`이미 저장된 ${subject}를 확인했습니다.`:result.item.error||'저장 연결을 확인해주세요.');if(result.item.phase==='done'){retain(null);setUncertain(false);uiMutation.current?.confirm();uiMutation.current=null;onSaved?.();}}
  catch(cause){setMessage(cause instanceof Error?cause.message:'저장 상태를 확인하지 못했습니다.');}finally{active.current=null;setBusy(false);}}
 const operationControls=<>{busy&&<button type="button" className="btn ghost" onClick={()=>active.current?.abort()}>대기 중단</button>}{uncertain&&held?.attachmentBasis&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>void recover()}>저장 결과 조회</button>}<a href="/cli" target="_blank" rel="noreferrer">이 PC의 CLI 연결</a></>;
 return <div className="panel-stack">{detail?<><button type="button" className="btn ghost" disabled={disabled||busy||!!held} onClick={()=>void start()}>코덱스 상세페이지 중국어 번역해서 다시 업로드하기</button>{message&&operationControls}</>:<><button type="button" className="btn primary" disabled={disabled||busy} onClick={()=>setOpen(value=>!value)}>Codex로 대표이미지 수정</button>{open&&<div className="panel-stack"><p>원본 그대로 등록할 수 있습니다. 수정하려면 이 PC의 Codex MCP와 CLI 연결을 유지하세요.</p><label className="field"><span>이미지 수정 요청</span><textarea value={prompt} maxLength={2000} disabled={disabled||busy||!!held} onChange={event=>setPrompt(event.target.value)}/></label><button type="button" className="btn primary" disabled={disabled||busy||!!held||!prompt.trim()} onClick={()=>void start()}>{busy?'Codex 작업 대기·처리 중…':'수정 요청'}</button>{operationControls}</div>}</>}{message&&<p role="status">{message}</p>}</div>;
}
