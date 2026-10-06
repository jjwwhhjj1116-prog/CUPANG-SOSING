import type { QuotationField } from '@/app/quotation-schema';

export const quotationPriceInputs = ['supplyPrice', 'salePrice', 'msrp'] as const;
export type QuotationPriceInput = typeof quotationPriceInputs[number];
export type QuotationPriceTarget = { primary: string; linked: string[] };
export type QuotationPriceTargets = Record<QuotationPriceInput, QuotationPriceTarget>;
const paths: Record<QuotationPriceInput, string[]> = {
  supplyPrice: ['productPage', 'commonAttributes', 'purchasePrice'],
  salePrice: ['productPage', 'commonAttributes', 'coupangSalePrice'],
  msrp: ['productPage', 'commonAttributes', 'msrp'],
};

/** Stage two edits the exact primary Hub price and its canonical summary in one
 * explicit change. OSRP remains separate when MSRP exists; only an observed
 * OSRP-only price binding can represent MSRP. Existing saved values are never
 * copied or removed merely by resolving the editing target. */
export function quotationPriceTargets(fields: readonly QuotationField[]): QuotationPriceTargets {
  return Object.fromEntries(quotationPriceInputs.map(input => {
    const common = fields.filter(field => field.id === input);
    let wires = fields.filter(field => !field.hubWire?.name
      && JSON.stringify(field.hubWire?.path) === JSON.stringify(paths[input]));
    if (input === 'msrp' && !wires.length) wires = fields.filter(field => !field.hubWire?.name
      && JSON.stringify(field.hubWire?.path) === JSON.stringify(['productPage', 'commonAttributes', 'osrp']));
    if (common.length !== 1 || wires.length > 1) throw Error('가격 항목의 연결을 하나로 확인하지 못했습니다. 7단계 견적서의 상세 항목을 확인해주세요.');
    const wire = wires[0];
    if (wire && (wire.hubInput !== input || !(wire.numericText || wire.type === 'number') || wire.readOnly))
      throw Error('Supplier Hub 가격 항목의 입력 규칙을 확인하지 못했습니다. 7단계 견적서에서 확인해주세요.');
    const primary = wire?.id ?? input;
    return [input, { primary, linked: [...new Set([input, primary])] }];
  })) as QuotationPriceTargets;
}
