'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { applyQuotationChanges, type QuotationChange, type QuotationFieldsView } from '@/app/quotation-schema';
import { optionSeoChanges, optionSeoDraftIssues, optionSeoValue, quotationSeoTargets, verifyOptionSeoRefresh, type OptionSeoDraft, type OptionSeoInput } from '@/app/quotation-seo-targets';

type Props = { productId: string; optionId: string; version: string; profileId?: string; refreshToken?: string; onSaved?: () => void; onCommonDescription?: () => void };
const fields = [['title', '상품명'], ['searchTags', '검색태그']] as const;
export function OptionSeoEditor({ productId, optionId, version, profileId, refreshToken, onSaved, onCommonDescription }: Props) {
  const endpoint = `/api/products/${encodeURIComponent(productId)}/quotation-fields${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`;
  const scope = JSON.stringify([endpoint, optionId]), sourceKey = JSON.stringify([scope, version, refreshToken]);
  const currentScope = useRef(scope);
  const currentSource = useRef(sourceKey);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true), pendingSave = useRef<{scope:string;before:QuotationFieldsView;changes:QuotationChange[];acknowledged?:QuotationFieldsView}|null>(null);
  const [saved, setSaved] = useState<{ scope: string; sourceKey: string; view: QuotationFieldsView } | null>(null);
  const [pending, setPending] = useState<{ scope: string; values: OptionSeoDraft }>({ scope, values: {} });
  const latestSaved = useRef<typeof saved>(null);
  const latestDraft = useRef({ scope, values: {} as OptionSeoDraft });
  useLayoutEffect(() => {
    // Commit the new identity before passive effects or a pending response can
    // publish state. Rendering reads only scoped React state, never these refs.
    mounted.current=true;currentScope.current = scope; currentSource.current = sourceKey;
    if (latestDraft.current.scope !== scope) latestDraft.current = { scope, values: {} };
    if(pendingSave.current?.scope!==scope)pendingSave.current=null;
    return () => { mounted.current=false;request.current?.abort(); request.current = null; };
  }, [scope, sourceKey]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [uncertain,setUncertain]=useState(false);
  const view = saved?.scope === scope ? saved.view : null, draft = pending.scope === scope ? pending.values : {};
  const dirty = Object.keys(draft).length > 0;
  const current = () => mounted.current&&currentScope.current === scope && currentSource.current === sourceKey;
  function verify(body: QuotationFieldsView, savedFrom?: QuotationFieldsView, explicitLatest=false) {
    if (!body || (!savedFrom && !explicitLatest && body.productVersion !== version) || !savedFrom&&!Number.isFinite(Date.parse(body.productVersion)) || !Number.isSafeInteger(body.revision) || body.revision < 0
      || ![body.contentRevision,body.optionRevision].every(value=>Number.isSafeInteger(value)&&value>=0)
      || !/^[a-f0-9]{64}$/.test(body.inputFingerprint) || !Array.isArray(body.imageKeys)
      || !body.overrides?.common || !body.overrides.options || !Array.isArray(body.resolved?.schema?.fields)
      || !Array.isArray(body.resolved.rows) || !Array.isArray(body.automatic?.rows)
      || body.resolved.rows.filter(row => row.optionId === optionId).length !== 1
      || body.automatic.rows.filter(row => row.optionId === optionId).length !== 1
      || (profileId && body.categoryContext?.profileId !== profileId)) throw Error('선택한 상품·옵션의 SEO 저장본을 확인하지 못했습니다. 상품을 다시 열어주세요.');
    const targets = quotationSeoTargets(body.resolved.schema.fields), row = body.resolved.rows.find(row => row.optionId === optionId)!;
    if (Object.values(targets).some(target => target.fields.some(field => field.readOnly || typeof row.fields[field.id]?.value !== 'string')))
      throw Error('선택 옵션의 SEO 입력 연결을 확인하지 못했습니다. 견적서 상세 항목을 확인해주세요.');
    if (savedFrom && (body.revision !== savedFrom.revision + 1 || body.updatedAt !== body.productVersion
      || !Number.isFinite(Date.parse(body.productVersion)) || !Number.isFinite(Date.parse(savedFrom.productVersion))
      || Date.parse(body.productVersion) <= Date.parse(savedFrom.productVersion)
      || body.contentRevision !== savedFrom.contentRevision || body.optionRevision !== savedFrom.optionRevision
      || JSON.stringify(body.imageKeys) !== JSON.stringify(savedFrom.imageKeys)
      || JSON.stringify(body.categoryContext) !== JSON.stringify(savedFrom.categoryContext)
      || JSON.stringify(targets) !== JSON.stringify(quotationSeoTargets(savedFrom.resolved.schema.fields))))
      throw Error('SEO 저장 버전을 확인하지 못했습니다. 입력을 유지하고 저장본을 다시 확인해주세요.');
  }
  function verifySave(before:QuotationFieldsView,body:QuotationFieldsView,changes:readonly QuotationChange[]) {
    verify(body,before);const stored=body.overrides.options[optionId]??{},row=body.resolved.rows.find(row=>row.optionId===optionId)!,automatic=body.automatic.rows.find(row=>row.optionId===optionId)!;
    if(JSON.stringify(body.overrides)!==JSON.stringify(applyQuotationChanges(before.overrides,changes)) || changes.some(change=>{
      const cell=row.fields[change.fieldKey];
      if(change.value!==null)return !Object.hasOwn(stored,change.fieldKey)||stored[change.fieldKey]!==change.value||cell?.value!==change.value;
      if(Object.hasOwn(stored,change.fieldKey)||!cell)return true;
      return Object.hasOwn(body.overrides.common,change.fieldKey)?cell.value!==body.overrides.common[change.fieldKey]||cell.source!=='manual-common'
        :cell.value!==automatic.fields[change.fieldKey]?.value||cell.source!==automatic.fields[change.fieldKey]?.source;
    }))throw Error('저장 응답의 선택 옵션 SEO가 요청한 값과 다릅니다. 입력을 유지하고 저장본을 다시 확인해주세요.');
  }
  function verifyRecovery(attempt:NonNullable<typeof pendingSave.current>,body:QuotationFieldsView) {
    verifySave(attempt.before,body,attempt.changes);
    if(JSON.stringify(body.automatic)!==JSON.stringify(attempt.before.automatic)||JSON.stringify(body.resolved.schema)!==JSON.stringify(attempt.before.resolved.schema)
      ||attempt.acknowledged&&(JSON.stringify(body.overrides)!==JSON.stringify(attempt.acknowledged.overrides)||JSON.stringify(body.resolved)!==JSON.stringify(attempt.acknowledged.resolved)
        ||body.productVersion!==attempt.acknowledged.productVersion||body.inputFingerprint!==attempt.acknowledged.inputFingerprint))throw Error('SEO 저장 후 원문·양식 또는 다른 저장값이 변경되었습니다. 입력은 유지했습니다.');
  }
  async function load(keepDraft = false) {
    if (request.current || !current()) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal }), body = await response.json() as QuotationFieldsView & { error?: string };
      if (controller.signal.aborted || !current()) return;
      const attempt=pendingSave.current?.scope===scope?pendingSave.current:null;
      if (!response.ok) throw Error(body.error || '옵션 SEO를 불러오지 못했습니다.'); verify(body,undefined,keepDraft||!!attempt);
      const editing = latestDraft.current.scope === scope ? latestDraft.current.values : {};
      let recovered=false;
      if (keepDraft) { const before = attempt?.before??(latestSaved.current?.scope === scope ? latestSaved.current.view : null); if (!before) throw Error('이전 SEO 입력 기준을 확인하지 못했습니다.');
        if(attempt){try{verifyRecovery(attempt,body);recovered=true;}catch(cause){if(JSON.stringify(body)!==JSON.stringify(before))throw cause;verifyOptionSeoRefresh(before,body,optionId,editing);}}
        else verifyOptionSeoRefresh(before, body, optionId, editing); }
      else if(attempt){verifyOptionSeoRefresh(attempt.before,body,optionId,{});if(Date.parse(body.productVersion)<Date.parse(attempt.before.productVersion)||body.contentRevision<attempt.before.contentRevision||body.optionRevision<attempt.before.optionRevision)throw Error('SEO 저장 원천이 이전 상태로 돌아갔습니다. 입력은 유지했습니다.');}
      latestSaved.current = { scope, sourceKey, view: body }; setSaved(latestSaved.current);
      pendingSave.current=null;setUncertain(false);
      if (!keepDraft||recovered) { latestDraft.current = { scope, values: {} }; setPending(latestDraft.current); }
      setMessage(recovered?'저장된 선택 옵션 SEO를 확인했습니다. 견적서에 반영됩니다.':keepDraft ? '입력을 유지하고 최신 자료를 읽었습니다. 확인 후 선택 옵션 SEO를 저장해주세요.' : '');if(recovered)onSaved?.();
    } catch (cause) { if (!controller.signal.aborted && current()) setError(cause instanceof Error ? cause.message : '옵션 SEO 조회 실패'); }
    finally { if (request.current === controller) { request.current = null; if (!controller.signal.aborted && current()) setBusy(false); } }
  }
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (!active || !current()) return; setBusy(false); setError('');setUncertain(pendingSave.current?.scope===scope); if (dirty && view) return; void load(); });
    return () => { active = false; request.current?.abort(); request.current = null; };
    // The endpoint/option identity and parent source version govern refreshes;
    // local edits are deliberately retained until explicit save or cancellation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, sourceKey]);
  function edit(input: OptionSeoInput, value: string | null) {
    if (!view || latestSaved.current?.view!==view || pendingSave.current?.scope===scope || request.current || !current()) return;
    latestDraft.current = { scope, values: { ...(latestDraft.current.scope === scope ? latestDraft.current.values : {}), [input]: value } };
    setPending(latestDraft.current); setMessage('');
  }
  let issues: string[] = [], bindingError = '';
  if (view) { try { issues = optionSeoDraftIssues(view, optionId, draft); } catch (cause) { bindingError = cause instanceof Error ? cause.message : 'SEO 연결 확인 필요'; } }
  async function save() {
    const base = latestSaved.current, editing = latestDraft.current.scope === scope ? latestDraft.current.values : {};
    if (!base || base.scope !== scope || !Object.keys(editing).length || request.current || !current()) return;
    if(pendingSave.current?.scope===scope){await load(true);return;}
    if (base.sourceKey !== sourceKey) { setError('상품 저장 상태가 변경됐습니다. 입력을 유지하고 최신 SEO 자료를 조회한 뒤 저장해주세요.'); return; }
    let changes; try { changes = optionSeoChanges(base.view, optionId, editing); } catch (cause) { setError(cause instanceof Error ? cause.message : 'SEO 입력을 확인해주세요.'); return; }
    const attempt={scope,before:base.view,changes:changes.map(change=>({...change}))} as NonNullable<typeof pendingSave.current>;pendingSave.current=attempt;setUncertain(true);
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setMessage('');
    let response:Response|undefined;
    try {
      response = await fetch(endpoint, { method: 'PUT', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: base.view.revision, expectedInputFingerprint: base.view.inputFingerprint, changes }) });
      let body = await response.json() as QuotationFieldsView & { error?: string };
      if (controller.signal.aborted || !current()) return;
      if (!response.ok) throw Error(body.error || 'SEO를 저장하지 못했습니다. 입력은 유지됩니다.');verifySave(base.view,body,changes);attempt.acknowledged=body;
      if(changes.some(change=>change.value===null)){const confirmation=await fetch(endpoint,{cache:'no-store',signal:controller.signal}),latest=await confirmation.json() as QuotationFieldsView & {error?:string};if(controller.signal.aborted||!current())return;if(!confirmation.ok)throw Error(latest.error||'SEO 복원 저장본을 확인하지 못했습니다. 입력은 유지됩니다.');verifyRecovery(attempt,latest);body=latest;}
      latestSaved.current = { scope, sourceKey, view: body }; latestDraft.current = { scope, values: {} };
      pendingSave.current=null;setUncertain(false);
      setSaved(latestSaved.current); setPending(latestDraft.current); setMessage('선택 옵션 SEO 저장 완료 · 견적서와 옵션별 표시사항에 반영됩니다.'); onSaved?.();
    } catch (cause) { if (!controller.signal.aborted && current()){if(response&&!response.ok&&response.status<500){pendingSave.current=null;setUncertain(false);}setError(cause instanceof Error ? cause.message : 'SEO 저장 실패');} }
    finally { if (request.current === controller) { request.current = null; if (!controller.signal.aborted && current()) setBusy(false); } }
  }
  const row = view?.resolved.rows.find(row => row.optionId === optionId);
  return <section className="panel-stack" aria-label="선택 옵션 SEO 편집" data-quotation-source-step="SEO" data-workspace-dirty={dirty} data-workspace-saving={busy}>
    <h3>선택 옵션 SEO</h3><p>{row?.optionLabel || optionId} · {row?.included === false ? '견적 제외 옵션' : '선택한 옵션'}</p>
    <p>상품명과 검색태그는 이 옵션에만 저장합니다. 다른 옵션과 상품 공통 SEO는 유지됩니다. 상세 설명은 상품 공통 자료이며 공통 SEO 편집에서 수정합니다.</p>
    {onCommonDescription && <button type="button" className="btn ghost" disabled={busy} onClick={onCommonDescription}>상품 공통 SEO·설명 편집</button>}
    {busy && <p role="status">옵션 SEO 처리 중…</p>}{error && <p role="alert">{error}</p>}{bindingError && <p role="alert">{bindingError}</p>}{message && <p role="status">{message}</p>}
    {dirty && saved?.sourceKey !== sourceKey && <p role="status">상품 저장 상태가 변경됐습니다. 입력은 유지했습니다. 최신 자료를 조회한 뒤 저장해주세요.</p>}
    {view && fields.map(([input, label]) => <label className="field" key={input}><span>{label}</span><textarea aria-label={`선택 옵션 ${label}`} value={optionSeoValue(view, optionId, input, draft)} disabled={busy || uncertain || !!bindingError} onChange={event => edit(input, event.target.value)} /><button type="button" className="btn ghost" disabled={busy || uncertain || !!bindingError} onClick={() => edit(input, null)}>{label} 공통·자동값 복원</button></label>)}
    <small>검색태그는 쉼표로 구분합니다. 공란도 직접 수정값으로 저장하며, 필수 상품명을 비우면 최종 견적서에서 수정이 필요합니다.</small>
    {!!issues.length && <p role="alert">{[...new Set(issues)].join(' ')}</p>}
    <button type="button" className="btn primary" disabled={!view || busy || !dirty || !!bindingError || !!issues.length} onClick={() => void save()}>{uncertain?'SEO 저장 결과 확인':'선택 옵션 SEO 저장'}</button>
    {dirty && <button type="button" className="btn ghost" disabled={busy} onClick={() => void load(true)}>입력 유지·최신 SEO 조회</button>}
    <button type="button" className="btn ghost" disabled={busy} onClick={() => void load()}>{dirty ? '입력 취소·저장 SEO 다시 조회' : '저장 SEO 다시 조회'}</button>
  </section>;
}
