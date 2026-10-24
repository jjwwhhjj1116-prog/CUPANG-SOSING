import type { QuotationField, QuotationOverrides, ResolvedQuotation } from '@/app/quotation-schema';

/** weightKg already describes one selling unit, including its pack quantity.
 * It is a comparison bound only, never an automatic packaged-weight value. */
export function quotationSaleUnitWeightG(weightKg: number | null | undefined): number | null {
  return typeof weightKg === 'number' && Number.isFinite(weightKg) && weightKg > 0 && weightKg <= 1e6 ? weightKg * 1000 : null;
}
export function quotationPackagedWeightSourceIssue(packagedWeightG: number, saleUnitWeightG: number | null): string | null {
  if (saleUnitWeightG === null || !Number.isFinite(packagedWeightG) || packagedWeightG <= 0) return null;
  // Ignore conversion noise only, retaining real sub-gram contradictions.
  if (saleUnitWeightG - packagedWeightG <= Number.EPSILON * Math.max(saleUnitWeightG, packagedWeightG) * 8) return null;
  return `포장 무게 ${packagedWeightG}g이 2단계 옵션의 판매 단위 무게 ${saleUnitWeightG}g보다 작습니다. 같은 판매 구성의 상품 무게·포장 무게와 단위를 확인하고 수정해주세요. 저장값은 자동 변경하지 않았습니다.`;
}
export function quotationPackagedWeightSourceIssues(fields: readonly QuotationField[], fieldId: string, value: string, weightKg: number | null | undefined): string[] {
  const field = fields.find(item => item.id === fieldId);
  const isWeight = field?.id === 'packagedWeightG' && field.type === 'number' && field.unit === 'g'
    || quotationPackagedWeightPeer(fields, fieldId) === 'packagedWeightG';
  if (!isWeight || !/^\d+$/u.test(value.trim())) return [];
  const issue = quotationPackagedWeightSourceIssue(Number(value), quotationSaleUnitWeightG(weightKg));
  return issue ? [issue] : [];
}

/** The legacy numeric input and observed string wire are the same g quantity.
 * Keep both saved IDs; never infer aliases from a label or another weight unit. */
export function quotationPackagedWeightPeer(fields: readonly QuotationField[], fieldId: string): string | null {
  const own = fields.find(field => field.id === fieldId);
  if (!own || (own.id !== 'packagedWeightG' && own.hubInput !== 'packagedWeightG')) return null;
  const canonical = fields.filter(field => field.id === 'packagedWeightG');
  const wires = fields.filter(field => field.hubWire?.path.length === 2
    && field.hubWire.path[0] === 'logisticsPage' && field.hubWire.path[1] === 'skuUnitBoxWeight'
    && field.hubWire.name === undefined && field.hubWire.nameKey === undefined && field.hubWire.valueKey === undefined);
  if (canonical.length !== 1 || wires.length !== 1) return null;
  const [base] = canonical, [wire] = wires;
  if (base.id === wire.id || base.type !== 'number' || base.hubWire || wire.type !== 'text'
    || !wire.numericText || wire.hubInput !== 'packagedWeightG'
    || [base, wire].some(field => field.readOnly || field.section !== 'logistics' || field.visibility !== 'common' || field.unit !== 'g')) return null;
  return fieldId === base.id ? wire.id : fieldId === wire.id ? base.id : null;
}

/** A reviewed literal edit updates the exact g pair. A reset still addresses
 * only its stored field; deriving the peer's displayed value is read-only.
 */
export function quotationPackagedWeightEditFields(fields: readonly QuotationField[], fieldId: string, value: string | null): string[] {
  const peer = value === null ? null : quotationPackagedWeightPeer(fields, fieldId);
  return peer ? [fieldId, peer] : [fieldId];
}

/** Show the native form's single g input when its exact compatibility peer
 * resolves to the same value. Competing saved values stay separately visible;
 * this changes neither the schema nor either saved/validated field ID. */
