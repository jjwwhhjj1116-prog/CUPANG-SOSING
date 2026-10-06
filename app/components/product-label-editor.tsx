'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { productLabelChanges, productLabelDraftIssues, productLabelFields, productLabelPlan, productLabelValue, verifyProductLabelsView, verifyProductLabelRefresh, verifyProductLabelSave, type ProductLabelDraft, type ProductLabelKey, type ProductLabelsView } from '@/app/product-label';
import { renderDocument } from '@/app/document-image-render';
import { attachProductLabel } from '@/app/product-label-attachment';
import { productLabelPreviewSignature, type ProductLabelUploadCache } from '@/app/product-label-upload';

type Props = { productId: string; optionId: string | null; version: string; profileId?: string; refreshToken?: string; onSaved?: () => void };
type Preview = { scope: string; sourceKey: string; signature: string; view: ProductLabelsView; url: string; rendered: { blob: Blob; width: number; height: number } };
const unchanged = (before: ProductLabelsView, after: ProductLabelsView) => before.productId === after.productId && before.revision === after.revision && before.inputFingerprint === after.inputFingerprint && before.productVersion === after.productVersion;

export function ProductLabelEditor({ productId, optionId, version, profileId, refreshToken, onSaved }: Props) {
  const query = profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';
  const endpoint = `/api/products/${encodeURIComponent(productId)}/product-labels${query}`, quotationEndpoint = `/api/products/${encodeURIComponent(productId)}/quotation-fields${query}`;
  const scope = JSON.stringify([endpoint, optionId]), sourceKey = JSON.stringify([scope, version, refreshToken]);
  const currentScope = useRef(scope), currentSource = useRef(sourceKey), mounted = useRef(true), request = useRef<AbortController | null>(null);
  const [saved, setSaved] = useState<{ scope: string; sourceKey: string; view: ProductLabelsView } | null>(null), latestSaved = useRef<typeof saved>(null);
  const [pending, setPending] = useState<{ scope: string; values: ProductLabelDraft }>({ scope, values: {} }), latestDraft = useRef({ scope, values: {} as ProductLabelDraft });
  const [preview, setPreview] = useState<Preview | null>(null), latestPreview = useRef<Preview | null>(null);
  const uploads = useRef(new Map<string, ProductLabelUploadCache>());
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [notice, setNotice] = useState<{ scope: string; text: string; identity: string | null }>({ scope, text: '', identity: null });
  const current = () => mounted.current && currentScope.current === scope && currentSource.current === sourceKey;
  useLayoutEffect(() => {
    mounted.current = true; currentScope.current = scope; currentSource.current = sourceKey;
    if (latestDraft.current.scope !== scope) latestDraft.current = { scope, values: {} };
    return () => { mounted.current = false; request.current?.abort(); request.current = null; };
  }, [scope, sourceKey]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const view = saved?.scope === scope ? saved.view : null, draft = pending.scope === scope ? pending.values : {};
  const dirty = Object.keys(draft).length > 0, fresh = saved?.sourceKey === sourceKey;
  const reviewed = preview?.scope === scope && preview.sourceKey === sourceKey && !dirty && fresh ? preview : null;
  const row = view?.rows.find(row => row.optionId === optionId), caption = optionId === null ? '상품 공통' : '선택 옵션';
  const message = notice.scope === scope ? notice.text : '';
  function setMessage(text: string, verified?: ProductLabelsView) { setNotice({ scope, text, identity: verified ? JSON.stringify([verified.productVersion, verified.inputFingerprint]) : null }); }
  function clearPreview() { latestPreview.current = null; setPreview(null); }
  function store(body: ProductLabelsView) { latestSaved.current = { scope, sourceKey, view: body }; setSaved(latestSaved.current); }
  function clearDraft() { latestDraft.current = { scope, values: {} }; setPending(latestDraft.current); }
  function verify(body: ProductLabelsView) { verifyProductLabelsView(body, optionId, profileId); if (body.productId !== productId) throw Error('표시사항을 편집할 상품을 다시 확인해주세요.'); }
  function finish(controller: AbortController) { if (request.current === controller) { request.current = null; if (!controller.signal.aborted && current()) setBusy(false); } }
  async function read(signal: AbortSignal) {
    const response = await fetch(endpoint, { cache: 'no-store', signal }), body = await response.json() as ProductLabelsView & { error?: string };
    if (!response.ok) throw Error(body.error || '제품 표시사항을 불러오지 못했습니다.'); verify(body); return body;
  }
  async function load(keepDraft = false, explicitLatest = false, preserveCompletion = false) {
    if (request.current || !current()) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); clearPreview();
    try {
      const body = await read(controller.signal); if (controller.signal.aborted || !current()) return;
      const editing = latestDraft.current.scope === scope ? latestDraft.current.values : {}, before = latestSaved.current?.scope === scope ? latestSaved.current.view : null;
      let recovered = false;
      if (keepDraft || explicitLatest) {
        if (!before) throw Error('이전 제품 표시사항 입력 기준을 확인하지 못했습니다.'); verifyProductLabelRefresh(before, body, optionId, keepDraft ? editing : {});
        if (keepDraft && Object.keys(editing).length) { try { verifyProductLabelSave(before, body, optionId, editing); recovered = true; } catch { /* An unrelated source update can be reviewed while retaining the draft. */ } }
      } else if (body.productVersion !== version) throw Error('상품 저장 상태가 변경됐습니다. 상품을 다시 열어 최신 표시사항을 확인해주세요.');
      store(body); if (!keepDraft || recovered) clearDraft();
      if (recovered) setMessage('저장된 제품 표시사항을 확인했습니다.', body);
      else if (keepDraft) setMessage('입력을 유지하고 최신 표시사항을 읽었습니다. 확인 후 저장해주세요.');
      else if (!preserveCompletion || notice.scope !== scope || notice.identity !== JSON.stringify([body.productVersion, body.inputFingerprint])) setMessage('');
      if (recovered) onSaved?.();
    } catch (cause) { if (!controller.signal.aborted && current()) setError(cause instanceof Error ? cause.message : '제품 표시사항 조회 실패'); }
    finally { finish(controller); }
  }
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (!active || !current()) return; setBusy(false); setError(''); clearPreview(); if (latestDraft.current.scope === scope && Object.keys(latestDraft.current.values).length && latestSaved.current?.scope === scope) return; void load(false, false, true); });
    return () => { active = false; request.current?.abort(); request.current = null; };
    // This editor stays mounted across stages. Source commits invalidate PNG
    // previews but never discard local edits or start an automatic write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, sourceKey]);
  function edit(key: ProductLabelKey, value: string | null) {
    if (!view || request.current || !current()) return;
    latestDraft.current = { scope, values: { ...(latestDraft.current.scope === scope ? latestDraft.current.values : {}), [key]: value } };
    setPending(latestDraft.current); clearPreview(); setMessage('');
  }
  function restoreAll() {
    if (!view || request.current || !current()) return;
    latestDraft.current = { scope, values: Object.fromEntries(productLabelFields.map(field => [field.key, null])) as ProductLabelDraft };
    setPending(latestDraft.current); clearPreview(); setMessage('복원할 값을 확인한 뒤 정보 저장하기를 눌러주세요.');
  }
  const issues = view ? productLabelDraftIssues(view, optionId, draft) : [];
  async function save() {
    const base = latestSaved.current, editing = latestDraft.current.scope === scope ? latestDraft.current.values : {};
    if (!base || base.scope !== scope || !Object.keys(editing).length || request.current || !current()) return;
    if (base.sourceKey !== sourceKey) { setError('상품 저장 상태가 변경됐습니다. 입력을 유지하고 최신 표시사항을 조회한 뒤 저장해주세요.'); return; }
    let changes; try { changes = productLabelChanges(base.view, optionId, editing); } catch (cause) { setError(cause instanceof Error ? cause.message : '표시사항 입력을 확인해주세요.'); return; }
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setMessage(''); clearPreview();
    try {
      const response = await fetch(endpoint, { method: 'PUT', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: base.view.revision, expectedInputFingerprint: base.view.inputFingerprint, changes }) }), body = await response.json() as ProductLabelsView & { error?: string };
      if (controller.signal.aborted || !current()) return;
      if (!response.ok) throw Error(body.error || '표시사항을 저장하지 못했습니다. 입력은 유지됩니다.'); verify(body); verifyProductLabelSave(base.view, body, optionId, editing);
      store(body); clearDraft(); setMessage(`${caption} 제품 표시사항 저장 완료. 수정한 내용을 견적서 이미지에 반영하려면 다시 생성한 뒤 PNG를 견적에 연결하세요.`, body); onSaved?.();
    } catch (cause) { if (!controller.signal.aborted && current()) setError(cause instanceof Error ? cause.message : '제품 표시사항 저장 실패'); }
    finally { finish(controller); }
  }
  async function generate() {
    const base = latestSaved.current;
    if (!base || base.scope !== scope || base.sourceKey !== sourceKey || request.current || !current() || latestDraft.current.scope === scope && Object.keys(latestDraft.current.values).length) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setMessage(''); clearPreview();
    try {
      const before = await read(controller.signal); if (controller.signal.aborted || !current()) return;
      if (!unchanged(base.view, before)) throw Error('저장된 표시사항이 바뀌었습니다. 최신 자료를 조회한 뒤 다시 만들어주세요.');
      const signature = productLabelPreviewSignature({ productId, endpoint, view: before, optionId });
      let cache = uploads.current.get(signature);
      if (!cache) { cache = { signature, uploadedKey: null, rendered: null }; uploads.current.set(signature, cache); while (uploads.current.size > 8) uploads.current.delete(uploads.current.keys().next().value!); }
      const rendered = cache.rendered ?? await renderDocument(productLabelPlan(before, optionId));
      if (controller.signal.aborted || !current()) return;
      const after = await read(controller.signal); if (controller.signal.aborted || !current()) return;
      if (!unchanged(before, after) || productLabelPreviewSignature({ productId, endpoint, view: after, optionId }) !== signature) throw Error('이미지를 만드는 동안 표시사항이 바뀌었습니다. 최신 저장값으로 다시 만들어주세요.');
      cache.rendered = rendered; const next = { scope, sourceKey, signature, view: after, rendered, url: URL.createObjectURL(rendered.blob) };
      latestPreview.current = next; setPreview(next); setMessage('저장된 9항목으로 제품 표시사항 이미지를 만들었습니다.');
    } catch (cause) { if (!controller.signal.aborted && current()) setError(cause instanceof Error ? cause.message : '제품 표시사항 이미지 생성 실패'); }
    finally { finish(controller); }
  }
  async function attach() {
    const chosen = latestPreview.current;
    if (!chosen || chosen.scope !== scope || chosen.sourceKey !== sourceKey || request.current || !current() || latestDraft.current.scope === scope && Object.keys(latestDraft.current.values).length) return;
    const cache = uploads.current.get(chosen.signature); if (!cache) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setMessage('');
    try {
      const scopedFetch: typeof fetch = async (url, init) => { if (controller.signal.aborted || !current()) throw Error('상품 또는 옵션 저장 상태가 변경되었습니다.'); const response = await fetch(url, { ...init, signal: controller.signal }); if (controller.signal.aborted || !current()) throw Error('상품 또는 옵션 저장 상태가 변경되었습니다.'); return response; };
      const result = await attachProductLabel({ productId, endpoint, quotationEndpoint, renderedView: chosen.view, optionId, blob: chosen.rendered.blob, uploadedKey: cache.uploadedKey, onUploaded: key => { cache.uploadedKey = key; } }, scopedFetch);
      if (controller.signal.aborted || !current()) return;
      verify(result.view);
      if (productLabelPreviewSignature({ productId, endpoint, view: result.view, optionId }) !== chosen.signature || !result.key || !result.view.imageKeys.includes(result.key)) throw Error('연결한 PNG와 현재 제품 표시사항 저장값을 확인하지 못했습니다.');
      store(result.view); clearPreview(); setMessage(`${caption} 표시사항 PNG를 견적서에 연결했습니다. 기존 라벨은 유지했습니다.`, result.view); onSaved?.();
    } catch (cause) { if (!controller.signal.aborted && current()) setError(`${cause instanceof Error ? cause.message : '제품 표시사항 PNG 연결 실패'}${cache.uploadedKey ? ' 업로드한 파일은 보존됩니다. 같은 저장값으로 다시 연결하면 기존 파일을 확인해 사용합니다.' : ''}`); }
    finally { finish(controller); }
  }
  return <section className="panel-stack product-label-editor" aria-label={`${caption} 제품 표시사항`} data-quotation-source-step="표시사항" data-source-step="표시사항" data-workspace-dirty={dirty} data-workspace-saving={busy}>
    <h3>제품 한글 표시사항</h3><p>{row?.optionLabel || (optionId === null ? '상품 공통' : optionId)}{optionId !== null && row?.included === false ? ' · 견적 제외 옵션' : ''}</p>
    <p>{optionId === null ? '공통 9항목은 개별 표시사항을 수정하지 않은 옵션에 적용합니다. 각 옵션의 직접 수정값은 유지됩니다.' : '이 옵션의 제품 표시사항 9항목을 편집합니다. 다른 옵션과 상품 공통 표시사항은 유지됩니다.'} 카테고리별 상품고시는 7단계 견적서에서 따로 확인합니다.</p>
    {busy && <p role="status">제품 표시사항 처리 중…</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {dirty && !fresh && <p role="status">상품 저장 상태가 변경됐습니다. 입력은 유지했습니다. 최신 자료를 조회한 뒤 저장해주세요.</p>}
    {view && <div className="product-label-rows">{productLabelFields.map(field => <label className="product-label-row field" key={field.key}><span>{field.label}</span><textarea aria-label={`${caption} ${field.label}`} value={productLabelValue(view, optionId, field.key, draft)} disabled={busy} onChange={event => edit(field.key, event.target.value)} />
      <button type="button" className="btn ghost" disabled={busy} onClick={() => edit(field.key, '')}>{field.label} 비우기</button><button type="button" className="btn ghost" disabled={busy} onClick={() => edit(field.key, null)}>{field.label} {optionId === null ? '자동값' : '공통·자동값'} 복원</button>
    </label>)}</div>}
    <small>공란도 직접 수정값으로 저장합니다. 내용량·재질·상품 유형·사용 기준은 확인한 값만 입력하세요.</small>
    <small>수정한 내용을 견적서 이미지에 반영하려면 다시 생성한 뒤 PNG를 견적에 연결하세요.</small>
    {!!issues.length && <p role="alert">{[...new Set(issues)].join(' ')}</p>}
    <div className="quote-actions"><button type="button" className="btn primary" disabled={!view || busy || !dirty || !!issues.length} onClick={() => void save()}>정보 저장하기</button><button type="button" className="btn ghost" disabled={!view || busy} onClick={restoreAll}>전체 {optionId === null ? '자동값' : '공통·자동값'} 복원</button>
      <button type="button" className="btn blue" disabled={!view || busy || dirty || !fresh || optionId !== null && row?.included !== true} onClick={() => void generate()}>한글 표시사항 생성 시작</button></div>
    {dirty && <button type="button" className="btn ghost" disabled={busy} onClick={() => void load(true)}>입력 유지·최신 표시사항 조회</button>}
    <button type="button" className="btn ghost" disabled={busy} onClick={() => void load(false, true)}>{dirty ? '입력 취소·저장 표시사항 다시 조회' : '저장 표시사항 다시 조회'}</button>
    {reviewed && <><div className="product-label-preview" style={{ maxHeight: 600, overflow: 'auto' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={reviewed.url} alt={`${caption} 저장된 9항목 제품 표시사항 PNG`} width={reviewed.rendered.width} height={reviewed.rendered.height} style={{ width: '100%', height: 'auto' }} /></div>
      <div className="quote-actions"><a className="btn ghost" href={reviewed.url} download="yoofam-product-label.png">표시사항 PNG 다운로드</a><button type="button" className="btn ghost" disabled={busy} onClick={() => void generate()}>저장한 값으로 다시 생성</button><button type="button" className="btn primary" disabled={busy} onClick={() => void attach()}>PNG 업로드·견적에 연결</button></div>
    </>}
  </section>;
}
