import type { ColumnMapping } from '@/app/category-profiles';
import { getQuotationSchema } from '@/app/quotation-schema';
import type { HubSchemaSnapshot, HubWireField } from '@/app/supplier-hub-schema';

const wireIdentity = (wire: HubWireField) => JSON.stringify([wire.path, wire.nameKey ?? null, wire.valueKey ?? null, wire.name ?? null]);
const metadataIdentity = (schema: HubSchemaSnapshot) => JSON.stringify(Object.entries(schema.metadata).sort(([left], [right]) => left.localeCompare(right)));

/** Only an app rule-version change may rename a connection automatically.
 * Real form changes keep their existing validation/review behavior. */
export function translateHubRuleVersionMappings(mappings: ColumnMapping[], from?: HubSchemaSnapshot, to?: HubSchemaSnapshot): ColumnMapping[] {
  if (!from || !to || from.inputBindings === to.inputBindings || from.format !== to.format
    || from.categoryId !== to.categoryId || JSON.stringify(from.categoryPath) !== JSON.stringify(to.categoryPath)
    || from.company.code !== to.company.code || from.company.name !== to.company.name
    || from.schemaString !== to.schemaString || metadataIdentity(from) !== metadataIdentity(to)) return mappings;
  const before = getQuotationSchema(from.categoryId, from.categoryPath, from).fields;
  const after = getQuotationSchema(to.categoryId, to.categoryPath, to).fields;
  return mappings.map(mapping => {
    if (mapping.field === 'constant') return mapping;
    const source = before.filter(field => field.id === mapping.field);
    if (!source.length && !mapping.field.startsWith('live_')) return mapping;
    if (source.length !== 1) throw Error(`${mapping.column + 1}열: 이전 상세 양식의 연결 항목을 하나로 확인하지 못했습니다.`);
    const wire = source[0].hubWire;
    if (!wire) return mapping;
    const matches = after.filter(field => field.hubWire && wireIdentity(field.hubWire) === wireIdentity(wire));
    if (matches.length !== 1) throw Error(`${mapping.column + 1}열: 같은 상세 양식 경로의 연결 항목을 하나로 확인하지 못했습니다.`);
    return matches[0].id === mapping.field ? mapping : { ...mapping, field: matches[0].id as ColumnMapping['field'] };
  });
}
