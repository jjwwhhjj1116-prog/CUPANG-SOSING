import { applyQuotationChanges, quotationPriceIssues, quotationValueIssues, validateQuotationChanges, type QuotationChange, type QuotationFieldsView } from '@/app/quotation-schema';
import { quotationPriceInputs, quotationPriceTargets } from '@/app/quotation-price-targets';

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const sources = new Set(['manual-option', 'manual-common', 'schema', 'content', 'settings', 'option', 'pricing', 'product', 'empty', 'couplus-default']);
const labels = { supplyPrice: '공급가', salePrice: '판매가', msrp: '권장소비자가' };
const changed = () => Error('가격 저장 버전과 상품·카테고리 원천을 확인하지 못했습니다. 입력은 유지했습니다.');
function specific(view: QuotationFieldsView, optionId: string | null) { return optionId !== null && Object.hasOwn(view.overrides.options, optionId) ? view.overrides.options[optionId] : undefined; }
function manual(view: QuotationFieldsView, optionId: string | null, fieldId: string) {
  const values = optionId === null ? view.overrides.common : specific(view, optionId);
  return values && Object.hasOwn(values, fieldId) ? values[fieldId] : null;
}

/** A bound endpoint plus the component's current source guard selects the
 * product. Its returned clocks/category/row identities and exact price wires
 * must be coherent before any saved data replaces a draft. */
export function verifyOptionPriceView(view: QuotationFieldsView, profileId?: string) {
  const category = view?.categoryContext;
  if (!view || !Number.isSafeInteger(view.revision) || view.revision < 0 || !/^[a-f0-9]{64}$/.test(view.inputFingerprint)
    || !Number.isFinite(Date.parse(view.productVersion)) || ![view.contentRevision, view.optionRevision].every(value => Number.isSafeInteger(value) && value >= 0)
    || view.updatedAt !== null && !Number.isFinite(Date.parse(view.updatedAt))
    || !Array.isArray(view.imageKeys) || view.imageKeys.length > 50 || new Set(view.imageKeys).size !== view.imageKeys.length
    || view.imageKeys.some(key => typeof key !== 'string' || !key || key.length > 512 || /[\u0000-\u001f\u007f]/u.test(key))
    || !category || !['profile', 'collection', 'unknown'].includes(category.source)
    || category.categoryId !== null && !/^\d{1,20}$/.test(category.categoryId)
    || category.profileId !== null && (typeof category.profileId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(category.profileId))
    || profileId && category.profileId !== profileId || !Array.isArray(category.categoryPath) || category.categoryPath.length > 20
    || category.categoryId !== null && !category.categoryPath.length || category.categoryPath.some(part => typeof part !== 'string' || !part.trim())
    || !record(view.overrides?.common) || !record(view.overrides?.options) || !Array.isArray(view.resolved?.schema?.fields)
    || view.resolved.schema.fields.some(field => !field || typeof field.id !== 'string' || !field.id)
    || view.resolved.schema.categoryId !== category.categoryId || !same(view.resolved.schema.categoryPath, category.categoryPath)
    || !Array.isArray(view.resolved.rows) || !view.resolved.rows.length || view.resolved.rows.length > 201
    || !Array.isArray(view.automatic?.rows) || view.automatic.rows.length !== view.resolved.rows.length
    || new Set(view.resolved.schema.fields.map(field => field.id)).size !== view.resolved.schema.fields.length
    || new Set(view.resolved.rows.map(row => row.optionId)).size !== view.resolved.rows.length
    || new Set(view.automatic.rows.map(row => row.optionId)).size !== view.automatic.rows.length) throw changed();
  if (Object.values(view.overrides.common).some(value => typeof value !== 'string')
    || Object.values(view.overrides.options).some(values => !record(values) || Object.values(values).some(value => typeof value !== 'string'))) throw changed();
  const targets = quotationPriceTargets(view.resolved.schema.fields), ids = [...new Set(quotationPriceInputs.flatMap(input => targets[input].linked))];
  if (view.resolved.schema.fields.filter(field => ids.includes(field.id)).some(field => field.readOnly || field.type !== 'number' && !field.numericText)) throw changed();
  for (const row of view.resolved.rows) {
    const automatic = view.automatic.rows.find(item => item.optionId === row.optionId);
    if (row.optionId !== null && (typeof row.optionId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(row.optionId))
      || typeof row.optionLabel !== 'string' || typeof row.included !== 'boolean' || !record(row.fields) || !automatic || !record(automatic.fields)) throw changed();
    for (const id of ids) {
      const cell = row.fields[id], fallback = automatic.fields[id];
      if (!cell || typeof cell.value !== 'string' || !sources.has(cell.source) || !fallback || typeof fallback.value !== 'string' || !sources.has(fallback.source) || fallback.source.startsWith('manual-')
        || [cell.validationIssues, cell.issues, fallback.validationIssues, fallback.issues].some(value => value !== undefined && (!Array.isArray(value) || value.some(item => typeof item !== 'string')))) throw changed();
      const own = specific(view, row.optionId), isOwn = !!own && Object.hasOwn(own, id), isCommon = Object.hasOwn(view.overrides.common, id);
      const expected = isOwn ? own![id] : isCommon ? view.overrides.common[id] : fallback.value;
      const source = isOwn ? 'manual-option' : isCommon ? 'manual-common' : fallback.source;
      if (cell.value !== expected || cell.source !== source) throw Error('저장된 옵션 가격의 직접 수정값·공통값·자동값 연결을 확인하지 못했습니다. 입력은 유지했습니다.');
    }
  }
  return targets;
}

