'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import type { DetailWorkspaceView } from '@/app/detail-workspace';
import type { DetailWorkspaceSelection } from '@/app/detail-workspace-client';
import type { DetailSaveAttempt } from '@/app/detail-save-client';
import { applyDetailWorkspaceComposite, prepareDetailWorkspaceComposite, readLatestDetailWorkspaceComposite, recoverDetailWorkspaceComposite,
  type DetailWorkspaceComposite } from '@/app/detail-workspace-composite-client';
import { detailSaveAltChanges, detailSaveCommonAltText } from '@/app/detail-save-plan';
import { detailSaveEditorHtml } from '@/app/detail-editor-composition';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';

type Props = { selection: DetailWorkspaceSelection; saved: DetailWorkspaceView; disabled?: boolean; stageActive?: boolean; sourceCurrent?: boolean;
  beforeApply?: () => boolean; onSaved?: (view: QuotationFieldsView) => void; onLatestRead?: (reply: DetailWorkspaceView) => void; onBusyChange?: (busy: boolean) => void };
type Review = { prepared: DetailWorkspaceComposite; generation: object };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const issue = (cause: unknown) => cause instanceof Error ? cause.message : '보관한 상세 구성의 합치기·저장 결과를 확인하지 못했습니다.';

/** Composes the exact saved workspace. Preview/download are read-only; the only
 * save operation is the explicitly reviewed atomic common/all-option save. */
