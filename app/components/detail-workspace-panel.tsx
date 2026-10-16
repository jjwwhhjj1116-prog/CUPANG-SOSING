'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { generateDetailWorkspaceHtml, type DetailWorkspaceDocument, type DetailWorkspacePhoto, type DetailWorkspaceView } from '@/app/detail-workspace';
import { optionImageValue, quotationImageKeys } from '@/app/quotation-image-targets';
import { createDetailWorkspaceSave, prepareDetailWorkspaceAdoption, prepareDetailWorkspaceRebase, readDetailWorkspace, recoverDetailWorkspace, restoredDetailWorkspaceAttempt, saveDetailWorkspace,
  type DetailWorkspaceAttempt, type DetailWorkspaceSaveInput, type DetailWorkspaceSelection } from '@/app/detail-workspace-client';

type Props = { productId: string; optionId: string; profileId?: string; view: QuotationFieldsView; disabled?: boolean; stageActive?: boolean;
  beforeAdopt?: () => boolean; onAdopt: (keys: string[]) => void; onBusyChange?: (busy: boolean) => void };
type Work = { selection: DetailWorkspaceSelection; reply: DetailWorkspaceView; document: DetailWorkspaceDocument };
type Pending = { input: DetailWorkspaceSaveInput; attempt: DetailWorkspaceAttempt };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const imageUrl = (key: string) => `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
const issue = (cause: unknown) => cause instanceof Error ? cause.message : '상세 편집 구성을 확인하지 못했습니다.';
const documentFrom = (photos: DetailWorkspacePhoto[], margin = 0): DetailWorkspaceDocument => ({ format: 'detail-workspace-v1', photos, imageMargin: margin, generatedHtml: generateDetailWorkspaceHtml(photos, margin) });

/** Independent editable composition. Its generated HTML never replaces the
 * selected option's literal quotation HTML. */
export function DetailWorkspacePanel(props: Props) { return <DetailWorkspaceForm key={JSON.stringify([props.productId, props.optionId, props.profileId ?? null])} {...props} />; }
export function DetailWorkspaceForm({ productId, optionId, profileId, view, disabled = false, stageActive = true, beforeAdopt, onAdopt, onBusyChange }: Props) {
  const [work, setWork] = useState<Work | null>(null), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [ready, setReady] = useState(false);
  const [canRecover, setCanRecover] = useState(false);
  const [retryReady, setRetryReady] = useState(false), [brokenReceipt, setBrokenReceipt] = useState(false);
  const [notApplied, setNotApplied] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [candidate, setCandidate] = useState('');
  const mounted = useRef(true), operation = useRef<AbortController | null>(null), pending = useRef<Pending | null>(null), liveWork = useRef(work);
  const source = JSON.stringify([productId, optionId, profileId ?? null, view, disabled, stageActive]);
  const [clock, setClock] = useState({ source, token: {} }); if (clock.source !== source) setClock({ source, token: {} });
  const generation = clock.source === source ? clock.token : null, epoch = useRef(generation);
  const controls = useRef({ disabled, stageActive, beforeAdopt, onAdopt, onBusyChange });
  const storage = `yoofam-detail-workspace-v1:${productId}:${optionId}:${profileId ?? ''}`;
  useLayoutEffect(() => { controls.current = { disabled, stageActive, beforeAdopt, onAdopt, onBusyChange }; }, [disabled, stageActive, beforeAdopt, onAdopt, onBusyChange]);
  useLayoutEffect(() => { epoch.current = generation; if (!pending.current) operation.current?.abort(); }, [generation]);
  useEffect(() => {
    mounted.current = true; let disposed = false;
    void Promise.resolve().then(async () => {
      if (disposed) return;
      try {
        const raw = sessionStorage.getItem(storage); if (!raw) return;
        const input = JSON.parse(raw) as DetailWorkspaceSaveInput;
        if (input.selection?.productId !== productId || input.selection.optionId !== optionId || (input.selection.profileId ?? '') !== (profileId ?? '')) throw Error('이전 구성의 상품 범위가 다릅니다.');
        const attempt = await restoredDetailWorkspaceAttempt(input); if (disposed) return;
        pending.current = { input, attempt }; const next = { selection: input.selection, reply: input.before, document: input.document };
        liveWork.current = next; setWork(next); setUncertain(true); setCanRecover(true); setMessage('이전 편집 구성의 보관 결과를 먼저 확인해주세요. 저장 요청을 반복하지 않습니다.');
      } catch (cause) { if (!disposed) { setError(issue(cause)); setUncertain(true); setBrokenReceipt(true); } }
      finally { if (!disposed) setReady(true); }
    });
    return () => { disposed = true; mounted.current = false; if (!pending.current) operation.current?.abort(); controls.current.onBusyChange?.(false); };
  }, [storage, productId, optionId, profileId]);
  useEffect(() => { onBusyChange?.(busy || uncertain); }, [busy, uncertain, onBusyChange]);
  const stale = !!work && (!same(work.selection.view, view) || work.selection.productId !== productId || work.selection.optionId !== optionId || (work.selection.profileId ?? '') !== (profileId ?? ''));
  const dirty = !!work && (!work.reply.workspace || !same(work.document, work.reply.workspace.document));
  const locked = !ready || busy || uncertain || disabled || !stageActive || stale;
  function valid(token: object | null) { return mounted.current && !!token && token === epoch.current && controls.current.stageActive && !controls.current.disabled; }
  function begin(token: object | null, allowPending = false) {
    if (!ready || !valid(token) || operation.current || pending.current && !allowPending) return null;
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError(''); controls.current.onBusyChange?.(true); return controller;
  }
  function finish(controller: AbortController) {
    if (operation.current !== controller) return; operation.current = null;
    if (mounted.current) { setBusy(false); controls.current.onBusyChange?.(!!pending.current); }
  }
  function adoptWork(next: Work) { liveWork.current = next; setWork(next); }
  function openWork(selection: DetailWorkspaceSelection, reply: DetailWorkspaceView) {
    const photos = quotationImageKeys(optionImageValue(selection.view, optionId, 'detailImages')).map(key => ({ id: crypto.randomUUID(), key, originKey: key,
      role: (reply.roles.top.includes(key) ? 'top' : reply.roles.bottom.includes(key) ? 'bottom' : 'body') as DetailWorkspacePhoto['role'] }));
    adoptWork({ selection, reply, document: reply.workspace?.document ?? documentFrom(photos) }); setCandidate('');
  }
  async function open() {
    const token = generation, controller = begin(token); if (!controller || uncertain) { if (controller) finish(controller); return; }
    try {
      const selection = { productId, optionId, profileId, view }, reply = await readDetailWorkspace(selection, controller.signal);
      if (!valid(token) || controller.signal.aborted) return;
      openWork(selection, reply); setMessage('구성만 편집합니다. 견적서와 기존 HTML은 아직 바뀌지 않습니다.');
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  function amend(token: object | null, change: (photos: DetailWorkspacePhoto[]) => DetailWorkspacePhoto[]) {
    const current = liveWork.current; if (!valid(token) || operation.current || pending.current || !current || current !== work || !same(current.selection.view, view)) return;
    adoptWork({ ...current, document: documentFrom(change(structuredClone(current.document.photos)), current.document.imageMargin) }); setMessage(''); setError('');
  }
  async function store() {
    const token = generation, current = liveWork.current, controller = begin(token); if (!controller) return;
    try {
      if (!current || !same(current.selection.view, view)) throw Error('저장 기준이 바뀌었습니다. 현재 구성을 유지합니다.');
      const input = await createDetailWorkspaceSave(current.selection, current.reply, current.document); controller.signal.throwIfAborted();
      if (!valid(token) || liveWork.current !== current) return;
      const attempt: DetailWorkspaceAttempt = {}; sessionStorage.setItem(storage, JSON.stringify(input)); pending.current = { input, attempt }; setUncertain(true); setCanRecover(true);
      const reply = await saveDetailWorkspace(input, attempt, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if (!valid(token) || liveWork.current !== current) return;
      adoptWork({ ...current, reply, document: reply.workspace!.document }); setMessage('편집 구성을 보관했습니다. 견적서는 유지됩니다.');
      sessionStorage.removeItem(storage); pending.current = null; setUncertain(false); setCanRecover(false);
    } catch (cause) {
      if (pending.current && !pending.current.attempt.pending && !pending.current.attempt.completed) { pending.current = null; setCanRecover(false); try { sessionStorage.removeItem(storage); } catch { /* The server response already rejected this write. */ } }
      if (mounted.current && !controller.signal.aborted) { setUncertain(!!pending.current); setError(issue(cause)); }
    } finally { finish(controller); }
  }
  async function recover() {
    const value = pending.current, token = generation; if (!value) return; const controller = begin(token, true); if (!controller) return;
    try {
      const current = { productId, optionId, profileId, view }, reply = await recoverDetailWorkspace(value.input, value.attempt, controller.signal, fetch, current);
      if (!mounted.current || controller.signal.aborted) return;
      if (!valid(token)) return;
      if (value.attempt.retryReady) { setRetryReady(true); setMessage('같은 요청의 보관 기록이 아직 없습니다. 현재 작업을 유지하며 같은 구성을 명시적으로 다시 보관할 수 있습니다.'); return; }
      if (value.attempt.notApplied) { setRetryReady(false); setNotApplied(true); setMessage('보관 구성은 바뀌지 않았지만 상품 저장 기준이 바뀌었습니다. 현재 작업을 유지하며 최신 기준을 먼저 확인해주세요.'); return; }
      adoptWork({ selection: current, reply, document: reply.workspace!.document });
      sessionStorage.removeItem(storage); pending.current = null; setUncertain(false); setCanRecover(false); setRetryReady(false); setNotApplied(false); setMessage('보관 결과를 확인했습니다. 저장 요청을 반복하지 않았습니다.');
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  async function retry() {
    const value = pending.current, token = generation; if (!value?.attempt.retryReady) return; const controller = begin(token, true); if (!controller) return;
    setRetryReady(false);
    try {
      const reply = await saveDetailWorkspace(value.input, value.attempt, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if (!valid(token)) return;
      adoptWork({ selection: value.input.selection, reply, document: reply.workspace!.document });
      sessionStorage.removeItem(storage); pending.current = null; setUncertain(false); setCanRecover(false); setMessage('같은 요청의 편집 구성 보관을 확인했습니다.');
    } catch (cause) {
      if (!value.attempt.pending && !value.attempt.completed) { pending.current = null; try { sessionStorage.removeItem(storage); } catch { /* An explicit rejection already confirms this retry did not write. */ } if (mounted.current) { setUncertain(false); setCanRecover(false); } }
      if (mounted.current && !controller.signal.aborted) setError(issue(cause));
    }
    finally { finish(controller); }
  }
  async function rebase() {
    const value = pending.current; if (!value?.attempt.notApplied) return; const token = generation, controller = begin(token, true); if (!controller) return;
    try {
      const prepared = await prepareDetailWorkspaceRebase(value.input, value.attempt, { productId, optionId, profileId, view }, controller.signal);
      if (!valid(token) || controller.signal.aborted) return;
      adoptWork({ selection: prepared.selection, reply: prepared.before, document: prepared.document }); sessionStorage.removeItem(storage); pending.current = null;
      setUncertain(false); setCanRecover(false); setRetryReady(false); setNotApplied(false); setMessage('최신 기준으로 보관을 준비했습니다. 현재 사진 구성을 확인한 뒤 편집 구성 보관을 눌러주세요. 저장 요청은 아직 보내지 않았습니다.');
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  async function repairReceipt() {
    if (!brokenReceipt || pending.current) return; const token = generation, controller = begin(token, true); if (!controller) return;
    try {
      const selection = { productId, optionId, profileId, view }, reply = await readDetailWorkspace(selection, controller.signal);
      if (!valid(token) || controller.signal.aborted) return;
      openWork(selection, reply); sessionStorage.removeItem(storage); setBrokenReceipt(false); setUncertain(false); setCanRecover(false); setMessage('최신 보관 구성을 조회했습니다. 손상된 로컬 확인 자료만 정리했으며 저장 요청은 보내지 않았습니다.');
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  async function adoptPhotos() {
    const token = generation, current = liveWork.current;
    if (!current || !current.reply.workspace || !same(current.document, current.reply.workspace.document) || !same(current.selection.view, view) || controls.current.beforeAdopt && !controls.current.beforeAdopt()) return;
    const controller = begin(token); if (!controller) return;
    try {
      const keys = await prepareDetailWorkspaceAdoption(current.selection, current.reply, controller.signal);
      if (!valid(token) || controller.signal.aborted || liveWork.current !== current || controls.current.beforeAdopt && !controls.current.beforeAdopt()) return;
      const protectedKeys = view.protectedDetailImageKeys ?? [];
      const selected = quotationImageKeys(optionImageValue(view, optionId, 'detailImages'));
      if (protectedKeys.some(key => selected.filter(value => value === key).length !== keys.filter(value => value === key).length)) throw Error('현재 선택된 상단·하단 배너를 유지한 뒤 사진을 초안으로 옮겨주세요.');
      controls.current.onAdopt(keys); setMessage('사진 순서를 선택 옵션의 새 초안으로 옮겼습니다. 기존 HTML은 유지하며 옵션 저장은 별도로 확인합니다.');
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  return <section className="panel-stack" aria-label="상세 편집 구성" aria-busy={busy} data-workspace-dirty={dirty || uncertain} data-workspace-saving={busy || uncertain}>
    <header><h3>상세 편집 구성</h3><p>사진 순서·역할·원본 연결을 견적서와 별도로 보관합니다.</p></header>
    <button type="button" className="btn ghost" disabled={!ready || busy || uncertain || disabled || !stageActive || dirty} onClick={() => void open()}>상세 편집 구성 열기</button>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    {stale && <p role="status">상품 저장 기준이 바뀌었습니다. 현재 구성은 유지했습니다. 작업 내용을 확인한 뒤 구성을 닫고 최신 저장본을 다시 열어주세요.</p>}
    {work && <><p>작업 사진 {work.document.photos.length}장 · {work.reply.workspace ? `보관 버전 ${work.reply.workspace.revision}` : '아직 보관하지 않은 구성'}</p>
      <div style={{ maxHeight: 600, overflow: 'auto' }} aria-label="상세 작업 사진 순서">{work.document.photos.map((photo, index) => <figure key={photo.id} style={{ border: '1px solid #ddd', padding: 12 }}>
        <figcaption>사진 {index + 1} · 원본 {photo.originKey}</figcaption>
        {/* eslint-disable-next-line @next/next/no-img-element -- Existing authenticated owned-image endpoint. */}
        <img src={imageUrl(photo.key)} alt={`상세 작업 사진 ${index + 1}`} loading="lazy" style={{ maxWidth: '100%', maxHeight: 220, objectFit: 'contain' }} />
        <p>{photo.role === 'top' ? '상단 사진' : photo.role === 'bottom' ? '하단 사진' : '본문 사진'}</p>
        <label>사진 교체<select aria-label={`작업 사진 ${index + 1} 교체`} value={photo.key} disabled={locked || photo.role !== 'body' || !work.reply.workspace?.document.photos.some(item => item.id === photo.id)} onChange={event => { const key = event.target.value; if (!work.reply.workspace?.document.photos.some(item => item.id === photo.id) || !work.selection.view.imageKeys.includes(key) || work.reply.roles.top.includes(key) || work.reply.roles.bottom.includes(key)) return; amend(generation, photos => photos.map(item => item.id === photo.id && item.role === 'body' ? { ...item, key } : item)); }}>{work.selection.view.imageKeys.filter(key => key === photo.key || !work.reply.roles.top.includes(key) && !work.reply.roles.bottom.includes(key)).map(key => <option key={key} value={key}>{key}</option>)}</select>{photo.role === 'body' && !work.reply.workspace?.document.photos.some(item => item.id === photo.id) && <small>원본 연결을 먼저 보관한 뒤 사진을 교체할 수 있습니다.</small>}</label>
        <div className="button-row"><button type="button" disabled={locked || photo.role !== 'body' || index === 0 || work.document.photos[index - 1]?.role !== 'body'} aria-label={`작업 사진 ${index + 1} 위로`} onClick={() => amend(generation, photos => { if (photos[index]?.role === 'body' && photos[index - 1]?.role === 'body') [photos[index - 1], photos[index]] = [photos[index], photos[index - 1]]; return photos; })}>↑</button>
          <button type="button" disabled={locked || photo.role !== 'body' || work.document.photos[index + 1]?.role !== 'body'} aria-label={`작업 사진 ${index + 1} 아래로`} onClick={() => amend(generation, photos => { if (photos[index]?.role === 'body' && photos[index + 1]?.role === 'body') [photos[index], photos[index + 1]] = [photos[index + 1], photos[index]]; return photos; })}>↓</button>
          <button type="button" disabled={locked || photo.role !== 'body'} aria-label={`작업 사진 ${index + 1} 제거`} onClick={() => amend(generation, photos => photos.filter(item => item.id !== photo.id || item.role !== 'body'))}>제거</button></div>
      </figure>)}</div>
      <div className="button-row"><select aria-label="작업 사진 추가 선택" value={candidate} disabled={locked || work.document.photos.length >= 150} onChange={event => { if (valid(generation) && !operation.current && !pending.current) setCandidate(event.target.value); }}><option value="">추가할 사진 선택</option>{work.selection.view.imageKeys.filter(key => !(work.reply.roles.top.includes(key) && work.document.photos.some(photo => photo.role === 'top')) && !(work.reply.roles.bottom.includes(key) && work.document.photos.some(photo => photo.role === 'bottom'))).map(key => <option key={key} value={key}>{key}</option>)}</select>
        <button type="button" className="btn ghost" disabled={locked || !candidate || work.document.photos.length >= 150} onClick={() => amend(generation, photos => { if (photos.length >= 150 || !work.selection.view.imageKeys.includes(candidate)) return photos; const role = work.reply.roles.top.includes(candidate) ? 'top' : work.reply.roles.bottom.includes(candidate) ? 'bottom' : 'body'; if (role !== 'body' && photos.some(photo => photo.role === role)) return photos; const photo = { id: crypto.randomUUID(), originKey: candidate, key: candidate, role } as DetailWorkspacePhoto; const at = role === 'top' ? 0 : role === 'body' ? photos.findIndex(item => item.role === 'bottom') : -1; if (at < 0) return [...photos, photo]; return [...photos.slice(0, at), photo, ...photos.slice(at)]; })}>작업 사진 추가</button></div>
      <details><summary>편집용 생성 HTML 보기</summary><textarea aria-label="편집용 생성 HTML" readOnly rows={8} value={work.document.generatedHtml} /><small>사진 구성으로 만든 별도 자료입니다. 기존 견적 HTML에 자동 입력하거나 실행하지 않습니다.</small></details>
      <div className="button-row"><button type="button" className="btn primary" disabled={locked || !dirty} onClick={() => void store()}>편집 구성 보관</button>
        <button type="button" className="btn ghost" disabled={locked || dirty || !work.reply.workspace} onClick={() => void adoptPhotos()}>작업 사진을 선택 옵션 초안으로</button>
        <button type="button" className="btn ghost" disabled={busy || uncertain || disabled || !stageActive} onClick={() => { if (operation.current || pending.current) return; liveWork.current = null; setWork(null); setMessage('현재 작업 구성을 닫았습니다. 보관한 구성과 견적서는 유지됩니다.'); setError(''); }}>현재 구성 닫기</button></div>
    </>}
    {uncertain && <><p role="status">저장 완료 여부를 먼저 읽기로 확인합니다. 확인되지 않은 요청은 자동 반복하지 않습니다.</p><button type="button" className="btn ghost" disabled={busy || disabled || !stageActive || !canRecover} onClick={() => void recover()}>보관 결과 확인</button>
      {retryReady && <button type="button" className="btn ghost" disabled={busy || disabled || !stageActive} onClick={() => void retry()}>같은 구성 다시 보관</button>}
      {notApplied && <button type="button" className="btn ghost" disabled={busy || disabled || !stageActive} onClick={() => void rebase()}>최신 기준으로 보관 준비</button>}
      {brokenReceipt && <button type="button" className="btn ghost" disabled={busy || disabled || !stageActive} onClick={() => void repairReceipt()}>최신 보관 구성으로 복구</button>}</>}
  </section>;
}
