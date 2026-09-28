import type { ColumnMapping } from './category-profiles';
import { getQuotationSchema } from './quotation-schema';
import { xlsxChoiceLists, type XlsxInspection } from './xlsx-template';

/** Suggestions are applied explicitly in the editor, never during export. */
export function suggestQuotationChoiceFormats(files: Map<string, Uint8Array>, workbook: XlsxInspection, sheetName: string, row: number, categoryId: string, mappings: readonly ColumnMapping[]) {
  const fields = getQuotationSchema(categoryId).fields;
  const lists = xlsxChoiceLists(files, workbook, sheetName, mappings.filter(mapping => fields.some(field => field.id === mapping.field && field.type === 'select')).map(mapping => mapping.column), row);
  const changes: { column: number; choiceFormat: 'value' | 'label' }[] = [];
  for (const mapping of mappings) {
    const field = fields.find(field => field.id === mapping.field);
    if (field?.type !== 'select' || !field.choices?.length) continue;
    const allowed = lists.get(mapping.column);
    if (!allowed) continue;
    const accepts = (value: string) => allowed.some(item => item.toLowerCase() === value.toLowerCase());
    // Empty code choices are real selections; they must be present in the list,
    // not treated as optional blanks. All choices must fit, not only today's value.
    const codesFit = field.choices.every(choice => accepts(choice.value));
    const labelsFit = field.choices.every(choice => accepts(choice.label));
    if (codesFit === labelsFit) continue;
    const choiceFormat = labelsFit ? 'label' : 'value';
    if ((mapping.choiceFormat ?? 'value') !== choiceFormat) changes.push({ column: mapping.column, choiceFormat });
  }
  return changes;
}

