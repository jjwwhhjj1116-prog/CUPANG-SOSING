'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { applyDetailBatchResult, detailBatchCapacity, detailBatchSelection, prepareDetailImageBatch, readDetailBatchView, recoverDetailBatchResult, type DetailImageBatch } from '@/app/detail-image-batch';
import type { QuotationFieldsView } from '@/app/quotation-schema';

type Props = { productId: string; optionId: string; profileId?: string; version: string; refreshToken?: string;
  stage?: 'detail' | 'additional'; active: boolean; disabled?: boolean; beforeApply?: () => boolean; onSaved?: () => void; onBusyChange?: (busy: boolean) => void };
const imageUrl = (key: string) => `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
function Preview({ blob, alt }: { blob: Blob; alt: string }) {
  const [snapshot, setSnapshot] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    let active = true; const value = URL.createObjectURL(blob);
    void Promise.resolve().then(() => { if (active) setSnapshot({ blob, url: value }); });
    return () => { active = false; URL.revokeObjectURL(value); };
  }, [blob]);
  const url = snapshot?.blob === blob ? snapshot.url : '';
  // eslint-disable-next-line @next/next/no-img-element -- The reviewed PNG is a local browser blob.
  return url ? <img src={url} alt={alt} style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain' }} /> : null;
}
export function DetailImageBatchPanel(props: Props) {
  const { productId, optionId, profileId, version, refreshToken, stage = 'detail', active, disabled = false, onBusyChange } = props;
  const label = stage === 'additional' ? '추가 이미지' : '상세 이미지';
  const scope = JSON.stringify([productId, optionId, profileId ?? null, stage]);
  const controls = useRef(props), mounted = useRef(true), operation = useRef<AbortController | null>(null);
  const [saved, setSaved] = useState<QuotationFieldsView | null>(null), latestSaved = useRef<QuotationFieldsView | null>(null);
  const [batch, setBatch] = useState<DetailImageBatch | null>(null), latestBatch = useRef<DetailImageBatch | null>(null);
  const [language, setLanguage] = useState<'zh' | 'en'>('zh'), [reviewed, setReviewed] = useState<number[]>([]), liveReviewed = useRef<number[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  useLayoutEffect(() => { controls.current = props; }, [props]);
  const current = () => mounted.current && JSON.stringify([controls.current.productId, controls.current.optionId, controls.current.profileId ?? null, controls.current.stage ?? 'detail']) === scope && controls.current.active;
  const unlocked = () => current() && !controls.current.disabled && !operation.current;
  const basis = { productId, optionId, profileId: profileId ?? null, stage };
  function store(value: DetailImageBatch) { latestBatch.current = value; setBatch(value); latestSaved.current = value.view; setSaved(value.view); }
  function select(values: number[]) { liveReviewed.current = values; setReviewed(values); }
  function begin() {
    if (!unlocked()) return null;
    const controller = new AbortController(); operation.current = controller; setBusy(true); onBusyChange?.(true); setError(''); return controller;
  }
  function valid(controller: AbortController) { return current() && operation.current === controller && !controller.signal.aborted; }
  function finish(controller: AbortController) {
    if (operation.current !== controller) return;
    operation.current = null; onBusyChange?.(false); if (mounted.current) setBusy(false);
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); operation.current = null; controls.current.onBusyChange?.(false); }; }, []);
  useEffect(() => {
    if (!active) { operation.current?.abort(); if (operation.current) finish(operation.current); return; }
    if (latestBatch.current) return;
    const controller = begin(); if (!controller) return;
    void readDetailBatchView(basis, controller.signal).then(value => {
      if (!valid(controller)) return;
      if (value.productVersion !== controls.current.version) throw Error('상품 저장 상태가 변경됐습니다. 상품을 다시 열어주세요.');
      latestSaved.current = value; setSaved(value);
    }).catch(cause => { if (valid(controller)) setError(cause instanceof Error ? cause.message : `${label} 조회 실패`); }).finally(() => finish(controller));
    // Source refreshes never discard completed previews or uncertain saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, active, disabled, version, refreshToken]);
  function permission() {
    if (controls.current.beforeApply && !controls.current.beforeApply()) { setError('이미지 순서·HTML 등 수정한 입력을 먼저 저장한 뒤 진행해주세요.'); return false; }
    return true;
  }
  async function prepare() {
    if (!unlocked() || latestBatch.current?.items.some(item => item.status === 'uncertain') || !permission()) return;
    const controller = begin(); if (!controller) return; select([]); setMessage(`저장한 ${label} 목록을 확인하고 있습니다…`);
    try {
      const view = await readDetailBatchView(basis, controller.signal);
      if (!valid(controller)) return;
      if (view.productVersion !== controls.current.version || !permission()) throw Error('상품 또는 다른 단계의 수정 내용이 변경됐습니다. 먼저 저장한 뒤 진행해주세요.');
      const result = await prepareDetailImageBatch({ ...basis, view, language }, controller.signal, (value, progress) => {
        if (valid(controller)) { store(value); setMessage(progress); }
      });
      if (!valid(controller)) return; store(result);
      setMessage(`${result.items.filter(item => item.status === 'ready').length}개 미리보기 준비 · 아직 저장하지 않았습니다. 원본과 번역 결과를 비교해 적용할 항목을 선택하세요.`);
    } catch (cause) { if (valid(controller)) setError(cause instanceof Error ? cause.message : '일괄 번역 준비 실패'); }
    finally { finish(controller); }
  }
  async function apply() {
    const value = latestBatch.current, chosen = [...liveReviewed.current];
    if (!value || !chosen.length || !unlocked() || value.items.some(item => item.status === 'uncertain') || !permission()) return;
    if (chosen.length > detailBatchCapacity(value.view)) { setError('새 번역 결과를 저장할 공간보다 많은 항목을 선택했습니다. 선택을 줄인 뒤 적용해주세요. 원본은 유지됩니다.'); return; }
    if (value.view.productVersion !== controls.current.version) { setError(`상품 저장 상태가 변경됐습니다. 최신 ${label} 목록으로 다시 준비해주세요.`); return; }
    const controller = begin(); if (!controller) return; let savedCount = 0, next = value;
    try {
      for (const index of chosen.sort((a, b) => a - b)) {
        if (!valid(controller) || controls.current.disabled || !permission()) break;
        setMessage(`${label} ${index + 1} 적용 중…`);
        next = await applyDetailBatchResult(next, index, controller.signal, updated => { if (valid(controller)) store(updated); });
        if (!valid(controller)) return; savedCount++; select(liveReviewed.current.filter(item => item !== index));
      }
      if (valid(controller)) setMessage(`${savedCount}개 적용 완료 · 실패·미선택 이미지와 다른 옵션은 유지합니다.`);
    } catch (cause) { if (valid(controller)) setError(`${savedCount}개 적용을 확인했습니다. 나머지는 중단했습니다. ${cause instanceof Error ? cause.message : '저장 결과 확인 필요'}`); }
    finally { finish(controller); if (mounted.current && savedCount) controls.current.onSaved?.(); }
  }
  async function recover() {
    if (!latestBatch.current || !unlocked() || !permission()) return;
    const controller = begin(); if (!controller) return;
    try {
      const value = await recoverDetailBatchResult(latestBatch.current, controller.signal);
      if (!valid(controller)) return; store(value); select([]);
      setMessage('해당 이미지의 저장 상태를 확인했습니다. 다음 이미지에는 적용하지 않았습니다.');
      if (!value.items.some(item => item.status === 'uncertain') && value.items.some(item => item.status === 'applied')) controls.current.onSaved?.();
    } catch (cause) { if (valid(controller)) setError(cause instanceof Error ? cause.message : '저장 상태 확인 실패'); }
    finally { finish(controller); }
  }
  function discardUnused() {
    const value = latestBatch.current;
    if (!value || !unlocked() || value.items.some(item => item.status === 'uncertain')) return;
    store({ ...value, items: value.items.map(item => item.status === 'ready' || item.status === 'pending'
      ? { ...item, status: 'failed', rendered: undefined, attempt: undefined, texts: [], message: '번역 결과를 사용하지 않았습니다. 원본은 유지됩니다.' } : item) });
    select([]); setMessage('미적용 미리보기를 지웠습니다. 이미 저장한 결과와 나머지 원본은 유지합니다.');
  }
  let count = 0, capacity = 0; if (saved) try { count = detailBatchSelection(saved, optionId, profileId ?? null, stage).keys.length; capacity = detailBatchCapacity(saved); } catch { /* A new read reports the binding error. */ }
  const stale = !!batch && batch.view.productVersion !== version, uncertain = !!batch?.items.some(item => item.status === 'uncertain');
  const dirty = !!batch?.items.some(item => item.status === 'ready' || item.status === 'uncertain');
  const locked = busy || disabled || !active;
  return <section className="panel-stack" aria-label={`모든 ${label} 번역`} data-free-image-editor data-quotation-source-step={label} data-workspace-saving={busy} data-workspace-dirty={dirty}>
    <h4>모든 {label} 번역</h4><p>선택 옵션에 저장한 {label} {count}장을 순서대로 번역합니다. 원본과 결과를 확인한 뒤 선택한 항목만 견적서에 적용하세요.</p>
    {saved && <p>새 번역 이미지 저장 가능 {capacity}장 · 원본 파일은 유지합니다.</p>}
    <label className="field"><span>{label} 원문 언어</span><select aria-label={`일괄 ${label} 원문 언어`} value={language} disabled={locked || uncertain} onChange={event => { if (unlocked()) setLanguage(event.target.value as 'zh' | 'en'); }}><option value="zh">중국어 → 한국어</option><option value="en">영어 → 한국어</option></select></label>
    <button type="button" className="btn blue" disabled={locked || uncertain || !count || !capacity} onClick={() => void prepare()}>{batch ? `현재 ${stage === 'additional' ? '추가' : '상세'} 목록으로 번역 다시 준비` : stage === 'additional' ? '모든 이미지 일괄 처리' : '모든 상세 이미지 번역 준비'}</button>
    {busy && <button type="button" className="btn ghost" onClick={() => { const controller = operation.current; controller?.abort(); if (controller) finish(controller); setMessage('작업을 중단했습니다. 준비한 결과와 확인된 저장 결과는 보존했습니다.'); }}>일괄 이미지 작업 중단</button>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {stale && <p role="status">상품 저장 상태가 변경됐습니다. 준비한 결과는 유지됩니다. 저장 결과 확인이 필요한 항목부터 확인하고 최신 목록으로 다시 준비해주세요.</p>}
    {batch && <div className="panel-stack">{batch.items.map(item => <article key={`${item.slotIndex}:${item.sourceKey}`} className="panel-stack" aria-label={`일괄 ${label} ${item.slotIndex + 1}`}>
      <h5>{label} {item.slotIndex + 1} · {({ pending: '준비 중', ready: '검토 대기', failed: '원본 유지', applied: '적용 완료', uncertain: '저장 확인 필요' })[item.status]}</h5>
      {/* eslint-disable-next-line @next/next/no-img-element -- Existing owned source file route. */}
      <img src={imageUrl(item.sourceKey)} alt={`일괄 번역 원본 ${item.slotIndex + 1}`} style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain' }} />
      {item.rendered && <Preview blob={item.rendered.output} alt={`일괄 번역 미리보기 ${item.slotIndex + 1}`} />}
      {item.texts.map((row, index) => <p key={index}>{row.original} → {row.translated}</p>)}
      {item.message && <p role={item.status === 'failed' || item.status === 'uncertain' ? 'alert' : 'status'}>{item.message}</p>}
      {item.status === 'ready' && <label><input type="checkbox" aria-label={`${label} ${item.slotIndex + 1} 번역 결과 검토 완료`} checked={reviewed.includes(item.slotIndex)} disabled={locked || stale || uncertain || !reviewed.includes(item.slotIndex) && reviewed.length >= capacity} onChange={event => { if (unlocked() && !stale && !uncertain && (!event.target.checked || liveReviewed.current.includes(item.slotIndex) || liveReviewed.current.length < capacity)) select(event.target.checked ? [...liveReviewed.current.filter(index => index !== item.slotIndex), item.slotIndex] : liveReviewed.current.filter(index => index !== item.slotIndex)); }} />원본·한국어 결과를 확인했습니다.</label>}
    </article>)}</div>}
    {uncertain ? <button type="button" className="btn primary" disabled={locked} onClick={() => void recover()}>같은 이미지 저장 상태 확인</button>
      : <button type="button" className="btn primary" disabled={locked || stale || !reviewed.length || reviewed.length > capacity} onClick={() => void apply()}>검토한 {label} {reviewed.length}개 적용</button>}
    {dirty && !uncertain && <button type="button" className="btn ghost" disabled={locked} onClick={discardUnused}>미적용 번역 결과 지우기 · 원본 유지</button>}
  </section>;
}
