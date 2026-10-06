import type { QuotationField } from '@/app/quotation-schema';

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
