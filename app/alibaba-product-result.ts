import { parseCollectionRequest } from '@/app/sourcing';
import { COLLECTION_RESULT_LIMIT, validateCollectionResult } from '@/app/collection-result';
import { parseAlibabaDescription } from '@/app/alibaba-description';

type Row = Record<string, unknown>;
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('1688 상품 응답 구조를 확인해주세요.');
  return value as Row;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw Error(`${label}을 확인하지 못했습니다.`);
  return value.trim();
}
function numeric(value: unknown): number {
  return typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
}
function identity(value: unknown): string {
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw Error('상품번호 또는 SKU 번호를 확인하지 못했습니다.');
}

/** Mapping remains pending live verification against an owned API response.
 * Only explicit SKU prices are supported; headline/tier/consignment
 * prices must not silently replace them. No translated/generated facts here. */
export function parseAlibabaProduct(payload: unknown, sourceUrl: string, now = Date.now()) {
  const source = parseCollectionRequest({ urls: [sourceUrl] })[0];
  const envelope = row(row(payload).result);
  if (envelope.success !== true) throw Error('1688 상품조회가 성공하지 않았습니다.');
  const product = row(envelope.result);
  if (identity(product.offerId) !== source.offerId) throw Error('요청 상품번호와 응답이 다릅니다.');
  const minimumOrder = numeric(product.minOrderQuantity);
  if (!Number.isSafeInteger(minimumOrder) || minimumOrder < 1) throw Error('최소 주문 수량을 확인하지 못했습니다.');
  if (!Array.isArray(product.productSkuInfos) || !product.productSkuInfos.length || product.productSkuInfos.length > 200) throw Error('실제 옵션 1~200개가 필요합니다.');
  const images: {url: string; role: 'main' | 'additional' | 'detail'}[] = [];
  function image(value: unknown, role: 'main' | 'additional' | 'detail') {
    const url = new URL(text(value, '이미지 주소'));
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !(url.hostname === 'alicdn.com' || url.hostname.endsWith('.alicdn.com'))) throw Error('이미지는 HTTPS Alibaba CDN 주소만 허용합니다.');
    let index = images.findIndex(entry => entry.url === url.href && entry.role === role);
    if (index === -1) { index = images.length; images.push({url: url.href, role}); }
    return index;
  }
  const mainImages = row(product.productImage).images;
  if (!Array.isArray(mainImages) || !mainImages.length) throw Error('상품 이미지를 확인하지 못했습니다.');
  mainImages.forEach((value, index) => image(value, index === 0 ? 'main' : 'additional'));
  const singleSku = product.productSkuInfos.length === 1;
  const options = product.productSkuInfos.map(value => {
    const sku = row(value);
    const unitPriceCny = numeric(sku.price);
    if (!Number.isFinite(unitPriceCny) || unitPriceCny <= 0) throw Error('옵션별 원가를 확인하지 못했습니다. 수량별·대행 가격을 임의로 적용하지 않습니다.');
    if (!Array.isArray(sku.skuAttributes) || (!sku.skuAttributes.length && !singleSku)) throw Error('옵션 속성을 확인하지 못했습니다.');
    const attributes = sku.skuAttributes.map(row);
    const indices = attributes.filter(attribute => attribute.skuImageUrl != null && attribute.skuImageUrl !== '').map(attribute => image(attribute.skuImageUrl, 'additional'));
    const stock = sku.amountOnSale == null ? null : numeric(sku.amountOnSale);
    const optionAttribute = (names: string[]) => {
      const matching = attributes.filter(attribute => typeof attribute.attributeName === 'string' && names.includes(attribute.attributeName.trim()));
      const values = [...new Set(matching.map(attribute => text(attribute.value, '옵션 속성')))];
      if (values.length > 1) throw Error('동일 옵션 속성에 서로 다른 값이 있습니다.');
      return values[0];
    };
    const color = optionAttribute(['颜色','色彩','색상']);
    const size = optionAttribute(['尺码','尺寸','사이즈']);
    return {sku: identity(sku.skuId), name: attributes.length ? attributes.map(attribute => text(attribute.value, '옵션명')).join(' / ') : text(product.subject, '상품명'), unitPriceCny, minimumOrder, stock,
      ...(indices.length ? {imageIndex: indices[0]} : {}), ...(color ? {color} : {}), ...(size ? {size} : {})};
  });
  const attributes = product.productAttribute == null ? [] : product.productAttribute;
  if (!Array.isArray(attributes)) throw Error('상품 속성 구조를 확인해주세요.');
  const description = parseAlibabaDescription(product.description);
  description.images.forEach(url => image(url, 'detail'));
  const result = validateCollectionResult({schemaVersion: 1, sourceUrl: source.sourceUrl, provider: '1688-openapi-candidate-v1', collectedAt: new Date(now).toISOString(),
    title: text(product.subject, '상품명'), description: description.text, options, images,
    attributes: attributes.map(value => { const attribute = row(value); return {name: text(attribute.attributeName, '속성명'), value: text(attribute.value, '속성값')}; })}, source.offerId, now);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > COLLECTION_RESULT_LIMIT) throw Error('수집 결과 크기가 한도를 초과했습니다.');
  return result;
}
