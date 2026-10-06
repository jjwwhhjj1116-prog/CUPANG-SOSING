'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { optionImageChanges, optionImageDraftIssues, optionImageTargets, optionImageValue, quotationImageKeys, verifyOptionImageRefresh, verifyOptionImageRestored, verifyOptionImageSave, type OptionImageDraft, type OptionImageInput, type OptionImageStage } from '@/app/quotation-image-targets';

type Props = { productId: string; optionId: string; version: string; profileId?: string; refreshToken?: string; stage: OptionImageStage;
  disabled?: boolean; onSaved?: () => void; onTranslate?: (sourceKey: string, role: OptionImageStage) => void };
const imageUrl = (key: string) => `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
export function OptionImageEditor({ productId, optionId, version, profileId, refreshToken, stage, disabled = false, onSaved, onTranslate }: Props) {
  const endpoint = `/api/products/${encodeURIComponent(productId)}/quotation-fields${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`;
  const scope = JSON.stringify([endpoint, optionId]), sourceKey = JSON.stringify([scope, version, refreshToken]);
  const currentScope = useRef(scope), currentSource = useRef(sourceKey), request = useRef<AbortController | null>(null);
  const [saved, setSaved] = useState<{ scope: string; sourceKey: string; view: QuotationFieldsView } | null>(null);
  const [pending, setPending] = useState<{ scope: string; values: OptionImageDraft }>({ scope, values: {} });
  const [preview, setPreview] = useState<{ scope: string; key: string } | null>(null);
  const latestSaved = useRef<typeof saved>(null), latestDraft = useRef({ scope, values: {} as OptionImageDraft });
  useLayoutEffect(() => {
    currentScope.current = scope; currentSource.current = sourceKey;
    if (latestDraft.current.scope !== scope) latestDraft.current = { scope, values: {} };
    return () => { request.current?.abort(); request.current = null; };
  }, [scope, sourceKey]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const view = saved?.scope === scope ? saved.view : null, draft = pending.scope === scope ? pending.values : {};
  const dirty = Object.keys(draft).length > 0, input = stage === 'additional' ? 'additionalImages' : 'detailImages', label = stage === 'additional' ? '추가 이미지' : '상세 이미지';
  const current = () => currentScope.current === scope && currentSource.current === sourceKey;
  function verify(body: QuotationFieldsView, saveResponse = false, explicitLatest = false) {
    if (!body || (!saveResponse && !explicitLatest && body.productVersion !== version) || !Number.isFinite(Date.parse(body.productVersion)) || !Number.isSafeInteger(body.revision) || body.revision < 0
      || !Number.isSafeInteger(body.contentRevision) || body.contentRevision < 0 || !Number.isSafeInteger(body.optionRevision) || body.optionRevision < 0
      || !/^[a-f0-9]{64}$/.test(body.inputFingerprint) || !Array.isArray(body.imageKeys) || body.imageKeys.length > 50
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
    if (request.current || !current()) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal }), body = await response.json() as QuotationFieldsView & { error?: string };
      if (controller.signal.aborted || !current()) return;
      if (!response.ok) throw Error(body.error || '옵션 이미지를 불러오지 못했습니다.'); verify(body, false, keepDraft);
      const editing = latestDraft.current.scope === scope ? latestDraft.current.values : {};
      if (keepDraft) { const before = latestSaved.current?.scope === scope ? latestSaved.current.view : null; if (!before) throw Error('이전 이미지 입력 기준을 확인하지 못했습니다.'); verifyOptionImageRefresh(before, body, optionId, editing); }
      latestSaved.current = { scope, sourceKey, view: body }; setSaved(latestSaved.current);
      if (!keepDraft) { latestDraft.current = { scope, values: {} }; setPending(latestDraft.current); }
      setMessage(keepDraft ? '입력을 유지하고 최신 이미지를 읽었습니다. 확인 후 선택 옵션 이미지를 저장해주세요.' : '');
    } catch (cause) { if (!controller.signal.aborted && current()) setError(cause instanceof Error ? cause.message : '옵션 이미지 조회 실패'); }
    finally { if (request.current === controller) { request.current = null; if (!controller.signal.aborted && current()) setBusy(false); } }
  }
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (!active || !current()) return; setBusy(false); setError(''); if (dirty && view) return; void load(); });
    return () => { active = false; request.current?.abort(); request.current = null; };
    // Source identity governs reads. Stage changes retain the same option's
    // pending image/HTML edits; local editing never starts an automatic write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, sourceKey]);
  function edit(field: OptionImageInput, value: string | null) {
    if (!view || disabled || request.current || !current()) return;
    latestDraft.current = { scope, values: { ...(latestDraft.current.scope === scope ? latestDraft.current.values : {}), [field]: value } };
    setPending(latestDraft.current); setMessage('');
  }
  function updateImages(update: (keys: string[]) => string[]) {
    const base = latestSaved.current, editing = latestDraft.current.scope === scope ? latestDraft.current.values : {};
    if (!base || base.scope !== scope || disabled || request.current || !current()) return;
    edit(input, update(quotationImageKeys(optionImageValue(base.view, optionId, input, editing))).join('\n'));
  }
  function toggle(key: string) {
    if (!view?.imageKeys.includes(key)) return;
    updateImages(keys => keys.includes(key) ? keys.filter(item => item !== key) : [...keys, key]);
  }
  function move(key: string, direction: -1 | 1) {
    updateImages(keys => { const index = keys.indexOf(key), destination = index + direction; if (index < 0 || destination < 0 || destination >= keys.length) return keys; const ordered = [...keys]; [ordered[index], ordered[destination]] = [ordered[destination], ordered[index]]; return ordered; });
  }
  async function save() {
    const base = latestSaved.current, editing = latestDraft.current.scope === scope ? latestDraft.current.values : {};
    if (!base || base.scope !== scope || !Object.keys(editing).length || disabled || request.current || !current()) return;
    if (base.sourceKey !== sourceKey) { setError('상품 저장 상태가 변경됐습니다. 입력을 유지하고 최신 이미지를 조회한 뒤 저장해주세요.'); return; }
    let changes; try { changes = optionImageChanges(base.view, optionId, editing); } catch (cause) { setError(cause instanceof Error ? cause.message : '이미지 입력을 확인해주세요.'); return; }
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'PUT', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: base.view.revision, expectedInputFingerprint: base.view.inputFingerprint, changes }) });
      let body = await response.json() as QuotationFieldsView & { error?: string };
      if (controller.signal.aborted || !current()) return;
      if (!response.ok) throw Error(body.error || '옵션 이미지를 저장하지 못했습니다. 입력은 유지됩니다.'); verify(body, true); verifyOptionImageSave(base.view, body, optionId, changes);
      if (changes.some(change => change.value === null)) {
        const confirmation = await fetch(endpoint, { cache: 'no-store', signal: controller.signal }), latest = await confirmation.json() as QuotationFieldsView & { error?: string };
        if (controller.signal.aborted || !current()) return;
        if (!confirmation.ok) throw Error(latest.error || '이미지 복원 저장본을 다시 확인하지 못했습니다. 입력은 유지했습니다.');
        verify(latest, true); verifyOptionImageSave(base.view, latest, optionId, changes); verifyOptionImageRestored(body, latest, optionId, changes); body = latest;
      }
      latestSaved.current = { scope, sourceKey, view: body }; latestDraft.current = { scope, values: {} };
      setSaved(latestSaved.current); setPending(latestDraft.current); setMessage('선택 옵션 이미지 저장 완료 · 견적서에 반영됩니다.'); onSaved?.();
    } catch (cause) { if (!controller.signal.aborted && current()) setError(cause instanceof Error ? cause.message : '옵션 이미지 저장 실패'); }
    finally { if (request.current === controller) { request.current = null; if (!controller.signal.aborted && current()) setBusy(false); } }
  }
  let selected: string[] = [], html = '', limit = 30, issues: string[] = [], bindingError = '';
  if (view) try {
    const targets = optionImageTargets(view.resolved.schema.fields); selected = quotationImageKeys(optionImageValue(view, optionId, input, draft)); html = optionImageValue(view, optionId, 'detailHtml', draft);
    limit = Math.min(...targets[input].fields.map(field => field.maxItems ?? 30)); issues = optionImageDraftIssues(view, optionId, draft);
  } catch (cause) { bindingError = cause instanceof Error ? cause.message : '이미지 연결 확인 필요'; }
  const row = view?.resolved.rows.find(row => row.optionId === optionId), locked = busy || disabled || !!bindingError;
  const unavailable = selected.filter(key => !view?.imageKeys.includes(key));
  const activePreview = preview?.scope === scope && view?.imageKeys.includes(preview.key) ? preview.key : selected.find(key => view?.imageKeys.includes(key)) ?? view?.imageKeys[0] ?? null;
  const candidateCards = view?.imageKeys.map((key, index) => <figure className={`image-asset-card ${key === activePreview ? 'previewing' : ''} ${selected.includes(key) ? 'chosen' : ''}`} key={key}>
    <button type="button" className="image-asset-preview" aria-label={`상품 저장 이미지 ${index + 1} 크게 보기`} disabled={locked} onClick={() => { if (current() && !request.current && !disabled) setPreview({ scope, key }); }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl(key)} alt={`상품 저장 이미지 ${index + 1}`} width={200} height={180} loading="lazy" /><span>이미지 {index + 1} · 확대</span>
    </button>
    <figcaption><label><input type="checkbox" aria-label={`선택 옵션 ${label} 후보 ${index + 1}`} checked={selected.includes(key)} disabled={locked || (!selected.includes(key) && selected.length >= limit)} onChange={() => toggle(key)} />이미지 {index + 1} 선택</label></figcaption>
    {onTranslate && <button type="button" className="btn ghost" disabled={locked || dirty} onClick={() => { if (current() && !request.current && !disabled && !Object.keys(latestDraft.current.values).length) onTranslate(key, stage); }}>이 이미지 번역 편집</button>}
  </figure>);
  const selectedActions = (key: string, index: number) => <div className={stage === 'detail' ? 'option-detail-image-toolbar' : 'image-selected-actions'} role="group" aria-label={`${label} ${index + 1} 편집`}>
    <button type="button" className="btn ghost" aria-label={`${label} ${index + 1} 위로 이동`} disabled={locked || index === 0} onClick={() => move(key, -1)}>↑</button>
    <button type="button" className="btn ghost" aria-label={`${label} ${index + 1} 아래로 이동`} disabled={locked || index === selected.length - 1} onClick={() => move(key, 1)}>↓</button>
    <button type="button" className="btn ghost" aria-label={`${label} ${index + 1} 선택 제거`} disabled={locked} onClick={() => updateImages(keys => keys.filter(item => item !== key))}>삭제</button>
  </div>;
  return <section className="panel-stack" aria-label="선택 옵션 이미지 편집" data-quotation-source-step={stage === 'additional' ? '추가 이미지' : '상세 이미지'} data-workspace-dirty={dirty} data-workspace-saving={busy}>
    <h3>{stage === 'detail' ? '상세 페이지 이미지' : '선택 옵션 추가 이미지'}</h3><p>{row?.optionLabel || optionId} · {row?.included === false ? '견적 제외 옵션' : '선택한 옵션'}</p>
    <p>선택한 이미지와 순서는 이 옵션의 견적서에만 저장합니다. 상품 공통 이미지와 다른 옵션은 유지됩니다.</p>
    {busy && <p role="status">옵션 이미지 처리 중…</p>}{error && <p role="alert">{error}</p>}{bindingError && <p role="alert">{bindingError}</p>}{message && <p role="status">{message}</p>}
    {dirty && saved?.sourceKey !== sourceKey && <p role="status">상품 저장 상태가 변경됐습니다. 입력은 유지했습니다. 최신 자료를 조회한 뒤 저장해주세요.</p>}
    {view && <>{stage === 'additional' ? <div className="image-edit-workspace">
      <aside className="image-edit-library" aria-label="상품 저장 이미지 후보 목록"><h4>모든 이미지 {view.imageKeys.length}</h4><div className="image-asset-grid">{candidateCards}</div>{!view.imageKeys.length && <p>상품에 저장한 이미지를 먼저 추가해주세요.</p>}</aside>
      <section className="image-edit-canvas" aria-label="선택 옵션 이미지 미리보기"><h4>현재 {label} · {selected.length}/{limit}개</h4>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {activePreview ? <figure className="image-large-preview"><figcaption>이미지 {view.imageKeys.indexOf(activePreview) + 1} 미리보기</figcaption><img src={imageUrl(activePreview)} alt={`선택 옵션 ${label} 큰 미리보기`} /></figure> : <p>이미지 목록에서 미리볼 자료를 선택하세요.</p>}
        <div className="image-selected-strip" aria-label={`선택 옵션 ${label} 순서`}>{selected.map((key, index) => <figure className="image-selected-item" key={key}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {view.imageKeys.includes(key) ? <button type="button" aria-label={`${label} ${index + 1} 크게 보기`} disabled={locked} onClick={() => { if (current() && !request.current && !disabled) setPreview({ scope, key }); }}><img src={imageUrl(key)} alt={`${label} ${index + 1}`} width={64} height={64} /><span>{index + 1}</span></button> : <p>현재 상품에 없는 이미지</p>}
      <figcaption>{index + 1} · {key.split('/').at(-1)}</figcaption>
      {selectedActions(key, index)}
    </figure>)}</div>{!selected.length && <p>이 옵션에 선택한 {label}가 없습니다.</p>}
      </section></div> : <><section className="option-detail-image-stack" aria-label="선택 옵션 상세 이미지 순서"><h4>현재 상세 이미지 · {selected.length}/{limit}개</h4>{selected.map((key, index) => <figure className="option-detail-image-item" key={key}>
        <figcaption>상세 이미지 {index + 1} · {key.split('/').at(-1)}</figcaption>{selectedActions(key, index)}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {view.imageKeys.includes(key) ? <img src={imageUrl(key)} alt={`상세 이미지 ${index + 1}`} loading="lazy" /> : <p>현재 상품에 없는 이미지</p>}
      </figure>)}{!selected.length && <p>이 옵션에 선택한 상세 이미지가 없습니다.</p>}</section>
        <details className="option-detail-image-candidates"><summary>모든 이미지 {view.imageKeys.length} · 상세 이미지 선택·교체</summary><div className="option-detail-image-candidate-grid">{candidateCards}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview?.scope === scope && view.imageKeys.includes(preview.key) && <figure className="image-large-preview"><figcaption>이미지 {view.imageKeys.indexOf(preview.key) + 1} 미리보기</figcaption><img src={imageUrl(preview.key)} alt="상세 이미지 후보 큰 미리보기" /></figure>}
          {!view.imageKeys.length && <p>상품에 저장한 이미지를 먼저 추가해주세요.</p>}
        </details></>}
      <div><button type="button" className="btn ghost" disabled={locked} onClick={() => edit(input, '')}>{label} 선택 비우기</button><button type="button" className="btn ghost" disabled={locked} onClick={() => edit(input, null)}>{label} 공통·자동값 복원</button></div>
      {!!unavailable.length && <p role="alert">현재 상품에 없는 이미지 참조가 {unavailable.length}개 있습니다. <button type="button" className="btn ghost" disabled={locked} onClick={() => updateImages(keys => keys.filter(key => view.imageKeys.includes(key)))}>누락 이미지 참조 제거</button></p>}
      <small>이미지 업로드·파일 편집·번역은 상품 공통 이미지 편집에서 진행합니다. 저장한 파일은 최신 이미지 조회 후 이 옵션의 후보 목록에서도 선택할 수 있습니다.</small>
      {stage === 'detail' && <label className="field"><span>선택 옵션 상세 HTML</span><textarea aria-label="선택 옵션 상세 HTML" value={html} disabled={locked} onChange={event => edit('detailHtml', event.target.value)} />
        <small>이미지 순서 변경은 자동 상세 HTML에 반영됩니다. 기존 직접 작성한 HTML과 공란은 유지합니다. HTML은 텍스트로 편집하며 이 화면에서 실행하지 않습니다.</small>
        <button type="button" className="btn ghost" disabled={locked} onClick={() => edit('detailHtml', '')}>상세 HTML 비우기</button><button type="button" className="btn ghost" disabled={locked} onClick={() => edit('detailHtml', null)}>상세 HTML 공통·자동값 복원</button>
      </label>}
    </>}
    {!!issues.length && <p role="alert">{[...new Set(issues)].join(' ')}</p>}
    <button type="button" className="btn primary" disabled={!view || locked || !dirty || !!issues.length} onClick={() => void save()}>선택 옵션 이미지 저장</button>
    {dirty && <button type="button" className="btn ghost" disabled={busy || disabled} onClick={() => void load(true)}>입력 유지·최신 이미지 조회</button>}
    <button type="button" className="btn ghost" disabled={busy || disabled} onClick={() => void load()}>{dirty ? '입력 취소·저장 이미지 다시 조회' : '저장 이미지 다시 조회'}</button>
  </section>;
}
