import type { QuotationFieldsView } from '@/app/quotation-schema';
import { quotationLabelPlan } from '@/app/quotation-label-plan';
import { labelUploadDigest } from '@/app/label-upload-key';

type Context = { productId: string; endpoint: string; view: QuotationFieldsView; optionId: string | null };
/** Bump this recipe when the PNG layout changes; revisions and prices are not its contents. */
export async function quotationLabelUploadId(input: Context) {
  return labelUploadDigest(new TextEncoder().encode(JSON.stringify({ recipe: 'quotation-label-png-v1', productId: input.productId,
    endpoint: input.endpoint, category: input.view.categoryContext, optionId: input.optionId,
    plan: quotationLabelPlan(input.view.resolved, input.optionId) })));
}

/** A missing file is explicit. Failed reads must never silently become a new upload. */
export async function findQuotationLabelUpload(input: Context, request: typeof fetch = fetch) {
  const uploadId = await quotationLabelUploadId(input);
  const response = await request(`/api/files?labelUploadId=${uploadId}`, { cache: 'no-store' });
  const body = await response.json() as { key?: unknown; error?: string } | null;
  if (!response.ok) throw new Error(body?.error || '저장한 라벨 파일을 확인하지 못했습니다.');
  if (!body || (body.key !== null && (typeof body.key !== 'string' || !body.key || body.key.length > 512))) throw new Error('저장한 라벨 파일의 응답을 확인하지 못했습니다.');
  return { uploadId, key: body.key as string | null };
}
