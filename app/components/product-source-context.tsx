'use client';
import './product-source-context.css';
import { useEffect, useState } from 'react';
import type { CollectionSourceGap } from '@/app/collection-source-gaps';
import { parseCollectionRequest } from '@/app/sourcing';

type SourceContext = { productId: string; sourceUrl: string; sourceGaps: CollectionSourceGap[];
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

export function ProductSourceContext({ productId, sourceUrl, step, onNavigate }: {
  productId: string; sourceUrl: string; step: string; onNavigate: (step: string) => void;
}) {
  const [result, setResult] = useState<{ productId: string; sourceUrl: string; context?: SourceContext; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
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
  }, [productId,sourceUrl,attempt]);
  if (!result || result.productId !== productId || result.sourceUrl !== sourceUrl) return null;
  if (result.error) return <div className="product-source-context"><p role="alert">{result.error}</p><button type="button" className="btn ghost" onClick={()=>setAttempt(value=>value+1)}>상품 원문 다시 확인</button></div>;
  const context = result.context;
  if (!context) return null;
  const gaps = context.sourceGaps.filter(gap=>step==='견적서'||gap.step===step||(step==='SEO'&&gap.fieldId==='detailHtml'));
  return <section className="product-source-context" aria-label="상품 추가 시 선택한 카테고리">
    {context.requestContext && <p><strong>카테고리</strong> {context.requestContext.categoryPath.join(' › ')} <small>({context.requestContext.categoryId})</small></p>}
    {gaps.length > 0 && <div><p>원문에서 가져오지 못한 항목: {gaps.map(gap=>gap.label).join(' · ')}. 작성한 초안은 상품과 대조해 수정하세요.</p>
      {step==='견적서' && gaps.map(gap=><button type="button" className="btn ghost" key={gap.fieldId} onClick={()=>onNavigate(gap.step)}>{gap.label} 확인</button>)}
    </div>}
  </section>;
}
