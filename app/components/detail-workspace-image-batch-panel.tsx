'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { applyDetailWorkspaceBatchResult, prepareDetailWorkspaceImageBatch, recoverDetailWorkspaceBatchResult, type DetailWorkspaceImageBatch } from '@/app/detail-workspace-image-batch';
import type { DetailWorkspaceSelection } from '@/app/detail-workspace-client';
import type { DetailWorkspaceView } from '@/app/detail-workspace';
import type { DetailWorkspaceImageReply } from '@/app/detail-workspace-image-client';

export type WorkspaceImageBatchToolbarActions = { prepare: (sourceLanguage?: 'zh' | 'en') => void; disabled: boolean };
type Props = { selection: DetailWorkspaceSelection; saved: DetailWorkspaceView; active: boolean; disabled?: boolean; beforeApply?: () => boolean;
  onSaved?: (reply: DetailWorkspaceImageReply) => void; onBusyChange?: (busy: boolean) => void; onPendingChange?: (pending: boolean) => void;
  onToolbarActionsChange?: (next: WorkspaceImageBatchToolbarActions | null, retired?: WorkspaceImageBatchToolbarActions) => void };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const note = (cause: unknown) => cause instanceof Error ? cause.message : '작업 사진 번역 결과를 확인하지 못했습니다.';
