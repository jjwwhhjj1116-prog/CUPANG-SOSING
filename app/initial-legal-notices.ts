import type { QuotationField, QuotationSchema } from '@/app/quotation-schema';
import { hubProductSchemas } from '@/app/hub-product-schemas';
import { couplus81221Fields } from '@/app/couplus-glove-schema';
import { couplus103495Fields } from '@/app/couplus-marathon-schema';
import { couplus64497Fields } from '@/app/couplus-toothbrush-schema';
import { couplus77442Fields } from '@/app/couplus-board-schema';
import { couplus81452Fields } from '@/app/couplus-brace-schema';
import { previousRegistrationMonth, washingPrecautionsText } from '@/app/couplus-registration-defaults';

export type InitialLegalNotices = {
  format: 'couplus-initial-legal-notices-v1'; categoryId: string; categoryPath: string[];
  fields: { fieldId: string; signature: string; value: string; source: 'couplus-default' | 'settings' }[];
};
const basketNotices = [
  ['noticeNameModel', '품명 및 모델명'], ['noticeMaterial', '재질'], ['noticeComponents', '구성품'],
  ['noticeDimensions', '크기'], ['noticeReleaseDate', '출시년월'], ['noticeManufacturerImporter', '제조자(수입자)'],
  ['noticeCountryOfOrigin', '제조국'], ['noticeImportDeclaration', '수입신고 문구 여부'],
  ['noticeQualityAssurance', '품질보증기준'], ['noticeServiceContact', 'A/S 책임자와 전화번호'],
] as const;
const recorded: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  ...Object.fromEntries(Object.entries(hubProductSchemas).map(([id, schema]) => [id, schema.notices.map(field => [field.id, field.label])])),
  ...Object.fromEntries(Object.entries({ '81221': couplus81221Fields, '103495': couplus103495Fields,
    '64497': couplus64497Fields, '77442': couplus77442Fields, '81452': couplus81452Fields })
    .map(([id, fields]) => [id, fields.filter(field => field.section === 'legal' && field.visibility === 'common').map(field => [field.id, field.label])])),
  '80719': basketNotices,
};
function noticeFields(schema: QuotationSchema): QuotationField[] {
  if (!schema.categoryId || schema.status !== 'observed') return [];
  return schema.fields.filter(field => {
    if (field.section !== 'legal' || field.visibility !== 'common' || field.readOnly || !['text', 'textarea', 'select'].includes(field.type)) return false;
    if (field.hubWire) {
      const wire = field.hubWire;
      return wire.path.length === 2 && wire.path[0] === 'legalPage' && wire.path[1] === 'notices'
        && wire.name === field.label && typeof wire.nameKey === 'string' && !!wire.nameKey
        && typeof wire.valueKey === 'string' && !!wire.valueKey;
    }
    return Object.hasOwn(recorded, schema.categoryId!) && recorded[schema.categoryId!].some(([id, label]) => field.id === id && field.label === label);
  });
}
const settingsEligible = (field: QuotationField) => !field.hubWire
  || field.hubWire.nameKey === 'noticeItemName' && field.hubWire.valueKey === 'noticeItemValue';
const safeText = (value: unknown): value is string => typeof value === 'string' && value.length <= 2000
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(',') === [...keys].sort().join(',');

/** Initial named-array values are independent of later supplier/SEO/label text. */
export function createInitialLegalNotices(schema: QuotationSchema, settings: unknown, referenceTime: string): InitialLegalNotices | undefined {
  const fields = noticeFields(schema);
  if (!fields.length) return;
  const stored = object(settings) ? settings : {}, washing = washingPrecautionsText(stored);
  const date = stored.manufactureDatePreviousMonth === true ? previousRegistrationMonth(referenceTime) : '';
  const firstDate = fields.find(field => settingsEligible(field) && ['출시년월', '제조년월'].includes(field.label))?.id;
  return { format: 'couplus-initial-legal-notices-v1', categoryId: schema.categoryId!, categoryPath: [...schema.categoryPath],
    fields: fields.map(field => {
      const setting = !settingsEligible(field) ? undefined : field.label === 'A/S 책임자와 전화번호' && safeText(stored.serviceContact) && stored.serviceContact
        ? stored.serviceContact : field.label === '세탁방법 및 취급시 주의사항' && washing ? washing
          : field.id === firstDate && date ? date : undefined;
      return { fieldId: field.id, signature: JSON.stringify(field), value: setting ?? '해당사항없음', source: setting === undefined ? 'couplus-default' : 'settings' };
    }) };
}

/** Missing, damaged or differently classified snapshots retain the legacy resolver. */
export function readInitialLegalNotices(value: unknown, schema: QuotationSchema): Map<string, { value: string; source: 'couplus-default' | 'settings' }> {
  const empty = () => new Map<string, { value: string; source: 'couplus-default' | 'settings' }>();
  if (!object(value) || !exact(value, ['format', 'categoryId', 'categoryPath', 'fields']) || value.format !== 'couplus-initial-legal-notices-v1'
    || value.categoryId !== schema.categoryId || JSON.stringify(value.categoryPath) !== JSON.stringify(schema.categoryPath) || !Array.isArray(value.fields)) return empty();
  const fields = noticeFields(schema);
  if (!fields.length || fields.length !== value.fields.length) return empty();
  const result = empty(); let dateSettings = 0;
  const firstDate = fields.find(field => settingsEligible(field) && ['출시년월', '제조년월'].includes(field.label))?.id;
  for (const [index, field] of fields.entries()) {
    const entry = value.fields[index];
    if (!object(entry) || !exact(entry, ['fieldId', 'signature', 'value', 'source']) || entry.fieldId !== field.id || entry.signature !== JSON.stringify(field)
      || !safeText(entry.value) || result.has(field.id) || entry.source !== 'couplus-default' && entry.source !== 'settings') return empty();
    if (entry.source === 'couplus-default' && entry.value !== '해당사항없음') return empty();
    if (entry.source === 'settings') {
      if (!settingsEligible(field) || !entry.value || !['A/S 책임자와 전화번호', '세탁방법 및 취급시 주의사항', '출시년월', '제조년월'].includes(field.label)) return empty();
      if (['출시년월', '제조년월'].includes(field.label)) {
        if (++dateSettings > 1 || field.id !== firstDate || !/^\d{4}\.(?:0[1-9]|1[0-2])$/u.test(entry.value)) return empty();
      }
    }
    result.set(field.id, { value: entry.value, source: entry.source as 'couplus-default' | 'settings' });
  }
  return result;
}
