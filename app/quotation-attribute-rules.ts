import type { TranslationJob } from '@/app/automation/translation';
import type { QuotationFieldsView, QuotationSchema } from '@/app/quotation-schema';
import { canMapTranslatedAttribute, quotationTranslationDraft, type AttributeMapping } from '@/app/quotation-translation-adoption';

type Rule = { sourceName: string; fieldId: string; fieldSignature: string };
export type QuotationAttributeRules = { format: 'sourceflow-attribute-rules-v1'; categoryId: string; rules: Rule[] };
export const ATTRIBUTE_RULE_LIMIT = 64 * 1024;
export function createAttributeRules(productId: string, view: QuotationFieldsView, job: TranslationJob, optionId: string | null, mappings: readonly AttributeMapping[]): QuotationAttributeRules {
  quotationTranslationDraft(productId, view, job, optionId, mappings);
  const rules = mappings.map(mapping => ({ sourceName: job.review.source.attributes[mapping.sourceIndex].name,
    fieldId: mapping.fieldId, fieldSignature: JSON.stringify(view.resolved.schema.fields.find(field => field.id === mapping.fieldId)) }));
  if (new Set(rules.map(rule => rule.sourceName)).size !== rules.length) throw new Error('동일한 원문 속성명이 있어 재사용 규칙으로 저장할 수 없습니다.');
  const output: QuotationAttributeRules = { format: 'sourceflow-attribute-rules-v1', categoryId: view.resolved.schema.categoryId!, rules };
  if (new TextEncoder().encode(JSON.stringify(output, null, 2)).length > ATTRIBUTE_RULE_LIMIT) throw new Error('연결 규칙은 64KB 이하여야 합니다.');
  return output;
}
export function readAttributeRules(input: string, schema: QuotationSchema): QuotationAttributeRules {
  if (new TextEncoder().encode(input).length > ATTRIBUTE_RULE_LIMIT) throw new Error('연결 규칙은 64KB 이하여야 합니다.');
  const value = JSON.parse(input) as QuotationAttributeRules;
  if (!value || value.format !== 'sourceflow-attribute-rules-v1' || value.categoryId !== schema.categoryId || !Array.isArray(value.rules) || !value.rules.length || value.rules.length > 50) throw new Error('현재 카테고리와 일치하는 연결 규칙 파일이 필요합니다.');
  const sources = new Set<string>(), fields = new Set<string>();
  // Validate the entire file before selecting anything. A schema change requires a new review.
  for (const rule of value.rules) {
    if (!rule || typeof rule.sourceName !== 'string' || !rule.sourceName.startsWith('상품속성: ') || rule.sourceName.length > 200 || typeof rule.fieldId !== 'string' || typeof rule.fieldSignature !== 'string' || sources.has(rule.sourceName) || fields.has(rule.fieldId)) throw new Error('연결 규칙의 속성명·항목·중복을 확인해주세요.');
    const field = schema.fields.find(item => item.id === rule.fieldId);
    if (!field || !canMapTranslatedAttribute(field) || JSON.stringify(field) !== rule.fieldSignature) throw new Error('견적 양식이 변경되었습니다. 연결 항목을 다시 검토하고 규칙을 저장해주세요.');
    sources.add(rule.sourceName); fields.add(rule.fieldId);
  }
  return {format: value.format, categoryId: value.categoryId, rules: value.rules.map(rule => ({sourceName: rule.sourceName, fieldId: rule.fieldId, fieldSignature: rule.fieldSignature}))};
}
export function loadAttributeRules(input: string, productId: string, view: QuotationFieldsView, job: TranslationJob, optionId: string | null) {
  const value = readAttributeRules(input, view.resolved.schema);
  const mappings: AttributeMapping[] = []; const skipped: string[] = [];
  for (const rule of value.rules) {
    const matches = job.review.source.attributes.flatMap((attribute, index) => attribute.name === rule.sourceName ? [index] : []);
    if (matches.length !== 1) { skipped.push(`${rule.sourceName}: ${matches.length ? '동일 이름이 여러 개여서' : '현재 원문에 없어서'} 제외했습니다.`); continue; }
    const mapping = { sourceIndex: matches[0], fieldId: rule.fieldId };
    try { quotationTranslationDraft(productId, view, job, optionId, [mapping]); mappings.push(mapping); }
    catch (cause) { skipped.push(`${rule.sourceName}: ${cause instanceof Error ? cause.message : '연결 불가'}`); }
  }
  return { mappings, skipped };
}
