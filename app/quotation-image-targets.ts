import { applyQuotationChanges, quotationValueIssues, validateQuotationChanges, type QuotationChange, type QuotationField, type QuotationFieldsView } from '@/app/quotation-schema';
import { exactPrimaryQuotationTarget, type PrimaryQuotationTarget } from '@/app/quotation-seo-targets';

export type OptionImageStage = 'additional' | 'detail';
export type OptionImageInput = 'additionalImages' | 'detailImages' | 'detailHtml';
export type OptionImageDraft = Partial<Record<OptionImageInput, string | null>>;
const inputs = ['additionalImages', 'detailImages', 'detailHtml'] as const;
const htmlPath = ['imagePage', 'details', 'htmlProductDetailContent'];

/** HTML is editable text, not executed content. Only the captured primary wire
 * can substitute for the canonical value; similar labels are not bindings. */
export function exactDetailHtmlTarget(fields: readonly QuotationField[]): PrimaryQuotationTarget {
  const canonical = fields.filter(field => field.id === 'detailHtml');
  const wires = fields.filter(field => !field.hubWire?.name && JSON.stringify(field.hubWire?.path) === JSON.stringify(htmlPath));
  if (canonical.length !== 1 || wires.length > 1) throw Error('상세 HTML 항목의 연결을 하나로 확인하지 못했습니다. 견적서 상세 항목을 확인해주세요.');
  const primaryField = wires[0] ?? canonical[0];
  if (wires[0] && primaryField.hubInput !== 'detailHtml') throw Error('Supplier Hub 상세 HTML 항목의 원천 연결을 확인하지 못했습니다.');
  const linked = primaryField.id === canonical[0].id ? [primaryField] : [canonical[0], primaryField];
  if (linked.some(field => !['text', 'textarea'].includes(field.type) || field.numericText)) throw Error('상세 HTML 항목의 입력 규칙을 확인하지 못했습니다.');
  return { primary: primaryField.id, primaryField, linked: linked.map(field => field.id), fields: linked };
}
export function optionImageTargets(fields: readonly QuotationField[]) {
  return { additionalImages: exactPrimaryQuotationTarget(fields, 'additionalImages'), detailImages: exactPrimaryQuotationTarget(fields, 'detailImages'), detailHtml: exactDetailHtmlTarget(fields) };
}
export const quotationImageKeys = (value: string) => value.split('\n').map(key => key.trim()).filter(Boolean);
export function optionImageValue(view: QuotationFieldsView, optionId: string, input: OptionImageInput, draft: OptionImageDraft = {}, fieldId?: string): string {
  const target = optionImageTargets(view.resolved.schema.fields)[input], id = fieldId ?? target.primary;
  if (Object.hasOwn(draft, input)) {
    const value = draft[input];
    if (value !== null && value !== undefined) return value;
    return view.overrides.common[id] ?? view.automatic.rows.find(row => row.optionId === optionId)?.fields[id]?.value ?? '';
  }
  return view.resolved.rows.find(row => row.optionId === optionId)?.fields[id]?.value ?? '';
}
export function optionImageChanges(view: QuotationFieldsView, optionId: string, draft: OptionImageDraft): QuotationChange[] {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(optionId) || view.resolved.rows.filter(row => row.optionId === optionId).length !== 1) throw Error('이 상품에 저장된 옵션을 선택해주세요.');
  const targets = optionImageTargets(view.resolved.schema.fields);
  const changes = inputs.flatMap(input => Object.hasOwn(draft, input) ? targets[input].linked.map(fieldKey => ({ fieldKey, optionId, value: draft[input]! })) : []);
  return validateQuotationChanges(changes, { schema: view.resolved.schema, optionIds: view.resolved.rows.flatMap(row => row.optionId ? [row.optionId] : []), ownedImageKeys: view.imageKeys, overrides: view.overrides });
}
export function optionImageDraftIssues(view: QuotationFieldsView, optionId: string, draft: OptionImageDraft) {
  const targets = optionImageTargets(view.resolved.schema.fields);
  return inputs.flatMap(input => !Object.hasOwn(draft, input) ? [] : targets[input].fields.flatMap(field => {
    const value = optionImageValue(view, optionId, input, draft, field.id);
    // Explicit empty draft values remain editable; the final form reports its
    // required/minimum-length errors. Unedited HTML is never silently changed.
    return value.trim() ? quotationValueIssues(field, value, view.imageKeys) : [];
  }));
}
export function verifyOptionImageRefresh(before: QuotationFieldsView, latest: QuotationFieldsView, optionId: string, draft: OptionImageDraft) {
  if (latest.revision < before.revision || !Number.isFinite(Date.parse(latest.productVersion)) || !Number.isFinite(Date.parse(before.productVersion))
    || Date.parse(latest.productVersion) < Date.parse(before.productVersion) || latest.contentRevision < before.contentRevision || latest.optionRevision < before.optionRevision
    || JSON.stringify(latest.categoryContext) !== JSON.stringify(before.categoryContext)
    || latest.resolved.rows.filter(row => row.optionId === optionId).length !== 1) throw Error('옵션 또는 카테고리가 변경되었습니다. 이미지 입력은 유지했습니다.');
  const previous = optionImageTargets(before.resolved.schema.fields), current = optionImageTargets(latest.resolved.schema.fields);
  for (const input of inputs) {
    if (!Object.hasOwn(draft, input)) continue;
    if (JSON.stringify(previous[input]) !== JSON.stringify(current[input])) throw Error('수정 중인 이미지 항목의 연결이 변경되었습니다. 입력은 유지했습니다.');
    for (const id of previous[input].linked) {
      const oldValue = before.overrides.options[optionId]?.[id] ?? null, newValue = latest.overrides.options[optionId]?.[id] ?? null;
      if (oldValue !== newValue && newValue !== draft[input]) throw Error('선택 옵션 이미지에 다른 저장값이 있습니다. 입력을 보관한 뒤 저장본과 비교해주세요.');
    }
  }
  if (Object.keys(draft).length) applyQuotationChanges(latest.overrides, optionImageChanges(latest, optionId, draft));
}
/** A quote-field PUT advances only its own revision and product clock. Source
 * or other manual edits are never accepted as our successful save response. */
