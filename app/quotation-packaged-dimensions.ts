import type { QuotationField } from '@/app/quotation-schema';

/** Only the canonical packaging input or its exact observed millimetre wire. */
export function isPackagedDimensionsMmField(field: QuotationField): boolean {
  if (field.readOnly || field.section !== 'logistics' || field.visibility !== 'common' || field.type !== 'text' || field.unit !== 'mm') return false;
  if (!field.hubWire) return field.id === 'packagedDimensionsMm';
  const wire = field.hubWire;
  return field.hubInput === 'packagedDimensionsMm' && wire.path.length === 2
    && wire.path[0] === 'logisticsPage' && wire.path[1] === 'skuUnitBoxDimension'
    && wire.name === undefined && wire.nameKey === undefined && wire.valueKey === undefined;
}

const positiveParts = (parts: readonly string[]) => parts.every(part => Number(part) > 0 && Number(part) <= 1e6);

/** A new explicit edit can use familiar multiplication signs. Keep the digits
 * and their order exactly; never infer units, missing parts or physical facts. */
export function normalizePackagedDimensionsMm(value: string): string {
  const parts = value.match(/^\s*(\d+)\s*[*xX×]\s*(\d+)\s*[*xX×]\s*(\d+)\s*$/)?.slice(1);
  return parts && positiveParts(parts) ? parts.join('*') : value;
}

/** Existing stored values remain raw and receive a diagnostic until edited. */
export function isCanonicalPackagedDimensionsMm(value: string): boolean {
  const parts = value.match(/^(\d+)\*(\d+)\*(\d+)$/)?.slice(1);
  return Boolean(parts && positiveParts(parts));
}
