import { OFFICIAL_WORKBOOK_FIELD_LIMIT, officialWorkbookHeaderKey, officialWorkbookSafeText, validOfficialWorkbookFieldChoices, type OfficialWorkbookField } from '@/app/official-workbook-field-descriptors';
import { validateQuotationChanges, type QuotationChange, type QuotationField, type QuotationFieldsView } from '@/app/quotation-schema';

export type WorkbookReviewSelection = { sourceKey: string; targetFieldKey: string };
export type WorkbookReviewCandidate = { sourceKey: string; source: OfficialWorkbookField; optionId: string | null; optionLabel: string; value: string; suggestedTarget: string };
const has = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);
const key = (optionId: string | null, fieldKey: string) => JSON.stringify([optionId, fieldKey]);
function invalid(): never { throw Error('이전 Excel 입력의 카테고리·원본·옵션을 다시 확인해주세요.'); }

/** A response-bound review basis, never an old-file export authority. */
export function quotationWorkbookReviewBasis(view: QuotationFieldsView, changes: readonly QuotationChange[]) {
  return JSON.stringify([view.revision, view.inputFingerprint, view.productVersion, view.categoryContext, view.retainedWorkbook?.sha256, changes]);
}
export function quotationWorkbookReviewTargets(view: QuotationFieldsView): QuotationField[] {
  const category = view.categoryContext.categoryId;
  if (!category || category !== view.resolved.schema.categoryId) return [];
  return view.resolved.schema.fields.filter(field => {
    const wire = field.workbookWire;
    return !field.readOnly && Boolean(wire && /^[a-f0-9]{64}$/.test(wire.sha256) && Number.isSafeInteger(wire.column)
      && wire.column >= 0 && wire.column < OFFICIAL_WORKBOOK_FIELD_LIMIT && field.id === `workbook_${category}_${wire.sha256}_${wire.column}`);
  });
}

/** Re-read source metadata and literal values from the current server view.
 * This checks the response shape only; original-file evidence is checked by the
 * snapshot reader. It cannot recover uncaptured intermediate workbook files. */
export function quotationWorkbookReviewCandidates(view: QuotationFieldsView): WorkbookReviewCandidate[] {
  const retained = view.retainedWorkbook;
  if (!retained) return [];
  const category = view.categoryContext.categoryId;
  if (!category || category !== view.resolved.schema.categoryId || !officialWorkbookSafeText(retained.name, 500)
    || !/^[a-f0-9]{64}$/.test(retained.sha256) || !Array.isArray(retained.fields) || retained.fields.length > OFFICIAL_WORKBOOK_FIELD_LIMIT) invalid();
  const used = new Set<number>(), labels = new Set<string>(), current = new Set(view.resolved.schema.fields.map(field => field.id));
  const targets = quotationWorkbookReviewTargets(view);
  const fields = retained.fields.map(field => {
    if (!field || typeof field !== 'object' || Array.isArray(field) || Object.keys(field).some(name => !['id', 'column', 'label', 'requirement', 'help', 'type', 'choices'].includes(name))
      || !Number.isSafeInteger(field.column) || field.column < 0 || field.column >= OFFICIAL_WORKBOOK_FIELD_LIMIT || used.has(field.column)
      || field.id !== `workbook_${category}_${retained.sha256}_${field.column}` || current.has(field.id)
      || !officialWorkbookSafeText(field.label, 4000) || !field.label.trim() || labels.has(officialWorkbookHeaderKey(field.label))
      || !officialWorkbookSafeText(field.help, 8000) || !['required', 'conditional', 'optional'].includes(field.requirement)
      || field.type !== 'text' && field.type !== 'select' || field.type === 'text' && has(field, 'choices')
      || field.type === 'select' && !validOfficialWorkbookFieldChoices(field.choices)) invalid();
    used.add(field.column); labels.add(officialWorkbookHeaderKey(field.label)); return field;
  });
  if (new TextEncoder().encode(JSON.stringify(fields)).length > 100_000) invalid();
  const rows = view.resolved.rows;
  if (new Set(rows.map(row => row.optionId)).size !== rows.length) invalid();
  const candidates: WorkbookReviewCandidate[] = [];
  for (const field of fields) {
    const matches = targets.filter(target => target.workbookWire!.column === field.column && officialWorkbookHeaderKey(target.label) === officialWorkbookHeaderKey(field.label));
    for (const row of rows) {
      const values = row.optionId === null ? view.overrides.common : view.overrides.options[row.optionId];
      if (!values || !has(values, field.id)) continue;
      const value = values[field.id];
      if (!officialWorkbookSafeText(value, 20_000)) invalid();
      candidates.push({ sourceKey: key(row.optionId, field.id), source: field, optionId: row.optionId,
        optionLabel: row.optionId === null ? '상품 공통값' : `${row.optionLabel}${row.included ? '' : ' · 견적 제외'}`,
        value, suggestedTarget: matches.length === 1 ? matches[0].id : '' });
    }
  }
  return candidates;
}
function manual(view: QuotationFieldsView, changes: readonly QuotationChange[], optionId: string | null, fieldKey: string): string | null {
  const staged = changes.find(change => change.optionId === optionId && change.fieldKey === fieldKey);
  if (staged) return staged.value;
  const values = optionId === null ? view.overrides.common : view.overrides.options[optionId];
  return values && has(values, fieldKey) ? values[fieldKey] : null;
}
export function quotationWorkbookReviewBefore(view: QuotationFieldsView, changes: readonly QuotationChange[], optionId: string | null, fieldKey: string): string {
  const option = optionId === null ? null : manual(view, changes, optionId, fieldKey);
  const common = manual(view, changes, null, fieldKey);
  return option ?? common ?? view.automatic.rows.find(row => row.optionId === optionId)?.fields[fieldKey]?.value
    ?? view.resolved.rows.find(row => row.optionId === optionId)?.fields[fieldKey]?.value ?? '';
}
export function quotationWorkbookReviewIssues(view: QuotationFieldsView, candidate: WorkbookReviewCandidate, targetFieldKey: string): string[] {
  const target = quotationWorkbookReviewTargets(view).find(field => field.id === targetFieldKey);
  if (!target) return ['현재 Excel의 수정 가능한 항목을 선택해주세요.'];
  try {
    validateQuotationChanges([{ optionId: candidate.optionId, fieldKey: target.id, value: candidate.value }], {
      schema: view.resolved.schema, optionIds: view.resolved.rows.flatMap(row => row.optionId === null ? [] : [row.optionId]),
      ownedImageKeys: view.imageKeys, overrides: view.overrides,
    });
    return [];
  } catch (cause) { return [cause instanceof Error ? cause.message : '현재 입력 규칙에 맞지 않습니다.']; }
}

