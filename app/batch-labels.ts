import { attachQuotationLabels, type LabelBatchProgress } from '@/app/quotation-label-batch';
import { quotationLabelPlan } from '@/app/quotation-label-plan';
import type { DocumentImagePlan } from '@/app/document-image';
import type { QuotationFieldsView } from '@/app/quotation-schema';

export type ProductLabelCache = Map<string, { signature: string; uploaded: Map<string | null, string> }>;
export async function runProductLabels(productId: string, options: {
  cache: ProductLabelCache;
  render: (plan: DocumentImagePlan) => Promise<{ blob: Blob }>;
  shouldStop: () => boolean;
  onProgress: (progress: LabelBatchProgress) => void;
  fetcher?: typeof fetch;
}) {
  if (options.shouldStop()) return null;
  const request = options.fetcher ?? fetch;
  const endpoint = `/api/products/${encodeURIComponent(productId)}/quotation-fields`;
  const response = await request(endpoint, { cache: 'no-store' });
  const view = await response.json() as QuotationFieldsView & { error?: string };
  if (!response.ok) throw new Error(view?.error || '상품 견적을 읽지 못했습니다.');
  if (options.shouldStop()) return null;
  if (!view?.resolved?.schema?.categoryId || !Array.isArray(view.resolved.rows) || !Array.isArray(view.imageKeys)) throw new Error('상품 카테고리와 저장된 견적을 먼저 확인해주세요.');
  const rows = view.resolved.rows.filter(row => row.included);
  if (!rows.length) throw new Error('견적에 포함할 옵션이 없습니다.');
  const signature = JSON.stringify({ category: view.categoryContext, plans: rows.map(row => [row.optionId, quotationLabelPlan(view.resolved, row.optionId)]) });
  let cached = options.cache.get(productId);
  // A changed label must never reuse bytes generated for an earlier plan.
  if (!cached || cached.signature !== signature) {
    cached = { signature, uploaded: new Map() };
    options.cache.set(productId, cached);
  }
  return attachQuotationLabels({ productId, endpoint, view, uploaded: cached.uploaded,
    render: options.render, shouldStop: options.shouldStop, onProgress: options.onProgress }, request);
}
