'use client';

import { useEffect, useRef, useState } from 'react';
import { quotationLabelPlan } from '@/app/quotation-label-plan';
import { renderDocument } from '@/app/document-image-render';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { attachQuotationLabel } from '@/app/quotation-label-attachment';
import { attachQuotationLabels, type LabelBatchProgress } from '@/app/quotation-label-batch';

export function QuotationLabelPanel({ view, productId, endpoint, optionId, disabled, onBusyChange, onAttached }: { view: QuotationFieldsView; productId: string; endpoint: string; optionId: string | null; disabled: boolean; onBusyChange: (busy: boolean) => void; onAttached: (view: QuotationFieldsView) => void }) {
  const resolved = view.resolved;
  const [preview, setPreview] = useState<{ url: string; width: number; height: number; blob: Blob; view: QuotationFieldsView } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const alive = useRef(true);
  const uploadedKey = useRef<string | null>(null);
  const batchKeys = useRef(new Map<string | null, string>());
  const [progress, setProgress] = useState<LabelBatchProgress | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  async function generate() {
    if (disabled || busy) return;
    setBusy(true); setError('');
    try {
      const result = await renderDocument(quotationLabelPlan(resolved, optionId));
      if (alive.current) { uploadedKey.current = null; setPreview({ url: URL.createObjectURL(result.blob), width: result.width, height: result.height, blob: result.blob, view }); }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '표시사항 PNG 생성 실패'); }
    finally { if (alive.current) setBusy(false); }
  }
  async function attach() {
    if (!preview || disabled || busy) return;
    setBusy(true); setError(''); onBusyChange(true);
    try {
      const saved = await attachQuotationLabel({ productId, endpoint, renderedView: preview.view, optionId, blob: preview.blob,
        uploadedKey: uploadedKey.current, onUploaded: key => { uploadedKey.current = key; } });
      if (alive.current) onAttached(saved);
    } catch (cause) { if (alive.current) setError(`${cause instanceof Error ? cause.message : 'PNG 연결 실패'}${uploadedKey.current ? ' 업로드한 파일은 보존됩니다. 다시 연결할 때 같은 파일을 사용합니다.' : ''}`); }
    finally { onBusyChange(false); if (alive.current) setBusy(false); }
  }
  async function attachAll() {
    if (disabled || busy) return;
    setBusy(true); setError(''); onBusyChange(true);
    try {
      const saved = await attachQuotationLabels({ productId, endpoint, view, uploaded: batchKeys.current,
        render: renderDocument, onProgress: value => { if (alive.current) setProgress(value); } });
      if (alive.current) onAttached(saved);
    } catch (cause) {
      if (alive.current) setError(`${cause instanceof Error ? cause.message : '일괄 라벨 연결 실패'} 완료된 연결과 업로드 파일은 보존됩니다. 이 화면에서 다시 실행하면 같은 파일로 남은 연결을 이어갑니다.`);
    } finally { onBusyChange(false); if (alive.current) setBusy(false); }
  }
  const included = resolved.rows.some(row => row.optionId === optionId && row.included);
  return <section className="panel-stack" aria-label="견적 기준 표시사항 PNG" aria-busy={busy}>
    <strong>선택 옵션의 견적 값으로 표시사항 PNG 만들기</strong>
    <p>상품명·모델·옵션 속성과 해당 카테고리의 법적 정보에 저장된 최종값을 사용합니다. 공통·옵션별 직접 수정값을 반영합니다. 상품 공통 표시사항 PNG와는 별도 자료입니다.</p>
    <button type="button" className="btn ghost" disabled={disabled || busy || !included} onClick={() => void generate()}>저장된 견적 값으로 PNG 미리보기</button>
    <button type="button" className="btn primary" disabled={disabled || busy || !resolved.rows.some(row => row.included)} onClick={() => void attachAll()}>전체 포함 옵션 라벨 생성·연결 ({resolved.rows.filter(row => row.included).length}건)</button>
    <small>옵션별 저장값으로 순서대로 생성하며 기존 라벨에 추가합니다. 완료 후 견적 미리보기와 출력 파일에서 확인할 수 있습니다.</small>
    {progress && <p role="status">라벨 연결 {progress.completed}/{progress.total}건 · {progress.optionLabel}{busy ? ' 처리 중…' : ''}</p>}
    {busy && !progress && <p role="status">표시사항 PNG 처리 중…</p>}
    {disabled && <small>입력 내용을 저장하고 최신 견적을 불러온 뒤 생성해주세요.</small>}
    {!included && <small>견적에 포함된 옵션을 선택해주세요.</small>}
    {error && <p role="alert">{error}</p>}
    {preview && !disabled && <>
      <div style={{ maxHeight: 500, overflow: 'auto' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview.url} alt="선택 옵션의 최종 견적 값으로 만든 표시사항 검토 PNG" width={preview.width} height={preview.height} style={{ width: '100%', height: 'auto' }} />
      </div>
      <a className="btn ghost" href={preview.url} download="sourceflow-quotation-label.png">표시사항 검토 PNG 다운로드</a>
      <button type="button" className="btn primary" disabled={busy || disabled} onClick={() => void attach()}>PNG 업로드·선택 옵션 견적에 연결</button>
      <small>기존 라벨 이미지를 유지하고 선택 옵션에 추가합니다. Supplier Hub에는 전송하지 않습니다.</small>
    </>}
  </section>;
}