export function DetailWorkspaceCompositePanel({ selection, saved, disabled = false, stageActive = true, sourceCurrent = true, beforeApply, onSaved, onLatestRead, onBusyChange }: Props) {
  const identity = JSON.stringify([selection.productId, selection.optionId, selection.profileId ?? null]);
  const scope = JSON.stringify([identity, selection.view, saved, disabled, stageActive, sourceCurrent]);
  const [clock, setClock] = useState({ scope, view: selection.view, token: {} });
  if (clock.scope !== scope || clock.view !== selection.view) setClock({ scope, view: selection.view, token: {} });
  const generation = clock.scope === scope && clock.view === selection.view ? clock.token : null;
  const epoch = useRef(generation), mounted = useRef(true), operation = useRef<AbortController | null>(null), kind = useRef<'prepare' | 'download' | 'save' | 'recover' | 'latest' | null>(null);
  const attempt = useRef<DetailSaveAttempt>({}), resultRef = useRef<DetailWorkspaceComposite | null>(null), delivered = useRef(false), liveReview = useRef<Review | null>(null);
  const current = useRef({ identity, selection, saved, disabled, stageActive, sourceCurrent, beforeApply, onSaved, onLatestRead, onBusyChange });
  const [result, setResult] = useState<DetailWorkspaceComposite | null>(null), [review, setReview] = useState<Review | null>(null);
  const [preparedAt, setPreparedAt] = useState<object | null>(null), preparedEpoch = useRef<object | null>(null);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [done, setDone] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [url, setUrl] = useState<{ output: Blob; url: string } | null>(null);
  useLayoutEffect(() => { current.current = { identity, selection, saved, disabled, stageActive, sourceCurrent, beforeApply, onSaved, onLatestRead, onBusyChange }; }, [identity, selection, saved, disabled, stageActive, sourceCurrent, beforeApply, onSaved, onLatestRead, onBusyChange]);
  useLayoutEffect(() => { epoch.current = generation; liveReview.current = null; if (kind.current !== 'save') operation.current?.abort(); }, [generation]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (kind.current !== 'save') operation.current?.abort(); current.current.onBusyChange?.(false); }; }, []);
  useEffect(() => {
    if (!result) return; let active = true; const objectUrl = URL.createObjectURL(result.output);
    void Promise.resolve().then(() => { if (active) setUrl({ output: result.output, url: objectUrl }); });
    return () => { active = false; URL.revokeObjectURL(objectUrl); };
  }, [result]);
  const waiting = () => !!attempt.current.pending || !!attempt.current.completed && !delivered.current;
  function valid(token: object | null, write = false) {
    const value = current.current;
    return mounted.current && !!token && token === epoch.current && value.identity === identity && value.stageActive && !value.disabled
      && (!write || value.sourceCurrent && value.beforeApply?.() !== false);
  }
  function matches(prepared: DetailWorkspaceComposite) {
    return JSON.stringify([prepared.productId, prepared.optionId, prepared.profileId ?? null]) === identity;
  }
  function preparedCurrent(prepared: DetailWorkspaceComposite, token = generation) {
    const latest = current.current;
    return valid(token, true) && preparedEpoch.current === token && resultRef.current === prepared && matches(prepared) && same(prepared.view, latest.selection.view)
      && same(prepared.workspace, latest.saved.workspace);
  }
  function begin(mode: NonNullable<typeof kind.current>, write = false) {
    if (operation.current || !valid(generation, write)) return null;
    const controller = new AbortController(); operation.current = controller; kind.current = mode; setBusy(true); setError(''); setMessage(''); current.current.onBusyChange?.(true); return controller;
  }
  function finish(controller: AbortController) {
    if (operation.current !== controller) return; operation.current = null; kind.current = null;
    if (mounted.current) { const locked = waiting(); setBusy(false); setPending(locked); current.current.onBusyChange?.(locked); }
  }
  async function prepare() {
    if (waiting()) return; const token = generation, controller = begin('prepare', true); if (!controller) return;
    liveReview.current = null; setReview(null);
    try {
      const prepared = await prepareDetailWorkspaceComposite(selection, saved, controller.signal);
      if (!valid(token, true) || controller.signal.aborted || !same(prepared.workspace, current.current.saved.workspace) || !same(prepared.view, current.current.selection.view)) return;
      resultRef.current = prepared; preparedEpoch.current = token; setPreparedAt(token); attempt.current = {}; delivered.current = false; setResult(prepared); setDone(false); setPending(false); setMessage('보관한 작업 사진으로 합친 PNG를 확인한 뒤 전체 저장 범위를 검토해주세요. 아직 저장하지 않았습니다.');
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  async function download() {
    if (waiting()) return; const token = generation, controller = begin('download', true); if (!controller) return;
    try {
      const prepared = await prepareDetailWorkspaceComposite(selection, saved, controller.signal);
      if (!valid(token, true) || controller.signal.aborted || !same(prepared.workspace, current.current.saved.workspace) || !same(prepared.view, current.current.selection.view)) return;
      const objectUrl = URL.createObjectURL(prepared.output);
      try { const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = `YOOFAM-${selection.productId}-${selection.optionId}-workspace-detail.png`; anchor.click(); }
      finally { setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); }
      setMessage('보관한 작업 구성의 PNG를 내려받았습니다. 상품·견적서·작업 구성은 유지됩니다.');
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  async function save() {
    const prepared = resultRef.current, token = generation, confirmation = liveReview.current;
    if (!prepared || waiting() || delivered.current || !preparedCurrent(prepared) || confirmation?.prepared !== prepared || confirmation.generation !== token) return;
    const controller = begin('save', true); if (!controller) return;
    try {
      const view = await applyDetailWorkspaceComposite(prepared, attempt.current, controller.signal);
      if (!valid(token) || controller.signal.aborted) return;
      delivered.current = true; liveReview.current = null; setReview(null); setDone(true); setMessage('보관한 작업 구성으로 공통·전체 옵션의 상세 이미지와 대체 텍스트를 저장했습니다. 기존 수동값·개별 사진·저장 전 HTML을 보관하고 견적서 HTML은 비웠습니다.'); current.current.onSaved?.(view);
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  async function recover() {
    const prepared = resultRef.current, token = generation; if (!prepared || !matches(prepared) || !waiting()) return;
    const controller = begin('recover'); if (!controller) return;
    try {
      const status = await recoverDetailWorkspaceComposite(prepared, attempt.current, controller.signal);
      if (!valid(token) || controller.signal.aborted) return;
      if (status === 'ready') { liveReview.current = null; setReview(null); setMessage('저장이 아직 완료되지 않았습니다. 현재 구성과 저장 범위를 다시 확인한 뒤 명시적으로 상세 저장을 눌러주세요.'); return; }
      if (!attempt.current.completed) throw Error('상세 저장 결과의 견적서 연결을 확인하지 못했습니다.');
      delivered.current = true; liveReview.current = null; setReview(null); setDone(true); setMessage('상세 저장 결과를 조회로 확인했습니다. 저장 요청을 반복하지 않았습니다.'); current.current.onSaved?.(attempt.current.completed);
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  async function latest() {
    const token = generation, controller = begin('latest'); if (!controller) return;
    try {
      const reply = await readLatestDetailWorkspaceComposite(current.current.selection, controller.signal);
      if (!valid(token) || controller.signal.aborted) return;
      resultRef.current = null; preparedEpoch.current = null; setPreparedAt(null); attempt.current = {}; delivered.current = false; liveReview.current = null; setResult(null); setReview(null); setDone(false); setPending(false);
      setMessage('최신 서버 구성을 다시 읽었습니다. 이전 상세 저장 요청의 성공 여부를 단정하거나 저장 요청을 반복하지 않았습니다.'); current.current.onLatestRead?.(reply);
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  const currentResult = !!result && preparedAt === generation && sourceCurrent && !disabled && stageActive && same(result.view, selection.view) && same(result.workspace, saved.workspace);
  const reviewed = !!result && review?.prepared === result && review.generation === generation;
  const optionCount = result ? new Set(result.view.resolved.rows.flatMap(row => row.optionId ? [row.optionId] : [])).size : 0;
  let preview: { common: string; selected: string; htmlLength: number } | undefined, previewError = '';
  if (result) try {
    const field = exactPrimaryQuotationTarget(result.view.resolved.schema.fields, 'altText').primary, changes = detailSaveAltChanges(result.view);
    preview = { common: changes.find(change => change.optionId === null && change.fieldKey === field)?.value ?? detailSaveCommonAltText(result.view),
      selected: changes.find(change => change.optionId === result.optionId && change.fieldKey === field)?.value ?? '', htmlLength: detailSaveEditorHtml(result.view, result.optionId).effective.length };
  } catch (cause) { previewError = issue(cause); }
  return <section className="panel-stack" aria-label="보관 구성 상세 합치기" aria-busy={busy} data-workspace-saving={busy || pending}>
    <h4>보관 구성으로 상세 이미지 만들기</h4><p>편집용 여백을 제외하고 사진을 800px 폭으로 이어 붙입니다. 준비와 다운로드는 저장하지 않습니다.</p>
    <div className="button-row"><button type="button" className="btn ghost" disabled={busy || pending || disabled || !stageActive || !sourceCurrent} onClick={() => void prepare()}>보관 구성 합치기</button>
      <button type="button" className="btn ghost" disabled={busy || pending || disabled || !stageActive || !sourceCurrent} onClick={() => void download()}>보관 구성 PNG 다운로드</button></div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {result && <><p>보관 사진 {result.keys.length}장 → PNG 한 장 · {result.width} × {result.height}px</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- Local read-only composite Blob preview. */}
      {url?.output === result.output && <img className="image-large-preview" src={url.url} alt="보관 구성 합친 상세 이미지 미리보기" />}
      {!currentResult && !pending && !done && <p role="status">사진 구성이나 저장 기준이 바뀌었습니다. 현재 입력을 유지하고 보관한 구성으로 미리보기를 다시 준비해주세요.</p>}
      <p>공통 항목과 저장된 모든 옵션 {optionCount}개에 합친 상세 이미지를 저장합니다. 견적 제외 옵션도 포함합니다. 기존 수동값을 백업한 뒤 견적서 HTML 입력은 비웁니다.</p>
      <p>공통 대체 텍스트는 값이 있으면 유지하고, 모든 옵션의 대체 텍스트는 SEO 설명과 한국어 옵션명으로 다시 작성합니다. SEO 설명이 없으면 원본 상품명에 ‘상세 설명’을 붙입니다.</p>
      {preview && <><p>개별 사진 순서와 선택 옵션의 저장 전 HTML {preview.htmlLength.toLocaleString()}자를 별도로 보관합니다. 상세 작업 구성도 유지됩니다.</p>
        <details><summary>대체 텍스트 미리보기</summary><dl><dt>공통</dt><dd>{preview.common}</dd><dt>선택 옵션</dt><dd>{preview.selected}</dd></dl></details></>}
      {previewError && <p role="alert">{previewError}</p>}
      <label><input type="checkbox" aria-label="작업 구성 전체 옵션 상세 저장 확인" checked={reviewed} disabled={!currentResult || busy || pending || done || !!previewError} onChange={event => {
        if (!result || !generation || !preparedCurrent(result) || operation.current || waiting() || delivered.current || previewError) return;
        const next = event.target.checked ? { prepared: result, generation } : null; liveReview.current = next; setReview(next);
      }} />이미지·대체 텍스트·HTML 비우기, 이전 수동값·개별 사진·저장 전 HTML 보관과 전체 저장 범위를 확인했습니다.</label>
      <button type="button" className="btn primary" disabled={!currentResult || busy || pending || done || !reviewed || !!previewError} onClick={() => void save()}>보관 구성으로 상세 저장</button>
      {pending && <button type="button" className="btn ghost" disabled={busy || disabled || !stageActive} onClick={() => void recover()}>보관 구성 상세 저장 결과 확인</button>}
      <button type="button" className="btn ghost" disabled={busy || pending || disabled || !stageActive} onClick={() => {
        if (operation.current || waiting()) return; resultRef.current = null; preparedEpoch.current = null; setPreparedAt(null); attempt.current = {}; delivered.current = false; liveReview.current = null; setResult(null); setReview(null); setDone(false); setError(''); setMessage('미리보기를 닫았습니다. 저장된 구성과 상품·견적서는 유지됩니다.');
      }}>보관 구성 미리보기 닫기</button>
    </>}
    {(pending || result && !currentResult && !done) && <button type="button" className="btn ghost" disabled={busy || disabled || !stageActive} onClick={() => void latest()}>최신 상세 구성으로 다시 열기</button>}
  </section>;
}
