'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { generateDetailWorkspaceHtml, type DetailWorkspaceDocument, type DetailWorkspacePhoto, type DetailWorkspaceView } from '@/app/detail-workspace';
import { initialDetailWorkspaceDocument } from '@/app/detail-workspace-seed';
import { optionImageValue, quotationImageKeys } from '@/app/quotation-image-targets';
import { createDetailWorkspaceSave, prepareDetailWorkspaceAdoption, prepareDetailWorkspaceRebase, readDetailWorkspace, recoverDetailWorkspace, restoredDetailWorkspaceAttempt, saveDetailWorkspace,
  validateDetailWorkspaceReply, type DetailWorkspaceAttempt, type DetailWorkspaceSaveInput, type DetailWorkspaceSelection } from '@/app/detail-workspace-client';
import FreeImageTranslationPanel, { type FreeImageTranslationTarget } from '@/app/components/free-image-translation-panel';
import { readLatestDetailWorkspaceForEditor, type DetailWorkspaceEditorContext } from '@/app/detail-workspace-image-client';
import { attachDetailWorkspaceFiles, readLatestDetailWorkspaceAfterAttachment, recoverDetailWorkspaceFiles, type DetailWorkspaceAttachmentAttempt } from '@/app/detail-workspace-attachment-client';
import { DetailWorkspaceCompositePanel } from '@/app/components/detail-workspace-composite-panel';
import { DetailWorkspaceRebasePanel } from '@/app/components/detail-workspace-rebase-panel';
import { DetailImageEditDialog } from '@/app/components/detail-image-edit-dialog';

type Props = { productId: string; optionId: string; profileId?: string; view: QuotationFieldsView; disabled?: boolean; stageActive?: boolean; primaryDetailTools?: boolean;
  beforeAdopt?: () => boolean; onAdopt: (keys: string[]) => void; onBusyChange?: (busy: boolean) => void; onFilesAttached?: (view: QuotationFieldsView) => void; onRefreshRequested?: () => void; onCompositeSaved?: (view: QuotationFieldsView) => void };
