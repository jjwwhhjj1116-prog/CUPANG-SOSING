'use client';
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FREE_IMAGE_ROLES, MAX_OCR_REGIONS, type FreeImageRole } from '@/app/free-image-translation';
import {
  applyFreeImageTranslation, FreeImageApplyError, readFreeImageSource, recognizeFreeImage, recoverFreeImageTranslation, renderFreeImageTranslation, sameFreeImageQuotationRequest, translateFreeImageRegions,
  type FreeImageLoaded, type FreeImageQuotationRequest, type FreeImageRegion, type FreeImageRendered,
} from '@/app/free-image-translation-client';

export type FreeImageTranslationTarget = { sourceKey: string; sequence: number; sourceLanguage?: 'zh' | 'en'; role?: FreeImageRole; quotationTarget?: FreeImageQuotationRequest };
export type FreeImageQuotationContext = Pick<FreeImageQuotationRequest, 'profileId' | 'optionId' | 'input'>;
type Props = { productId: string; version: string; imageKeys: string[]; translationTarget?: FreeImageTranslationTarget;
  focusedOptionId?: string; quotationContext?: FreeImageQuotationContext;
  onProductChanged?: () => void; onBusyChange?: (busy: boolean) => void; beforeApply?: () => boolean };
const roleNames: Record<FreeImageRole, string> = { main: '대표 이미지', additional: '추가 이미지', detailTop: '상단 이미지', detail: '상세 이미지', detailBottom: '하단 이미지' };
type RequestWork = { controller: AbortController; epoch: number; kind: 'ocr' | 'refresh' | 'translate' | 'preview' | 'save' | 'recover' };
const sameQuotationSlot = (left: FreeImageQuotationRequest | null | undefined, right: FreeImageQuotationRequest | null | undefined) => !left || !right ? !left && !right
  : left.profileId === right.profileId && left.optionId === right.optionId && left.input === right.input && left.fieldKey === right.fieldKey && left.slotIndex === right.slotIndex;

function useLiveDraft<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const live = useRef(value);
  const update = useCallback((next: T | ((previous: T) => T)) => {
    const current = typeof next === 'function' ? (next as (previous: T) => T)(live.current) : next;
    live.current = current; setValue(current);
  }, []);
  return [value, update, live] as const;
}

function useScopedBlobUrl(blob: Blob | null) {
  const [snapshot, setSnapshot] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) return;
    let active = true; const url = URL.createObjectURL(blob);
    void Promise.resolve().then(() => { if (active) setSnapshot({ blob, url }); });
    return () => { active = false; URL.revokeObjectURL(url); };
  }, [blob]);
  return snapshot && snapshot.blob === blob ? snapshot.url : '';
}

