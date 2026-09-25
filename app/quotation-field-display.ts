import type { QuotationField, ResolvedQuotationField } from '@/app/quotation-schema';

/** Empty is a real Supplier Hub choice only when a value has actually been supplied. */
export function quotationFieldDisplay(field: QuotationField, cell: Pick<ResolvedQuotationField, 'value' | 'source'>, blank = '[공란]') {
  if (cell.value === '' && cell.source === 'empty') return blank;
  return field.choices?.find(choice => choice.value === cell.value)?.label ?? (cell.value.trim() ? cell.value : blank);
}
