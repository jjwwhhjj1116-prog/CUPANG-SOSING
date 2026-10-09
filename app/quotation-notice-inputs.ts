import type { QuotationField, QuotationResolverInput, ResolvedQuotation } from '@/app/quotation-schema';
import { savedTextOrFallback } from '@/app/product-content';
import { previousRegistrationMonth, washingPrecautionsText } from '@/app/couplus-registration-defaults';

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
// Exact other-goods notice headings recorded in 64455 Single v188. These
// already have the same source meanings in the recorded board/toothbrush forms.
const otherGoodsInputs: Readonly<Record<string, string>> = {
  '인증/허가 사항': 'noticePermission', '제조국(원산지)': 'noticeCountryOfOrigin',
  '소비자상담 관련 전화번호': 'noticeServiceContact',
};
// Exact 80719 notice meanings used by the former label-only fallback. This
// identity list retires only packages potentially affected by that shortcut.
const basketInputs: Readonly<Record<string, string>> = {
  '품명 및 모델명': 'noticeNameModel', '재질': 'noticeMaterial', '구성품': 'noticeComponents',
  '크기': 'noticeDimensions', '제조자(수입자)': 'noticeManufacturerImporter', '제조국': 'noticeCountryOfOrigin',
  '수입신고 문구 여부': 'noticeImportDeclaration', '품질보증기준': 'noticeQualityAssurance',
  'A/S 책임자와 전화번호': 'noticeServiceContact',
};
const recordedNoticeSources = new Set([...Object.values(inputs), ...Object.values(basketInputs)]);
type NoticeBindingIdentity = {
  noticeBindingRevision?: 'exact-legal-notices-v1';
  noticeSourceBindingRevision?: 'exact-legal-notice-sources-v1';
  noticeOtherGoodsSourceBindingRevision?: 'exact-other-goods-notice-sources-v1';
};

/** Recorded static notices retain their meanings. A captured form must carry
 * the exact named legalPage.notices wire; a matching control title is not proof. */
export function isQuotationLegalNotice(field: QuotationField): boolean {
  if (field.section !== 'legal' || field.visibility !== 'common') return false;
  if (!field.hubWire) return true;
  const wire = field.hubWire;
  return wire.path.length === 2 && wire.path[0] === 'legalPage' && wire.path[1] === 'notices'
    && wire.name === field.label && Boolean(wire.nameKey) && Boolean(wire.valueKey);
}

/** Date/washing corrections change identity only for a changed automatic value.
 * The narrow former sports/basket source scope conservatively requests fresh
 * review, including equal automatic values. Proper notices and manual cells
 * keep their existing fingerprint contract. Newly linked other-goods sources
 * refresh only changed automatic cells; earlier receipts are not rewritten. */
export function quotationNoticeBindingFingerprint(input: Pick<QuotationResolverInput, 'content' | 'settings' | 'product'>, resolved: ResolvedQuotation): NoticeBindingIdentity {
  const identity: NoticeBindingIdentity = {};
  for (const field of resolved.schema.fields) {
    if (!field.hubWire || field.section !== 'legal' || isQuotationLegalNotice(field)) continue;
    const date = ['출시년월', '제조년월'].includes(field.label), washing = field.label === '세탁방법 및 취급시 주의사항';
    if (!date && !washing) continue;
    const stored = input.content.label[date ? 'releaseDate' : 'washingPrecautions'];
    const fallback = date ? input.settings.manufactureDatePreviousMonth ? previousRegistrationMonth(input.product.created_at) : ''
      : washingPrecautionsText(input.settings);
    // An explicit stage-six blank suppresses the former fallback too. An
    // absent source fell through to the same form/schema defaults as today.
    if (stored?.provenance !== 'manual' && !stored?.value && !fallback) continue;
    let previous = stored ? savedTextOrFallback(stored, fallback) : fallback;
    if (field.type === 'select') {
      const choices = field.choices?.filter(choice => choice.value === previous || choice.label === previous) ?? [];
      if (choices.length === 1) previous = choices[0].value;
    }
    if (resolved.rows.some(row => row.included && row.fields[field.id]
      && !row.fields[field.id].source.startsWith('manual-') && row.fields[field.id].value !== previous)) {
      identity.noticeBindingRevision = 'exact-legal-notices-v1';
      break;
    }
  }
  for (const field of resolved.schema.fields) {
    if (!field.hubWire || field.section !== 'legal' || field.visibility !== 'common'
      || field.hubInput || isQuotationLegalNotice(field)
      || ['출시년월', '제조년월', '세탁방법 및 취급시 주의사항'].includes(field.label)) continue;
    const previousSports = field.hubWire.path[0] === 'legalPage' && field.hubWire.name === field.label
      ? inputs[field.label] : undefined;
    const previousId = previousSports ?? basketInputs[field.label] ?? field.id;
    // A conservative fresh-review identity for the narrow former source scope.
    // Equal/empty automatic cells may also refresh; proper notices, unrelated
    // controls and saved quotation overrides retain their package identity.
    if (recordedNoticeSources.has(previousId) && resolved.rows.some(row => row.included
      && row.fields[field.id] && !row.fields[field.id].source.startsWith('manual-'))) {
      identity.noticeSourceBindingRevision = 'exact-legal-notice-sources-v1';
      break;
    }
  }
  for (const field of resolved.schema.fields) {
    if (!field.hubWire || !isQuotationLegalNotice(field) || field.hubInput
      || !Object.hasOwn(otherGoodsInputs, field.label) || field.id === otherGoodsInputs[field.label]) continue;
    // The former unresolved live ID fell through to the captured form default.
    // Existing canonical IDs already used the correct source and stay stable.
    const previousValue = field.draftDefault ?? field.schemaDefault ?? '';
    const previousSource = field.draftDefault !== undefined ? 'couplus-default' : field.schemaDefault !== undefined ? 'schema' : 'empty';
    if (resolved.rows.some(row => row.included && row.fields[field.id]
      && !row.fields[field.id].source.startsWith('manual-')
      && (row.fields[field.id].value !== previousValue || row.fields[field.id].source !== previousSource))) {
      identity.noticeOtherGoodsSourceBindingRevision = 'exact-other-goods-notice-sources-v1';
      break;
    }
  }
  return identity;
}

export function quotationNoticeInput(field: QuotationField): string | undefined {
  // Only the named legal notice array has this meaning. Same-labelled product
  // attributes, scalar controls and similar notice names keep their own rules.
  if (!field.hubWire || !isQuotationLegalNotice(field)) return undefined;
  return inputs[field.label] ?? fashionInputs[field.label] ?? (Object.hasOwn(otherGoodsInputs, field.label) ? otherGoodsInputs[field.label] : undefined);
}