/** Only explicit selected targets enter the existing manual editor draft.
 * Saved old-SHA overrides, automatic data and inclusion flags stay untouched. */
export function importQuotationWorkbookDraft(view: QuotationFieldsView, changes: readonly QuotationChange[], selections: readonly WorkbookReviewSelection[], expectedBasis: string): QuotationChange[] {
  if (expectedBasis !== quotationWorkbookReviewBasis(view, changes)) throw Error('견적 입력이 바뀌었습니다. 이전 Excel 입력을 다시 비교해주세요.');
  if (!Array.isArray(selections) || !selections.length || selections.length > 1000) throw Error('가져올 항목을 1~1,000개 선택해주세요.');
  const candidates = new Map(quotationWorkbookReviewCandidates(view).map(item => [item.sourceKey, item])), seenSources = new Set<string>(), seenTargets = new Set<string>();
  let draft = [...changes];
  for (const selection of selections) {
    if (!selection || typeof selection !== 'object' || Object.keys(selection).length !== 2 || !has(selection, 'sourceKey') || !has(selection, 'targetFieldKey')) invalid();
    const candidate = candidates.get(selection.sourceKey);
    if (!candidate || seenSources.has(selection.sourceKey)) invalid();
    const targetKey = key(candidate.optionId, selection.targetFieldKey);
    if (seenTargets.has(targetKey)) throw Error('같은 옵션의 현재 항목을 중복 선택했습니다. 대상을 나누어 선택해주세요.');
    const issues = quotationWorkbookReviewIssues(view, candidate, selection.targetFieldKey);
    if (issues.length) throw Error(issues.join(' '));
    seenSources.add(selection.sourceKey); seenTargets.add(targetKey);
    draft = draft.filter(change => key(change.optionId, change.fieldKey) !== targetKey);
    const values = candidate.optionId === null ? view.overrides.common : view.overrides.options[candidate.optionId];
    if (!values || !has(values, selection.targetFieldKey) || values[selection.targetFieldKey] !== candidate.value)
      draft.push({ optionId: candidate.optionId, fieldKey: selection.targetFieldKey, value: candidate.value });
  }
  if (draft.length) validateQuotationChanges(draft, { schema: view.resolved.schema,
    optionIds: view.resolved.rows.flatMap(row => row.optionId === null ? [] : [row.optionId]), ownedImageKeys: view.imageKeys, overrides: view.overrides });
  return draft;
}
