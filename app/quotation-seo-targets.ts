import { applyQuotationChanges, quotationValueIssues, validateQuotationChanges, type QuotationChange, type QuotationField, type QuotationFieldsView } from '@/app/quotation-schema';

export type PrimaryQuotationInput = 'title' | 'searchTags' | 'mainImage' | 'additionalImages' | 'detailImages' | 'labelImages';
export type PrimaryQuotationTarget = { primary: string; linked: string[]; primaryField: QuotationField; fields: QuotationField[] };
const paths: Partial<Record<PrimaryQuotationInput, string[]>> = {
  title: ['startPage', 'productName'], searchTags: ['productPage', 'searchTags'],
  mainImage: ['imagePage', 'images', 'mainImage'], additionalImages: ['imagePage', 'images', 'additionalImage'],
  detailImages: ['imagePage', 'details', 'detailedImage'],
};

/** A matching label is not a source binding. Named label-image controls keep
 * their existing canonical identity; unrelated live controls never substitute. */
export function exactPrimaryQuotationTarget(fields: readonly QuotationField[], input: PrimaryQuotationInput): PrimaryQuotationTarget {
  const canonical = fields.filter(field => field.id === input), path = paths[input];
  const wires = path ? fields.filter(field => !field.hubWire?.name && JSON.stringify(field.hubWire?.path) === JSON.stringify(path)) : [];
  if (canonical.length !== 1 || wires.length > 1) throw Error('선택한 항목의 연결을 하나로 확인하지 못했습니다. 견적서 상세 항목을 확인해주세요.');
  const wire = wires[0];
  if (wire && wire.hubInput !== input) throw Error('Supplier Hub 항목의 원천 연결을 확인하지 못했습니다. 견적서 상세 항목을 확인해주세요.');
  const primaryField = wire ?? canonical[0];
  const linkedFields = primaryField.id === canonical[0].id ? [primaryField] : [canonical[0], primaryField];
  const images = !['title', 'searchTags'].includes(input);
  if (linkedFields.some(field => images ? field.type !== 'images' : !['text', 'textarea', 'select'].includes(field.type) || field.numericText))
    throw Error('선택한 항목의 입력 규칙을 확인하지 못했습니다. 견적서 상세 항목을 확인해주세요.');
  return { primary: primaryField.id, linked: linkedFields.map(field => field.id), primaryField, fields: linkedFields };
}
export type OptionSeoInput = 'title' | 'searchTags';
export type OptionSeoDraft = Partial<Record<OptionSeoInput, string | null>>;
export function quotationSeoTargets(fields: readonly QuotationField[]) {
  return { title: exactPrimaryQuotationTarget(fields, 'title'), searchTags: exactPrimaryQuotationTarget(fields, 'searchTags') };
}
export function optionSeoChanges(view: QuotationFieldsView, optionId: string, draft: OptionSeoDraft): QuotationChange[] {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(optionId) || view.resolved.rows.filter(row => row.optionId === optionId).length !== 1)
    throw Error('이 상품에 저장된 옵션을 선택해주세요.');
  const targets = quotationSeoTargets(view.resolved.schema.fields);
  const changes = (['title', 'searchTags'] as const).flatMap(input => Object.hasOwn(draft, input)
    ? targets[input].linked.map(fieldKey => ({ optionId, fieldKey, value: draft[input]! })) : []);
  return validateQuotationChanges(changes, { schema: view.resolved.schema, optionIds: view.resolved.rows.flatMap(row => row.optionId ? [row.optionId] : []), ownedImageKeys: view.imageKeys, overrides: view.overrides });
}
/** Draft reset inherits each field's own common override before its automatic
 * value. Explicit '' remains a manual blank and never acquires a fallback. */
export function optionSeoValue(view: QuotationFieldsView, optionId: string, input: OptionSeoInput, draft: OptionSeoDraft = {}, fieldId?: string) {
  const target = quotationSeoTargets(view.resolved.schema.fields)[input], id = fieldId ?? target.primary;
  if (Object.hasOwn(draft, input)) {
    const value = draft[input];
    if (value !== null && value !== undefined) return value;
    return view.overrides.common[id] ?? view.automatic.rows.find(row => row.optionId === optionId)?.fields[id]?.value ?? '';
  }
  return view.resolved.rows.find(row => row.optionId === optionId)?.fields[id]?.value ?? '';
}
export function optionSeoDraftIssues(view: QuotationFieldsView, optionId: string, draft: OptionSeoDraft) {
  const targets = quotationSeoTargets(view.resolved.schema.fields);
  return (['title', 'searchTags'] as const).flatMap(input => targets[input].fields.flatMap(field => {
    const value = optionSeoValue(view, optionId, input, draft, field.id);
    // A deliberately empty draft may be saved; output readiness still reports
    // its required/minimum-length errors in the quotation resolver.
    return value.trim() ? quotationValueIssues(field, value, view.imageKeys) : [];
  }));
}
export function verifyOptionSeoRefresh(before: QuotationFieldsView, latest: QuotationFieldsView, optionId: string, draft: OptionSeoDraft) {
  if (latest.revision < before.revision || JSON.stringify(latest.categoryContext) !== JSON.stringify(before.categoryContext)
    || latest.resolved.rows.filter(row => row.optionId === optionId).length !== 1) throw Error('옵션 또는 카테고리가 변경되었습니다. 입력은 유지했습니다.');
  const oldTargets = quotationSeoTargets(before.resolved.schema.fields), newTargets = quotationSeoTargets(latest.resolved.schema.fields);
  for (const input of ['title', 'searchTags'] as const) {
    if (!Object.hasOwn(draft, input)) continue;
    if (JSON.stringify(oldTargets[input]) !== JSON.stringify(newTargets[input])) throw Error('수정 중인 SEO 항목의 연결이 변경되었습니다. 입력은 유지했습니다.');
    for (const id of oldTargets[input].linked) {
      const oldValue = before.overrides.options[optionId]?.[id] ?? null, current = latest.overrides.options[optionId]?.[id] ?? null;
      if (oldValue !== current && current !== draft[input]) throw Error('선택 옵션의 SEO에 다른 저장값이 있습니다. 입력을 보관한 뒤 저장본과 비교해주세요.');
    }
  }
  // Check the draft against all current constraints without modifying state.
  if (Object.keys(draft).length) applyQuotationChanges(latest.overrides, optionSeoChanges(latest, optionId, draft));
}
