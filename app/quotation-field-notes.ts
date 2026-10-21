import type { QuotationField } from '@/app/quotation-schema';

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

/** Only the reference form's named attribute, certification and notice rows
 * use a fixed name input beside the editable value. Similar custom arrays and
 * attachment controls must keep their existing form. */
export function quotationUsesNamedPair(field: QuotationField) {
  const wire = field.hubWire;
  if (!wire?.name || !wire.nameKey || !wire.valueKey || field.type === 'images') return false;
  const path = wire.path;
  const generic = wire.nameKey === 'name' && wire.valueKey === 'value';
  if (field.section === 'product' && path[0] === 'productPage'
    && (path.length === 2 && ['commonAttributes', 'exposedAttributes', 'unexposedAttributes'].includes(path[1])
      || path.length === 3 && path[1] === 'commonAttributes' && ['exposedAttributes', 'unexposedAttributes'].includes(path[2])))
    return generic || wire.nameKey === 'attributeName' && wire.valueKey === 'attributeValue';
  if (field.section !== 'legal' || path.length !== 2 || path[0] !== 'legalPage') return false;
  return path[1] === 'certificates' && (generic || wire.nameKey === 'certificateName' && wire.valueKey === 'certificateValue')
    || path[1] === 'notices' && (generic || wire.nameKey === 'noticeItemName' && wire.valueKey === 'noticeItemValue');
}
