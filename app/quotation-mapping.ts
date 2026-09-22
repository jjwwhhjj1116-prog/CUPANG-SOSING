import { categoryFields, type CategoryField, type ColumnMapping } from './category-profiles';
import { getQuotationSchema } from './quotation-schema';

// Match observed field labels, never substrings: 상품 무게 and 포장 무게 are
// different facts, just as 판매 수량 and 박스 내 SKU 수량 are different facts.
const headerKey = (value: string) => value.normalize('NFKC').replace(/[＊*]/gu, '').replace(/\s+/gu, '').trim();
const aliases: Partial<Record<CategoryField, string[]>> = {
  title: ['상품명', '한국어 상품명'], categoryId: ['카테고리 번호', '카테고리 ID', '카테고리 코드'],
  sourceUrl: ['1688 링크', '1688 상품 URL', '구매 링크'], skuName: ['옵션명'], skuId: ['원본 SKU 번호', '공급자 SKU'],
  supplyPrice: ['공급가', '공급가(KRW)'], salePrice: ['판매가', '쿠팡 판매가', '판매가(KRW)'],
  msrp: ['권장소비자가격'], sourcePriceCny: ['중국원가(CNY)', '원가(CNY)'],
  importer: ['수입 및 판매원', '수입·판매원'], serviceContact: ['A/S 연락처'],
};

export type QuotationMappingSuggestion = {
  mappings: ColumnMapping[]; unmatchedColumns: number[]; ambiguousColumns: number[];
};

/** Creates an editable draft from exact labels in the chosen category only. */
export function suggestQuotationMappings(headers: readonly string[], categoryId: string | null): QuotationMappingSuggestion {
  const schema = getQuotationSchema(categoryId);
  const candidates = new Map<string, Set<CategoryField>>();
  const required = new Map(schema.fields.map(field => [field.id, field.required]));
  const add = (label: string, field: CategoryField) => {
    const key = headerKey(label); if (!key) return;
    const fields = candidates.get(key) ?? new Set<CategoryField>(); fields.add(field); candidates.set(key, fields);
  };
  for (const field of schema.fields) if (Object.hasOwn(categoryFields, field.id)) add(field.label, field.id as CategoryField);
  for (const [field, labels] of Object.entries(aliases)) for (const label of labels) add(label, field as CategoryField);
  const mappings: ColumnMapping[] = []; const unmatchedColumns: number[] = []; const ambiguousColumns: number[] = [];
  const normalized = headers.map(headerKey);
  headers.forEach((_header, column) => {
    const key = normalized[column]; const fields = candidates.get(key);
    if (!fields?.size) { unmatchedColumns.push(column); return; }
    if (fields.size !== 1 || normalized.filter(value => value === key).length > 1) { ambiguousColumns.push(column); return; }
    const field = [...fields][0];
    mappings.push({ column, field, required: required.get(field) ?? false });
  });
  return { mappings, unmatchedColumns, ambiguousColumns };
}
