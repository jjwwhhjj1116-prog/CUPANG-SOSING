import { GOOGLE_TEXT_MODEL, WORKERS_TEXT_MODEL, TranslationError, type TranslationJob, type TranslationReview, type TranslationSecrets, type TranslationConfig } from '@/app/automation/translation';
import { supplierHubCompany, type SupplierHubCompany } from '@/app/supplier-hub-company';
import {WORKERS_QWEN_MODEL} from '@/app/automation/workers-qwen-contract';
import {WORKERS_M2M_MODEL,WORKERS_M2M_STRATEGY,WORKERS_M2M_MAX_CALLS,planWorkersM2mTranslation} from '@/app/automation/workers-m2m-translation';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
export const WORKERS_RECOVERY_MAX_OUTPUT_TOKENS = 2048;
export const WORKERS_RECOVERY_MAX_INPUT_CHARACTERS = 12000;
export const WORKERS_RECOVERY_MODEL=WORKERS_QWEN_MODEL;
export const WORKERS_RECOVERY_VERSION=5;
export type WorkersRecoveryProof = { version?:2|3|4|5; strategy?:'m2m-text-v1';model?:string;maxCalls?:number;failedJobId: string; scope: 'collected'; optionRevision: number; sourceFingerprint: string; company: SupplierHubCompany };
export type WorkersRecoveryConfiguration = { configured: boolean; strategy:'m2m-text-v1'; provider: 'workers-ai'; destination: 'Cloudflare Workers AI'; model: string;maxCalls:number; maxOutputTokens: number; freeOnly: true; issues: string[] };
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
  return { configured: !issues.length, strategy:WORKERS_M2M_STRATEGY, provider: 'workers-ai', destination: 'Cloudflare Workers AI', model: WORKERS_M2M_MODEL,maxCalls:WORKERS_M2M_MAX_CALLS,
    maxOutputTokens:0, freeOnly: true, issues };
}

export function requireWorkersRecoveryConfig(secrets: RecoverySecrets,proof?:WorkersRecoveryProof,legacy=false): TranslationConfig {
  const settings = workersRecoveryConfiguration(secrets);
  if (!settings.configured) throw new TranslationError('WORKERS_RECOVERY_NOT_CONFIGURED', settings.issues.join(' '));
  const model=proof?proof.strategy===WORKERS_M2M_STRATEGY?WORKERS_M2M_MODEL:proof.version?WORKERS_QWEN_MODEL:WORKERS_TEXT_MODEL:legacy?WORKERS_QWEN_MODEL:settings.model;
  return { apiKey: '', provider: 'workers-ai', model,maxOutputTokens:model===WORKERS_M2M_MODEL?0:WORKERS_RECOVERY_MAX_OUTPUT_TOKENS, ai: secrets.AI };
}

export function workersRecoveryReviewProof(review: TranslationReview): WorkersRecoveryProof | null {
  if (!Object.hasOwn(review, 'workersRecovery')) return null;
  const proof = review.workersRecovery;
  const v2=proof&&Object.hasOwn(proof,'version'),m2m=proof?.strategy===WORKERS_M2M_STRATEGY;
  if (!proof || typeof proof !== 'object' || Object.keys(proof).sort().join(',') !== (m2m?'company,failedJobId,maxCalls,model,optionRevision,scope,sourceFingerprint,strategy':v2?'company,failedJobId,model,optionRevision,scope,sourceFingerprint,version':'company,failedJobId,optionRevision,scope,sourceFingerprint')
    || typeof proof.failedJobId !== 'string' || !uuid.test(proof.failedJobId) || proof.scope !== 'collected'
    || !Number.isSafeInteger(proof.optionRevision) || proof.optionRevision < 0 || typeof proof.sourceFingerprint !== 'string' || !hash.test(proof.sourceFingerprint)
    || !proof.company || Object.keys(proof.company).sort().join(',') !== 'code,name' || !supplierHubCompany(proof.company.code, proof.company.name)
    || review.destination !== 'Cloudflare Workers AI' || (m2m?proof.model!==WORKERS_M2M_MODEL||review.model!==WORKERS_M2M_MODEL||!Number.isSafeInteger(proof.maxCalls)||Number(proof.maxCalls)<1||Number(proof.maxCalls)>WORKERS_M2M_MAX_CALLS:v2?![2,3,4,5].includes(proof.version??0)||proof.model!==WORKERS_RECOVERY_MODEL||review.model!==proof.model:review.model!==WORKERS_TEXT_MODEL)
    || review.maxOutputTokens !== (m2m?0:WORKERS_RECOVERY_MAX_OUTPUT_TOKENS)
    || review.instructionsVersion !== 'sourceflow-translation-v6' || ['seoRetry', 'optionsRetry', 'intakeOptions'].some(key => Object.hasOwn(review, key))
    || JSON.stringify(review.source).length > WORKERS_RECOVERY_MAX_INPUT_CHARACTERS)
    throw new TranslationError('INVALID_WORKERS_RECOVERY', '별도 초안의 원문·회사·모델 검토 연결을 확인하지 못했습니다.');
  if(m2m&&proof.maxCalls!==planWorkersM2mTranslation(review.source).requests.length)throw new TranslationError('INVALID_WORKERS_RECOVERY','검토한 전용 번역 호출 수와 저장 원문이 다릅니다. 원문을 전송하지 않았습니다.');
  return proof;
}
