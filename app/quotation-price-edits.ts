import type { QuotationField } from '@/app/quotation-schema';
import { quotationPriceInputs, quotationPriceTargets, type QuotationPriceInput } from '@/app/quotation-price-targets';

type PriceEdit = { fieldKey: string; optionId: string | null; value: string | null };
const paths = ['purchasePrice', 'coupangSalePrice', 'msrp', 'osrp'];
function isPriceCandidate(fields: readonly QuotationField[], fieldKey: string) {
  if (quotationPriceInputs.some(input => input === fieldKey)) return true;
  const field = fields.find(field => field.id === fieldKey), wire = field?.hubWire;
  return Boolean(wire && !wire.name && wire.path.length === 3 && wire.path[0] === 'productPage'
    && wire.path[1] === 'commonAttributes' && paths.includes(wire.path[2]));
}
/** Exact primary prices only. An independent OSRP wire is never a peer of MSRP. */
export function quotationPriceEditInput(fields: readonly QuotationField[], fieldKey: string): QuotationPriceInput | null {
  if (!isPriceCandidate(fields, fieldKey)) return null;
  const targets = quotationPriceTargets(fields);
  return quotationPriceInputs.find(input => targets[input].linked.includes(fieldKey)) ?? null;
}
export function quotationPriceEditFields(fields: readonly QuotationField[], fieldKey: string): string[] {
  const input = quotationPriceEditInput(fields, fieldKey);
  return input ? quotationPriceTargets(fields)[input].linked : [fieldKey];
}
/** Present the exact Hub price once without dropping its retained alias data.
 * Ambiguous, readonly or unbound definitions remain visible for inspection. */
export function quotationPriceDisplayField(fields: readonly QuotationField[], fieldKey: string): string {
  if (!quotationPriceInputs.some(input => input === fieldKey)) return fieldKey;
  try {
    const target = quotationPriceTargets(fields)[fieldKey as QuotationPriceInput];
    const canonical = fields.find(field => field.id === fieldKey), primary = fields.find(field => field.id === target.primary);
    return canonical?.type === 'number' && !canonical.readOnly && primary?.hubWire && target.primary !== fieldKey ? target.primary : fieldKey;
  } catch { return fieldKey; }
}
export function quotationPriceVisibleFields(fields: readonly QuotationField[]): QuotationField[] {
  return fields.filter(field => quotationPriceDisplayField(fields, field.id) === field.id).map(field => {
    const requiredAlias = fields.some(alias => alias.id !== field.id && alias.required && quotationPriceDisplayField(fields, alias.id) === field.id);
    return requiredAlias && !field.required ? { ...field, required: true } : field;
  });
}
const conflict = () => new Error('연결된 가격의 수정값이 다릅니다. 사용할 금액을 직접 입력한 뒤 적용해주세요.');
/** Pair only explicit edits, including deliberate blanks and resets. Reading a
 * saved divergent pair does not copy, remove or rewrite either stored value. */
export function quotationPriceEditChanges(fields: readonly QuotationField[], changes: readonly PriceEdit[]): PriceEdit[] {
  const result = changes.map(change => ({ ...change }));
  for (const change of changes) {
    const linked = quotationPriceEditFields(fields, change.fieldKey);
    if (linked.length < 2) continue;
    for (const fieldKey of linked) {
      const explicit = changes.filter(item => item.optionId === change.optionId && item.fieldKey === fieldKey);
      if (explicit.some(item => item.value !== change.value)) throw conflict();
      if (!result.some(item => item.optionId === change.optionId && item.fieldKey === fieldKey)) result.push({ ...change, fieldKey });
    }
  }
  return result;
}
/** A single-field draft has the same displayed peers as its eventual save.
 * Only a staged edit contributes; pre-existing per-field overrides remain exact. */
export function quotationPriceStagedEdit(fields: readonly QuotationField[], changes: readonly PriceEdit[], optionId: string | null, fieldKey: string): PriceEdit | undefined {
  if (!changes.some(change => change.optionId === optionId && isPriceCandidate(fields, change.fieldKey))) return undefined;
  const linked = quotationPriceEditFields(fields, fieldKey);
  if (linked.length < 2) return undefined;
  const explicit = changes.filter(change => change.optionId === optionId && linked.includes(change.fieldKey));
  if (!explicit.length) return undefined;
  if (explicit.some(change => change.value !== explicit[0].value)) throw conflict();
  return { ...explicit[0], fieldKey };
}