export function quotationPackagedWeightDisplayField(fields: readonly QuotationField[], fieldId: string, read: (id: string) => string): string {
  if (fieldId !== 'packagedWeightG') return fieldId;
  const peer = quotationPackagedWeightPeer(fields, fieldId);
  return peer && read(fieldId) === read(peer) ? peer : fieldId;
}
export function quotationPackagedWeightVisibleFields(fields: readonly QuotationField[], read: (id: string) => string): QuotationField[] {
  return fields.filter(field => quotationPackagedWeightDisplayField(fields, field.id, read) === field.id);
}
type WeightChange = { fieldKey: string; optionId: string | null; value: string | null };
/** Complete single-input plans before saving/copying. Keep an explicitly staged
 * per-field reset, and refuse competing literals instead of choosing by order.
 */
export function quotationPackagedWeightEditChanges(fields: readonly QuotationField[], changes: readonly WeightChange[]): WeightChange[] {
  const result = changes.map(change => ({ ...change }));
  for (const change of changes) {
    const peer = change.value === null ? null : quotationPackagedWeightPeer(fields, change.fieldKey);
    if (!peer) continue;
    const explicit = changes.find(item => item.optionId === change.optionId && item.fieldKey === peer);
    if (explicit) {
      if (explicit.value !== null && explicit.value !== change.value) throw new Error('연결된 포장 무게 값이 다릅니다. 사용할 무게를 직접 입력한 뒤 적용해주세요.');
      continue;
    }
    if (!result.some(item => item.optionId === change.optionId && item.fieldKey === peer)) result.push({ ...change, fieldKey: peer });
  }
  return result;
}

/** A null means no override (including a staged reset); '' is a manual blank.
 * Option overrides precede common overrides across the exact pair. At the same
 * layer each field's own value wins, so existing conflicting edits stay visible.
 * This is a read-only resolution: it never creates a second stored override. */
export function quotationPackagedWeightManual(
  fields: readonly QuotationField[], fieldId: string, optionId: string | null,
  read: (optionId: string | null, fieldId: string) => string | null,
): { value: string; source: 'manual-option' | 'manual-common'; fieldId: string } | null {
  const peer = quotationPackagedWeightPeer(fields, fieldId);
  if (!peer) return null;
  for (const layer of optionId === null ? [null] : [optionId, null]) {
    for (const id of [fieldId, peer]) {
      const value = read(layer, id);
      if (value !== null) return { value, source: layer === null ? 'manual-common' : 'manual-option', fieldId: id };
    }
  }
  return null;
}

/** The former resolver read only each field's own option/common override.
 * Version this alias rule only when an included output value actually differs.
 * The lazy fallback resolves the same source with quotation overrides cleared;
 * automatic option facts, defaults and the stored overrides remain untouched. */
export function quotationPackagedWeightBindingFingerprint(
  overrides: QuotationOverrides, resolved: ResolvedQuotation, automatic: () => ResolvedQuotation,
): { packagedWeightBindingRevision?: 'exact-g-pair-v1' } {
  const peer = quotationPackagedWeightPeer(resolved.schema.fields, 'packagedWeightG');
  if (!peer) return {};
  let fallback: ResolvedQuotation | undefined;
  for (const row of resolved.rows) {
    if (!row.included) continue;
    const specific = row.optionId !== null && Object.hasOwn(overrides.options, row.optionId) ? overrides.options[row.optionId] : undefined;
    for (const id of ['packagedWeightG', peer]) {
      const cell = row.fields[id];
      if (!cell?.source.startsWith('manual-')) continue;
      let previous = specific && Object.hasOwn(specific, id) ? specific[id]
        : Object.hasOwn(overrides.common, id) ? overrides.common[id] : undefined;
      if (previous === undefined) {
        fallback ??= automatic();
        previous = fallback.rows.find(before => before.optionId === row.optionId)?.fields[id]?.value;
        if (previous === undefined) throw new Error('포장 무게의 자동 기준값을 대조하지 못했습니다.');
      }
      if (previous !== undefined && previous !== cell.value) return { packagedWeightBindingRevision: 'exact-g-pair-v1' };
    }
  }
  return {};
}
