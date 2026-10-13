import { quotationValueIssues, type QuotationField, type QuotationSchema, type ResolvedQuotationField } from '@/app/quotation-schema';

type Cell = Pick<ResolvedQuotationField, 'value' | 'source'>;
type ReadCell = (id: string, optionId?: string | null) => Cell | undefined;
export type QuotationModelSuggestionScope = { optionId: string | null; optionIds: readonly (string | null)[] };
export type QuotationModelSuggestion = {
  fieldId: string; titleFieldId: string; sourceTitle: string; source: Cell['source']; value: string; shortened: boolean;
  changes: { fieldKey: string; value: string }[];
  peer?: { fieldId: string; label: string; before: string; source: Cell['source']; changed: boolean };
};
const modelPath = ['productPage', 'modelNumber'], titlePath = ['startPage', 'productName'];
const samePath = (field: QuotationField, path: readonly string[]) => JSON.stringify(field.hubWire?.path) === JSON.stringify(path);
const bareWire = (field: QuotationField) => field.hubWire?.name === undefined && field.hubWire?.nameKey === undefined && field.hubWire?.valueKey === undefined;

function exactField(fields: readonly QuotationField[], input: 'model' | 'title', path: readonly string[], section: QuotationField['section']) {
  const candidates = fields.filter(field => field.id === input || field.hubInput === input || samePath(field, path));
  if (candidates.length !== 1) return null;
  const field = candidates[0];
  if (field.section !== section || field.visibility !== 'common' || field.type !== 'text'
    || field.numericText || field.numericValue || field.choices || field.contentField || field.optionDimension
    || field.workbookWire || field.hubInput && field.hubInput !== input) return null;
  if (field.hubWire ? !samePath(field, path) || !bareWire(field) : field.id !== input) return null;
  return field;
}
function wellFormed(value: string) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** Couplus fills missing modelNumber from the final name before transmission.
 * Offer that value as an explicit editor action instead: resolving or exporting
 * a quotation never replaces an untouched or deliberately cleared model cell.
 */
export function quotationModelSuggestionState(schema: QuotationSchema, fieldId: string, readCell: ReadCell, scope?: QuotationModelSuggestionScope): { suggestion: QuotationModelSuggestion | null; reason: string | null } {
  const absent = { suggestion: null, reason: null }, blocked = (reason: string) => ({ suggestion: null, reason });
  if (schema.status !== 'observed' || schema.unsupportedFields?.length) return absent;
  const field = exactField(schema.fields, 'model', modelPath, 'product'), title = exactField(schema.fields, 'title', titlePath, 'start');
  if (!field || !title || field.id !== fieldId || field.readOnly) return absent;
  // A captured form may omit either control. Left-over common summary fields
  // cannot stand in for an absent Hub wire merely because their IDs match.
  if (schema.fields.some(item => item.hubWire) && (!field.hubWire || !title.hubWire)) return absent;
  const model = readCell(field.id), source = readCell(title.id);
  if (!model || model.value.trim() || !source || !source.value.trim() || !wellFormed(source.value)
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(source.value)
    || quotationValueIssues(title, source.value).length) return absent;
  const sourceTitle = source.value.trim();
  let value = sourceTitle.slice(0, 50);
  // String.slice can bisect an emoji at the public 50-UTF-16-unit boundary.
  // Remove only that dangling surrogate rather than saving a corrupt character.
  const end = value.charCodeAt(value.length - 1);
  if (end >= 0xd800 && end <= 0xdbff) value = value.slice(0, -1);
  if (!value.trim() || quotationValueIssues(field, value).length) return absent;
  const result: QuotationModelSuggestion = { fieldId: field.id, titleFieldId: title.id, sourceTitle, source: source.source, value,
    shortened: value.length < sourceTitle.length, changes: [{ fieldKey: field.id, value }] };
  // Single's modelNumber and the recorded official Excel model column share
  // one stage-six model source, but remain independently editable cells. Fill
  // only this exact peer; never create mappings or infer an Excel column by name.
  const candidates = schema.fields.filter(item => item !== field && (item.contentField === 'model'
    || item.section === 'product' && item.visibility === 'hidden' && item.label === '모델명/품번'));
  if (!candidates.length) return { suggestion: result, reason: null };
  const peer = candidates.length === 1 ? candidates[0] : null;
  if (!peer || peer.section !== 'product' || peer.visibility !== 'hidden' || peer.type !== 'text' || peer.readOnly
    || peer.contentField !== 'model' || peer.label !== '모델명/품번' || peer.numericText || peer.numericValue || peer.choices || peer.workbookWire || peer.hubInput || peer.optionDimension
    || !samePath(peer, ['productPage', 'unexposedAttributes']) || peer.hubWire?.name !== '모델명/품번'
    || peer.hubWire.nameKey !== 'attributeName' || peer.hubWire.valueKey !== 'attributeValue' || quotationValueIssues(peer, value).length)
    return blocked('공식 견적 모델 항목의 연결·입력 규칙을 하나로 확인하지 못했습니다. 모델명과 모델명/품번을 직접 확인해주세요.');
  if (!scope || !Array.isArray(scope.optionIds) || scope.optionIds.length > 200 || new Set(scope.optionIds).size !== scope.optionIds.length)
    return blocked('모델명을 적용할 옵션 범위를 확인하지 못했습니다. 현재 견적 입력을 다시 확인해주세요.');
  const peerCell = readCell(peer.id);
  if (!peerCell) return blocked('공식 견적 모델명/품번의 현재 입력을 확인하지 못했습니다. 두 모델 항목을 직접 확인해주세요.');
  const changePeer = peerCell.value !== value;
  if (changePeer && (peerCell.value.trim() || peerCell.source.startsWith('manual-')))
    return blocked('모델명/품번에 별도 입력값 또는 직접 비운 값이 있습니다. 기존 값을 유지했습니다. 두 모델 항목을 직접 확인해주세요.');
  if (scope.optionId === null) {
    for (const optionId of scope.optionIds.filter(id => id !== null)) {
      const modelCell = readCell(field.id, optionId), optionPeer = readCell(peer.id, optionId);
      if (!modelCell || !optionPeer) return blocked('옵션별 모델 입력을 확인하지 못했습니다. 현재 견적 입력을 다시 확인해주세요.');
      const afterModel = modelCell.source === 'manual-option' ? modelCell.value : value;
      const afterPeer = optionPeer.source === 'manual-option' ? optionPeer.value : changePeer ? value : optionPeer.value;
      if (afterModel !== afterPeer)
        return blocked('옵션별 모델명 또는 모델명/품번에 별도 값·직접 공란이 있습니다. 공통 제안으로 덮지 않았습니다. 해당 옵션에서 두 모델 항목을 확인해주세요.');
    }
  }
  if (changePeer) result.changes.push({ fieldKey: peer.id, value });
  result.peer = { fieldId: peer.id, label: peer.label, before: peerCell.value, source: peerCell.source, changed: changePeer };
  return { suggestion: result, reason: null };
}

export function quotationModelSuggestion(schema: QuotationSchema, fieldId: string, readCell: ReadCell, scope?: QuotationModelSuggestionScope): QuotationModelSuggestion | null {
  return quotationModelSuggestionState(schema, fieldId, readCell, scope).suggestion;
}
