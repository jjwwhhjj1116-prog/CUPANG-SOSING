import { GOOGLE_TEXT_MODEL, WORKERS_TEXT_MODEL, validateTranslationDraft, validateTranslationSource,
  type TranslationConfiguration, type TranslationJob, type TranslationSource } from '@/app/automation/translation';
import { translationReviewExpired } from '@/app/reviewed-translation';

export type SeoWorkspaceDraftMemo = { brand: string; features: string; keywords: string };
type DraftConfiguration = Pick<TranslationConfiguration, 'configured' | 'model' | 'maxOutputTokens'>;
export type SeoWorkspaceDraftState = {
  schemaVersion: 1; productId: string; productVersion: string; contentRevision: number;
  source: TranslationSource; memo: SeoWorkspaceDraftMemo; configuration: DraftConfiguration;
  idempotencyKey: string; jobId: string | null; reviewFingerprint: string | null;
  prepareSubmitted: boolean; approvalSubmitted: boolean; executeSubmitted: boolean;
};
export type SeoWorkspaceDraftControls = {
  signal: AbortSignal; fetcher: typeof fetch; onState: (state: SeoWorkspaceDraftState) => void;
  onJob?: (job: TranslationJob) => void; isContextCurrent?: () => boolean;
  /** Set only after the UI has displayed the actual AI destination and cost notice. */
  confirmAi?: boolean;
};
export type SeoWorkspaceDraftOutcome = {
  job: TranslationJob | null; closed: boolean; needsReview: boolean; partial: boolean; label: string; message: string;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const hash = /^[a-f0-9]{64}$/u;
const maximumStateBytes = 96 * 1024;
const inFlight = new Set<string>();
const stateKeys = 'approvalSubmitted,configuration,contentRevision,executeSubmitted,idempotencyKey,jobId,memo,prepareSubmitted,productId,productVersion,reviewFingerprint,schemaVersion,source';
const exact = (value: unknown, keys: string): value is Record<string, unknown> => Boolean(value && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys);
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)])) : value;
const same = (left: unknown, right: unknown) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
const cleanText = (value: unknown, limit: number) => {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw Error('SEO 참고 입력의 길이와 문자를 확인해주세요.');
  return value.trim();
};
function memoInput(value: SeoWorkspaceDraftMemo): SeoWorkspaceDraftMemo {
  if (!exact(value, 'brand,features,keywords')) throw Error('SEO 참고 입력을 확인해주세요.');
  return { brand: cleanText(value.brand, 500), features: cleanText(value.features, 2000), keywords: cleanText(value.keywords, 2000) };
}
function configurationInput(value: DraftConfiguration): DraftConfiguration {
  const model = value?.model, tokens = value?.maxOutputTokens;
  if (value?.configured !== true || typeof model !== 'string' || !/^[a-zA-Z0-9_@./:-]{1,150}$/u.test(model)
    || !Number.isSafeInteger(tokens) || (model === GOOGLE_TEXT_MODEL ? tokens !== 0 : tokens === null || tokens! < 256 || tokens! > 8000))
    throw Error('현재 SEO 서비스 설정을 확인해주세요.');
  return { configured: true, model, maxOutputTokens: tokens };
}
export function seoWorkspaceDraftProvider(configuration: DraftConfiguration) {
  const config = configurationInput(configuration);
  return config.model === GOOGLE_TEXT_MODEL ? { kind: 'google' as const, label: '무료 Google 번역 초안', destination: 'Google 번역' as const }
    : { kind: 'ai' as const, label: 'AI 초안', destination: config.model === WORKERS_TEXT_MODEL ? 'Cloudflare Workers AI' as const : 'OpenAI Responses API' as const };
}

/** Memo stays separate from supplier facts. Google translates saved text only;
 * brand/features/keywords do not replace the title, attributes or option names. */
