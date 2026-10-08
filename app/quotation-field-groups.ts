import type { QuotationField } from '@/app/quotation-schema';
import { quotationPriceEditInput } from '@/app/quotation-price-edits';
/** Subsection names observed in the supplied Couplus quotation screens. */
export function quotationFieldGroup(field: QuotationField, fields?: readonly QuotationField[]): string {
  if (field.section === 'product') {
    if (field.visibility === 'exposed') return '노출 속성';
    if (field.visibility === 'hidden') return '비노출 속성';
    let exactPrice = false;
    if (fields) try { exactPrice = quotationPriceEditInput(fields, field.id) !== null; } catch { /* Ambiguous controls keep their original grouping. */ }
    const osrp = fields?.filter(item => item.hubWire?.path.length === 3 && item.hubWire.path[0] === 'productPage'
      && item.hubWire.path[1] === 'commonAttributes' && item.hubWire.path[2] === 'osrp'
      && item.hubWire.name === undefined && item.hubWire.nameKey === undefined && item.hubWire.valueKey === undefined);
    const independentPrice = osrp?.length === 1 && osrp[0].id === field.id && field.hubInput === 'msrp'
      && (field.numericText || field.type === 'number') && !field.readOnly;
    return exactPrice || independentPrice || ['supplyPrice','salePrice','msrp','barcodeMode','barcode'].includes(field.id) ? '가격 정보' : '기본 정보';
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
