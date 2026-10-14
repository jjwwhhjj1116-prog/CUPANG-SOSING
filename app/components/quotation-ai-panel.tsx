'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { quotationAiProposalChanges, quotationAiViewCurrent, type QuotationAiView, type QuotationAiJobView, type QuotationAiProposal } from '@/app/quotation-ai-client';

type Props = { productId: string; profileId?: string; view: QuotationFieldsView; optionId: string | null; disabled: boolean;
  onBusyChange?: (busy: boolean) => void; onApply: (changes: QuotationAiProposal[], fingerprint: string) => void };
export function QuotationAiPanel(props:Props){
  const {productId,profileId,view,optionId}=props;
  return <QuotationAiPanelContent key={JSON.stringify([productId,profileId,view.productVersion,view.contentRevision,view.optionRevision,view.revision,view.inputFingerprint,optionId])} {...props}/>;
}
function QuotationAiPanelContent({ productId, profileId, view, optionId, disabled, onBusyChange, onApply }: Props) {
  const sourceKey = JSON.stringify([productId, profileId ?? null, view.productVersion, view.contentRevision, view.optionRevision, view.revision,
    view.inputFingerprint, optionId]);
  const endpoint = `/api/products/${encodeURIComponent(productId)}/quotation-ai`, query = profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';
  const [state, setState] = useState<QuotationAiView | null>(null), [job, setJob] = useState<QuotationAiJobView | null>(null);
  const [all, setAll] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [endConfirmed, setEndConfirmed] = useState(false);
  const sequence = useRef(0), running = useRef<AbortController | null>(null), pending = useRef(false), source = useRef({ sourceKey, view, disabled, onApply });
  const callbacks = useRef(onBusyChange), ownedAi = useRef<AbortController | null>(null);
  useLayoutEffect(() => { callbacks.current = onBusyChange; }, [onBusyChange]);
  useLayoutEffect(() => {
    source.current = { sourceKey, view, disabled, onApply };
    return () => { source.current = { ...source.current, disabled: true }; };
  }, [sourceKey, view, disabled, onApply]);
  useLayoutEffect(() => {
    const invalidate=()=>{sequence.current++;running.current?.abort();pending.current=false;if(ownedAi.current){ownedAi.current=null;callbacks.current?.(false);}};
    return invalidate;
  }, [sourceKey]);
  async function load() {
    if (pending.current) return;
    const generation = ++sequence.current, key = source.current.sourceKey, controller = new AbortController(); running.current = controller;
    pending.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(endpoint + query, { cache: 'no-store', signal: controller.signal });
      const value = await response.json() as QuotationAiView & { error?: string };
      if (controller.signal.aborted || sequence.current !== generation || source.current.sourceKey !== key) return;
      if (!response.ok || !value.configuration || !Array.isArray(value.jobs)) throw Error(value.error || 'AI 초안을 조회하지 못했습니다.');
      if (!quotationAiViewCurrent(value, source.current.view, productId)) throw Error('최신 견적 입력을 먼저 불러오거나 저장해주세요.');
      setState(value); setJob(value.jobs.find(item => item.fingerprint === value.fingerprint && item.scope.optionId === optionId) ?? null);
    } catch (cause) { if (!controller.signal.aborted && sequence.current === generation) setError(cause instanceof Error ? cause.message : 'AI 초안 조회 실패'); }
    finally { if (sequence.current === generation) { pending.current = false; running.current = null; setBusy(false); } }
  }
  useEffect(() => {let cancelled=false;queueMicrotask(()=>{if(!cancelled)void load();});return()=>{cancelled=true;}; /* One read per source; provider is called only by the button. */ }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  async function generate() {
    if (pending.current || source.current.disabled || optionId === null && !all || !state?.configuration.configured || !quotationAiViewCurrent(state, source.current.view, productId)) return;
    const generation = ++sequence.current, key = source.current.sourceKey, controller = new AbortController(); running.current = controller;
    pending.current = true; ownedAi.current=controller;setBusy(true); setError(''); callbacks.current?.(true);
    try {
      const response = await fetch(endpoint, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'generate', profileId: profileId ?? null, expectedFingerprint: state.fingerprint,
          expectedQuotationRevision: source.current.view.revision, optionId, applyToAllOptions: all, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json() as { job?: QuotationAiJobView; sourceCurrent?: boolean; error?: string };
      if (controller.signal.aborted || sequence.current !== generation || source.current.sourceKey !== key) return;
      if (!response.ok || !result.job) throw Error(result.error || 'AI 실행 결과를 확인하지 못했습니다. 새 요청 없이 결과를 조회해주세요.');
      setJob(result.job);
      if (result.sourceCurrent === false) {setState(null);setError('AI 작성 중 저장값이 바뀌었습니다. 최신 견적서를 확인해주세요.');}
      else if (result.job.status !== 'completed') setError(result.job.error?.message || '이 실행 결과를 먼저 조회해주세요. 같은 요청을 다시 실행하지 않습니다.');
    } catch (cause) { if (!controller.signal.aborted && sequence.current === generation) setError(cause instanceof Error ? cause.message : 'AI 실행 결과 조회 실패'); }
    finally { if (sequence.current === generation) { pending.current = false; running.current = null; setBusy(false);if(ownedAi.current===controller){ownedAi.current=null;callbacks.current?.(false);} } }
  }
  const unsettled = job?.status === 'running' || job?.status === 'uncertain';
  const canClose = job?.status === 'uncertain' || job?.status === 'running' && job.canClose === true;
  async function closeUncertain() {
    if(pending.current||source.current.disabled||!job||!canClose||!endConfirmed)return;
    const generation=++sequence.current,key=source.current.sourceKey,controller=new AbortController();running.current=controller;pending.current=true;setBusy(true);setError('');
    try{
      const response=await fetch(endpoint,{method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({action:'close-uncertain',jobId:job.id,confirmed:true})});
      const value=await response.json() as {job?:QuotationAiJobView;error?:string};
      if(controller.signal.aborted||generation!==sequence.current||key!==source.current.sourceKey)return;
      if(!response.ok||!value.job||value.job.id!==job.id||value.job.status!=='failed')throw Error(value.error||'이전 실행의 종료를 확인하지 못했습니다.');
      setJob(value.job);setEndConfirmed(false);
    }catch(cause){if(!controller.signal.aborted&&generation===sequence.current)setError(cause instanceof Error?cause.message:'실행 종료 확인 실패');}
    finally{if(generation===sequence.current){pending.current=false;running.current=null;setBusy(false);}}
  }
  let proposals: QuotationAiProposal[] = [], invalid = '';
  if (job?.status === 'completed' && state) try { proposals = quotationAiProposalChanges(view, job, state.fingerprint); }
  catch (cause) { invalid = cause instanceof Error ? cause.message : '초안을 다시 확인해주세요.'; }
  return <section className="quotation-fields-notice" aria-label="견적서 AI 작성" aria-busy={busy}>
    <div className="quote-actions"><button type="button" className="btn primary" disabled={disabled || busy || unsettled || optionId === null && !all || !state?.configuration.configured}
      onClick={() => void generate()}>{busy ? 'AI 작성 중…' : 'AI 처리'}</button>
      <label><input type="checkbox" checked={all} disabled={disabled || busy} onChange={event => setAll(event.target.checked)}/> 모든 포함 옵션 작성</label>
      <button type="button" className="btn ghost" disabled={busy} onClick={() => void load()}>실행 결과 조회</button></div>
    <p>선택 카테고리와 저장한 상품정보로 초안을 작성합니다. 직접 수정한 값은 유지됩니다. 실제 규격·인증은 확인한 자료로 입력하세요.</p>
    {optionId === null && !all && <p>작성할 옵션을 선택하거나 모든 포함 옵션 작성을 선택하세요.</p>}
    {state && !state.configuration.configured && <p role="status">무료 견적 AI 서비스가 아직 연결되지 않았습니다.</p>}
    {canClose && <div><label><input type="checkbox" checked={endConfirmed} disabled={busy||disabled} onChange={event=>setEndConfirmed(event.target.checked)}/> 이전 실행의 결과를 사용할 수 없음을 확인하고 종료합니다.</label><button type="button" className="btn ghost" disabled={busy||disabled||!endConfirmed} onClick={()=>void closeUncertain()}>불확실한 이전 실행 종료</button></div>}
    {error && <p role="alert">{error}</p>}{invalid && <p role="alert">{invalid}</p>}
    {job?.status === 'completed' && <><p>AI 초안 {proposals.length}개 · 내용을 확인하고 입력란에 적용하세요.</p>
      {job.result?.warnings.length ? <ul>{job.result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
      <div className="quotation-fields-bulk-table"><table><thead><tr><th>옵션 · 항목</th><th>현재 값</th><th>AI 초안</th></tr></thead><tbody>{proposals.map(change => {
        const row = view.resolved.rows.find(item => item.optionId === change.optionId), field = view.resolved.schema.fields.find(item => item.id === change.fieldKey);
        return <tr key={JSON.stringify([change.optionId, change.fieldKey])}><td>{row?.optionLabel} · {field?.label}</td><td>{row?.fields[change.fieldKey]?.value || '(공란)'}</td><td>{change.value || '(공란)'}</td></tr>;
      })}</tbody></table></div><button type="button" className="btn primary" disabled={disabled || busy || !proposals.length || Boolean(invalid)} onClick={() => {
        if (pending.current || source.current.disabled || !state || source.current.sourceKey !== sourceKey) return;
        try { source.current.onApply(quotationAiProposalChanges(source.current.view, job, state.fingerprint), state.fingerprint); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '초안을 다시 확인해주세요.'); }
      }}>검토한 초안 입력란에 적용</button></>}
  </section>;
}
