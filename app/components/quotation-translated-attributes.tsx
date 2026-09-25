'use client';
import { useEffect, useRef, useState } from 'react';
import type { TranslationJob, TranslationView } from '@/app/automation/translation';
import type { QuotationChange, QuotationFieldsView } from '@/app/quotation-schema';
import { canMapTranslatedAttribute, quotationAttributeDisplay, quotationTranslationDraft, quotationTranslationBatch, quotationTranslationMatches } from '@/app/quotation-translation-adoption';
import { ATTRIBUTE_RULE_LIMIT, createAttributeRules, loadAttributeRules } from '@/app/quotation-attribute-rules';
import { fetchAttributeSuggestions, fetchBatchAttributeSuggestions } from '@/app/quotation-attribute-suggestions';

export function QuotationTranslatedAttributes({ productId, view, optionId, disabled, onApply }: {
  productId: string; view: QuotationFieldsView; optionId: string | null; disabled: boolean; onApply: (changes: QuotationChange[]) => void;
}) {
  const [jobs, setJobs] = useState<TranslationJob[]>([]);
  const [jobId, setJobId] = useState('');
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [ruleReport, setRuleReport] = useState<string[]>([]);
  const [serverRevision, setServerRevision] = useState<number | null>(null);
  const [batch, setBatch] = useState<{ key: string; plan: ReturnType<typeof quotationTranslationBatch> } | null>(null);
  const [excludedTargets, setExcludedTargets] = useState<(string | null)[]>([]);
  const [reviewedRevision,setReviewedRevision]=useState<number|null>(null);
  const review=reviewedRevision===view.contentRevision?{contentRevision:view.contentRevision}:undefined;
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { activeRequest.current?.abort(); }, []);
  async function runRequest(work: (signal: AbortSignal) => Promise<void>) {
    if (disabled || loading || activeRequest.current) return;
    const controller = new AbortController(); activeRequest.current = controller;
    setLoading(true);
    try { await work(controller.signal); }
    catch (cause) { if (!controller.signal.aborted) setMessage(cause instanceof Error ? cause.message : '요청 처리 실패'); }
    finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  const optionRows = view.resolved.rows.filter(item => item.optionId !== null);
  const batchTargets = (optionRows.length ? optionRows : view.resolved.rows).filter(item => item.included);
  const selectedTargets = batchTargets.filter(item => !excludedTargets.includes(item.optionId)).map(item => item.optionId);
  const batchKey = JSON.stringify([jobId, mapping, view.inputFingerprint, view.revision, optionId, selectedTargets, reviewedRevision]);
  const batchPlan = batch?.key === batchKey ? batch.plan : null;
  const job = jobs.find(item => item.id === jobId);
  const row = view.resolved.rows.find(item => item.optionId === optionId);
  const fields = view.resolved.schema.fields.filter(canMapTranslatedAttribute);
  const attributes = job?.result?.draft.attributes.filter(item => job.review.source.attributes[item.sourceIndex]?.name.startsWith('상품속성: ')) ?? [];
  async function suggest(selected: TranslationJob, signal: AbortSignal) {
    const result = await fetchAttributeSuggestions(productId, view, selected, optionId, (url, init) => fetch(url, { ...init, signal }), review);
    if (signal.aborted) return;
    setMapping(result.mapping); setServerRevision(result.revision); setRuleReport(result.skipped); setMessage(result.message);
  }
  async function selectJob(id: string) {
    if (disabled || loading || activeRequest.current) return;
    const selected = jobs.find(item => item.id === id);
    setJobId(id); setMapping({}); setServerRevision(null); setRuleReport([]); setMessage('');
    if (!selected) return;
    await runRequest(signal => suggest(selected, signal));
  }
  async function load() {
    await runRequest(async signal => {
      setMessage('');
      const response = await fetch(`/api/products/${encodeURIComponent(productId)}/translation`, { cache: 'no-store', signal });
      const body = await response.json() as TranslationView & { error?: string };
      if (signal.aborted) return;
      if (!response.ok) throw new Error(body.error || '번역 결과 조회 실패');
      const available = body.jobs.filter(item => quotationTranslationMatches(productId, view, item, review));
      setJobs(available); setJobId(available[0]?.id ?? ''); setMapping({}); setServerRevision(null); setRuleReport([]);
      if (available.length) await suggest(available[0], signal);
      else setMessage('현재 상품·콘텐츠와 일치하는 완료된 번역 결과가 없습니다.');
    });
  }
  function apply() {
    if (!job || disabled || loading || activeRequest.current) return;
    try {
      const selected = Object.entries(mapping).filter(([, fieldId]) => fieldId).map(([index, fieldId]) => ({ sourceIndex: Number(index), fieldId }));
      const changes = quotationTranslationDraft(productId, view, job, optionId, selected, review);
      onApply(changes); setMapping({}); setMessage(`${changes.length}개 항목을 작성 중인 견적에 반영했습니다. 견적 입력 저장으로 확정해주세요.`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '연결 항목을 확인해주세요.'); }
  }
  function previewBatch() {
    if (!job || disabled || loading || activeRequest.current) return;
    setBatch(null);
    try {
      const selected = Object.entries(mapping).filter(([, fieldId]) => fieldId).map(([index, fieldId]) => ({ sourceIndex: Number(index), fieldId }));
      setBatch({ key: batchKey, plan: quotationTranslationBatch(productId, view, job, selected, selectedTargets, review) });
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '일괄 연결 항목을 확인해주세요.'); }
  }
  async function suggestBatch() {
    if (!job || disabled || loading || activeRequest.current) return;
    await runRequest(async signal => {
      setBatch(null);
      const result = await fetchBatchAttributeSuggestions(productId, view, job, selectedTargets, (url, init) => fetch(url, { ...init, signal }), review);
      if (signal.aborted) return;
      const selected = Object.entries(result.mapping).map(([index, fieldId]) => ({ sourceIndex: Number(index), fieldId }));
      setMapping(result.mapping); setServerRevision(result.revision); setRuleReport(result.skipped);
      if (!selected.length) { setMessage('선택한 옵션에 자동 연결할 속성이 없습니다. 직접 수정값과 카테고리 규칙을 확인해주세요.'); return; }
      const plan = quotationTranslationBatch(productId, view, job, selected, selectedTargets, review);
      setBatch({ key: JSON.stringify([jobId, result.mapping, view.inputFingerprint, view.revision, optionId, selectedTargets, reviewedRevision]), plan });
      setMessage(`카테고리 규칙으로 ${selectedTargets.length}개 옵션을 확인했습니다. 변경 전·후 값을 검토한 뒤 초안에 반영해주세요.`);
    });
  }
  function downloadRules() {
    if (!job || disabled || loading || activeRequest.current) return;
    try {
      const selected = Object.entries(mapping).filter(([, fieldId]) => fieldId).map(([index, fieldId]) => ({ sourceIndex: Number(index), fieldId }));
      const rules = createAttributeRules(productId, view, job, optionId, selected, review);
      const url = URL.createObjectURL(new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'sourceflow-attribute-rules.json';
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('연결 규칙 파일을 만들었습니다. 상품 원문 값과 번역값은 포함하지 않습니다.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '규칙 저장 실패'); }
  }
  async function importRules(file?: File) {
    if (!file || !job || disabled || loading) return;
    await runRequest(async signal => {
      setRuleReport([]);
      if (file.size > ATTRIBUTE_RULE_LIMIT) throw new Error('연결 규칙은 64KB 이하여야 합니다.');
      const source = await file.text();
      if (signal.aborted) return;
      const result = loadAttributeRules(source, productId, view, job, optionId, review);
      setMapping(Object.fromEntries(result.mappings.map(item => [item.sourceIndex, item.fieldId])));
      setRuleReport(result.skipped); setMessage(`${result.mappings.length}개 연결을 선택했습니다. 변경 전·후 값을 검토한 뒤 초안에 반영해주세요.`);
    });
  }
  async function serverRules(save: boolean) {
    if (!job || disabled || loading || !view.resolved.schema.categoryId) return;
    await runRequest(async signal => {
      setRuleReport([]);
      if (!save) {
        // Use the same validated read path as initial suggestions. Empty or failed
        // reads must clear the previous selection and its stale save revision.
        await suggest(job, signal);
        return;
      }
      const endpoint = '/api/quotation-attribute-rules';
      if (serverRevision === null) throw new Error('먼저 서버 규칙을 불러와주세요.');
      const selected = Object.entries(mapping).filter(([, fieldId]) => fieldId).map(([index, fieldId]) => ({ sourceIndex: Number(index), fieldId }));
      const rules = createAttributeRules(productId, view, job, optionId, selected, review);
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules, expectedRevision: serverRevision }), signal });
      const body = await response.json() as { error?: string; revision: number; rules: unknown };
      if (signal.aborted) return;
      if (!response.ok) { if (response.status === 409) setServerRevision(null); throw new Error(body.error || '서버 규칙 처리 실패'); }
      setServerRevision(body.revision);
      setMessage(`카테고리 연결 규칙 v${body.revision}을 서버에 저장했습니다. 상품값은 변경하지 않았습니다.`);
    });
  }
  return <details className="panel-stack"><summary>번역한 상품 속성을 견적 항목에 연결</summary>
    <p>대상: {row?.optionLabel ?? '옵션 미선택'} · {view.resolved.schema.categoryPath.join(' > ')}. 연결할 항목과 변경 전·후 값을 확인해주세요. 기존 직접 수정값은 보존합니다.</p>
    <button type="button" className="btn ghost" disabled={disabled || loading} onClick={() => void load()}>완료된 속성 번역 불러오기 · 무료 조회</button>
    <label><input type="checkbox" checked={!!review} disabled={disabled||loading} onChange={event=>{setReviewedRevision(event.target.checked?view.contentRevision:null);setJobs([]);setJobId('');setMapping({});setBatch(null);setServerRevision(null);setRuleReport([]);setMessage('조회 범위를 변경했습니다. 완료된 속성 번역을 다시 불러와주세요.');}}/>SEO·표시사항 저장 전의 번역도 검토하여 사용</label><p>이전 콘텐츠 버전의 번역은 현재 값과 비교 후 반영합니다. 다른 상품·상품 버전은 사용할 수 없으며 직접 수정한 견적값은 유지됩니다.</p>{job&&job.contentRevision!==view.contentRevision&&<p role="status">이전 콘텐츠 v{job.contentRevision} 번역 · 현재 v{view.contentRevision}. 원문 속성이 현재 상품에도 맞는지 확인해주세요.</p>}    {message && <p role="status">{message}</p>}
    {ruleReport.length > 0 && <ul>{ruleReport.map((item,index)=><li key={index}>{item}</li>)}</ul>}
    <fieldset disabled={disabled || loading} style={{ border: 0, padding: 0 }}>
      {jobs.length > 0 && <label>번역 결과<select value={jobId} onChange={event => void selectJob(event.target.value)}>
        {jobs.map(item => <option key={item.id} value={item.id}>{item.result?.generatedAt} · {item.id}</option>)}
      </select></label>}
      {job && attributes.length === 0 && <p>이 결과에는 수집 상품 속성 번역이 없습니다. 옵션 번역은 옵션 편집 기능에서 반영해주세요.</p>}
      {attributes.length > 0 && <div><button type="button" className="btn ghost" onClick={()=>void serverRules(false)}>이 카테고리 서버 규칙 불러오기 · 현재 선택 교체</button><button type="button" className="btn ghost" disabled={serverRevision===null || !Object.values(mapping).some(Boolean)} onClick={()=>void serverRules(true)}>선택한 연결로 서버 규칙 저장{serverRevision===null?'':` · v${serverRevision}`}</button><button type="button" className="btn ghost" disabled={!Object.values(mapping).some(Boolean)} onClick={downloadRules}>선택한 연결 규칙 파일 저장</button><label>같은 카테고리 연결 규칙 불러오기 · 현재 선택 교체<input type="file" accept=".json,application/json" onChange={event=>{const file=event.target.files?.[0];event.target.value='';void importRules(file);}} /></label><small>원문 속성명이 정확히 같은 경우에만 연결을 선택합니다. 규칙 저장·불러오기는 상품값이나 견적을 자동 확정하지 않습니다.</small></div>}
      {attributes.map(attribute => {
        const fieldId = mapping[attribute.sourceIndex];
        let preview = '', error = '';
        if (fieldId && job) {
          try {
            const [change] = quotationTranslationDraft(productId, view, job, optionId, [{ sourceIndex: attribute.sourceIndex, fieldId }], review);
            const field = fields.find(item => item.id === fieldId)!;
            preview = `현재값: ${quotationAttributeDisplay(field, row?.fields[fieldId]?.value ?? '')} → ${quotationAttributeDisplay(field, change.value!)}`;
          } catch (cause) { error = cause instanceof Error ? cause.message : '연결 값을 확인해주세요.'; }
        }
        return <div key={attribute.sourceIndex}>
        <strong>{attribute.name}</strong><p style={{ whiteSpace: 'pre-wrap' }}>원문: {job!.review.source.attributes[attribute.sourceIndex].value}</p>
        <p style={{ whiteSpace: 'pre-wrap' }}>번역값: {attribute.value}</p>
        <label>견적 연결 항목<select value={mapping[attribute.sourceIndex] ?? ''} onChange={event => setMapping(previous => ({ ...previous, [attribute.sourceIndex]: event.target.value }))}>
          <option value="">반영하지 않음</option>{fields.map(field => <option key={field.id} value={field.id} disabled={row?.fields[field.id]?.source.startsWith('manual-')}>{field.label}{row?.fields[field.id]?.source.startsWith('manual-') ? ' · 직접 수정값 보존' : ''}</option>)}
        </select></label>
        {preview && <p style={{ whiteSpace: 'pre-wrap' }}>{preview}</p>}
        {error && <p role="alert">{error}</p>}
      </div>; })}
      {attributes.length > 0 && <button type="button" className="btn primary" disabled={!Object.values(mapping).some(Boolean)} onClick={apply}>선택한 번역값을 견적 초안에 반영</button>}
      {attributes.length > 0 && <fieldset><legend>번역 속성 일괄 적용 대상 · {selectedTargets.length}/{batchTargets.length}개</legend>
        <button type="button" className="btn primary" disabled={!selectedTargets.length} onClick={()=>void suggestBatch()}>카테고리 규칙으로 선택 옵션 자동작성 미리보기</button>
        <button type="button" className="btn ghost" onClick={()=>setExcludedTargets([])}>모두 선택</button>
        <button type="button" className="btn ghost" onClick={()=>setExcludedTargets(batchTargets.map(item=>item.optionId))}>모두 해제</button>
        {batchTargets.map(item=><label key={item.optionId ?? 'common'}><input type="checkbox" checked={!excludedTargets.includes(item.optionId)} onChange={event=>{const checked=event.target.checked;setExcludedTargets(previous=>checked?previous.filter(id=>id!==item.optionId):[...previous,item.optionId]);}}/>{item.optionLabel}</label>)}
        <button type="button" className="btn ghost" disabled={!selectedTargets.length || !Object.values(mapping).some(Boolean)} onClick={previewBatch}>선택한 옵션에 적용 미리보기</button>
      </fieldset>}
      {batchPlan && <section aria-label="번역 속성 일괄 적용 미리보기">
        <p>선택한 번역값이 선택한 대상 옵션에 동일하게 적용됩니다. 재질·크기가 같은 옵션만 선택해주세요. 직접 수정값은 보존합니다.</p>
        <p>변경 {batchPlan.changes.length}개 · 직접 수정값 보존 {batchPlan.skipped.length}개</p>
        {batchPlan.preview.length > 0 && <table><thead><tr><th>옵션</th><th>항목</th><th>현재값</th><th>적용값</th></tr></thead><tbody>{batchPlan.preview.map((item,index)=><tr key={index}><td>{item.option}</td><td>{item.field}</td><td style={{whiteSpace:'pre-wrap'}}>{item.beforeDisplay}</td><td style={{whiteSpace:'pre-wrap'}}>{item.afterDisplay}</td></tr>)}</tbody></table>}
        {batchPlan.skipped.length > 0 && <ul>{batchPlan.skipped.map((item,index)=><li key={index}>{item}</li>)}</ul>}
        <button type="button" className="btn primary" disabled={!batchPlan.changes.length} onClick={()=>{if(disabled || loading || activeRequest.current)return;onApply(batchPlan.changes);setBatch(null);setMessage(`${batchPlan.changes.length}개 변경을 옵션별 견적 초안에 반영했습니다. 견적 입력 저장으로 확정해주세요.`);}}>동일한 속성값 확인 · 선택 옵션 초안 반영</button>
        <button type="button" className="btn ghost" onClick={()=>setBatch(null)}>일괄 적용 취소</button>
      </section>}
    </fieldset>
    <small>선택형 상품 속성은 번역값과 선택지 이름 또는 저장값이 정확히 일치할 때만 연결합니다. 일치하지 않거나 중복되는 선택지는 직접 확인해주세요. 항목명으로 인증·재질·규격을 추정하지 않습니다.</small>
  </details>;
}
