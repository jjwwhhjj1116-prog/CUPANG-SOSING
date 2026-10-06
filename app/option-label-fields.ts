import { applyQuotationChanges, getQuotationSchema, quotationValueIssues, validateQuotationChanges, type QuotationChange, type QuotationField, type QuotationFieldsView } from '@/app/quotation-schema';
import { isQuotationLegalNotice } from '@/app/quotation-notice-inputs';
import { quotationLabelPlan } from '@/app/quotation-label-plan';

export type OptionLabelDraft = Record<string, string | null>;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Live notices require their complete named legalPage.notices identity.
 * Recorded category notices are the exact additions to the canonical common
 * schema; certification controls and similar labels do not become notices. */
export function optionLabelFields(view: QuotationFieldsView): QuotationField[] {
  const schema = view.resolved.schema;
  const commonIds = new Set(getQuotationSchema(null).fields.map(field => field.id));
  const recorded = getQuotationSchema(schema.categoryId, schema.categoryPath).fields
    .filter(field => field.section === 'legal' && !commonIds.has(field.id));
  const targets = schema.fields.filter(field => field.section === 'legal' && field.visibility === 'common'
    && (field.hubWire ? isQuotationLegalNotice(field) : recorded.some(saved => saved.id === field.id && saved.label === field.label)));
  if (targets.some(field => schema.fields.filter(candidate => candidate.id === field.id).length !== 1 || field.type === 'images'))
    throw Error('카테고리 상품고시 항목의 연결을 하나로 확인하지 못했습니다. 견적서 상세 항목을 확인해주세요.');
  return targets;
}

export function verifyOptionLabelView(view: QuotationFieldsView, optionId: string, profileId?: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(optionId) || !view || !Number.isSafeInteger(view.revision) || view.revision < 0
    || !Number.isSafeInteger(view.contentRevision) || view.contentRevision < 0 || !Number.isSafeInteger(view.optionRevision) || view.optionRevision < 0
    || !Number.isFinite(Date.parse(view.productVersion)) || !/^[a-f0-9]{64}$/.test(view.inputFingerprint)
    || !Array.isArray(view.imageKeys) || view.imageKeys.some(key => typeof key !== 'string')
    || !view.overrides?.common || !view.overrides.options || !Array.isArray(view.resolved?.schema?.fields)
    || !Array.isArray(view.resolved.rows) || !Array.isArray(view.automatic?.rows)
    || view.resolved.rows.filter(row => row.optionId === optionId).length !== 1
    || view.automatic.rows.filter(row => row.optionId === optionId).length !== 1
    || !view.resolved.schema.categoryId || view.categoryContext?.categoryId !== view.resolved.schema.categoryId
    || (profileId && view.categoryContext.profileId !== profileId))
    throw Error('선택한 상품·옵션의 상품고시 저장본을 확인하지 못했습니다. 상품을 다시 열어주세요.');
  const fields = optionLabelFields(view), row = view.resolved.rows.find(row => row.optionId === optionId)!;
  if (fields.some(field => typeof row.fields[field.id]?.value !== 'string')) throw Error('선택 옵션의 상품고시 입력 연결을 확인하지 못했습니다.');
  return fields;
}

export function optionLabelValue(view: QuotationFieldsView, optionId: string, fieldId: string, draft: OptionLabelDraft = {}) {
  if (Object.hasOwn(draft, fieldId)) {
    const value = draft[fieldId];
    if (value !== null) return value;
    return view.overrides.common[fieldId] ?? view.automatic.rows.find(row => row.optionId === optionId)?.fields[fieldId]?.value ?? '';
  }
  return view.resolved.rows.find(row => row.optionId === optionId)?.fields[fieldId]?.value ?? '';
}

export function optionLabelChanges(view: QuotationFieldsView, optionId: string, draft: OptionLabelDraft): QuotationChange[] {
  const fields = verifyOptionLabelView(view, optionId);
  if (Object.keys(draft).some(id => !fields.some(field => field.id === id && !field.readOnly))) throw Error('편집할 수 있는 카테고리 상품고시 항목을 선택해주세요.');
  return validateQuotationChanges(Object.keys(draft).map(fieldKey => ({ fieldKey, optionId, value: draft[fieldKey] })),
    { schema: view.resolved.schema, optionIds: view.resolved.rows.flatMap(row => row.optionId ? [row.optionId] : []), ownedImageKeys: view.imageKeys, overrides: view.overrides });
}

export function optionLabelDraftIssues(view: QuotationFieldsView, optionId: string, draft: OptionLabelDraft) {
  return optionLabelFields(view).filter(field => Object.hasOwn(draft, field.id)).flatMap(field => {
    const value = optionLabelValue(view, optionId, field.id, draft);
    return value.trim() ? quotationValueIssues(field, value, view.imageKeys).map(issue => `${field.label}: ${issue}`) : [];
  });
}