const imageUrl = (key: string) => `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
function Preview({ output }: { output: Blob }) {
  const [snapshot, setSnapshot] = useState<{ output: Blob; url: string } | null>(null);
  useEffect(() => { let active = true; const url = URL.createObjectURL(output); void Promise.resolve().then(() => { if (active) setSnapshot({ output, url }); }); return () => { active = false; URL.revokeObjectURL(url); }; }, [output]);
  // eslint-disable-next-line @next/next/no-img-element -- Explicitly reviewed local PNG.
  return snapshot?.output === output ? <img src={snapshot.url} alt="본문 사진 번역 미리보기" style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain' }} /> : null;
}

export function DetailWorkspaceImageBatchPanel(props: Props) {
  const { selection, saved, active, disabled = false, onToolbarActionsChange } = props;
  const controls = useRef(props), mounted = useRef(true), operation = useRef<{ controller: AbortController; kind: 'prepare' | 'apply' | 'recover'; token: object } | null>(null);
  const [accepted, setAccepted] = useState<{ saved: DetailWorkspaceView; basis: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const savedBasis = accepted && same(saved, accepted.saved) ? accepted.basis : JSON.stringify(saved);
  const scope = JSON.stringify([selection, savedBasis, active, disabled && !busy]);
  const [clock, setClock] = useState({ scope, view: selection.view, token: {} });
  if (clock.scope !== scope || clock.view !== selection.view) setClock({ scope, view: selection.view, token: {} });
  const generation = clock.scope === scope && clock.view === selection.view ? clock.token : null, epoch = useRef(generation);
  const [batch, setBatch] = useState<DetailWorkspaceImageBatch | null>(null), latestBatch = useRef<DetailWorkspaceImageBatch | null>(null), batchEpoch = useRef<object | null>(null);
  const [preparedAt, setPreparedAt] = useState<object | null>(null);
  const [reviewed, setReviewed] = useState<string[]>([]), liveReviewed = useRef<string[]>([]);
  const [language, setLanguage] = useState<'zh' | 'en'>('zh'), [message, setMessage] = useState(''), [error, setError] = useState('');
  const liveLanguage = useRef(language);
  const published = useRef<WorkspaceImageBatchToolbarActions | null>(null), section = useRef<HTMLElement | null>(null), details = useRef<HTMLDetailsElement | null>(null);
  const reveal = useRef<object | null>(null);
  useLayoutEffect(() => { controls.current = props; }, [props]);
  useLayoutEffect(() => { epoch.current = generation; if (operation.current?.token !== generation && operation.current?.kind === 'prepare') operation.current.controller.abort(); }, [generation]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.controller.abort(); controls.current.onBusyChange?.(false); }; }, []);
  function current(token: object | null, allowBusy = false) {
    return mounted.current && !!token && token === epoch.current && controls.current.active && (!controls.current.disabled || allowBusy && !!operation.current);
  }
  function permission() {
    if (controls.current.beforeApply?.() !== false) return true;
    setError('수정한 사진 구성·순서·간격을 먼저 보관한 뒤 진행해주세요.'); return false;
  }
  function store(value: DetailWorkspaceImageBatch) { latestBatch.current = value; setBatch(value); }
  function select(ids: string[]) { liveReviewed.current = ids; setReviewed(ids); }
  function begin(kind: 'prepare' | 'apply' | 'recover', token: object | null) {
    if (!token || !current(token) || operation.current || !permission()) return null;
    const controller = new AbortController(); operation.current = { controller, kind, token }; setBusy(true); setError(''); controls.current.onBusyChange?.(true); return controller;
  }
  const valid = (controller: AbortController, token: object | null) => current(token, true) && operation.current?.controller === controller && !controller.signal.aborted;
  function finish(controller: AbortController) { if (operation.current?.controller !== controller) return; operation.current = null; controls.current.onBusyChange?.(false); if (mounted.current) setBusy(false); }
  function deliver(value: DetailWorkspaceImageBatch) {
    if (!value.lastReply) return;
    setAccepted({ saved: value.saved, basis: savedBasis });
    controls.current.onSaved?.(value.lastReply);
  }
  async function prepare(sourceLanguage: 'zh' | 'en' = language, show = false) {
    const token = generation;
    if (latestBatch.current?.items.some(item => item.status === 'uncertain')) return;
    const controller = begin('prepare', token); if (!controller || !token) return;
    liveLanguage.current = sourceLanguage; setLanguage(sourceLanguage); select([]); batchEpoch.current = token; setPreparedAt(token); setMessage('보관한 본문 사진을 확인하고 있습니다…');
    try {
      const result = await prepareDetailWorkspaceImageBatch({ selection, saved, language: sourceLanguage }, controller.signal, (value, progress) => { if (valid(controller, token)) { store(value); setMessage(progress); } });
      if (!valid(controller, token)) return; store(result);
      setMessage(`${result.items.filter(item => item.status === 'ready').length}개 미리보기 준비 · 원본과 한국어 결과를 검토한 항목만 적용하세요.`);
    } catch (cause) { if (valid(controller, token)) setError(note(cause)); }
    finally { finish(controller); if (show && current(token)) reveal.current = token; }
  }
  async function apply() {
    const token = generation, value = latestBatch.current, chosen = [...liveReviewed.current];
    if (!value || !chosen.length || batchEpoch.current !== token || value.language !== liveLanguage.current || value.items.some(item => item.status === 'uncertain')) return;
    const controller = begin('apply', token); if (!controller) return;
    let next = value, count = 0;
    try {
      for (const entry of value.items.filter(item => chosen.includes(item.photoId))) {
        if (!valid(controller, token) || !permission()) break;
        next = await applyDetailWorkspaceBatchResult(next, entry.photoId, controller.signal, updated => {
          if (mounted.current && operation.current?.controller === controller && (valid(controller, token) || updated.items.some(item => item.status === 'uncertain'))) store(updated);
        });
        if (!valid(controller, token)) return; store(next); deliver(next); count++; select(liveReviewed.current.filter(id => id !== entry.photoId));
      }
      if (valid(controller, token)) setMessage(`${count}개 본문 사진 적용 완료`);
    } catch (cause) { if (mounted.current && operation.current?.controller === controller) setError(`${count}개 적용 확인 · 나머지는 중단했습니다. ${note(cause)}`); }
    finally { finish(controller); }
  }
  async function recover() {
    const token = generation, value = latestBatch.current; if (!value?.items.some(item => item.status === 'uncertain')) return;
    if (value.selection.productId !== controls.current.selection.productId || value.selection.optionId !== controls.current.selection.optionId
      || (value.selection.profileId ?? null) !== (controls.current.selection.profileId ?? null) || !same(value.selection.view, controls.current.selection.view)) return;
    const controller = begin('recover', token); if (!controller) return;
    try {
      const next = await recoverDetailWorkspaceBatchResult(value, controller.signal);
      if (!valid(controller, token)) return; store(next); select([]);
      if (next.lastReply && next.lastReply !== value.lastReply) deliver(next);
      setMessage('같은 작업 사진의 보관 결과를 확인했습니다. 다음 사진은 적용하지 않았습니다.');
    } catch (cause) { if (valid(controller, token)) setError(note(cause)); }
    finally { finish(controller); }
  }
  const uncertain = !!batch?.items.some(item => item.status === 'uncertain'), pending = !!batch?.items.some(item => item.status === 'ready' || item.status === 'uncertain');
  function discard() {
    if (!current(generation) || operation.current || latestBatch.current?.items.some(item => item.status === 'uncertain')) return;
    latestBatch.current = null; batchEpoch.current = null; setBatch(null); setPreparedAt(null); select([]); setError(''); setMessage('미적용 번역 미리보기를 닫았습니다. 보관한 작업 사진은 유지합니다.');
  }
  const stale = !!batch && (preparedAt !== generation || batch.language !== language), locked = busy || disabled || !active;
  const count = saved.workspace?.document.photos.filter(photo => photo.role === 'body').length ?? 0;
  useEffect(() => { controls.current.onPendingChange?.(pending); }, [pending]);
  useEffect(() => {
    if (!onToolbarActionsChange) return;
    const token = generation, blocked = !token || locked || uncertain || !count;
    const actions: WorkspaceImageBatchToolbarActions = { disabled: blocked, prepare: sourceLanguage => { if (published.current === actions && !blocked && current(token) && !operation.current) void prepare(sourceLanguage, true); } };
    published.current = actions; onToolbarActionsChange(actions);
    return () => { if (published.current === actions) published.current = null; onToolbarActionsChange(null, actions); };
    // Publish passively after the parent installs its current owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, locked, uncertain, count, language, onToolbarActionsChange]);
  useLayoutEffect(() => { const token = reveal.current; reveal.current = null; if (token && current(token)) { if (details.current) details.current.open = true; section.current?.scrollIntoView?.({ block: 'start' }); } });
  return <section ref={section} className="panel-stack detail-batch-compact" aria-label="보관한 본문 사진 일괄 번역" data-workspace-saving={busy} data-workspace-dirty={pending} data-batch-prepared={Boolean(batch)}>
    <details ref={details} className="detail-batch-guidance"><summary>본문 사진 번역 설정·검토</summary>
      <p>보관한 본문 사진 {count}장을 번역합니다. 상단·하단 설정 배너는 원본을 유지합니다.</p>
      <label>본문 사진 원문 언어<select aria-label="본문 사진 원문 언어" value={language} disabled={locked || uncertain} onChange={event => { if (current(generation) && !operation.current && !uncertain) { liveLanguage.current = event.target.value as 'zh' | 'en'; setLanguage(liveLanguage.current); select([]); } }}><option value="zh">중국어 → 한국어</option><option value="en">영어 → 한국어</option></select></label>
      <button type="button" className="btn blue" disabled={locked || uncertain || !count} onClick={() => void prepare()}>본문 사진 번역 준비</button>
    </details>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {stale && <p role="status">저장 구성 또는 단계가 변경됐습니다. 준비한 결과는 유지됩니다. 최신 구성으로 다시 준비해주세요.</p>}
    {batch && batch.items.map(item => <article key={item.photoId} className="panel-stack" aria-label={`작업 본문 사진 ${item.photoId}`}>
      <h5>본문 사진 {item.position + 1} · {({ pending: '준비 중', ready: '검토 대기', failed: '원본 유지', applied: '적용 완료', uncertain: '저장 확인 필요' })[item.status]}</h5>
      {/* eslint-disable-next-line @next/next/no-img-element -- Existing owned source route. */}
      <img src={imageUrl(item.sourceKey)} alt={`본문 사진 원본 ${item.position + 1}`} style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain' }} />
      {item.rendered && <Preview output={item.rendered.output} />}
      {item.texts.map((row, index) => <p key={index}>{row.original} → {row.translated}</p>)}
      {item.message && <p role={item.status === 'failed' || item.status === 'uncertain' ? 'alert' : 'status'}>{item.message}</p>}
      {item.status === 'ready' && <label><input type="checkbox" aria-label={`작업 본문 사진 ${item.photoId} 번역 결과 검토 완료`} checked={reviewed.includes(item.photoId)} disabled={locked || stale || uncertain} onChange={event => {
        if (current(generation) && batchEpoch.current === generation && batch.language === liveLanguage.current && latestBatch.current === batch && !operation.current && !uncertain) select(event.target.checked ? [...liveReviewed.current.filter(id => id !== item.photoId), item.photoId] : liveReviewed.current.filter(id => id !== item.photoId));
      }} />원본·한국어 결과를 확인했습니다.</label>}
    </article>)}
    {uncertain ? <button type="button" className="btn primary" disabled={locked} onClick={() => void recover()}>같은 작업 사진 저장 상태 확인</button>
      : <button type="button" className="btn primary" disabled={locked || stale || !reviewed.length} onClick={() => void apply()}>검토한 본문 사진 {reviewed.length}개 적용</button>}
    {batch && <button type="button" className="btn ghost" disabled={locked || uncertain} onClick={discard}>번역 미리보기 닫기</button>}
  </section>;
}
