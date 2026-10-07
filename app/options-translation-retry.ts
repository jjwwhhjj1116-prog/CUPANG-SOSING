import type { TranslationJob, TranslationReview } from '@/app/automation/translation';
import type { ProductContent } from '@/app/product-content';
import type { ProductOptionsResponse, ProductOptions } from '@/app/product-options';
import { fingerprint } from '@/app/automation/model';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
export type OptionsRetryProof = { retryKey: string; optionRevision: number; scope: 'options' };
export type OptionsRetryState = {
  productId: string; productVersion: string; retryKey: string; jobId: string | null;
  executeSubmitted: boolean; applySubmitted: boolean;
  application?: { fingerprint: string; contentRevision: number; optionRevision: number; applied: number };
};

export function optionsRetryProof(job: TranslationJob): OptionsRetryProof | null {
  return optionsRetryReviewProof(job.review);
}
export function optionsRetryReviewProof(review: TranslationReview): OptionsRetryProof | null {
  if (!Object.hasOwn(review,'optionsRetry')) return null;
  const proof = review.optionsRetry;
  if (!proof || typeof proof !== 'object' || Object.keys(proof).sort().join(',') !== 'optionRevision,retryKey,scope'
    || typeof proof.retryKey !== 'string' || !uuid.test(proof.retryKey) || !Number.isSafeInteger(proof.optionRevision) || proof.optionRevision < 0 || proof.scope !== 'options'
    || review.destination !== 'Google 번역' || review.model !== 'google-translate-gtx'
    || review.instructionsVersion !== 'sourceflow-translation-v6'
    || !Array.isArray(review.source.attributes) || !review.source.attributes.length || review.source.attributes.some(pair => !/^option(?:-color|-size)?:[A-Za-z0-9_-]{1,80}$/.test(pair.name))) throw Error('옵션 재시도 작업의 원문 연결을 확인하지 못했습니다.');
  return proof;
}

export function newOptionsRetryState(productId: string, productVersion: string): OptionsRetryState {
  return { productId, productVersion, retryKey: crypto.randomUUID(), jobId: null, executeSubmitted: false, applySubmitted: false };
}

/** Bounded session state contains only job identifiers and saved-result digests. */
export function parseOptionsRetryState(value: unknown, productId: string): OptionsRetryState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = value as OptionsRetryState;
  if (Object.keys(state).some(key => !['productId','productVersion','retryKey','jobId','executeSubmitted','applySubmitted','application'].includes(key))
    || state.productId !== productId || typeof state.productVersion !== 'string' || !Number.isFinite(Date.parse(state.productVersion))
    || typeof state.retryKey !== 'string' || !uuid.test(state.retryKey) || !(state.jobId === null || typeof state.jobId === 'string' && uuid.test(state.jobId))
    || typeof state.executeSubmitted !== 'boolean' || typeof state.applySubmitted !== 'boolean'
    || state.applySubmitted && (!state.executeSubmitted || !state.jobId || !state.application)) return null;
  if (state.application && (Object.keys(state.application).sort().join(',') !== 'applied,contentRevision,fingerprint,optionRevision'
    || typeof state.application.fingerprint !== 'string' || !hash.test(state.application.fingerprint) || ![state.application.contentRevision,state.application.optionRevision,state.application.applied].every(Number.isSafeInteger)
    || state.application.contentRevision < 0 || state.application.optionRevision < 0 || state.application.applied < 1 || state.application.applied > 50)) return null;
  return state;
}

/** Normalize only save timestamps, never original text, prices or unrelated fields. */
export async function optionsRetryApplicationFingerprint(job: TranslationJob, content: ProductContent, options: ProductOptions, clock: string) {
  const normalized = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalized);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'updatedAt' && item === clock ? 'options-retry-application' : normalized(item)]));
    return value;
  };
  return fingerprint({ jobId: job.id, reviewFingerprint: job.review.fingerprint, content: normalized(content), options: normalized(options) });
}

export type OptionsRetryOutcome = { done: boolean; saved: boolean; job: TranslationJob | null; message: string };

