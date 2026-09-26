import type { CollectionJob } from '@/app/sourcing';
import { validateCollectionReceiptResponse } from '@/app/collection-receipt-response';
import { recommendCollectionImages, validateCollectionCapacity } from '@/app/collection-capacity';
import { runCollectionImport, type CollectionImportOutcome } from '@/app/collection-import';
import { collectionRequestWithRetry } from '@/app/collection-retry';

export function pendingReceivedJobs(jobs: readonly CollectionJob[]) {
  return jobs.filter(job => job.status !== 'cancelled' && !!job.received_at && !job.product_id);
}

/** Linked products may still have missing images after interruption or reload. */
export function linkedReceivedJobs(jobs: readonly CollectionJob[]) {
  return jobs.filter(job => job.status !== 'cancelled' && !!job.received_at && !!job.product_id);
}

/** Consume already received originals only. No collection, paid generation or Hub submission. */
export async function importReceivedJobs(jobs: readonly CollectionJob[], options: {
  fetcher: typeof fetch; shouldStop: () => boolean;
  onResult: (jobId: string, result: CollectionImportOutcome) => void;
  onProgress: (jobId: string, message: string) => void;
  retryWait?: (milliseconds: number) => Promise<void>;
}) {
  for (const job of jobs) {
    if (options.shouldStop()) break;
    if (job.status === 'cancelled' || !job.received_at) continue;
    options.onProgress(job.id, '수신 원문과 이미지 저장 여유 확인 중');
    try {
      const path = `/api/collection-jobs/${encodeURIComponent(job.id)}`;
      const onRetry = (attempt: number) => options.onProgress(job.id, `일시적 통신 오류 · ${attempt}/3회 재시도 중`);
      const request = (url: string, init: RequestInit) => collectionRequestWithRetry(url, init, {
        fetcher: options.fetcher, attempts: 3, wait: options.retryWait, shouldStop: options.shouldStop, onRetry,
      });
      const response = await request(path + '/result', { cache: 'no-store' });
      const body = await response.json() as { error?: string } | null;
      if (!response.ok) throw Error(body?.error || '수신 원문 조회 실패');
      const source = validateCollectionReceiptResponse(body, job.id, job.offer_id);
      if (!source) throw Error('수집 원문이 아직 도착하지 않았습니다.');
      if (options.shouldStop()) break;
      let indices: number[] = [];
      if (source.images.length) {
        const capacityResponse = await request(path + '/capacity', { cache: 'no-store' });
        const capacityBody = await capacityResponse.json() as { error?: string; capacity?: unknown } | null;
        if (!capacityResponse.ok) {
          if ([502,503,504].includes(capacityResponse.status) && !options.shouldStop()) {
            options.onProgress(job.id, '이미지 확인 지연 · 상품·옵션 초안을 먼저 저장 중');
            const draft = await runCollectionImport(job.id, source.images.length, {
              fetcher: options.fetcher, imageIndices: [], shouldStop: options.shouldStop,
              retryAttempts: 3, retryWait: options.retryWait, onRetry,
            });
            options.onResult(job.id, draft.status === 'completed' ? {
              ...draft, status: 'failed', error: '상품·옵션 초안은 저장했습니다. 이미지 저장 상태를 확인하지 못해 이미지 반영은 재시도가 필요합니다.',
              warnings: ['원본 이미지 주소는 보존되어 있습니다. 저장된 상품을 열어 내용을 수정할 수 있습니다.'],
            } : draft);
            if (draft.status === 'stopped') break;
            continue;
          }
          throw Error(capacityBody?.error || '이미지 저장 여유 조회 실패');
        }
        indices = recommendCollectionImages(source, validateCollectionCapacity(capacityBody?.capacity, source.images.length));
      }
      if (options.shouldStop()) break;
      const result = await runCollectionImport(job.id, source.images.length, {
        continueOnImageError: true, fetcher: options.fetcher, imageIndices: indices, shouldStop: options.shouldStop,
        retryAttempts: 3, retryWait: options.retryWait, onRetry,
        onProgress: progress => options.onProgress(job.id, progress.stage === 'product' ? '상품·옵션 반영 중' : `원본 이미지 ${progress.completedImages}/${progress.totalImages}개 저장 중`),
      });
      const omitted = source.images.length - indices.length;
      options.onResult(job.id, { ...result, warnings: [...(result.warnings ?? []), ...(omitted ? [`이미지 ${omitted}개는 저장 여유·제외 설정에 따라 건너뛰었습니다. 원본 주소는 보존됩니다.`] : [])] });
      if (result.status === 'stopped') break;
    } catch (cause) {
      if (options.shouldStop()) break;
      options.onResult(job.id, { status: 'failed', productId: null, completedImages: 0, error: cause instanceof Error ? cause.message : '원문 반영 실패' });
    }
  }
}
