import { calculateStageTwoMsrp, type PricePolicy } from '@/app/pricing';
import { quotationPriceTargets } from '@/app/quotation-price-targets';
import { quotationNumericValue, quotationScalarValueIssues } from '@/app/quotation-scalar-constraints';
import type { QuotationChange, QuotationFieldsView } from '@/app/quotation-schema';

export type StageTwoMsrp = Record<string, { fields: string[]; value: string }>;
type View = Pick<QuotationFieldsView, 'resolved' | 'overrides' | 'stageTwoMsrp'>;
type Scoped = { stageTwoMsrp?: StageTwoMsrp; categoryStageTwoMsrp?: Record<string, StageTwoMsrp> };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const owns = (value: object, key: string) => Object.hasOwn(value, key);
const amount = (value: unknown, positive = true): value is string => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)
  && Number.isSafeInteger(Number(value)) && (positive ? Number(value) > 0 : Number(value) >= 0);
const invalid = () => Error('2단계 판매가·MSRP의 저장 기준을 다시 확인해주세요.');

/** A sidecar grants automatic authority only for the exact currently bound
 * fields and their unchanged saved override values. Old manual rows lack it. */
export function currentStageTwoMsrp(view: View, value: unknown = view.stageTwoMsrp): StageTwoMsrp | undefined {
  if (!record(value) || Object.keys(value).length > 200) return undefined;
  let fields: string[];
  try { fields = quotationPriceTargets(view.resolved.schema.fields).msrp.linked; } catch { return undefined; }
  const entries = Object.entries(value).filter(([id, marker]) => {
    if (!view.resolved.rows.some(row => row.optionId === id) || !record(marker) || Object.keys(marker).sort().join(',') !== 'fields,value'
      || !Array.isArray(marker.fields) || JSON.stringify(marker.fields) !== JSON.stringify(fields) || !amount(marker.value, false)) return false;
    const own = owns(view.overrides.options, id) ? view.overrides.options[id] : undefined;
    return !!own && fields.every(field => owns(own, field) && own[field] === marker.value);
  }).map(([id, marker]): [string, StageTwoMsrp[string]] => [id, { fields: [...fields], value: (marker as { value: string }).value }]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function scopedStageTwoMsrp(state: Scoped, categoryId: string | null): StageTwoMsrp | undefined {
  if (!categoryId) return state.stageTwoMsrp;
  const key = 'category:' + categoryId;
  return state.categoryStageTwoMsrp && owns(state.categoryStageTwoMsrp, key) ? state.categoryStageTwoMsrp[key] : undefined;
}

/** Stage two opts into sale-driven MSRP only. Explicit option/common MSRP,
 * including blanks and restore edits, always takes precedence. */
export function stageTwoMsrpEdits(view: View, edits: readonly QuotationChange[], policy: PricePolicy): { changes: QuotationChange[]; optionIds: string[] } {
  if (!Array.isArray(edits) || edits.length > 1000 || edits.some(edit => !edit || typeof edit.fieldKey !== 'string'
    || edit.optionId !== null && typeof edit.optionId !== 'string' || edit.value !== null && typeof edit.value !== 'string')) throw invalid();
  const changes = edits.map(edit => ({ fieldKey: edit.fieldKey, optionId: edit.optionId, value: edit.value }));
  if (!edits.length) return { changes, optionIds: [] };
  const targets = quotationPriceTargets(view.resolved.schema.fields), msrp = targets.msrp.linked;
  const markers = currentStageTwoMsrp(view);
  if (msrp.some(field => owns(view.overrides.common, field)) || edits.some(edit => edit.optionId === null && msrp.includes(edit.fieldKey))) return { changes, optionIds: [] };
  const ids = [...new Set(edits.filter(edit => edit.optionId !== null && targets.salePrice.linked.includes(edit.fieldKey)).map(edit => edit.optionId!))];
  const optionIds: string[] = [];
  for (const id of ids) {
    if (!view.resolved.rows.some(row => row.optionId === id && row.included) || edits.some(edit => edit.optionId === id && msrp.includes(edit.fieldKey))) continue;
    const own = owns(view.overrides.options, id) ? view.overrides.options[id] : undefined;
    if (own && msrp.some(field => owns(own, field)) && !(markers && owns(markers,id))) continue;
    const sale = targets.salePrice.linked.map(field => edits.filter(edit => edit.optionId === id && edit.fieldKey === field));
    if (sale.some(matches => matches.length !== 1) || typeof sale[0][0].value!=='string' || sale.some(matches => matches[0].value !== sale[0][0].value)) continue;
    const field=view.resolved.schema.fields.find(item=>item.id===targets.salePrice.primary),raw=sale[0][0].value;
    const numeric=field?quotationNumericValue(field,raw):undefined;
    if(!field||numeric===undefined||!Number.isSafeInteger(numeric)||numeric<=0||quotationScalarValueIssues(field,raw).length)continue;
    const value = String(calculateStageTwoMsrp(numeric, policy));
    changes.push(...msrp.map(fieldKey => ({ fieldKey, optionId: id, value })));
    optionIds.push(id);
  }
  if (changes.length > 1000) throw invalid();
  return { changes, optionIds };
}

/** Records only server-verified derivations. Even an identical explicit manual
 * MSRP edit retires its previous automatic authority without changing values. */
export function applyStageTwoMsrp(view: View, changes: readonly QuotationChange[], derivedIds: readonly string[] = []): StageTwoMsrp | undefined {
  const next = { ...currentStageTwoMsrp(view) };
  let fields: string[];
  try { fields = quotationPriceTargets(view.resolved.schema.fields).msrp.linked; } catch { return undefined; }
  for (const edit of changes) if (fields.includes(edit.fieldKey)) {
    if (edit.optionId === null) for (const id of Object.keys(next)) delete next[id];
    else if (!derivedIds.includes(edit.optionId)) delete next[edit.optionId];
  }
  for (const id of derivedIds) {
    const found = fields.map(field => changes.find(edit => edit.optionId === id && edit.fieldKey === field));
    if (!found.every(edit => edit && amount(edit.value, false) && edit.value === found[0]!.value)) throw invalid();
    Object.defineProperty(next, id, { value: { fields: [...fields], value: found[0]!.value! }, enumerable: true, configurable: true, writable: true });
  }
  return Object.keys(next).length ? next : undefined;
}
