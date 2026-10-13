'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { applyDetailComposite, prepareDetailComposite, recoverDetailComposite, type DetailComposite, type DetailCompositeAttempt } from '@/app/detail-image-composite';

type Props = { productId: string; optionId: string; profileId?: string; view: QuotationFieldsView; disabled?: boolean;
  beforeApply?: () => boolean; onSaved?: (view: QuotationFieldsView) => void; onBusyChange?: (busy: boolean) => void };
export function DetailImageCompositePanel({ productId, optionId, profileId, view, disabled = false, beforeApply, onSaved, onBusyChange }: Props) {
  const identity = JSON.stringify([productId, optionId, profileId ?? null]), current = useRef({ identity, view, disabled, beforeApply, onSaved, onBusyChange });
  const active = useRef(true), request = useRef<AbortController | null>(null), attempt = useRef<DetailCompositeAttempt>({});
  const resultRef = useRef<DetailComposite | null>(null), [result, setResult] = useState<DetailComposite | null>(null), [url, setUrl] = useState<{ output: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [done, setDone] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  useLayoutEffect(() => { current.current = { identity, view, disabled, beforeApply, onSaved, onBusyChange }; }, [identity, view, disabled, beforeApply, onSaved, onBusyChange]);
  useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort(); current.current.onBusyChange?.(false); }; }, []);
  useEffect(() => {
    if (!result) return; let live = true; const objectUrl = URL.createObjectURL(result.output);
    void Promise.resolve().then(() => { if (live) setUrl({ output: result.output, url: objectUrl }); });
    return () => { live = false; URL.revokeObjectURL(objectUrl); };
  }, [result]);
  const valid = () => active.current && current.current.identity === identity && !current.current.disabled && current.current.beforeApply?.() !== false;
  function start() {
    if (request.current || !valid()) return null;
    const controller = new AbortController(); request.current = controller; current.current.onBusyChange?.(true); setBusy(true); setError(''); setMessage(''); return controller;
  }
  function finish(controller: AbortController) {
    if (request.current !== controller) return; request.current = null;
    if (active.current && current.current.identity === identity) { setBusy(false); setPending(!!attempt.current.pending); current.current.onBusyChange?.(!!attempt.current.pending); }
  }
  async function prepare() {
    if (attempt.current.pending) return; const controller = start(); if (!controller) return;
    try {
      const prepared = await prepareDetailComposite({ productId, optionId, profileId, view: current.current.view }, controller.signal);
      if (!valid() || controller.signal.aborted || current.current.view !== prepared.view) return;
      attempt.current = {}; resultRef.current = prepared; setResult(prepared); setDone(false); setMessage('합친 이미지를 확인한 뒤 선택 옵션에 적용해주세요.');
    } catch (cause) { if (active.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '상세 이미지 합치기 실패'); }
    finally { finish(controller); }
  }
  async function apply() {
    const prepared = resultRef.current; if (!prepared || attempt.current.completed || JSON.stringify([prepared.productId, prepared.optionId, prepared.profileId ?? null]) !== identity) return;
    const controller = start(); if (!controller) return;
    try {
      const confirmed = attempt.current.pending ? await recoverDetailComposite(prepared, attempt.current, controller.signal) : await applyDetailComposite(prepared, attempt.current, controller.signal);
      if (!active.current || current.current.identity !== identity || controller.signal.aborted) return;
      if (confirmed === 'ready') { setMessage('현재 저장 결과를 확인했습니다. 적용 버튼을 눌러 이어서 저장해주세요.'); return; }
      const saved = confirmed === 'completed' ? attempt.current.completed! : confirmed;
      setDone(true); setMessage('합친 상세 이미지를 선택 옵션 견적서에 저장했습니다.'); current.current.onSaved?.(saved);
    } catch (cause) { if (active.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '상세 이미지 적용 실패'); }
    finally { finish(controller); }
  }
  return <section className="panel-stack" aria-label="상세 이미지 합치기" data-workspace-saving={busy}>
    <button type="button" className="btn ghost" disabled={disabled || busy || pending} onClick={() => void prepare()}>상세 이미지 합치기</button>
    <small>저장한 상단·본문·하단 사진을 현재 순서대로 한 장으로 만듭니다. 원본 사진과 직접 작성한 HTML은 유지합니다. 수동 HTML이 있으면 견적서의 HTML 항목도 그대로 전송됩니다.</small>
    {busy && <p role="status">상세 이미지 처리 중…</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {result && <><p>{result.keys.length}개 → 한 장 · {result.width} × {result.height}px</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url?.output === result.output && <img className="image-large-preview" src={url.url} alt="합친 상세 이미지 미리보기" />}
      <button type="button" className="btn primary" disabled={disabled || busy || done} onClick={() => void apply()}>{pending ? '상세 이미지 저장 결과 확인' : '합친 이미지 선택 옵션에 적용'}</button>
      <button type="button" className="btn ghost" disabled={busy} onClick={() => { if (request.current) return; attempt.current = {}; resultRef.current = null; setResult(null); setPending(false); setDone(false); current.current.onBusyChange?.(false); setError(''); setMessage('원본과 저장한 파일은 유지했습니다. 현재 선택을 다시 확인해주세요.'); }}>미리보기 닫기</button>
    </>}
  </section>;
}