/** A click executes at most one free batch. Recovery only reads an already-started job. */
export async function retryOptionsTranslation(state: OptionsRetryState, options: {
  fetcher?: typeof fetch; signal: AbortSignal; onState: (state: OptionsRetryState) => void; onJob?: (job: TranslationJob) => void;
}): Promise<OptionsRetryOutcome> {
  const fetcher = options.fetcher ?? fetch, { signal } = options, base = `/api/products/${encodeURIComponent(state.productId)}`;
  if (!parseOptionsRetryState(state, state.productId)) throw Error('옵션 번역 재시도 정보를 확인해주세요.');
  const keep = (patch: Partial<OptionsRetryState>) => { Object.assign(state, patch); options.onState(structuredClone(state)); };
  const request = async (path: string, body?: Record<string, unknown>) => {
    const response = await fetcher(base + path, { signal, cache: 'no-store', ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const value = await response.json() as Record<string, unknown>;
    if (!response.ok) throw Error(typeof value.error === 'string' ? value.error : '옵션 번역 상태를 확인하지 못했습니다.');
    return value;
  };
  const validate = (value: unknown): TranslationJob => {
    const job = value as TranslationJob;
    if (!job || typeof job !== 'object' || typeof job.id !== 'string' || !uuid.test(job.id) || job.productId !== state.productId || job.productVersion !== state.productVersion
      || !Number.isSafeInteger(job.contentRevision) || job.contentRevision < 0 || state.jobId && job.id !== state.jobId
      || !['prepared','approved','running','completed','failed','uncertain'].includes(job.status)
      || typeof job.review?.fingerprint !== 'string' || !hash.test(job.review.fingerprint)
      || optionsRetryProof(job)?.retryKey !== state.retryKey) throw Error('다른 상품·원문·재시도의 응답입니다. 저장한 작업을 다시 확인해주세요.');
    keep({ jobId: job.id }); options.onJob?.(job); return job;
  };
  let sourceChanged = false;
  const lookup = async (): Promise<TranslationJob | null> => {
    const value = await request('/translation?retryKey=' + encodeURIComponent(state.retryKey));
    if (value.productId !== state.productId || value.retryKey !== state.retryKey || !Object.hasOwn(value, 'job')
      || typeof value.productVersion !== 'string' || !Number.isFinite(Date.parse(value.productVersion))) throw Error('옵션 번역 재시도 조회가 일치하지 않습니다.');
    sourceChanged = value.productVersion !== state.productVersion;
    return value.job === null ? null : validate(value.job);
  };
  const recover = async (cause: unknown) => {
    if (signal.aborted) throw cause;
    const recovered = await lookup(); if (!recovered) throw cause; return recovered;
  };
  let job = await lookup();
  if (job && sourceChanged && !state.applySubmitted && !['running','uncertain'].includes(job.status))
    return {done:true,saved:false,job,message:'이 재시도 이후 상품이 변경되어 번역·적용을 중단했습니다. 현재 상품에서 다시 눌러 미번역 옵션을 준비해주세요.'};
  if (!job) {
    if (state.jobId || state.executeSubmitted || state.applySubmitted) throw Error('저장했던 재시도 작업을 찾지 못했습니다. 새 번역을 호출하지 않았습니다.');
    try {
      const value = await request('/translation', { action: 'prepare-options-retry', expectedVersion: state.productVersion, retryKey: state.retryKey });
      if (value.done === true && value.productId === state.productId && value.productVersion === state.productVersion)
        return { done: true, saved: false, job: null, message: '직접 수정한 값은 유지했습니다. 추가로 번역할 옵션이 없습니다.' };
      job = validate(value.job);
    } catch (cause) { job = await recover(cause); }
  }
  if (state.applySubmitted) {
    const [optionsValue, contentValue] = await Promise.all([request('/options'), request('/content')]);
    const current = optionsValue as unknown as ProductOptionsResponse, content = contentValue.content as ProductContent;
    const proof = state.application!;
    if (job.status !== 'completed' || !job.result || current.options?.productId !== state.productId || content?.productId !== state.productId
      || current.options.revision !== proof.optionRevision + 1 || content.revision !== proof.contentRevision + 1
      || typeof current.productVersion !== 'string' || Date.parse(current.productVersion) <= Date.parse(state.productVersion)
      || current.options.updatedAt !== current.productVersion || content.updatedAt !== current.productVersion
      || await optionsRetryApplicationFingerprint(job, content, current.options, current.productVersion) !== proof.fingerprint)
      throw Error('옵션 저장 응답이 불확실하거나 이후 자료가 변경됐습니다. 현재 옵션을 확인해주세요. 번역·저장을 다시 실행하지 않았습니다.');
    return { done: true, saved: true, job, message: '같은 재시도의 저장된 옵션을 확인했습니다. 번역이나 저장을 다시 호출하지 않았습니다.' };
  }
  if (['prepared','approved'].includes(job.status) && !job.startedAt && !job.result && !job.error && Date.parse(job.review.expiresAt) <= Date.now())
    return {done:true,saved:false,job,message:'재시도의 검토 기한이 종료됐습니다. 원래 작업은 유지했습니다. 다시 눌러 현재 미번역 옵션을 준비해주세요.'};
  if (job.status === 'prepared') {
    if (state.executeSubmitted) throw Error('이전 실행 요청의 상태가 불확실합니다. 새 번역을 호출하지 않았습니다.');
    try { job = validate((await request('/translation', { action: 'approve', jobId: job.id, reviewFingerprint: job.review.fingerprint, confirmPaid: true })).job); }
    catch (cause) { job = await recover(cause); }
  }
  if (job.status === 'approved' && !state.executeSubmitted) {
    keep({ executeSubmitted: true });
    try { job = validate((await request('/translation', { action: 'execute', jobId: job.id })).job); }
    catch (cause) { job = await recover(cause); }
  }
  if (job.status === 'failed') return { done: true, saved: false, job, message: job.error?.message ?? '무료 옵션 번역을 완료하지 못했습니다. 원문과 수정값을 유지했으며 자동 재요청하지 않았습니다.' };
  if (job.status !== 'completed' || !job.result) return { done: false, saved: false, job,
    message: '이미 요청한 옵션 번역의 결과를 확인해야 합니다. 같은 재시도 상태만 조회하며 번역을 다시 호출하지 않습니다.' };
  const preview = await request('/translation-apply', { action: 'preview', scope: 'options', jobId: job.id, expectedVersion: state.productVersion });
  const retry = preview.optionsRetry as { applicationFingerprint?: string } | undefined;
  if (preview.scope !== 'options' || preview.productId !== state.productId || preview.productVersion !== state.productVersion
    || preview.contentRevision !== job.contentRevision || preview.optionRevision !== optionsRetryProof(job)!.optionRevision
    || typeof preview.fingerprint !== 'string' || !hash.test(preview.fingerprint) || !Array.isArray(preview.preview)
    || typeof retry?.applicationFingerprint !== 'string' || !hash.test(retry.applicationFingerprint)) throw Error('옵션 적용 대상과 저장 증빙이 일치하지 않습니다.');
  const applied = preview.preview.length;
  const partial = job.result.googleStoppedHttpStatus || job.result.draft.attributes.length < job.review.source.attributes.length;
  if (!applied) return { done: true, saved: false, job, message: '적용할 옵션 번역이 없습니다. 미번역 원문과 직접 수정한 값은 유지합니다.' };
  keep({ application: { fingerprint: retry.applicationFingerprint, contentRevision: job.contentRevision, optionRevision: optionsRetryProof(job)!.optionRevision, applied }, applySubmitted: true });
  let saved: Record<string, unknown>;
  try { saved = await request('/translation-apply', { action: 'apply', scope: 'options', jobId: job.id, expectedVersion: state.productVersion, fingerprint: preview.fingerprint }); }
  catch (cause) {
    if (signal.aborted) throw cause;
    // Inspect the exact complete after-image; never resubmit an uncertain apply.
    return retryOptionsTranslation(state, options);
  }
  if (saved.scope !== 'options' || saved.productId !== state.productId || saved.contentRevision !== job.contentRevision + 1
    || saved.optionRevision !== optionsRetryProof(job)!.optionRevision + 1 || saved.applied !== applied
    || typeof saved.productVersion !== 'string' || Date.parse(saved.productVersion) <= Date.parse(state.productVersion))
    throw Error('옵션 저장 응답이 일치하지 않습니다. 현재 자료를 확인해주세요. 자동 재저장하지 않았습니다.');
  return { done: true, saved: true, job, message: `미번역 옵션 ${applied}개 항목을 한국어로 저장했습니다. SEO·표시사항·가격과 직접 수정한 옵션은 유지했습니다.${partial ? ' 일부 번역은 미완료이며 자동 다음 요청은 실행하지 않았습니다.' : ''}` };
}
