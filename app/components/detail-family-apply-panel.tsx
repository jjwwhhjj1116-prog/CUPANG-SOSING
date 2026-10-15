'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { DetailFamilyCatalog, DetailFamilyPreview } from '@/app/detail-family-apply';
import { commitDetailFamily, createDetailFamilyInput, previewDetailFamily, readDetailFamilyCatalog, recoverDetailFamily,
  restoredDetailFamilyAttempt, type DetailFamilyAttempt, type DetailFamilyInput, type DetailFamilyResult } from '@/app/detail-family-client';

type Props = { productId: string; profileId?: string; version: string; refreshToken?: string; active: boolean; disabled?: boolean;
  beforeOpen?: () => boolean; onSaved?: () => void; onBusyChange?: (busy: boolean) => void };
type Review = { input: DetailFamilyInput; preview: DetailFamilyPreview; attempt: DetailFamilyAttempt; generation?: object };
const imageUrl = (key: string) => `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : '분할 상품 상세 적용 결과를 확인하지 못했습니다.';

/** Only the saved integrated detail is applied; other editors keep their own
 * unsaved work and no same-URL product becomes an inferred target. */
export function DetailFamilyApplyPanel(props: Props) {
  return <DetailFamilyApplyForm key={JSON.stringify([props.productId, props.profileId ?? null])} {...props} />;
}
export function DetailFamilyApplyForm({ productId, profileId, version, refreshToken, active, disabled = false, beforeOpen, onSaved, onBusyChange }: Props) {
  const [catalog, setCatalog] = useState<DetailFamilyCatalog | null>(null), [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [review, setReview] = useState<Review | null>(null), [accepted, setAccepted] = useState(false), [uncertain, setUncertain] = useState(false);
  const [corrupt, setCorrupt] = useState(false), [checkedList, setCheckedList] = useState(false);
  const mounted = useRef(true), root = useRef<HTMLElement>(null), operation = useRef<AbortController | null>(null), pending = useRef<Review | null>(null);
  const sourceKey = JSON.stringify([active, disabled, version, refreshToken]);
  const [clock, setClock] = useState({ key: sourceKey, token: {} });
  if (clock.key !== sourceKey) setClock({ key: sourceKey, token: {} });
  const generation = clock.key === sourceKey ? clock.token : null, epoch = useRef(generation), confirmed = useRef<Review | null>(null);
  const controls = useRef({ active, disabled, version, beforeOpen, onSaved, onBusyChange }), liveReview = useRef(review), opened = useRef(false), sequence = useRef(0);
  const titleId = useId(), storage = `yoofam-detail-family-v1:${productId}:${profileId ?? ''}`;
  useLayoutEffect(() => { controls.current = { active, disabled, version, beforeOpen, onSaved, onBusyChange }; }, [active, disabled, version, beforeOpen, onSaved, onBusyChange]);
  useLayoutEffect(() => { epoch.current = generation; confirmed.current = null; if (!pending.current) operation.current?.abort(); }, [generation]);
  useLayoutEffect(() => { liveReview.current = review; opened.current = open; }, [review, open]);
  const locked = busy || disabled || !active;
  const stale = review !== null && (review.generation !== generation || review.input.catalog.sourceVersion !== version || review.input.catalog.inputFingerprint !== catalog?.inputFingerprint);
  useEffect(() => {
    mounted.current = true; let disposed = false;
    void Promise.resolve().then(() => { if (disposed) return; try {
      const saved = sessionStorage.getItem(storage); if (!saved) return;
      const value = JSON.parse(saved) as Review;
      if (value.input?.productId !== productId || (value.input.profileId ?? '') !== (profileId ?? '')) throw Error('적용할 상품 범위가 다릅니다.');
      value.attempt = restoredDetailFamilyAttempt(value.input, value.preview);
      pending.current = value; liveReview.current = value; opened.current = true;
      setReview(value); setCatalog(value.input.catalog); setSelected(value.input.targetIds); setUncertain(true); setOpen(true);
      setMessage('이전에 요청한 상세 적용 결과를 먼저 확인해주세요. 저장 요청을 반복하지 않습니다.');
    } catch { setError('이전 상세 적용 확인 자료를 읽지 못했습니다. 원본과 대상 상품 목록을 먼저 확인해주세요.'); setCorrupt(true); setUncertain(true); } });
    return () => { disposed = true; mounted.current = false; operation.current?.abort(); controls.current.onBusyChange?.(false); };
  }, [storage, productId, profileId]);
  useEffect(() => { onBusyChange?.(busy || uncertain || active && open); }, [busy, uncertain, active, open, onBusyChange]);
  useEffect(() => {
    if (!open && !uncertain) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [open, uncertain]);
  useLayoutEffect(() => {
    if (!open || !active) return;
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null; root.current?.focus();
    return () => { if (prior?.isConnected) prior.focus(); };
  }, [open, active]);

  async function load() {
    if (!controls.current.active || controls.current.disabled || operation.current || pending.current) return;
    const controller = new AbortController(), generation = ++sequence.current; operation.current = controller; setBusy(true); setError('');
    try {
      const saved = await readDetailFamilyCatalog(productId, profileId, controller.signal);
      if (!mounted.current || controller.signal.aborted || generation !== sequence.current) return;
      if (saved.sourceVersion !== controls.current.version) throw Error('원본 저장 상태가 바뀌었습니다. 상품 목록을 새로 확인한 뒤 다시 열어주세요.');
      confirmed.current = null; setCatalog(saved); setReview(null); setAccepted(false);
      const eligible = saved.targets.filter(target => target.eligible).map(target => target.productId);
      setSelected(previous => opened.current ? previous.filter(id => eligible.includes(id)) : eligible.length <= 19 ? eligible : []);
    } catch (cause) { if (mounted.current && !controller.signal.aborted && generation === sequence.current) setError(errorText(cause)); }
    finally { if (operation.current === controller) { operation.current = null; if (mounted.current) setBusy(false); } }
  }
  useEffect(() => {
    let disposed = false;
    void Promise.resolve().then(() => { if (!disposed && !liveReview.current && !opened.current && !pending.current) void load(); });
    return () => { disposed = true; };
    // Re-reading never discards a pending write or a reviewed selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, profileId, version, refreshToken, active, disabled]);
  const canEnter = () => mounted.current && controls.current.active && !controls.current.disabled && !operation.current;
  function start() {
    if (!canEnter() || uncertain || !catalog?.sourceReady || !catalog.targets.some(target => target.eligible) || catalog.sourceVersion !== controls.current.version) return;
    if (controls.current.beforeOpen && !controls.current.beforeOpen()) { setError('다른 편집기의 미저장 입력을 먼저 저장하거나 취소한 뒤 상세를 적용해주세요.'); return; }
    controls.current.onBusyChange?.(true); opened.current = true; confirmed.current = null; setOpen(true); setReview(null); setAccepted(false); setError(''); setMessage('');
  }
  function close() {
    if (operation.current || uncertain || pending.current?.attempt.pending) return;
    opened.current = false; confirmed.current = null; setOpen(false); setReview(null); setAccepted(false); setError('');
  }
  async function prepare() {
    if (!canEnter() || uncertain || !catalog || !generation || epoch.current !== generation) return;
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError(''); setAccepted(false);
    try {
      const input = createDetailFamilyInput(productId, profileId, catalog, selected);
      const preview = await previewDetailFamily(input, controller.signal);
      if (mounted.current && !controller.signal.aborted && controls.current.active && generation === epoch.current) { confirmed.current = null; setReview({ input, preview, attempt: {}, generation }); }
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(errorText(cause)); }
    finally { if (operation.current === controller) { operation.current = null; if (mounted.current) setBusy(false); } }
  }
  function finish(result: DetailFamilyResult | null) {
    try { sessionStorage.removeItem(storage); } catch { /* Immutable server evidence is still available for read-only recovery. */ }
    pending.current = null; liveReview.current = null; opened.current = false; setUncertain(false); setReview(null); setOpen(false); setAccepted(false);
    setMessage(!result ? '이 요청의 저장 기록이 없습니다. 최신 대상을 다시 확인해주세요.' : result.current
      ? `분할 상품 ${result.receipt.targets.length}개에 상세 적용을 완료했습니다. 대상별 견적을 확인해주세요.`
      : '상세 적용 기록을 확인했습니다. 이후 변경된 값을 보존하고 현재 상품 목록을 다시 확인합니다.');
    controls.current.onSaved?.();
  }
  async function save() {
    if (!canEnter() || uncertain || !review || !accepted || stale || review.generation !== epoch.current || confirmed.current !== review) return;
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError('');
    try {
      sessionStorage.setItem(storage, JSON.stringify({ input: review.input, preview: review.preview }));
      pending.current = review; setUncertain(true);
      const result = await commitDetailFamily(review.input, review.preview, review.attempt, controller.signal);
      if (mounted.current && !controller.signal.aborted && controls.current.active && review.generation === epoch.current) finish(result);
    } catch (cause) { if (mounted.current && !controller.signal.aborted) { setError(errorText(cause)); setUncertain(Boolean(pending.current)); } }
    finally { if (operation.current === controller) { operation.current = null; if (mounted.current) setBusy(false); } }
  }
  async function recover() {
    const value = pending.current; if (!canEnter() || !value) return;
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError('');
    try { const result = await recoverDetailFamily(value.input, value.preview, value.attempt, controller.signal); if (mounted.current && !controller.signal.aborted) finish(result); }
    catch (cause) { if (mounted.current && !controller.signal.aborted) setError(errorText(cause)); }
    finally { if (operation.current === controller) { operation.current = null; if (mounted.current) setBusy(false); } }
  }
  if (!catalog?.familyId && !error && !uncertain) return null;
  return <section className="panel-stack" aria-label="분할 상품 상세 적용" data-quotation-source-step="상세 이미지" data-workspace-dirty={open || uncertain} data-workspace-saving={busy || uncertain}>
    <header><h3>분할 상품에 상세 적용</h3><p>공통·전체 옵션에 저장한 상세 PNG를 선택한 분할 상품의 견적서에 연결합니다.</p></header>
    <p>대상의 상세 HTML은 비우며 이전 값은 적용 기록에 보관합니다. ALT·대표/추가 이미지·표시사항은 유지합니다.</p>
    <p>원본 편집 이력과 번역 그룹을 복사하는 기능은 포함하지 않습니다.</p>
    {catalog && !catalog.sourceReady && <p role="status">{catalog.reason || '원본 상세 이미지를 먼저 공통·전체 옵션에 저장한 뒤 다시 확인해주세요.'}</p>}
    <div className="button-row"><button type="button" className="btn ghost" disabled={locked || open || uncertain} onClick={() => void load()}>분할 대상 다시 확인</button>
      <button type="button" className="btn primary" disabled={locked || uncertain || !catalog?.sourceReady || !catalog.targets.some(target => target.eligible)} onClick={start}>분할 상품에 상세 적용</button></div>
    {message && <p role="status">{message}</p>}{error && !open && <p role="alert">{error}</p>}
    {corrupt && <div><label><input type="checkbox" checked={checkedList} disabled={locked} onChange={event => setCheckedList(event.target.checked)} /> 원본과 대상 상품의 저장 내용을 확인했습니다.</label>
      <button type="button" className="btn ghost" disabled={locked || !checkedList} onClick={() => { try { sessionStorage.removeItem(storage); } catch { /* No request is sent by clearing local confirmation data. */ }
        setCorrupt(false); setUncertain(false); setError(''); setMessage('현재 저장 자료를 다시 확인해주세요. 상세 적용 요청은 보내지 않았습니다.'); controls.current.onSaved?.(); }}>목록 확인 후 이전 확인 자료 정리</button></div>}
    {open && active && <div style={{ position: 'fixed', inset: 0, zIndex: 1250, padding: 20, display: 'grid', placeItems: 'center', background: '#0006' }}>
      <section ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy}
        style={{ width: 'min(900px,100%)', maxHeight: '90vh', overflow: 'auto', background: 'white', borderRadius: 12, padding: 24 }} onKeyDown={event => {
          if (event.key === 'Escape' && !busy && !uncertain) { event.preventDefault(); close(); }
          if (event.key === 'Tab') {
            const controls = Array.from(root.current?.querySelectorAll<HTMLElement>('input,button,select,[tabindex]') ?? []).filter(control => !control.hasAttribute('disabled') && control.tabIndex >= 0);
            const first = controls[0], last = controls.at(-1);
            if (!first) { event.preventDefault(); root.current?.focus(); }
            else if (event.shiftKey && (!controls.includes(document.activeElement as HTMLElement) || document.activeElement === first)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && (!controls.includes(document.activeElement as HTMLElement) || document.activeElement === last)) { event.preventDefault(); first.focus(); }
          }
        }}>
        <h3 id={titleId} style={{ marginTop: 0 }}>분할 상품 상세 적용</h3><p>{catalog?.company.name} · {catalog?.company.code}</p>
        {catalog?.image && <figure>{/* eslint-disable-next-line @next/next/no-img-element -- The existing authenticated image endpoint serves this owned saved PNG. */}
          <img src={imageUrl(catalog.image.key)} alt="공통·전체 옵션에 저장된 상세 PNG" style={{ maxWidth: '100%', maxHeight: 230, objectFit: 'contain' }} /><figcaption>{catalog.image.width} × {catalog.image.height}px · 저장된 상세 이미지</figcaption></figure>}
        {!uncertain && <><p>적용할 상품을 선택하세요. 대상의 모든 옵션(견적 제외 포함)의 상세 이미지와 HTML이 바뀝니다. 전송 이력이 있는 상품은 현재 적용 대상에서 제외됩니다.</p>
          <div style={{ maxHeight: 280, overflow: 'auto' }}>{catalog?.targets.map(target => <label key={target.productId} style={{ display: 'block', padding: 8 }}>
            <input type="checkbox" aria-label={`${target.title} 상세 적용 대상`} checked={selected.includes(target.productId)} disabled={locked || !target.eligible}
              onChange={event => { setSelected(previous => event.target.checked ? [...previous, target.productId] : previous.filter(id => id !== target.productId)); confirmed.current = null; setReview(null); setAccepted(false); setError(''); }} />
            {target.registrationNumber ?? '이전 상품'} · {target.title} · 옵션 {target.optionCount}개{!target.eligible && ` · ${target.reason ?? '적용 불가'}`}</label>)}</div>
          <p>선택 {selected.length}개 / 한 번에 최대 19개</p><button type="button" className="btn ghost" disabled={locked || !selected.length || selected.length > 19} onClick={() => void prepare()}>상세 적용 미리보기</button></>}
        {review && <div aria-label="분할 상품 상세 적용 미리보기"><h4>확인한 적용 대상</h4>{review.preview.targets.map(target => <p key={target.productId}><strong>{target.registrationNumber ?? '이전 상품'} · {target.title}</strong><br />공통 + 옵션 {target.optionIds.length}개 · 상세 PNG 연결 · 상세 HTML 비우기</p>)}
          {stale && !uncertain && <p role="alert">원본 저장값이 바뀌었습니다. 대상을 다시 확인하고 미리보기를 새로 만들어주세요.</p>}
          {!uncertain && <label style={{ display: 'block', margin: '16px 0' }}><input type="checkbox" checked={accepted && !stale} disabled={locked || stale} onChange={event => {
            if (liveReview.current !== review || review.generation !== epoch.current) return; confirmed.current = event.target.checked ? review : null; setAccepted(event.target.checked);
          }} /> 적용 대상과 상세 HTML을 비우는 범위를 확인했습니다.</label>}
        </div>}
        {error && <p role="alert" className="collection-error">{error}</p>}{uncertain && <p role="status">상세 적용 결과를 확인합니다. 같은 저장 요청을 다시 보내지 않습니다.</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" className="btn ghost" disabled={busy || uncertain} onClick={close}>취소</button>
          {!uncertain && <button type="button" className="btn ghost" disabled={locked} onClick={() => void load()}>대상 저장본 다시 확인</button>}
          {uncertain ? <button type="button" className="btn primary" disabled={locked || !review} onClick={() => void recover()}>상세 적용 결과 확인</button>
            : <button type="button" className="btn primary" disabled={locked || !review || !accepted || stale} onClick={() => void save()}>확인한 상품에 상세 적용</button>}
        </div>
      </section>
    </div>}
  </section>;
}
