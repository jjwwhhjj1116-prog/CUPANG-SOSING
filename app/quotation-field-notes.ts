import type { QuotationField } from '@/app/quotation-schema';
import { couplusQuotationInput, type CouplusQuotationInput } from '@/app/couplus-quotation-inputs';

/** These exact reminders repeat on ordinary populated fields. Keep all other
 * source warnings and every validation error beside the input. */
const diagnosticReminders = new Set([
  '쿠플러스 참조 화면의 양식 기본값입니다. 실제 상품의 해당 여부를 확인해주세요.',
  '실제 상품·증빙과 일치하는지 확인해주세요.',
  '견적서에는 연결한 첨부 이미지 파일명이 기록됩니다. 실제 상품과 이미지 구성을 확인해주세요.',
]);

export function quotationFieldIssueNotes(issues: readonly string[], validationIssues: readonly string[] = []) {
  const validation = new Set(validationIssues);
  const visible: string[] = [], diagnostic: string[] = [];
  for (const issue of new Set([...issues, ...validationIssues])) {
    (diagnosticReminders.has(issue) && !validation.has(issue) ? diagnostic : visible).push(issue);
  }
  return { visible, diagnostic };
}

/** Pair fixed names only for the reference form's recognized named rows. */
export function quotationUsesNamedPair(field: QuotationField) {
  const wire = field.hubWire;
  if (!wire?.name || !wire.nameKey || !wire.valueKey) return false;
  const path = wire.path;
  if (field.type === 'images') return field.section === 'image' && path.length === 3
    && path[0] === 'imagePage' && path[1] === 'images' && path[2] === 'labelImages'
    && wire.nameKey === 'labelImageType' && wire.valueKey === 'labelImageFiles'
    && wire.name === '제품 한글 표시사항 라벨 또는 도안 이미지';
  const generic = wire.nameKey === 'name' && wire.valueKey === 'value';
  if (field.section === 'product' && path[0] === 'productPage'
    && (path.length === 2 && ['commonAttributes', 'exposedAttributes', 'unexposedAttributes'].includes(path[1])
      || path.length === 3 && path[1] === 'commonAttributes' && ['exposedAttributes', 'unexposedAttributes'].includes(path[2])))
    return generic || wire.nameKey === 'attributeName' && wire.valueKey === 'attributeValue';
  if (field.section !== 'legal' || path.length !== 2 || path[0] !== 'legalPage') return false;
  return path[1] === 'certificates' && (generic || wire.nameKey === 'certificateName' && wire.valueKey === 'certificateValue')
    || path[1] === 'notices' && (generic || wire.nameKey === 'noticeItemName' && wire.valueKey === 'noticeItemValue');
}

const imageFileCaptions: Partial<Record<CouplusQuotationInput, string>> = {
  mainImage: '대표 이미지', additionalImages: '추가 이미지', sizeImages: '사이즈표 이미지', detailImages: '상세 이미지',
};

function exactQuotationImageInput(field: QuotationField) {
  const wire = field.hubWire;
  if (field.section !== 'image' || !wire || wire.name !== undefined || wire.nameKey !== undefined || wire.valueKey !== undefined) return;
  const input = couplusQuotationInput(wire.path);
  if (input === field.id || input === field.hubInput) return input;
}

export function quotationUsesImageFileDisplay(field: QuotationField) {
  if (field.type !== 'images') return false;
  const input = exactQuotationImageInput(field);
  return quotationUsesNamedPair(field) || Boolean(input && imageFileCaptions[input]);
}

export function quotationImageFieldCaption(field: QuotationField) {
  const input = exactQuotationImageInput(field);
  if (input && field.type === 'images') return imageFileCaptions[input] ?? field.label;
  if (input === 'detailHtml' && field.type === 'textarea') return 'HTML 상세 내용';
  if (input === 'altText' && field.type === 'text') return '대체 텍스트';
  return field.label;
}
