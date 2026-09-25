export const QUOTATION_TAG_TOTAL_LIMIT = 150;
export const QUOTATION_TAG_ITEM_LIMIT = 20;
export function quotationKeywordPlan(input: string) {
  const original = input.split(/[\n,]/).map(value => value.trim()).filter(Boolean);
  const kept: string[] = [], omitted: { value: string; reason: string }[] = [];
  for (const value of original) {
    if (value.length > QUOTATION_TAG_ITEM_LIMIT) omitted.push({ value, reason: '태그별 20자 초과' });
    else if (kept.includes(value)) omitted.push({ value, reason: '중복 검색어' });
    else if ([...kept, value].join(', ').length > QUOTATION_TAG_TOTAL_LIMIT) omitted.push({ value, reason: '전체 150자 초과' });
    else kept.push(value);
  }
  return { original, kept, omitted, currentLength: original.join(', ').length, resultLength: kept.join(', ').length };
}
