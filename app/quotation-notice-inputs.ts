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
// Exact fashion notice names observed in Single 69900 v188 / Excel v191.
// Their saved stage-six values are sources, not inferred category defaults.
const fashionInputs: Readonly<Record<string,string>> = {
  '종류':'noticeKind', '소재':'noticeMaterial', '치수':'noticeDimensions', '취급시 주의사항':'noticeCaution',
};

export function quotationNoticeInput(field: QuotationField): string | undefined {
  // Only the named legal notice array has this meaning. Same-labelled product
  // attributes, scalar controls and similar notice names keep their own rules.
  if(field.section !== 'legal' || field.visibility !== 'common'
    || field.hubWire?.path[0] !== 'legalPage' || field.hubWire.name !== field.label)return undefined;
  return inputs[field.label] ?? (field.hubWire.path.length===2 && field.hubWire.path[1]==='notices'
    ? fashionInputs[field.label] : undefined);
}
