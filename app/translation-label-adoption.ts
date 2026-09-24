import { labelFields, validateContentInput, type LabelField, type ProductContent } from '@/app/product-content';
import type { TranslationJob } from '@/app/automation/translation';

export type TranslationLabelMapping = { sourceIndex: number; field: LabelField };
/** Explicit reviewed connections only. Manual values, including blanks, are protected. */
export function translationLabelAdoption(content: ProductContent, job: TranslationJob, productVersion: string, mappings: readonly TranslationLabelMapping[]) {
  if (job.productId !== content.productId || job.productVersion !== productVersion || job.status !== 'completed' || !job.result) throw Error('현재 상품의 완료된 번역 결과를 선택해주세요.');
  if (!mappings.length || mappings.length > Object.keys(labelFields).length || new Set(mappings.map(item => item.field)).size !== mappings.length || new Set(mappings.map(item => item.sourceIndex)).size !== mappings.length) throw Error('상품 속성과 표시사항 항목을 중복 없이 연결해주세요.');
  const label: Partial<Record<LabelField, string>> = {};
  const preview: { field: LabelField; name: string; source: string; before: string; after: string }[] = [];
  for (const mapping of mappings) {
    if (!Object.hasOwn(labelFields, mapping.field) || !Number.isInteger(mapping.sourceIndex) || mapping.sourceIndex < 0) throw Error('연결할 표시사항 항목을 확인해주세요.');
    const source = job.review.source.attributes[mapping.sourceIndex];
    const matches = job.result.draft.attributes.filter(item => item.sourceIndex === mapping.sourceIndex);
    if (!source?.name.startsWith('상품속성: ') || matches.length !== 1 || !matches[0].value.trim()) throw Error('번역이 완료된 수집 상품 속성을 선택해주세요.');
    const current = content.label[mapping.field];
    if (current?.provenance === 'manual') throw Error(`${labelFields[mapping.field]}: 직접 수정한 값은 보존합니다. 표시사항 편집에서 수정해주세요.`);
    label[mapping.field] = matches[0].value;
    preview.push({ field: mapping.field, name: labelFields[mapping.field], source: source.name, before: current?.value ?? '', after: matches[0].value });
  }
  // Current revision CAS protects edits made after this explicit before/after review.
  const input = validateContentInput({ expectedRevision: content.revision, patch: { label } }, [], '');
  return { input, preview };
}
