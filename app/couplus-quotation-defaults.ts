import { hubProductSchemas } from '@/app/hub-product-schemas';
import { couplus81221Fields } from '@/app/couplus-glove-schema';
import { couplus103495Fields } from '@/app/couplus-marathon-schema';
import { couplus64497Fields } from '@/app/couplus-toothbrush-schema';
import { couplus77442Fields } from '@/app/couplus-board-schema';
import { couplus81452Fields } from '@/app/couplus-brace-schema';

// User-supplied Couplus screenshots 14–23, category 80719 only.
// Stage-six defaults are reviewable draft text, not verified product facts.
export function couplusLabelDefaults(categoryId: string | null): Readonly<Record<string, string>> {
  return categoryId === '80719' ? {
    countryOfOrigin: '중국', precautions: '용도 외에 사용금지. 파손및화기주의', usageStandard: '14세이상',
  } : {};
}
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
type DraftField = { id: string; section?: string; visibility?: string; choices?: readonly {value:string;label:string}[]; draftDefault?:string; hubWire?:unknown };
const recordedArrays: Readonly<Record<string, ReadonlySet<string>>> = {
  ...Object.fromEntries(Object.entries(hubProductSchemas).map(([id, schema]) => [id,
    new Set([...schema.exposed, ...schema.hidden, ...schema.notices].map(field => field.id))])),
  ...Object.fromEntries(Object.entries({ '81221': couplus81221Fields, '103495': couplus103495Fields,
    '64497': couplus64497Fields, '77442': couplus77442Fields, '81452': couplus81452Fields })
    .map(([id, fields]) => [id, new Set(fields.map(field => field.id))])),
  '80719': notApplicable80719,
};

/** Couplus's public schema initializer uses N/A for named arrays, null for hidden attributes.
 * Our editable string model encodes null as an empty wire value, never the text "null".
 * Only recorded category fields participate; missing schemas remain unconfirmed.
 */
export function couplusQuotationDefault(categoryId:string|null,field:DraftField):string|undefined {
  if(field.draftDefault!==undefined)return field.draftDefault;
  if(field.hubWire)return undefined;
  if (categoryId && Object.hasOwn(recordedArrays, categoryId) && recordedArrays[categoryId].has(field.id)) {
    if (field.section === 'product' && field.visibility === 'hidden') return '';
    if (field.section === 'product' && field.visibility === 'exposed') return '해당사항없음';
    if (field.section === 'legal') return '해당사항없음';
  }
  // Scalar/image/logistics defaults remain limited to the directly observed form.
  if(categoryId!=='80719')return undefined;
  if(Object.hasOwn(fixed80719,field.id))return fixed80719[field.id];
  if(!notApplicable80719.has(field.id))return undefined;
  // Supplier Hub selects encode the visible N/A choice as an empty string.
  return field.choices?.find(choice=>choice.label==='해당사항없음')?.value ?? '해당사항없음';
}

/** A default null hidden attribute displays N/A; a user-cleared text value stays blank. */
export function hasCouplusEmptyAttributeDefault(field: DraftField, cell: {value: string; source: string}) {
  return field.section === 'product' && field.visibility === 'hidden'
    && cell.source === 'couplus-default' && cell.value === '';
}
