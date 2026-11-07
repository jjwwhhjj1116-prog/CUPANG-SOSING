'use client';
import './product-source-context.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import type { CollectionSourceGap } from '@/app/collection-source-gaps';
import { parseCollectionRequest } from '@/app/sourcing';
import { capture1688FromChrome } from '@/app/browser-product-bridge';
import { completeCollectionSupplement,CollectionSupplementUncertain } from '@/app/collection-supplement-client';

import {sourceCaptureSelection,type SourceCaptureSelection} from '@/app/source-capture-selection';
import {supplierHubCompany} from '@/app/supplier-hub-company';
import type {SourceInboxItem} from '@/app/source-inbox';

type SourceContext = { productId: string; sourceUrl: string; sourceGaps: CollectionSourceGap[];
  jobId?:string;provider?:string;productVersion?:string;
  requestContext: { categoryId: string; categoryPath: string[] } | null };

function readContext(value: unknown, productId: string, sourceUrl: string): SourceContext {
  const body = value as SourceContext;
  if (!body || body.productId !== productId || typeof body.sourceUrl !== 'string'
    || parseCollectionRequest({urls:[body.sourceUrl]})[0].sourceUrl !== parseCollectionRequest({urls:[sourceUrl]})[0].sourceUrl
    || !Array.isArray(body.sourceGaps) || body.sourceGaps.length > 3
    || body.sourceGaps.some(gap => !gap || typeof gap.label !== 'string' || gap.label.length > 100
      || !['detailHtml','detailImages','noticeMaterial'].includes(gap.fieldId)
      || !['SEO','상세 이미지','표시사항'].includes(gap.step))
    || (body.requestContext !== null && (typeof body.requestContext?.categoryId !== 'string'
      || !Array.isArray(body.requestContext.categoryPath) || !body.requestContext.categoryPath.length
      || body.requestContext.categoryPath.some(part => typeof part !== 'string' || !part.trim())))) {
    throw Error('상품의 카테고리·수집 원문이 일치하지 않습니다. 다시 확인해주세요.');
  }
  return body;
}

export function ProductSourceDisclosure({ children, ...source }: ComponentProps<typeof ProductSourceContext> & { children: ReactNode }) {
  const [requested, setRequested] = useState(false);
  return <details className="registration-source-context" onToggle={event => {
    if (event.currentTarget.open) setRequested(true);
  }}>
    <summary>카테고리 · 수집 자료</summary>
    {children}
    {requested && <ProductSourceContext {...source} />}
  </details>;
}