export default function FreeImageTranslationPanel(props: Props) { return <FreeImageTranslationContent key={props.productId} {...props} />; }
function FreeImageTranslationContent({ productId, version, imageKeys, translationTarget, focusedOptionId, quotationContext, onProductChanged, onBusyChange, beforeApply }: Props) {
  const [sourceKey, setSourceKey] = useState('');
  const [role, setRole] = useState<FreeImageRole>('detail');
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');
  const [quotationTarget, setQuotationTarget, liveQuotationTarget] = useLiveDraft<FreeImageQuotationRequest | null>(null);
  const [loaded, setLoaded] = useState<FreeImageLoaded | null>(null);
  const [regions, setRegions, liveRegions] = useLiveDraft<FreeImageRegion[]>([]);
  const [optionImageIds, setOptionImageIds, liveOptionImageIds] = useLiveDraft<string[]>([]);
  const [rendered, setRendered, liveRendered] = useLiveDraft<FreeImageRendered | null>(null);
  const originalUrl = useScopedBlobUrl(loaded?.blob ?? null);
  const previewUrl = useScopedBlobUrl(rendered?.output ?? null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain, liveUncertain] = useLiveDraft(false);
  const [readyRetry, setReadyRetry, liveReadyRetry] = useLiveDraft(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true), epoch = useRef(0), active = useRef<RequestWork | null>(null);
  const pendingSave = useRef<FreeImageRendered | null>(null), lastVersion = useRef(version), handledTarget = useRef<number | null>(null);
  const recoveredScope = useRef<string | null>(null);
  const pendingTarget = useRef<{ epoch: number } | null>(null);
  const manualId = useRef(0), panel = useRef<HTMLElement | null>(null), sourceControl = useRef<HTMLSelectElement | null>(null);
  const selectionKey = JSON.stringify(quotationContext ?? null), liveSelection = useRef(selectionKey);
  const editorKey = JSON.stringify([productId, version, sourceKey, role, quotationTarget]), liveEditor = useRef(editorKey);
  const busyCallback = useRef(onBusyChange);
  useEffect(() => { busyCallback.current = onBusyChange; }, [onBusyChange]);
  useLayoutEffect(() => { liveEditor.current = editorKey; }, [editorKey]);
  useLayoutEffect(() => {
    if (liveSelection.current === selectionKey) return;
    liveSelection.current = selectionKey;
    if (!liveQuotationTarget.current) return;
    const scope = ++epoch.current;
    active.current?.controller.abort(); active.current = null; recoveredScope.current = null;
    if (!pendingSave.current) liveRendered.current = null;
    void Promise.resolve().then(() => {
      if (!mounted.current || epoch.current !== scope || liveSelection.current !== selectionKey) return;
      setBusy(false); busyCallback.current?.(false);
      if (pendingSave.current) { setReadyRetry(false); setUncertain(true); }
      else setRendered(null);
    });
  }, [selectionKey, liveQuotationTarget, liveRendered, setReadyRetry, setRendered, setUncertain]);
  useEffect(() => {
    const epochRef = epoch;
    mounted.current = true;
    return () => { mounted.current = false; epochRef.current++; active.current?.controller.abort(); active.current = null; busyCallback.current?.(false); };
  }, []);
  useEffect(() => {
    if (lastVersion.current === version) return;
    lastVersion.current = version; const scope = ++epoch.current;
    active.current?.controller.abort(); active.current = null; recoveredScope.current = null;
    if (!pendingSave.current) liveRendered.current = null;
    void Promise.resolve().then(() => {
      if (!mounted.current || epoch.current !== scope || lastVersion.current !== version) return;
      setBusy(false); busyCallback.current?.(false); setError('');
      if (pendingSave.current) { setReadyRetry(false); setUncertain(true); setNotice('저장 버전이 변경됐습니다. 응답을 확인하지 못한 미리보기는 같은 결과로 저장 상태를 확인할 수 있습니다.'); }
      else { setRendered(null); setNotice('상품 저장본이 변경됐습니다. 작성한 문구는 유지했습니다. 원본 저장 상태를 다시 확인한 뒤 미리보기를 만들어주세요.'); }
    });
  }, [version, liveRendered, setReadyRetry, setRendered, setUncertain]);
  function focusedTarget(target = liveQuotationTarget.current) {
    return liveSelection.current === selectionKey && (!target || !!quotationContext && quotationContext.profileId === target.profileId
      && quotationContext.optionId === target.optionId && quotationContext.input === target.input);
  }
  function editorCurrent() { return liveEditor.current === editorKey; }
  function current(work: RequestWork) { return mounted.current && active.current === work && work.epoch === epoch.current && !work.controller.signal.aborted && focusedTarget() && editorCurrent(); }
  function begin(kind: RequestWork['kind']) {
    if (!mounted.current || active.current || !focusedTarget() || !editorCurrent()) return null;
    const work = { kind, epoch: epoch.current, controller: new AbortController() }; active.current = work;
    setBusy(true); busyCallback.current?.(true); setError(''); setNotice(''); return work;
  }
  function finish(work: RequestWork) {
    if (active.current !== work) return;
    active.current = null; if (mounted.current) { setBusy(false); busyCallback.current?.(false); }
  }
  function invalidateActive() {
    epoch.current++; active.current?.controller.abort(); active.current = null; busyCallback.current?.(false);
    return epoch.current;
  }
  function cancel(showNotice = true) {
    const work = active.current; invalidateActive(); setBusy(false);
    if (work?.kind === 'save' && pendingSave.current) { setUncertain(true); setNotice('저장 응답을 기다리던 작업을 취소했습니다. 같은 미리보기로 저장 상태를 다시 확인해주세요.'); }
    else if (showNotice) setNotice('이미지 작업을 취소했습니다. 원본과 저장된 이미지 역할은 유지됩니다.');
  }
  function discardDraft() { setLoaded(null); setRegions([]); setOptionImageIds([]); setRendered(null); pendingSave.current = null; recoveredScope.current = null; setReadyRetry(false); setUncertain(false); setError(''); }
  function selectSource(key: string, nextRole = role, nextLanguage = language, nextQuotationTarget: FreeImageQuotationRequest | null = liveQuotationTarget.current) {
    if (!focusedTarget(nextQuotationTarget) || !editorCurrent()) return;
    // A transmitted save may finish after cancellation. Keep its exact PNG
    // until the user explicitly discards it or acknowledges the saved result.
    if (pendingSave.current) { cancel(false); setUncertain(true); setNotice('먼저 같은 결과의 저장 상태를 확인하거나 편집 초안을 지운 뒤 다른 원본을 선택해주세요.'); return; }
    if (key === sourceKey && nextRole === role && sameQuotationSlot(nextQuotationTarget, liveQuotationTarget.current)) {
      const sameProof = sameFreeImageQuotationRequest(nextQuotationTarget, liveQuotationTarget.current);
      cancel(false); setLanguage(nextLanguage); setQuotationTarget(nextQuotationTarget);
      if (nextLanguage !== language || !sameProof) setRendered(null);
      setNotice(loaded && loaded.source.productVersion !== version ? '같은 원본의 작성 문구는 유지했습니다. 원본 저장 상태를 다시 확인해주세요.' : '같은 원본의 작성 문구와 선택 영역을 유지했습니다.');
      return;
    }
    if (liveRegions.current.length || liveRendered.current || liveOptionImageIds.current.length) { cancel(false); setNotice('작성한 문구와 옵션 선택을 유지했습니다. 다른 원본이나 역할을 사용하려면 먼저 이미지 번역 편집 초안을 지워주세요.'); return; }
    cancel(false); discardDraft(); setSourceKey(key); setRole(nextRole); setLanguage(nextLanguage); setQuotationTarget(nextQuotationTarget); setNotice('');
  }
  useEffect(() => {
    if (!translationTarget || handledTarget.current === translationTarget.sequence) return;
    const target = translationTarget, scope = invalidateActive(); let alive = true;
    handledTarget.current = target.sequence; pendingTarget.current = { epoch: scope };
    void Promise.resolve().then(() => {
      if (!alive || !mounted.current) return;
      if (epoch.current !== scope) { if (pendingTarget.current?.epoch === scope) pendingTarget.current = null; return; }
      pendingTarget.current = null; setBusy(false);
      if (!imageKeys.includes(target.sourceKey)) {
        if (pendingSave.current) setUncertain(true);
        setError('선택한 원본이 현재 상품 이미지 목록에 없습니다. 저장본을 확인해주세요.'); return;
      }
      selectSource(target.sourceKey, target.role ?? 'detail', target.sourceLanguage ?? 'zh', target.quotationTarget ?? null);
      panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); sourceControl.current?.focus({ preventScroll: true });
    });
    return () => {
      alive = false;
      if (pendingTarget.current?.epoch === scope) { pendingTarget.current = null; if (handledTarget.current === target.sequence) handledTarget.current = null; }
    };
    // A toolbar target selects/scrolls only; OCR and Google need explicit buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translationTarget, imageKeys, selectionKey]);
  useEffect(() => {
    if (!sourceKey || imageKeys.includes(sourceKey)) return;
    if (pendingTarget.current?.epoch === epoch.current) return;
    const scope = invalidateActive(); let alive = true;
    void Promise.resolve().then(() => {
      if (!alive || !mounted.current || epoch.current !== scope) return;
      setBusy(false);
      if (pendingSave.current) { setUncertain(true); setNotice('원본 목록이 변경됐습니다. 응답을 확인하지 못한 결과는 저장 상태 확인만 할 수 있습니다.'); }
      else if (loaded || regions.length) { setRendered(null); setError('선택한 원본이 이미지 목록에서 제거됐습니다. 작성한 문구는 유지했으며 다른 원본을 선택하기 전까지 적용하지 않습니다.'); }
      else { discardDraft(); setSourceKey(''); setError('선택한 원본이 이미지 목록에서 제거됐습니다.'); }
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKeys, sourceKey]);
  const dirty = regions.length > 0 || optionImageIds.length > 0 || rendered !== null || uncertain;
  const locked = busy || uncertain || readyRetry || !focusedTarget();
  const currentImage = loaded && focusedTarget() && loaded.source.productId === productId && loaded.source.productVersion === version && loaded.source.sourceKey === sourceKey && loaded.source.role === role
    && sameFreeImageQuotationRequest(loaded.source.quotationTarget, quotationTarget) && imageKeys.includes(sourceKey) ? loaded : null;
  function editRegion(id: string, patch: Partial<FreeImageRegion>) {
    if (locked || active.current || !focusedTarget() || !editorCurrent()) return; setRendered(null);
    setRegions(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
  }
  async function recognize() {
    if (!sourceKey || !imageKeys.includes(sourceKey) || liveUncertain.current || liveReadyRetry.current || !focusedTarget() || !editorCurrent()) return;
    if (liveRegions.current.length || liveRendered.current || liveOptionImageIds.current.length || pendingSave.current) { setNotice('작성한 문구와 옵션 선택을 유지했습니다. 원본 문구를 다시 읽으려면 먼저 이미지 번역 편집 초안을 지워주세요.'); return; }
    const work = begin('ocr'); if (!work) return;
    discardDraft();
    try {
      const image = await readFreeImageSource(productId, version, sourceKey, role, work.controller.signal, undefined, liveQuotationTarget.current ?? undefined);
      if (!current(work)) return; setLoaded(image);
      setOptionImageIds(focusedOptionId && image.source.optionImages?.optionIds.includes(focusedOptionId) ? [focusedOptionId] : []);
      const rows = await recognizeFreeImage(image, language, work.controller.signal, message => { if (current(work)) setNotice(message); });
      if (!current(work)) return; setRegions(rows); setNotice(`문구 ${rows.length}개를 읽었습니다. 원문·영역을 확인하고 번역할 문구를 선택해주세요.`);
    } catch (cause) { if (current(work)) setError(cause instanceof Error ? cause.message : '문구 인식을 완료하지 못했습니다.'); }
    finally { finish(work); }
  }
  async function refreshSource() {
    if (!loaded || uncertain || pendingSave.current || !focusedTarget() || !imageKeys.includes(sourceKey) || loaded.source.sourceKey !== sourceKey || loaded.source.role !== role) return;
    const previous = loaded, work = begin('refresh'); if (!work) return;
    try {
      const image = await readFreeImageSource(productId, version, sourceKey, role, work.controller.signal, undefined, liveQuotationTarget.current ?? undefined);
      if (!current(work)) return;
      if (image.source.sourceSha256 !== previous.source.sourceSha256 || image.source.sourceKey !== previous.source.sourceKey
        || image.source.role !== previous.source.role || image.width !== previous.width || image.height !== previous.height) {
        throw Error('원본 이미지 파일이나 표시 크기가 변경됐습니다. 작성한 문구는 유지했으며 새 원본에 자동 적용하지 않았습니다. 원본을 비교한 뒤 다시 인식하거나 편집 초안을 지워주세요.');
      }
      setLoaded(image); setRendered(null); setNotice('같은 원본의 최신 저장 상태를 확인했습니다. 작성한 문구와 영역은 유지했으며 새 미리보기에서 다시 검토할 수 있습니다.');
    } catch (cause) { if (current(work)) setError(cause instanceof Error ? cause.message : '원본 저장 상태를 확인하지 못했습니다. 작성한 문구는 유지합니다.'); }
    finally { finish(work); }
  }
  async function translate() {
    if (!currentImage || uncertain || readyRetry || !focusedTarget()) return;
    const selected = regions.filter(row => row.selected && row.translationProvenance !== 'manual');
    if (!selected.length) { setNotice('번역할 문구를 선택해주세요. 직접 수정한 번역 문구와 공란은 유지합니다.'); return; }
    const work = begin('translate'); if (!work) return;
    try {
      const result = await translateFreeImageRegions(currentImage.source, language, selected.map(({ id, text }) => ({ id, text })), work.controller.signal);
      if (!current(work)) return;
      const returned = new Map(result.regions.map(row => [row.id, row])); setRendered(null);
      setRegions(rows => rows.map(row => {
        const translated = returned.get(row.id);
        // A failed explicit retry reports its issue without erasing an earlier
        // result for this same original. Editing the original clears that result.
        return translated && row.text === translated.original && row.translationProvenance !== 'manual'
          ? { ...row, translated: translated.translated ?? row.translated, issue: translated.issue, translationProvenance: translated.translated === null ? row.translationProvenance : 'generated' } : row;
      }));
      setNotice([`${result.regions.filter(row => row.translated !== null).length}개 번역을 받았습니다. 한국어와 적용 영역을 검토해주세요.`, ...result.warnings].join(' '));
    } catch (cause) { if (current(work)) setError(cause instanceof Error ? cause.message : '문구 번역을 완료하지 못했습니다.'); }
    finally { finish(work); }
  }
  async function preview() {
    if (!currentImage || uncertain || readyRetry || !focusedTarget()) return;
    const work = begin('preview'); if (!work) return;
    try {
      const result = await renderFreeImageTranslation(currentImage, liveRegions.current, work.controller.signal, liveOptionImageIds.current);
      if (current(work)) { setRendered(result); setNotice('선택한 영역에만 배경색과 한국어 문구를 적용했습니다. 원본과 비교한 뒤 저장해주세요.'); }
    } catch (cause) { if (current(work)) setError(cause instanceof Error ? cause.message : '번역 이미지 미리보기를 만들지 못했습니다.'); }
    finally { finish(work); }
  }
  async function save(retry = false) {
    const image = retry ? pendingSave.current : rendered;
    if (!image || !focusedTarget() || !editorCurrent() || image.source.productId !== productId || image.source.quotationTarget && retry && (!liveReadyRetry.current || recoveredScope.current !== editorKey)
      || !retry && (pendingSave.current !== null || liveUncertain.current || liveReadyRetry.current)
      || !retry && (image !== liveRendered.current || image.source.productVersion !== version || image.source.sourceKey !== sourceKey || image.source.role !== role
        || !sameFreeImageQuotationRequest(image.source.quotationTarget, liveQuotationTarget.current) || !imageKeys.includes(sourceKey))) return;
    if (beforeApply && !beforeApply()) { setError('다른 단계의 수정값을 먼저 저장하거나 정리한 뒤 이미지 결과를 적용해주세요.'); return; }
    const work = begin('save'); if (!work) return;
    pendingSave.current = image; recoveredScope.current = null;
    try {
      await applyFreeImageTranslation(image, work.controller.signal);
      if (!current(work)) return;
      acknowledgeSave(image);
    } catch (cause) {
      if (!current(work)) return;
      if (cause instanceof FreeImageApplyError && cause.uncertain) { setReadyRetry(false); setUncertain(true); setError(cause.message); }
      else { pendingSave.current = null; setReadyRetry(false); setUncertain(false); setError(cause instanceof Error ? cause.message : '이미지 적용을 완료하지 못했습니다.'); }
    } finally { finish(work); }
  }
  function acknowledgeSave(image: FreeImageRendered) {
    pendingSave.current = null; recoveredScope.current = null; setReadyRetry(false); setUncertain(false); setRegions([]); setOptionImageIds([]); setRendered(null); setLoaded(null);
    const target = image.source.quotationTarget;
    setNotice(target ? `선택 옵션의 ${roleNames[image.source.role]} ${target.slotIndex + 1}에 번역 이미지를 적용했습니다.`
      : `${image.source.optionImages?.commonAssigned === false ? '선택한 개별 옵션의 대표 이미지에 적용했습니다. 공통 대표 이미지는 유지됩니다.' : `번역 이미지를 원본의 같은 위치에 적용했습니다.${image.optionImageIds?.length ? ` 선택한 옵션 ${image.optionImageIds.length}개의 대표 이미지에도 반영했습니다.` : ''}`} 원본 파일은 보관되며 다른 이미지와 견적서 직접 수정값은 유지됩니다.`);
    onProductChanged?.();
  }
  async function recover() {
    const image = pendingSave.current;
    if (!image?.source.quotationTarget || !focusedTarget() || !editorCurrent() || !liveUncertain.current) return;
    const work = begin('recover'); if (!work) return;
    try {
      const reply = await recoverFreeImageTranslation(image, work.controller.signal);
      if (!current(work)) return;
      if (reply.applied) acknowledgeSave(image);
      else { recoveredScope.current = editorKey; setUncertain(false); setReadyRetry(true); setNotice('이 미리보기는 아직 적용되지 않았습니다. 같은 미리보기를 다시 적용할 수 있습니다.'); }
    } catch (cause) { if (current(work)) { setUncertain(true); setReadyRetry(false); setError(cause instanceof Error ? cause.message : '이미지 저장 상태를 확인하지 못했습니다.'); } }
    finally { finish(work); }
  }
  function addRegion() {
    if (!currentImage || locked || active.current || !focusedTarget() || liveRegions.current.length >= MAX_OCR_REGIONS) return;
    setRendered(null);
    const width = Math.max(1, Math.floor(currentImage.width / 2)), height = Math.min(40, currentImage.height);
    setRegions(rows => [...rows, { id: `manual-${++manualId.current}`, text: '', box: { x: 0, y: 0, width, height }, confidence: 0,
      selected: true, translated: '', issue: null, translationProvenance: 'empty', background: '#ffffff', foreground: '#111111', fontSize: Math.max(1, Math.min(20, Math.floor(height * 0.8))) }]);
  }
  return <section ref={panel} className="translation-panel free-image-translation-panel" aria-label="이미지 문구 무료 번역"
    data-free-image-editor="true" data-quotation-source-step={role === 'main' ? '대표 이미지' : role === 'additional' ? '추가 이미지' : '상세 이미지'}
    data-workspace-dirty={dirty ? 'true' : undefined} data-workspace-saving={busy ? 'true' : undefined}>
    <h4>이미지 문구 번역</h4>
    <p>원본의 문구를 읽고 한국어로 수정합니다. 선택한 사각 영역에 배경색과 문구를 덧씌우므로 상품 사진과 배경이 겹치는 영역은 미리보기에서 확인해주세요.</p>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="form-row">
      <label>이미지 역할<select aria-label="번역할 이미지 역할" value={role} disabled={locked || !!quotationTarget} onChange={event => { if (!liveQuotationTarget.current) selectSource(sourceKey, event.target.value as FreeImageRole); }}>
        {FREE_IMAGE_ROLES.map(value => <option key={value} value={value}>{roleNames[value]}</option>)}
      </select></label>
      <label>원본 이미지<select ref={sourceControl} aria-label="번역할 원본 이미지" value={sourceKey} disabled={locked || !!quotationTarget} onChange={event => { if (!liveQuotationTarget.current) selectSource(event.target.value); }}>
        <option value="">원본 선택</option>{sourceKey && !imageKeys.includes(sourceKey) && <option value={sourceKey}>현재 목록에 없는 편집 원본</option>}{imageKeys.map((key, index) => <option key={key} value={key}>이미지 {index + 1} · {key.split('/').at(-1)}</option>)}
      </select></label>
      <label>원문 언어<select aria-label="이미지 원문 언어" value={language} disabled={locked} onChange={event => selectSource(sourceKey, role, event.target.value as 'zh' | 'en')}><option value="zh">중국어</option><option value="en">영어</option></select></label>
    </div>
    <p>{quotationTarget ? `선택 옵션 ${quotationTarget.optionId} · ${roleNames[role]} ${quotationTarget.slotIndex + 1}의 최종 이미지` : '선택한 역할에 저장된 원본을 사용합니다. 다른 단계에서 이미지 역할이나 순서를 수정했다면 먼저 저장해주세요.'}</p>
    <div className="actions">
      <button type="button" className="btn blue" disabled={locked || !sourceKey || !imageKeys.includes(sourceKey) || regions.length > 0 || optionImageIds.length > 0 || rendered !== null} onClick={() => void recognize()}>원본 문구 읽기</button>
      {loaded && <button type="button" className="btn" disabled={locked || !imageKeys.includes(sourceKey)} onClick={() => void refreshSource()}>원본 저장 상태 다시 확인</button>}
      <button type="button" className="btn" disabled={locked || !currentImage || regions.length >= MAX_OCR_REGIONS} onClick={addRegion}>문구 영역 직접 추가</button>
      {busy && <button type="button" className="btn" onClick={() => cancel()}>이미지 작업 취소</button>}
    </div>
    {originalUrl && <div><h5>원본 {loaded?.width}×{loaded?.height}px</h5><img src={originalUrl} alt="문구 번역 원본" style={{ maxWidth: '100%', maxHeight: 420, objectFit: 'contain' }} /></div>}
    {loaded?.source.optionImages && <fieldset disabled={locked} aria-label="번역 대표 이미지의 옵션 적용 범위">
      <legend>옵션 대표 이미지에 함께 적용</legend>
      <p>같은 원본을 개별 대표 이미지로 지정한 옵션만 선택할 수 있습니다. {loaded.source.optionImages.commonAssigned === false ? '이 사진은 개별 옵션에만 지정되어 있어 선택한 옵션에만 적용하며 공통 대표 이미지는 유지됩니다.' : '공통 대표 이미지를 사용하는 옵션도 새 이미지를 사용합니다.'} 선택하지 않은 개별 이미지와 견적서에서 직접 지정한 이미지는 유지됩니다.</p>
      {[...new Set([...loaded.source.optionImages.optionIds, ...optionImageIds])].map(id => {
        const available = loaded.source.optionImages!.optionIds.includes(id);
        return <label key={id}><input type="checkbox" aria-label={`옵션 ${id} 번역 대표 이미지 적용`} checked={optionImageIds.includes(id)}
          onChange={event => { if (locked || active.current) return; setRendered(null); setOptionImageIds(ids => event.target.checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id)); }}
          disabled={!available && !optionImageIds.includes(id)} />옵션 {id}{!available ? ' · 현재 같은 원본 연결에 없음, 선택 해제 필요' : ''}</label>;
      })}
      {!loaded.source.optionImages.optionIds.length && <p>이 원본을 개별 대표 이미지로 지정한 옵션이 없습니다. 공통 대표 이미지와 그 이미지를 사용하는 옵션에 적용합니다.</p>}
      <p>선택 옵션 {optionImageIds.length}개 · 옵션 범위를 바꾸면 미리보기를 다시 만들어주세요.</p>
    </fieldset>}
    {regions.length > 0 && <>
      <p>체크한 문구만 번역·미리보기에 사용합니다. 인식 정확도가 낮은 영역은 기본 선택하지 않습니다. 직접 수정한 번역 문구는 다시 번역해도 유지합니다.</p>
      <div style={{ maxHeight: 480, overflowY: 'auto' }}>{regions.map((region, index) => <fieldset key={region.id} className="translation-field" disabled={locked}>
        <legend><label><input type="checkbox" aria-label={`문구 ${index + 1} 선택`} checked={region.selected} onChange={event => editRegion(region.id, { selected: event.target.checked })} />문구 {index + 1} · 인식 {Math.round(region.confidence)}%</label></legend>
        <label>원문<textarea aria-label={`문구 ${index + 1} 원문`} rows={2} maxLength={5000} value={region.text} onChange={event => editRegion(region.id, { text: event.target.value,
          ...(region.translationProvenance === 'manual' ? { issue: '원문을 수정했습니다. 직접 작성한 번역을 다시 확인해주세요.' } : { translated: '', issue: null, translationProvenance: 'empty' }) })} /></label>
        <label>한국어<textarea aria-label={`문구 ${index + 1} 한국어`} rows={2} maxLength={5000} value={region.translated} onChange={event => editRegion(region.id, { translated: event.target.value, translationProvenance: 'manual', issue: null })} /></label>
        {region.issue && <p className="form-error">{region.issue}</p>}
        <div className="form-row">{(['x', 'y', 'width', 'height'] as const).map(field => <label key={field}>{({ x: '왼쪽', y: '위쪽', width: '영역 가로', height: '영역 세로' })[field]} px<input type="number" aria-label={`문구 ${index + 1} ${field}`} min={field === 'x' || field === 'y' ? 0 : 1} max={field === 'x' || field === 'width' ? loaded?.width : loaded?.height} step={1} value={region.box[field]} onChange={event => editRegion(region.id, { box: { ...region.box, [field]: Number(event.target.value) } })} /></label>)}</div>
        <div className="form-row"><label>배경색<input aria-label={`문구 ${index + 1} 배경색`} type="color" value={region.background} onChange={event => editRegion(region.id, { background: event.target.value })} /></label>
          <label>글자색<input aria-label={`문구 ${index + 1} 글자색`} type="color" value={region.foreground} onChange={event => editRegion(region.id, { foreground: event.target.value })} /></label>
          <label>글자 크기<input aria-label={`문구 ${index + 1} 글자 크기`} type="number" min={1} max={200} step={1} value={region.fontSize} onChange={event => editRegion(region.id, { fontSize: Number(event.target.value) })} /></label></div>
        <button type="button" className="btn" onClick={() => { if (locked || active.current) return; setRendered(null); setRegions(rows => rows.filter(row => row.id !== region.id)); }}>문구 {index + 1} 영역 삭제</button>
      </fieldset>)}</div>
      <div className="actions"><button type="button" className="btn blue" disabled={locked || !currentImage || !regions.some(row => row.selected && row.translationProvenance !== 'manual')} onClick={() => void translate()}>선택 문구 한국어 번역</button>
        <button type="button" className="btn" disabled={locked || !currentImage || !regions.some(row => row.selected) || currentImage.source.optionImages?.commonAssigned === false && !optionImageIds.length} onClick={() => void preview()}>번역 이미지 미리보기</button></div>
    </>}
    {previewUrl && <div><h5>선택 영역 적용 미리보기</h5><img src={previewUrl} alt="한국어 문구 적용 미리보기" style={{ maxWidth: '100%', maxHeight: 480, objectFit: 'contain' }} /></div>}
    {rendered && !uncertain && !readyRetry && <><p>적용 범위: {rendered.source.quotationTarget ? `선택 옵션 ${rendered.source.quotationTarget.optionId} · ${roleNames[rendered.source.role]} ${rendered.source.quotationTarget.slotIndex + 1}` : <>{roleNames[rendered.source.role]}{rendered.source.role === 'main' ? rendered.source.optionImages?.commonAssigned === false ? ' · 공통 대표 이미지 유지' : ' · 공통 대표 이미지 사용 옵션 포함' : ''}{rendered.optionImageIds?.length ? ` + 선택 옵션 ${rendered.optionImageIds.length}개 개별 대표 이미지` : ' · 개별 옵션 이미지 유지'} · 견적서의 직접 수정값은 유지됩니다.</>}</p><button type="button" className="btn green" disabled={busy || !currentImage} onClick={() => void save()}>검토한 번역 이미지 적용</button></>}
    {uncertain && <button type="button" className="btn blue" disabled={busy || !focusedTarget()} onClick={() => { if (pendingSave.current?.source.quotationTarget) void recover(); else void save(true); }}>같은 결과의 저장 상태 다시 확인</button>}
    {readyRetry && <button type="button" className="btn green" disabled={busy || !focusedTarget()} onClick={() => void save(true)}>같은 미리보기 다시 적용</button>}
    {(dirty || loaded) && <button type="button" className="btn" disabled={busy} onClick={() => { cancel(false); discardDraft(); setNotice('편집 초안을 지웠습니다. 서버에 보관된 원본과 이미지 역할은 변경하지 않았습니다.'); }}>이미지 번역 편집 초안 지우기</button>}
    {!imageKeys.length && <p>상품에 저장된 원본 이미지를 먼저 선택해주세요.</p>}
  </section>;
}
