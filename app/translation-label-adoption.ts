import { labelFields, validateContentInput, type LabelField, type ProductContent } from '@/app/product-content';
import type { TranslationJob } from '@/app/automation/translation';

export type TranslationLabelMapping = { sourceIndex: number; field: LabelField };
// Explicit equivalent headings only. Do not collapse component materials, product
// and packaging dimensions, or certification applicability into general fields.
const equivalentHeadings: Partial<Record<LabelField, readonly string[]>> = {
  productName: ['제품명', '상품명'],
  material: ['소재'],
  components: ['구성품'],
  dimensions: ['크기 및 중량'],
  precautions: ['취급 및 사용 주의사항', '사용 시 주의사항'],
  manufacturer: ['제조원'],
  importer: ['수입 및 판매원'],
  contact: ['A/S 책임자와 전화번호'],
  productType: ['제품 유형'],
  usageStandard: ['사용기준'],
};
/** Exact display names and explicit equivalents only; ambiguous sources require review. */
export function suggestTranslationLabels(content: ProductContent, job: TranslationJob, productVersion: string) {
  const mappings: TranslationLabelMapping[] = [];
  const skipped: string[] = [];
  const attributes = job.result?.draft.attributes ?? [];
  for (const field of Object.keys(labelFields) as LabelField[]) {
    const headings = [labelFields[field], ...(equivalentHeadings[field] ?? [])];
    const candidates = attributes.filter(attribute => headings.includes(attribute.name.trim())
      && job.review.source.attributes[attribute.sourceIndex]?.name.startsWith('상품속성: '));
    if (!candidates.length) continue;
    if (candidates.length !== 1) { skipped.push(`${labelFields[field]}: 같은 번역 항목명이 여러 개여서 자동 연결하지 않았습니다.`); continue; }
    const mapping = { sourceIndex: candidates[0].sourceIndex, field };
    try {
      translationLabelAdoption(content, job, productVersion, [mapping]);
      mappings.push(mapping);
    } catch (cause) { skipped.push(`${labelFields[field]}: ${cause instanceof Error ? cause.message : '자동 연결 불가'}`); }
  }
  return { mappings, skipped };
}
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
