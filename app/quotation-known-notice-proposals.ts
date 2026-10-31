import type { ContentField, ProductContent } from '@/app/product-content';
import { quotationValueIssues, type QuotationChange, type QuotationField, type QuotationFieldsView } from '@/app/quotation-schema';
import { isCouplusNotApplicableValue } from '@/app/couplus-quotation-defaults';
import type { ProductOptions } from '@/app/product-options';
import { productLabelFields, validateProductLabelOverrides, validateProductLabelStructure, type ProductLabelsState, type ProductLabelKey } from '@/app/product-label';

type Scope = { optionId: string | null; applyToAllOptions: boolean };
type View = Pick<QuotationFieldsView, 'contentRevision' | 'optionRevision' | 'categoryContext' | 'overrides' | 'resolved'>;
export type QuotationSavedNoticeChange = QuotationChange & {
  /** A saved stage-six edit may supersede this exact untouched content value.
   * This is source-copy authority, never an AI permission or a save command. */
  savedLabel?: { revision: number; previousValue: string };
};
const invalid = () => Error('저장된 표시사항과 현재 견적서의 상품·카테고리·옵션 범위를 다시 확인해주세요.');
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/u.test(value);
function knownText(field: ContentField<string> | undefined): string | undefined {
  // Intake freezes owner settings as manual content. A later workspace setting
  // or an AI/generated label is not authority for this explicit source copy.
  if (!field || !['manual', 'collected'].includes(field.provenance) || typeof field.value !== 'string'
    || !field.value.trim() || field.value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(field.value)
    || isCouplusNotApplicableValue(field.value)) return;
  return field.value;
}
type Target = 'manufacturer' | 'contact' | 'countryOfOrigin' | 'material' | 'components' | 'dimensions' | 'precautions' | 'specifications' | 'color' | 'quantity';
export function quotationSavedQuantityText(value: string, count: number): boolean {
  const parsed = /^([1-9]\d*)\s*(?:쌍|개|세트|박스|팩|매|장)$/u.exec(value.trim());
  return Boolean(parsed && Number.isSafeInteger(count) && count > 0 && Number(parsed[1]) === count);
}
function savedQuantity(value: string | undefined, count: number): string | undefined {
  if (!value) return;
  // A single optional product-name prefix and one final unit expression are
  // accepted. Lists, dimensions, multiple counts and numeric product names are
  // ambiguous; nothing is inferred from the cost quantity itself.
  const match = /^(?:[가-힣A-Za-z\s·-]{1,80}?)?([1-9]\d*)\s*(쌍|개|세트|박스|팩|매|장)$/u.exec(value.trim());
  const quantity = match && `${match[1]}${match[2]}`;
  return quantity && quotationSavedQuantityText(quantity, count) ? quantity : undefined;
}
export function quotationKnownNoticeTarget(field: QuotationField, extended = false): Target | undefined {
  const wire = field.hubWire;
  if (extended && !field.readOnly && !field.hubInput && field.section === 'product' && field.visibility === 'exposed'
    && field.type === 'text' && !field.numericValue && !field.numericText && wire?.path.join('.') === 'productPage.commonAttributes.exposedAttributes'
    && wire.name === '수량' && field.label === wire.name && wire.nameKey === 'attributeName' && wire.valueKey === 'attributeValue') return 'quantity';
  if (field.section !== 'legal' || field.visibility !== 'common' || field.readOnly || field.hubInput
    || !['text', 'textarea', 'select'].includes(field.type) || !wire || wire.path.length !== 2
    || wire.path[0] !== 'legalPage' || wire.path[1] !== 'notices' || wire.name !== field.label
    || wire.nameKey !== 'noticeItemName' || !['noticeItemValue', 'noticeContent'].includes(wire.valueKey ?? '')) return;
  if (wire.name === '제조자(수입자)') return 'manufacturer';
  if (wire.name === '소비자상담 관련 전화번호' || wire.name === 'A/S 책임자와 전화번호') return 'contact';
  const savedBindings: Readonly<Record<string, Target>> = { '제조국(원산지)': 'countryOfOrigin', '제조국': 'countryOfOrigin', '소재': 'material', '재질': 'material',
    '제품 구성': 'components', '구성품': 'components', '치수': 'dimensions', '크기': 'dimensions',
    '취급시 주의사항': 'precautions', '상품별 세부 사양': 'specifications', '색상': 'color' };
  if (extended && Object.hasOwn(savedBindings, wire.name)) return savedBindings[wire.name];
}

