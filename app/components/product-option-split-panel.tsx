'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { OPTION_SPLIT_GROUP_LIMIT } from '@/app/product-option-split-plan';
import { commitProductOptionSplit, createProductOptionSplitInput, previewProductOptionSplit, recoverProductOptionSplit, restoredProductOptionSplitAttempt,
  validateProductOptionSplitPreview, type ProductOptionSplitAttempt, type ProductOptionSplitInput, type ProductOptionSplitResult } from '@/app/product-option-split-client';
import type { ProductOptionSplitPreview } from '@/app/product-option-split';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { optionRegistrationLabel } from '@/app/product-registration';

type Props = { productId: string; profileId?: string; view: QuotationFieldsView; disabled: boolean;
  onBusyChange: (busy: boolean) => void; onDraftChange: (dirty: boolean) => void; onCommitted: () => void };
type Review = { input: ProductOptionSplitInput; preview: ProductOptionSplitPreview; attempt: ProductOptionSplitAttempt };
const reviewKey = (productId: string, profileId?: string) => `yoofam-option-split-v1:${productId}:${profileId ?? ''}`;
const reason = (cause: unknown) => cause instanceof Error ? cause.message : '상품 분할 결과를 확인하지 못했습니다.';

/** Explicit grouping is separate from the ordinary quotation save. Existing
 * products are never selected as inferred siblings or modified on panel open. */
