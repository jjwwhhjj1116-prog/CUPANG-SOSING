import { parse, parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { parseCollectionRequest } from '@/app/sourcing';
import { COLLECTION_RESULT_LIMIT, validateCollectionResult } from '@/app/collection-result';
import { parseAlibabaDescription } from '@/app/alibaba-description';

type Row = Record<string, unknown>;
const row = (value: unknown): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('1688 모바일 상품 응답 구조를 확인해주세요.');
  return value as Row;
};
const text = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw Error('1688 상품 텍스트를 확인하지 못했습니다.');
  return value.trim();
};
const numeric = (value: unknown) => typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
const identity = (value: unknown): string => {
  if (typeof value === 'string' && /^[1-9]\d{0,29}$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw Error('1688 상품번호 또는 SKU를 확인하지 못했습니다.');
};

/** Read a literal JSON object, never evaluate seller JavaScript or JSONP. */
export function literalJsonObject(code: string, start: number): {value: Row; end: number} {
  if (code[start] !== '{') throw Error('1688 상품 초기 데이터가 JSON 객체가 아닙니다.');
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < code.length; index++) {
    const character = code[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') depth++;
    else if (character === '}' || character === ']') {
      if (--depth === 0) {
        try { return {value: row(JSON.parse(code.slice(start, index + 1))), end: index + 1}; }
        catch { throw Error('1688 상품 초기 데이터가 올바른 JSON이 아닙니다.'); }
      }
    }
  }
  throw Error('1688 상품 초기 데이터가 완성되지 않았습니다.');
}

function pageAssignments(code: string): Row[] {
  const values: Row[] = [];
  let quote = '', escaped = false, lineComment = false, blockComment = false, depth = 0;
  for (let index = 0; index < code.length; index++) {
    const character = code[index], next = code[index + 1];
    if (lineComment) { if (character === '\n' || character === '\r') lineComment = false; continue; }
    if (blockComment) { if (character === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '/' && next === '/') { lineComment = true; index++; continue; }
    if (character === '/' && next === '*') { blockComment = true; index++; continue; }
    if ('"\'`'.includes(character)) { quote = character; continue; }
    if (depth === 0 && (index === 0 || /[\s;]/.test(code[index - 1])) && code.startsWith('window.__INIT_DATA', index)) {
      const match = /^window\.__INIT_DATA\s*=\s*/.exec(code.slice(index));
      if (match) {
        const parsed = literalJsonObject(code, index + match[0].length);
        if (!/^\s*(?:;|$)/.test(code.slice(parsed.end))) throw Error('1688 상품 초기 데이터가 단순 JSON 할당이 아닙니다.');
        values.push(parsed.value); index = parsed.end - 1; continue;
      }
    }
    if (character === '{' || character === '[' || character === '(') depth++;
    else if (character === '}' || character === ']' || character === ')') depth--;
  }
  return values;
}

function entities(value: string): string {
  const fragment = parseFragment(`<textarea>${value.replace(/</g, '&lt;')}</textarea>`);
  const node = fragment.childNodes[0];
  return node && 'childNodes' in node ? node.childNodes.map(child => 'value' in child ? child.value : '').join('') : '';
}

export function parseAlibabaMobilePage(html: string, sourceUrl: string) {
  const source = parseCollectionRequest({urls: [sourceUrl]})[0];
  if (new TextEncoder().encode(html).byteLength > 2 * 1024 * 1024) throw Error('1688 모바일 페이지가 수집 한도를 초과했습니다.');
  const pending: DefaultTreeAdapterMap['node'][] = [parse(html)], candidates: Row[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    if ('childNodes' in node) pending.push(...node.childNodes);
    if (!('tagName' in node) || node.tagName !== 'script' || node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || node.attrs.some(attribute => attribute.name === 'src')) continue;
    const type = node.attrs.find(attribute => attribute.name === 'type')?.value.trim().toLowerCase();
    if (type && !['text/javascript', 'application/javascript'].includes(type)) continue;
    candidates.push(...pageAssignments(node.childNodes.map(child => 'value' in child ? child.value : '').join('')));
  }
  if (!candidates.length || candidates.some(value => JSON.stringify(value) !== JSON.stringify(candidates[0]))) throw Error('1688 모바일 상품 초기 데이터를 명확히 확인하지 못했습니다.');
  const init = candidates[0], global = row(init.globalData), base = row(global.offerBaseInfo), summary = row(global.tempModel);
  if (identity(base.offerId) !== source.offerId || identity(summary.offerId) !== source.offerId) throw Error('1688 모바일 페이지의 상품번호가 요청과 다릅니다.');
  if (global.isPicPrivate === true || global.isPricePrivate === true || row(global.offerSigns).isDetailForbidden === true) throw Error('이 상품 원문은 별도 접근 확인이 필요합니다.');
  // The live page includes many disabled/unloaded component placeholders.
  // Only populated component data can contain gallery or attribute facts.
  const components = Object.values(row(init.data)).filter(value => value != null).flatMap(value => {
    const component = row(value);
    return component.data == null ? [] : [row(component.data)];
  });
  const galleries = components.filter(value => value.offerImgList !== undefined);
  if (galleries.length !== 1 || identity(galleries[0].offerId) !== source.offerId || !Array.isArray(galleries[0].offerImgList) || !galleries[0].offerImgList.length) throw Error('1688 원본 상품 이미지를 확인하지 못했습니다.');
  const attributes = components.filter(value => value.propsList !== undefined).flatMap(value => {
    if (value.offerId != null && identity(value.offerId) !== source.offerId) throw Error('상품 속성의 상품번호가 요청과 다릅니다.');
    if (!Array.isArray(value.propsList)) throw Error('1688 상품 속성을 확인하지 못했습니다.');
    return value.propsList.map(entry => { const attribute = row(entry); return {name: text(attribute.name), value: text(attribute.value)}; });
  });
  let detailUrl: string | undefined;
  if (global.detailModel != null) {
    const detail = row(global.detailModel);
    if (identity(detail.offerId) !== source.offerId) throw Error('상세 설명 상품번호가 요청과 다릅니다.');
    if (detail.detailUrl) {
      const wrapper = new URL(text(detail.detailUrl));
      if (wrapper.protocol !== 'https:' || wrapper.hostname !== 'air.1688.com' || wrapper.username || wrapper.password || wrapper.port || wrapper.hash || wrapper.searchParams.getAll('offerId').length !== 1 || wrapper.searchParams.get('offerId') !== source.offerId || wrapper.searchParams.getAll('url').length !== 1) throw Error('공식 상세 설명 주소를 확인하지 못했습니다.');
      const address = new URL(wrapper.searchParams.get('url') ?? '');
      if (address.protocol !== 'https:' || address.hostname !== 'itemcdn.tmall.com' || address.username || address.password || address.port || address.search || address.hash || !/^\/1688offer\/[A-Za-z0-9]+$/.test(address.pathname)) throw Error('상세 설명 주소가 허용된 상품 원문이 아닙니다.');
      detailUrl = address.href;
    }
  }
  return {sourceUrl: source.sourceUrl, offerId: source.offerId, title: text(summary.offerTitle), gallery: galleries[0].offerImgList, attributes, detailUrl};
}

export function parseAlibabaMobileDescription(body: string): string {
  const match = /^\s*var\s+offer_details\s*=\s*/.exec(body);
  if (!match) throw Error('1688 상세 원문이 지원하는 JSON 형식이 아닙니다.');
  const parsed = literalJsonObject(body, match[0].length);
  if (!/^\s*;?\s*$/.test(body.slice(parsed.end)) || typeof parsed.value.content !== 'string') throw Error('1688 상세 설명 데이터를 확인하지 못했습니다.');
  return parsed.value.content;
}

/** This contract was observed on the user-selected offer and Alibaba's own
 * rox-sku-core normalizer. No headline/retail price becomes a SKU cost. */
export function parseAlibabaMobileProduct(page: ReturnType<typeof parseAlibabaMobilePage>, payload: unknown, description = '', now = Date.now()) {
  const envelope = row(payload);
  if (!Array.isArray(envelope.ret) || !envelope.ret.some(value => typeof value === 'string' && /^SUCCESS(?:::|$)/.test(value))) throw Error('1688 공개 옵션 조회가 성공하지 않았습니다.');
  const data = row(row(row(row(payload).data).result).data), base = row(data.offerBaseInfo);
  if (identity(base.offerId) !== page.offerId || text(base.title) !== page.title) throw Error('상품 페이지와 옵션 조회의 상품이 다릅니다.');
  const order = row(row(data.orderParamModel).orderParam), sku = row(data.skuModel), skuParam = row(order.skuParam);
  const minimumOrder = numeric(order.beginNum);
  if (!Number.isSafeInteger(minimumOrder) || minimumOrder < 1) throw Error('최소 주문 수량을 확인하지 못했습니다.');
  if (!['skuPrice', 'rangePrice'].includes(String(skuParam.skuPriceType))) throw Error('1688 옵션 가격 방식을 확인하지 못했습니다.');
  let commonPrice: number | undefined;
  if (skuParam.skuPriceType === 'rangePrice') {
    if (!Array.isArray(skuParam.skuRangePrices) || !skuParam.skuRangePrices.length || skuParam.skuRangePrices.length > 20) throw Error('수량별 가격 원문을 확인하지 못했습니다.');
    let previous = 0;
    for (const value of skuParam.skuRangePrices) {
      const tier = row(value), quantity = numeric(tier.beginAmount), price = numeric(tier.price);
      if (!Number.isSafeInteger(quantity) || quantity <= previous || !Number.isFinite(price) || price <= 0) throw Error('수량별 가격 구간을 확인하지 못했습니다.');
      previous = quantity; if (quantity <= minimumOrder) commonPrice = price;
    }
    if (commonPrice === undefined) throw Error('최소 주문 수량에 적용되는 원가가 없습니다.');
  }
  if (!Array.isArray(sku.skuProps) || !sku.skuProps.length || sku.skuProps.length > 5) throw Error('옵션 속성을 확인하지 못했습니다.');
  const props = sku.skuProps.map(value => {
    const prop = row(value);
    if (!Array.isArray(prop.value) || !prop.value.length || prop.value.length > 200) throw Error('옵션 속성 값을 확인하지 못했습니다.');
    const values = prop.value.map(entry => { const item = row(entry); return {name: entities(text(item.name)), imageUrl: item.imageUrl}; });
    if (new Set(values.map(item => item.name)).size !== values.length || values.some(item => !item.name || item.name.includes('>'))) throw Error('옵션 속성 값이 중복되거나 모호합니다.');
    return {name: text(prop.prop).toLowerCase(), values};
  });
  const entries = Object.entries(row(sku.skuInfoMap));
  if (!entries.length || entries.length > 200) throw Error('실제 옵션 1~200개가 필요합니다.');
  const images: {url: string; role: 'main' | 'additional' | 'detail'}[] = [];
  const image = (value: unknown, role: 'main' | 'additional' | 'detail') => {
    const original = text(value), url = new URL(original.startsWith('//') ? 'https:' + original : original);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !(url.hostname === 'alicdn.com' || url.hostname.endsWith('.alicdn.com'))) throw Error('이미지는 HTTPS Alibaba CDN 주소만 허용합니다.');
    let index = images.findIndex(item => item.url === url.href && (role === 'detail' ? item.role === role : item.role !== 'detail'));
    if (index < 0) { index = images.length; images.push({url: url.href, role}); }
    return index;
  };
  page.gallery.forEach((value, index) => image(value, index === 0 ? 'main' : 'additional'));
  const combinations = new Set<string>();
  const options = entries.map(([key, value]) => {
    const item = row(value), parts = entities(text(item.specAttrs)).split('>');
    if (parts.length !== props.length || entities(key) !== parts.join('>')) throw Error('옵션 SKU와 속성 값이 일치하지 않습니다.');
    const positions = parts.map((part, index) => props[index].values.findIndex(option => option.name === part));
    if (positions.some(position => position < 0)) throw Error('옵션 SKU의 속성 값을 확인하지 못했습니다.');
    const combination = JSON.stringify(positions);
    if (combinations.has(combination)) throw Error('같은 옵션 조합에 서로 다른 SKU가 있습니다.');
    combinations.add(combination);
    const unitPriceCny = commonPrice ?? numeric(item.price);
    if (!Number.isFinite(unitPriceCny) || unitPriceCny <= 0) throw Error('옵션별 CNY 원가를 확인하지 못했습니다.');
    const references = positions.map((position, index) => props[index].values[position].imageUrl).filter(value => value != null && value !== '');
    const attribute = (names: string[]) => { const values = props.flatMap((prop, index) => names.includes(prop.name) ? [parts[index]] : []); if (new Set(values).size > 1) throw Error('옵션 속성 값이 충돌합니다.'); return values[0]; };
    const color = attribute(['颜色', '色彩', '색상', 'color', 'colour']), size = attribute(['尺码', '尺寸', '사이즈', 'size']);
    return {positions, option: {sku: identity(item.skuId), name: parts.join(' / '), unitPriceCny, minimumOrder, stock: item.canBookCount == null ? null : numeric(item.canBookCount),
      ...(references.length ? {imageIndex: image(references[0], 'additional')} : {}), ...(color ? {color} : {}), ...(size ? {size} : {})}};
  }).sort((left, right) => { for (let index = 0; index < props.length; index++) { const difference = left.positions[index] - right.positions[index]; if (difference) return difference; } return 0; });
  const details = parseAlibabaDescription(description);
  details.images.forEach(url => image(url, 'detail'));
  const result = validateCollectionResult({schemaVersion: 1, sourceUrl: page.sourceUrl, provider: '1688-public-mobile-v1', collectedAt: new Date(now).toISOString(),
    title: page.title, description: details.text, attributes: page.attributes, options: options.map(value => value.option), images}, page.offerId, now);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > COLLECTION_RESULT_LIMIT) throw Error('수집 결과 크기가 한도를 초과했습니다.');
  return result;
}
