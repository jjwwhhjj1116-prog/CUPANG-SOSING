'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { applyDetailBatchResult, detailBatchCapacity, detailBatchTranslationSlots, prepareDetailImageBatch, readDetailBatchView, recoverDetailBatchResult, type DetailImageBatch } from '@/app/detail-image-batch';
import type { QuotationFieldsView } from '@/app/quotation-schema';

type Props = { productId: string; optionId: string; profileId?: string; version: string; refreshToken?: string;
  stage?: 'main' | 'detail' | 'additional'; active: boolean; disabled?: boolean; beforeApply?: () => boolean; onSaved?: () => void;
  onSavedView?: (view: QuotationFieldsView) => void; onPendingChange?: (pending: boolean) => void;
  autoPrepare?: boolean; onBusyChange?: (busy: boolean) => void };
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
  const label = stage === 'main' ? '대표 이미지' : stage === 'additional' ? '추가 이미지' : '상세 이미지';
  const scope = JSON.stringify([productId, optionId, profileId ?? null, stage]);
  const controls = useRef(props), mounted = useRef(true), operation = useRef<AbortController | null>(null);
  const preparing = useRef<{ generation: object; controller: AbortController } | null>(null);
  const [saved, setSaved] = useState<QuotationFieldsView | null>(null), latestSaved = useRef<QuotationFieldsView | null>(null);
  const [batch, setBatch] = useState<DetailImageBatch | null>(null), latestBatch = useRef<DetailImageBatch | null>(null);
  const [language, setLanguage] = useState<'zh' | 'en'>('zh'), [reviewed, setReviewed] = useState<number[]>([]), liveReviewed = useRef<number[]>([]);
  const autoStarted = useRef(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const readBasis = JSON.stringify([productId, optionId, profileId ?? null, stage, version, refreshToken ?? null]);
  const idleRead = useRef<{ basis: string; controller: AbortController | null } | null>(null);
  const prepareScope = JSON.stringify([scope, version, refreshToken, active, disabled]);
  const [prepareClock, setPrepareClock] = useState({ scope: prepareScope, token: {} });
  if (prepareClock.scope !== prepareScope) setPrepareClock({ scope: prepareScope, token: {} });
  const prepareGeneration = prepareClock.scope === prepareScope ? prepareClock.token : null, prepareEpoch = useRef(prepareGeneration);
  useLayoutEffect(() => {
    prepareEpoch.current = prepareGeneration;
    if (preparing.current && preparing.current.generation !== prepareGeneration) preparing.current.controller.abort();
  }, [prepareGeneration]);
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
    if (preparing.current?.controller === controller) preparing.current = null;
    if (operation.current !== controller) return;
    operation.current = null; onBusyChange?.(false); if (mounted.current) setBusy(false);
  }
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; operation.current?.abort(); operation.current = null;
    // Development effect replay remounts this lifetime without new refs. An
    // aborted initial read must not pin its basis or leave the next read busy.
    idleRead.current = null; preparing.current = null;
    if (!latestBatch.current) autoStarted.current = false;
    controls.current.onBusyChange?.(false);
  }; }, []);
  async function loadSavedView(explicit = false) {
    if (latestBatch.current || !explicit && idleRead.current?.basis === readBasis) return;
    const controller = begin(); if (!controller) return;
    const attempt = { basis: readBasis, controller: controller as AbortController | null }; idleRead.current = attempt;
    const currentRead = () => valid(controller) && idleRead.current === attempt && readBasis === JSON.stringify([
      controls.current.productId, controls.current.optionId, controls.current.profileId ?? null, controls.current.stage ?? 'detail', controls.current.version, controls.current.refreshToken ?? null]);
    try {
      const value = await readDetailBatchView(basis, controller.signal);
      if (!currentRead()) return;
      if (value.productVersion !== controls.current.version) throw Error('상품 저장 상태가 변경됐습니다. 상품을 다시 열어주세요.');
      latestSaved.current = value; setSaved(value);
    } catch (cause) { if (currentRead()) setError(cause instanceof Error ? cause.message : `${label} 조회 실패`); }
    finally {
      if (idleRead.current === attempt) { if (controller.signal.aborted) idleRead.current = null; else attempt.controller = null; }
      finish(controller);
    }
  }
  useEffect(() => {
    const reading = idleRead.current;
    if (reading?.controller && (reading.basis !== readBasis || !active)) {
      reading.controller.abort(); finish(reading.controller); idleRead.current = null;
    }
    if (!active) { operation.current?.abort(); if (operation.current) finish(operation.current); return; }
    void loadSavedView();
    // Sibling busy/unlock transitions are not new source data. Latch both a
    // completed read and a reported failure; explicit retry still reads again.
    // Aborted/skipped reads resume after unlock or a real source-basis change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readBasis, active, disabled, busy]);
  function permission() {
    if (controls.current.beforeApply && !controls.current.beforeApply()) { setError('이미지 순서·HTML 등 수정한 입력을 먼저 저장한 뒤 진행해주세요.'); return false; }
    return true;
  }
  async function prepare(sourceLanguage: 'zh' | 'en' = language) {
    if (!prepareGeneration || prepareEpoch.current !== prepareGeneration || !unlocked() || latestBatch.current?.items.some(item => item.status === 'uncertain') || !permission()) return;
    const controller = begin(); if (!controller) return; select([]); setMessage(`저장한 ${label} 목록을 확인하고 있습니다…`);
    preparing.current = { generation: prepareGeneration, controller };
    setLanguage(sourceLanguage);
    const currentPreparation = () => valid(controller) && prepareEpoch.current === prepareGeneration;
    try {
      const view = await readDetailBatchView(basis, controller.signal);
      if (!currentPreparation()) return;
      if (view.productVersion !== controls.current.version || !permission()) throw Error('상품 또는 다른 단계의 수정 내용이 변경됐습니다. 먼저 저장한 뒤 진행해주세요.');
      const result = await prepareDetailImageBatch({ ...basis, view, language: sourceLanguage }, controller.signal, (value, progress) => {
        if (currentPreparation()) { store(value); setMessage(progress); }
      });
      if (!currentPreparation()) return; store(result);
      const skipped = result.items.filter(item => item.status === 'skipped').length;
      setMessage(`${result.items.filter(item => item.status === 'ready').length}개 미리보기 준비${skipped ? ` · 설정 배너 ${skipped}개 원본 유지` : ''} · 아직 저장하지 않았습니다. 원본과 번역 결과를 비교해 적용할 항목을 선택하세요.`);
    } catch (cause) { if (currentPreparation()) setError(cause instanceof Error ? cause.message : '일괄 번역 준비 실패'); }
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
    finally { finish(controller); if (mounted.current && savedCount) { if (latestBatch.current) controls.current.onSavedView?.(latestBatch.current.view); controls.current.onSaved?.(); } }
  }
  async function recover() {
    if (!latestBatch.current || !unlocked() || !permission()) return;
    const controller = begin(); if (!controller) return;
    try {
      const value = await recoverDetailBatchResult(latestBatch.current, controller.signal);
      if (!valid(controller)) return; store(value); select([]);
      setMessage('해당 이미지의 저장 상태를 확인했습니다. 다음 이미지에는 적용하지 않았습니다.');
      if (!value.items.some(item => item.status === 'uncertain') && value.items.some(item => item.status === 'applied')) { controls.current.onSavedView?.(value.view); controls.current.onSaved?.(); }
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
  let count = 0, protectedCount = 0, capacity = 0, eligibilityError = '';
  if (saved) try { const selection = detailBatchTranslationSlots(saved, optionId, profileId ?? null, stage); count = selection.slots.length; protectedCount = selection.protectedSlots.length; capacity = detailBatchCapacity(saved); }
  catch (cause) { eligibilityError = cause instanceof Error ? cause.message : '상단·하단 이미지 역할을 확인하지 못했습니다. 최신 저장 이미지를 다시 조회해주세요.'; }
  const stale = !!batch && batch.view.productVersion !== version, uncertain = !!batch?.items.some(item => item.status === 'uncertain');
  const dirty = !!batch?.items.some(item => item.status === 'ready' || item.status === 'uncertain');
  useEffect(() => { controls.current.onPendingChange?.(dirty); }, [dirty]);
  useEffect(() => {
    // This prop is set only by the user's explicit work-start/task action.
    // An idle editor read never starts OCR. The latch also covers Strict Mode.
    if (!props.autoPrepare || autoStarted.current || !saved || busy || disabled || !active || !prepareGeneration) return;
    autoStarted.current = true; void prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.autoPrepare, saved, busy, disabled, active, prepareGeneration]);
  const locked = busy || disabled || !active;
  return <section className="panel-stack" aria-label={`모든 ${label} 번역`} data-free-image-editor data-quotation-source-step={label} data-workspace-saving={busy} data-workspace-dirty={dirty}>
    <h4>모든 {label} 번역</h4><p>{eligibilityError ? '이미지 역할을 확인한 뒤 일괄 처리를 시작할 수 있습니다.' : stage === 'detail' ? `선택 옵션에 저장한 본문 이미지 ${count}장을 순서대로 번역합니다. 상단·하단 설정 배너 ${protectedCount}장은 원본을 유지합니다.` : `선택 옵션에 저장한 ${label} ${count}장을 순서대로 번역합니다.`} 원본과 결과를 확인한 뒤 선택한 항목만 견적서에 적용하세요.</p>
    {saved && !eligibilityError && <p>새 번역 이미지 저장 가능 {capacity}장 · 원본 파일은 유지합니다.</p>}
    <label className="field"><span>{label} 원문 언어</span><select aria-label={`일괄 ${label} 원문 언어`} value={language} disabled={locked || uncertain} onChange={event => { if (unlocked()) setLanguage(event.target.value as 'zh' | 'en'); }}><option value="zh">중국어 → 한국어</option><option value="en">영어 → 한국어</option></select></label>
    {stage === 'detail' ? <div className="quote-actions"><button type="button" className="btn ghost" disabled={locked || uncertain || !count || !capacity} onClick={() => void prepare('en')}>영어→한국어 번역</button>
      <button type="button" className="btn blue" disabled={locked || uncertain || !count || !capacity} onClick={() => void prepare('zh')}>모든 이미지 AI 처리</button></div>
      : <button type="button" className="btn blue" disabled={locked || uncertain || !count || !capacity} onClick={() => void prepare()}>{batch ? `현재 ${stage === 'main' ? '대표' : '추가'} 목록으로 번역 다시 준비` : '모든 이미지 일괄 처리'}</button>}
    {busy && <button type="button" className="btn ghost" onClick={() => { const controller = operation.current; controller?.abort(); if (controller) finish(controller); setMessage('작업을 중단했습니다. 준비한 결과와 확인된 저장 결과는 보존했습니다.'); }}>일괄 이미지 작업 중단</button>}
    {error && <p role="alert">{error}</p>}{eligibilityError && <p role="alert">{eligibilityError}</p>}{message && <p role="status">{message}</p>}
    {error && !batch && <button type="button" className="btn ghost" disabled={locked} onClick={() => void loadSavedView(true)}>저장 이미지 다시 확인</button>}
    {stale && <p role="status">상품 저장 상태가 변경됐습니다. 준비한 결과는 유지됩니다. 저장 결과 확인이 필요한 항목부터 확인하고 최신 목록으로 다시 준비해주세요.</p>}
    {batch && <div className="panel-stack">{batch.items.map(item => <article key={`${item.slotIndex}:${item.sourceKey}`} className="panel-stack" aria-label={`일괄 ${label} ${item.slotIndex + 1}`}>
      <h5>{label} {item.slotIndex + 1} · {({ pending: '준비 중', ready: '검토 대기', skipped: '설정 배너 · 원본 유지', failed: '원본 유지', applied: '적용 완료', uncertain: '저장 확인 필요' })[item.status]}</h5>
      {/* eslint-disable-next-line @next/next/no-img-element -- Existing owned source file route. */}
      <img src={imageUrl(item.sourceKey)} alt={`일괄 번역 원본 ${item.slotIndex + 1}`} style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain' }} />
      {item.rendered && <Preview blob={item.rendered.output} alt={`일괄 번역 미리보기 ${item.slotIndex + 1}`} />}
      {item.texts.map((row, index) => <p key={index}>{row.original} → {row.translated}</p>)}
      {item.message && <p role={item.status === 'failed' || item.status === 'uncertain' ? 'alert' : 'status'}>{item.message}</p>}
      {item.status === 'ready' && <label><input type="checkbox" aria-label={`${label} ${item.slotIndex + 1} 번역 결과 검토 완료`} checked={reviewed.includes(item.slotIndex)} disabled={locked || stale || uncertain || !reviewed.includes(item.slotIndex) && reviewed.length >= capacity} onChange={event => {
        const currentItem = latestBatch.current?.items.find(value => value.slotIndex === item.slotIndex);
        if (prepareGeneration && prepareEpoch.current === prepareGeneration && latestBatch.current === batch && currentItem === item && currentItem.rendered === item.rendered && currentItem.status === 'ready'
          && unlocked() && !stale && !uncertain && (!event.target.checked || liveReviewed.current.includes(item.slotIndex) || liveReviewed.current.length < capacity)) select(event.target.checked ? [...liveReviewed.current.filter(index => index !== item.slotIndex), item.slotIndex] : liveReviewed.current.filter(index => index !== item.slotIndex));
      }} />원본·한국어 결과를 확인했습니다.</label>}
    </article>)}</div>}
    {uncertain ? <button type="button" className="btn primary" disabled={locked} onClick={() => void recover()}>같은 이미지 저장 상태 확인</button>
      : <button type="button" className="btn primary" disabled={locked || stale || !reviewed.length || reviewed.length > capacity} onClick={() => void apply()}>검토한 {label} {reviewed.length}개 적용</button>}
    {dirty && !uncertain && <button type="button" className="btn ghost" disabled={locked} onClick={discardUnused}>미적용 번역 결과 지우기 · 원본 유지</button>}
  </section>;
}