export function optionPriceValue(view: QuotationFieldsView, optionId: string | null, fieldId: string, edits: readonly QuotationChange[]) {
  const edit = edits.find(change => change.optionId === optionId && change.fieldKey === fieldId);
  if (edit) {
    if (edit.value !== null) return edit.value;
    return (optionId !== null ? manual(view, null, fieldId) : null) ?? view.automatic.rows.find(row => row.optionId === optionId)?.fields[fieldId]?.value ?? '';
  }
  return view.resolved.rows.find(row => row.optionId === optionId)?.fields[fieldId]?.value ?? '';
}
function sourceIssues(view: QuotationFieldsView, optionId: string | null, fieldId: string, edits: readonly QuotationChange[]) {
  const currentManual = (id: string | null) => { const edit = edits.find(change => change.optionId === id && change.fieldKey === fieldId); return edit ? edit.value : manual(view, id, fieldId); };
  const reviewed = (optionId === null ? null : currentManual(optionId)) ?? currentManual(null);
  const automatic = view.automatic.rows.find(row => row.optionId === optionId)?.fields[fieldId] ?? view.resolved.rows.find(row => row.optionId === optionId)?.fields[fieldId];
  return reviewed !== null ? [] : (automatic?.validationIssues ?? automatic?.issues ?? []).filter(issue => issue !== '판매가는 공급가보다 작을 수 없습니다.');
}
export function optionPriceDraftIssues(view: QuotationFieldsView, edits: readonly QuotationChange[]) {
  const targets = quotationPriceTargets(view.resolved.schema.fields);
  return view.resolved.rows.filter(row => row.included).flatMap(row => [
    ...quotationPriceInputs.flatMap(input => targets[input].linked.flatMap(id => {
      const field = view.resolved.schema.fields.find(field => field.id === id)!;
      return [...new Set([...sourceIssues(view, row.optionId, id, edits), ...quotationValueIssues(field, optionPriceValue(view, row.optionId, id, edits), view.imageKeys)])]
        .map(issue => `${row.optionLabel || '상품 공통'} · ${labels[input]}: ${issue}`);
    })),
    ...quotationPriceIssues(view.resolved.schema, optionPriceValue(view, row.optionId, targets.supplyPrice.primary, edits), optionPriceValue(view, row.optionId, targets.salePrice.primary, edits))
      .map(issue => `${row.optionLabel || '상품 공통'} · 판매가: ${issue}`),
  ]);
}
export function optionPriceChanges(view: QuotationFieldsView, edits: readonly QuotationChange[]) {
  const targets = verifyOptionPriceView(view), ids = new Set(quotationPriceInputs.flatMap(input => targets[input].linked));
  if (edits.some(edit => !ids.has(edit.fieldKey) || !view.resolved.rows.some(row => row.optionId === edit.optionId && row.included))) throw Error('견적에 포함된 옵션과 연결된 가격 항목을 선택해주세요.');
  const changes = validateQuotationChanges(edits, { schema: view.resolved.schema, optionIds: view.resolved.rows.flatMap(row => row.optionId ? [row.optionId] : []), ownedImageKeys: view.imageKeys, overrides: view.overrides });
  const issues = optionPriceDraftIssues(view, changes); if (issues.length) throw Error([...new Set(issues)].join(' '));
  return changes;
}
export function verifyOptionPriceRefresh(before: QuotationFieldsView, latest: QuotationFieldsView, edits: readonly QuotationChange[]) {
  verifyOptionPriceView(before); verifyOptionPriceView(latest);
  if (latest.revision < before.revision || Date.parse(latest.productVersion) < Date.parse(before.productVersion)
    || latest.contentRevision < before.contentRevision || latest.optionRevision < before.optionRevision || !same(before.categoryContext, latest.categoryContext)) throw changed();
  for (const edit of edits) {
    const oldRow = before.resolved.rows.find(row => row.optionId === edit.optionId), newRow = latest.resolved.rows.find(row => row.optionId === edit.optionId);
    const oldField = before.resolved.schema.fields.find(field => field.id === edit.fieldKey), newField = latest.resolved.schema.fields.find(field => field.id === edit.fieldKey);
    if (!oldRow?.included || !newRow?.included || !same(oldField, newField)) throw Error('수정 중인 옵션 또는 가격 항목이 변경되었습니다. 입력은 유지했습니다.');
    const oldValue = manual(before, edit.optionId, edit.fieldKey), currentValue = manual(latest, edit.optionId, edit.fieldKey);
    if (oldValue !== currentValue && currentValue !== edit.value) throw Error('수정 중인 가격에 다른 저장값이 있습니다. 입력을 보관한 뒤 저장 가격과 비교해주세요.');
  }
  if (edits.length) optionPriceChanges(latest, edits);
}

