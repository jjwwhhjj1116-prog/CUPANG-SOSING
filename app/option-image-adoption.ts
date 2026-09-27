import { optionInputs, type ProductOptionsResponse } from '@/app/product-options';
import type { ImageEditJob } from '@/app/automation/image-edit';

/** Read current rows so applying an image never restores stale names or prices. */
export async function adoptGeneratedOptionImage(productId: string, job: ImageEditJob, imageKeys: readonly string[], request: typeof fetch = fetch): Promise<number> {
  const source = job.review.sourceKey;
  const result = job.result?.storageKey;
  if (job.productId !== productId || job.status !== 'completed' || !job.result?.attached || !result || source === result || !imageKeys.includes(source) || !imageKeys.includes(result)) {
    throw Error('현재 상품에 첨부된 완료 결과와 원본을 확인해주세요.');
  }
  const url = `/api/products/${encodeURIComponent(productId)}/options`;
  const response = await request(url, { cache: 'no-store' });
  const current = await response.json() as ProductOptionsResponse & { error?: string };
  if (!response.ok) throw Error(current.error ?? '옵션을 불러오지 못했습니다.');
  if (current.options?.productId !== productId || !Number.isSafeInteger(current.options.revision) || !current.productVersion) throw Error('옵션 저장 버전을 확인하지 못했습니다.');
  let count = 0;
  const rows = optionInputs(current.options).map(row => {
    if (row.imageKey !== source) return row;
    count++;
    return { ...row, imageKey: result };
  });
  if (!count) throw Error('이 원본을 대표 이미지로 사용하는 옵션이 없습니다. 옵션 이미지에서 직접 선택해주세요.');
  const saved = await request(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: current.options.revision, expectedProductVersion: current.productVersion, rows }) });
  const value = await saved.json() as Partial<ProductOptionsResponse> & { error?: string };
  if (!saved.ok) throw Error(value.error ?? '옵션 이미지를 저장하지 못했습니다.');
  if (value.options?.productId !== productId || !value.productVersion) throw Error('저장 결과를 확인하지 못했습니다. 옵션을 새로고침해주세요.');
  return count;
}
