import { labelFields, type ProductContent } from '@/app/product-content';
import type { ProductOptions } from '@/app/product-options';

export type DocumentImageSection = 'label' | 'size';
export type DocumentImagePlan = { title: string; subtitle: string; width: number; columnWidths: number[]; headers: string[]; rows: string[][]; footer: string };
export const MAX_DOCUMENT_HEIGHT = 12000;
export const MAX_SIZE_ROWS = 60;
export function documentImagePlan(section: DocumentImageSection, content: ProductContent, options: ProductOptions): DocumentImagePlan {
  if (content.productId !== options.productId) throw new Error('상품 자료가 일치하지 않습니다.');
  if (section === 'label') {
    if (!Object.values(content.label).some(field => field.value.trim())) throw new Error('표시사항을 한 항목 이상 저장한 후 이미지를 만들어주세요.');
    return { title: '한글 표시사항 · 검토용', subtitle: '저장한 입력값으로 만든 문서 이미지입니다. 빈 항목은 미입력으로 표시합니다.',
      width: 1200, columnWidths: [260, 860], headers: ['항목', '저장한 내용'],
      rows: Object.entries(labelFields).map(([key, name]) => [name, content.label[key as keyof typeof labelFields].value.trim() || '[미입력]']),
      footer: '카테고리별 법정 표시사항의 완결성과 상품 일치 여부를 검토해주세요. AI 생성·번역을 실행하지 않았습니다.' };
  }
  const selected = options.rows.filter(row => row.included);
  if (!selected.length) throw new Error('견적에 포함할 옵션을 저장한 후 사이즈표를 만들어주세요.');
  if (selected.length > MAX_SIZE_ROWS) throw new Error(`한 장에는 최대 ${MAX_SIZE_ROWS}개 옵션을 넣을 수 있습니다. 포함 옵션 수를 줄여주세요.`);
  if (!selected.some(row => [row.widthCm, row.lengthCm, row.heightCm, row.weightKg].some(value => value !== null))) throw new Error('선택 옵션에 저장한 치수·무게가 없습니다. 확인한 값을 먼저 저장해주세요.');
  const value = (number: number | null) => number === null ? '[미입력]' : String(number);
  return { title: '옵션 사이즈표 · 검토용', subtitle: '견적에 포함한 옵션의 저장값입니다. 단위와 실제 측정값을 확인해주세요.',
    width: 1440, columnWidths: [520, 168, 168, 168, 168, 168], headers: ['옵션명', '가로 cm', '세로 cm', '높이 cm', '무게 kg', '구성 수량'],
    rows: selected.map(row => [row.translatedName || row.originalName || row.supplierSku, value(row.widthCm), value(row.lengthCm), value(row.heightCm), value(row.weightKg), String(row.unitsPerPack)]),
    footer: '미입력 치수는 추정하지 않았습니다. 무게는 옵션에 저장한 판매 단위 기준이며 실측 검증이 필요합니다.' };
}
export function wrapDocumentText(text: string, maxWidth: number, measure: (value: string) => number): string[] {
  if (!(maxWidth > 0)) throw new Error('텍스트 영역 폭을 확인해주세요.');
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const character of [...paragraph]) {
      if (line && measure(line + character) > maxWidth) { lines.push(line); line = character; }
      else line += character;
    }
    lines.push(line);
  }
  return lines;
}
