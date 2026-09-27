import type { TranslationJob } from '@/app/automation/translation';

export function translationReviewExpired(job: TranslationJob, now = Date.now()) {
  return ['prepared', 'approved'].includes(job.status) &&
    (!Number.isFinite(Date.parse(job.review.expiresAt)) || Date.parse(job.review.expiresAt) <= now);
}

/** One user action advances the reviewed job; never creates or retries a request. */
export async function runReviewedTranslation(productId: string, job: TranslationJob, options: {
  signal: AbortSignal; fetcher: typeof fetch; onJob: (job: TranslationJob) => void;
}) {
  if (job.productId !== productId || !['prepared', 'approved'].includes(job.status)) throw Error('검토한 번역 작업을 확인해주세요.');
  if (translationReviewExpired(job)) throw Error('SEO 검토 기한이 지났습니다. 검토 기한을 갱신한 뒤 실행해주세요.');
  const send = async (body: Record<string, unknown>) => {
    const response = await options.fetcher(`/api/products/${encodeURIComponent(productId)}/translation`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: options.signal, body: JSON.stringify(body),
    });
    const value = await response.json() as { job?: TranslationJob; error?: string; message?: string };
    if (options.signal.aborted) return null;
    if (!response.ok || !value.job) throw Error(value.error || 'SEO 초안 작성 상태를 확인하지 못했습니다. 작업 상태를 다시 조회해주세요.');
    const saved = value.job;
    if (saved.id !== job.id || saved.productId !== productId || saved.productVersion !== job.productVersion ||
        saved.contentRevision !== job.contentRevision || saved.review?.fingerprint !== job.review.fingerprint) throw Error('응답이 검토한 번역 작업과 일치하지 않습니다. 작업 상태를 다시 조회해주세요.');
    return { job: saved, message: value.message };
  };
  if (options.signal.aborted) return null;
  if (job.status === 'prepared') {
    const approved = await send({ action: 'approve', jobId: job.id, reviewFingerprint: job.review.fingerprint, confirmPaid: true });
    if (!approved) return null;
    if (approved.job.status !== 'approved') throw Error('번역 요청의 승인 상태를 확인하지 못했습니다.');
    // Retain the acknowledged approval even if the subsequent request fails.
    options.onJob(approved.job);
  }
  if (options.signal.aborted) return null;
  if (translationReviewExpired(job)) throw Error('SEO 검토 기한이 지났습니다. 검토 기한을 갱신한 뒤 실행해주세요.');
  const executed = await send({ action: 'execute', jobId: job.id });
  if (!executed) return null;
  if (!['running', 'completed', 'failed', 'uncertain'].includes(executed.job.status)) throw Error('SEO 초안 작성 상태를 다시 확인해주세요.');
  options.onJob(executed.job);
  return executed;
}
