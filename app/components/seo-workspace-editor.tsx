'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SeoWorkspaceInput, SeoWorkspaceView } from '@/app/seo-workspace';
import { emptySeoWorkspaceDraft, hasSeoWorkspaceDraft, readSeoWorkspace, saveSeoWorkspace, seoWorkspaceInput, seoWorkspaceRefreshConflicts, seoWorkspaceSaveState,
  SeoWorkspaceSaveError, type SeoWorkspaceDraft } from '@/app/seo-workspace-client';
import './seo-workspace.css';

type Props = { productId: string; version: string; focusedOptionId?: string; active?: boolean; disabled?: boolean; onSaved?: () => void };
type Saved = { scope: string; sourceKey: string; view: SeoWorkspaceView };
type Attempt = { scope: string; before: SeoWorkspaceView; input: SeoWorkspaceInput };
type Comparison = { scope: string; sourceKey: string; before: SeoWorkspaceView; latest: SeoWorkspaceView; fields: string[] };
const provenance = { unverified: '미작성', collected: '수집 원문', translated: '번역 결과', generated: '자동 생성 결과', manual: '직접 수정' };

export function SeoWorkspaceEditor({ productId, version, focusedOptionId, active = true, disabled = false, onSaved }: Props) {
  const scope = productId, sourceKey = JSON.stringify([scope, version]);
  const live = useRef({ scope, sourceKey, active, disabled, mounted: true, onSaved }), request = useRef<AbortController | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null), savedRef = useRef<Saved | null>(null);
  const [pending, setPending] = useState({ scope, values: emptySeoWorkspaceDraft() }), draftRef = useRef(pending);
  const attempt = useRef<Attempt | null>(null);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [comparison, setComparison] = useState<Comparison | null>(null);
  const current = () => live.current.mounted && live.current.active && live.current.scope === scope && live.current.sourceKey === sourceKey;
  useLayoutEffect(() => {
    live.current = { ...live.current, scope, sourceKey, active, mounted: true };
    if (draftRef.current.scope !== scope) draftRef.current = { scope, values: emptySeoWorkspaceDraft() };
    if (attempt.current?.scope !== scope) attempt.current = null;
    return () => { live.current.mounted = false; request.current?.abort(); request.current = null; };
  }, [scope, sourceKey, active]);
  useLayoutEffect(() => { live.current.disabled = disabled; live.current.onSaved = onSaved; }, [disabled, onSaved]);
  const base = saved?.scope === scope ? saved : null, view = base?.view ?? null;
  const draft = pending.scope === scope ? pending.values : emptySeoWorkspaceDraft(), dirty = hasSeoWorkspaceDraft(draft), fresh = base?.sourceKey === sourceKey;
  const latestDraft = () => draftRef.current.scope === scope ? draftRef.current.values : emptySeoWorkspaceDraft();
  const store = (value: SeoWorkspaceView) => { savedRef.current = { scope, sourceKey, view: value }; setSaved(savedRef.current); };
  const clearDraft = () => { draftRef.current = { scope, values: emptySeoWorkspaceDraft() }; setPending(draftRef.current); };
  function finish(controller: AbortController) {
    if (request.current === controller) { request.current = null; if (!controller.signal.aborted && current()) setBusy(false); }
  }
  async function load(keepDraft = false, explicitLatest = false) {
    if (request.current || !current()) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setMessage('');
    try {
      const latest = await readSeoWorkspace(productId, fetch, controller.signal);
      if (controller.signal.aborted || !current()) return;
      if (Date.parse(latest.productVersion) < Date.parse(version)) throw Error('현재 상품 기준보다 이전 SEO 저장본입니다. 입력을 유지했습니다. 최신 저장본을 다시 확인해주세요.');
      const previous = savedRef.current?.scope === scope ? savedRef.current.view : null, editing = latestDraft();
      const attempted = attempt.current?.scope === scope ? attempt.current : null;
      if (keepDraft && attempted) {
        const result = seoWorkspaceSaveState(attempted.before, attempted.input, latest);
        store(latest); attempt.current = null; setUncertain(false); setConflict(false); setComparison(null);
        if (result === 'saved') { clearDraft(); setMessage('저장된 SEO 설정을 확인했습니다. 상품명·검색태그·옵션명이 함께 반영되었습니다.'); live.current.onSaved?.(); }
        else setMessage('아직 저장되지 않은 입력입니다. 최신 저장본을 확인했습니다. SEO 설정 저장을 누르면 다시 요청합니다.');
        return;
      }
      if (keepDraft && previous) {
        const fields = seoWorkspaceRefreshConflicts(previous, latest, editing);
        if (fields.length) { setComparison({ scope, sourceKey, before: previous, latest, fields }); setConflict(true); throw Error('수정 중인 항목에 다른 저장값이 있습니다. 아래 비교를 확인해주세요. 입력은 유지했습니다.'); }
      } else if (!explicitLatest && latest.productVersion !== version) throw Error('상품 저장 상태가 변경되었습니다. 최신 SEO 저장본을 확인해주세요.');
      else if (explicitLatest && Date.parse(latest.productVersion) < Date.parse(previous?.productVersion ?? version)) throw Error('이전 SEO 저장본입니다. 현재 입력을 유지했습니다.');
      store(latest); setComparison(null); setConflict(false); setUncertain(false); attempt.current = null;
      if (!keepDraft) clearDraft();
      setMessage(keepDraft ? '입력을 유지하고 최신 SEO·옵션 저장본을 읽었습니다. 확인 후 SEO 설정을 저장해주세요.' : '');
    } catch (cause) { if (!controller.signal.aborted && current()) setError(cause instanceof Error ? cause.message : 'SEO 저장본 조회 실패'); }
    finally { finish(controller); }
  }
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive || !current()) return;
      setBusy(false); setError(''); setMessage(''); setComparison(null); setConflict(false); setUncertain(attempt.current?.scope === scope);
      if (hasSeoWorkspaceDraft(latestDraft()) && savedRef.current?.scope === scope) return;
      void load();
    });
    return () => { alive = false; request.current?.abort(); request.current = null; };
    // Drafts survive stage hiding and parent clocks; an explicit read confirms
    // them against the newest saved basis instead of clearing user input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, sourceKey, active]);
  function edit(update: (previous: SeoWorkspaceDraft) => SeoWorkspaceDraft) {
    if (!current() || live.current.disabled || request.current || attempt.current || !savedRef.current || savedRef.current.scope !== scope) return;
    draftRef.current = { scope, values: update(latestDraft()) }; setPending(draftRef.current); setMessage('');
  }
  async function save() {
    const previous = savedRef.current, editing = latestDraft();
    if (!previous || previous.scope !== scope || !current() || live.current.disabled || request.current || !hasSeoWorkspaceDraft(editing)) return;
    if (attempt.current) { await load(true, true); return; }
    if (previous.sourceKey !== sourceKey || conflict) { setError('입력을 유지했습니다. 최신 SEO 저장본을 확인한 뒤 저장해주세요.'); return; }
    let input: SeoWorkspaceInput;
    try { input = seoWorkspaceInput(previous.view, editing); } catch (cause) { setError(cause instanceof Error ? cause.message : 'SEO 입력을 확인해주세요.'); return; }
    const controller = new AbortController(); request.current = controller; attempt.current = { scope, before: previous.view, input };
    setBusy(true); setUncertain(true); setError(''); setMessage(''); setComparison(null);
    try {
      const value = await saveSeoWorkspace(previous.view, input, fetch, controller.signal);
      if (controller.signal.aborted || !current()) return;
      store(value); clearDraft(); attempt.current = null; setUncertain(false); setConflict(false);
      setMessage('SEO 설정 저장 완료 · 수정한 상품명·검색태그·옵션명을 함께 반영했습니다.'); live.current.onSaved?.();
    } catch (cause) {
      if (!controller.signal.aborted && current()) {
        if (cause instanceof SeoWorkspaceSaveError && !cause.uncertain) { attempt.current = null; setUncertain(false); setConflict(cause.status === 409); }
        setError(cause instanceof Error ? cause.message : 'SEO 저장 결과를 확인하지 못했습니다.');
      }
    } finally { finish(controller); }
  }
  const shownComparison = comparison?.scope === scope && comparison.sourceKey === sourceKey ? comparison : null;
  function reviewLatest() {
    if (!shownComparison || !current() || live.current.disabled || request.current || attempt.current || savedRef.current?.view !== shownComparison.before) return;
    store(shownComparison.latest); setComparison(null); setConflict(false); setError(''); setMessage('입력을 유지하고 비교한 최신 저장본을 기준으로 준비했습니다. 저장 버튼을 눌러야 반영됩니다.');
  }
  let issues: string[] = [];
  if (view && dirty) try { seoWorkspaceInput(view, draft); } catch (cause) { issues = [cause instanceof Error ? cause.message : 'SEO 입력을 확인해주세요.']; }
  const seoValue = (key: 'title' | 'keywords' | 'description') => Object.hasOwn(draft.seo, key) ? draft.seo[key]! : key === 'keywords' ? view?.content.seo.keywords.value.join(', ') ?? '' : view?.content.seo[key].value ?? '';
  const tagsLength = [...new Set(seoValue('keywords').split(/[\n,]/u).map(value => value.trim()).filter(Boolean))].join(', ').length;
  const locked = disabled || busy || uncertain;
  return <section className="panel-stack" aria-label="SEO 설정 통합 편집" data-quotation-source-step="SEO" data-workspace-dirty={dirty} data-workspace-saving={busy}>
    {busy && <p role="status">SEO·옵션 저장본을 확인하고 있습니다…</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {dirty && !fresh && <p role="status">상품 저장 상태가 변경되었습니다. 입력은 유지했습니다. 최신 저장본을 확인해주세요.</p>}
    {uncertain && <p role="status">저장 결과를 아직 확인하지 못했습니다. 결과 확인은 저장본 조회만 수행합니다.</p>}
    {view && <div className="seo-content-columns" style={{ width: '100%' }}>
      <section className="seo-common-editor"><h3>상품명 / 검색태그</h3><fieldset disabled={locked} style={{ border: 0, margin: 0 }}>
        <label className="field"><span>상품명 · {provenance[view.content.seo.title.provenance]}</span><input aria-label="SEO 상품명" value={seoValue('title')} maxLength={100} onChange={event => edit(previous => ({ ...previous, seo: { ...previous.seo, title: event.target.value } }))}/></label>
        <small className={seoValue('title').length > 100 ? 'seo-input-count exceeded' : 'seo-input-count'}>{seoValue('title').length}/100자{seoValue('title').length > 100 && ' · 기존 저장값은 유지합니다.'}</small>
        <label className="field"><span>검색태그 (쉼표로 구분) · {provenance[view.content.seo.keywords.provenance]}</span><textarea aria-label="SEO 검색태그" value={seoValue('keywords')} rows={5} maxLength={5050} onChange={event => edit(previous => ({ ...previous, seo: { ...previous.seo, keywords: event.target.value } }))}/></label>
        <small className={tagsLength > 150 ? 'seo-input-count exceeded' : 'seo-input-count'}>{tagsLength}/150자{tagsLength > 150 && ' · 기존 저장값은 유지합니다.'}</small>
        <details><summary>상품 설명</summary><label className="field"><span>상품 설명 · {provenance[view.content.seo.description.provenance]}</span><textarea aria-label="SEO 상품 설명" value={seoValue('description')} rows={7} maxLength={20000} onChange={event => edit(previous => ({ ...previous, seo: { ...previous.seo, description: event.target.value } }))}/></label></details>
      </fieldset></section>
      <section className="seo-option-names"><h3>옵션명</h3><div className="seo-option-names-body">{view.options.rows.map((row, index) => {
        const key = row.imageKey ?? view.sourceImageKeys?.[row.id], thumbnail = key && view.imageKeys.includes(key) ? key : null;
        return <article key={row.id} className="seo-option-name" data-option-target={row.id === focusedOptionId}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Only an exact owned saved option image is shown. */}
          {thumbnail && <img src={'/api/files/' + thumbnail.split('/').map(encodeURIComponent).join('/')} alt="" width={64} height={64} loading="lazy"/>}
          <label><span>원본: {row.originalName || row.supplierSku || `옵션 ${index + 1}`}</span><input aria-label={`${index + 1}번째 한국어 옵션명`} value={Object.hasOwn(draft.optionNames, row.id) ? draft.optionNames[row.id] : row.translatedName} maxLength={500} disabled={locked} onChange={event => edit(previous => ({ ...previous, optionNames: { ...previous.optionNames, [row.id]: event.target.value } }))}/><small>{row.included ? '견적 포함' : '견적 제외'} · {row.provenance.translatedName === 'manual' ? '직접 수정' : row.provenance.translatedName === 'translated' ? '번역 결과' : '미작성'}</small></label>
        </article>;
      })}{!view.options.rows.length && <p>저장된 옵션이 없습니다.</p>}</div></section>
    </div>}
    {!!issues.length && <p role="alert">{issues.join(' ')}</p>}
    {shownComparison && <section className="panel-stack" aria-label="다른 SEO 저장값 비교"><p>다른 저장값: {shownComparison.fields.join(', ')}</p><table><thead><tr><th>항목</th><th>최신 저장값</th><th>현재 입력</th></tr></thead><tbody>
      {(Object.keys(draft.seo) as (keyof SeoWorkspaceDraft['seo'])[]).map(key => <tr key={key}><th>{({ title: '상품명', keywords: '검색태그', description: '상품 설명' })[key]}</th><td>{key === 'keywords' ? shownComparison.latest.content.seo.keywords.value.join(', ') : shownComparison.latest.content.seo[key].value || '(공란)'}</td><td>{draft.seo[key] || '(공란)'}</td></tr>)}
      {Object.keys(draft.optionNames).map(id => <tr key={id}><th>{shownComparison.latest.options.rows.find(row => row.id === id)?.originalName || id}</th><td>{shownComparison.latest.options.rows.find(row => row.id === id)?.translatedName || '(공란)'}</td><td>{draft.optionNames[id] || '(공란)'}</td></tr>)}
    </tbody></table><button type="button" className="btn ghost" disabled={locked} onClick={reviewLatest}>입력 유지·비교한 최신 기준 사용</button></section>}
    <div className="quote-actions"><button type="button" className="btn primary" disabled={!view || disabled || busy || !dirty || !uncertain && (!fresh || conflict || !!issues.length)} onClick={() => void save()}>{uncertain ? 'SEO 저장 결과 확인' : 'SEO 설정 저장'}</button>
      {dirty && <button type="button" className="btn ghost" disabled={busy} onClick={() => void load(true, true)}>입력 유지·최신 SEO 조회</button>}
      <button type="button" className="btn ghost" disabled={busy} onClick={() => void load(false, true)}>{dirty ? '입력 취소·저장본 다시 조회' : 'SEO 저장본 다시 조회'}</button></div>
    <small>수정한 상품명·검색태그·한국어 옵션명을 함께 저장합니다. 공란도 직접 수정값으로 저장합니다.</small>
  </section>;
}
