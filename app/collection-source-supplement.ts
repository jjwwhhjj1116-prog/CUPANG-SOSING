import { COLLECTION_RESULT_LIMIT, validateCollectionResult, type CollectionResult } from '@/app/collection-result';

export function canSupplementCollection(result: Pick<CollectionResult, 'provider'>) {
  return ['1688-public-sku-v1', 'chrome-public-sku-v1'].includes(result.provider);
}

/** Keep the first receipt's SKU facts and image indices. Only a separately
 * validated full mobile capture for those same offers/SKUs can add sources. */
export function supplementCollectionSource(original: CollectionResult, captured: CollectionResult): CollectionResult {
  if (!canSupplementCollection(original) || captured.provider !== 'chrome-public-mobile-v1'
    || original.offerId !== captured.offerId || original.sourceUrl !== captured.sourceUrl
    || original.options.length !== captured.options.length) throw Error('같은 상품의 상세 원문을 확인하지 못했습니다. 기존 원문은 유지됩니다.');
  const skus = new Map(captured.options.map(option => [option.sku, option]));
  for (const option of original.options) {
    const next = skus.get(option.sku);
    if (!next || ['name','unitPriceCny','minimumOrder','color','size'].some(key => option[key as keyof typeof option] !== next[key as keyof typeof next])) {
      throw Error('원문 SKU·옵션·가격이 달라 보완하지 않았습니다. 기존 가격과 수정값은 유지됩니다.');
    }
  }
  if (!captured.description && !captured.attributes?.length && !captured.images.some(image => image.role === 'detail')) {
    throw Error('Chrome에서도 상세 이미지·설명·상품 속성을 받지 못했습니다. 기존 원문은 유지됩니다.');
  }
  const images = original.images.map(image => ({ ...image }));
  for (const image of captured.images) {
    if (image.role === 'main' || images.some(previous => previous.role === image.role && previous.url === image.url)) continue;
    images.push({ ...image });
  }
  const { offerId, ...merged } = { ...original, provider: 'chrome-public-mobile-supplement-v1',
    description: original.description || captured.description,
    attributes: original.attributes?.length ? original.attributes : captured.attributes,
    images };
  const result = validateCollectionResult(merged, offerId);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > COLLECTION_RESULT_LIMIT) throw Error('보완 원문이 수집 크기 한도를 초과했습니다.');
  return result;
}
