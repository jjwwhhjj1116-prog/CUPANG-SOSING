import type { TranslationJob } from '@/app/automation/translation';
import { validateQuotationChanges, type QuotationFieldsView, type QuotationChange } from '@/app/quotation-schema';

export type AttributeMapping = { sourceIndex: number; fieldId: string };
/** User-selected destinations only; no guesses about category, certification or units. */
export function quotationTranslationDraft(productId: string, view: QuotationFieldsView, job: TranslationJob, optionId: string | null, mappings: readonly AttributeMapping[]) {
  if (job.productId !== productId || job.productVersion !== view.productVersion || job.contentRevision !== view.contentRevision || job.status !== 'completed' || !job.result) throw new Error('최신 상품·콘텐츠에 해당하는 완료된 번역을 선택해주세요.');
  if (!view.resolved.schema.categoryId) throw new Error('견적 카테고리를 먼저 선택해주세요.');
  const row = view.resolved.rows.find(item => item.optionId === optionId && item.included);
  if (!row) throw new Error('견적에 포함된 옵션을 선택해주세요.');
  if (!mappings.length || mappings.length > 50 || new Set(mappings.map(item => item.fieldId)).size !== mappings.length || new Set(mappings.map(item => item.sourceIndex)).size !== mappings.length) throw new Error('속성과 견적 항목을 중복 없이 연결해주세요.');
  const changes = mappings.map(mapping => {
    const source = job.review.source.attributes[mapping.sourceIndex];
    const translated = job.result!.draft.attributes.filter(item => item.sourceIndex === mapping.sourceIndex);
    const field = view.resolved.schema.fields.find(item => item.id === mapping.fieldId);
    if (!Number.isInteger(mapping.sourceIndex) || !source?.name.startsWith('상품속성: ') || translated.length !== 1) throw new Error('수집 상품 속성의 번역 결과를 선택해주세요.');
    if (!field || field.readOnly || !['text', 'textarea'].includes(field.type)) throw new Error('현재 카테고리의 직접 입력 가능한 텍스트 항목을 선택해주세요.');
    if (row.fields[field.id]?.source.startsWith('manual-')) throw new Error(`${field.label}: 기존 직접 수정값을 보존했습니다. 이 항목은 견적 입력에서 직접 수정해주세요.`);
    if (!translated[0].value.trim()) throw new Error('빈 번역값은 반영하지 않습니다.');
    return { fieldKey: field.id, optionId, value: translated[0].value };
  });
  return validateQuotationChanges(changes, { schema: view.resolved.schema, optionIds: view.resolved.rows.flatMap(item => item.optionId === null ? [] : [item.optionId]), ownedImageKeys: view.imageKeys, overrides: view.overrides });
}

export function quotationTranslationBatch(productId: string, view: QuotationFieldsView, job: TranslationJob, mappings: readonly AttributeMapping[]) {
  if (job.productId !== productId || job.productVersion !== view.productVersion || job.contentRevision !== view.contentRevision || job.status !== 'completed' || !job.result) throw new Error('최신 상품·콘텐츠에 해당하는 완료된 번역을 선택해주세요.');
  if (!mappings.length || mappings.length > 50 || new Set(mappings.map(item => item.fieldId)).size !== mappings.length || new Set(mappings.map(item => item.sourceIndex)).size !== mappings.length) throw new Error('속성과 견적 항목을 중복 없이 연결해주세요.');
  const options = view.resolved.rows.filter(row => row.optionId !== null);
  const targets = (options.length ? options : view.resolved.rows).filter(row => row.included);
  if (!targets.length) throw new Error('견적에 포함된 옵션이 없습니다.');
  const changes: QuotationChange[] = [];
  const preview: { option: string; field: string; before: string; after: string }[] = [];
  const skipped: string[] = [];
  for (const row of targets) {
    const eligible = mappings.filter(mapping => {
      if (row.fields[mapping.fieldId]?.source.startsWith('manual-')) {
        skipped.push(`${row.optionLabel} · ${view.resolved.schema.fields.find(field => field.id === mapping.fieldId)?.label ?? mapping.fieldId}: 직접 수정값 보존`); return false;
      }
      return true;
    });
    if (!eligible.length) continue;
    for (const change of quotationTranslationDraft(productId, view, job, row.optionId, eligible)) {
      const before = row.fields[change.fieldKey]?.value ?? '';
      if (before === change.value) continue;
      changes.push(change);
      preview.push({ option: row.optionLabel, field: view.resolved.schema.fields.find(field => field.id === change.fieldKey)!.label, before, after: change.value! });
    }
  }
  if (changes.length) validateQuotationChanges(changes, { schema: view.resolved.schema, optionIds: options.map(row => row.optionId!), ownedImageKeys: view.imageKeys, overrides: view.overrides });
  return { changes, preview, skipped };
}