/** Explicit quotation work may copy known saved label sources into untouched
 * initial placeholders, or a saved label edit over its exact earlier content
 * source. The editor may also supply revision-matched options to copy verified
 * label/option facts. No read-time defaults, AI
 * permissions or saved manual quotation layers (including blanks) are changed. */
export function quotationKnownNoticeProposals(productId: string, view: View, content: ProductContent, scope: Scope, savedOptions?: ProductOptions, savedLabels?: ProductLabelsState): QuotationSavedNoticeChange[] {
  const schema = view?.resolved?.schema, rows = view?.resolved?.rows;
  if (!safeId(productId) || content?.productId !== productId || content.schemaVersion !== 1
    || !Number.isSafeInteger(content.revision) || content.revision < 0 || content.revision !== view?.contentRevision
    || !content.label || !schema || !Array.isArray(schema.fields) || !Array.isArray(rows)
    || !view.overrides?.common || !view.overrides.options || !scope || typeof scope.applyToAllOptions !== 'boolean'
    || scope.optionId !== null && !safeId(scope.optionId)) throw invalid();
  if (schema.status !== 'observed' || !schema.categoryId || schema.categoryId !== view.categoryContext?.categoryId
    || JSON.stringify(schema.categoryPath) !== JSON.stringify(view.categoryContext.categoryPath)) throw invalid();
  if (new Set(schema.fields.map(field => field.id)).size !== schema.fields.length
    || rows.some(row => typeof row.included !== 'boolean' || row.optionId !== null && !safeId(row.optionId))
    || new Set(rows.map(row => row.optionId)).size !== rows.length) throw invalid();
  if (savedOptions && (savedOptions.productId !== productId || savedOptions.schemaVersion !== 1 || savedOptions.revision !== view.optionRevision
    || !Array.isArray(savedOptions.rows) || new Set(savedOptions.rows.map(row => row.id)).size !== savedOptions.rows.length
    || savedOptions.rows.some(row => !safeId(row.id) || typeof row.included !== 'boolean'
      || !rows.some(target => target.optionId === row.id && target.included === row.included)))) throw invalid();
  if (savedLabels && (!savedOptions || savedLabels.productId !== productId || savedLabels.schemaVersion !== 1
    || !Number.isSafeInteger(savedLabels.revision) || savedLabels.revision < 0)) throw invalid();
  const labelOverrides = savedLabels && validateProductLabelOverrides(savedLabels.overrides);
  const labelKeys = new Set(productLabelFields.map(field => field.key));
  const activeLabels = savedLabels?.structure && new Set(validateProductLabelStructure(savedLabels.structure).map(field => field.id));
  function explicitLabel(key: keyof ProductContent['label'], optionId: string | null) {
    if (!labelOverrides || !labelKeys.has(key as typeof productLabelFields[number]['key']) || activeLabels && !activeLabels.has(key as ProductLabelKey)) return false;
    return optionId !== null && Object.hasOwn(labelOverrides.options[optionId] ?? {}, key) || Object.hasOwn(labelOverrides.common, key);
  }
  function labelValue(key: keyof ProductContent['label'], optionId: string | null) {
    if (labelOverrides && labelKeys.has(key as typeof productLabelFields[number]['key'])) {
      if (activeLabels && !activeLabels.has(key as ProductLabelKey)) return;
      const specific = optionId !== null && labelOverrides.options[optionId];
      const layer = specific && Object.hasOwn(specific, key) ? specific : Object.hasOwn(labelOverrides.common, key) ? labelOverrides.common : null;
      // Explicit blanks/N/A suppress the lower content fallback too.
      if (layer) return knownText({ value: layer[key as ProductLabelKey]!, provenance: 'manual', updatedAt: savedLabels!.updatedAt });
    }
    return knownText(content.label[key]);
  }
  const included = rows.filter(row => row.included);
  const selected = scope.applyToAllOptions ? included : included.filter(row => row.optionId === scope.optionId);
  if (!selected.length || !scope.applyToAllOptions && selected.length !== 1
    || scope.applyToAllOptions && scope.optionId !== null && !selected.some(row => row.optionId === scope.optionId)) throw invalid();
  const fields = schema.fields.filter(field => quotationKnownNoticeTarget(field, Boolean(savedOptions)));
  if (new Set(fields.map(field => field.label)).size !== fields.length) throw invalid();
  const changes: QuotationSavedNoticeChange[] = [];
  for (const row of selected) for (const field of fields) {
    const source = quotationKnownNoticeTarget(field, Boolean(savedOptions))!, option = savedOptions?.rows.find(item => item.id === row.optionId);
    const manufacturer = labelValue('manufacturer', row.optionId), importer = labelValue('importer', row.optionId);
    const values: Partial<Record<Target, string | undefined>> = {
      manufacturer: [manufacturer && `제조자: ${manufacturer}`, importer && `수입자: ${importer}`].filter(Boolean).join(' / '),
      contact: labelValue('contact', row.optionId),
    };
    if (savedOptions) for (const key of ['countryOfOrigin', 'material', 'components', 'dimensions', 'precautions', 'specifications'] as const) values[key] = labelValue(key, row.optionId);
    // A cost-model quantity has no physical unit. Preserve a saved "1쌍"
    // composition verbatim; never turn unitsPerPack=1 into "1개".
    const explicitNet = labelOverrides && (row.optionId !== null && Object.hasOwn(labelOverrides.options[row.optionId] ?? {}, 'netContents') || Object.hasOwn(labelOverrides.common, 'netContents'));
    const netContents = labelValue('netContents', row.optionId);
    const quantityComposition = explicitNet ? netContents : netContents ?? values.components;
    // Contents count and component list have different meanings. A saved list
    // (or explicitly blank/N/A list) must never be replaced by "1세트". Only a
    // missing/unverified list may use one unambiguous saved unit expression.
    const componentsLocked = ['manual', 'collected'].includes(content.label.components?.provenance ?? '');
    if (savedLabels && !values.components && !componentsLocked && option && netContents && savedQuantity(netContents, option.unitsPerPack)) values.components = netContents;
    const value = source === 'color' ? option && knownText({ value: option.color ?? '', provenance: option.provenance.color, updatedAt: option.updatedAt })
      : source === 'quantity' ? option && ['manual', 'collected'].includes(option.provenance.unitsPerPack)
        ? savedQuantity(quantityComposition, option.unitsPerPack) : undefined : values[source];
    const cell = row.fields[field.id];
    const optionOverrides = row.optionId === null ? undefined : view.overrides.options[row.optionId];
    // Legacy quotations can still resolve an old content value instead of an
    // initial N/A notice. Only an explicit active stage-six override can replace
    // that value, and only while it exactly matches the independently saved
    // content source. An unverified/generated fallback grants no authority.
    const labelSources = source === 'manufacturer' ? ['manufacturer', 'importer'] as const
      : source === 'quantity' || source === 'color' ? [] : [source];
    const baseline = source === 'manufacturer'
      ? [knownText(content.label.manufacturer) && `제조자: ${knownText(content.label.manufacturer)}`, knownText(content.label.importer) && `수입자: ${knownText(content.label.importer)}`].filter(Boolean).join(' / ')
      : source === 'quantity' || source === 'color' ? undefined : knownText(content.label[source]);
    const savedLabel = savedLabels && savedLabels.revision > 0 && cell?.source === 'content' && value !== cell.value
      && baseline !== undefined && baseline !== '' && cell.value === baseline
      && labelSources.some(key => explicitLabel(key, row.optionId) && labelValue(key, row.optionId) !== knownText(content.label[key]))
      ? { revision: savedLabels.revision, previousValue: baseline } : undefined;
    const replaceable = cell && (source === 'quantity' ? cell.source === 'option' && cell.value === String(option?.unitsPerPack)
      : cell.source === 'couplus-default' && isCouplusNotApplicableValue(cell.value) || Boolean(savedLabel));
    if (!value || !replaceable
      || Object.hasOwn(view.overrides.common, field.id) || optionOverrides && Object.hasOwn(optionOverrides, field.id)
      || quotationValueIssues(field, value).length) continue;
    changes.push({ optionId: row.optionId, fieldKey: field.id, value, ...(savedLabel ? { savedLabel } : {}) });
  }
  return changes;
}
