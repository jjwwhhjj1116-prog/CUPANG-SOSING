'use client';
import { PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-pool-limit';
import { isOwnedImageKey } from '@/app/image-files';
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import type { QuotationChange, QuotationFieldsView } from '@/app/quotation-schema';
import type { FreeImageQuotationRequest } from '@/app/free-image-translation-client';
import { optionImageChanges, optionImageDraftIssues, optionImageTargets, optionImageValue, quotationImageKeys, reorderOptionImageKeys, verifyOptionImageRefresh, verifyOptionImageRestored, verifyOptionImageSave, verifyOptionImageRecovery, type OptionImageDraft, type OptionImageInput, type OptionImageStage } from '@/app/quotation-image-targets';
import { downloadImageSelection } from '@/app/image-selection-download';
import { DetailImageCompositePanel } from '@/app/components/detail-image-composite-panel';
import { DetailWorkspacePanel } from '@/app/components/detail-workspace-panel';
import { canEditSavedDetailInputs, prepareSavedDetailInputs, prepareSavedDetailComposition } from '@/app/detail-editor-inputs-client';

type Props = { productId: string; optionId: string; version: string; profileId?: string; refreshToken?: string; stage: OptionImageStage; active?: boolean;
  disabled?: boolean; onSaved?: () => void; onTranslate?: (sourceKey: string, role: OptionImageStage, sourceLanguage: 'zh' | 'en', quotationTarget: FreeImageQuotationRequest) => void;
  onEdit?: (sourceKey: string, role: OptionImageStage, quotationTarget: FreeImageQuotationRequest) => void };
const imageUrl = (key: string) => `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
const dragMime = 'application/x-yoofam-option-image-order';
type ImageDrag = { scope: string; sourceKey: string; stage: OptionImageStage; view: QuotationFieldsView; keys: string[]; key: string; token: string; element: HTMLElement };
export function OptionImageEditor({ productId, optionId, version, profileId, refreshToken, stage, active = true, disabled = false, onSaved, onTranslate, onEdit }: Props) {
  const endpoint = `/api/products/${encodeURIComponent(productId)}/quotation-fields${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`;
  const scope = JSON.stringify([endpoint, optionId]), sourceKey = JSON.stringify([scope, version, refreshToken]);
  const currentScope = useRef(scope), currentSource = useRef(sourceKey), currentStage = useRef(stage), request = useRef<AbortController | null>(null);
  const mounted = useRef(true), pendingSave = useRef<{ scope: string; before: QuotationFieldsView; changes: QuotationChange[]; acknowledged?: QuotationFieldsView } | null>(null);
  const [saved, setSaved] = useState<{ scope: string; sourceKey: string; view: QuotationFieldsView } | null>(null);
  const [pending, setPending] = useState<{ scope: string; values: OptionImageDraft }>({ scope, values: {} });
  const [preview, setPreview] = useState<{ scope: string; key: string } | null>(null);
  const activeDrag = useRef<ImageDrag | null>(null), liveDisabled = useRef(disabled), liveActive = useRef(active);
  const [dragging, setDragging] = useState<{ token: string; key: string; target: string | null } | null>(null);
  const latestSaved = useRef<typeof saved>(null), latestDraft = useRef({ scope, values: {} as OptionImageDraft });
  function clearDrag() { activeDrag.current = null; setDragging(null); }
  useLayoutEffect(() => {
    mounted.current = true; currentScope.current = scope; currentSource.current = sourceKey;
    if (latestDraft.current.scope !== scope) latestDraft.current = { scope, values: {} };
    if (pendingSave.current?.scope !== scope) pendingSave.current = null;
    return () => { mounted.current = false; activeDrag.current = null; request.current?.abort(); request.current = null; };
  }, [scope, sourceKey]);
  useLayoutEffect(() => { currentStage.current = stage; activeDrag.current = null; }, [stage]);
  useLayoutEffect(() => { liveDisabled.current = disabled; if (disabled) activeDrag.current = null; }, [disabled]);
  useLayoutEffect(() => { liveActive.current = active; }, [active]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [uncertain, setUncertain] = useState(false);
  const compositeBusy = useRef(false), [merging, setMerging] = useState(false);
  const workspaceBusy = useRef({ key: sourceKey, busy: false }), [workspaceWork, setWorkspaceWork] = useState({ key: sourceKey, busy: false });
  const workspaceWorking = workspaceWork.key === sourceKey && workspaceWork.busy;
  const view = saved?.scope === scope ? saved.view : null, draft = pending.scope === scope ? pending.values : {};
  const dirty = Object.keys(draft).length > 0, input = stage === 'additional' ? 'additionalImages' : 'detailImages', label = stage === 'additional' ? '추가 이미지' : '상세 이미지';
  const current = () => mounted.current && currentScope.current === scope && currentSource.current === sourceKey;
  const readable = () => current() && currentStage.current === stage && !liveDisabled.current && !compositeBusy.current
    && !(workspaceBusy.current.key === sourceKey && workspaceBusy.current.busy);
  const interactive = () => readable() && active && liveActive.current;
  const cardCurrent = () => interactive() && (stage !== 'detail' || !!keyboardGeneration && keyboardEpoch.current === keyboardGeneration);
  function verify(body: QuotationFieldsView, saveResponse = false, explicitLatest = false) {
    if (!body || (!saveResponse && !explicitLatest && body.productVersion !== version) || !Number.isFinite(Date.parse(body.productVersion)) || !Number.isSafeInteger(body.revision) || body.revision < 0
      || !Number.isSafeInteger(body.contentRevision) || body.contentRevision < 0 || !Number.isSafeInteger(body.optionRevision) || body.optionRevision < 0
      || !/^[a-f0-9]{64}$/.test(body.inputFingerprint) || !Array.isArray(body.imageKeys) || body.imageKeys.length > PRODUCT_IMAGE_POOL_LIMIT
      || new Set(body.imageKeys).size !== body.imageKeys.length || body.imageKeys.some(key => typeof key !== 'string' || !key || key.length > 512 || /[\u0000-\u001f]/u.test(key))
      || !body.overrides?.common || !body.overrides.options || !Array.isArray(body.resolved?.schema?.fields)
      || !Array.isArray(body.resolved.rows) || !Array.isArray(body.automatic?.rows)
      || body.resolved.rows.filter(row => row.optionId === optionId).length !== 1 || body.automatic.rows.filter(row => row.optionId === optionId).length !== 1
      || (profileId && body.categoryContext?.profileId !== profileId)) throw Error('선택한 상품·옵션의 이미지 저장본을 확인하지 못했습니다. 상품을 다시 열어주세요.');
    const targets = optionImageTargets(body.resolved.schema.fields), row = body.resolved.rows.find(row => row.optionId === optionId)!;
    if (Object.values(targets).some(target => target.fields.some(field => field.readOnly || typeof row.fields[field.id]?.value !== 'string')))
      throw Error('선택 옵션의 이미지 입력 연결을 확인하지 못했습니다. 견적서 상세 항목을 확인해주세요.');
  }
  async function load(keepDraft = false) {
    if (!readable() || request.current) return;
    clearDrag();
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal }), body = await response.json() as QuotationFieldsView & { error?: string };
      if (controller.signal.aborted || !current()) return;
      const attempt = pendingSave.current?.scope === scope ? pendingSave.current : null;
      if (!response.ok) throw Error(body.error || '옵션 이미지를 불러오지 못했습니다.'); verify(body, false, keepDraft || !!attempt);
      const editing = latestDraft.current.scope === scope ? latestDraft.current.values : {};
      let recovered = false;
      if (keepDraft) {
        const before = attempt?.before ?? (latestSaved.current?.scope === scope ? latestSaved.current.view : null); if (!before) throw Error('이전 이미지 입력 기준을 확인하지 못했습니다.');
        if (attempt) {
          try { verifyOptionImageRecovery(before, body, optionId, attempt.changes, attempt.acknowledged); recovered = true; }
          catch (cause) {
            if (JSON.stringify(body) !== JSON.stringify(before)) throw cause;
            verifyOptionImageRefresh(before, body, optionId, editing);
          }
        } else verifyOptionImageRefresh(before, body, optionId, editing);
      } else if (attempt) verifyOptionImageRefresh(attempt.before, body, optionId, {});
      latestSaved.current = { scope, sourceKey, view: body }; setSaved(latestSaved.current);
      pendingSave.current = null; setUncertain(false);
      if (!keepDraft || recovered) { latestDraft.current = { scope, values: {} }; setPending(latestDraft.current); }
      setMessage(recovered ? '저장된 선택 옵션 이미지를 확인했습니다. 견적서에 반영됩니다.' : keepDraft ? '입력을 유지하고 최신 이미지를 읽었습니다. 확인 후 선택 옵션 이미지를 저장해주세요.' : '');
      if (recovered) onSaved?.();
    } catch (cause) { if (!controller.signal.aborted && current()) setError(cause instanceof Error ? cause.message : '옵션 이미지 조회 실패'); }
    finally { if (request.current === controller) { request.current = null; if (!controller.signal.aborted && current()) setBusy(false); } }
  }
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active || !current()) return; setBusy(false); setError(''); setUncertain(pendingSave.current?.scope === scope);
      if (pendingSave.current?.scope === scope || latestDraft.current.scope === scope && Object.keys(latestDraft.current.values).length && latestSaved.current?.scope === scope) return;
      // An image apply can publish the new version before its processing lock
      // clears. Resume that skipped read on unlock, without rereading a basis
      // already loaded or replacing any local/unacknowledged option draft.
      if (disabled || latestSaved.current?.scope === scope && latestSaved.current.sourceKey === sourceKey) return;
      void load();
    });
    return () => { active = false; request.current?.abort(); request.current = null; };
    // Source identity governs reads. Stage changes retain the same option's
    // pending image/HTML edits; local editing never starts an automatic write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, sourceKey, disabled, workspaceWorking]);
  function edit(field: OptionImageInput, value: string | null) {
    if (!view || latestSaved.current?.view !== view || !interactive() || pendingSave.current?.scope === scope || request.current) return;
    clearDrag();
    latestDraft.current = { scope, values: { ...(latestDraft.current.scope === scope ? latestDraft.current.values : {}), [field]: value } };
    setPending(latestDraft.current); setMessage('');
  }
  function updateImages(update: (keys: string[]) => string[]) {
    const base = latestSaved.current, editing = latestDraft.current.scope === scope ? latestDraft.current.values : {};
    if (!base || base.scope !== scope || !cardCurrent() || request.current) return;
    const before = quotationImageKeys(optionImageValue(base.view, optionId, input, editing)), after = update(before);
    if (JSON.stringify(before) === JSON.stringify(after) || !preservesSettingsImages(before, after)) return;
    edit(input, after.join('\n'));
  }
  function toggle(key: string) {
    if (!view?.imageKeys.includes(key) || !mutableImage(key)) return;
    updateImages(keys => {
      if (keys.includes(key)) return keys.filter(item => item !== key);
      if (stage !== 'detail' || !keys.some(item => knownProtection?.includes(item))) return [...keys, key];
      const lastBody = keys.findLastIndex(item => !knownProtection!.includes(item));
      if (lastBody < 0) { setMessage('설정 이미지만 남아 있습니다. 공통·자동값을 복원해 본문 위치를 확인한 뒤 사진을 추가해주세요.'); return keys; }
      return [...keys.slice(0, lastBody + 1), key, ...keys.slice(lastBody + 1)];
    });
  }
  function move(key: string, index: number, direction: -1 | 1) {
    if (!mutableImage(key)) return;
    updateImages(keys => { const destination = index + direction; if (keys[index] !== key || destination < 0 || destination >= keys.length || !mutableImage(keys[destination])) return keys; const ordered = [...keys]; [ordered[index], ordered[destination]] = [ordered[destination], ordered[index]]; return ordered; });
  }
  async function save() {
    const base = latestSaved.current, editing = latestDraft.current.scope === scope ? latestDraft.current.values : {};
    if (!base || base.scope !== scope || !Object.keys(editing).length || !interactive() || request.current) return;
    if (pendingSave.current?.scope === scope) { await load(true); return; }
    if (base.sourceKey !== sourceKey) { setError('상품 저장 상태가 변경됐습니다. 입력을 유지하고 최신 이미지를 조회한 뒤 저장해주세요.'); return; }
    let changes; try { changes = optionImageChanges(base.view, optionId, editing); } catch (cause) { setError(cause instanceof Error ? cause.message : '이미지 입력을 확인해주세요.'); return; }
    clearDrag();
    const attempt = { scope, before: base.view, changes: changes.map(change => ({ ...change })) } as NonNullable<typeof pendingSave.current>;
    pendingSave.current = attempt; setUncertain(true);
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setMessage(''); let response: Response | undefined;
    try {
      response = await fetch(endpoint, { method: 'PUT', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: base.view.revision, expectedInputFingerprint: base.view.inputFingerprint, changes }) });
      let body = await response.json() as QuotationFieldsView & { error?: string };
      if (controller.signal.aborted || !current()) return;
      if (!response.ok) throw Error(body.error || '옵션 이미지를 저장하지 못했습니다. 입력은 유지됩니다.'); verify(body, true); verifyOptionImageSave(base.view, body, optionId, changes);
      attempt.acknowledged = body;
      if (changes.some(change => change.value === null)) {
        const confirmation = await fetch(endpoint, { cache: 'no-store', signal: controller.signal }), latest = await confirmation.json() as QuotationFieldsView & { error?: string };
        if (controller.signal.aborted || !current()) return;
        if (!confirmation.ok) throw Error(latest.error || '이미지 복원 저장본을 다시 확인하지 못했습니다. 입력은 유지했습니다.');
        verify(latest, true); verifyOptionImageSave(base.view, latest, optionId, changes); verifyOptionImageRestored(body, latest, optionId, changes); body = latest;
      }
      latestSaved.current = { scope, sourceKey, view: body }; latestDraft.current = { scope, values: {} };
      pendingSave.current = null; setUncertain(false);
      setSaved(latestSaved.current); setPending(latestDraft.current); setMessage('선택 옵션 이미지 저장 완료 · 견적서에 반영됩니다.'); onSaved?.();
    } catch (cause) { if (!controller.signal.aborted && current()) {
      if (response && !response.ok && response.status < 500) { pendingSave.current = null; setUncertain(false); }
      setError(cause instanceof Error ? cause.message : '옵션 이미지 저장 실패');
    } }
    finally { if (request.current === controller) { request.current = null; if (!controller.signal.aborted && current()) setBusy(false); } }
  }
  let selected: string[] = [], html = '', limit = 30, issues: string[] = [], bindingError = '';
  if (view) try {
    const targets = optionImageTargets(view.resolved.schema.fields); selected = quotationImageKeys(optionImageValue(view, optionId, input, draft)); html = optionImageValue(view, optionId, 'detailHtml', draft);
    limit = Math.min(...targets[input].fields.map(field => field.maxItems ?? 30)); issues = optionImageDraftIssues(view, optionId, draft);
  } catch (cause) { bindingError = cause instanceof Error ? cause.message : '이미지 연결 확인 필요'; }
  const row = view?.resolved.rows.find(row => row.optionId === optionId), locked = busy || merging || workspaceWorking || disabled || uncertain || !!bindingError;
  const unavailable = selected.filter(key => !view?.imageKeys.includes(key));
  const activePreview = preview?.scope === scope && view?.imageKeys.includes(preview.key) ? preview.key : selected.find(key => view?.imageKeys.includes(key)) ?? view?.imageKeys[0] ?? null;
  // The shortcut needs explicit role evidence; a flattened first/last image
  // cannot tell a settings banner from a normal content image.
  const protectedKeys = view?.protectedDetailImageKeys;
  const knownProtection = Array.isArray(protectedKeys) && new Set(protectedKeys).size === protectedKeys.length
    && protectedKeys.every(key => typeof key === 'string' && view?.imageKeys.includes(key)) ? protectedKeys : null;
  function mutableImage(key: string) { return stage !== 'detail' || knownProtection !== null && !knownProtection.includes(key); }
  function preservesSettingsImages(before: string[], after: string[]) {
    if (stage !== 'detail') return true;
    if (knownProtection === null) return false;
    const protectedSet = new Set(knownProtection), anchors = (keys: string[]) => keys.filter(key => protectedSet.has(key));
    if (JSON.stringify(anchors(before)) !== JSON.stringify(anchors(after))) return false;
    // Existing content cannot cross a settings banner, including by dragging
    // past one. Removing body images does not pin banners to numeric indexes.
    return after.every((key, index) => protectedSet.has(key) || !before.includes(key)
      || anchors(before.slice(0, before.indexOf(key))).length === anchors(after.slice(0, index)).length);
  }
  const keyboardScope = JSON.stringify([sourceKey, stage, active, disabled, saved?.sourceKey, view?.revision, view?.inputFingerprint, selected, knownProtection]);
  const [keyboardClock, setKeyboardClock] = useState({ scope: keyboardScope, token: {} });
  if (keyboardClock.scope !== keyboardScope) setKeyboardClock({ scope: keyboardScope, token: {} });
  const keyboardGeneration = keyboardClock.scope === keyboardScope ? keyboardClock.token : null, keyboardEpoch = useRef(keyboardGeneration);
  const hoveredDetail = useRef<{ generation: object; key: string; view: QuotationFieldsView; keys: string[] } | null>(null);
  useLayoutEffect(() => { keyboardEpoch.current = keyboardGeneration; hoveredDetail.current = null; }, [keyboardGeneration]);
  function currentKeyboard() {
    return !!keyboardGeneration && keyboardEpoch.current === keyboardGeneration && active && liveActive.current && stage === 'detail' && interactive()
      && !locked && !request.current && pendingSave.current?.scope !== scope && saved?.sourceKey === sourceKey && latestSaved.current?.view === view && knownProtection !== null;
  }
  function hoverDetail(key: string) {
    if (!view || !currentKeyboard()) return;
    hoveredDetail.current = null;
    if (!selected.includes(key) || !view.imageKeys.includes(key) || knownProtection?.includes(key) || new Set(selected).size !== selected.length) return;
    hoveredDetail.current = { generation: keyboardGeneration!, key, view, keys: [...selected] };
  }
  function leaveDetail(key: string) { if (hoveredDetail.current?.generation === keyboardGeneration && hoveredDetail.current.key === key) hoveredDetail.current = null; }
  function deleteHoveredDetail(event: KeyboardEvent) {
    if (event.key !== 'Delete' || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !currentKeyboard()) return;
    const textInput = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return !!element?.isContentEditable || !!element?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="spinbutton"]');
    };
    if (textInput(event.target) || typeof document !== 'undefined' && textInput(document.activeElement)) return;
    const hovered = hoveredDetail.current, base = latestSaved.current, editing = latestDraft.current.scope === scope ? latestDraft.current.values : {};
    if (!hovered || hovered.generation !== keyboardGeneration || !base || base.view !== hovered.view || !base.view.imageKeys.includes(hovered.key) || knownProtection?.includes(hovered.key)) return;
    try {
      const keys = quotationImageKeys(optionImageValue(base.view, optionId, 'detailImages', editing));
      if (JSON.stringify(keys) !== JSON.stringify(hovered.keys) || new Set(keys).size !== keys.length || !keys.includes(hovered.key)) { hoveredDetail.current = null; return; }
      hoveredDetail.current = null; event.preventDefault(); event.stopPropagation(); edit('detailImages', keys.filter(key => key !== hovered.key).join('\n'));
    } catch { hoveredDetail.current = null; }
  }
  useEffect(() => {
    if (typeof document === 'undefined' || stage !== 'detail' || !active) return;
    const handler = (event: KeyboardEvent) => deleteHoveredDetail(event);
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });
  function dragSelection(key: string) {
    const base = latestSaved.current, editing = latestDraft.current.scope === scope ? latestDraft.current.values : {};
    if (!base || base.scope !== scope || base.sourceKey !== sourceKey || !cardCurrent() || !mutableImage(key)
      || liveDisabled.current || compositeBusy.current || request.current || pendingSave.current?.scope === scope || bindingError) return null;
    try {
      const keys = quotationImageKeys(optionImageValue(base.view, optionId, input, editing));
      if (!keys.includes(key) || keys.some(value => !base.view.imageKeys.includes(value)) || new Set(keys).size !== keys.length) return null;
      return { view: base.view, keys };
    } catch { return null; }
  }
  function currentDrag(key: string) {
    const attempt = activeDrag.current, selection = dragSelection(key);
    return attempt && selection && attempt.scope === scope && attempt.sourceKey === sourceKey && attempt.stage === stage
      && attempt.view === selection.view && JSON.stringify(attempt.keys) === JSON.stringify(selection.keys) ? attempt : null;
  }
  function startDrag(key: string, event: DragEvent<HTMLElement>) {
    const selection = dragSelection(key);
    if (!selection || !event.dataTransfer) { event.preventDefault(); return; }
    const attempt = { scope, sourceKey, stage, ...selection, key, token: crypto.randomUUID(), element: event.currentTarget };
    try {
      event.dataTransfer.clearData(); event.dataTransfer.setData(dragMime, attempt.token); event.dataTransfer.effectAllowed = 'move';
      activeDrag.current = attempt; setDragging({ token: attempt.token, key, target: null });
    } catch { clearDrag(); event.preventDefault(); }
  }
  function dragOver(key: string, event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    const attempt = currentDrag(key);
    // Browser drag data is protected until drop. Check the private format here;
    // the exact token is checked only when the payload becomes readable.
    if (!attempt || !event.dataTransfer?.types.includes(dragMime)) return;
    event.dataTransfer.dropEffect = 'move';
    setDragging({ token: attempt.token, key: attempt.key, target: key });
  }
  function dropImage(key: string, event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const attempt = currentDrag(key);
    if (!attempt || !event.dataTransfer || event.dataTransfer.getData(dragMime) !== attempt.token) return;
    event.stopPropagation();
    const ordered = reorderOptionImageKeys(attempt.keys, attempt.key, key); clearDrag();
    if (preservesSettingsImages(attempt.keys, ordered) && JSON.stringify(ordered) !== JSON.stringify(attempt.keys)) edit(input, ordered.join('\n'));
  }
  function endDrag(key: string, event: DragEvent<HTMLElement>) {
    const attempt = currentDrag(key);
    // Native dragend data can be protected. Ending our current source gesture
    // only cancels its private state; it never changes the selected references.
    if (attempt?.key === key && attempt.element === event.currentTarget) clearDrag();
  }
  function sortableProps(key: string, index: number, className = '') {
    const visible = !!dragging && !locked;
    const draggable = !locked && active && saved?.sourceKey === sourceKey && mutableImage(key)
      && selected.includes(key) && selected.every(item => view?.imageKeys.includes(item)) && new Set(selected).size === selected.length;
    return { 'data-image-sort-key': key, 'aria-label': `${label} ${index + 1} 순서 이동`, draggable,
      className: `${className} option-image-sortable${visible && dragging?.key === key ? ' dragging' : ''}${visible && dragging?.target === key ? ' drag-over' : ''}`.trim(),
      onDragStart: (event: DragEvent<HTMLElement>) => startDrag(key, event), onDragOver: (event: DragEvent<HTMLElement>) => dragOver(key, event),
      onDrop: (event: DragEvent<HTMLElement>) => dropImage(key, event), onDragEnd: (event: DragEvent<HTMLElement>) => endDrag(key, event) };
  }
  function translateSelected(key: string, slotIndex: number, sourceLanguage: 'zh' | 'en', manual = false) {
    const base = latestSaved.current;
    if (!(manual ? onEdit : onTranslate) || !base || base.view !== view || base.scope !== scope || base.sourceKey !== sourceKey || base.view.productVersion !== version
      || !cardCurrent() || !mutableImage(key) || pendingSave.current?.scope === scope || request.current || Object.keys(latestDraft.current.values).length || !base.view.imageKeys.includes(key)) return;
    try {
      const target = optionImageTargets(base.view.resolved.schema.fields)[input], value = optionImageValue(base.view, optionId, input);
      if (quotationImageKeys(value)[slotIndex] !== key || target.linked.some(id => optionImageValue(base.view, optionId, input, {}, id) !== value)) return;
      const quotationTarget: FreeImageQuotationRequest = { kind: 'quotation', profileId: profileId ?? null, optionId, input, fieldKey: target.primary, slotIndex,
        revision: base.view.revision, inputFingerprint: base.view.inputFingerprint, optionRevision: base.view.optionRevision, value };
      if (manual) onEdit?.(key, stage, quotationTarget); else onTranslate?.(key, stage, sourceLanguage, quotationTarget);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '번역할 이미지 연결을 확인해주세요.'); }
  }
  async function downloadSelection() {
    const base = latestSaved.current, editing = latestDraft.current.scope === scope ? latestDraft.current.values : {};
    if (!base || base.scope !== scope || !interactive() || request.current || pendingSave.current?.scope === scope) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try { await downloadImageSelection(quotationImageKeys(optionImageValue(base.view, optionId, input, editing)), base.view.imageKeys, `YOOFAM-${stage}-images.zip`, controller.signal); }
    catch (cause) { if (!controller.signal.aborted && current()) setError(cause instanceof Error ? cause.message : '선택 이미지 다운로드 실패'); }
    finally { if (request.current === controller) { request.current = null; if (!controller.signal.aborted && current()) setBusy(false); } }
  }
  async function reopenDetailInputs(withHtml = false) {
    const base = latestSaved.current, generation = keyboardGeneration;
    if (!base || base.view !== view || base.sourceKey !== sourceKey || !generation || keyboardEpoch.current !== generation || !active || !liveActive.current
      || stage !== 'detail' || !interactive() || request.current || pendingSave.current || Object.keys(latestDraft.current.values).length) return;
    const controller = new AbortController(); request.current = controller; clearDrag(); setBusy(true); setError(''); setMessage('');
    try {
      const selection = { productId, optionId, profileId, view: base.view };
      const restored = withHtml ? await prepareSavedDetailComposition(selection, controller.signal) : null;
      const prepared = restored ?? await prepareSavedDetailInputs(selection, controller.signal);
      if (controller.signal.aborted || !current() || !liveActive.current || currentStage.current !== 'detail' || liveDisabled.current || keyboardEpoch.current !== generation
        || latestSaved.current !== base || pendingSave.current || Object.keys(latestDraft.current.values).length) return;
      latestDraft.current = { scope, values: { detailImages: prepared.keys.join('\n'), ...(restored ? { detailHtml: restored.composition.html.effective } : {}) } }; setPending(latestDraft.current);
      setMessage(restored
        ? '저장 전 개별 사진과 당시 HTML을 함께 불러왔습니다. HTML은 공란·공백을 포함한 당시 문자열의 새 수동 초안입니다. 현재 견적서는 유지되며 확인 후 선택 옵션 이미지를 저장해주세요.'
        : '저장 전 개별 사진을 편집 입력으로 불러왔습니다. 현재 견적서는 유지됩니다. 순서·삭제를 확인하고 선택 옵션 이미지를 저장한 뒤 필요한 사진을 편집·번역해주세요.');
    } catch (cause) { if (!controller.signal.aborted && current() && keyboardEpoch.current === generation) setError(cause instanceof Error ? cause.message : '개별 상세 사진 확인 실패'); }
    finally { if (request.current === controller) { request.current = null; if (!controller.signal.aborted && current()) setBusy(false); } }
  }
  const candidateCards = view?.imageKeys.map((key, index) => <figure className={`image-asset-card ${key === activePreview ? 'previewing' : ''} ${selected.includes(key) ? 'chosen' : ''}`} key={key}>
    <button type="button" className="image-asset-preview" aria-label={`상품 저장 이미지 ${index + 1} 크게 보기`} disabled={locked} onClick={() => { if (interactive() && !request.current) setPreview({ scope, key }); }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl(key)} alt={`상품 저장 이미지 ${index + 1}`} width={200} height={180} loading="lazy" /><span>이미지 {index + 1} · 확대</span>
    </button>
    <figcaption><label><input type="checkbox" aria-label={`선택 옵션 ${label} 후보 ${index + 1}`} checked={selected.includes(key)} disabled={locked || !mutableImage(key) || (!selected.includes(key) && selected.length >= limit)} onChange={() => toggle(key)} />이미지 {index + 1} 선택</label></figcaption>
  </figure>);
  const selectedActions = (key: string, index: number) => <div className={stage === 'detail' ? 'option-detail-image-toolbar' : 'image-selected-actions'} role="group" aria-label={`${label} ${index + 1} 편집`}>
    {stage === 'detail' && knownProtection?.includes(key) && <small>상단·하단 설정 이미지 · 원본과 위치 유지</small>}
    {onEdit && <button type="button" className="btn ghost" aria-label={`${label} ${index + 1} 편집하기`} disabled={locked || !mutableImage(key) || dirty || saved?.sourceKey !== sourceKey || !view?.imageKeys.includes(key)} onClick={() => translateSelected(key, index, 'zh', true)}>편집하기</button>}
    {onTranslate && <><button type="button" className="btn ghost" aria-label={`${label} ${index + 1} 중국어 한국어 번역`} disabled={locked || !mutableImage(key) || dirty || saved?.sourceKey !== sourceKey || !view?.imageKeys.includes(key)} onClick={() => translateSelected(key, index, 'zh')}>중국어 → 한국어</button>
      <button type="button" className="btn ghost" aria-label={`${label} ${index + 1} 영어 한국어 번역`} disabled={locked || !mutableImage(key) || dirty || saved?.sourceKey !== sourceKey || !view?.imageKeys.includes(key)} onClick={() => translateSelected(key, index, 'en')}>영어 → 한국어</button></>}
    <button type="button" className="btn ghost" aria-label={`${label} ${index + 1} 위로 이동`} disabled={locked || !mutableImage(key) || index === 0 || !mutableImage(selected[index - 1])} onClick={() => move(key, index, -1)}>↑</button>
    <button type="button" className="btn ghost" aria-label={`${label} ${index + 1} 아래로 이동`} disabled={locked || !mutableImage(key) || index === selected.length - 1 || !mutableImage(selected[index + 1])} onClick={() => move(key, index, 1)}>↓</button>
    <button type="button" className="btn ghost" aria-label={`${label} ${index + 1} 선택 제거`} disabled={locked || !mutableImage(key)} onClick={() => updateImages(keys => keys.filter((_, position) => position !== index))}>삭제</button>
  </div>;
  return <section className="panel-stack" aria-label="선택 옵션 이미지 편집" data-quotation-source-step={stage === 'additional' ? '추가 이미지' : '상세 이미지'} data-workspace-dirty={dirty} data-workspace-saving={busy || merging || workspaceWorking}>
    <h3>{stage === 'detail' ? '상세 페이지 이미지' : '선택 옵션 추가 이미지'}</h3><p>{row?.optionLabel || optionId} · {row?.included === false ? '견적 제외 옵션' : '선택한 옵션'}</p>
    <p>드래그 또는 ↑↓로 순서를 조정한 뒤 저장하세요. 선택한 이미지와 순서는 이 옵션의 견적서에만 저장합니다. 상품 공통 이미지와 다른 옵션은 유지됩니다.</p>
    <button type="button" className="btn ghost" disabled={!view || locked || !selected.length || !!unavailable.length} onClick={() => void downloadSelection()}>{label} ZIP 다운로드</button>
    <small>현재 선택한 순서의 원본·편집 결과 파일을 내려받습니다. 미저장 선택을 견적서에 반영하려면 이미지 저장을 눌러주세요.</small>
    {stage === 'detail' && view && canEditSavedDetailInputs({ productId, optionId, profileId, view }) && <div className="button-row">
      <button type="button" className="btn ghost" disabled={locked || dirty || !active || saved?.sourceKey !== sourceKey} onClick={() => void reopenDetailInputs()}>저장 전 개별 사진으로 편집</button>
      <button type="button" className="btn ghost" disabled={locked || dirty || !active || saved?.sourceKey !== sourceKey} onClick={() => void reopenDetailInputs(true)}>저장 전 사진·HTML로 편집</button>
      <small>합치기 직전의 검증된 사진 순서를 불러옵니다. 저장하기 전까지 현재 통합 상세 이미지는 바뀌지 않습니다.</small>
      <small>사진·HTML 재편집은 HTML을 함께 보관한 저장 건에서 사용할 수 있습니다. 당시 HTML을 그대로 새 수동 초안에 넣으며 예전 공통·자동 상속 상태로 되돌리지는 않습니다.</small>
    </div>}
    {stage === 'detail' && view && <details className="option-detail-advanced"><summary>상세 이미지 합치기·작업 구성</summary><DetailWorkspacePanel key={`workspace:${scope}`} productId={productId} optionId={optionId} profileId={profileId} view={view} stageActive={active}
      disabled={disabled || busy || merging || uncertain || dirty || !!bindingError || saved?.sourceKey !== sourceKey}
      onRefreshRequested={() => {
        if (!keyboardGeneration || keyboardEpoch.current !== keyboardGeneration || !active || !liveActive.current || !current() || currentStage.current !== 'detail'
          || liveDisabled.current || compositeBusy.current || request.current || pendingSave.current || Object.keys(latestDraft.current.values).length) return;
        onSaved?.();
      }}
      onFilesAttached={next => {
        if (!keyboardGeneration || keyboardEpoch.current !== keyboardGeneration || !active || !liveActive.current || !current() || currentStage.current !== 'detail'
          || liveDisabled.current || compositeBusy.current || request.current || pendingSave.current || latestSaved.current?.view !== view
          || latestSaved.current.sourceKey !== sourceKey || Object.keys(latestDraft.current.values).length) return;
        try {
          verify(next, true);
          const stable = (value: QuotationFieldsView) => Object.fromEntries(Object.entries(value).filter(([key]) => !['productVersion', 'imageKeys', 'inputFingerprint'].includes(key)));
          if (JSON.stringify(stable(next)) !== JSON.stringify(stable(view)) || Date.parse(next.productVersion) <= Date.parse(view.productVersion)
            || next.imageKeys.length <= view.imageKeys.length || !view.imageKeys.every((key, index) => next.imageKeys[index] === key)
            || next.imageKeys.some(key => !isOwnedImageKey(view.imageKeys[0]?.split('/')[0] ?? '', key))) return;
          clearDrag(); latestSaved.current = { scope, sourceKey, view: next }; setSaved(latestSaved.current);
          setMessage('편집 결과를 상품의 이미지 후보에 추가했습니다. 견적서는 유지했습니다. 최신 편집 구성을 열어 사진을 확인한 뒤 옵션 초안에 적용해주세요.');
          onSaved?.();
        } catch { setError('추가한 사진의 최신 상품 기준을 확인하지 못했습니다. 견적서는 유지하고 최신 저장본을 다시 확인해주세요.'); }
      }}
      onCompositeSaved={next => {
        if (!keyboardGeneration || keyboardEpoch.current !== keyboardGeneration || !active || !liveActive.current || !current() || currentStage.current !== 'detail'
          || liveDisabled.current || compositeBusy.current || request.current || pendingSave.current || latestSaved.current?.view !== view
          || latestSaved.current.sourceKey !== sourceKey || Object.keys(latestDraft.current.values).length) return;
        try {
          verify(next, true);
          if (next.revision !== view.revision + 1 || next.contentRevision !== view.contentRevision || next.optionRevision !== view.optionRevision
            || Date.parse(next.productVersion) <= Date.parse(view.productVersion) || next.updatedAt !== next.productVersion
            || JSON.stringify(next.categoryContext) !== JSON.stringify(view.categoryContext) || next.imageKeys.length <= view.imageKeys.length
            || !view.imageKeys.every((key, index) => next.imageKeys[index] === key)
            || next.imageKeys.some(key => !isOwnedImageKey(view.imageKeys[0]?.split('/')[0] ?? '', key))) return;
          clearDrag(); latestSaved.current = { scope, sourceKey, view: next }; setSaved(latestSaved.current);
          setMessage('보관한 작업 구성의 최종 이미지를 공통 항목과 모든 옵션에 저장했습니다. 편집 구성과 저장 전 HTML은 별도로 보관했습니다.');
          onSaved?.();
        } catch { setError('상세 저장 결과의 최신 견적 기준을 확인하지 못했습니다. 저장 결과를 다시 조회해주세요.'); }
      }}
      beforeAdopt={() => !!keyboardGeneration && keyboardEpoch.current === keyboardGeneration && active && liveActive.current && current() && currentStage.current === 'detail'
        && !liveDisabled.current && !compositeBusy.current && !request.current && !pendingSave.current && latestSaved.current?.view === view
        && latestSaved.current.sourceKey === sourceKey && knownProtection !== null && !Object.keys(latestDraft.current.values).length}
      onBusyChange={value => {
        if (!current() || value && (!active || !liveActive.current || currentStage.current !== 'detail' || liveDisabled.current
          || !keyboardGeneration || keyboardEpoch.current !== keyboardGeneration)) return;
        if (workspaceBusy.current.key === sourceKey && workspaceBusy.current.busy === value) return;
        workspaceBusy.current = { key: sourceKey, busy: value }; setWorkspaceWork(workspaceBusy.current);
      }}
      onAdopt={keys => {
        if (!keyboardGeneration || keyboardEpoch.current !== keyboardGeneration || !active || !liveActive.current || !current() || currentStage.current !== 'detail'
          || liveDisabled.current || compositeBusy.current || request.current || pendingSave.current || latestSaved.current?.view !== view
          || latestSaved.current.sourceKey !== sourceKey || Object.keys(latestDraft.current.values).length || !Array.isArray(keys)
          || keys.length > PRODUCT_IMAGE_POOL_LIMIT || keys.some(key => typeof key !== 'string' || !view.imageKeys.includes(key)) || !knownProtection
          || knownProtection.some(key => selected.filter(value => value === key).length !== keys.filter(value => value === key).length)) return;
        clearDrag(); latestDraft.current = { scope, values: { detailImages: keys.join('\n') } }; setPending(latestDraft.current);
        setMessage('보관한 작업 사진을 선택 옵션의 수동 초안으로 불러왔습니다. 기존 견적 HTML은 유지했습니다. 확인 후 선택 옵션 이미지를 저장해주세요.');
      }} />
    {stage === 'detail' && view && <DetailImageCompositePanel key={`composite:${scope}`} productId={productId} optionId={optionId} profileId={profileId} view={view} stageActive={active}
      disabled={disabled || busy || workspaceWorking || uncertain || dirty || !!bindingError || saved?.sourceKey !== sourceKey}
      beforeApply={() => !!keyboardGeneration && keyboardEpoch.current === keyboardGeneration && active && liveActive.current && current() && currentStage.current === 'detail' && !liveDisabled.current && !request.current && !pendingSave.current && !Object.keys(latestDraft.current.values).length}
      onBusyChange={value => { compositeBusy.current = value; setMerging(value); }}
      onSaved={body => { if (!current()) return; latestSaved.current = { scope, sourceKey, view: body }; setSaved(latestSaved.current); onSaved?.(); }} />}</details>}
    {busy && <p role="status">옵션 이미지 처리 중…</p>}{error && <p role="alert">{error}</p>}{bindingError && <p role="alert">{bindingError}</p>}{message && <p role="status">{message}</p>}
    {dirty && saved?.sourceKey !== sourceKey && <p role="status">상품 저장 상태가 변경됐습니다. 입력은 유지했습니다. 최신 자료를 조회한 뒤 저장해주세요.</p>}
    {view && <>{stage === 'additional' ? <div className="image-edit-workspace">
      <aside className="image-edit-library" aria-label="상품 저장 이미지 후보 목록"><h4>모든 이미지 {view.imageKeys.length}</h4><div className="image-asset-grid">{candidateCards}</div>{!view.imageKeys.length && <p>상품에 저장한 이미지를 먼저 추가해주세요.</p>}</aside>
      <section className="image-edit-canvas" aria-label="선택 옵션 이미지 미리보기"><h4>현재 {label} · {selected.length}/{limit}개</h4>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {activePreview ? <figure className="image-large-preview"><figcaption>이미지 {view.imageKeys.indexOf(activePreview) + 1} 미리보기</figcaption><img src={imageUrl(activePreview)} alt={`선택 옵션 ${label} 큰 미리보기`} /></figure> : <p>이미지 목록에서 미리볼 자료를 선택하세요.</p>}
        <div className="image-selected-strip option-additional-image-strip" aria-label={`선택 옵션 ${label} 순서`}>{selected.map((key, index) => <figure key={`${index}:${key}`} {...sortableProps(key, index, 'image-selected-item')}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {view.imageKeys.includes(key) ? <button type="button" aria-label={`${label} ${index + 1} 크게 보기`} disabled={locked} onClick={() => { if (interactive() && !request.current) setPreview({ scope, key }); }}><img src={imageUrl(key)} alt={`${label} ${index + 1}`} width={64} height={64} /><span>{index + 1}</span></button> : <p>현재 상품에 없는 이미지</p>}
      <figcaption>{index + 1} · {key.split('/').at(-1)}</figcaption>
      {selectedActions(key, index)}
    </figure>)}</div>{!selected.length && <p>이 옵션에 선택한 {label}가 없습니다.</p>}
      </section></div> : <><section className="option-detail-image-stack" aria-label="선택 옵션 상세 이미지 순서"><h4>현재 상세 이미지 · {selected.length}/{limit}개</h4>{selected.map((key, index) => <figure key={`${index}:${key}`} {...sortableProps(key, index, 'option-detail-image-item')} onMouseEnter={() => hoverDetail(key)} onMouseLeave={() => leaveDetail(key)}>
        <figcaption>상세 이미지 {index + 1} · {key.split('/').at(-1)}</figcaption>{selectedActions(key, index)}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {view.imageKeys.includes(key) ? <img src={imageUrl(key)} alt={`상세 이미지 ${index + 1}`} loading="lazy" /> : <p>현재 상품에 없는 이미지</p>}
      </figure>)}{!selected.length && <p>이 옵션에 선택한 상세 이미지가 없습니다.</p>}</section>
        <details className="option-detail-image-candidates"><summary>모든 이미지 {view.imageKeys.length} · 상세 이미지 선택·교체</summary><div className="option-detail-image-candidate-grid">{candidateCards}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview?.scope === scope && view.imageKeys.includes(preview.key) && <figure className="image-large-preview"><figcaption>이미지 {view.imageKeys.indexOf(preview.key) + 1} 미리보기</figcaption><img src={imageUrl(preview.key)} alt="상세 이미지 후보 큰 미리보기" /></figure>}
          {!view.imageKeys.length && <p>상품에 저장한 이미지를 먼저 추가해주세요.</p>}
        </details></>}
      <div><button type="button" className="btn ghost" disabled={locked || stage === 'detail' && knownProtection === null} onClick={() => updateImages(keys => stage === 'detail' ? keys.filter(key => knownProtection?.includes(key)) : [])}>{stage === 'detail' && selected.some(key => knownProtection?.includes(key)) ? '본문 이미지 선택 비우기' : `${label} 선택 비우기`}</button><button type="button" className="btn ghost" disabled={locked} onClick={() => edit(input, null)}>{label} 공통·자동값 복원</button></div>
      {!!unavailable.length && <p role="alert">현재 상품에 없는 이미지 참조가 {unavailable.length}개 있습니다. <button type="button" className="btn ghost" disabled={locked} onClick={() => updateImages(keys => keys.filter(key => view.imageKeys.includes(key)))}>누락 이미지 참조 제거</button></p>}
      <small>이미지 업로드·파일 편집은 상품 공통 이미지 편집에서 진행합니다. 저장한 파일은 최신 이미지 조회 후 이 옵션의 후보 목록에서도 선택할 수 있습니다.</small>
      {stage === 'detail' && <details className="option-detail-html"><summary>상세 HTML 직접 편집</summary><label className="field"><span>선택 옵션 상세 HTML</span><textarea aria-label="선택 옵션 상세 HTML" value={html} disabled={locked} onChange={event => edit('detailHtml', event.target.value)} />
        <small>이미지 순서 변경은 자동 상세 HTML에 반영됩니다. 기존 직접 작성한 HTML과 공란은 유지합니다. HTML은 텍스트로 편집하며 이 화면에서 실행하지 않습니다.</small>
        <button type="button" className="btn ghost" disabled={locked} onClick={() => edit('detailHtml', '')}>상세 HTML 비우기</button><button type="button" className="btn ghost" disabled={locked} onClick={() => edit('detailHtml', null)}>상세 HTML 공통·자동값 복원</button>
      </label></details>}
    </>}
    {!!issues.length && <p role="alert">{[...new Set(issues)].join(' ')}</p>}
    <button type="button" className="btn primary" disabled={!view || busy || merging || workspaceWorking || disabled || !!bindingError || !dirty || !!issues.length} onClick={() => void save()}>{uncertain ? '이미지 저장 결과 확인' : '선택 옵션 이미지 저장'}</button>
    {dirty && <button type="button" className="btn ghost" disabled={busy || merging || workspaceWorking || disabled} onClick={() => void load(true)}>입력 유지·최신 이미지 조회</button>}
    <button type="button" className="btn ghost" disabled={busy || merging || workspaceWorking || disabled} onClick={() => void load()}>{dirty ? '입력 취소·저장 이미지 다시 조회' : '저장 이미지 다시 조회'}</button>
  </section>;
}
