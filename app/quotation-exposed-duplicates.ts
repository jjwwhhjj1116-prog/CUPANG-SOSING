import type { QuotationField, ResolvedQuotation } from '@/app/quotation-schema';

export type QuotationExposedAttributeComparison = {
  status: 'compared' | 'unavailable';
  fields: { fieldId: string; label: string }[];
  groups: { optionIds: string[]; values: { fieldId: string; value: string }[] }[];
};
const unavailable = (): QuotationExposedAttributeComparison => ({ status: 'unavailable', fields: [], groups: [] });
const scalar = (field: QuotationField) => ['text', 'textarea', 'number', 'select'].includes(field.type);
const officialPaths = new Set([
  JSON.stringify(['productPage', 'exposedAttributes']),
  JSON.stringify(['productPage', 'commonAttributes', 'exposedAttributes']),
]);

/** Compare only the form's final exposed scalar values. This does not reproduce
 * a vendor's entire raw attribute-array serialization or prove Hub acceptance. */
export function quotationExposedAttributeComparison(resolved: ResolvedQuotation, readValue?: (optionId: string, fieldId: string) => string): QuotationExposedAttributeComparison {
  if (!resolved || resolved.schema?.status !== 'observed' || typeof resolved.schema.categoryId !== 'string' || !resolved.schema.categoryId.trim()
    || !Array.isArray(resolved.schema.fields) || !Array.isArray(resolved.rows)) return unavailable();
  const candidates = resolved.schema.fields.filter(field => field?.section === 'product' && field.visibility === 'exposed');
  const official = candidates.some(field => field.hubWire !== undefined);
  const selected = official ? candidates.filter(field => field.hubWire !== undefined) : candidates;
  if (!selected.length || selected.length > 400) return unavailable();
  const ids = new Set<string>(), wires = new Set<string>(), labels = new Map<string, number>();
  for (const field of selected) {
    if (typeof field.id !== 'string' || !field.id || ids.has(field.id) || typeof field.label !== 'string' || !field.label.trim() || !scalar(field)) return unavailable();
    ids.add(field.id); labels.set(field.label, (labels.get(field.label) ?? 0) + 1);
    if (official) {
      const wire = field.hubWire;
      if (!wire || !Array.isArray(wire.path) || !officialPaths.has(JSON.stringify(wire.path))
        || typeof wire.name !== 'string' || !wire.name.trim() || typeof wire.nameKey !== 'string' || !wire.nameKey
        || typeof wire.valueKey !== 'string' || !wire.valueKey || wire.nameKey === wire.valueKey) return unavailable();
      const identity = JSON.stringify([wire.path, wire.name]);
      if (wires.has(identity)) return unavailable();
      wires.add(identity);
    }
  }
  // A duplicate ID elsewhere in the schema makes cell addressing ambiguous,
  // including an alias accidentally reusing an official field's stable ID.
  if (resolved.schema.fields.some((field, index, fields) => ids.has(field?.id) && fields.findIndex(other => other?.id === field.id) !== index)) return unavailable();
  const rows = resolved.rows.filter(row => row?.included === true && row.optionId !== null);
  if (rows.length > 200) return unavailable();
  const optionIds = new Set<string>();
  const groups = new Map<string, QuotationExposedAttributeComparison['groups'][number]>();
  for (const row of rows) {
    if (typeof row.optionId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(row.optionId) || optionIds.has(row.optionId)
      || !row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields)) return unavailable();
    optionIds.add(row.optionId);
    const values: { fieldId: string; value: string }[] = [];
    for (const field of selected) {
      if (!Object.hasOwn(row.fields, field.id) || typeof row.fields[field.id]?.value !== 'string') return unavailable();
      let value: string;
      try { value = readValue ? readValue(row.optionId, field.id) : row.fields[field.id].value; }
      catch { return unavailable(); }
      if (typeof value !== 'string') return unavailable();
      values.push({ fieldId: field.id, value });
    }
    const key = JSON.stringify(values.map(item => item.value)), group = groups.get(key);
    if (group) group.optionIds.push(row.optionId);
    else groups.set(key, { optionIds: [row.optionId], values });
  }
  return { status: 'compared', fields: selected.map(field => ({ fieldId: field.id,
    label: labels.get(field.label)! > 1 ? `${field.label} (${field.id})` : field.label })),
  groups: [...groups.values()].filter(group => group.optionIds.length > 1) };
}
