import type { ContentField, ProductContent } from '@/app/product-content';
import { quotationValueIssues, type QuotationChange, type QuotationField, type QuotationFieldsView } from '@/app/quotation-schema';
import { isCouplusNotApplicableValue } from '@/app/couplus-quotation-defaults';

type Scope = { optionId: string | null; applyToAllOptions: boolean };
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
function target(field: QuotationField): 'manufacturer' | 'contact' | undefined {
  const wire = field.hubWire;
  if (field.section !== 'legal' || field.visibility !== 'common' || field.readOnly || field.hubInput
    || !['text', 'textarea', 'select'].includes(field.type) || !wire || wire.path.length !== 2
    || wire.path[0] !== 'legalPage' || wire.path[1] !== 'notices' || wire.name !== field.label
    || wire.nameKey !== 'noticeItemName' || !['noticeItemValue', 'noticeContent'].includes(wire.valueKey ?? '')) return;
  if (wire.name === '제조자(수입자)') return 'manufacturer';
  if (wire.name === '소비자상담 관련 전화번호' || wire.name === 'A/S 책임자와 전화번호') return 'contact';
}

/** Explicit quotation work may copy known saved label sources into untouched
 * initial placeholders. This never changes read-time defaults, country claims,
 * AI permissions or saved manual quotation layers (including deliberate blanks). */
export function quotationKnownNoticeProposals(productId: string, view: QuotationFieldsView, content: ProductContent, scope: Scope): QuotationChange[] {
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
  const included = rows.filter(row => row.included);
  const selected = scope.applyToAllOptions ? included : included.filter(row => row.optionId === scope.optionId);
  if (!selected.length || !scope.applyToAllOptions && selected.length !== 1
    || scope.applyToAllOptions && scope.optionId !== null && !selected.some(row => row.optionId === scope.optionId)) throw invalid();
  const manufacturer = knownText(content.label.manufacturer), importer = knownText(content.label.importer);
  const values = {
    manufacturer: [manufacturer && `제조자: ${manufacturer}`, importer && `수입자: ${importer}`].filter(Boolean).join(' / '),
    contact: knownText(content.label.contact),
  };
  const fields = schema.fields.filter(field => target(field));
  if (new Set(fields.map(field => field.label)).size !== fields.length) throw invalid();
  const changes: QuotationChange[] = [];
  for (const row of selected) for (const field of fields) {
    const cell = row.fields[field.id], value = values[target(field)!];
    const optionOverrides = row.optionId === null ? undefined : view.overrides.options[row.optionId];
    if (!value || !cell || cell.source !== 'couplus-default' || !isCouplusNotApplicableValue(cell.value)
      || Object.hasOwn(view.overrides.common, field.id) || optionOverrides && Object.hasOwn(optionOverrides, field.id)
      || quotationValueIssues(field, value).length) continue;
    changes.push({ optionId: row.optionId, fieldKey: field.id, value });
  }
  return changes;
}
