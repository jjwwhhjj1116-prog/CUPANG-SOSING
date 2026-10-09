import type { QuotationFieldsView } from '@/app/quotation-schema';
import { quotationLabelPlan } from '@/app/quotation-label-plan';
import { labelUploadDigest } from '@/app/label-upload-key';

type Context = { productId: string; endpoint: string; view: QuotationFieldsView; optionId: string | null };
export const QUOTATION_LABEL_PNG_RECIPE = 'quotation-label-png-v2';
export type QuotationLabelReceipt = {
  recipe: typeof QUOTATION_LABEL_PNG_RECIPE; productId: string; optionId: string | null; profileId: string | null;
  planSha256: string; categorySha256: string;
};
const digest = (value: unknown) => labelUploadDigest(new TextEncoder().encode(JSON.stringify(value)));
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Read server evidence, never infer generated ownership from a filename. */
export async function readQuotationLabelReceipt(uploadId: string, request: typeof fetch = fetch) {
  if (!sha256(uploadId)) throw Error('라벨 업로드 번호를 확인해주세요.');
  const response = await request(`/api/files?labelUploadId=${uploadId}`, { cache: 'no-store' });
  const body = await response.json() as { key?: unknown; error?: string; contentType?: unknown; size?: unknown; sha256?: unknown; quotationLabelProof?: unknown } | null;
  if (!response.ok) throw Error(body?.error || '저장한 라벨 파일을 확인하지 못했습니다.');
  if (!body || Array.isArray(body) || (body.key !== null && (typeof body.key !== 'string' || !body.key || body.key.length > 512))) throw Error('저장한 라벨 파일의 응답을 확인하지 못했습니다.');
  const key = body.key as string | null;
  if (key && (!key.endsWith(`/quotation-label-${uploadId}.png`) || body.contentType !== 'image/png'
    || !Number.isSafeInteger(body.size) || (body.size as number) < 1 || (body.size as number) > 10 * 1024 * 1024 || !sha256(body.sha256))) throw Error('저장한 라벨 파일의 응답을 확인하지 못했습니다.');
  let proof: QuotationLabelReceipt | null = null;
  if (Object.hasOwn(body, 'quotationLabelProof')) {
    const value = body.quotationLabelProof as QuotationLabelReceipt;
    if (!key || !value || typeof value !== 'object' || Array.isArray(value) || value.recipe !== QUOTATION_LABEL_PNG_RECIPE
      || !identifier(value.productId) || value.optionId !== null && !identifier(value.optionId)
      || value.profileId !== null && !identifier(value.profileId) || !sha256(value.planSha256) || !sha256(value.categorySha256)) throw Error('견적 표시사항 PNG의 저장 원천 응답을 확인하지 못했습니다.');
    proof = value;
  }
  return { uploadId, key, proof };
}
/** Bump this recipe when the PNG layout changes; revisions and prices are not its contents. */
export async function quotationLabelUploadId(input: Context) {
  return labelUploadDigest(new TextEncoder().encode(JSON.stringify({ recipe: QUOTATION_LABEL_PNG_RECIPE, productId: input.productId,
    endpoint: input.endpoint, category: input.view.categoryContext, optionId: input.optionId,
    plan: quotationLabelPlan(input.view.resolved, input.optionId) })));
}

/** A missing file is explicit. Failed reads must never silently become a new upload. */
export async function findQuotationLabelUpload(input: Context, request: typeof fetch = fetch) {
  const uploadId = await quotationLabelUploadId(input);
  const stored = await readQuotationLabelReceipt(uploadId, request), proof = stored.proof;
  if (stored.key && (!proof || proof.productId !== input.productId || proof.optionId !== input.optionId
    || proof.profileId !== input.view.categoryContext.profileId
    || proof.categorySha256 !== await digest([input.view.categoryContext.categoryId, input.view.categoryContext.categoryPath])
    || proof.planSha256 !== await digest(quotationLabelPlan(input.view.resolved, input.optionId)))) throw Error('이 견적 표시사항의 저장된 PNG 원천이 일치하지 않습니다. 최신 값으로 다시 확인해주세요.');
  return stored;
}
