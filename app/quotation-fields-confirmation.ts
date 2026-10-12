import { applyQuotationChanges, type QuotationChange, type QuotationFieldsView, type QuotationOverrides } from '@/app/quotation-schema';
import { quotationPackagedWeightManual } from '@/app/quotation-packaged-weight';

const unconfirmed = () => new Error('저장 응답이 요청한 견적 입력과 다릅니다. 직접 수정값을 유지했습니다. 기본값 다시 반영으로 저장본을 확인해주세요.');
function overrideSignature(value: QuotationOverrides): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['common', 'options'].includes(key))) throw unconfirmed();
  const entries = (record: Record<string, string>) => {
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.values(record).some(item => typeof item !== 'string')) throw unconfirmed();
    return Object.keys(record).sort().map(key => [key, record[key]]);
  };
  if (!value.options || typeof value.options !== 'object' || Array.isArray(value.options)) throw unconfirmed();
  return JSON.stringify([entries(value.common), Object.keys(value.options).sort().map(id => [id, entries(value.options[id])])]);
}
function sourceSignature(view: QuotationFieldsView): string {
  return JSON.stringify({ category: view.categoryContext, schema: view.resolved.schema, automaticSchema: view.automatic.schema,
    contentRevision: view.contentRevision, optionRevision: view.optionRevision, imageKeys: view.imageKeys,
    rows: view.resolved.rows.map(row => [row.optionId, row.included, row.optionLabel]),
    automatic: view.automatic.rows.map(row => ({ optionId: row.optionId, included: row.included, optionLabel: row.optionLabel,
      fields: Object.fromEntries(Object.keys(row.fields).sort().map(key => [key, { value: row.fields[key].value, source: row.fields[key].source }])) })),
  });
}
function expectedCell(view: QuotationFieldsView, overrides: QuotationOverrides, optionId: string | null, fieldKey: string) {
  const automatic = view.automatic.rows.find(row => row.optionId === optionId)?.fields[fieldKey];
  if (view.resolved.schema.fields.find(field => field.id === fieldKey)?.readOnly) return automatic;
  const read = (layer: string | null, key: string) => {
    const record = layer === null ? overrides.common : overrides.options[layer];
    return record && Object.hasOwn(record, key) ? record[key] : null;
  };
  const weight = quotationPackagedWeightManual(view.resolved.schema.fields, fieldKey, optionId, read);
  const option = optionId === null ? null : read(optionId, fieldKey), common = read(null, fieldKey);
  return weight ?? (option !== null ? { value: option, source: 'manual-option' } : common !== null ? { value: common, source: 'manual-common' }
    : automatic);
}
function dependentHtml(previous: QuotationFieldsView, overrides: QuotationOverrides, optionId: string | null, fieldKey: string) {
  if (fieldKey !== 'detailHtml' || expectedCell(previous, overrides, optionId, fieldKey)?.source.startsWith('manual-')) return false;
  const changedFrom = (resolved: QuotationFieldsView['resolved']) => ['detailImages', 'altText'].some(key => expectedCell(previous, overrides, optionId, key)?.value
    !== resolved.rows.find(row => row.optionId === optionId)?.fields[key]?.value);
  if (!changedFrom(previous.automatic)) return false;
  return previous.resolved.rows.find(row => row.optionId === optionId)?.fields.detailHtml?.source.startsWith('manual-') || changedFrom(previous.resolved);
}
/** Public HTML depends on the effective image/alt selections. Its signing key
 * belongs to the server, so changed manual dependencies need readback. */
export function quotationFieldsSaveNeedsReadback(previous: QuotationFieldsView, changes: readonly QuotationChange[]): boolean {
  const overrides = applyQuotationChanges(previous.overrides, changes);
  return previous.resolved.rows.some(row => dependentHtml(previous, overrides, row.optionId, 'detailHtml'));
}
function validSaveVersion(previous: QuotationFieldsView, saved: QuotationFieldsView) {
  const original = Date.parse(previous.productVersion), current = Date.parse(saved.productVersion);
  return Number.isFinite(original) && Number.isFinite(current) && current > original
    && new Date(current).toISOString() === saved.productVersion && saved.updatedAt === saved.productVersion
    && typeof saved.inputFingerprint === 'string' && /^[a-f0-9]{64}$/.test(saved.inputFingerprint) && saved.inputFingerprint !== previous.inputFingerprint;
}

/** An HTTP 200 is not proof that these direct edits were stored. Preserve the
 * exact manual layers (including blanks and resets) and the captured category
 * sources; source changes require a fresh explicit comparison in the editor. */
export function confirmQuotationFieldsSave(previous: QuotationFieldsView, saved: QuotationFieldsView, changes: readonly QuotationChange[], readback?: QuotationFieldsView): QuotationFieldsView {
  try {
    const expected = applyQuotationChanges(previous.overrides, changes);
    if (!Number.isSafeInteger(saved.revision) || saved.revision !== previous.revision + 1
      || !validSaveVersion(previous, saved)
      || sourceSignature(saved) !== sourceSignature(previous)
      || overrideSignature(saved.overrides) !== overrideSignature(expected)) throw unconfirmed();
    if (readback && (readback.revision !== saved.revision || readback.inputFingerprint !== saved.inputFingerprint
      || readback.productVersion !== saved.productVersion || readback.updatedAt !== saved.updatedAt
      || sourceSignature(readback) !== sourceSignature(saved) || overrideSignature(readback.overrides) !== overrideSignature(expected))) throw unconfirmed();
    const keys = previous.resolved.schema.fields.map(field => field.id).sort();
    for (const row of previous.resolved.rows) {
      const stored = saved.resolved.rows.find(item => item.optionId === row.optionId);
      if (!stored || JSON.stringify(Object.keys(stored.fields).sort()) !== JSON.stringify(keys)) throw unconfirmed();
      for (const field of previous.resolved.schema.fields) {
        const cell = stored.fields[field.id];
        let restored = expectedCell(previous, expected, row.optionId, field.id);
        if (field.id === 'detailHtml' && !restored?.source.startsWith('manual-')) {
          if (dependentHtml(previous, expected, row.optionId, field.id)) {
            const confirmed = readback?.resolved.rows.find(item => item.optionId === row.optionId)?.fields[field.id];
            if (confirmed?.source !== restored?.source) throw unconfirmed();
            restored = confirmed;
          }
          else if (['detailImages', 'altText'].some(key => expectedCell(previous, expected, row.optionId, key)?.value
            !== previous.automatic.rows.find(item => item.optionId === row.optionId)?.fields[key]?.value)) restored = row.fields.detailHtml;
        }
        if (!restored || cell?.value !== restored.value || cell.source !== restored.source) throw unconfirmed();
      }
    }
    return saved;
  } catch { throw unconfirmed(); }
}
