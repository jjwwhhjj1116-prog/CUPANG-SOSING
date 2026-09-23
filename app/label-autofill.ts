import type { LabelField, ProductContent } from '@/app/product-content';

/** Only explicit saved settings may fill untouched fields; never use demo defaults. */
export function fillLabelDraft(draft: Record<LabelField, string>, content: ProductContent, productTitle: string, settings: unknown) {
  const stored = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings as Record<string, unknown> : {};
  const candidates: Partial<Record<LabelField, unknown>> = {
    productName: content.seo.title.value.trim() || productTitle,
    manufacturer: stored.manufacturer, importer: stored.importer, contact: stored.serviceContact,
  };
  const label = { ...draft };
  const filled: LabelField[] = [];
  for (const [key, value] of Object.entries(candidates) as [LabelField, unknown][]) {
    if (label[key].trim() || label[key] !== content.label[key].value || content.label[key].provenance === 'manual') continue;
    if (typeof value !== 'string' || !value.trim() || value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) continue;
    label[key] = value.trim(); filled.push(key);
  }
  return { label, filled };
}
