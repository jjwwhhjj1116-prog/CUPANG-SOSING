/** A product-level default option has no observed remote supplier SKU. */
export type AlibabaOfferDefault = {
  format: '1688-openapi-offer-default-v1';
  offerId: string;
  sourceSkuCount: 0;
  priceSource: 'product-sale-first-row';
  unitPriceCny: number;
  minimumOrder: number;
  stock: number | null;
};
const invalid = () => Error('SKU 구분 없는 상품의 원가·재고·원문 기준을 확인해주세요.');
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function numeric(value: unknown): number {
  return typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
}
function positive(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value > 100000000) throw invalid();
  return value;
}
function quantity(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw invalid();
  return value as number;
}
function stock(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw invalid();
  return value as number;
}

/** Called only for an explicitly present empty productSkuInfos array. Missing
 * or damaged SKU data is never evidence for a product-level default option. */
export function createAlibabaOfferDefault(offerId: string, minimumOrder: number, productSaleInfo: unknown): AlibabaOfferDefault {
  const sale = record(productSaleInfo);
  if (!Array.isArray(sale.priceRangeList) || !sale.priceRangeList.length) throw invalid();
  return {
    format: '1688-openapi-offer-default-v1', offerId, sourceSkuCount: 0,
    priceSource: 'product-sale-first-row',
    unitPriceCny: positive(numeric(record(sale.priceRangeList[0]).price)),
    minimumOrder: quantity(minimumOrder),
    stock: stock(sale.amountOnSale == null ? null : numeric(sale.amountOnSale)),
  };
}

/** Keep the no-SKU contract closed when receipts are normalized or replayed.
 * It cannot be attached to an ordinary SKU receipt or another source provider. */
export function validateAlibabaOfferDefault(input: unknown, provider: string, offerId: string, title: string,
  options: readonly { sku: string; name: string; unitPriceCny: number; minimumOrder: number; stock: number | null; imageIndex?: number; color?: string; size?: string }[],
  images: readonly { role: string }[], hasSkuPriceBasis: boolean): AlibabaOfferDefault {
  const value = record(input), keys = ['format', 'offerId', 'sourceSkuCount', 'priceSource', 'unitPriceCny', 'minimumOrder', 'stock'];
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
    || provider !== '1688-openapi-candidate-v1' || value.format !== '1688-openapi-offer-default-v1'
    || value.offerId !== offerId || value.sourceSkuCount !== 0 || value.priceSource !== 'product-sale-first-row'
    || typeof value.unitPriceCny !== 'number' || hasSkuPriceBasis || options.length !== 1) throw invalid();
  const option = options[0], unitPriceCny = positive(value.unitPriceCny), minimumOrder = quantity(value.minimumOrder), available = stock(value.stock);
  if (option.sku !== '' || option.name !== title || option.unitPriceCny !== unitPriceCny || option.minimumOrder !== minimumOrder || option.stock !== available
    || option.imageIndex !== 0 || images[0]?.role !== 'main' || option.color !== undefined || option.size !== undefined) throw invalid();
  return { format: '1688-openapi-offer-default-v1', offerId, sourceSkuCount: 0, priceSource: 'product-sale-first-row', unitPriceCny, minimumOrder, stock: available };
}