export function createSeoWorkspaceDraftState(input: {
  productId: string; productVersion: string; contentRevision: number; source: TranslationSource;
  memo: SeoWorkspaceDraftMemo; configuration: DraftConfiguration;
}): SeoWorkspaceDraftState {
  const source = validateTranslationSource(input.source), memo = memoInput(input.memo);
  const features = [source.guidance?.features && `저장된 특징 참고 메모:\n${source.guidance.features}`,
    memo.brand && `사용자가 입력한 브랜드 참고 · 판매자 사실로 미확인:\n${memo.brand}`,
    memo.features && memo.features !== source.guidance?.features && `현재 사용자 특징 참고 메모 · 판매자 사실과 별도:\n${memo.features}`].filter(Boolean).join('\n\n');
  const keywords = [source.guidance?.keywords && `저장된 검색어 참고 메모:\n${source.guidance.keywords}`,
    memo.keywords && memo.keywords !== source.guidance?.keywords && `현재 사용자 검색어 참고 메모:\n${memo.keywords}`].filter(Boolean).join('\n\n');
  const state: SeoWorkspaceDraftState = {
    schemaVersion: 1, productId: input.productId, productVersion: input.productVersion, contentRevision: input.contentRevision,
    source: validateTranslationSource({ ...source, guidance: { features, keywords } }), memo,
    configuration: configurationInput(input.configuration), idempotencyKey: crypto.randomUUID(),
    jobId: null, reviewFingerprint: null, prepareSubmitted: false, approvalSubmitted: false, executeSubmitted: false,
  };
  if (!parseSeoWorkspaceDraftState(state, input.productId)) throw Error('SEO 상품·버전·참고 입력을 확인해주세요.');
  return state;
}

/** Session recovery validates the whole request and submission flags. It never
 * turns an unknown old execution into a fresh request with a different key. */
export function parseSeoWorkspaceDraftState(raw: unknown, productId: string): SeoWorkspaceDraftState | null {
  try {
    if (typeof raw === 'string') {
      if (raw.length > maximumStateBytes || new TextEncoder().encode(raw).length > maximumStateBytes) return null;
      raw = JSON.parse(raw);
    }
    if (!exact(raw, stateKeys)) return null;
    const state = raw as unknown as SeoWorkspaceDraftState;
    if (state.schemaVersion !== 1 || state.productId !== productId || !/^[a-zA-Z0-9_-]{1,80}$/u.test(productId)
      || typeof state.productVersion !== 'string' || state.productVersion.length > 100 || !Number.isFinite(Date.parse(state.productVersion))
      || !Number.isSafeInteger(state.contentRevision) || state.contentRevision < 0
      || typeof state.idempotencyKey !== 'string' || !uuid.test(state.idempotencyKey)
      || !(state.jobId === null || typeof state.jobId === 'string' && uuid.test(state.jobId))
      || !(state.reviewFingerprint === null || typeof state.reviewFingerprint === 'string' && hash.test(state.reviewFingerprint))
      || (state.jobId === null) !== (state.reviewFingerprint === null)
      || ![state.prepareSubmitted, state.approvalSubmitted, state.executeSubmitted].every(value => typeof value === 'boolean')
      || state.jobId !== null && !state.prepareSubmitted || state.approvalSubmitted && state.jobId === null
      || state.executeSubmitted && !state.approvalSubmitted) return null;
    if (!exact(state.configuration, 'configured,maxOutputTokens,model') || !same(configurationInput(state.configuration), state.configuration)
      || !same(memoInput(state.memo), state.memo)
      || !same(validateTranslationSource(state.source), state.source)
      || new TextEncoder().encode(JSON.stringify(state)).length > maximumStateBytes) return null;
    return structuredClone(state);
  } catch { return null; }
}

