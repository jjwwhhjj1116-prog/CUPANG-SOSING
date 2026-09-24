import type { QuotationFieldsView } from '@/app/quotation-schema';
import type { DocumentImagePlan } from '@/app/document-image';
import { quotationLabelPlan } from '@/app/quotation-label-plan';
import { attachQuotationLabel } from '@/app/quotation-label-attachment';

export type LabelBatchProgress = { completed: number; total: number; optionLabel: string };
export type LabelBatchResult = { view: QuotationFieldsView; completed: number; total: number; stopped: boolean };
/** Sequential uploads keep memory bounded. The caller retains uploaded keys on failure. */
export async function attachQuotationLabels(input: {
  productId: string; endpoint: string; view: QuotationFieldsView;
  uploaded: Map<string | null, string>;
  render: (plan: DocumentImagePlan) => Promise<{ blob: Blob }>;
  onProgress: (progress: LabelBatchProgress) => void;
  shouldStop?: () => boolean;
}, request: typeof fetch = fetch): Promise<LabelBatchResult> {
  const rows = input.view.resolved.rows.filter(row => row.included);
  if (!rows.length) throw new Error('견적에 포함할 옵션을 선택해주세요.');
  // Validate every plan before generating or uploading the first image.
  const plans = rows.map(row => quotationLabelPlan(input.view.resolved, row.optionId));
  let latest = input.view;
  const result = (completed: number, stopped: boolean): LabelBatchResult => ({ view: latest, completed, total: rows.length, stopped });
  if (input.shouldStop?.()) return result(0, true);
  // Read current capacity, including partial uploads from an earlier attempt.
  const response = await request(input.endpoint, { cache: 'no-store' });
  const current = await response.json() as (QuotationFieldsView & { error?: string }) | null;
  if (!response.ok) throw new Error(current?.error || '최신 견적을 확인하지 못했습니다.');
  latest = current as QuotationFieldsView;
  if (!latest?.resolved || !Array.isArray(latest.imageKeys)) throw new Error('최신 견적을 확인하지 못했습니다.');
  if (JSON.stringify(latest.categoryContext) !== JSON.stringify(input.view.categoryContext)) throw new Error('카테고리가 변경되었습니다. 최신 견적을 불러와주세요.');
  let newFiles = 0;
  const pendingKeys = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (JSON.stringify(quotationLabelPlan(latest.resolved, row.optionId)) !== JSON.stringify(plans[index])) throw new Error('표시사항 값이 변경되었습니다. 최신 견적을 불러와주세요.');
    const key = input.uploaded.get(row.optionId);
    const target = latest.resolved.rows.find(item => item.optionId === row.optionId)!;
    const labels = (target.fields.labelImages?.value ?? '').split('\n').map(value => value.trim()).filter(Boolean);
    if ((!key || !labels.includes(key)) && labels.length >= 30) throw new Error(`${row.optionLabel}: 라벨 30개 한도입니다. 기존 첨부를 확인해주세요.`);
    if (!key) newFiles++;
    else if (!latest.imageKeys.includes(key)) pendingKeys.add(key);
  }
  const required = newFiles + pendingKeys.size;
  if (latest.imageKeys.length + required > 50) throw new Error(`상품 이미지 50개 한도입니다. 현재 ${latest.imageKeys.length}개이며 라벨 연결에 ${required}개 공간이 더 필요합니다.`);
  for (const [index, row] of rows.entries()) {
    if (input.shouldStop?.()) return result(index, true);
    input.onProgress({ completed: index, total: rows.length, optionLabel: row.optionLabel });
    const key = input.uploaded.get(row.optionId) ?? null;
    const blob = key ? null : (await input.render(plans[index])).blob;
    if (input.shouldStop?.()) return result(index, true);
    latest = await attachQuotationLabel({ productId: input.productId, endpoint: input.endpoint,
      renderedView: input.view, optionId: row.optionId, blob, uploadedKey: key,
      onUploaded: uploadedKey => input.uploaded.set(row.optionId, uploadedKey),
    }, request);
    input.onProgress({ completed: index + 1, total: rows.length, optionLabel: row.optionLabel });
  }
  return result(rows.length, false);
}
