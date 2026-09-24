'use client';
import { useState } from 'react';
import type { TranslationJob, TranslationView } from '@/app/automation/translation';
import type { QuotationChange, QuotationFieldsView } from '@/app/quotation-schema';
import { quotationTranslationDraft } from '@/app/quotation-translation-adoption';

export function QuotationTranslatedAttributes({ productId, view, optionId, disabled, onApply }: {
  productId: string; view: QuotationFieldsView; optionId: string | null; disabled: boolean; onApply: (changes: QuotationChange[]) => void;
}) {
  const [jobs, setJobs] = useState<TranslationJob[]>([]);
  const [jobId, setJobId] = useState('');
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const job = jobs.find(item => item.id === jobId);
  const row = view.resolved.rows.find(item => item.optionId === optionId);
  const fields = view.resolved.schema.fields.filter(field => !field.readOnly && ['text', 'textarea'].includes(field.type));
  const attributes = job?.result?.draft.attributes.filter(item => job.review.source.attributes[item.sourceIndex]?.name.startsWith('상품속성: ')) ?? [];
  async function load() {
    if (disabled || loading) return;
    setLoading(true); setMessage('');
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(productId)}/translation`, { cache: 'no-store' });
      const body = await response.json() as TranslationView & { error?: string };
      if (!response.ok) throw new Error(body.error || '번역 결과 조회 실패');
      const available = body.jobs.filter(item => item.status === 'completed' && item.result && item.productId === productId && item.productVersion === view.productVersion && item.contentRevision === view.contentRevision);
      setJobs(available); setJobId(available[0]?.id ?? ''); setMapping({});
      if (!available.length) setMessage('현재 상품·콘텐츠와 일치하는 완료된 번역 결과가 없습니다.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '번역 결과 조회 실패'); }
    finally { setLoading(false); }
  }
  function apply() {
    if (!job || disabled || loading) return;
    try {
      const selected = Object.entries(mapping).filter(([, fieldId]) => fieldId).map(([index, fieldId]) => ({ sourceIndex: Number(index), fieldId }));
      const changes = quotationTranslationDraft(productId, view, job, optionId, selected);
      onApply(changes); setMapping({}); setMessage(`${changes.length}개 항목을 작성 중인 견적에 반영했습니다. 견적 입력 저장으로 확정해주세요.`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '연결 항목을 확인해주세요.'); }
  }
  return <details className="panel-stack"><summary>번역한 상품 속성을 견적 항목에 연결</summary>
    <p>대상: {row?.optionLabel ?? '옵션 미선택'} · {view.resolved.schema.categoryPath.join(' > ')}. 연결할 항목과 변경 전·후 값을 확인해주세요. 기존 직접 수정값은 보존합니다.</p>
    <button type="button" className="btn ghost" disabled={disabled || loading} onClick={() => void load()}>완료된 속성 번역 불러오기 · 무료 조회</button>
    {message && <p role="status">{message}</p>}
    <fieldset disabled={disabled || loading} style={{ border: 0, padding: 0 }}>
      {jobs.length > 0 && <label>번역 결과<select value={jobId} onChange={event => { setJobId(event.target.value); setMapping({}); }}>
        {jobs.map(item => <option key={item.id} value={item.id}>{item.result?.generatedAt} · {item.id}</option>)}
      </select></label>}
      {job && attributes.length === 0 && <p>이 결과에는 수집 상품 속성 번역이 없습니다. 옵션 번역은 옵션 편집 기능에서 반영해주세요.</p>}
      {attributes.map(attribute => <div key={attribute.sourceIndex}>
        <strong>{attribute.name}</strong><p style={{ whiteSpace: 'pre-wrap' }}>원문: {job!.review.source.attributes[attribute.sourceIndex].value}</p>
        <p style={{ whiteSpace: 'pre-wrap' }}>번역값: {attribute.value}</p>
        <label>견적 연결 항목<select value={mapping[attribute.sourceIndex] ?? ''} onChange={event => setMapping(previous => ({ ...previous, [attribute.sourceIndex]: event.target.value }))}>
          <option value="">반영하지 않음</option>{fields.map(field => <option key={field.id} value={field.id} disabled={row?.fields[field.id]?.source.startsWith('manual-')}>{field.label}{row?.fields[field.id]?.source.startsWith('manual-') ? ' · 직접 수정값 보존' : ''}</option>)}
        </select></label>
        {mapping[attribute.sourceIndex] && <p style={{ whiteSpace: 'pre-wrap' }}>현재값: {row?.fields[mapping[attribute.sourceIndex]]?.value || '(공란)'} → {attribute.value}</p>}
      </div>)}
      {attributes.length > 0 && <button type="button" className="btn primary" disabled={!Object.values(mapping).some(Boolean)} onClick={apply}>선택한 번역값을 견적 초안에 반영</button>}
    </fieldset>
    <small>항목명으로 인증·재질·규격을 추정하지 않습니다. 저장 후에도 실제 상품과의 일치 및 법적 정보 검토가 필요합니다.</small>
  </details>;
}
