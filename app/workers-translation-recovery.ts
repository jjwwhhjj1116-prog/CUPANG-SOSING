import { GOOGLE_TEXT_MODEL, WORKERS_TEXT_MODEL, TranslationError, type TranslationJob, type TranslationReview, type TranslationSecrets, type TranslationConfig } from '@/app/automation/translation';
import { supplierHubCompany, type SupplierHubCompany } from '@/app/supplier-hub-company';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
export const WORKERS_RECOVERY_MAX_OUTPUT_TOKENS = 2048;
export const WORKERS_RECOVERY_MAX_INPUT_CHARACTERS = 12000;
export type WorkersRecoveryProof = { failedJobId: string; scope: 'collected'; optionRevision: number; sourceFingerprint: string; company: SupplierHubCompany };
export type WorkersRecoveryConfiguration = { configured: boolean; provider: 'workers-ai'; destination: 'Cloudflare Workers AI'; model: string; maxOutputTokens: number; freeOnly: true; issues: string[] };
type RecoverySecrets = TranslationSecrets & { SOURCEFLOW_QUOTATION_AI_PROVIDER?: string; SOURCEFLOW_QUOTATION_AI_FREE_ONLY?: string };

/** A certain, persisted Google refusal; uncertain delivery never permits fallback. */
export function google429RecoveryCandidate(job: TranslationJob | null | undefined): boolean {
  return !!job && job.status === 'failed' && job.result === null && job.review.destination === 'Google 번역'
    && job.review.model === GOOGLE_TEXT_MODEL && job.error?.mayHaveBeenCharged === false
    && /^GOOGLE_TRANSLATION_FAILED(?:_|$)/.test(job.error.code) && /\bHTTP\s+429\b/.test(job.error.message)
    && !!job.startedAt && Number.isFinite(Date.parse(job.startedAt)) && !!job.finishedAt && Number.isFinite(Date.parse(job.finishedAt));
}

/** Reuse only the operator-confirmed Free configuration already used by quotation AI. */
export function workersRecoveryConfiguration(secrets: RecoverySecrets): WorkersRecoveryConfiguration {
  const issues: string[] = [];
  if (secrets.SOURCEFLOW_QUOTATION_AI_PROVIDER !== 'workers-ai' || secrets.SOURCEFLOW_QUOTATION_AI_FREE_ONLY !== 'true')
    issues.push('확인된 Workers Free 견적 AI 설정에서만 별도 초안 작성을 사용할 수 있습니다.');
  if (typeof secrets.AI?.run !== 'function') issues.push('Cloudflare AI 바인딩을 확인해주세요.');
  return { configured: !issues.length, provider: 'workers-ai', destination: 'Cloudflare Workers AI', model: WORKERS_TEXT_MODEL,
    maxOutputTokens: WORKERS_RECOVERY_MAX_OUTPUT_TOKENS, freeOnly: true, issues };
}

export function requireWorkersRecoveryConfig(secrets: RecoverySecrets): TranslationConfig {
  const settings = workersRecoveryConfiguration(secrets);
  if (!settings.configured) throw new TranslationError('WORKERS_RECOVERY_NOT_CONFIGURED', settings.issues.join(' '));
  return { apiKey: '', provider: 'workers-ai', model: settings.model, maxOutputTokens: settings.maxOutputTokens, ai: secrets.AI };
}

export function workersRecoveryReviewProof(review: TranslationReview): WorkersRecoveryProof | null {
  if (!Object.hasOwn(review, 'workersRecovery')) return null;
  const proof = review.workersRecovery;
  if (!proof || typeof proof !== 'object' || Object.keys(proof).sort().join(',') !== 'company,failedJobId,optionRevision,scope,sourceFingerprint'
    || typeof proof.failedJobId !== 'string' || !uuid.test(proof.failedJobId) || proof.scope !== 'collected'
    || !Number.isSafeInteger(proof.optionRevision) || proof.optionRevision < 0 || typeof proof.sourceFingerprint !== 'string' || !hash.test(proof.sourceFingerprint)
    || !proof.company || Object.keys(proof.company).sort().join(',') !== 'code,name' || !supplierHubCompany(proof.company.code, proof.company.name)
    || review.destination !== 'Cloudflare Workers AI' || review.model !== WORKERS_TEXT_MODEL || review.maxOutputTokens !== WORKERS_RECOVERY_MAX_OUTPUT_TOKENS
    || review.instructionsVersion !== 'sourceflow-translation-v6' || ['seoRetry', 'optionsRetry', 'intakeOptions'].some(key => Object.hasOwn(review, key))
    || JSON.stringify(review.source).length > WORKERS_RECOVERY_MAX_INPUT_CHARACTERS)
    throw new TranslationError('INVALID_WORKERS_RECOVERY', '별도 초안의 원문·회사·모델 검토 연결을 확인하지 못했습니다.');
  return proof;
}
