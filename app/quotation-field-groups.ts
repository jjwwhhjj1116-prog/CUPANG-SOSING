import type { QuotationField } from '@/app/quotation-schema';
import { quotationPriceEditInput, quotationPriceVisibleFields } from '@/app/quotation-price-edits';
const basicOrder = ['brand','manufacturer','tradeType','taxType','importType','searchTags','model'];
function imageRole(field: QuotationField): string {
  const wire=field.hubWire;
  if(['mainImage','additionalImages','labelImages','detailImages','detailHtml','altText'].includes(field.id))return field.id;
  if(field.type==='images'&&JSON.stringify(wire?.path)===JSON.stringify(['imagePage','images','labelImages'])
    &&wire?.name&&wire.nameKey==='labelImageType'&&wire.valueKey==='labelImageFiles')return 'labelImages';
  if(wire?.name!==undefined||wire?.nameKey!==undefined||wire?.valueKey!==undefined)return '';
  const path=JSON.stringify(wire?.path);
  if(field.type==='images'&&field.hubInput==='sizeImages'&&path===JSON.stringify(['imagePage','images','sizeChartImage']))return 'sizeImages';
  return '';
}
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
    const role=imageRole(field);
    if (role === 'labelImages') return '라벨 이미지';
    return ['mainImage','additionalImages','sizeImages'].includes(role) ? '기본 이미지' : '상세 정보';
  }
  if (field.section === 'legal') {
    if (field.id === 'kcMarkType') return '기본 법적 정보';
    return ['kcCertificationNumber','emcCertificationNumber','safetyDeclarationNumber','kcsCertificationNumber'].includes(field.id) ? '인증 정보' : '상품 고시 정보';
  }
  return '';
}

/** Match the observed continuous form without mutating the source schema.
 * Unknown fields retain their relative order after the known inputs. */
export function quotationSectionDisplayFields(fields:readonly QuotationField[],section:QuotationField['section']):QuotationField[]{
  const visible=quotationPriceVisibleFields(fields).filter(field=>field.section===section);
  if(section!=='product'&&section!=='image')return visible;
  const groups=section==='product'?['기본 정보','가격 정보','노출 속성','비노출 속성','원본 Excel 추가 항목']:['기본 이미지','라벨 이미지','상세 정보','원본 Excel 추가 항목'];
  return visible.map((field,index)=>{
    const group=quotationFieldGroup(field,fields);
    let order=0;
    if(group==='기본 정보')order=basicOrder.includes(field.id)?basicOrder.indexOf(field.id):basicOrder.length;
    if(section==='image'){
      const role=imageRole(field),known=['mainImage','additionalImages','sizeImages','labelImages','detailImages','detailHtml','altText'];
      order=known.includes(role)?known.indexOf(role):known.length;
    }
    if(group==='가격 정보'){
      let input:string|null=null;
      try{input=quotationPriceEditInput(fields,field.id);}catch{/* Ambiguous prices keep their original identity and stay visible. */}
      const role=input??field.hubInput??field.id;
      const independentOsrp=field.hubWire?.path[0]==='productPage'&&field.hubWire.path[1]==='commonAttributes'&&field.hubWire.path[2]==='osrp';
      order=role==='supplyPrice'?0:role==='salePrice'?1:field.id==='barcodeMode'?2:role==='barcode'?3:independentOsrp?5:role==='msrp'?4:6;
    }
    return{field,index,group:groups.includes(group)?groups.indexOf(group):groups.length,order};
  }).sort((left,right)=>left.group-right.group||left.order-right.order||left.index-right.index).map(item=>item.field);
}
