// Aggregate UTF-8 JSON request limit; per-field character limits still apply.
export const CATEGORY_PROFILE_BODY_LIMIT = 300_000;
export const CATEGORY_TEMPLATE_FILE_LIMIT = 5_000_000;
export const categoryFields = {
  title: '한국어 상품명', skuName: '옵션명', skuId: '원본 SKU 번호', categoryId: '카테고리 번호',
  brand: '브랜드', manufacturer: '제조사', importer: '수입·판매원', serviceContact: 'A/S 연락처',
  sourceUrl: '1688 상품 URL', sourcePriceCny: '원가 (CNY)', supplyPrice: '공급가 (KRW)',
  salePrice: '판매가 (KRW)', msrp: '시장가격 (KRW)', barcode: '바코드', boxQuantity: '박스 내 수량',
  material: '소재', countryOfOrigin: '제조국', mainImage: '대표 이미지', detailImage: '상세 이미지',
  label: '표시사항 파일', constant: '고정값',
} as const;
export type CategoryField = keyof typeof categoryFields;
export type TemplateDefinition = {
  name: string; format: 'csv' | 'tsv' | 'xlsx'; sha256: string;
  sheetName: string; headerRow: number; headers: string[];
  storageKey?: string;
};
export type ColumnMapping = { column: number; field: CategoryField; required: boolean; constant?: string };
export type CategoryProfileInput = {
  name: string; categoryId: string; categoryPath: string[];
  template: TemplateDefinition | null; mappings: ColumnMapping[];
};
export type CategoryProfile = CategoryProfileInput & {
  id: string; revision: number; verification: 'draft'; createdAt: string; updatedAt: string;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 형식을 확인해주세요.`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, limit: number, optional = false): string {
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${label}을(를) 확인해주세요.`);
  return value.trim();
}
export function validateCategoryProfile(value: unknown): CategoryProfileInput {
  const input = record(value, '카테고리 설정');
  if (input.verification !== undefined && input.verification !== 'draft') throw new Error('견적서 검증 상태는 직접 변경할 수 없습니다.');
  const name = string(input.name, '설정 이름', 120);
  const categoryId = string(input.categoryId ?? '', '실제 카테고리 번호', 120, true);
  if (!Array.isArray(input.categoryPath) || !input.categoryPath.length || input.categoryPath.length > 10) throw new Error('카테고리 경로를 1~10단계로 입력해주세요.');
  const categoryPath = input.categoryPath.map(value => string(value, '카테고리 경로', 120));
  let template: TemplateDefinition | null = null;
  if (input.template !== null && input.template !== undefined) {
    const value = record(input.template, '견적서 양식');
    if (!['csv', 'tsv', 'xlsx'].includes(String(value.format))) throw new Error('지원하는 견적서 형식인지 확인해주세요.');
    if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.sha256)) throw new Error('견적서 원본 파일의 SHA-256 값이 필요합니다.');
    if (!Number.isInteger(value.headerRow) || Number(value.headerRow) < 1 || Number(value.headerRow) > 1000) throw new Error('머리글 행 번호를 확인해주세요.');
    if (!Array.isArray(value.headers) || !value.headers.length || value.headers.length > 200) throw new Error('견적서 열은 1~200개까지 사용할 수 있습니다.');
    const headers = value.headers.map(value => string(value, '견적서 열 이름', 500, true));
    if (!headers.some(Boolean)) throw new Error('견적서 머리글에 열 이름이 없습니다.');
    template = { name: string(value.name, '견적서 파일 이름', 240), format: value.format as TemplateDefinition['format'], sha256: value.sha256.toLowerCase(), sheetName: string(value.sheetName ?? '', '시트 이름', 120, true), headerRow: Number(value.headerRow), headers,
      ...(value.storageKey !== undefined ? { storageKey: string(value.storageKey, '견적서 저장 경로', 600) } : {}), };
  }
  if (!Array.isArray(input.mappings) || input.mappings.length > 200) throw new Error('견적서 열 연결을 확인해주세요.');
  if (!template && input.mappings.length) throw new Error('견적서 파일을 먼저 연결해주세요.');
  const used = new Set<number>();
  const mappings = input.mappings.map(raw => {
    const value = record(raw, '열 연결');
    const column = Number(value.column);
    if (typeof value.column !== 'number' || !Number.isInteger(column) || column < 0 || !template || column >= template.headers.length || used.has(column)) throw new Error('견적서 열을 중복 없이 연결해주세요.');
    used.add(column);
    if (typeof value.field !== 'string' || !Object.hasOwn(categoryFields, value.field) || typeof value.required !== 'boolean') throw new Error('열 연결 항목을 확인해주세요.');
    const field = value.field as CategoryField;
    return { column, field, required: value.required, ...(field === 'constant' ? { constant: string(value.constant ?? '', '고정값', 4000, true) } : {}) };
  });
  return { name, categoryId, categoryPath, template, mappings };
}

