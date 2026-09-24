import type { QuotationFieldsView } from '@/app/quotation-schema';
import type { DocumentImagePlan } from '@/app/document-image';
import { quotationLabelPlan } from '@/app/quotation-label-plan';
import { attachQuotationLabel } from '@/app/quotation-label-attachment';

export type LabelBatchProgress = { completed: number; total: number; optionLabel: string };
/** Sequential uploads keep memory bounded. The caller retains uploaded keys on failure. */
export async function attachQuotationLabels(input: {
  productId: string; endpoint: string; view: QuotationFieldsView;
  uploaded: Map<string | null, string>;
  render: (plan: DocumentImagePlan) => Promise<{ blob: Blob }>;
  onProgress: (progress: LabelBatchProgress) => void;
}, request: typeof fetch = fetch): Promise<QuotationFieldsView> {
  const rows = input.view.resolved.rows.filter(row => row.included);
  if (!rows.length) throw new Error('견적에 포함할 옵션을 선택해주세요.');
  // Validate every plan before generating or uploading the first image.
  const plans = rows.map(row => quotationLabelPlan(input.view.resolved, row.optionId));
  let latest = input.view;
  for (const [index, row] of rows.entries()) {
    input.onProgress({ completed: index, total: rows.length, optionLabel: row.optionLabel });
    const key = input.uploaded.get(row.optionId) ?? null;
    const blob = key ? null : (await input.render(plans[index])).blob;
    latest = await attachQuotationLabel({ productId: input.productId, endpoint: input.endpoint,
      renderedView: input.view, optionId: row.optionId, blob, uploadedKey: key,
      onUploaded: uploadedKey => input.uploaded.set(row.optionId, uploadedKey),
    }, request);
    input.onProgress({ completed: index + 1, total: rows.length, optionLabel: row.optionLabel });
  }
  return latest;
}