export function verifyOptionImageSave(before: QuotationFieldsView, body: QuotationFieldsView, optionId: string, changes: readonly QuotationChange[]) {
  if (body.revision !== before.revision + 1 || body.updatedAt !== body.productVersion
    || !Number.isFinite(Date.parse(body.productVersion)) || !Number.isFinite(Date.parse(before.productVersion))
    || Date.parse(body.productVersion) <= Date.parse(before.productVersion)
    || body.contentRevision !== before.contentRevision || body.optionRevision !== before.optionRevision
    || JSON.stringify(body.imageKeys) !== JSON.stringify(before.imageKeys)
    || JSON.stringify(body.categoryContext) !== JSON.stringify(before.categoryContext)
    || JSON.stringify(optionImageTargets(body.resolved.schema.fields)) !== JSON.stringify(optionImageTargets(before.resolved.schema.fields)))
    throw Error('옵션 이미지 저장 버전을 확인하지 못했습니다. 입력은 유지했습니다.');
  const expected = applyQuotationChanges(before.overrides, changes), stored = body.overrides.options[optionId] ?? {}, row = body.resolved.rows.find(row => row.optionId === optionId)!;
  if (JSON.stringify(body.overrides) !== JSON.stringify(expected) || changes.some(change => {
    const cell = row.fields[change.fieldKey];
    if (change.value !== null) return !Object.hasOwn(stored, change.fieldKey) || stored[change.fieldKey] !== change.value || cell?.value !== change.value;
    if (Object.hasOwn(stored, change.fieldKey) || !cell) return true;
    const field = body.resolved.schema.fields.find(field => field.id === change.fieldKey)!, common = body.overrides.common;
    if (Object.hasOwn(common, change.fieldKey)) return cell.value !== common[change.fieldKey] || cell.source !== 'manual-common';
    if (field.type === 'images') { const automatic = body.automatic.rows.find(row => row.optionId === optionId)?.fields[change.fieldKey]; return !automatic || cell.value !== automatic.value || cell.source !== automatic.source; }
    // Automatic HTML is generated from this row's final images/alt text. The
    // global automatic snapshot can therefore have different, valid URLs.
    return ['manual-common', 'manual-option'].includes(cell.source);
  }))
    throw Error('저장 응답의 옵션 이미지가 요청한 값과 다릅니다. 입력은 유지했습니다.');
}
/** Reset HTML depends on the final per-SKU images, so confirm its computed
 * value against a fresh, unchanged GET rather than a global fallback guess. */
export function verifyOptionImageRestored(acknowledged: QuotationFieldsView, confirmed: QuotationFieldsView, optionId: string, changes: readonly QuotationChange[]) {
  if (confirmed.revision !== acknowledged.revision || confirmed.productVersion !== acknowledged.productVersion
    || confirmed.inputFingerprint !== acknowledged.inputFingerprint || confirmed.updatedAt !== acknowledged.updatedAt)
    throw Error('이미지 복원 확인 중 저장 상태가 변경됐습니다. 입력은 유지했습니다.');
  const before = acknowledged.resolved.rows.find(row => row.optionId === optionId)!, after = confirmed.resolved.rows.find(row => row.optionId === optionId)!;
  if (changes.some(change => change.value === null && (before.fields[change.fieldKey]?.value !== after.fields[change.fieldKey]?.value || before.fields[change.fieldKey]?.source !== after.fields[change.fieldKey]?.source)))
    throw Error('이미지 복원 응답의 최종값이 최신 저장본과 다릅니다. 입력은 유지했습니다.');
}
