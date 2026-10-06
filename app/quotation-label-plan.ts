import type { QuotationSchema, ResolvedQuotation } from '@/app/quotation-schema';
import type { DocumentImagePlan } from '@/app/document-image';
import { quotationFieldDisplay } from '@/app/quotation-field-display';

/** Live option attributes retain wire-specific IDs instead of color/size IDs. */
export function quotationLabelFields(schema: QuotationSchema) {
  const identity = new Set(['title', 'model', 'brand', 'manufacturer', 'color', 'quantity', 'size']);
  return schema.fields.filter(field => identity.has(field.id) || field.section === 'legal'
    || field.section === 'product' && field.visibility === 'exposed' && field.hubWire?.name
      && field.hubWire.path.length === 3 && field.hubWire.path[0] === 'productPage'
      && field.hubWire.path[1] === 'commonAttributes' && field.hubWire.path[2] === 'exposedAttributes');
}

/** Use resolved cells, so option overrides and deliberately cleared values survive. */
export function quotationLabelPlan(resolved: ResolvedQuotation, optionId: string | null): DocumentImagePlan {
  const row = resolved.rows.find(item => item.optionId === optionId);
  if (!row || !row.included) throw new Error('견적에 포함된 옵션을 선택해주세요.');
  if (!resolved.schema.categoryId) throw new Error('카테고리를 먼저 선택해주세요.');
  const fields = quotationLabelFields(resolved.schema);
  if (!fields.some(field => row.fields[field.id]?.value.trim())) throw new Error('견적 값을 저장한 후 표시사항 PNG를 만들어주세요.');
  return {
    title: '견적 기준 표시사항 · 검토용',
    subtitle: `${resolved.schema.categoryPath.join(' > ')}\n${row.optionLabel} · ${row.optionId ?? '상품 공통'}`,
    width: 1200, columnWidths: [360, 760], headers: ['항목', '최종 저장값'],
    rows: [...fields.map(field => {
      return [field.label, quotationFieldDisplay(field, row.fields[field.id] ?? {value:'',source:'empty'})];
    }), ...(resolved.customLabels ?? []).filter(label => label.visible).map(label => [label.name, label.value.trim() ? label.value : '[공란]'])],
    footer: '선택한 옵션의 저장된 견적 값입니다. 공란은 추정하지 않았습니다. 실제 제품 라벨의 법정 항목·증빙·내용 일치 여부를 별도로 확인해주세요. 이 이미지는 Supplier Hub에 첨부·전송되지 않았습니다.',
  };
}
