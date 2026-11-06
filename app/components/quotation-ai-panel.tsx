'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { quotationReviewedProposalChanges, quotationAiJobForScope, quotationAiViewCurrent, type QuotationAiView, type QuotationAiJobView, type QuotationAiProposal } from '@/app/quotation-ai-client';

export type QuotationAiRequestAction = { requestDraft: () => void; disabled: boolean; applyToAllOptions: boolean; sourceKey: string; readonly scopeLocked?: boolean };
type RequestProof = { sourceKey: string; body: string; profileId: string | null };
function matchingReceipt(job: QuotationAiJobView | undefined, proof: RequestProof): job is QuotationAiJobView {
  const input = JSON.parse(proof.body) as { expectedFingerprint: string; expectedQuotationRevision: number; optionId: string | null; applyToAllOptions: boolean };
  return !!job && typeof job.id === 'string' && !!job.id && ['prepared', 'running', 'completed', 'failed', 'uncertain'].includes(job.status)
    && job.fingerprint === input.expectedFingerprint && job.quotationRevision === input.expectedQuotationRevision && job.profileId === proof.profileId
    && job.scope?.optionId === input.optionId && job.scope?.applyToAllOptions === input.applyToAllOptions;
}
type Props = { productId: string; profileId?: string; view: QuotationFieldsView; optionId: string | null; disabled: boolean;
  applyToAllOptions?: boolean; onApplyToAllOptionsChange?: (next: boolean) => void;
  onBusyChange?: (busy: boolean) => void; onApply: (changes: QuotationAiProposal[], fingerprint: string, jobId: string) => void;
  onRequestActionChange?: (next: QuotationAiRequestAction | null, retired?: QuotationAiRequestAction) => void };
