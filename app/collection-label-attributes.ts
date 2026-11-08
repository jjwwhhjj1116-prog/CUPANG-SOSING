import type { CollectionResult } from '@/app/collection-result';
import type { LabelField } from '@/app/product-content';

// Exact whole-attribute names only. SKU, packing dimensions, country and legal
// declarations must not be inferred from similar words in supplier descriptions.
// 产地/原产地 may name a city/region and are not manufacturing-country headings.
const names: Partial<Record<LabelField, readonly string[]>> = {
  material: ['재질', '材质', 'material'],
  model: ['모델명', '型号', 'model'],
  components: ['제품 구성품', '구성품', '包装清单', 'package contents'],
  dimensions: ['제품 크기', '제품 치수', '产品尺寸', 'product dimensions'],
  countryOfOrigin: ['제조국', '原产国', 'country of origin'],
};

export function collectionLabelField(name: string): LabelField | undefined {
  return Object.entries(names).find(([, aliases]) => aliases.includes(name.trim().toLowerCase()))?.[0] as LabelField | undefined;
}

/** Original-language values for a new editable draft, never translated claims. */
export function collectionLabelAttributes(attributes: CollectionResult['attributes']) {
  const values: Partial<Record<LabelField, string>> = {};
  for (const [field, aliases] of Object.entries(names)) {
    const matches = (attributes ?? []).filter(attribute => aliases.includes(attribute.name.trim().toLowerCase()));
    const candidates = new Set(matches.map(attribute => attribute.value.trim()));
    if (candidates.size !== 1) continue;
    const value = [...candidates][0];
    if (value && value.length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) values[field as LabelField] = value;
  }
  return values;
}

const countryHeadings = new Set([
  '제조국', '제조국(원산지)', '생산국', '原产国', '原產國', '原产国/地区', '原產國/地區', '制造国', '製造國', '生产国', '生產國',
  'country of origin', 'country of manufacture',
]);
const originHeadings = new Set(['원산지', '제조지', '생산지', '原产地', '原產地', '产地', '產地', '制造地', '製造地', '生产地', '生產地']);
const countryAliases = new Map(Object.entries({
  중국: ['중국', '중국산', '中国', '中國', '中国大陆', '中國大陸', '中华人民共和国', '中華人民共和國', 'china', 'cn', 'made in china'],
  대한민국: ['대한민국', '한국', '한국산', '韩国', '韓國', '大韩民国', '大韓民國', 'south korea', 'republic of korea', 'kr'],
  일본: ['일본', '일본산', '日本', 'japan', 'jp'],
  미국: ['미국', '미국산', '美国', '美國', 'usa', 'us', 'united states', 'united states of america'],
  베트남: ['베트남', '越南', 'vietnam', 'vn'],
  태국: ['태국', '泰国', '泰國', 'thailand', 'th'],
  인도: ['인도', '印度', 'india', 'in'],
  인도네시아: ['인도네시아', '印度尼西亚', '印度尼西亞', '印尼', 'indonesia', 'id'],
  독일: ['독일', '德国', '德國', 'germany', 'de'],
  프랑스: ['프랑스', '法国', '法國', 'france', 'fr'],
  이탈리아: ['이탈리아', '意大利', 'italy', 'it'],
  대만: ['대만', '台湾', '台灣', '臺灣', '中国台湾', '中國台灣', '中国台湾省', 'taiwan', 'tw'],
  홍콩: ['홍콩', '香港', '中国香港', '中國香港', '中国香港特别行政区', '中國香港特別行政區', 'hong kong', 'hk'],
  마카오: ['마카오', '澳门', '澳門', '中国澳门', '中國澳門', '中国澳门特别行政区', '中國澳門特別行政區', 'macau', 'macao', 'mo'],
}).flatMap(([country, aliases]) => aliases.map(alias => [alias, country] as const)));
const mainlandRegion = /^(?:中国|中國)[\s·,，-]*(?:浙江|广东|廣東|江苏|江蘇|福建|山东|山東|河北|河南|安徽|上海|北京|天津|重庆|重慶|四川|云南|雲南|广西|廣西|江西|湖北|湖南|辽宁|遼寧|吉林|黑龙江|黑龍江|陕西|陝西|山西|甘肃|甘肅|内蒙古|內蒙古|海南|贵州|貴州|青海|宁夏|寧夏|新疆|西藏|深圳|义乌|義烏)[\p{Script=Han}]{0,12}$/u;
const distinctHanOrigins = [...countryAliases].filter(([alias, country]) => country !== '중국' && /^\p{Script=Han}+$/u.test(alias))
  .map(([alias]) => alias);

export function canonicalCollectedOrigin(value: string): string | undefined {
  const text = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  return countryAliases.get(text.toLowerCase())
    ?? (mainlandRegion.test(text) && !distinctHanOrigins.some(alias => text.includes(alias)) ? '중국' : undefined);
}

/** Only explicit production/origin headings can establish a country. A loose
 * origin heading may carry a city, so only a stated country qualifies there. */
export function confirmedCollectionOrigin(attributes: CollectionResult['attributes']) {
  const evidence = new Map<string, 'collected' | 'translated'>();
  for (const pair of attributes ?? []) {
    const heading = pair.name.normalize('NFKC').trim().toLowerCase();
    const exactHeading = countryHeadings.has(heading);
    if (!exactHeading && !originHeadings.has(heading)) continue;
    const country = canonicalCollectedOrigin(pair.value);
    if (!country) {
      if (exactHeading) return;
      continue;
    }
    const provenance = pair.value.trim() === country ? 'collected' : 'translated';
    if (evidence.get(country) !== 'collected') evidence.set(country, provenance);
  }
  if (evidence.size === 1) {
    const [[value, provenance]] = evidence;
    return { value, provenance };
  }
}