export function ProductOptionSplitPanel({ productId, profileId, view, disabled, onBusyChange, onDraftChange, onCommitted }: Props) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [labels, setLabels] = useState<string[]>([]), [assignments, setAssignments] = useState<Record<string, number>>({});
  const [review, setReview] = useState<Review | null>(null), [accepted, setAccepted] = useState(false), [uncertain, setUncertain] = useState(false);
  const [corruptRecovery, setCorruptRecovery] = useState(false), [existingChecked, setExistingChecked] = useState(false);
  const root = useRef<HTMLElement>(null), active = useRef<AbortController | null>(null), mounted = useRef(true), titleId = useId();
  const rows = view.resolved.rows.filter(row => row.optionId !== null);
  const operation = useRef(false), pending = useRef<Review | null>(null);
  const callbacks = useRef({ onBusyChange, onDraftChange, onCommitted });
  useLayoutEffect(() => { callbacks.current = { onBusyChange, onDraftChange, onCommitted }; }, [onBusyChange, onDraftChange, onCommitted]);
  const storage = reviewKey(productId, profileId);
  const sourceChanged = review !== null && (review.input.expectedInputFingerprint !== view.inputFingerprint || review.input.sourceVersion !== view.productVersion);
  const locked = disabled || busy;
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    void Promise.resolve().then(() => { if (disposed) return; try {
      const saved = sessionStorage.getItem(storage);
      if (saved) {
        const value = JSON.parse(saved) as Review;
        if (value.input?.productId !== productId || (value.input.profileId ?? '') !== (profileId ?? '')) throw Error('저장 결과의 상품이 일치하지 않습니다.');
        validateProductOptionSplitPreview(value.input, value.preview);
        value.attempt = restoredProductOptionSplitAttempt(value.input, value.preview);
        pending.current = value; setReview(value); setOpen(true); setUncertain(true);
        setMessage('이전에 요청한 분할의 저장 결과를 먼저 확인해주세요. 새 상품을 다시 만들지 않습니다.');
      }
    } catch { setError('이전 분할 확인 자료를 읽지 못했습니다. 새 분할을 진행하기 전에 저장된 상품 목록을 확인해주세요.'); setUncertain(true); setCorruptRecovery(true); } });
    return () => { disposed = true; mounted.current = false; active.current?.abort(); callbacks.current.onBusyChange(false); callbacks.current.onDraftChange(false); };
  }, [storage, productId, profileId]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => { onDraftChange(open || uncertain); }, [open, uncertain, onDraftChange]);
  useEffect(() => {
    if (!open && !uncertain) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [open, uncertain]);
  useLayoutEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [open]);

  function start() {
    if (disabled || operation.current || uncertain || rows.length < 2) return;
    const individually = rows.length <= OPTION_SPLIT_GROUP_LIMIT, count = individually ? rows.length : 2;
    setLabels(Array.from({ length: count }, (_, index) => individually ? (rows[index].optionLabel.length <= 120 ? rows[index].optionLabel : '') : `그룹 ${index + 1}`));
    setAssignments(Object.fromEntries(rows.map((row, index) => [row.optionId!, individually ? index : -1])));
    setReview(null); setAccepted(false); setError(''); setMessage(''); setOpen(true);
  }
  function close() {
    if (operation.current || uncertain || pending.current?.attempt.pending) return;
    setOpen(false); setReview(null); setAccepted(false); setError('');
  }
  function changed() { setReview(null); setAccepted(false); setError(''); }
  async function makePreview() {
    if (locked || uncertain || operation.current) return;
    operation.current = true; setBusy(true); setError(''); setAccepted(false);
    const controller = new AbortController(); active.current = controller;
    try {
      const input = createProductOptionSplitInput(productId, profileId, view, labels.map((label, index) => ({ label,
        optionIds: rows.filter(row => assignments[row.optionId!] === index).map(row => row.optionId!) })));
      const preview = await previewProductOptionSplit(input, controller.signal);
      if (mounted.current) setReview({ input, preview, attempt: {} });
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(reason(cause)); }
    finally { operation.current = false; if (active.current === controller) active.current = null; if (mounted.current) setBusy(false); }
  }
  function finish(result: ProductOptionSplitResult | null) {
    // A historical receipt proves that the operation completed, not that its
    // old values should replace any later edits. Refresh through the parent.
    try { sessionStorage.removeItem(storage); } catch { /* The immutable server receipt still prevents a repeated write after reload. */ }
    pending.current = null; setUncertain(false); setOpen(false); setReview(null); setAccepted(false);
    setMessage(!result ? '이번 요청의 저장 기록이 없습니다. 최신 상품을 확인한 뒤 새 미리보기로 다시 검토해주세요.'
      : result.current ? `상품 ${result.receipt.groups.length}개로 분할 저장했습니다. 새 상품의 견적을 검토한 뒤 등록전송해주세요.`
      : '분할 저장 기록을 확인했습니다. 이후 변경된 자료가 있어 현재 저장본을 다시 불러옵니다.');
    callbacks.current.onCommitted();
  }
  async function save() {
    if (locked || !review || !accepted || uncertain || sourceChanged || operation.current) return;
    operation.current = true; setBusy(true); setError('');
    const controller = new AbortController(); active.current = controller;
    // Preserve exact IDs/preview before dispatch, including across a reload.
    const value = { ...review, attempt: review.attempt };
    try {
      sessionStorage.setItem(storage, JSON.stringify({ input: value.input, preview: value.preview }));
      pending.current = value; setUncertain(true);
      const result = await commitProductOptionSplit(value.input, value.preview, value.attempt, controller.signal);
      if (mounted.current) finish(result);
    } catch (cause) { if (mounted.current && !controller.signal.aborted) { setError(reason(cause)); setUncertain(Boolean(pending.current)); } }
    finally { operation.current = false; if (active.current === controller) active.current = null; if (mounted.current) setBusy(false); }
  }
  async function recover() {
    const value = pending.current;
    if (disabled || operation.current || !value) return;
    operation.current = true; setBusy(true); setError('');
    const controller = new AbortController(); active.current = controller;
    try { const result = await recoverProductOptionSplit(value.input, value.preview, value.attempt, controller.signal); if (mounted.current) finish(result); }
    catch (cause) { if (mounted.current && !controller.signal.aborted) setError(reason(cause)); }
    finally { operation.current = false; if (active.current === controller) active.current = null; if (mounted.current) setBusy(false); }
  }
  return <div className="quotation-fields-notice" data-option-split-panel="true">
    <strong>옵션별 상품 나누기</strong>
    <p>첫 그룹은 현재 등록번호를 유지하고, 나머지 그룹은 새 상품으로 저장합니다. 견적 제외 옵션도 빠짐없이 배정합니다.</p>
    <button type="button" className="btn ghost" disabled={locked || rows.length < 2 || uncertain} onClick={start}>상품 나누기</button>
    {!open && error && <p role="alert">{error}</p>}
    {corruptRecovery && <div>
      <label><input type="checkbox" checked={existingChecked} disabled={locked} onChange={event => setExistingChecked(event.target.checked)} /> 현재 상품과 새로 생성된 상품 목록을 확인했습니다.</label>
      <button type="button" className="btn ghost" disabled={locked || !existingChecked} onClick={() => {
        try { sessionStorage.removeItem(storage); } catch { /* No write was sent by this reset. */ }
        setCorruptRecovery(false); setUncertain(false); setError(''); setMessage('현재 저장본을 다시 확인합니다. 상품은 새로 생성하지 않았습니다.'); callbacks.current.onCommitted();
      }}>목록 확인 후 이전 확인 자료 정리</button>
    </div>}
    {message && <p role="status">{message}</p>}
    {uncertain && !open && <button type="button" className="btn ghost" disabled={locked || !review} onClick={() => { setOpen(true); }}>분할 저장 결과 확인</button>}
    {open && <div style={{ position: 'fixed', inset: 0, zIndex: 1250, background: '#0006', padding: 20, display: 'grid', placeItems: 'center' }}>
      <section ref={root} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}
        style={{ width: 'min(980px,100%)', maxHeight: '90vh', overflow: 'auto', background: 'white', color: '#152447', borderRadius: 12, padding: 24 }}
        onKeyDown={event => {
          if (event.key === 'Escape' && !busy && !uncertain) { event.preventDefault(); close(); }
          if (event.key === 'Tab') {
            const controls = Array.from(root.current?.querySelectorAll<HTMLElement>('input,select,button,[tabindex]') ?? []).filter(control => !control.hasAttribute('disabled') && control.tabIndex >= 0);
            const first = controls[0], last = controls.at(-1);
            if (!first) { event.preventDefault(); root.current?.focus(); }
            else if (event.shiftKey && (!controls.includes(document.activeElement as HTMLElement) || document.activeElement === first)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && (!controls.includes(document.activeElement as HTMLElement) || document.activeElement === last)) { event.preventDefault(); first.focus(); }
          }
        }}>
        <h3 id={titleId} style={{ marginTop: 0 }}>옵션별 상품 나누기</h3>
        {!uncertain && <>
          <p>그룹 이름을 상품명 뒤에 붙입니다. 직접 수정한 견적 상품명과 공통값은 유지됩니다. 저장 후 각 상품의 SEO·견적을 확인해주세요.</p>
          <p>{rows.length <= OPTION_SPLIT_GROUP_LIMIT ? '처음에는 옵션마다 한 그룹을 제안합니다. 이름과 배정을 직접 바꿀 수 있습니다. 120자를 넘는 옵션명은 그룹 이름을 따로 입력해주세요.' : '옵션이 20개를 넘습니다. 2~20개 그룹을 정하고 모든 옵션을 직접 배정해주세요.'}</p>
          <p>번들 이력·법적 첨부·등록전송 기록이 있는 상품은 현재 분할할 수 없습니다.</p>
          <label className="field"><span>분할 그룹 수</span><input aria-label="분할 그룹 수" type="number" min={2} max={Math.min(OPTION_SPLIT_GROUP_LIMIT, rows.length)} value={labels.length} disabled={locked}
            onChange={event => { const count = Number(event.target.value); if (!Number.isInteger(count) || count < 2 || count > Math.min(OPTION_SPLIT_GROUP_LIMIT, rows.length)) return;
              setLabels(previous => Array.from({ length: count }, (_, index) => previous[index] ?? `그룹 ${index + 1}`));
              setAssignments(previous => Object.fromEntries(Object.entries(previous).map(([id, index]) => [id, Math.min(index, count - 1)]))); changed(); }} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 12, margin: '14px 0' }}>
            {labels.map((label, index) => <label className="field" key={index}><span>그룹 {index + 1}{index === 0 ? ' · 현재 상품' : ' · 새 상품'}</span>
              <input aria-label={`그룹 ${index + 1} 이름`} value={label} maxLength={120} disabled={locked} onChange={event => { setLabels(previous => previous.map((old, position) => position === index ? event.target.value : old)); changed(); }} /></label>)}
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 300 }}><table style={{ width: '100%', textAlign: 'left' }}><caption>모든 원본 옵션 배정</caption><thead><tr><th scope="col">옵션</th><th scope="col">견적 포함</th><th scope="col">저장 그룹</th></tr></thead><tbody>
            {rows.map(row => <tr key={row.optionId}><th scope="row">{optionRegistrationLabel(row.optionId!, row.optionLabel, view.optionRegistrationNumbers)}</th><td>{row.included ? '포함' : '제외'}</td><td><select aria-label={`${row.optionLabel} 저장 그룹`} value={assignments[row.optionId!] ?? -1} disabled={locked}
              onChange={event => { setAssignments(previous => ({ ...previous, [row.optionId!]: Number(event.target.value) })); changed(); }}>
              <option value={-1} disabled>그룹 선택 필요</option>
              {labels.map((label, index) => <option key={index} value={index}>{index + 1}. {label || '이름 입력 필요'}</option>)}</select></td></tr>)}
          </tbody></table></div>
          <button type="button" className="btn ghost" disabled={locked} onClick={() => void makePreview()}>분할 미리보기</button>
        </>}
        {review && <div aria-label="상품 분할 미리보기">
          <h4>저장할 상품 · {review.preview.company.name} ({review.preview.company.code})</h4>
          {review.preview.groups.map((group, index) => <p key={group.productId}><strong>{index + 1}. {group.seoTitle || '(저장한 SEO 제목 없음)'}</strong><br />원본 상품명: {group.title}<br />옵션 {group.optionIds.length}개 · {group.retainsSource ? '현재 상품과 등록번호 유지' : '새 상품 · 새 등록번호 발급'}</p>)}
          {review.preview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
          {sourceChanged && !uncertain && <p role="alert">원본 저장값이 바뀌었습니다. 새 미리보기를 만들어주세요.</p>}
          {!uncertain && <label style={{ display: 'block', margin: '16px 0' }}><input type="checkbox" checked={accepted} disabled={locked || sourceChanged} onChange={event => setAccepted(event.target.checked)} /> 그룹별 상품명과 모든 옵션 배정을 확인했습니다.</label>}
        </div>}
        {error && <p role="alert" className="collection-error">{error}</p>}
        {uncertain && <p role="status">분할 저장 결과를 먼저 확인합니다. 같은 상품을 다시 생성하지 않습니다.</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" className="btn ghost" disabled={busy || uncertain} onClick={close}>취소</button>
          {uncertain ? <button type="button" className="btn primary" disabled={locked || !review} onClick={() => void recover()}>분할 저장 결과 확인</button>
            : <button type="button" className="btn primary" disabled={locked || !review || !accepted || sourceChanged} onClick={() => void save()}>{busy ? '확인 중…' : '확인한 그룹으로 분할 저장'}</button>}
        </div>
      </section>
    </div>}
  </div>;
}