type Work = { selection: DetailWorkspaceSelection; reply: DetailWorkspaceView; document: DetailWorkspaceDocument; seedDocument?: DetailWorkspaceDocument; marginText?: string };
type Pending = { input: DetailWorkspaceSaveInput; attempt: DetailWorkspaceAttempt };
type PhotoEditor = { context: DetailWorkspaceEditorContext; target: FreeImageTranslationTarget; imageKeys: string[]; generation: object };
type Attachment = { selection: DetailWorkspaceSelection; saved: DetailWorkspaceView; attempt: DetailWorkspaceAttachmentAttempt };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const imageUrl = (key: string) => `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
const issue = (cause: unknown) => cause instanceof Error ? cause.message : '상세 편집 구성을 확인하지 못했습니다.';
const documentFrom = (photos: DetailWorkspacePhoto[], margin = 0): DetailWorkspaceDocument => ({ format: 'detail-workspace-v1', photos, imageMargin: margin, generatedHtml: generateDetailWorkspaceHtml(photos, margin) });
const validMargin = (work: Work) => work.marginText === undefined || /^\d+$/.test(work.marginText) && Number.isSafeInteger(Number(work.marginText)) && Number(work.marginText) <= 200;
const marginIssue = '사진 간격은 0~200 사이의 정수로 입력해주세요. 빈 값이나 소수는 보관할 수 없습니다.';

/** Independent editable composition. Its generated HTML never replaces the
 * selected option's literal quotation HTML. */
export function DetailWorkspacePanel(props: Props) { return <DetailWorkspaceForm key={JSON.stringify([props.productId, props.optionId, props.profileId ?? null])} {...props} />; }
export function DetailWorkspaceForm({ productId, optionId, profileId, view, disabled = false, stageActive = true, primaryDetailTools = false, beforeAdopt, onAdopt, onBusyChange, onFilesAttached, onRefreshRequested, onCompositeSaved }: Props) {
  const [work, setWork] = useState<Work | null>(null), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [ready, setReady] = useState(false);
  const [canRecover, setCanRecover] = useState(false);
  const [retryReady, setRetryReady] = useState(false), [brokenReceipt, setBrokenReceipt] = useState(false);
  const [notApplied, setNotApplied] = useState(false);
  const [editor, setEditor] = useState<PhotoEditor | null>(null), [editorBusy, setEditorBusy] = useState(false), [editorDirty, setEditorDirty] = useState(false);
  const [attaching, setAttaching] = useState(false), [attachmentRetry, setAttachmentRetry] = useState(false);
  const [compositeBusy, setCompositeBusy] = useState(false), compositeIO = useRef(false);
  const [bannerBusy, setBannerBusy] = useState(false), bannerIO = useRef(false);
  const liveEditor = useRef<PhotoEditor | null>(null), editorStatus = useRef({ busy: false, dirty: false }), attachment = useRef<Attachment | null>(null), editorSequence = useRef(0);
  const editorCloseGuard = useRef<(() => boolean) | null>(null);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [candidate, setCandidate] = useState('');
  const mounted = useRef(true), operation = useRef<AbortController | null>(null), pending = useRef<Pending | null>(null), liveWork = useRef(work), autoOpened = useRef<object | null>(null);
  const source = JSON.stringify([productId, optionId, profileId ?? null, view, disabled, stageActive]);
  const [clock, setClock] = useState({ source, token: {} }); if (clock.source !== source) setClock({ source, token: {} });
  const generation = clock.source === source ? clock.token : null, epoch = useRef(generation);
  const controls = useRef({ disabled, stageActive, beforeAdopt, onAdopt, onBusyChange, onFilesAttached, onRefreshRequested, onCompositeSaved });
  const storage = `yoofam-detail-workspace-v1:${productId}:${optionId}:${profileId ?? ''}`;
  useLayoutEffect(() => { controls.current = { disabled, stageActive, beforeAdopt, onAdopt, onBusyChange, onFilesAttached, onRefreshRequested, onCompositeSaved }; }, [disabled, stageActive, beforeAdopt, onAdopt, onBusyChange, onFilesAttached, onRefreshRequested, onCompositeSaved]);
  useLayoutEffect(() => { epoch.current = generation; if (!pending.current && !attachment.current) operation.current?.abort(); }, [generation]);
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
    return () => { disposed = true; mounted.current = false; if (!pending.current && !attachment.current) operation.current?.abort(); controls.current.onBusyChange?.(false); };
  }, [storage, productId, optionId, profileId]);
  useEffect(() => { onBusyChange?.(busy || uncertain || attaching || editor !== null || compositeBusy || bannerBusy); }, [busy, uncertain, attaching, editor, compositeBusy, bannerBusy, onBusyChange]);
  const stale = !!work && (!same(work.selection.view, view) || work.selection.productId !== productId || work.selection.optionId !== optionId || (work.selection.profileId ?? '') !== (profileId ?? ''));
  const marginInvalid = !!work && !validMargin(work);
  const dirty = !!work && (marginInvalid || !work.reply.workspace || !same(work.document, work.reply.workspace.document));
  const untouchedSeed = primaryDetailTools && !!work && !work.reply.workspace && !!work.seedDocument && !marginInvalid && same(work.document, work.seedDocument);
  const locked = !ready || busy || uncertain || attaching || editor !== null || compositeBusy || bannerBusy || disabled || !stageActive || stale;
  const outside = work?.document.photos.some(photo => !view.imageKeys.includes(photo.key)) ?? false;
  const imageLabels = new Map([...new Set([...view.imageKeys, ...(work?.document.photos.map(photo => photo.key) ?? [])])].map((key, index) => [key, `이미지 ${index + 1}`]));
  function valid(token: object | null) { return mounted.current && !!token && token === epoch.current && controls.current.stageActive && !controls.current.disabled; }
  function begin(token: object | null, allowPending = false, allowEditor = false) {
    if (!ready || !valid(token) || operation.current || compositeIO.current || bannerIO.current || liveEditor.current && !allowEditor || (pending.current || attachment.current) && !allowPending) return null;
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError(''); controls.current.onBusyChange?.(true); return controller;
  }
  function finish(controller: AbortController) {
    if (operation.current !== controller) return; operation.current = null;
    if (mounted.current) { setBusy(false); controls.current.onBusyChange?.(!!pending.current || !!attachment.current || !!liveEditor.current || compositeIO.current || bannerIO.current); }
  }
  function adoptWork(next: Work) { liveWork.current = next; setWork(next); }
  function openWork(selection: DetailWorkspaceSelection, reply: DetailWorkspaceView) {
    const document = initialDetailWorkspaceDocument(reply, optionId);
    adoptWork({ selection, reply, document, ...(!reply.workspace ? { seedDocument: structuredClone(document) } : {}) }); setCandidate('');
  }
  async function open() {
    const token = generation, controller = begin(token); if (!controller || uncertain) { if (controller) finish(controller); return; }
    try {
      const selection = { productId, optionId, profileId, view }, reply = await readDetailWorkspace(selection, controller.signal);
      if (!valid(token) || controller.signal.aborted) return;
      openWork(selection, reply); setMessage(primaryDetailTools ? '' : '구성만 편집합니다. 견적서와 기존 HTML은 아직 바뀌지 않습니다.');
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  useEffect(() => {
    // One read per current opening. No saved workspace, local edit or unknown
    // write receipt is replaced, and a failed read never loops automatically.
    if (!primaryDetailTools || !ready || !stageActive || disabled || work || !generation || autoOpened.current === generation
      || busy || uncertain || attaching || editor !== null || compositeBusy || bannerBusy || operation.current || pending.current || attachment.current) return;
    autoOpened.current = generation; void open();
    // The generation contains the complete product/view/control source. The
    // inline action is intentionally not a trigger for another automatic read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryDetailTools, ready, stageActive, disabled, work, generation, busy, uncertain, attaching, editor, compositeBusy, bannerBusy]);
  function amend(token: object | null, change: (photos: DetailWorkspacePhoto[]) => DetailWorkspacePhoto[]) {
    const current = liveWork.current; if (!valid(token) || operation.current || compositeIO.current || bannerIO.current || pending.current || attachment.current || liveEditor.current || !current || current !== work || !same(current.selection.view, view)) return;
    adoptWork({ ...current, document: documentFrom(change(structuredClone(current.document.photos)), current.document.imageMargin) }); setMessage(''); setError('');
  }
  function changeMargin(token: object | null, value: string) {
    const current = liveWork.current;
    if (!valid(token) || operation.current || compositeIO.current || bannerIO.current || pending.current || attachment.current || liveEditor.current || !current || current !== work || !same(current.selection.view, view)) return;
    const next = { ...current, marginText: value };
    if (validMargin(next)) next.document = documentFrom(current.document.photos, Number(value));
    adoptWork(next); setMessage(''); setError('');
  }
  async function store() {
    const token = generation, current = liveWork.current;
    if (!valid(token) || current !== work) return;
    if (current && !validMargin(current)) { setError(marginIssue); return; }
    const controller = begin(token); if (!controller) return;
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
    if (!current || !validMargin(current) || !current.reply.workspace || !same(current.document, current.reply.workspace.document) || !same(current.selection.view, view) || controls.current.beforeAdopt && !controls.current.beforeAdopt()) return;
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
  function editPhoto(photoId: string) {
    const current = liveWork.current, record = current?.reply.workspace;
    if (!valid(generation) || !generation || operation.current || compositeIO.current || bannerIO.current || pending.current || attachment.current || liveEditor.current || !current || !record
      || !validMargin(current) || !same(current.document, record.document) || !same(current.selection.view, view)) return;
    const photo = record.document.photos.find(photo => photo.id === photoId); if (!photo || photo.role !== 'body') return;
    const target = { kind: 'detail-workspace' as const, profileId: profileId ?? null, optionId, photoId, revision: record.revision, digest: record.digest };
    const next = { context: { selection: current.selection, saved: current.reply, target }, target: { sourceKey: photo.key, sequence: ++editorSequence.current, role: 'detail' as const, intent: 'manual' as const, workspaceTarget: target },
      imageKeys: [...new Set([...view.imageKeys, ...record.files.map(file => file.key)])], generation };
    liveEditor.current = next; editorStatus.current = { busy: false, dirty: false }; editorCloseGuard.current = null; setEditor(next); setEditorBusy(false); setEditorDirty(false); setError(''); controls.current.onBusyChange?.(true);
  }
  function closePhotoEditor(opened: PhotoEditor) {
    if (liveEditor.current !== opened || editorStatus.current.busy || editorStatus.current.dirty || operation.current || pending.current || attachment.current || !editorCloseGuard.current?.()) return;
    liveEditor.current = null; setEditor(null); controls.current.onBusyChange?.(false);
  }
  async function photoSaved(opened: PhotoEditor, reply: DetailWorkspaceView, token: object | null) {
    const current = liveWork.current;
    if (!current || liveEditor.current !== opened || !valid(token) || !same(current.document, opened.context.saved.workspace?.document)) return;
    try {
      const checked = await validateDetailWorkspaceReply(opened.context.selection, reply);
      if (!mounted.current || liveEditor.current !== opened || liveWork.current !== current || !valid(token)) return;
      adoptWork({ selection: current.selection, reply: checked, document: checked.workspace!.document }); liveEditor.current = null; editorStatus.current = { busy: false, dirty: false };
      setEditor(null); setEditorBusy(false); setEditorDirty(false); setMessage('이 작업 사진과 편집 문서를 상세 구성에 보관했습니다. 상품 이미지에 추가하거나 옵션 초안으로 옮기는 동작은 별도입니다.'); controls.current.onBusyChange?.(false);
    } catch (cause) { if (mounted.current && liveEditor.current === opened) setError(issue(cause)); }
  }
  function attached(current: Attachment, reply: DetailWorkspaceView) {
    adoptWork({ selection: { ...current.selection, view: reply.view }, reply, document: reply.workspace!.document }); attachment.current = null; setAttaching(false); setAttachmentRetry(false);
    setMessage('편집 결과를 상품 이미지 목록에 추가했습니다. 견적서와 기존 HTML은 유지되며 옵션 초안 이동과 저장은 별도입니다.'); controls.current.onFilesAttached?.(reply.view);
  }
  async function attachFiles(retry = false) {
    const token = generation, current = liveWork.current;
    if (!current || !validMargin(current) || !current.reply.workspace || !same(current.document, current.reply.workspace.document) || !same(current.selection.view, view) || liveEditor.current) return;
    const old = retry ? attachment.current : null; if (retry && !old?.attempt.retryReady || !retry && attachment.current) return;
    const controller = begin(token, retry); if (!controller) return;
    const target = old ?? { selection: current.selection, saved: current.reply, attempt: {} }; attachment.current = target; setAttaching(true); setAttachmentRetry(false);
    try {
      const reply = await attachDetailWorkspaceFiles(target.selection, target.saved, target.attempt, controller.signal);
      if (valid(token) && !controller.signal.aborted && liveWork.current === current) attached(target, reply);
    } catch (cause) {
      if (!target.attempt.pending && !target.attempt.completed && !target.attempt.retryReady) { attachment.current = null; if (mounted.current) setAttaching(false); }
      if (mounted.current && !controller.signal.aborted) setError(issue(cause));
    } finally { finish(controller); }
  }
  async function recoverAttachment() {
    const target = attachment.current, token = generation; if (!target) return; const controller = begin(token, true); if (!controller) return;
    try {
      const result = await recoverDetailWorkspaceFiles(target.selection, target.saved, target.attempt, controller.signal);
      if (!valid(token) || controller.signal.aborted) return;
      if (result.attached) attached(target, result.reply); else { setAttachmentRetry(true); setMessage('아직 상품 이미지에 추가되지 않았습니다. 같은 결과를 명시적으로 다시 추가할 수 있습니다.'); }
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  async function latestAttachment() {
    const target = attachment.current, token = generation; if (!target) return; const controller = begin(token, true); if (!controller) return;
    try {
      const reply = await readLatestDetailWorkspaceAfterAttachment(target.selection, target.saved, target.attempt, controller.signal);
      if (!valid(token) || controller.signal.aborted) return;
      openWork({ ...target.selection, view: reply.view }, reply); attachment.current = null; setAttaching(false); setAttachmentRetry(false);
      setMessage('최신 서버 구성으로 다시 열었습니다. 이전 이미지 추가 요청의 성공 여부는 단정하지 않았으며 요청을 반복하지 않았습니다.'); controls.current.onRefreshRequested?.();
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  async function latestEditor(opened: PhotoEditor) {
    if (liveEditor.current !== opened || editorStatus.current.busy) return; const token = generation, controller = begin(token, false, true); if (!controller) return;
    try {
      const reply = await readLatestDetailWorkspaceForEditor(opened.context, controller.signal);
      if (!valid(token) || controller.signal.aborted || liveEditor.current !== opened) return;
      openWork({ ...opened.context.selection, view: reply.view }, reply); liveEditor.current = null; editorStatus.current = { busy: false, dirty: false }; editorCloseGuard.current = null;
      setEditor(null); setEditorBusy(false); setEditorDirty(false); setMessage('현재 편집 초안 대신 최신 서버 구성으로 다시 열었습니다. 이전 사진 보관 요청의 성공 여부를 단정하거나 저장 요청을 반복하지 않았습니다.'); controls.current.onRefreshRequested?.();
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  return <section className={`panel-stack${primaryDetailTools ? ' detail-workspace-primary' : ''}`} aria-label="상세 편집 구성" aria-busy={busy || editorBusy || compositeBusy || bannerBusy} data-workspace-dirty={dirty && !untouchedSeed || uncertain || editorDirty || attaching} data-workspace-saving={busy || uncertain || editorBusy || attaching || compositeBusy || bannerBusy}>
    <header className={primaryDetailTools ? 'button-row detail-workspace-toolbar' : undefined}><h3>{primaryDetailTools ? '상세 페이지 이미지' : '상세 편집 구성'}</h3>{!primaryDetailTools && <p>사진 순서·역할·원본 연결을 견적서와 별도로 보관합니다.</p>}{primaryDetailTools && work && <button type="button" className="btn primary" disabled={locked || !dirty || marginInvalid} onClick={() => void store()}>상세 구성 저장</button>}</header>
    {(!primaryDetailTools || !work) && <button type="button" className="btn ghost" disabled={!ready || busy || uncertain || attaching || editor !== null || compositeBusy || bannerBusy || disabled || !stageActive || dirty} onClick={() => void open()}>상세 편집 구성 열기</button>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    {stale && <p role="status">상품 저장 기준이 바뀌었습니다. 현재 구성은 유지했습니다. 작업 내용을 확인한 뒤 구성을 닫고 최신 저장본을 다시 열어주세요.</p>}
    {work && <>{!primaryDetailTools && <p>작업 사진 {work.document.photos.length}장 · {work.reply.workspace ? `보관 버전 ${work.reply.workspace.revision}` : '아직 보관하지 않은 구성'}</p>}
      {!work.document.photos.some(photo => photo.role === 'body') && <p role="status">수집된 상세 본문 사진이 없습니다. 원본 상세 사진을 다시 수집하거나 아래에서 사진을 직접 추가해주세요.</p>}
      <div className={primaryDetailTools ? 'detail-workspace-photo-stack' : undefined} style={primaryDetailTools ? { background: '#f2f2f2', padding: '16px 0' } : { maxHeight: 600, overflow: 'auto' }} aria-label="상세 작업 사진 순서">{work.document.photos.map((photo, index) => <figure key={photo.id} style={primaryDetailTools ? { width: 'min(800px, 100%)', margin: '0 auto', padding: '0 20px', boxSizing: 'border-box' } : { border: '1px solid #ddd', padding: 12 }}>
        <figcaption>{primaryDetailTools ? <span className="option-detail-image-badge">{photo.role === 'top' ? '상단 이미지' : photo.role === 'bottom' ? '하단 이미지' : '상세 이미지'} · {index + 1}</span> : <>사진 {index + 1} · 원본 {photo.originKey}</>}</figcaption>
        {/* eslint-disable-next-line @next/next/no-img-element -- Existing authenticated owned-image endpoint. */}
        <img src={imageUrl(photo.key)} alt={`상세 작업 사진 ${index + 1}`} loading="lazy" style={primaryDetailTools ? { display: 'block', width: 760, maxWidth: '100%', height: 'auto', marginBottom: work.document.imageMargin } : { maxWidth: '100%', maxHeight: 220, objectFit: 'contain' }} />
        {!primaryDetailTools && <p>{photo.role === 'top' ? '상단 사진' : photo.role === 'bottom' ? '하단 사진' : '본문 사진'}</p>}
        {(!primaryDetailTools || photo.role === 'body') && <><button type="button" className="btn ghost" aria-label={`작업 사진 ${index + 1} 편집`} disabled={locked || dirty || photo.role !== 'body' || !work.reply.workspace?.document.photos.some(item => item.id === photo.id)} onClick={() => editPhoto(photo.id)}>현재 사진 편집</button>
        <details open={!primaryDetailTools ? true : undefined}><summary hidden={!primaryDetailTools}>사진 교체</summary><label>사진 교체<select aria-label={`작업 사진 ${index + 1} 교체`} value={photo.key} disabled={locked || photo.role !== 'body' || !work.reply.workspace?.document.photos.some(item => item.id === photo.id)} onChange={event => { const key = event.target.value; if (!work.reply.workspace?.document.photos.some(item => item.id === photo.id) || !work.selection.view.imageKeys.includes(key) || key !== photo.key && key.split('/').at(-1)?.startsWith('free-image-workspace-') || work.reply.roles.top.includes(key) || work.reply.roles.bottom.includes(key)) return; amend(generation, photos => photos.map(item => item.id === photo.id && item.role === 'body' ? { ...item, key } : item)); }}>{[...new Set([...work.selection.view.imageKeys, photo.key])].filter(key => key === photo.key || !key.split('/').at(-1)?.startsWith('free-image-workspace-') && !work.reply.roles.top.includes(key) && !work.reply.roles.bottom.includes(key)).map(key => <option key={key} value={key}>{primaryDetailTools ? imageLabels.get(key) : key}</option>)}</select>{photo.role === 'body' && !work.reply.workspace?.document.photos.some(item => item.id === photo.id) && <small>{primaryDetailTools ? '사진 편집 전 구성을 저장해주세요.' : '원본 연결을 먼저 보관한 뒤 사진을 교체할 수 있습니다.'}</small>}</label></details>
        <div className="button-row"><button type="button" disabled={locked || photo.role !== 'body' || index === 0 || work.document.photos[index - 1]?.role !== 'body'} aria-label={`작업 사진 ${index + 1} 위로`} onClick={() => amend(generation, photos => { if (photos[index]?.role === 'body' && photos[index - 1]?.role === 'body') [photos[index - 1], photos[index]] = [photos[index], photos[index - 1]]; return photos; })}>↑</button>
          <button type="button" disabled={locked || photo.role !== 'body' || work.document.photos[index + 1]?.role !== 'body'} aria-label={`작업 사진 ${index + 1} 아래로`} onClick={() => amend(generation, photos => { if (photos[index]?.role === 'body' && photos[index + 1]?.role === 'body') [photos[index], photos[index + 1]] = [photos[index + 1], photos[index]]; return photos; })}>↓</button>
          <button type="button" disabled={locked || photo.role !== 'body'} aria-label={`작업 사진 ${index + 1} 제거`} onClick={() => amend(generation, photos => photos.filter(item => item.id !== photo.id || item.role !== 'body'))}>제거</button></div></>}
      </figure>)}</div>
      <details className={primaryDetailTools ? 'detail-workspace-settings' : undefined} open={!primaryDetailTools ? true : undefined}><summary hidden={!primaryDetailTools}>사진 추가·간격·고급 설정</summary>
      {primaryDetailTools && <p>작업 사진 {work.document.photos.length}장 · {work.reply.workspace ? `보관 버전 ${work.reply.workspace.revision}` : '아직 저장하지 않은 구성'}</p>}
      <div className="button-row"><select aria-label="작업 사진 추가 선택" value={candidate} disabled={locked || work.document.photos.length >= 150} onChange={event => { if (valid(generation) && !operation.current && !pending.current) setCandidate(event.target.value); }}><option value="">추가할 사진 선택</option>{work.selection.view.imageKeys.filter(key => !key.split('/').at(-1)?.startsWith('free-image-workspace-') && !(work.reply.roles.top.includes(key) && work.document.photos.some(photo => photo.role === 'top')) && !(work.reply.roles.bottom.includes(key) && work.document.photos.some(photo => photo.role === 'bottom'))).map(key => <option key={key} value={key}>{primaryDetailTools ? imageLabels.get(key) : key}</option>)}</select>
        <button type="button" className="btn ghost" disabled={locked || !candidate || work.document.photos.length >= 150} onClick={() => amend(generation, photos => { if (photos.length >= 150 || !work.selection.view.imageKeys.includes(candidate) || candidate.split('/').at(-1)?.startsWith('free-image-workspace-')) return photos; const role = work.reply.roles.top.includes(candidate) ? 'top' : work.reply.roles.bottom.includes(candidate) ? 'bottom' : 'body'; if (role !== 'body' && photos.some(photo => photo.role === role)) return photos; const photo = { id: crypto.randomUUID(), originKey: candidate, key: candidate, role } as DetailWorkspacePhoto; const at = role === 'top' ? 0 : role === 'body' ? photos.findIndex(item => item.role === 'bottom') : -1; if (at < 0) return [...photos, photo]; return [...photos.slice(0, at), photo, ...photos.slice(at)]; })}>작업 사진 추가</button></div>
      <small>작업 사진 편집 결과는 보관한 해당 사진에서 다시 편집합니다. 다른 작업 사진으로 복사하는 기능은 지원하지 않습니다.</small>
      <label>편집 HTML 사진 간격 (px)<input type="number" min={0} max={200} step={1} inputMode="numeric" aria-label="편집 HTML 사진 간격 (px)" aria-invalid={marginInvalid} disabled={locked}
        value={work.marginText ?? String(work.document.imageMargin)} onChange={event => changeMargin(generation, event.target.value)} /></label>
      {marginInvalid && <p role="alert">{marginIssue}</p>}
      <small>편집용 HTML에만 적용하며 최종 합친 이미지는 간격 없이 저장합니다. 0~200px 범위의 정수를 편집 구성 보관으로 저장합니다.</small>
      <details><summary>편집용 생성 HTML 보기</summary><textarea aria-label="편집용 생성 HTML" readOnly rows={8} value={work.document.generatedHtml} /><small>사진 구성으로 만든 별도 자료입니다. 기존 견적 HTML에 자동 입력하거나 실행하지 않습니다.</small></details>
      <div className="button-row">{!primaryDetailTools && <button type="button" className="btn primary" disabled={locked || !dirty || marginInvalid} onClick={() => void store()}>편집 구성 보관</button>}
        {outside && <button type="button" className="btn ghost" disabled={locked || dirty || !work.reply.workspace} onClick={() => void attachFiles()}>편집 결과를 상품 이미지에 추가</button>}
        <button type="button" className="btn ghost" disabled={locked || dirty || outside || !work.reply.workspace} onClick={() => void adoptPhotos()}>작업 사진을 선택 옵션 초안으로</button>
        <button type="button" className="btn ghost" disabled={busy || uncertain || attaching || editor !== null || compositeBusy || bannerBusy || disabled || !stageActive} onClick={() => { if (operation.current || compositeIO.current || bannerIO.current || pending.current || attachment.current || liveEditor.current) return; liveWork.current = null; setWork(null); setMessage('현재 작업 구성을 닫았습니다. 보관한 구성과 견적서는 유지됩니다.'); setError(''); }}>현재 구성 닫기</button></div></details>
      {work.reply.workspace && <DetailWorkspaceCompositePanel key={`workspace-composite:${productId}:${optionId}:${profileId ?? ''}`} selection={{ ...work.selection, view }} saved={work.reply}
        disabled={disabled || busy || uncertain || attaching || editor !== null || bannerBusy} stageActive={stageActive} sourceCurrent={!dirty && !stale}
        beforeApply={() => !operation.current && !bannerIO.current && !pending.current && !attachment.current && !liveEditor.current && !!liveWork.current && validMargin(liveWork.current) && same(liveWork.current.document, work.reply.workspace?.document) && same(liveWork.current.selection.view, view)}
        onBusyChange={value => { if (compositeIO.current === value) return; compositeIO.current = value; setCompositeBusy(value); controls.current.onBusyChange?.(value || bannerIO.current || !!pending.current || !!attachment.current || !!liveEditor.current); }}
        onSaved={next => {
          const latest = liveWork.current; if (!valid(generation) || !latest || !validMargin(latest) || !same(latest.document, work.reply.workspace?.document)) return;
          adoptWork({ selection: { ...latest.selection, view: next }, reply: { ...latest.reply, view: next }, document: latest.document }); controls.current.onCompositeSaved?.(next);
        }}
        onLatestRead={reply => { if (!valid(generation)) return; openWork({ productId, optionId, profileId, view: reply.view }, reply); controls.current.onRefreshRequested?.(); }} />}
    </>}
    <details className={primaryDetailTools ? 'detail-workspace-banner-settings' : undefined} open={!primaryDetailTools ? true : undefined}><summary hidden={!primaryDetailTools}>상단·하단 배너 설정</summary><DetailWorkspaceRebasePanel key={`workspace-banners:${productId}:${optionId}:${profileId ?? ''}`} selection={{ productId, optionId, profileId, view }} stageActive={stageActive}
      disabled={!ready || disabled || busy || uncertain || attaching || editor !== null || compositeBusy || dirty}
      beforeApply={() => !operation.current && !compositeIO.current && !pending.current && !attachment.current && !liveEditor.current
        && (!liveWork.current || validMargin(liveWork.current) && !!liveWork.current.reply.workspace && same(liveWork.current.document, liveWork.current.reply.workspace.document)) && controls.current.beforeAdopt?.() !== false}
      onBusyChange={value => { if (bannerIO.current === value) return; bannerIO.current = value; setBannerBusy(value); controls.current.onBusyChange?.(value || compositeIO.current || !!pending.current || !!attachment.current || !!liveEditor.current); }}
      onSaved={reply => {
        const latest = liveWork.current; if (!valid(generation) || latest !== work || latest && (!validMargin(latest) || !latest.reply.workspace || !same(latest.document, latest.reply.workspace.document))) return;
        openWork({ productId, optionId, profileId, view: reply.view }, reply); setMessage('현재 배너 설정을 편집 구성에 반영했습니다. 본문 사진·간격과 견적서는 유지했습니다.'); controls.current.onRefreshRequested?.();
      }}
      onLatestRead={() => {
        const latest = liveWork.current; if (!valid(generation) || latest !== work || latest && (!validMargin(latest) || !latest.reply.workspace || !same(latest.document, latest.reply.workspace.document))) return;
        liveWork.current = null; setWork(null); setCandidate(''); setMessage('최신 배너 기준을 조회했습니다. 이전 요청 결과는 단정하지 않았습니다. 최신 상품 기준에서 변경 내용을 다시 확인해주세요.'); controls.current.onRefreshRequested?.();
      }} /></details>
    {editor && <DetailImageEditDialog open identity={JSON.stringify([productId,optionId,profileId??null,view.productVersion,editor.target])} blocked={editorBusy||editorDirty||busy}
      canClose={()=>liveEditor.current===editor&&!editorStatus.current.busy&&!editorStatus.current.dirty&&!operation.current&&!pending.current&&!attachment.current&&editorCloseGuard.current?.()===true}
      onClose={()=>closePhotoEditor(editor)}><section aria-label="선택한 작업 사진 편집"><FreeImageTranslationPanel productId={productId} version={editor.context.selection.view.productVersion} imageKeys={editor.imageKeys}
      translationTarget={editor.target} workspaceContext={editor.context} active={stageActive} disabled={disabled || stale || busy}
      beforeApply={() => liveEditor.current === editor && valid(generation) && !operation.current && !pending.current && !attachment.current && same(liveWork.current?.document, editor.context.saved.workspace?.document)}
      onBusyChange={value => { if (liveEditor.current !== editor || editorStatus.current.busy === value) return; editorStatus.current = { ...editorStatus.current, busy: value }; setEditorBusy(value); }}
      onEditingChange={value => { if (liveEditor.current !== editor || editorStatus.current.dirty === value) return; editorStatus.current = { ...editorStatus.current, dirty: value }; setEditorDirty(value); }}
      onCloseGuard={guard => { if (liveEditor.current === editor) editorCloseGuard.current = guard; }}
      onWorkspaceSaved={reply => void photoSaved(editor, reply, generation)} />
      <button type="button" className="btn ghost" disabled={editorBusy || editorDirty || busy} onClick={() => closePhotoEditor(editor)}>작업 사진 편집 닫기</button>
      <p>편집을 계속할 수 없으면 현재 편집 초안 대신 최신 서버 구성을 읽기로 다시 열 수 있습니다. 이전 요청의 성공 여부는 단정하지 않습니다.</p>
      <button type="button" className="btn ghost" disabled={editorBusy || busy || disabled || !stageActive} onClick={() => void latestEditor(editor)}>최신 구성으로 다시 열기</button></section></DetailImageEditDialog>}
    {attaching && <div><p role="status">상품 이미지에 추가한 결과를 확인할 때까지 현재 구성을 유지합니다.</p><button type="button" className="btn ghost" disabled={busy || disabled || !stageActive} onClick={() => void recoverAttachment()}>상품 이미지 추가 결과 확인</button>
      {attachmentRetry && <button type="button" className="btn ghost" disabled={busy || disabled || !stageActive} onClick={() => void attachFiles(true)}>같은 편집 결과 다시 추가</button>}</div>}
    {attaching && <button type="button" className="btn ghost" disabled={busy || disabled || !stageActive} onClick={() => void latestAttachment()}>최신 상태로 다시 열기</button>}
    {uncertain && <><p role="status">저장 완료 여부를 먼저 읽기로 확인합니다. 확인되지 않은 요청은 자동 반복하지 않습니다.</p><button type="button" className="btn ghost" disabled={busy || disabled || !stageActive || !canRecover} onClick={() => void recover()}>보관 결과 확인</button>
      {retryReady && <button type="button" className="btn ghost" disabled={busy || disabled || !stageActive} onClick={() => void retry()}>같은 구성 다시 보관</button>}
      {notApplied && <button type="button" className="btn ghost" disabled={busy || disabled || !stageActive} onClick={() => void rebase()}>최신 기준으로 보관 준비</button>}
      {brokenReceipt && <button type="button" className="btn ghost" disabled={busy || disabled || !stageActive} onClick={() => void repairReceipt()}>최신 보관 구성으로 복구</button>}</>}
  </section>;
}
