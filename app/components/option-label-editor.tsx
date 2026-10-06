'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { optionLabelChanges, optionLabelDraftIssues, optionLabelFields, optionLabelPreviewSignature, optionLabelValue, verifyOptionLabelAttachment, verifyOptionLabelRefresh, verifyOptionLabelSave, verifyOptionLabelView, type OptionLabelDraft } from '@/app/option-label-fields';
import { quotationLabelPlan } from '@/app/quotation-label-plan';
import { renderDocument } from '@/app/document-image-render';
import { attachQuotationLabel, type QuotationLabelUploadCache } from '@/app/quotation-label-attachment';

type Props = { productId: string; optionId: string; version: string; profileId?: string; refreshToken?: string; onSaved?: () => void; onCommonLabels?: () => void };
type Preview = { scope: string; sourceKey: string; signature: string; view: QuotationFieldsView; url: string; rendered: { blob: Blob; width: number; height: number } };

export function OptionLabelEditor({ productId, optionId, version, profileId, refreshToken, onSaved, onCommonLabels }: Props) {
  const endpoint = `/api/products/${encodeURIComponent(productId)}/quotation-fields${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`;
  const scope = JSON.stringify([endpoint, optionId]), sourceKey = JSON.stringify([scope, version, refreshToken]);
  const currentScope = useRef(scope), currentSource = useRef(sourceKey), mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const [saved, setSaved] = useState<{ scope: string; sourceKey: string; view: QuotationFieldsView } | null>(null);
  const [pending, setPending] = useState<{ scope: string; values: OptionLabelDraft }>({ scope, values: {} });
  const latestSaved = useRef<typeof saved>(null), latestDraft = useRef({ scope, values: {} as OptionLabelDraft });
  const [preview, setPreview] = useState<Preview | null>(null);
  const latestPreview = useRef<Preview | null>(null), uploads = useRef(new Map<string, QuotationLabelUploadCache>());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const current = () => mounted.current && currentScope.current === scope && currentSource.current === sourceKey;
  useLayoutEffect(() => {
    mounted.current = true; currentScope.current = scope; currentSource.current = sourceKey;
    if (latestDraft.current.scope !== scope) latestDraft.current = { scope, values: {} };
    return () => { request.current?.abort(); request.current = null; mounted.current = false; };
  }, [scope, sourceKey]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const view = saved?.scope === scope ? saved.view : null, draft = pending.scope === scope ? pending.values : {};
  const dirty = Object.keys(draft).length > 0, fresh = saved?.sourceKey === sourceKey;
  const reviewed = preview?.scope === scope && preview.sourceKey === sourceKey && !dirty && fresh ? preview : null;
  function clearPreview() { latestPreview.current = null; setPreview(null); }
  function storeView(body: QuotationFieldsView) { latestSaved.current = { scope, sourceKey, view: body }; setSaved(latestSaved.current); }
  function clearDraft() { latestDraft.current = { scope, values: {} }; setPending(latestDraft.current); }
  function finish(controller: AbortController) {
    if (request.current === controller) { request.current = null; if (!controller.signal.aborted && current()) setBusy(false); }
  }
  async function load(keepDraft = false) {
    if (request.current || !current()) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); clearPreview();
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal }), body = await response.json() as QuotationFieldsView & { error?: string };
      if (controller.signal.aborted || !current()) return;
      if (!response.ok) throw Error(body.error || '옵션 상품고시를 불러오지 못했습니다.');
      verifyOptionLabelView(body, optionId, profileId);
      const editing = latestDraft.current.scope === scope ? latestDraft.current.values : {};
      let recovered = false;
      if (keepDraft) {
        const before = latestSaved.current?.scope === scope ? latestSaved.current.view : null;
        if (!before) throw Error('이전 상품고시 입력 기준을 확인하지 못했습니다.');
        verifyOptionLabelRefresh(before, body, optionId, editing);
        if (Object.keys(editing).length) { try { verifyOptionLabelSave(before, body, optionId, editing); recovered = true; } catch { /* A disjoint update can be reviewed without discarding the draft. */ } }
      } else if (body.productVersion !== version) throw Error('상품 저장 상태가 변경됐습니다. 상품을 다시 열어 최신 상품고시를 확인해주세요.');
      storeView(body);
      if (!keepDraft || recovered) clearDraft();
      setMessage(recovered ? '저장된 선택 옵션 상품고시를 확인했습니다.' : keepDraft ? '입력을 유지하고 최신 자료를 읽었습니다. 확인 후 선택 옵션 상품고시를 저장해주세요.' : '');
      if (recovered) onSaved?.();
    } catch (cause) { if (!controller.signal.aborted && current()) setError(cause instanceof Error ? cause.message : '옵션 상품고시 조회 실패'); }
    finally { finish(controller); }
  }
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active || !current()) return;
      setBusy(false); setError(''); clearPreview();
      if (latestDraft.current.scope === scope && Object.keys(latestDraft.current.values).length && latestSaved.current?.scope === scope) return;
      void load();
    });
    return () => { active = false; request.current?.abort(); request.current = null; };
    // Parent source changes invalidate the preview, while edits await explicit
    // refresh/save/discard instead of disappearing on a workspace refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, sourceKey]);
  function edit(fieldId: string, value: string | null) {
    if (!view || request.current || !current() || !optionLabelFields(view).some(field => field.id === fieldId && !field.readOnly)) return;
    latestDraft.current = { scope, values: { ...(latestDraft.current.scope === scope ? latestDraft.current.values : {}), [fieldId]: value } };
    setPending(latestDraft.current); clearPreview(); setMessage('');
  }
  let fields: ReturnType<typeof optionLabelFields> = [], issues: string[] = [], bindingError = '';
  if (view) { try { fields = optionLabelFields(view); issues = optionLabelDraftIssues(view, optionId, draft); } catch (cause) { bindingError = cause instanceof Error ? cause.message : '상품고시 연결 확인 필요'; } }
  async function save() {
    const base = latestSaved.current, editing = latestDraft.current.scope === scope ? latestDraft.current.values : {};
    if (!base || base.scope !== scope || !Object.keys(editing).length || request.current || !current()) return;
    if (base.sourceKey !== sourceKey) { setError('상품 저장 상태가 변경됐습니다. 입력을 유지하고 최신 상품고시를 조회한 뒤 저장해주세요.'); return; }
    let changes; try { changes = optionLabelChanges(base.view, optionId, editing); } catch (cause) { setError(cause instanceof Error ? cause.message : '상품고시 입력을 확인해주세요.'); return; }
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setMessage(''); clearPreview();
    try {
      const response = await fetch(endpoint, { method: 'PUT', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: base.view.revision, expectedInputFingerprint: base.view.inputFingerprint, changes }) });
      const body = await response.json() as QuotationFieldsView & { error?: string };
      if (controller.signal.aborted || !current()) return;
      if (!response.ok) throw Error(body.error || '상품고시를 저장하지 못했습니다. 입력은 유지됩니다.');
      verifyOptionLabelView(body, optionId, profileId); verifyOptionLabelSave(base.view, body, optionId, editing);
      storeView(body); clearDraft(); setMessage('선택 옵션 상품고시 저장 완료 · 해당 옵션 견적서와 라벨에 반영됩니다.'); onSaved?.();
    } catch (cause) { if (!controller.signal.aborted && current()) setError(cause instanceof Error ? cause.message : '상품고시 저장 실패'); }
    finally { finish(controller); }
  }
  async function generate() {
    const base = latestSaved.current;
    if (!base || base.scope !== scope || base.sourceKey !== sourceKey || request.current || !current()
      || latestDraft.current.scope === scope && Object.keys(latestDraft.current.values).length) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setMessage(''); clearPreview();
    try {
      const signature = optionLabelPreviewSignature(productId, endpoint, base.view, optionId);
      let cache = uploads.current.get(signature);
      if (!cache) {
        cache = { signature, uploadedKey: null, rendered: null }; uploads.current.set(signature, cache);
        // Older renders can be regenerated; uploaded files have durable lookup
        // identities, so an editing session need not retain every PNG in memory.
        while (uploads.current.size > 8) uploads.current.delete(uploads.current.keys().next().value!);
      }
      const rendered = cache.rendered ?? await renderDocument(quotationLabelPlan(base.view.resolved, optionId));
      if (controller.signal.aborted || !current()) return;
      cache.rendered = rendered;
      const next = { scope, sourceKey, signature, view: base.view, rendered, url: URL.createObjectURL(rendered.blob) };
      latestPreview.current = next; setPreview(next);
    } catch (cause) { if (!controller.signal.aborted && current()) setError(cause instanceof Error ? cause.message : '상품고시 PNG 생성 실패'); }
    finally { finish(controller); }
  }
  async function attach() {
    const chosen = latestPreview.current;
    if (!chosen || chosen.scope !== scope || chosen.sourceKey !== sourceKey || request.current || !current()
      || latestDraft.current.scope === scope && Object.keys(latestDraft.current.values).length) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setMessage('');
    const cache = uploads.current.get(chosen.signature)!;
    try {
      const scopedFetch: typeof fetch = async (url, init) => {
        if (controller.signal.aborted || !current()) throw Error('선택 옵션 또는 상품 저장 상태가 변경되었습니다.');
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (controller.signal.aborted || !current()) throw Error('선택 옵션 또는 상품 저장 상태가 변경되었습니다.');
        return response;
      };
      const body = await attachQuotationLabel({ productId, endpoint, renderedView: chosen.view, optionId, blob: chosen.rendered.blob, uploadedKey: cache.uploadedKey, onUploaded: key => { cache.uploadedKey = key; } }, scopedFetch);
      if (controller.signal.aborted || !current()) return;
      verifyOptionLabelView(body, optionId, profileId); verifyOptionLabelAttachment(chosen.view, body, optionId, cache.uploadedKey);
      storeView(body); clearPreview(); setMessage('상품고시 PNG를 선택 옵션 견적에 연결했습니다.'); onSaved?.();
    } catch (cause) {
      if (!controller.signal.aborted && current()) setError(`${cause instanceof Error ? cause.message : '선택 옵션 라벨 연결 실패'}${cache.uploadedKey ? ' 업로드한 파일은 보존됩니다. 같은 미리보기로 다시 연결하면 기존 파일을 확인해 사용합니다.' : ''}`);
    } finally { finish(controller); }
  }
  const row = view?.resolved.rows.find(row => row.optionId === optionId);
  return <section className="panel-stack" aria-label="선택 옵션 상품고시 정보" data-quotation-source-step="견적서" data-workspace-dirty={dirty} data-workspace-saving={busy}>
    <h3>선택 옵션 상품고시 정보</h3><p>{row?.optionLabel || optionId} · {row?.included === false ? '견적 제외 옵션' : '선택한 옵션'}</p>
    <p>선택한 카테고리의 상품고시를 이 옵션에만 저장합니다. 다른 옵션과 상품 공통 상품고시는 유지됩니다.</p>
    {onCommonLabels && <button type="button" className="btn ghost" disabled={busy} onClick={onCommonLabels}>상품 공통 상품고시 편집</button>}
    {busy && <p role="status">옵션 상품고시 처리 중…</p>}{error && <p role="alert">{error}</p>}{bindingError && <p role="alert">{bindingError}</p>}{message && <p role="status">{message}</p>}
    {dirty && !fresh && <p role="status">상품 저장 상태가 변경됐습니다. 입력은 유지했습니다. 최신 자료를 조회한 뒤 저장해주세요.</p>}
    {view && !fields.length && !bindingError && <p>선택한 카테고리의 세부 상품고시 항목이 없습니다. 견적서 상세 항목에서 원본 양식을 확인해주세요.</p>}
    {fields.map(field => {
      const value = optionLabelValue(view!, optionId, field.id, draft), disabled = busy || !!bindingError || field.readOnly;
      return <label className="field" key={field.id}><span>{field.label}</span>
        {field.type === 'select' ? <select aria-label={`선택 옵션 ${field.label}`} value={value} disabled={disabled} onChange={event => edit(field.id, event.target.value)}>
          {!(field.choices ?? []).some(choice => choice.value === '') && <option value="">미입력</option>}
          {value && !(field.choices ?? []).some(choice => choice.value === value) && <option value={value}>{value} · 목록 외 저장값</option>}
          {(field.choices ?? []).map((choice, index) => <option key={index} value={choice.value}>{choice.label}</option>)}
        </select> : <textarea aria-label={`선택 옵션 ${field.label}`} value={value} disabled={disabled} onChange={event => edit(field.id, event.target.value)} />}
        <button type="button" className="btn ghost" disabled={disabled} onClick={() => edit(field.id, null)}>{field.label} 공통·자동값 복원</button>
      </label>;
    })}
    <small>공란도 직접 수정값으로 저장합니다. 복원을 누르면 해당 옵션 수정값만 해제하고 공통·자동값을 사용합니다.</small>
    {!!issues.length && <p role="alert">{[...new Set(issues)].join(' ')}</p>}
    <button type="button" className="btn primary" disabled={!view || busy || !dirty || !!bindingError || !!issues.length} onClick={() => void save()}>선택 옵션 상품고시 저장</button>
    {dirty && <button type="button" className="btn ghost" disabled={busy} onClick={() => void load(true)}>입력 유지·최신 상품고시 조회</button>}
    <button type="button" className="btn ghost" disabled={busy} onClick={() => void load()}>{dirty ? '입력 취소·저장 상품고시 다시 조회' : '저장 상품고시 다시 조회'}</button>
    <button type="button" className="btn ghost" disabled={!view || busy || dirty || !fresh || !!bindingError || row?.included !== true} onClick={() => void generate()}>선택 옵션 상품고시 PNG 미리보기</button>
    {reviewed && <>
      <div style={{ maxHeight: 500, overflow: 'auto' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={reviewed.url} alt="선택 옵션의 저장된 상품고시 PNG" width={reviewed.rendered.width} height={reviewed.rendered.height} style={{ width: '100%', height: 'auto' }} />
      </div>
      <a className="btn ghost" href={reviewed.url} download="yoofam-option-label.png">상품고시 PNG 다운로드</a>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void attach()}>PNG 업로드·선택 옵션 견적에 연결</button>
      <small>기존 라벨은 유지하고 선택 옵션에 추가합니다.</small>
    </>}
  </section>;
}
