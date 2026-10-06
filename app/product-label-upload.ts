import { productLabelPlan, verifyProductLabelsView, type ProductLabelsView } from '@/app/product-label';
import { labelUploadDigest } from '@/app/label-upload-key';

export type ProductLabelUploadContext = { productId: string; endpoint: string; view: ProductLabelsView; optionId: string | null };
export type ProductLabelUploadCache = { signature: string; uploadedKey: string | null; rendered: { blob: Blob; width: number; height: number } | null };
export function productLabelPreviewSignature(input: ProductLabelUploadContext) {
  verifyProductLabelsView(input.view, input.optionId);
  if (input.view.productId !== input.productId) throw Error('표시사항을 만든 상품을 확인해주세요.');
  return JSON.stringify({ productId: input.productId, endpoint: input.endpoint, category: input.view.categoryContext, optionId: input.optionId, plan: productLabelPlan(input.view, input.optionId) });
}
/** This recipe describes the nine-row product label, independent of the
 * category's stage-seven legal notice, unrelated prices or source revisions. */
export async function productLabelUploadId(input: ProductLabelUploadContext) {
  return labelUploadDigest(new TextEncoder().encode(JSON.stringify({ recipe: 'product-label-png-v1', signature: productLabelPreviewSignature(input) })));
}
/** Failed lookup is never permission to create a second upload. The server's
 * owner-scoped recipe receipt survives source refreshes and editor remounts. */
export async function findProductLabelUpload(input: ProductLabelUploadContext, request: typeof fetch = fetch) {
  const uploadId = await productLabelUploadId(input), response = await request(`/api/files?labelUploadId=${uploadId}`, { cache: 'no-store' });
  const body = await response.json() as { key?: unknown; contentType?: unknown; sha256?: unknown; size?: unknown; error?: string } | null;
  if (!response.ok) throw Error(body?.error || '저장한 제품 표시사항 파일을 확인하지 못했습니다.');
  if (!body || body.key !== null && (typeof body.key !== 'string' || !body.key || body.key.length > 512
    || body.contentType !== 'image/png' || typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.sha256)
    || !Number.isSafeInteger(body.size) || (body.size as number) < 1 || (body.size as number) > 10 * 1024 * 1024))
    throw Error('저장한 제품 표시사항 파일의 응답을 확인하지 못했습니다.');
  return { uploadId, key: body.key as string | null };
}
