import type { TranslationReview } from '@/app/automation/translation';

export type IntakeOptionsProof = { initialJobId: string; optionRevision: number; scope: 'options' };

/** Only the server's automatic continuation may omit the already handled SEO.
 * The route also verifies its canonical job, current source and option clock. */
export function intakeOptionsReviewProof(review: TranslationReview): IntakeOptionsProof | null {
  if (!Object.hasOwn(review, 'intakeOptions')) return null;
  const proof = review.intakeOptions;
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)
    || Object.keys(proof).sort().join(',') !== 'initialJobId,optionRevision,scope'
    || typeof proof.initialJobId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(proof.initialJobId)
    || !Number.isSafeInteger(proof.optionRevision) || proof.optionRevision < 0 || proof.scope !== 'options'
    || Object.hasOwn(review, 'optionsRetry') || Object.hasOwn(review, 'seoRetry')
    || review.destination !== 'Google 번역' || review.model !== 'google-translate-gtx'
    || review.maxOutputTokens !== 0 || review.instructionsVersion !== 'sourceflow-translation-v6'
    || !Array.isArray(review.source.attributes) || !review.source.attributes.length
    || review.source.attributes.some(pair => !/^option(?:-color|-size)?:[A-Za-z0-9_-]{1,80}$/.test(pair.name)))
    throw Error('자동 옵션 번역 작업의 원문 연결을 확인하지 못했습니다.');
  return proof;
}
