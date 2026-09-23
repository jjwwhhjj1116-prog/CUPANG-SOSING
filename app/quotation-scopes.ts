import { emptyQuotationOverrides, type QuotationOverrides } from '@/app/quotation-schema';

export type ScopedQuotationValues = { overrides: QuotationOverrides; categoryOverrides?: Record<string, QuotationOverrides> };
export function quotationScope(categoryId: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(categoryId)) throw new Error('견적 카테고리 코드를 확인해주세요.');
  return `category:${categoryId}`;
}
export function scopedQuotationOverrides(state: ScopedQuotationValues, categoryId: string | null): QuotationOverrides {
  if (!categoryId) return state.overrides;
  const key = quotationScope(categoryId);
  return state.categoryOverrides && Object.hasOwn(state.categoryOverrides, key) ? state.categoryOverrides[key] : emptyQuotationOverrides();
}
export function hasLegacyQuotationOverrides(state: ScopedQuotationValues) {
  return Object.keys(state.overrides.common).length > 0 || Object.values(state.overrides.options).some(values => Object.keys(values).length > 0);
}
