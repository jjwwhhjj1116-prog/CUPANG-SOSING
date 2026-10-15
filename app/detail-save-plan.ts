import { applyQuotationChanges, validateQuotationChanges, type QuotationChange, type QuotationFieldsView } from '@/app/quotation-schema';
import { optionImageTargets } from '@/app/quotation-image-targets';
import { OPTION_LIMIT } from '@/app/product-options';
import { MAX_IMAGE_BYTES } from '@/app/image-files';

export type DetailSaveReceipt = {
  uploadId: string; key: string; sha256: string; bytes: number; revision: number; beforeRevision: number;
  sourceOptionId: string; categoryId: string | null; optionIds: string[];
};
export type DetailSaveSource = { key: string; sha256: string; width: number; height: number };
export type DetailSaveBackup = {
  receipt: DetailSaveReceipt; before: QuotationChange[]; sources: DetailSaveSource[];
  beforeProductVersion: string; beforeInputFingerprint: string; updatedAt: string;
};

export function detailSaveOptionIds(view: QuotationFieldsView): string[] {
  const ids = view.resolved.rows.flatMap(row => row.optionId === null ? [] : [row.optionId]);
  if (!ids.length || ids.length > OPTION_LIMIT || new Set(ids).size !== ids.length || ids.some(id => !/^[A-Za-z0-9_-]{1,80}$/.test(id)))
    throw Error('상세 이미지를 저장할 실제 옵션 목록을 확인해주세요.');
  return ids;
}
/** An explicit stage-five save replaces the two final fields in the common
 * layer and every real option, including options currently excluded from export. */
export function detailSaveChanges(view: QuotationFieldsView, key: string): QuotationChange[] {
  const optionIds = detailSaveOptionIds(view), targets = optionImageTargets(view.resolved.schema.fields);
  const changes = [null, ...optionIds].flatMap(optionId => [
    ...targets.detailImages.linked.map(fieldKey => ({ optionId, fieldKey, value: key })),
    ...targets.detailHtml.linked.map(fieldKey => ({ optionId, fieldKey, value: '' })),
  ]);
  return validateQuotationChanges(changes, { schema: view.resolved.schema, optionIds,
    ownedImageKeys: [...new Set([...view.imageKeys, key])], overrides: view.overrides });
}
/** Preserve only fields this command overwrites; null records an absent own
 * property, which is different from an intentionally saved empty string. */
export function detailSaveManualBackup(view: QuotationFieldsView, changes: readonly QuotationChange[]): QuotationChange[] {
  return changes.map(({ optionId, fieldKey }) => {
    const layer = optionId === null ? view.overrides.common : view.overrides.options[optionId];
    return { optionId, fieldKey, value: layer && Object.hasOwn(layer, fieldKey) ? layer[fieldKey] : null };
  });
}
export function detailSaveReceiptMatches(view: QuotationFieldsView, receipt: DetailSaveReceipt): boolean {
  try {
    if (!receipt || !/^[a-f0-9]{64}$/.test(receipt.uploadId) || !/^[a-f0-9]{64}$/.test(receipt.sha256)
      || !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 1 || receipt.bytes > MAX_IMAGE_BYTES
      || !Number.isSafeInteger(receipt.beforeRevision) || receipt.beforeRevision < 0 || receipt.revision !== receipt.beforeRevision + 1
      || receipt.revision !== view.revision || receipt.categoryId !== view.categoryContext.categoryId
      || JSON.stringify(receipt.optionIds) !== JSON.stringify(detailSaveOptionIds(view)) || !receipt.optionIds.includes(receipt.sourceOptionId)
      || !view.imageKeys.includes(receipt.key) || view.updatedAt !== view.productVersion) return false;
    const changes = detailSaveChanges(view, receipt.key), expected = applyQuotationChanges(view.overrides, changes);
    if (JSON.stringify(expected) !== JSON.stringify(view.overrides)) return false;
    return changes.every(change => view.resolved.rows.filter(row => change.optionId === null || row.optionId === change.optionId)
      .every(row => row.fields[change.fieldKey]?.value === change.value));
  } catch { return false; }
}
