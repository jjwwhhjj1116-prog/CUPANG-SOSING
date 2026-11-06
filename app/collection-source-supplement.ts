import { COLLECTION_RESULT_LIMIT, validateCollectionResult, type CollectionResult } from '@/app/collection-result';
import { collectionSourceGaps } from '@/app/collection-source-gaps';

export function canSupplementCollection(result: Pick<CollectionResult, 'provider' | 'description' | 'images' | 'attributes' | 'offerDefault' | 'pageOptionIdentity'>) {
  // Supplements are append-only. Remaining optional gaps still show in review,
  // but retrying their image import must reuse the stored capture, not recapture.
  // The current mobile contract requires observed remote SKUs. It cannot
  // repair a product-level default without changing its source identity.
  // A page-row key is not proof of a matching remote mobile SKU. A fresh page
  // capture stays a separate saved version instead of joining anonymous rows.
  return !result.offerDefault && !result.pageOptionIdentity && result.provider !== 'chrome-public-mobile-supplement-v1' && collectionSourceGaps(result).length > 0;
}

/** Keep the first receipt's SKU facts and image indices. Only a separately
 * validated full mobile capture for those same offers/SKUs can add sources. */
function representationParts(value:string){
  const entities:Record<string,string>={gt:'>',lt:'<',amp:'&',quot:'"',apos:"'",nbsp:'\u00a0'};
  const decoded=value.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|gt|lt|amp|quot|apos|nbsp);/giu,(entity,key:string)=>{
    if(key[0]!=='#')return entities[key.toLowerCase()]??entity;
    const code=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
    return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):entity;
  });
  return decoded.split(/\s*>\s*|\s+\/\s+/u).map(part=>part.trim());
}
function samePageOption(original:CollectionResult['options'][number],next:CollectionResult['options'][number]){
  if(['name','color','size'].every(key=>original[key as keyof typeof original]===next[key as keyof typeof next]))return true;
  const axes=(['color','size'] as const).filter(key=>original[key]!==undefined);
  if(!axes.length)return false;
  const values=axes.map(key=>representationParts(original[key]!));
  if(values.some(parts=>parts.length!==1))return false;
  const expected=values.flat(),same=(parts:string[])=>JSON.stringify(parts)===JSON.stringify(expected);
  return same(representationParts(original.name))&&same(representationParts(next.name))
    &&(['color','size'] as const).every(key=>next[key]===undefined||original[key]!==undefined&&JSON.stringify(representationParts(next[key]!))===JSON.stringify(representationParts(original[key]!)));
}
export function supplementCollectionSource(original: CollectionResult, captured: CollectionResult, authority:'legacy-mobile'|'owned-page'='legacy-mobile'): CollectionResult {
  const page=authority==='owned-page'&&['chrome-current-page-v1','chrome-reviewed-page-v1'].includes(captured.provider);
  if (!canSupplementCollection(original) || !(page||captured.provider === 'chrome-public-mobile-v1')
    || original.offerId !== captured.offerId || original.sourceUrl !== captured.sourceUrl
    || original.options.length !== captured.options.length) throw Error('같은 상품의 상세 원문을 확인하지 못했습니다. 기존 원문은 유지됩니다.');
  const skus = new Map(captured.options.map(option => [option.sku, option]));
  if(skus.size!==captured.options.length||new Set(original.options.map(option=>option.sku)).size!==original.options.length)throw Error('중복 SKU 원문은 보완할 수 없습니다.');
  for (const option of original.options) {
    const next = skus.get(option.sku);
    if (!next || ['unitPriceCny','minimumOrder'].some(key => option[key as keyof typeof option] !== next[key as keyof typeof next])
      ||(page?!samePageOption(option,next):['name','color','size'].some(key=>option[key as keyof typeof option]!==next[key as keyof typeof next]))) {
      throw Error('원문 SKU·옵션·가격이 달라 보완하지 않았습니다. 기존 가격과 수정값은 유지됩니다.');
    }
  }
  const addsDescription = !original.description.trim() && !!captured.description.trim();
  const addsAttributes = !original.attributes?.length && !!captured.attributes?.length;
  const addsDetails = captured.images.some(image => image.role === 'detail'
    && !original.images.some(previous => previous.role === 'detail' && previous.url === image.url));
  if (!addsDescription && !addsAttributes && !addsDetails) {
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
