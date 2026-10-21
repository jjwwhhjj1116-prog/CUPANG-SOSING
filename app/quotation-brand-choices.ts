import type { QuotationField } from '@/app/quotation-schema';

/** The active product's registration settings supply suggestions only.
 * Original schema choices and retained manual values remain authoritative. */
export function registrationBrandChoices(value: unknown): string[] {
  return typeof value === 'string' && value.length <= 500 ? value.split(',').map(brand => brand.trim()).filter(Boolean) : [];
}
export function usesRegistrationBrandChoices(field: QuotationField, unsupportedFields: readonly string[] = []): boolean {
  const path = (field.hubWire?.path ?? ['productPage', 'brand']).join(' / ');
  if (unsupportedFields.some(issue => issue === path || issue.startsWith(path + ' / ') || path.startsWith(issue + ' / '))) return false;
  return !field.readOnly && field.type === 'text' && !field.choices?.length
    && (field.hubInput === 'brand' || field.id === 'brand');
}
