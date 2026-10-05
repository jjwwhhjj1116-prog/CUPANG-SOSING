import type { QuotationField } from '@/app/quotation-schema';

// Complete notice names recorded in the sports quotation forms. These are
// source bindings, never inferred product facts or category-specific defaults.
const inputs: Readonly<Record<string,string>> = {
  '제품 구성': 'noticeComponents',
  '색상': 'color',
  '크기, 중량': 'noticeSizeWeight',
  '상품별 세부 사양': 'noticeSpecifications',
  'KC 인증정보': 'noticeKc',
};

export function quotationNoticeInput(field: QuotationField): string | undefined {
  // Only the named legal notice array has this meaning. Same-labelled product
  // attributes, scalar controls and similar notice names keep their own rules.
  return field.section === 'legal' && field.visibility === 'common'
    && field.hubWire?.path[0] === 'legalPage' && field.hubWire.name === field.label
    ? inputs[field.label] : undefined;
}
