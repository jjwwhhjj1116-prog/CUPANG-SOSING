'use client';

import { useEffect, useRef, useState } from 'react';
import { quotationLabelPlan } from '@/app/quotation-label-plan';
import { renderDocument } from '@/app/document-image-render';
import type { ResolvedQuotation } from '@/app/quotation-schema';

export function QuotationLabelPanel({ resolved, optionId, disabled }: { resolved: ResolvedQuotation; optionId: string | null; disabled: boolean }) {
  const [preview, setPreview] = useState<{ url: string; width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  async function generate() {
    if (disabled || busy) return;
    setBusy(true); setError('');
    try {
      const result = await renderDocument(quotationLabelPlan(resolved, optionId));
      if (alive.current) setPreview({ url: URL.createObjectURL(result.blob), width: result.width, height: result.height });
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '표시사항 PNG 생성 실패'); }
    finally { if (alive.current) setBusy(false); }
  }
  const included = resolved.rows.some(row => row.optionId === optionId && row.included);
  return <section className="panel-stack" aria-label="견적 기준 표시사항 PNG" aria-busy={busy}>
    <strong>선택 옵션의 견적 값으로 표시사항 PNG 만들기</strong>
    <p>상품명·모델·옵션 속성과 해당 카테고리의 법적 정보에 저장된 최종값을 사용합니다. 공통·옵션별 직접 수정값을 반영합니다. 상품 공통 표시사항 PNG와는 별도 자료입니다.</p>
    <button type="button" className="btn ghost" disabled={disabled || busy || !included} onClick={() => void generate()}>{busy ? 'PNG 만드는 중…' : '저장된 견적 값으로 PNG 미리보기'}</button>
    {disabled && <small>입력 내용을 저장하고 최신 견적을 불러온 뒤 생성해주세요.</small>}
    {!included && <small>견적에 포함된 옵션을 선택해주세요.</small>}
    {error && <p role="alert">{error}</p>}
    {preview && !disabled && <>
      <div style={{ maxHeight: 500, overflow: 'auto' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview.url} alt="선택 옵션의 최종 견적 값으로 만든 표시사항 검토 PNG" width={preview.width} height={preview.height} style={{ width: '100%', height: 'auto' }} />
      </div>
      <a className="btn ghost" href={preview.url} download="sourceflow-quotation-label.png">표시사항 검토 PNG 다운로드</a>
      <small>자동 첨부·전송하지 않습니다. 내용을 확인한 뒤 상품 이미지로 업로드하고 선택 옵션의 라벨 이미지에 연결해주세요.</small>
    </>}
  </section>;
}
