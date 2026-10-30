import type { QuotationField } from '@/app/quotation-schema';
import { quotationPriceEditInput, quotationPriceVisibleFields } from '@/app/quotation-price-edits';
/** Subsection names observed in the supplied Couplus quotation screens. */
export function quotationFieldGroup(field: QuotationField, fields?: readonly QuotationField[]): string {
  if(field.workbookWire)return '원본 Excel 추가 항목';
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
    const exactBarcode=field.hubInput==='barcode'&&!field.hubWire?.name
      &&JSON.stringify(field.hubWire?.path)===JSON.stringify(['productPage','commonAttributes','productBarcode']);
    return exactPrice || independentPrice || exactBarcode || ['supplyPrice','salePrice','msrp','barcodeMode','barcode'].includes(field.id) ? '가격 정보' : '기본 정보';
  }
  if (field.section === 'image') {
    if (field.id === 'labelImages') return '라벨 이미지';
    if(field.type==='images'&&field.hubInput==='sizeImages'&&!field.hubWire?.name
      &&JSON.stringify(field.hubWire?.path)===JSON.stringify(['imagePage','images','sizeChartImage']))return '기본 이미지';
    return ['mainImage','additionalImages'].includes(field.id) ? '기본 이미지' : '상세 정보';
  }
  if (field.section === 'legal') {
    if (field.id === 'kcMarkType') return '기본 법적 정보';
    return ['kcCertificationNumber','emcCertificationNumber','safetyDeclarationNumber','kcsCertificationNumber'].includes(field.id) ? '인증 정보' : '상품 고시 정보';
  }
  return '';
}

/** Group the continuous product form without changing schema order or field
 * identity. Raw Hub schemas can interleave prices, attributes and basic fields.
 * Preserve their order within each group, with supply/sale/MSRP before barcode. */
export function quotationSectionDisplayFields(fields:readonly QuotationField[],section:QuotationField['section']):QuotationField[]{
  const visible=quotationPriceVisibleFields(fields).filter(field=>field.section===section);
  if(section!=='product')return visible;
  const groups=['기본 정보','가격 정보','노출 속성','비노출 속성','원본 Excel 추가 항목'];
  return visible.map((field,index)=>{
    const group=quotationFieldGroup(field,fields);
    let price=4;
    if(group==='가격 정보'){
      let input:string|null=null;
      try{input=quotationPriceEditInput(fields,field.id);}catch{/* Ambiguous prices keep their original identity and stay visible. */}
      const role=input??field.hubInput??field.id;
      const independentOsrp=field.hubWire?.path[0]==='productPage'&&field.hubWire.path[1]==='commonAttributes'&&field.hubWire.path[2]==='osrp';
      price=independentOsrp?3:role==='supplyPrice'?0:role==='salePrice'?1:role==='msrp'?2:field.id==='barcodeMode'?5:role==='barcode'?6:4;
    }
    return{field,index,group:groups.includes(group)?groups.indexOf(group):groups.length,price};
  }).sort((left,right)=>left.group-right.group||left.price-right.price||left.index-right.index).map(item=>item.field);
}
