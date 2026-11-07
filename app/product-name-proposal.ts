const notApplicable = /해당\s*(?:사항\s*)?없음/u;
const sizePlaceholder = /^(?:상세\s*(?:페이지|설명|정보)\s*참조|미확인|미입력|확인\s*필요)$/u;
const missingValue = /^(?:n\s*\/\s*a|not\s+applicable|미확인|미입력|확인\s*필요)[.!]?$/iu;
const detailReference = /^(?:(?:상품|제품)?\s*상세\s*(?:페이지|설명|정보)?(?:를|을)?\s*(?:참조|참고)|(?:see|refer\s+to)\s+(?:the\s+)?(?:product\s+)?details?(?:\s+page)?)[.!]?$/iu;
const sizeNames = new Set(['사이즈', '패션의류/잡화 사이즈', '스포츠 의류/잡화 사이즈']);

export function isProductSizeAttribute(name: string) {
  return sizeNames.has(name);
}

export function productSizeValue(value: string) {
  const size = value.trim();
  if (notApplicable.test(size) || sizePlaceholder.test(size)) return '';
  if (/^(?:free(?:[\s-]*size)?|프리(?:\s*사이즈)?|均[码碼]|均[码碼]号)$/iu.test(size)) return 'Free';
  return size;
}

export function matchingSellingQuantity(value: string, count: number) {
  const match = /^([1-9]\d*)\s*(개|쌍|켤레|세트|박스|팩|매|장)$/u.exec(value.trim());
  return match && Number(match[1]) === count ? `${match[1]}${match[2]}` : '';
}

function usablePart(value: string) {
  const part = value.trim();
  return notApplicable.test(part) ? '' : part;
}

export type ProductNameProposal = { value: string; missing: string[] };

export function proposeProductName(input: {
  brand: string; productName: string; color: string; size: string; count: number; quantity: string;
}): ProductNameProposal {
  const brand = usablePart(input.brand);
  let name = usablePart(input.productName);
  if (name === brand) name = '';
  else if (brand && name.startsWith(brand + ' ')) name = name.slice(brand.length).trimStart();
  const color = /\p{Script=Han}/u.test(input.color) ? '' : usablePart(input.color);
  const normalizedSize = productSizeValue(input.size);
  const size = /\p{Script=Han}/u.test(normalizedSize) ? '' : normalizedSize;
  const quantity = Number.isSafeInteger(input.count) && input.count > 0
    ? matchingSellingQuantity(input.quantity, input.count) || `${input.count}개` : '';
  const existingOptions = [color, size, quantity].join(' ');
  if (color && size && quantity && name.endsWith(' ' + existingOptions)) name = name.slice(0, -existingOptions.length).trimEnd();
  const existingQuantity = /(?:^|\s)([1-9]\d*\s*(?:개|쌍|켤레|세트|박스|팩|매|장))$/u.exec(name);
  if (existingQuantity && existingQuantity[1].replace(/\s/gu, '') === quantity)
    name = name.slice(0, existingQuantity.index).trimEnd();
  const parts = [brand, name, color, size, quantity];
  const missing = ['브랜드', '상품 설명', '색상', '사이즈', '판매 수량'].filter((_, index) => !parts[index]);
  return { value: missing.length ? '' : parts.join(' '), missing };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function supplierHubNameParts(document: unknown) {
  const row = record(document), product = record(row.productPage);
  const base = record(row.startPage).productName;
  const attributes = [record(product.commonAttributes).exposedAttributes, product.exposedAttributes]
    .flatMap(value => Array.isArray(value) ? value : [])
    .map(value => {
      const entry = record(value), name = entry.attributeName ?? entry.name, attributeValue = Object.hasOwn(entry, 'attributeValue') ? entry.attributeValue : entry.value;
      const scalar = typeof attributeValue === 'string' || typeof attributeValue === 'boolean'
        || typeof attributeValue === 'number' && Number.isFinite(attributeValue);
      return { name: typeof name === 'string' ? name : '', value: scalar ? String(attributeValue).trim() : '' };
    });
  return { base: typeof base === 'string' ? base.trim() : '', attributes };
}

export function supplierHubProductNameIssue(documents: readonly unknown[]): string {
  for (const document of documents) {
    const { base, attributes } = supplierHubNameParts(document);
    const invalid = attributes.find(({ value }) => !value || notApplicable.test(value) || missingValue.test(value) || detailReference.test(value));
    if (invalid && isProductSizeAttribute(invalid.name))
      return '견적서의 노출 사이즈에 실제 사이즈를 입력해주세요. 단일 사이즈로 확인된 경우 Free를 입력할 수 있습니다.';
    if (invalid)
      return `견적서의 노출 속성${invalid.name ? `(${invalid.name})` : ''}에 실제 옵션값을 입력해주세요.`;
    if (notApplicable.test(base))
      return '상품명에 붙는 노출 옵션에서 해당사항없음 값을 확인하고 실제 옵션값으로 수정해주세요.';
  }
  return '';
}

/** Hub appends the exposed values in its category order. Hidden attributes
 * and legal notices do not take part in this preview. */
export function supplierHubDisplayedProductName(document: unknown) {
  const { base, attributes } = supplierHubNameParts(document);
  return base && !supplierHubProductNameIssue([document]) ? [base, ...attributes.map(({ value }) => value)].join(' ') : '';
}
