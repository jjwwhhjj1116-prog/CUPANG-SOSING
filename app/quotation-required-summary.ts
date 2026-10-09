import type { QuotationField, ResolvedQuotationField } from '@/app/quotation-schema';
import { hasSelectedEmptyQuotationChoice } from '@/app/quotation-choice-state';
import { quotationPackagedWeightPeer } from '@/app/quotation-packaged-weight';

type SummaryCell = Pick<ResolvedQuotationField, 'value' | 'source'> & { validationIssues: readonly string[] };
export type QuotationRequiredSummaryEntry = { field: QuotationField; fieldIds: string[]; missing: boolean; complete: boolean };
const requiredBlank = '필수 값이 비어 있습니다.';

/** Read-only presence summary. Retain distinct validation and stored field IDs;
 * only two exact required blank g inputs represent one missing physical fact. */
export function quotationRequiredSummary(fields: readonly QuotationField[], readCell: (field: QuotationField) => SummaryCell) {
  const cells = new Map<string, SummaryCell>();
  const entries: QuotationRequiredSummaryEntry[] = fields.filter(field => field.required).map(field => {
    const cell = readCell(field); cells.set(field.id, cell);
    const missing = !cell.value.trim() && !hasSelectedEmptyQuotationChoice(field, cell);
    return { field, fieldIds: [field.id], missing, complete: !missing && cell.validationIssues.length === 0 };
  });
  const peerId = quotationPackagedWeightPeer(fields, 'packagedWeightG');
  const base = entries.find(entry => entry.field.id === 'packagedWeightG');
  const wire = peerId ? entries.find(entry => entry.field.id === peerId) : undefined;
  const onlyRequiredBlank = (entry: QuotationRequiredSummaryEntry) => {
    const issues = cells.get(entry.field.id)!.validationIssues;
    return entry.missing && issues.length > 0 && issues.every(issue => issue === requiredBlank);
  };
  let missing = entries.filter(entry => entry.missing);
  if (base && wire && onlyRequiredBlank(base) && onlyRequiredBlank(wire)) {
    missing = missing.filter(entry => entry !== base).map(entry => entry === wire ? { ...entry, fieldIds: [wire.field.id, base.field.id] } : entry);
  }
  // Section progress continues to count the form's required fields, so its
  // denominator stays stable when a missing weight is filled.
  return { entries, required: entries.length, complete: entries.filter(entry => entry.complete).length, missing };
}