/** Only the complete expected price write can acknowledge this save. Reset
 * values and sources are checked against the same response's latest fallback. */
export function verifyOptionPriceSave(before: QuotationFieldsView, saved: QuotationFieldsView, edits: readonly QuotationChange[]) {
  verifyOptionPriceView(before); verifyOptionPriceView(saved); const changes = optionPriceChanges(before, edits);
  if (saved.revision !== before.revision + 1 || saved.updatedAt !== saved.productVersion || Date.parse(saved.productVersion) <= Date.parse(before.productVersion)
    || saved.inputFingerprint === before.inputFingerprint || saved.contentRevision !== before.contentRevision || saved.optionRevision !== before.optionRevision
    || !same(saved.categoryContext, before.categoryContext) || !same(saved.imageKeys, before.imageKeys) || !same(saved.resolved.schema, before.resolved.schema)
    || !same(saved.automatic.rows, before.automatic.rows)
    || !same(saved.resolved.rows.map(row => [row.optionId, row.optionLabel, row.included]), before.resolved.rows.map(row => [row.optionId, row.optionLabel, row.included]))
    || !same(saved.overrides, applyQuotationChanges(before.overrides, changes))) throw changed();
  const priceIds = new Set(quotationPriceInputs.flatMap(input => quotationPriceTargets(before.resolved.schema.fields)[input].linked));
  for (const previous of before.resolved.rows) {
    const row = saved.resolved.rows.find(row => row.optionId === previous.optionId)!;
    for (const field of before.resolved.schema.fields) if (!priceIds.has(field.id)
      && (previous.fields[field.id]?.value !== row.fields[field.id]?.value || previous.fields[field.id]?.source !== row.fields[field.id]?.source)) throw changed();
  }
  if (changes.some(change => {
    const row = saved.resolved.rows.find(row => row.optionId === change.optionId)!;
    return row.fields[change.fieldKey]?.value !== (change.value === null ? optionPriceValue(saved, change.optionId, change.fieldKey, [change]) : change.value);
  })) throw Error('저장 응답의 옵션 가격이 요청한 값과 다릅니다. 입력은 유지했습니다.');
}