export function ProductSourceContext({ productId, productVersion, sourceUrl, step, onNavigate, onBeforeSupplement, onBusy, onSaved }: {
  productId: string; sourceUrl: string; step: string; onNavigate: (step: string) => void;
  productVersion?:string;
  onBeforeSupplement?:()=>boolean;onBusy?:(busy:boolean)=>void;onSaved?:()=>Promise<void>;
}) {
  const token=useMemo(()=>({productId,productVersion,sourceUrl}),[productId,productVersion,sourceUrl]);
  const live=useRef<object|null>(token),active=useRef<AbortController|null>(null),listRequest=useRef<AbortController|null>(null);
  const callbacks=useRef({onBeforeSupplement,onBusy,onSaved});
  useLayoutEffect(()=>{callbacks.current={onBeforeSupplement,onBusy,onSaved};},[onBeforeSupplement,onBusy,onSaved]);
  useLayoutEffect(()=>{live.current=token;return()=>{live.current=null;listRequest.current?.abort();listRequest.current=null;if(active.current){active.current.abort();active.current=null;callbacks.current.onBusy?.(false);}};},[token]);
  const [result,setResult]=useState<{token:object;context?:SourceContext;error?:string}|null>(null),[attempt,setAttempt]=useState(0);
  const [working,setWorking]=useState<object|null>(null),[message,setMessage]=useState<{token:object;text:string}|null>(null),[uncertain,setUncertain]=useState<object|null>(null);
  const [savedSources,setSavedSources]=useState<{token:object;ownerId:string;company:{code:string;name:string};items:SourceInboxItem[]}|null>(null),[listing,setListing]=useState<object|null>(null);
  const [selection,setSelection]=useState<{token:object;capture:Readonly<SourceCaptureSelection>}|null>(null);
  const current=(controller:AbortController)=>live.current===token&&!controller.signal.aborted;
  const status=(text:string)=>setMessage({token,text});
  const busy=working===token,listBusy=listing===token;
  async function loadSaved(){
    if(active.current||listRequest.current||live.current!==token)return;
    const controller=new AbortController();listRequest.current=controller;setListing(token);setSelection(null);setSavedSources(null);status('');
    try{
      const response=await fetch('/api/source-inbox',{cache:'no-store',signal:controller.signal,redirect:'error'}),body=await response.json() as {ownerId?:string;company?:{code:string;name:string};items?:SourceInboxItem[];error?:string};
      if(!current(controller))return;
      const company=supplierHubCompany(body.company?.code,body.company?.name),offer=parseCollectionRequest({urls:[sourceUrl]})[0];
      if(!response.ok||typeof body.ownerId!=='string'||!body.ownerId||!company||!Array.isArray(body.items))throw Error(body.error||'현재 회원·회사의 저장 수집본을 확인하지 못했습니다.');
      const items=body.items.filter(item=>{
        try{return item.ownerId===body.ownerId&&item.company.code===company.code&&item.company.name===company.name&&!item.archivedAt
          &&item.snapshot.sourceUrl===offer.sourceUrl&&item.snapshot.offerId===offer.offerId&&Array.isArray(item.issues)&&item.issues.length===0
          &&sourceCaptureSelection(item).format==='yoofam-saved-page-capture-v1';}catch{return false;}
      });
      setSavedSources({token,ownerId:body.ownerId,company,items});
    }catch(cause){if(current(controller))status(cause instanceof Error?cause.message:'저장 수집본을 확인하지 못했습니다.');}
    finally{if(listRequest.current===controller){listRequest.current=null;if(current(controller))setListing(null);}}
  }
  async function supplement(context:SourceContext,savedCapture?:Readonly<SourceCaptureSelection>,recoverOnly=false){
    if(active.current||listRequest.current||live.current!==token||!context.jobId||!context.provider||!context.productVersion||!recoverOnly&&callbacks.current.onBeforeSupplement?.()===false)return;
    const controller=new AbortController();active.current=controller;setWorking(token);callbacks.current.onBusy?.(true);status('');
    try{
      if(savedCapture){
        const response=await fetch('/api/supplier-hub/catalog-context',{cache:'no-store',signal:controller.signal}),auth=await response.json() as {ownerId?:string;company?:{code:string;name:string}};
        if(!current(controller))return;
        if(!response.ok||savedSources?.token!==token||selection?.token!==token||selection.capture!==savedCapture||auth.ownerId!==savedSources.ownerId
          ||auth.company?.code!==savedSources.company.code||auth.company?.name!==savedSources.company.name)throw Error('로그인 회원·회사 또는 저장 수집본 선택이 변경되었습니다. 다시 선택해주세요.');
      }
      if(!current(controller)||!recoverOnly&&callbacks.current.onBeforeSupplement?.()===false)return;
      const notice=await completeCollectionSupplement({jobId:context.jobId,offerId:parseCollectionRequest({urls:[sourceUrl]})[0].offerId,sourceUrl,productId,productVersion:context.productVersion,provider:context.provider},
        {fetcher:(input,init)=>{if(!current(controller))throw Error('상품 보완 화면이 변경되었습니다.');return fetch(input,init);},signal:controller.signal,captureFromBrowser:capture1688FromChrome,savedCapture,recoverOnly,onProgress:value=>{if(current(controller))status(value);}});
      if(current(controller)){status(notice??'');setUncertain(null);}
    }catch(cause){if(current(controller)){if(cause instanceof CollectionSupplementUncertain)setUncertain(token);status(cause instanceof Error?cause.message:'상세 원문 보완을 확인하지 못했습니다.');}}
    finally{
      try{if(current(controller))await callbacks.current.onSaved?.();}
      catch{if(current(controller))setMessage(previous=>({token,text:(previous?.token===token?previous.text:'')+' 상품 목록을 새로 읽지 못했습니다. 다시 조회해주세요.'}));}
      finally{if(active.current===controller){active.current=null;if(current(controller)){setAttempt(value=>value+1);setWorking(null);callbacks.current.onBusy?.(false);}}}
    }
  }
  useEffect(()=>{
    const controller=new AbortController();
    void(async()=>{
      try{
        const response=await fetch(`/api/products/${encodeURIComponent(productId)}/translation-source`,{signal:controller.signal,cache:'no-store'});
        if(response.status===404){if(current(controller))setResult({token});return;}
        const value=await response.json();if(!response.ok)throw Error((value as {error?:string})?.error||'상품의 카테고리·수집 원문을 읽지 못했습니다.');
        const context=readContext(value,productId,sourceUrl);if(current(controller))setResult({token,context});
      }catch(cause){if(current(controller))setResult({token,error:cause instanceof Error?cause.message:'상품의 수집 원문을 읽지 못했습니다.'});}
    })();
    return()=>controller.abort();
    // The token retires every previous product/version/URL episode, including A-B-A.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[token,productId,sourceUrl,attempt]);
  if(result?.token!==token)return null;
  if(result.error)return <div className="product-source-context"><p role="alert">{result.error}</p><button type="button" className="btn ghost" onClick={()=>setAttempt(value=>value+1)}>상품 원문 다시 확인</button></div>;
  const context=result.context;if(!context)return null;
  const gaps=context.sourceGaps.filter(gap=>step==='견적서'||gap.step===step||(step==='SEO'&&gap.fieldId==='detailHtml'));
  const canSupplement=typeof context.jobId==='string'&&!!context.jobId&&typeof context.productVersion==='string'&&Number.isFinite(Date.parse(context.productVersion))
    &&typeof context.provider==='string'&&(context.sourceGaps.length>0||context.provider==='chrome-public-mobile-supplement-v1');
  const readOnlyRecovery=uncertain===token&&context.provider!=='chrome-public-mobile-supplement-v1',sources=savedSources?.token===token?savedSources:null,selected=selection?.token===token?selection.capture:undefined;
  return <section className="product-source-context" aria-label="상품 추가 시 선택한 카테고리">
    {context.requestContext&&<p><strong>카테고리</strong> {context.requestContext.categoryPath.join(' › ')} <small>({context.requestContext.categoryId})</small></p>}
    {canSupplement&&<div>
      <button type="button" className="btn ghost" disabled={busy||listBusy||readOnlyRecovery} onClick={()=>void supplement(context)}>{busy?'상세 원문 보완 중…':context.provider==='chrome-public-mobile-supplement-v1'?'보완 원본 이미지 연결 재시도':'Chrome에서 상세 원문 보완'}</button>
      {context.provider!=='chrome-public-mobile-supplement-v1'&&<><button type="button" className="btn ghost" disabled={busy||listBusy} onClick={()=>void loadSaved()}>{listBusy?'저장 수집본 확인 중…':'저장된 수집본 선택'}</button>
      <button type="button" className="btn ghost" disabled={busy||listBusy} onClick={()=>void supplement(context,undefined,true)}>보완 저장 결과 확인 · 읽기 전용</button></>}
      <small>기존 원문·가격·직접 수정값은 보존합니다. 이미 수집한 원문은 정확한 저장본을 선택해 재수집 없이 보완할 수 있습니다.</small>
      {sources&&context.provider!=='chrome-public-mobile-supplement-v1'&&<div role="group" aria-label="보완할 저장 수집본">
        {!sources.items.length&&<p>현재 회사·같은 상품의 보완 가능한 저장 수집본이 없습니다.</p>}
        {sources.items.map(item=><button type="button" className="btn ghost" key={item.id} disabled={busy} aria-pressed={selected?.captureId===item.id&&selected.revision===item.revision} onClick={()=>{if(live.current===token&&!active.current)setSelection({token,capture:sourceCaptureSelection(item)});}}>{item.snapshot.title} · {item.id} · r{item.revision}</button>)}
        <button type="button" className="btn primary" disabled={busy||readOnlyRecovery||!selected} onClick={()=>void supplement(context,selected)}>선택한 저장 수집본으로 보완</button>
      </div>}
    </div>}
    {message?.token===token&&message.text&&<p role="status">{message.text}</p>}
    {gaps.length>0&&<div><p>원문에서 가져오지 못한 항목: {gaps.map(gap=>gap.label).join(' · ')}. 작성한 초안은 상품과 대조해 수정하세요.</p>{step==='견적서'&&gaps.map(gap=><button type="button" className="btn ghost" key={gap.fieldId} onClick={()=>onNavigate(gap.step)}>{gap.label} 확인</button>)}</div>}
  </section>;
}
