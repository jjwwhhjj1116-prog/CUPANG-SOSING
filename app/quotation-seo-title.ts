import type { QuotationChange, QuotationField } from '@/app/quotation-schema';

/** QuotationEdit's primary product name is edited in SEO. Other controls may
 * have the same label, so only these established source identities qualify. */
export function isQuotationSeoTitleField(field: QuotationField): boolean {
  return field.id === 'title' || field.hubInput === 'title' && !field.hubWire?.name
    && JSON.stringify(field.hubWire?.path) === JSON.stringify(['startPage', 'productName']);
}

/** Keep the quotation UI read-only while allowing an explicit historical
 * override reset. The backend/manual title APIs deliberately stay compatible. */
export function assertQuotationSeoTitleDraft(fields: readonly QuotationField[], changes: readonly QuotationChange[]): void {
  if (changes.some(change => change.value !== null && fields.some(field => field.id === change.fieldKey && isQuotationSeoTitleField(field))))
    throw new Error('상품명은 SEO 설정에서 수정해주세요.');
}
