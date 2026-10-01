'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { quotationLabelPlan } from '@/app/quotation-label-plan';
import { renderDocument } from '@/app/document-image-render';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { attachQuotationLabel, type QuotationLabelUploadCache } from '@/app/quotation-label-attachment';
import { attachQuotationLabels, type LabelBatchCache, type LabelBatchProgress, type LabelBatchResult } from '@/app/quotation-label-batch';

export function QuotationLabelPanel({ view, productId, endpoint, optionId, disabled, batchCache, uploadCache, onBusyChange, onAttached, onFailed }: { view: QuotationFieldsView; productId: string; endpoint: string; optionId: string | null; disabled: boolean; batchCache?: RefObject<LabelBatchCache>; uploadCache?: RefObject<QuotationLabelUploadCache>; onBusyChange: (busy: boolean) => void; onAttached: (view: QuotationFieldsView, batch?: Omit<LabelBatchResult, 'view'>) => void; onFailed?: (message: string) => Promise<void> }) {
  const resolved = view.resolved;
  const [preview, setPreview] = useState<{ url: string; width: number; height: number; blob: Blob; view: QuotationFieldsView; signature: string } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const alive = useRef(true);
  const running = useRef(false);
  const localUploadCache = useRef<QuotationLabelUploadCache>({ signature: null, uploadedKey: null, rendered: null });
  const uploadCacheRef = uploadCache ?? localUploadCache;
  const localBatchCache = useRef<LabelBatchCache>({ signature: null, uploaded: new Map() });
  const cacheRef = batchCache ?? localBatchCache;
  const [progress, setProgress] = useState<LabelBatchProgress | null>(null);
  const stopRequested = useRef(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const planSignature = (id: string | null, plan: ReturnType<typeof quotationLabelPlan>) => JSON.stringify({ productId, endpoint, category: view.categoryContext, optionId: id, plan });
  async function generate() {
    if (disabled || busy || running.current) return;
    running.current = true;
    setBusy(true); setError('');
    try {
      const plan = quotationLabelPlan(resolved, optionId);
      const signature = planSignature(optionId, plan);
      const cache = uploadCacheRef.current;
      const result = cache.signature === signature && cache.rendered ? cache.rendered : await renderDocument(plan);
      if (alive.current) {
        if (cache.signature !== signature) { cache.signature = signature; cache.uploadedKey = null; }
        const batch = cacheRef.current;
        if (!cache.uploadedKey && batch.optionSignatures?.get(optionId) === signature) cache.uploadedKey = batch.uploaded.get(optionId) ?? null;
        cache.rendered = result;
        setPreview({ url: URL.createObjectURL(result.blob), width: result.width, height: result.height, blob: result.blob, view, signature });
      }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '표시사항 PNG 생성 실패'); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  async function attach() {
    if (!preview || disabled || busy || running.current) return;
    running.current = true;
    setBusy(true); setError(''); onBusyChange(true);
    try {
      const cache = uploadCacheRef.current;
      const batch = cacheRef.current;
      const previousSignature = batch.optionSignatures?.get(optionId);
      const saved = await attachQuotationLabel({ productId, endpoint, renderedView: preview.view, optionId, blob: preview.blob,
        uploadedKey: (cache.signature === preview.signature ? cache.uploadedKey : null) ?? (previousSignature === preview.signature ? batch.uploaded.get(optionId) ?? null : null),
        onUploaded: key => {
          if (cache.signature === preview.signature) cache.uploadedKey = key;
          // A late response must not replace another reviewed plan's file.
          const currentSignature = batch.optionSignatures?.get(optionId);
          if (currentSignature === previousSignature || currentSignature === preview.signature) {
            batch.optionSignatures ??= new Map();
            batch.optionSignatures.set(optionId, preview.signature); batch.uploaded.set(optionId, key);
          }
        } });
      if (alive.current) onAttached(saved);
    } catch (cause) {
      if (alive.current) {
        const cache = uploadCacheRef.current;
        const uploaded = cache.signature === preview.signature && cache.uploadedKey;
        const message = `${cause instanceof Error ? cause.message : 'PNG 연결 실패'}${uploaded ? ' 업로드한 파일은 보존됩니다. 같은 견적 내용으로 미리보기를 다시 열어 연결하면 기존 파일을 사용합니다.' : ''}`;
        if (onFailed) await onFailed(message);
        else setError(message);
      }
    }
    finally { running.current = false; onBusyChange(false); if (alive.current) setBusy(false); }
  }
  async function attachAll() {
    if (disabled || busy || running.current) return;
    running.current = true;
    stopRequested.current = false; setStopping(false); setStopped(false); setBatchRunning(true);
    setBusy(true); setError(''); onBusyChange(true);
    try {
      const cache = cacheRef.current;
      const plans = resolved.rows.filter(row => row.included).map(row => ({ optionId: row.optionId, plan: quotationLabelPlan(resolved, row.optionId) }));
      const signature = JSON.stringify({ productId, endpoint, category: view.categoryContext,
        plans: plans.map(row => [row.optionId, row.plan]) });
      const optionSignatures = new Map(plans.map(row => [row.optionId, planSignature(row.optionId, row.plan)]));
      // Keep unchanged options when a different option's label changes. Old
      // caches without per-option evidence only match the exact whole batch.
      for (const id of cache.uploaded.keys()) {
        const currentSignature = optionSignatures.get(id);
        const previousSignature = cache.optionSignatures?.get(id);
        if (currentSignature ? (previousSignature ? previousSignature !== currentSignature : cache.signature !== signature) : !previousSignature) cache.uploaded.delete(id);
      }
      cache.optionSignatures ??= new Map();
      for (const [id, value] of optionSignatures) cache.optionSignatures.set(id, value);
      cache.signature = signature;
      const reviewed = uploadCacheRef.current;
      for (const [id, value] of optionSignatures) if (reviewed.signature === value && reviewed.uploadedKey && !cache.uploaded.has(id)) cache.uploaded.set(id, reviewed.uploadedKey);
      const reviewedSignature = reviewed.signature, reviewedRendered = reviewed.rendered;
      const result = await attachQuotationLabels({ productId, endpoint, view, uploaded: cache.uploaded,
        shouldStop: () => stopRequested.current || !alive.current,
        render: (plan, id) => reviewedSignature === optionSignatures.get(id) && reviewedRendered ? Promise.resolve(reviewedRendered) : renderDocument(plan),
        onProgress: value => { if (alive.current) setProgress(value); } });
      if (alive.current) {
        if (result.stopped) setStopped(true);
        // A stop still saved completed options. Publish their revision before
        // allowing edits, retaining upload keys outside the remounted panel.
        if (!result.stopped || result.completed > 0) onAttached(result.view, { completed: result.completed, total: result.total, stopped: result.stopped });
      }
    } catch (cause) {
      if (alive.current) {
        const message = `${cause instanceof Error ? cause.message : '일괄 라벨 연결 실패'} 완료된 연결과 업로드 파일은 보존됩니다. 다시 실행할 때 내용이 같으면 기존 파일을 재사용하고, 바뀌었으면 새로 생성합니다.`;
        // The server may have committed even if its response was lost. Keep
        // the shared lock until the editor has read its actual saved view.
        if (onFailed) await onFailed(message);
        else setError(message);
      }
    } finally { running.current = false; onBusyChange(false); if (alive.current) { setBusy(false); setBatchRunning(false); setStopping(false); } }
  }
  const included = resolved.rows.some(row => row.optionId === optionId && row.included);
  return <section className="panel-stack" aria-label="견적 기준 표시사항 PNG" aria-busy={busy}>
    <strong>선택 옵션의 견적 값으로 표시사항 PNG 만들기</strong>
    <p>상품명·모델·옵션 속성과 해당 카테고리의 법적 정보에 저장된 최종값을 사용합니다. 공통·옵션별 직접 수정값을 반영합니다. 상품 공통 표시사항 PNG와는 별도 자료입니다.</p>
    <button type="button" className="btn ghost" disabled={disabled || busy || !included} onClick={() => void generate()}>저장된 견적 값으로 PNG 미리보기</button>
    <button type="button" className="btn primary" disabled={disabled || busy || !resolved.rows.some(row => row.included)} onClick={() => void attachAll()}>전체 포함 옵션 라벨 생성·연결 ({resolved.rows.filter(row => row.included).length}건)</button>
    <small>옵션별 저장값으로 순서대로 생성하며 기존 라벨에 추가합니다. 완료 후 견적 미리보기와 출력 파일에서 확인할 수 있습니다.</small>
    {batchRunning && <button type="button" className="btn ghost" disabled={stopping} onClick={() => { stopRequested.current = true; setStopping(true); }}>{stopping ? '현재 옵션 저장 후 중지 중…' : '일괄 작업 중지'}</button>}
    {stopped && <p role="status">작업을 중지했습니다. 완료된 라벨은 보존됩니다. 같은 화면에서 전체 생성·연결을 다시 누르면 이어서 진행합니다.</p>}
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
