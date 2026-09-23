// User-supplied Couplus quotation screenshots 15–23, category 80719 only.
// These are form defaults, not verified facts about the sourced product.
const notApplicable80719 = new Set([
  'color','quantity','size','lidIncluded','heightAdjustable','basketShape','storageMaterial',
  'totalQuantity','width','handleIncluded','foldable','weight','transparent','storageShape',
  'ventilationFan','storageMethod','storageAvailable','storageLocation','shelfLevels','basketUse',
  'shelfShape','widthAdjustable','assemblyRequired','sliding','kitchenShelfUse','finishType',
  'itemHeight','includedComponents','gtin','parentManufacturerPartNumber','manufacturerPartNumber',
  'kcMarkType','kcCertificationNumber','emcCertificationNumber','safetyDeclarationNumber','kcsCertificationNumber',
  'noticeNameModel','noticeMaterial','noticeComponents','noticeDimensions','noticeReleaseDate',
  'noticeManufacturerImporter','noticeCountryOfOrigin','noticeImportDeclaration','noticeQualityAssurance',
  'handlingReason',
]);
const fixed80719: Readonly<Record<string,string>> = {
  taxType:'과세', barcodeMode:'request-coupang', shelfLifeDays:'0',
  noticeServiceContact:'쿠팡 고객센터 1577-7011',
};
export function couplusQuotationDefault(categoryId:string|null,field:{id:string;choices?:{value:string;label:string}[]}):string|undefined {
  if(categoryId!=='80719')return undefined;
  if(Object.hasOwn(fixed80719,field.id))return fixed80719[field.id];
  if(!notApplicable80719.has(field.id))return undefined;
  // Supplier Hub selects encode the visible N/A choice as an empty string.
  return field.choices?.find(choice=>choice.label==='해당사항없음')?.value ?? '해당사항없음';
}
