import type { ProductContent } from '@/app/product-content';
import { getQuotationSchema, quotationValueIssues } from '@/app/quotation-schema';
import { readAttributeRules } from '@/app/quotation-attribute-rules';
import { translatedAttributeValue, quotationAttributeDisplay } from '@/app/quotation-translation-adoption';

/** Capture explicit category rules; never redirect a skipped rule by name matching. */
export function applyIntakeAttributeRules(snapshot: NonNullable<ProductContent['categoryAttributes']>, payload: string) {
  const schema = getQuotationSchema(snapshot.categoryId);
  const rules = readAttributeRules(payload, schema);
  const bindings: NonNullable<typeof snapshot.bindings> = [];
  const skipped: string[] = [];
  for (const rule of rules.rules) {
    const field = schema.fields.find(field => field.id === rule.fieldId)!;
    const matches = snapshot.values.filter(value => value.sourceName === rule.sourceName);
    if (matches.length !== 1 || field.section !== 'product' || field.visibility === 'common') {
      skipped.push(`${rule.sourceName}: 자동 작성 가능한 고유 상품 속성이 없어 기존값을 유지합니다.`); continue;
    }
    try {
      const value = translatedAttributeValue(field, matches[0].value);
      const issues = quotationValueIssues(field, value);
      if (issues.length) throw new Error(issues.join(' '));
      bindings.push({ fieldId: field.id, fieldSignature: rule.fieldSignature, value });
    }
    catch (error) { skipped.push(`${rule.sourceName}: ${error instanceof Error ? error.message : '견적 입력 규격과 맞지 않습니다.'} 기존값을 유지합니다.`); }
  }
  return { preview: bindings.map(binding => {
    const field = schema.fields.find(field => field.id === binding.fieldId)!;
    return { name: `저장된 카테고리 연결 · ${field.label}`, before: '', after: quotationAttributeDisplay(field, binding.value) };
  }),
    snapshot: { ...snapshot, values: snapshot.values.filter(value => !rules.rules.some(rule => rule.sourceName === value.sourceName)),
    bindings, reservedFields: rules.rules.map(rule => rule.fieldId) }, skipped };
}
