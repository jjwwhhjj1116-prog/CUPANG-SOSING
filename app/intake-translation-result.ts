import type { TranslationJob } from '@/app/automation/translation';

function pause(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) return resolve();
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** Read an already-running generation; never execute or retry a model request. */
export async function awaitIntakeTranslation(job: TranslationJob, fetcher: typeof fetch, signal: AbortSignal,
  wait: (milliseconds: number, signal: AbortSignal) => Promise<void> = pause) {
  let current = job;
  for (let attempt = 0; attempt < 15 && current.status === 'running' && !signal.aborted; attempt++) {
    await wait(2000, signal);
    if (signal.aborted) break;
    const response = await fetcher(`/api/products/${encodeURIComponent(job.productId)}/translation`, { signal, cache: 'no-store' });
    const body = await response.json() as { jobs?: TranslationJob[]; error?: string };
    if (signal.aborted) break;
    if (!response.ok || !Array.isArray(body.jobs)) throw Error(body.error || '진행 중인 SEO 작업 결과를 확인하지 못했습니다.');
    const matches = body.jobs.filter(value => value?.id === job.id);
    const found = matches[0];
    if (matches.length !== 1 || found.productId !== job.productId || found.productVersion !== job.productVersion ||
      found.contentRevision !== job.contentRevision || found.review?.fingerprint !== job.review.fingerprint ||
      !['running', 'completed', 'failed', 'uncertain'].includes(found.status)) {
      throw Error('진행 중인 SEO 작업과 조회한 결과가 일치하지 않습니다.');
    }
    current = found;
  }
  return current;
}
