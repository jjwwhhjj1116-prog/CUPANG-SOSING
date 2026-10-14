type Row = Record<string, unknown>;
export type AlibabaSourcePriceBasis = {
  schemaVersion: 1;
  source: '1688-openapi-consignment-v1';
  rule: 'couplus-all-skus-uniform-first-row-v1';
  selection: 'uniform-first-base' | 'mixed-sku';
  firstBasePriceCny: number;
  skuPrices: { sku: string; source: 'fenxiao-offer-price' | 'consign-price'; unitPriceCny: number }[];
};
const invalid = () => Error('1688 원가 기준과 옵션별 원가를 확인하지 못했습니다.');
function record(value: unknown, keys?: string[]): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const result = value as Row;
  if (keys && Object.keys(result).some(key => !keys.includes(key))) throw invalid();
  return result;
}
function positive(value: unknown): number {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) throw invalid();
  return amount;
}

/** Static current Couplus processOptions contract, not a verified live API
 * response. Only this full OpenAPI shape enables the rule; explicit sku.price
 * candidate receipts retain their separate compatibility mapping. */
export function selectAlibabaSourcePricing(skus: readonly { sku: string; row: Row }[], productSaleInfo: unknown) {
  if (!skus.some(({ row }) => Object.hasOwn(row, 'consignPrice') || Object.hasOwn(row, 'fenxiaoPriceInfo'))) return null;
  const sale = record(productSaleInfo);
  if (!Array.isArray(sale.priceRangeList) || !sale.priceRangeList.length) throw invalid();
  // The original first row is authoritative here. Never sort, select a tier,
  // or substitute a headline/minimum for an absent or malformed first price.
  const firstBasePriceCny = positive(record(sale.priceRangeList[0]).price);
  const skuPrices: AlibabaSourcePriceBasis['skuPrices'] = skus.map(({ sku, row }) => {
    const info = row.fenxiaoPriceInfo == null ? null : record(row.fenxiaoPriceInfo);
    // Match the source's truthiness BEFORE numeric validation: number 0 and
    // an empty string fall back, but string "0" and malformed truthy values
    // select offerPrice and fail instead of silently using consignPrice.
    const offerPrice = info?.offerPrice;
    return { sku, source: offerPrice ? 'fenxiao-offer-price' : 'consign-price', unitPriceCny: positive(offerPrice ? offerPrice : row.consignPrice) };
  });
  const uniform = skuPrices.every(item => item.unitPriceCny === skuPrices[0].unitPriceCny);
  const priceBasis: AlibabaSourcePriceBasis = { schemaVersion: 1, source: '1688-openapi-consignment-v1', rule: 'couplus-all-skus-uniform-first-row-v1',
    selection: uniform ? 'uniform-first-base' : 'mixed-sku', firstBasePriceCny, skuPrices };
  return { prices: skuPrices.map(item => uniform ? firstBasePriceCny : item.unitPriceCny), priceBasis };
}

/** Preserve and recheck provenance whenever a receipt is normalized/stored.
 * The bounded, exact SKU list also prevents a filtered subset from presenting
 * itself as the complete source used for the uniform-price decision. */
export function validateAlibabaSourcePriceBasis(input: unknown, provider: string,
  options: readonly { sku: string; unitPriceCny: number }[]): AlibabaSourcePriceBasis {
  const value = record(input, ['schemaVersion', 'source', 'rule', 'selection', 'firstBasePriceCny', 'skuPrices']);
  // Append-only source supplementation retains the original price evidence.
  if (!['1688-openapi-candidate-v1', 'chrome-public-mobile-supplement-v1'].includes(provider) || value.schemaVersion !== 1 || value.source !== '1688-openapi-consignment-v1'
    || value.rule !== 'couplus-all-skus-uniform-first-row-v1' || !Array.isArray(value.skuPrices)
    || value.skuPrices.length < 1 || value.skuPrices.length > 200 || value.skuPrices.length !== options.length
    || typeof value.firstBasePriceCny !== 'number') throw invalid();
  const firstBasePriceCny = positive(value.firstBasePriceCny);
  const skuPrices: AlibabaSourcePriceBasis['skuPrices'] = value.skuPrices.map((input, index) => {
    const item = record(input, ['sku', 'source', 'unitPriceCny']);
    if (typeof item.sku !== 'string' || item.sku !== options[index].sku || typeof item.source !== 'string' || !['fenxiao-offer-price', 'consign-price'].includes(item.source)
      || typeof item.unitPriceCny !== 'number') throw invalid();
    return { sku: item.sku, source: item.source as AlibabaSourcePriceBasis['skuPrices'][number]['source'], unitPriceCny: positive(item.unitPriceCny) };
  });
  const uniform = skuPrices.every(item => item.unitPriceCny === skuPrices[0].unitPriceCny);
  const selection = uniform ? 'uniform-first-base' : 'mixed-sku';
  if (value.selection !== selection || options.some((option, index) => option.unitPriceCny !== (uniform ? firstBasePriceCny : skuPrices[index].unitPriceCny))) throw invalid();
  return { schemaVersion: 1, source: '1688-openapi-consignment-v1', rule: 'couplus-all-skus-uniform-first-row-v1', selection, firstBasePriceCny, skuPrices };
}
