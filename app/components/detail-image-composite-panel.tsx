'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { applyDetailComposite, prepareDetailComposite, prepareDetailImageDownload, recoverDetailComposite, type DetailComposite, type DetailCompositeAttempt } from '@/app/detail-image-composite';
import { applyDetailSave, recoverDetailSave, type DetailSaveAttempt } from '@/app/detail-save-client';
import { detailSaveAltChanges, detailSaveCommonAltText } from '@/app/detail-save-plan';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';

type Props = { productId: string; optionId: string; profileId?: string; view: QuotationFieldsView; disabled?: boolean; stageActive?: boolean;
  beforeApply?: () => boolean; onSaved?: (view: QuotationFieldsView) => void; onBusyChange?: (busy: boolean) => void };
export function DetailImageCompositePanel({ productId, optionId, profileId, view, disabled = false, stageActive = true, beforeApply, onSaved, onBusyChange }: Props) {
  const identity = JSON.stringify([productId, optionId, profileId ?? null]), current = useRef({ identity, view, disabled, stageActive, beforeApply, onSaved, onBusyChange });
  const active = useRef(true), request = useRef<AbortController | null>(null), attempt = useRef<DetailCompositeAttempt>({});
  const detailAttempt = useRef<DetailSaveAttempt>({}), mutationMode = useRef<'selected' | 'all' | null>(null), savedResult = useRef(false);
  const downloadRequest = useRef<AbortController | null>(null), downloadGeneration = useRef(0);
  const resultRef = useRef<DetailComposite | null>(null), [result, setResult] = useState<DetailComposite | null>(null), [url, setUrl] = useState<{ output: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [done, setDone] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [mode, setMode] = useState<'selected' | 'all' | null>(null);
  const sourceScope = JSON.stringify([identity, view.productVersion, view.revision, view.inputFingerprint, view.contentRevision, view.optionRevision, disabled, stageActive]);
  const [sourceClock, setSourceClock] = useState({ scope: sourceScope, view, token: {} });
  if (sourceClock.scope !== sourceScope || sourceClock.view !== view) setSourceClock({ scope: sourceScope, view, token: {} });
  const generation = sourceClock.scope === sourceScope && sourceClock.view === view ? sourceClock.token : null, sourceEpoch = useRef(generation);
  type Review = { prepared: DetailComposite; generation: object };
  const [review, setReview] = useState<Review | null>(null), liveReview = useRef<Review | null>(null);
  const preparing = useRef<AbortController | null>(null);
  useLayoutEffect(() => { current.current = { identity, view, disabled, stageActive, beforeApply, onSaved, onBusyChange }; }, [identity, view, disabled, stageActive, beforeApply, onSaved, onBusyChange]);
  useLayoutEffect(() => { sourceEpoch.current = generation; liveReview.current = null; preparing.current?.abort(); }, [generation]);
  useLayoutEffect(() => { downloadGeneration.current++; downloadRequest.current?.abort(); }, [identity, view, disabled, stageActive]);
  useEffect(() => { active.current = true; return () => { active.current = false; if (!attempt.current.pending && !detailAttempt.current.pending) request.current?.abort(); current.current.onBusyChange?.(false); }; }, []);
  useEffect(() => {
    if (!result) return; let live = true; const objectUrl = URL.createObjectURL(result.output);
    void Promise.resolve().then(() => { if (live) setUrl({ output: result.output, url: objectUrl }); });
    return () => { live = false; URL.revokeObjectURL(objectUrl); };
  }, [result]);
  const valid = () => !!generation && sourceEpoch.current === generation && active.current && current.current.identity === identity && current.current.stageActive && !current.current.disabled && current.current.beforeApply?.() !== false;
  const waiting = () => !!attempt.current.pending || !!detailAttempt.current.pending || mutationMode.current === 'all' && !!detailAttempt.current.completed && !savedResult.current;
  const matchesIdentity = (prepared: DetailComposite) => JSON.stringify([prepared.productId, prepared.optionId, prepared.profileId ?? null]) === identity;
  const preparedCurrent = (prepared: DetailComposite) => valid() && resultRef.current === prepared && current.current.view === prepared.view && matchesIdentity(prepared);
  function start() {
    if (request.current || !valid()) return null;
    const controller = new AbortController(); request.current = controller; current.current.onBusyChange?.(true); setBusy(true); setError(''); setMessage(''); return controller;
  }
  function finish(controller: AbortController) {
    if (preparing.current === controller) preparing.current = null;
    if (request.current !== controller) return; request.current = null;
    if (active.current && current.current.identity === identity) { setBusy(false); setPending(waiting()); current.current.onBusyChange?.(waiting()); }
  }
  async function prepare() {
    if (waiting()) return; const controller = start(); if (!controller) return; preparing.current = controller; liveReview.current = null; setReview(null);
    try {
      const prepared = await prepareDetailComposite({ productId, optionId, profileId, view: current.current.view }, controller.signal);
      if (!valid() || controller.signal.aborted || current.current.view !== prepared.view) return;
      attempt.current = {}; detailAttempt.current = {}; mutationMode.current = null; setMode(null); savedResult.current = false; resultRef.current = prepared; setResult(prepared); setDone(false); setMessage('합친 이미지를 확인한 뒤 저장할 범위를 선택해주세요.');
    } catch (cause) { if (active.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '상세 이미지 합치기 실패'); }
    finally { finish(controller); }
  }
  async function apply() {
    const prepared = resultRef.current; if (!prepared || mutationMode.current === 'all' || attempt.current.completed || !matchesIdentity(prepared)) return;
    const controller = start(); if (!controller) return;
    mutationMode.current = 'selected'; setMode('selected'); liveReview.current = null; setReview(null);
    try {
      const confirmed = attempt.current.pending ? await recoverDetailComposite(prepared, attempt.current, controller.signal) : await applyDetailComposite(prepared, attempt.current, controller.signal);
      if (!active.current || current.current.identity !== identity || controller.signal.aborted) return;
      if (confirmed === 'ready') { setMessage('현재 저장 결과를 확인했습니다. 적용 버튼을 눌러 이어서 저장해주세요.'); return; }
      const saved = confirmed === 'completed' ? attempt.current.completed! : confirmed;
      savedResult.current = true; setDone(true); setMessage('합친 상세 이미지를 선택 옵션 견적서에 저장했습니다.'); current.current.onSaved?.(saved);
    } catch (cause) { if (active.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '상세 이미지 적용 실패'); }
    finally { finish(controller); }
  }
  async function saveAll() {
    const prepared = resultRef.current;
    if (!prepared || !matchesIdentity(prepared) || mutationMode.current === 'selected' || savedResult.current) return;
    const recovery = waiting(), confirmation = liveReview.current;
    if (!recovery && (!preparedCurrent(prepared) || confirmation?.prepared !== prepared || confirmation.generation !== generation)) return;
    const controller = start(); if (!controller) return;
    mutationMode.current = 'all'; setMode('all');
    try {
      const confirmed = recovery ? await recoverDetailSave(prepared, detailAttempt.current, controller.signal) : await applyDetailSave(prepared, detailAttempt.current, controller.signal);
      if (!valid() || controller.signal.aborted) return;
      if (confirmed === 'ready') { setMessage('상세 저장이 아직 완료되지 않았습니다. 범위를 다시 확인한 뒤 상세 저장을 눌러주세요.'); liveReview.current = null; setReview(null); return; }
      const saved = confirmed === 'completed' ? detailAttempt.current.completed! : confirmed;
      savedResult.current = true; liveReview.current = null; setReview(null); setDone(true); setMessage('공통 항목과 모든 저장 옵션에 상세 이미지·대체 텍스트를 저장했습니다. 이전 수동값은 백업했고 HTML 입력은 비웠습니다.'); current.current.onSaved?.(saved);
    } catch (cause) { if (valid() && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '상세 저장 결과를 확인해주세요.'); }
    finally { finish(controller); }
  }
  async function download() {
    if (waiting()) return;
    const controller = start(); if (!controller) return;
    downloadRequest.current = controller;
    const basis = current.current.view, generation = downloadGeneration.current;
    try {
      const prepared = await prepareDetailImageDownload({ productId, optionId, profileId, view: basis }, controller.signal);
      if (!valid() || controller.signal.aborted || current.current.view !== basis || generation !== downloadGeneration.current) return;
      const objectUrl = URL.createObjectURL(prepared.output);
      try {
        const anchor = document.createElement('a'); anchor.href = objectUrl;
        anchor.download = `YOOFAM-${productId}-${optionId}-detail.jpg`; anchor.click();
      } finally { setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); }
      setMessage('현재 저장한 상세 이미지를 JPG로 내려받았습니다. 견적서와 원본은 유지됩니다.');
    } catch (cause) { if (active.current && !controller.signal.aborted && current.current.identity === identity) setError(cause instanceof Error ? cause.message : '상세 이미지 다운로드 실패'); }
    finally { if (downloadRequest.current === controller) downloadRequest.current = null; finish(controller); }
  }
  const currentResult = !!result && !!generation && result.view === view && matchesIdentity(result) && stageActive && !disabled;
  const allRecovery = !!result && mode === 'all' && pending && matchesIdentity(result);
  const reviewed = !!result && review?.prepared === result && review.generation === generation;
  const optionCount = result ? new Set(result.view.resolved.rows.flatMap(row => typeof row.optionId === 'string' ? [row.optionId] : [])).size : 0;
  let textPreview: { common: string; selected: string } | undefined, textError = '';
  if (result) try {
    const primary = exactPrimaryQuotationTarget(result.view.resolved.schema.fields, 'altText').primary;
    const textChanges = detailSaveAltChanges(result.view);
    textPreview = { common: textChanges.find(change => change.optionId === null && change.fieldKey === primary)?.value ?? detailSaveCommonAltText(result.view),
      selected: textChanges.find(change => change.optionId === result.optionId && change.fieldKey === primary)?.value ?? '' };
  } catch (cause) { textError = cause instanceof Error ? cause.message : '대체 텍스트 미리보기를 확인해주세요.'; }
  return <section className="panel-stack" aria-label="상세 이미지 합치기" data-workspace-saving={busy}>
    <button type="button" className="btn ghost" title="통합 이미지 다운로드" disabled={!stageActive || disabled || busy || pending} onClick={() => void download()}>통합 이미지 다운로드</button>
    <button type="button" className="btn ghost" disabled={!stageActive || disabled || busy || pending} onClick={() => void prepare()}>상세 이미지 합치기</button>
    <small>저장한 상단·본문·하단 사진을 현재 순서대로 한 장으로 만듭니다. 사진을 합칠 때는 원본과 HTML이 바뀌지 않습니다. 선택 옵션에 적용하면 수동 HTML을 유지하고, 상세 저장은 아래에서 확인한 전체 범위에 적용하며 HTML을 비웁니다.</small>
    {busy && <p role="status">상세 이미지 처리 중…</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {result && <><p>{result.keys.length}개 → 한 장 · {result.width} × {result.height}px</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url?.output === result.output && <img className="image-large-preview" src={url.url} alt="합친 상세 이미지 미리보기" />}
      {(currentResult || allRecovery) && <section className="panel-stack" aria-label="전체 옵션 상세 저장">
        <p>공통 항목과 저장된 모든 옵션 {optionCount}개에 합친 이미지를 적용합니다. 견적 제외 옵션도 포함합니다. 이전 수동값을 백업한 뒤 HTML 입력을 비웁니다.</p>
        <p>공통 대체 텍스트는 값이 있으면 유지하고, 모든 옵션의 대체 텍스트는 SEO 설명과 한국어 옵션명으로 다시 작성합니다. SEO 설명이 없으면 원본 상품명에 ‘상세 설명’을 붙입니다.</p>
        {textPreview && <details><summary>대체 텍스트 미리보기</summary><dl><dt>공통 견적서</dt><dd>{textPreview.common}</dd><dt>선택 옵션</dt><dd>{textPreview.selected}</dd></dl></details>}
        {textError && <p role="alert">{textError}</p>}
        <label><input type="checkbox" aria-label="전체 옵션 상세 저장 확인" checked={reviewed} disabled={!currentResult || busy || pending || done || mode === 'selected' || !!textError} onChange={event => {
          if (!result || !preparedCurrent(result) || !generation || request.current || waiting() || savedResult.current || mutationMode.current === 'selected' || textError) return;
          const next = event.target.checked ? { prepared: result, generation } : null; liveReview.current = next; setReview(next);
        }} />이미지·대체 텍스트·HTML 비우기와 저장 범위를 확인했습니다.</label>
        <button type="button" className="btn primary" disabled={!stageActive || disabled || busy || done || mode === 'selected' || !allRecovery && (!reviewed || !!textError)} onClick={() => void saveAll()}>{allRecovery ? '상세 저장 결과 확인' : '상세 저장'}</button>
      </section>}
      <button type="button" className="btn primary" disabled={!stageActive || disabled || busy || done || mode === 'all'} onClick={() => void apply()}>{pending && mode === 'selected' ? '상세 이미지 저장 결과 확인' : '합친 이미지 선택 옵션에 적용'}</button>
      <button type="button" className="btn ghost" disabled={busy || pending} onClick={() => { if (request.current || waiting() || !valid()) return; attempt.current = {}; detailAttempt.current = {}; mutationMode.current = null; setMode(null); savedResult.current = false; liveReview.current = null; setReview(null); resultRef.current = null; setResult(null); setPending(false); setDone(false); current.current.onBusyChange?.(false); setError(''); setMessage('원본과 저장한 파일은 유지했습니다. 현재 선택을 다시 확인해주세요.'); }}>미리보기 닫기</button>
    </>}
  </section>;
}