export function QuotationAiPanel(props:Props){
  const {productId,profileId,view,optionId}=props;
  // A source/option remount must not forget a POST whose acknowledgement was lost.
  const requestProofRef = useRef<RequestProof | null>(null);
  return <QuotationAiPanelContent key={JSON.stringify([productId,profileId,view.productVersion,view.contentRevision,view.optionRevision,view.revision,view.inputFingerprint,optionId])} {...props} requestProofRef={requestProofRef}/>;
}
function QuotationAiPanelContent({ productId, profileId, view, optionId, disabled, applyToAllOptions, onApplyToAllOptionsChange, onBusyChange, onApply, onRequestActionChange, requestProofRef }: Props & { requestProofRef: { current: RequestProof | null } }) {
  const sourceKey = JSON.stringify([productId, profileId ?? null, view.productVersion, view.contentRevision, view.optionRevision, view.revision,
    view.inputFingerprint, optionId]);
  const endpoint = `/api/products/${encodeURIComponent(productId)}/quotation-ai`, query = profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';
  const [state, setState] = useState<QuotationAiView | null>(null), [job, setJob] = useState<QuotationAiJobView | null>(null);
  const [localAll, setAll] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const all = applyToAllOptions ?? localAll;
  const [endConfirmed, setEndConfirmed] = useState(false);
  const [scopeToken, setScopeToken] = useState<object>({});
  const liveScopeToken = useRef(scopeToken);
  const scopeTicket = useCallback(() => all, [all]);
  const scopeBasis = useRef(scopeTicket);
  useLayoutEffect(() => { scopeBasis.current = scopeTicket; }, [scopeTicket]);
  const [unknownRequest, setUnknownRequest] = useState(false);
  const sequence = useRef(0), running = useRef<AbortController | null>(null), pending = useRef(false), source = useRef({ sourceKey, view, disabled, onApply, all });
  const callbacks = useRef(onBusyChange), ownedAi = useRef<AbortController | null>(null);
  const currentJob = useRef<QuotationAiJobView | null>(null), publishedRequest = useRef<QuotationAiRequestAction | null>(null);
  function changeJob(next: QuotationAiJobView | null) { currentJob.current = next; setJob(next); }
  useLayoutEffect(() => {
    if (pending.current || requestProofRef.current || currentJob.current?.status === 'running' || currentJob.current?.status === 'uncertain') return;
    const next = state ? quotationAiJobForScope(state, view, productId, optionId, all) : null;
    currentJob.current = next; setJob(next);
  }, [all, state, view, productId, optionId, requestProofRef]);
  useLayoutEffect(() => { liveScopeToken.current = scopeToken; }, [scopeToken]);
  useLayoutEffect(() => { callbacks.current = onBusyChange; }, [onBusyChange]);
  useLayoutEffect(() => {
    source.current = { sourceKey, view, disabled, onApply, all };
    return () => { source.current = { ...source.current, disabled: true }; };
  }, [sourceKey, view, disabled, onApply, all]);
  useLayoutEffect(() => {
    const invalidate=()=>{sequence.current++;running.current?.abort();pending.current=false;if(ownedAi.current){ownedAi.current=null;callbacks.current?.(false);}};
    return invalidate;
  }, [sourceKey]);
  async function load() {
    if (pending.current) return;
    const generation = ++sequence.current, key = source.current.sourceKey, controller = new AbortController(); running.current = controller;
    pending.current = true; setBusy(true); setError('');
    try {
      const proof = requestProofRef.current, idempotencyKey = proof ? (JSON.parse(proof.body) as { idempotencyKey: string }).idempotencyKey : null;
      if (proof) setUnknownRequest(true);
      const lookup = proof ? `${proof.profileId ? `?profileId=${encodeURIComponent(proof.profileId)}&` : '?'}idempotencyKey=${encodeURIComponent(idempotencyKey!)}` : query;
      const response = await fetch(endpoint + lookup, { cache: 'no-store', signal: controller.signal });
      const value = await response.json() as QuotationAiView & { error?: string; idempotencyKey?: string };
      if (controller.signal.aborted || sequence.current !== generation || source.current.sourceKey !== key) return;
      if (!response.ok || !value.configuration || !Array.isArray(value.jobs)) throw Error(value.error || 'AI 초안을 조회하지 못했습니다.');
      if (!quotationAiViewCurrent(value, source.current.view, productId)) throw Error('최신 견적 입력을 먼저 불러오거나 저장해주세요.');
      if (proof) {
        if (requestProofRef.current !== proof || value.idempotencyKey !== idempotencyKey || value.jobs.length !== 1 || !matchingReceipt(value.jobs[0], proof))
          throw Error('이전 AI 요청의 정확한 결과 연결이 아직 확인되지 않았습니다. 새 요청 없이 실행 결과를 조회해주세요.');
        if (value.jobs[0].status !== 'prepared') { requestProofRef.current = null; setUnknownRequest(false); }
        else setError('원래 AI 요청이 아직 준비 상태입니다. 새 요청 없이 실행 결과를 다시 조회해주세요.');
      }
      setState(value); changeJob(quotationAiJobForScope(value, source.current.view, productId, optionId, all));
    } catch (cause) { if (!controller.signal.aborted && sequence.current === generation) setError(cause instanceof Error ? cause.message : 'AI 초안 조회 실패'); }
    finally { if (sequence.current === generation) { pending.current = false; running.current = null; setBusy(false); } }
  }
  useEffect(() => {let cancelled=false;queueMicrotask(()=>{if(!cancelled)void load();});return()=>{cancelled=true;}; /* One read per source; provider is called only by the button. */ }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  function canGenerate() {
    return !pending.current && !requestProofRef.current && !source.current.disabled && source.current.sourceKey === sourceKey && source.current.view === view && source.current.all === all && scopeBasis.current === scopeTicket
      && currentJob.current?.status !== 'running' && currentJob.current?.status !== 'uncertain'
      && (all || optionId !== null && view.resolved.rows.some(row => row.optionId === optionId && row.included))
      && !!state?.configuration.configured && quotationAiViewCurrent(state, source.current.view, productId);
  }
  async function generate() {
    if (!canGenerate() || !state) return;
    const generation = ++sequence.current, key = source.current.sourceKey, controller = new AbortController(); running.current = controller;
    pending.current = true; ownedAi.current=controller;setBusy(true); setError(''); callbacks.current?.(true);
    const body = JSON.stringify({ action: 'generate', profileId: profileId ?? null, expectedFingerprint: state.fingerprint,
      expectedQuotationRevision: source.current.view.revision, optionId, applyToAllOptions: all, idempotencyKey: crypto.randomUUID() });
    const proof = { sourceKey: key, body, profileId: state.profileId }; requestProofRef.current = proof;
    try {
      const response = await fetch(endpoint, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' },
        body });
      const result = await response.json() as { job?: QuotationAiJobView; sourceCurrent?: boolean; error?: string };
      if (controller.signal.aborted || sequence.current !== generation || source.current.sourceKey !== key) return;
      if (!response.ok || !matchingReceipt(result.job, proof)) throw Error(result.error || 'AI 실행 결과의 요청 연결을 확인하지 못했습니다. 새 요청 없이 결과를 조회해주세요.');
      if (result.job.status === 'prepared') { changeJob(result.job); throw Error('원래 AI 요청이 아직 준비 상태입니다. 새 요청 없이 실행 결과를 조회해주세요.'); }
      if (requestProofRef.current === proof) requestProofRef.current = null; setUnknownRequest(false); changeJob(result.job);
      setState(current => current ? { ...current, jobs: [result.job!, ...current.jobs.filter(item => item.id !== result.job!.id)] } : current);
      if (result.sourceCurrent === false) {setState(null);setError('AI 작성 중 저장값이 바뀌었습니다. 최신 견적서를 확인해주세요.');}
      else if (result.job.status !== 'completed') setError(result.job.error?.message || '이 실행 결과를 먼저 조회해주세요. 같은 요청을 다시 실행하지 않습니다.');
    } catch (cause) { if (!controller.signal.aborted && sequence.current === generation) { setUnknownRequest(Boolean(requestProofRef.current)); setError(cause instanceof Error ? cause.message : 'AI 실행 결과 조회 실패'); } }
    finally { if (sequence.current === generation) { pending.current = false; running.current = null; setBusy(false);if(ownedAi.current===controller){ownedAi.current=null;callbacks.current?.(false);} } }
  }
  const unsettled = unknownRequest || job?.status === 'running' || job?.status === 'uncertain';
  const requestDisabled = disabled || busy || unsettled || !state?.configuration.configured || !quotationAiViewCurrent(state, view, productId)
    || !all && (optionId === null || !view.resolved.rows.some(row => row.optionId === optionId && row.included));
  const canClose = !unknownRequest && (job?.status === 'uncertain' || job?.status === 'running' && job.canClose === true);
  async function closeUncertain() {
    if(pending.current||source.current.disabled||!job||!canClose||!endConfirmed)return;
    const generation=++sequence.current,key=source.current.sourceKey,controller=new AbortController();running.current=controller;pending.current=true;setBusy(true);setError('');
    try{
      const response=await fetch(endpoint,{method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({action:'close-uncertain',jobId:job.id,confirmed:true})});
      const value=await response.json() as {job?:QuotationAiJobView;error?:string};
      if(controller.signal.aborted||generation!==sequence.current||key!==source.current.sourceKey)return;
      if(!response.ok||!value.job||value.job.id!==job.id||value.job.status!=='failed')throw Error(value.error||'이전 실행의 종료를 확인하지 못했습니다.');
      changeJob(value.job);setState(current=>current?{...current,jobs:current.jobs.map(item=>item.id===value.job!.id?value.job!:item)}:current);setEndConfirmed(false);
    }catch(cause){if(!controller.signal.aborted&&generation===sequence.current)setError(cause instanceof Error?cause.message:'실행 종료 확인 실패');}
    finally{if(generation===sequence.current){pending.current=false;running.current=null;setBusy(false);}}
  }
  useEffect(() => {
    if (!onRequestActionChange) return;
    const action: QuotationAiRequestAction = { disabled: requestDisabled || !canGenerate(), applyToAllOptions: all, sourceKey,
      get scopeLocked() { return pending.current || Boolean(requestProofRef.current) || currentJob.current?.status === 'running' || currentJob.current?.status === 'uncertain'; },
      requestDraft: () => { if (publishedRequest.current === action && !action.disabled && canGenerate()) void generate(); } };
    publishedRequest.current = action; onRequestActionChange(action);
    return () => { if (publishedRequest.current === action) publishedRequest.current = null; onRequestActionChange(null, action); };
    // Publish after parent layout setup; only this exact source/scope capability can request a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, view, disabled, busy, state, job, all, requestDisabled, onRequestActionChange]);
  let proposals: QuotationAiProposal[] = [], invalid = '';
  if (state && !unsettled && (all || optionId !== null)) try { proposals = quotationReviewedProposalChanges(state, view, productId, job?.status === 'completed' ? job : null, optionId, all); }
  catch (cause) { invalid = cause instanceof Error ? cause.message : '초안을 다시 확인해주세요.'; }
  return <section className="quotation-fields-notice" aria-label="견적서 AI 작성" aria-busy={busy}>
    <div className="quote-actions"><button type="button" className="btn primary" disabled={requestDisabled}
      onClick={() => void generate()}>{busy ? 'AI 작성 중…' : 'AI 처리'}</button>
      <label><input type="checkbox" checked={all} disabled={disabled || busy || unsettled} onChange={event => {
        if(pending.current||requestProofRef.current||source.current.disabled||unsettled||currentJob.current?.status==='running'||currentJob.current?.status==='uncertain'
          ||source.current.sourceKey!==sourceKey||source.current.view!==view||source.current.all!==all||liveScopeToken.current!==scopeToken)return;
        const next=event.target.checked;if(next===all)return;const token={};liveScopeToken.current=token;setScopeToken(token);
        if(applyToAllOptions===undefined)setAll(next);else onApplyToAllOptionsChange?.(next);
        setEndConfirmed(false);setError('');
        source.current = { ...source.current, all: next }; changeJob(state?quotationAiJobForScope(state,source.current.view,productId,optionId,next):null);
      }}/> 모든 포함 옵션 작성</label>
      <button type="button" className="btn ghost" disabled={busy} onClick={() => void load()}>실행 결과 조회</button></div>
    <p>선택 카테고리와 저장한 상품정보로 초안을 작성합니다. 직접 수정한 값은 유지됩니다. 실제 규격·인증은 확인한 자료로 입력하세요.</p>
    <p>작성·적용 범위: {all ? '모든 포함 옵션' : '선택 옵션'}. 내용을 확인한 뒤 입력란에 적용하고 저장하세요.</p>
    {optionId === null && !all && <p>작성할 옵션을 선택하거나 모든 포함 옵션 작성을 선택하세요.</p>}
    {state && !state.configuration.configured && <p role="status">무료 견적 AI 서비스가 아직 연결되지 않았습니다.</p>}
    {unknownRequest && <p role="alert">이전 AI 요청의 결과가 미확정입니다. 중복 요청·초안 적용을 잠갔습니다. 새 요청 없이 실행 결과 조회만 사용해주세요.</p>}
    {canClose && <div><label><input type="checkbox" checked={endConfirmed} disabled={busy||disabled} onChange={event=>setEndConfirmed(event.target.checked)}/> 이전 실행의 결과를 사용할 수 없음을 확인하고 종료합니다.</label><button type="button" className="btn ghost" disabled={busy||disabled||!endConfirmed} onClick={()=>void closeUncertain()}>불확실한 이전 실행 종료</button></div>}
    {error && <p role="alert">{error}</p>}{invalid && <p role="alert">{invalid}</p>}
    {(job?.status === 'completed' || proposals.length > 0) && <><p>검토 제안 {proposals.length}개 · 저장 정보와 AI 초안을 확인하고 입력란에 적용하세요.</p>
      {state?.knownChanges?.length ? <p>‘저장 정보’는 표시사항·옵션의 저장값을 적용합니다. 초기 ‘해당사항없음’과 수량 단위를 채우며, 6단계 수정은 견적서의 이전 자동값이 그대로일 때 반영합니다. 견적서에서 직접 입력한 값·공란은 유지합니다.</p> : null}
      {job?.result?.warnings.length ? <ul>{job.result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
      <div className="quotation-fields-bulk-table"><table><thead><tr><th>옵션 · 항목</th><th>현재 값</th><th>적용 제안</th><th>출처</th></tr></thead><tbody>{proposals.map(change => {
        const row = view.resolved.rows.find(item => item.optionId === change.optionId), field = view.resolved.schema.fields.find(item => item.id === change.fieldKey);
        const known = state?.knownChanges?.some(item => item.optionId === change.optionId && item.fieldKey === change.fieldKey);
        return <tr key={JSON.stringify([change.optionId, change.fieldKey])}><td>{row?.optionLabel} · {field?.label}</td><td>{row?.fields[change.fieldKey]?.value || '(공란)'}</td><td>{change.value || '(공란)'}</td><td>{known ? '저장 정보' : 'AI 초안'}</td></tr>;
      })}</tbody></table></div><button type="button" className="btn primary" disabled={disabled || busy || !proposals.length || Boolean(invalid)} onClick={() => {
        if (pending.current || requestProofRef.current || currentJob.current?.status === 'running' || currentJob.current?.status === 'uncertain' || currentJob.current !== job || source.current.disabled || !state || source.current.sourceKey !== sourceKey
          || source.current.view !== view || source.current.all !== all || liveScopeToken.current !== scopeToken || scopeBasis.current !== scopeTicket) return;
        try { source.current.onApply(quotationReviewedProposalChanges(state, source.current.view, productId, job?.status === 'completed' ? job : null, optionId, all), state.fingerprint, job!.id); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '초안을 다시 확인해주세요.'); }
      }}>검토한 초안 입력란에 적용</button></>}
  </section>;
}