async function advance(state: SeoWorkspaceDraftState, controls: SeoWorkspaceDraftControls, execute: boolean): Promise<SeoWorkspaceDraftOutcome> {
  if (!parseSeoWorkspaceDraftState(state, state.productId)) throw Error('저장한 SEO 초안 요청을 확인해주세요. 새 요청을 만들지 않았습니다.');
  if (inFlight.has(state.idempotencyKey)) throw Error('같은 SEO 초안의 상태를 확인 중입니다. 중복 요청하지 않았습니다.');
  inFlight.add(state.idempotencyKey);
  const { signal, fetcher } = controls, base = `/api/products/${encodeURIComponent(state.productId)}`;
  const provider = seoWorkspaceDraftProvider(state.configuration);
  const check = () => {
    if (signal.aborted) throw Error('SEO 초안 확인을 중단했습니다. 저장한 작업은 유지됩니다.');
    if (controls.isContextCurrent && !controls.isContextCurrent()) throw Error('SEO 상품·참고 입력이 변경됐습니다. 기존 이력을 유지하고 실행을 중단했습니다.');
  };
  const keep = (patch: Partial<SeoWorkspaceDraftState>) => { Object.assign(state, patch); controls.onState(structuredClone(state)); };
  const request = async (body?: Record<string, unknown>) => {
    check();
    const response = await fetcher(base + '/translation', { signal, cache: 'no-store', ...(body ? {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    } : {}) });
    const value = await response.json() as { job?: TranslationJob; jobs?: TranslationJob[]; configuration?: DraftConfiguration; error?: string };
    check();
    if (!response.ok) throw Error(value.error || 'SEO 초안 상태를 확인하지 못했습니다. 새 실행을 만들지 않았습니다.');
    return value;
  };
  const validate = (job: TranslationJob | undefined) => {
    if (!job || !uuid.test(job.id) || job.productId !== state.productId || job.productVersion !== state.productVersion
      || job.contentRevision !== state.contentRevision || state.jobId !== null && job.id !== state.jobId
      || !['prepared', 'approved', 'running', 'completed', 'failed', 'uncertain'].includes(job.status)
      || !job.review || !hash.test(job.review.fingerprint) || state.reviewFingerprint !== null && job.review.fingerprint !== state.reviewFingerprint
      || job.review.model !== state.configuration.model || job.review.maxOutputTokens !== state.configuration.maxOutputTokens
      || job.review.destination !== provider.destination || job.review.instructionsVersion !== 'sourceflow-translation-v6'
      || ['optionsRetry', 'seoRetry', 'intakeOptions'].some(key => Object.hasOwn(job.review, key))
      || !same(validateTranslationSource(job.review.source), state.source)
      || typeof job.review.paidNotice !== 'string' || !job.review.paidNotice || job.review.paidNotice.length > 4000)
      throw Error('다른 상품·원문·서비스의 SEO 응답입니다. 실행·적용하지 않았습니다.');
    if (job.status === 'completed') {
      if (!job.result || job.result.model !== job.review.model || job.result.appliedToContent !== false || job.result.provenance !== 'generated')
        throw Error('SEO 결과의 서비스·저장 범위를 확인하지 못했습니다.');
      validateTranslationDraft(job.result.draft, state.source, job.review.instructionsVersion);
    } else if (job.result !== null || ['prepared', 'approved', 'running'].includes(job.status) && job.error !== null)
      throw Error('SEO 작업의 결과 상태를 확인하지 못했습니다.');
    keep({ jobId: job.id, reviewFingerprint: job.review.fingerprint,
      ...(['approved', 'running', 'completed', 'failed', 'uncertain'].includes(job.status) ? { approvalSubmitted: true } : {}),
      ...(['running', 'completed', 'failed', 'uncertain'].includes(job.status) ? { executeSubmitted: true } : {}) });
    controls.onJob?.(job);
    return job;
  };
  let configurationCurrent = true;
  const lookup = async () => {
    const value = await request();
    if (!Array.isArray(value.jobs) || value.jobs.length > 20) throw Error('SEO 작업 조회 응답을 확인하지 못했습니다.');
    configurationCurrent = value.configuration?.configured === true && value.configuration.model === state.configuration.model
      && value.configuration.maxOutputTokens === state.configuration.maxOutputTokens;
    if (state.jobId === null) return null;
    const matches = value.jobs.filter(job => job?.id === state.jobId);
    if (matches.length > 1) throw Error('같은 SEO 작업의 조회 결과가 중복됐습니다. 실행하지 않았습니다.');
    return matches.length === 1 ? validate(matches[0]) : null;
  };
  const outcome = (job: TranslationJob | null, message?: string): SeoWorkspaceDraftOutcome => {
    const draft = job?.result?.draft;
    const missing = draft ? state.source.attributes.filter((_, index) => !draft.attributes.some(item => item.sourceIndex === index)).length : 0;
    const stopped = provider.kind === 'google' ? job?.result?.googleStoppedHttpStatus : undefined;
    const partial = Boolean(draft && (missing || state.source.title && !draft.title.trim() || state.source.description && !draft.description.trim()
      || stopped === 429 || typeof stopped === 'number' && stopped >= 500 && stopped <= 599));
    const closed = Boolean(job && ['completed', 'failed'].includes(job.status));
    return { job, closed, needsReview: true, partial, label: provider.label,
      message: message ?? (job?.status === 'completed'
        ? `${provider.label}${partial ? ` · 부분 결과${missing ? ` · 누락 항목 ${missing}개` : ''}${stopped ? ` · HTTP ${stopped}` : ''}` : ''}를 받았습니다. 원하는 상품명·검색어·옵션만 검토 후 반영해주세요. 기존 수정값은 저장하거나 바꾸지 않았습니다.`
        : job?.status === 'failed' ? job.error?.message || 'SEO 초안을 완료하지 못했습니다. 기존 원문·수정값을 유지하고 자동 재시도하지 않았습니다.'
          : '같은 SEO 초안의 상태만 확인했습니다. 새 번역 호출이나 상품 저장은 하지 않았습니다.') };
  };
  const recover = async (cause: unknown) => {
    check();
    try {
      const job = await lookup();
      return outcome(job, job ? undefined : `${cause instanceof Error ? cause.message : 'SEO 요청 응답을 확인하지 못했습니다.'} 조회만 했으며 실행을 새로 보내지 않았습니다.`);
    } catch { check(); throw cause; }
  };
  try {
    check();
    let job = state.jobId !== null || !execute ? await lookup() : null;
    if (!execute) return outcome(job, job ? undefined : '저장한 SEO 요청을 조회하지 못했습니다. 새 준비·승인·실행은 하지 않았습니다.');
    if (state.executeSubmitted) return outcome(job, job?.status === 'completed' || job?.status === 'failed' ? undefined
      : '이전 SEO 실행 요청의 결과를 확인해야 합니다. 조회만 했으며 실행을 다시 보내지 않았습니다.');
    if (!job) {
      if (state.jobId !== null || state.approvalSubmitted) return outcome(null, '저장한 SEO 작업이 현재 조회 목록에 없습니다. 새 실행은 만들지 않았습니다.');
      keep({ prepareSubmitted: true });
      try { job = validate((await request({ action: 'prepare', source: state.source, expectedVersion: state.productVersion, idempotencyKey: state.idempotencyKey })).job); }
      catch (cause) { return await recover(cause); }
    }
    if (['completed', 'failed', 'running', 'uncertain'].includes(job.status)) return outcome(job);
    if (!configurationCurrent) return outcome(job, 'SEO 서비스 설정이 변경됐습니다. 기존 요청을 유지하고 새 실행은 하지 않았습니다.');
    if (translationReviewExpired(job)) return outcome(job, 'SEO 요청의 검토 기한이 지났습니다. 기존 요청은 유지하며 실행하지 않았습니다.');
    if (provider.kind === 'ai' && controls.confirmAi !== true) return outcome(job, `${provider.label} 요청을 준비했습니다. 실제 원문·서비스·비용 안내를 확인한 뒤 승인해주세요. 상품을 저장하지 않았습니다.`);
    if (job.status === 'prepared') {
      if (state.approvalSubmitted) return outcome(job, '이전 승인 요청을 확인해야 합니다. 승인·실행을 다시 보내지 않았습니다.');
      keep({ approvalSubmitted: true });
      try {
        job = validate((await request({ action: 'approve', jobId: job.id, reviewFingerprint: job.review.fingerprint, confirmPaid: true })).job);
        if (job.status !== 'approved') throw Error('SEO 승인 상태를 확인하지 못했습니다.');
      } catch (cause) { return await recover(cause); }
    }
    check();
    if (job.status !== 'approved') return outcome(job);
    keep({ executeSubmitted: true });
    try {
      const result = validate((await request({ action: 'execute', jobId: job.id })).job);
      if (!['running', 'completed', 'failed', 'uncertain'].includes(result.status)) throw Error('SEO 실행 요청의 결과 상태를 확인하지 못했습니다.');
      return outcome(result);
    } catch (cause) { return await recover(cause); }
  } finally { inFlight.delete(state.idempotencyKey); }
}

/** Explicit draft action only. Never calls translation-apply/content/options writes. */
export const runSeoWorkspaceDraft = (state: SeoWorkspaceDraftState, controls: SeoWorkspaceDraftControls) => advance(state, controls, true);
/** Recovery always reads history; it cannot prepare, approve or execute. */
export const refreshSeoWorkspaceDraft = (state: SeoWorkspaceDraftState, controls: SeoWorkspaceDraftControls) => advance(state, controls, false);