/** A successful notice PUT advances only its quotation revision/product clock.
 * Compare all overrides, including other SKUs, so an unrelated write cannot be
 * accepted as the acknowledgement of this selected-option request. */
export function verifyOptionLabelSave(before: QuotationFieldsView, saved: QuotationFieldsView, optionId: string, draft: OptionLabelDraft) {
  verifyOptionLabelView(saved, optionId);
  const changes = optionLabelChanges(before, optionId, draft);
  if (saved.revision !== before.revision + 1 || saved.updatedAt !== saved.productVersion
    || Date.parse(saved.productVersion) <= Date.parse(before.productVersion)
    || saved.contentRevision !== before.contentRevision || saved.optionRevision !== before.optionRevision
    || !same(saved.imageKeys, before.imageKeys) || !same(saved.categoryContext, before.categoryContext)
    || !same(optionLabelFields(saved), optionLabelFields(before))
    || !same(saved.overrides, applyQuotationChanges(before.overrides, changes)))
    throw Error('상품고시 저장 버전 또는 선택 옵션 저장값을 확인하지 못했습니다. 입력을 유지하고 저장본을 다시 확인해주세요.');
  const row = saved.resolved.rows.find(row => row.optionId === optionId)!;
  if (changes.some(change => row.fields[change.fieldKey]?.value !== (change.value === null
    ? optionLabelValue(saved, optionId, change.fieldKey, { [change.fieldKey]: null }) : change.value)))
    throw Error('저장 응답의 선택 옵션 상품고시가 요청한 값과 다릅니다. 입력은 유지했습니다.');
}

export function verifyOptionLabelRefresh(before: QuotationFieldsView, latest: QuotationFieldsView, optionId: string, draft: OptionLabelDraft) {
  verifyOptionLabelView(latest, optionId);
  if (latest.revision < before.revision || Date.parse(latest.productVersion) < Date.parse(before.productVersion)
    || !same(latest.categoryContext, before.categoryContext)) throw Error('옵션 또는 카테고리가 변경되었습니다. 입력은 유지했습니다.');
  const oldFields = optionLabelFields(before), newFields = optionLabelFields(latest);
  for (const id of Object.keys(draft)) {
    if (!same(oldFields.find(field => field.id === id), newFields.find(field => field.id === id))) throw Error('수정 중인 상품고시 항목의 연결이 변경되었습니다. 입력은 유지했습니다.');
    const oldValue = before.overrides.options[optionId]?.[id] ?? null, current = latest.overrides.options[optionId]?.[id] ?? null;
    if (oldValue !== current && current !== draft[id]) throw Error('선택 옵션 상품고시에 다른 저장값이 있습니다. 입력을 보관한 뒤 저장본과 비교해주세요.');
  }
  if (Object.keys(draft).length) optionLabelChanges(latest, optionId, draft);
}

export function optionLabelPreviewSignature(productId: string, endpoint: string, view: QuotationFieldsView, optionId: string) {
  verifyOptionLabelView(view, optionId);
  return JSON.stringify({ productId, endpoint, category: view.categoryContext, optionId, plan: quotationLabelPlan(view.resolved, optionId) });
}

export function verifyOptionLabelAttachment(rendered: QuotationFieldsView, saved: QuotationFieldsView, optionId: string, key: string | null) {
  verifyOptionLabelView(saved, optionId);
  if (!key || !saved.imageKeys.includes(key) || !same(saved.categoryContext, rendered.categoryContext)
    || !same(quotationLabelPlan(saved.resolved, optionId), quotationLabelPlan(rendered.resolved, optionId)))
    throw Error('선택 옵션 라벨 연결과 상품고시 저장값을 확인하지 못했습니다. 저장본을 다시 조회해주세요.');
  // The existing attachment helper is idempotent when this exact reviewed PNG
  // is already inherited. Verify its saved source rather than manufacturing an
  // option override or rejecting a valid no-write recovery acknowledgement.
  const specific = saved.overrides.options[optionId] ?? {};
  const value = Object.hasOwn(specific, 'labelImages') ? specific.labelImages
    : Object.hasOwn(saved.overrides.common, 'labelImages') ? saved.overrides.common.labelImages
      : saved.automatic.rows.find(row => row.optionId === optionId)?.fields.labelImages?.value;
  if (typeof value !== 'string' || !value.split('\n').map(item => item.trim()).includes(key)
    || saved.resolved.rows.find(row => row.optionId === optionId)?.fields.labelImages?.value !== value)
    throw Error('저장 응답의 선택 옵션 라벨 연결을 확인하지 못했습니다. 저장본을 다시 조회해주세요.');
}
