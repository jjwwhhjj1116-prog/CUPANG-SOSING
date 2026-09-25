import { validateContentInput, type ProductContent, type ContentPatch } from '@/app/product-content';
import { translationSeoFields } from '@/app/translation-adoption';
import { suggestTranslationLabels, translationLabelAdoption } from '@/app/translation-label-adoption';
import type { TranslationJob } from '@/app/automation/translation';

const names = { title: '상품명', keywords: '검색어', description: '상품 설명' };
const display = (value: string | string[]) => Array.isArray(value) ? value.join(', ') : value;

/** A reviewed, single-revision content save. Never replace manually saved values. */
export function translationBatchAdoption(content: ProductContent, job: TranslationJob, version: string) {
  if (job.productId !== content.productId || job.productVersion !== version || job.status !== 'completed' || !job.result) {
    throw Error('현재 상품의 완료된 번역 결과를 선택해주세요.');
  }
  const patch: ContentPatch = {};
  const preview: { name: string; before: string; after: string }[] = [];
  const skipped: string[] = [];
  for (const field of translationSeoFields) {
    const current = content.seo[field];
    const next = job.result.draft[field];
    if (current.provenance === 'manual') { skipped.push(`${names[field]}: 직접 수정한 값을 유지합니다.`); continue; }
    if (!display(next).trim() || JSON.stringify(current.value) === JSON.stringify(next)) continue;
    const validated = validateContentInput({ expectedRevision: content.revision, patch: { seo: { [field]: next } } }, [], '');
    patch.seo = { ...patch.seo, ...validated.patch.seo };
    preview.push({ name: names[field], before: display(current.value), after: display(next) });
  }
  const labels = suggestTranslationLabels(content, job, version);
  skipped.push(...labels.skipped);
  if (labels.mappings.length) {
    const changed = labels.mappings.filter(mapping => content.label[mapping.field]?.value !== job.result!.draft.attributes.find(item => item.sourceIndex === mapping.sourceIndex)?.value);
    if (changed.length) {
      const adopted = translationLabelAdoption(content, job, version, changed);
      patch.label = adopted.input.patch.label;
      preview.push(...adopted.preview.map(({ name, before, after }) => ({ name, before, after })));
    }
  }
  // When the source has no separate product-name attribute, use the reviewed
  // effective SEO title for an untouched empty label. Never replace a distinct
  // saved label name or resolve conflicting source names by choosing a title.
  const labelName = content.label.productName;
  const hasSourceName = job.result.draft.attributes.some(attribute =>
    ['품명', '제품명', '상품명'].includes(attribute.name.trim())
    && job.review.source.attributes[attribute.sourceIndex]?.name.startsWith('상품속성: '));
  const effectiveTitle = patch.seo?.title ?? content.seo.title.value;
  if (!hasSourceName && !labelName.value.trim() && labelName.provenance !== 'manual'
    && !patch.label?.productName && effectiveTitle.trim()) {
    patch.label = { ...patch.label, productName: effectiveTitle };
    preview.push({ name: '품명 · 저장할 상품명 연결', before: labelName.value, after: effectiveTitle });
  }
  return { input: preview.length ? validateContentInput({ expectedRevision: content.revision, patch }, [], '') : null, preview, skipped };
}
