'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DetailWorkspaceView } from '@/app/detail-workspace';
import type { DetailWorkspaceSelection } from '@/app/detail-workspace-client';
import type { DetailWorkspaceBannerRebasePreview } from '@/app/detail-workspace-banner-rebase';
import { applyDetailWorkspaceBannerRebase, readDetailWorkspaceBannerRebase, readLatestDetailWorkspaceBannerRebase, recoverDetailWorkspaceBannerRebase,
  type DetailWorkspaceBannerRebaseAttempt } from '@/app/detail-workspace-banner-rebase-client';

type Props = { selection: DetailWorkspaceSelection; disabled?: boolean; stageActive?: boolean; beforeApply?: () => boolean;
  onSaved?: (reply: DetailWorkspaceView) => void; onLatestRead?: (preview: DetailWorkspaceBannerRebasePreview) => void; onBusyChange?: (busy: boolean) => void };
type Review = { preview: DetailWorkspaceBannerRebasePreview; token: object };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const issue = (cause: unknown) => cause instanceof Error ? cause.message : '현재 배너 설정의 상세 구성을 확인하지 못했습니다.';
const imageUrl = (key: string) => `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
const roleKeys = (preview: DetailWorkspaceBannerRebasePreview, role: 'top' | 'bottom') => preview.workspace.document.photos.filter(photo => photo.role === role).map(photo => photo.key);
const changed = (preview: DetailWorkspaceBannerRebasePreview) => !same(roleKeys(preview, 'top'), preview.roles.top) || !same(roleKeys(preview, 'bottom'), preview.roles.bottom);

/** Explicitly replaces protected banners in the independent workspace only. */
export function DetailWorkspaceRebasePanel({ selection, disabled = false, stageActive = true, beforeApply, onSaved, onLatestRead, onBusyChange }: Props) {
  const identity = JSON.stringify([selection.productId, selection.optionId, selection.profileId ?? null]);
  const source = JSON.stringify([identity, selection.view, disabled, stageActive]);
  const [clock, setClock] = useState({ source, token: {} }); if (clock.source !== source) setClock({ source, token: {} });
  const generation = clock.source === source ? clock.token : null, epoch = useRef(generation), mounted = useRef(true);
  const controls = useRef({ identity, selection, disabled, stageActive, beforeApply, onSaved, onLatestRead, onBusyChange });
  const operation = useRef<AbortController | null>(null), applying = useRef(false), attempt = useRef<DetailWorkspaceBannerRebaseAttempt>({});
  const selected = useRef<DetailWorkspaceBannerRebasePreview | null>(null), preparedAt = useRef<object | null>(null), confirmation = useRef<Review | null>(null), delivered = useRef(false);
  const [preview, setPreview] = useState<DetailWorkspaceBannerRebasePreview | null>(null), [review, setReview] = useState<Review | null>(null), [preparedToken, setPreparedToken] = useState<object | null>(null);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [done, setDone] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useLayoutEffect(() => { controls.current = { identity, selection, disabled, stageActive, beforeApply, onSaved, onLatestRead, onBusyChange }; }, [identity, selection, disabled, stageActive, beforeApply, onSaved, onLatestRead, onBusyChange]);
  useLayoutEffect(() => { epoch.current = generation; confirmation.current = null; if (!applying.current) operation.current?.abort(); }, [generation]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (!applying.current) operation.current?.abort(); controls.current.onBusyChange?.(false); }; }, []);
  const waiting = () => !!attempt.current.pending || !!attempt.current.completed && !delivered.current;
  function valid(token: object | null, write = false) {
    const value = controls.current;
    return mounted.current && !!token && token === epoch.current && value.identity === identity && !value.disabled && value.stageActive && (!write || value.beforeApply?.() !== false);
  }
  function begin(token: object | null, write = false) {
    if (operation.current || !valid(token, write)) return null;
    const controller = new AbortController(); operation.current = controller; applying.current = write; setBusy(true); setError(''); setMessage(''); controls.current.onBusyChange?.(true); return controller;
  }
  function finish(controller: AbortController) {
    if (operation.current !== controller) return; operation.current = null; applying.current = false;
    if (mounted.current) { const locked = waiting(); setBusy(false); setPending(locked); controls.current.onBusyChange?.(locked); }
  }
  const currentPreview = !!preview && preparedToken === generation && !disabled && stageActive && same(preview.view, selection.view);
  const reviewed = !!preview && review?.preview === preview && review.token === generation;
  function preparedCurrent(value: DetailWorkspaceBannerRebasePreview, token = generation) {
    return valid(token, true) && preparedAt.current === token && selected.current === value && changed(value) && same(value.view, controls.current.selection.view);
  }
  async function prepare() {
    if (waiting()) return; const token = generation, controller = begin(token); if (!controller) return;
    confirmation.current = null; setReview(null);
    try {
      const value = await readDetailWorkspaceBannerRebase(selection, controller.signal);
      if (!valid(token) || controller.signal.aborted || !same(value.view, controls.current.selection.view)) return;
      selected.current = value; preparedAt.current = token; setPreparedToken(token); attempt.current = {}; delivered.current = false; setPreview(value); setDone(false); setPending(false);
      setMessage(changed(value) ? '현재 배너 설정으로 바꿀 부분을 확인해주세요. 아직 편집 구성을 보관하지 않았습니다.' : '보관 구성의 상단·하단 배너가 현재 설정과 같습니다. 변경할 배너가 없습니다.');
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  async function save() {
    const value = selected.current, token = generation;
    if (!value || waiting() || delivered.current || !preparedCurrent(value) || confirmation.current?.preview !== value || confirmation.current.token !== token) return;
    const controller = begin(token, true); if (!controller) return;
    try {
      const reply = await applyDetailWorkspaceBannerRebase(selection, value, attempt.current, controller.signal);
      if (!valid(token) || controller.signal.aborted) return;
      delivered.current = true; confirmation.current = null; setReview(null); setDone(true); setMessage('상단·하단 배너를 현재 설정으로 보관했습니다. 본문 사진과 간격, 상품·견적서는 유지했습니다.'); controls.current.onSaved?.(reply);
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  async function recover() {
    const value = selected.current, token = generation; if (!value || !waiting()) return; const controller = begin(token); if (!controller) return;
    try {
      const status = await recoverDetailWorkspaceBannerRebase({ ...selection, view: value.view }, value, attempt.current, controller.signal);
      if (!valid(token) || controller.signal.aborted) return;
      confirmation.current = null; setReview(null);
      if (status === 'ready') { setMessage('아직 배너 변경이 보관되지 않았습니다. 현재 기준과 변경 내용을 다시 확인한 뒤 명시적으로 보관해주세요.'); return; }
      if (!attempt.current.completed) throw Error('배너 변경 보관 결과를 확인하지 못했습니다.');
      delivered.current = true; setDone(true); setMessage('배너 변경 결과를 조회로 확인했습니다. 보관 요청은 반복하지 않았습니다.'); controls.current.onSaved?.(attempt.current.completed);
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  async function latest() {
    const token = generation, controller = begin(token); if (!controller) return;
    try {
      const value = await readLatestDetailWorkspaceBannerRebase(controls.current.selection, attempt.current, controller.signal);
      if (!valid(token) || controller.signal.aborted) return;
      selected.current = null; preparedAt.current = null; confirmation.current = null; attempt.current = {}; delivered.current = false;
      setPreview(null); setPreparedToken(null); setReview(null); setPending(false); setDone(false);
      setMessage('최신 배너 기준을 조회했습니다. 이전 보관 요청의 성공 여부는 단정하지 않았습니다. 최신 상품 기준으로 변경 내용을 다시 확인해주세요.'); controls.current.onLatestRead?.(value);
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(issue(cause)); }
    finally { finish(controller); }
  }
  function pictures(title: string, keys: readonly string[]) { return <div><strong>{title}</strong>{keys.length ? keys.map((key, index) => <figure key={`${index}:${key}`}>
    {/* eslint-disable-next-line @next/next/no-img-element -- Existing authenticated owned-image route. */}
    <img src={imageUrl(key)} alt={`${title} ${index + 1}`} style={{ maxWidth: '100%', maxHeight: 140, objectFit: 'contain' }} /><figcaption>{key}</figcaption>
  </figure>) : <p>없음</p>}</div>; }
  return <section className="panel-stack" aria-label="현재 배너 설정 적용" aria-busy={busy} data-workspace-saving={busy || pending}>
    <h4>상단·하단 배너 설정 변경</h4><p>본문 사진의 순서·편집 결과·원본 연결과 사진 간격을 유지하고 현재 배너 설정만 편집 구성에 반영합니다. 상품 이미지·견적서·최종 PNG는 바꾸지 않습니다.</p>
    <button type="button" className="btn ghost" disabled={busy || pending || disabled || !stageActive} onClick={() => void prepare()}>현재 배너로 변경 내용 확인</button>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {preview && <><div className="panel-grid">{pictures('이전 상단 배너', roleKeys(preview, 'top'))}{pictures('현재 상단 배너', preview.roles.top)}{pictures('이전 하단 배너', roleKeys(preview, 'bottom'))}{pictures('현재 하단 배너', preview.roles.bottom)}</div>
      <p>본문 사진 {preview.workspace.document.photos.filter(photo => photo.role === 'body').length}장과 사진 간격 {preview.workspace.document.imageMargin}px를 유지합니다.</p>
      {!currentPreview && !pending && !done && <p role="status">상품이나 화면 기준이 바뀌었습니다. 이전 확인 내용을 보관한 채 최신 배너 기준을 다시 조회해주세요.</p>}
      <label><input type="checkbox" aria-label="배너 변경 보관 확인" checked={reviewed} disabled={!currentPreview || !changed(preview) || busy || pending || done} onChange={event => {
        if (!preview || !generation || !preparedCurrent(preview) || operation.current || waiting() || delivered.current) return;
        const next = event.target.checked ? { preview, token: generation } : null; confirmation.current = next; setReview(next);
      }} />이전·현재 상단·하단 배너와 본문 사진·간격 유지 범위를 확인했습니다.</label>
      <button type="button" className="btn primary" disabled={!currentPreview || !changed(preview) || !reviewed || busy || pending || done} onClick={() => void save()}>현재 배너로 편집 구성 보관</button>
      {pending && <button type="button" className="btn ghost" disabled={busy || disabled || !stageActive} onClick={() => void recover()}>배너 변경 보관 결과 확인</button>}
      <button type="button" className="btn ghost" disabled={busy || pending || disabled || !stageActive} onClick={() => {
        if (operation.current || waiting()) return; selected.current = null; preparedAt.current = null; confirmation.current = null; attempt.current = {}; delivered.current = false;
        setPreview(null); setPreparedToken(null); setReview(null); setDone(false); setError(''); setMessage('변경 내용 확인을 닫았습니다. 보관 구성과 상품·견적서는 유지됩니다.');
      }}>배너 변경 확인 닫기</button></>}
    {(pending || !!error || preview && !currentPreview && !done) && <button type="button" className="btn ghost" disabled={busy || disabled || !stageActive} onClick={() => void latest()}>최신 배너 기준 다시 조회</button>}
  </section>;
}
