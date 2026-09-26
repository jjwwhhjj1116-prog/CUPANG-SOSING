import type { QuotationField } from '@/app/quotation-schema';
/** Subsection names observed in the supplied Couplus quotation screens. */
export function quotationFieldGroup(field: QuotationField): string {
  if (field.section === 'product') {
    if (field.visibility === 'exposed') return '노출 속성';
    if (field.visibility === 'hidden') return '비노출 속성';
    return ['supplyPrice','salePrice','msrp','barcodeMode','barcode'].includes(field.id) ? '가격 정보' : '기본 정보';
  }
  if (field.section === 'image') {
    if (field.id === 'labelImages') return '라벨 이미지';
    return ['mainImage','additionalImages'].includes(field.id) ? '기본 이미지' : '상세 정보';
  }
  if (field.section === 'legal') {
    if (field.id === 'kcMarkType') return '기본 법적 정보';
    return ['kcCertificationNumber','emcCertificationNumber','safetyDeclarationNumber','kcsCertificationNumber'].includes(field.id) ? '인증 정보' : '상품 고시 정보';
  }
  return '';
}