// This checks a locally configured mapping, not Supplier Hub acceptance.
export function categoryProfileIssues(profile: CategoryProfileInput): string[] {
  const issues: string[] = [];
  if (!profile.categoryId) issues.push('Supplier Hub의 실제 카테고리 번호 미확인');
  if (!profile.template) issues.push('카테고리에 맞는 견적서 양식 미연결');
  else if (!profile.mappings.length) issues.push('견적서 열과 상품 자료 연결 필요');
  return issues;
}

export function mapQuotationRow(profile: CategoryProfileInput, data: Partial<Record<Exclude<CategoryField, 'constant'>, string | number | null>>): { values: (string | number)[]; missing: string[] } {
  const valid = validateCategoryProfile(profile);
  if (!valid.template) throw new Error('견적서 양식을 먼저 연결해주세요.');
  const values: (string | number)[] = valid.template.headers.map(() => '');
  const missing: string[] = [];
  for (const mapping of valid.mappings) {
    const value = mapping.field === 'constant' ? mapping.constant ?? '' : mapping.field === 'categoryId' ? valid.categoryId : data[mapping.field];
    const normalized = value === null || value === undefined ? '' : value;
    if (typeof normalized === 'number' && !Number.isFinite(normalized)) throw new Error('견적서에 유효하지 않은 숫자가 포함되어 있습니다.');
    values[mapping.column] = normalized;
    if (mapping.required && (typeof normalized === 'string' && !normalized.trim())) missing.push(`${mapping.column + 1}열 ${valid.template.headers[mapping.column]}`);
  }
  return { values, missing };
}

/** RFC 4180 quoted fields, embedded newlines, and a UTF-8 BOM are supported. */
export function parseTemplateText(text: string, delimiter: ',' | '\t', headerRow = 1): string[] {
  if (text.length > 2_000_000 || !Number.isInteger(headerRow) || headerRow < 1 || headerRow > 1000) throw new Error('양식 크기 또는 머리글 행 번호를 확인해주세요.');
  const source = text.replace(/^\uFEFF/, '');
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false; let closed = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"') { if (source[index + 1] === '"') { field += '"'; index++; } else { quoted = false; closed = true; } }
      else field += char;
    } else if (char === delimiter || char === '\n' || char === '\r') {
      row.push(field); field = ''; closed = false;
      if (row.length > 200) throw new Error('견적서 열은 최대 200개입니다.');
      if (char !== delimiter) {
        if (char === '\r' && source[index + 1] === '\n') index++;
        rows.push(row); row = [];
        if (rows.length === headerRow) return rows[headerRow - 1];
      }
    } else if (char === '"' && field === '' && !closed) quoted = true;
    else { if (closed || char === '"') throw new Error('CSV 따옴표 구분이 올바르지 않습니다.'); field += char; }
  }
  if (quoted) throw new Error('CSV 따옴표가 닫히지 않았습니다.');
  row.push(field); rows.push(row);
  if (row.length > 200 || rows.length < headerRow) throw new Error('머리글 행을 찾을 수 없습니다.');
  return rows[headerRow - 1];
}
