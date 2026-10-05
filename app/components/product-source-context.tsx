'use client';
import './product-source-context.css';
import { useEffect, useRef, useState } from 'react';
import type { CollectionSourceGap } from '@/app/collection-source-gaps';
import { parseCollectionRequest } from '@/app/sourcing';
import { capture1688FromChrome } from '@/app/browser-product-bridge';
import { canSupplementCollection } from '@/app/collection-source-supplement';
import { completeCollectionSupplement } from '@/app/collection-supplement-client';

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

export function ProductSourceContext({ productId, productVersion, sourceUrl, step, onNavigate, onBeforeSupplement, onBusy, onSaved }: {
  productId: string; sourceUrl: string; step: string; onNavigate: (step: string) => void;
  productVersion?:string;
  onBeforeSupplement?:()=>boolean;onBusy?:(busy:boolean)=>void;onSaved?:()=>Promise<void>;
}) {
  const [result, setResult] = useState<{ productId: string; sourceUrl: string; context?: SourceContext; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const active=useRef<AbortController|null>(null);
  useEffect(()=>()=>{if(active.current){active.current.abort();onBusy?.(false);}},[onBusy]);
  async function supplement(context:SourceContext){
    if(active.current||!context.jobId||!context.provider||!context.productVersion||onBeforeSupplement?.()===false)return;
    const controller=new AbortController();active.current=controller;setBusy(true);onBusy?.(true);setMessage('');
    try{
      const notice=await completeCollectionSupplement({jobId:context.jobId,offerId:parseCollectionRequest({urls:[sourceUrl]})[0].offerId,sourceUrl,productId,productVersion:context.productVersion,provider:context.provider},
        {fetcher:(input,init)=>fetch(input,init),signal:controller.signal,captureFromBrowser:capture1688FromChrome,onProgress:value=>{if(!controller.signal.aborted)setMessage(value);}});
      if(!controller.signal.aborted)setMessage(notice??'');
    }catch(cause){if(!controller.signal.aborted)setMessage(cause instanceof Error?cause.message:'상세 원문 보완을 확인하지 못했습니다.');}
    finally{
      try{if(!controller.signal.aborted)await onSaved?.();}
      catch{if(!controller.signal.aborted)setMessage(previous=>previous+' 상품 목록을 새로 읽지 못했습니다. 다시 조회해주세요.');}
      finally{if(!controller.signal.aborted){setAttempt(value=>value+1);setBusy(false);onBusy?.(false);}active.current=null;}
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/products/${encodeURIComponent(productId)}/translation-source`, {signal:controller.signal,cache:'no-store'});
        // Legacy/manual products have no collection link. Never infer one by URL.
        if (response.status === 404) {
          if (!controller.signal.aborted) setResult({productId,sourceUrl});
          return;
        }
        const value = await response.json();
        if (!response.ok) {
          const error = (value as {error?:unknown})?.error;
          throw Error(typeof error === 'string' ? error : '상품의 카테고리·수집 원문을 읽지 못했습니다.');
        }
        const context = readContext(value,productId,sourceUrl);
        if (!controller.signal.aborted) setResult({productId,sourceUrl,context});
      } catch (cause) {
        if (!controller.signal.aborted) setResult({productId,sourceUrl,error:cause instanceof Error ? cause.message : '상품의 수집 원문을 읽지 못했습니다.'});
      }
    })();
    return () => controller.abort();
  }, [productId,productVersion,sourceUrl,attempt]);
  if (!result || result.productId !== productId || result.sourceUrl !== sourceUrl) return null;
  if (result.error) return <div className="product-source-context"><p role="alert">{result.error}</p><button type="button" className="btn ghost" onClick={()=>setAttempt(value=>value+1)}>상품 원문 다시 확인</button></div>;
  const context = result.context;
  if (!context) return null;
  const gaps = context.sourceGaps.filter(gap=>step==='견적서'||gap.step===step||(step==='SEO'&&gap.fieldId==='detailHtml'));
  const canSupplement=typeof context.jobId==='string'&&!!context.jobId&&typeof context.productVersion==='string'&&Number.isFinite(Date.parse(context.productVersion))
    &&typeof context.provider==='string'&&(canSupplementCollection({provider:context.provider})||context.provider==='chrome-public-mobile-supplement-v1');
  return <section className="product-source-context" aria-label="상품 추가 시 선택한 카테고리">
    {context.requestContext && <p><strong>카테고리</strong> {context.requestContext.categoryPath.join(' › ')} <small>({context.requestContext.categoryId})</small></p>}
    {canSupplement&&<div><button type="button" className="btn ghost" disabled={busy} onClick={()=>void supplement(context)}>{busy?'상세 원문 보완 중…':context.provider==='chrome-public-mobile-supplement-v1'?'보완 원본 이미지 연결 재시도':'Chrome에서 상세 원문 보완'}</button><small>기존 원문·가격·직접 수정한 값은 보존하고, 같은 상품의 상세 이미지와 속성을 보완합니다.</small></div>}
    {message&&<p role="status">{message}</p>}
    {gaps.length > 0 && <div><p>원문에서 가져오지 못한 항목: {gaps.map(gap=>gap.label).join(' · ')}. 작성한 초안은 상품과 대조해 수정하세요.</p>
      {step==='견적서' && gaps.map(gap=><button type="button" className="btn ghost" key={gap.fieldId} onClick={()=>onNavigate(gap.step)}>{gap.label} 확인</button>)}
    </div>}
  </section>;
}
