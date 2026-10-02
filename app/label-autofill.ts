import { couplusLabelDefaults } from '@/app/couplus-quotation-defaults';
import { savedTextOrFallback, type LabelField, type ProductContent } from '@/app/product-content';
import { previousRegistrationMonth, washingPrecautionsText } from '@/app/couplus-registration-defaults';
import { getQuotationSchema } from '@/app/quotation-schema';

/** Fill untouched review drafts from saved inputs and category-scoped observed defaults. */
export function fillLabelDraft(draft: Record<LabelField, string>, content: ProductContent, productTitle: string, settings: unknown, categoryId: string | null = null, clearedFields: readonly LabelField[] = [], referenceTime?: string) {
  const stored = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings as Record<string, unknown> : {};
  const candidates: Partial<Record<LabelField, unknown>> = {
    ...couplusLabelDefaults(categoryId),
    productName: savedTextOrFallback(content.seo.title, productTitle).trim(),
    manufacturer: stored.manufacturer, importer: stored.importer, contact: stored.serviceContact,
    washingPrecautions: washingPrecautionsText(stored),
    ...(stored.manufactureDatePreviousMonth === true && getQuotationSchema(categoryId).fields.some(field => field.section === 'legal' && ['출시년월', '제조년월'].includes(field.label))
      ? { releaseDate: previousRegistrationMonth(referenceTime) } : {}),
  };
  const label = { ...draft };
  const filled: LabelField[] = [];
  for (const [key, value] of Object.entries(candidates) as [LabelField, unknown][]) {
    if (clearedFields.includes(key)) continue;
    if (label[key]?.trim() || label[key] !== content.label[key]?.value || content.label[key]?.provenance === 'manual') continue;
    if (typeof value !== 'string' || !value.trim() || value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) continue;
    label[key] = value.trim(); filled.push(key);
  }
  return { label, filled, referenceFields: filled.filter(key => Object.hasOwn(couplusLabelDefaults(categoryId), key)) };
}
