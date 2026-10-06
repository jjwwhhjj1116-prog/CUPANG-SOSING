import type { QuotationField, QuotationOverrides, ResolvedQuotation } from '@/app/quotation-schema';

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
