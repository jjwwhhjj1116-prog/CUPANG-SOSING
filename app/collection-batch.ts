import type { CollectionJob } from '@/app/sourcing';
import { validateCollectionReceiptResponse } from '@/app/collection-receipt-response';
import { recommendCollectionImages, validateCollectionCapacity } from '@/app/collection-capacity';
import { runCollectionImport, type CollectionImportOutcome } from '@/app/collection-import';

export function pendingReceivedJobs(jobs: readonly CollectionJob[]) {
  return jobs.filter(job => job.status !== 'cancelled' && !!job.received_at && !job.product_id);
}

/** Consume already received originals only. No collection, paid generation or Hub submission. */
export async function importReceivedJobs(jobs: readonly CollectionJob[], options: {
  fetcher: typeof fetch; shouldStop: () => boolean;
  onResult: (jobId: string, result: CollectionImportOutcome) => void;
  onProgress: (jobId: string, message: string) => void;
}) {
  for (const job of jobs) {
    if (options.shouldStop()) break;
    if (job.status === 'cancelled' || !job.received_at) continue;
    options.onProgress(job.id, '수신 원문과 이미지 저장 여유 확인 중');
    try {
      const path = `/api/collection-jobs/${encodeURIComponent(job.id)}`;
      const response = await options.fetcher(path + '/result', { cache: 'no-store' });
      const body = await response.json() as { error?: string } | null;
      if (!response.ok) throw Error(body?.error || '수신 원문 조회 실패');
      const source = validateCollectionReceiptResponse(body, job.id, job.offer_id);
      if (!source) throw Error('수집 원문이 아직 도착하지 않았습니다.');
      if (options.shouldStop()) break;
      let indices: number[] = [];
      if (source.images.length) {
        const capacityResponse = await options.fetcher(path + '/capacity', { cache: 'no-store' });
        const capacityBody = await capacityResponse.json() as { error?: string; capacity?: unknown } | null;
        if (!capacityResponse.ok) throw Error(capacityBody?.error || '이미지 저장 여유 조회 실패');
        indices = recommendCollectionImages(source, validateCollectionCapacity(capacityBody?.capacity, source.images.length));
      }
      if (options.shouldStop()) break;
      const result = await runCollectionImport(job.id, source.images.length, {
        fetcher: options.fetcher, imageIndices: indices, shouldStop: options.shouldStop,
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
