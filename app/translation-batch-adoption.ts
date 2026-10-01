import { validateContentInput, type ProductContent, type ContentPatch } from '@/app/product-content';
import { translationSeoFields } from '@/app/translation-adoption';
import { suggestTranslationLabels, translationLabelAdoption } from '@/app/translation-label-adoption';
import type { TranslationJob } from '@/app/automation/translation';
import { collectionKeywords } from '@/app/sourcing';

const names = { title: '상품명', keywords: '검색어', description: '상품 설명' };
const display = (value: string | string[]) => Array.isArray(value) ? value.join(', ') : value;

/** Couplus's observed intake title starts with the explicitly captured brand.
 * Keep this separate from supplier facts and never infer a brand from a company. */
function brandedIntakeTitle(title: string, brand = ''): string {
  const name = title.trim(), prefix = brand.trim();
  if (!name || !prefix || name === prefix ||
    (name.startsWith(prefix) && /^\s/u.test(name.slice(prefix.length)))) return name;
  return `${prefix} ${name}`;
}

function untouchedIntakeKeywords(content: ProductContent, job: TranslationJob): boolean {
  const seed = content.intakeKeywordSeed;
  const current = content.seo.keywords;
  if (!seed || !Array.isArray(seed.value) || !seed.value.length || !seed.updatedAt ||
    seed.updatedAt !== current.updatedAt || !seed.sourceReference ||
    seed.sourceReference !== job.review.source.reference || !job.review.source.guidance) return false;
  try {
    return JSON.stringify(seed.value) === JSON.stringify(current.value) &&
      JSON.stringify(seed.value) === JSON.stringify(collectionKeywords(job.review.source.guidance.keywords));
  } catch { return false; }
}

/** A reviewed, single-revision save. Only untouched intake guidance can replace
 * a manual keyword field; actual edits and all legacy values stay protected. */
export function translationBatchAdoption(content: ProductContent, job: TranslationJob, version: string, intakeBrand?: string) {
  if (job.productId !== content.productId || job.productVersion !== version || job.status !== 'completed' || !job.result) {
    throw Error('현재 상품의 완료된 번역 결과를 선택해주세요.');
  }
  const patch: ContentPatch = {};
  const preview: { name: string; before: string; after: string }[] = [];
  const skipped: string[] = [];
  for (const field of translationSeoFields) {
    const current = content.seo[field];
    if (current.provenance === 'manual' && !(field === 'keywords' && untouchedIntakeKeywords(content, job))) { skipped.push(`${names[field]}: 직접 수정한 값을 유지합니다.`); continue; }
    const next = field === 'title' ? brandedIntakeTitle(job.result.draft.title, intakeBrand) : job.result.draft[field];
    if (!display(next).trim() || JSON.stringify(current.value) === JSON.stringify(next)) continue;
    const validated = validateContentInput({ expectedRevision: content.revision, patch: { seo: { [field]: next } } }, [], '');
    patch.seo = { ...patch.seo, ...validated.patch.seo };
    preview.push({ name: names[field], before: display(current.value), after: display(next) });
  }
  const labels = suggestTranslationLabels(content, job, version);
  skipped.push(...labels.skipped);
  if (labels.mappings.length) {
    const effectiveTitle = patch.seo?.title ?? content.seo.title.value;
    const changed = labels.mappings.filter(mapping => {
      const value = job.result!.draft.attributes.find(item => item.sourceIndex === mapping.sourceIndex)?.value;
      return content.label[mapping.field]?.value !== value ||
        (mapping.field === 'productName' && content.labelProductNameLinked && value !== effectiveTitle);
    });
    if (changed.length) {
      const adopted = translationLabelAdoption(content, job, version, changed);
      patch.label = adopted.input.patch.label;
      const unlinkName = content.labelProductNameLinked && patch.label?.productName !== undefined && patch.label.productName !== effectiveTitle;
      if (unlinkName) patch.labelProductNameLinked = false;
      preview.push(...adopted.preview.map(({ field, name, before, after }) => ({ name: unlinkName && field === 'productName' ? name + ' · 원문 품명 유지, SEO 연동 해제' : name, before, after })));
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
  // applyContentPatch follows an enabled name link even when no explicit label
  // patch is present. Include that real change in the review before saving.
  if (content.labelProductNameLinked && patch.seo?.title !== undefined &&
    !Object.hasOwn(patch.label ?? {}, 'productName') && labelName.value !== effectiveTitle) {
    preview.push({ name: '품명 · SEO 상품명 연동', before: labelName.value, after: effectiveTitle });
  }
  if (!hasSourceName && !labelName.value.trim() && labelName.provenance !== 'manual'
    && !content.labelProductNameLinked && !patch.label?.productName && effectiveTitle.trim()) {
    patch.label = { ...patch.label, productName: effectiveTitle };
    // A first automatic title copy should keep following future SEO edits.
    // An explicitly disabled link remains disabled, including legacy drafts.
    if (content.labelProductNameLinked === undefined) patch.labelProductNameLinked = true;
    preview.push({ name: patch.labelProductNameLinked ? '품명 · SEO 상품명 연동' : '품명 · 저장할 상품명 연결', before: labelName.value, after: effectiveTitle });
  }
  return { input: preview.length ? validateContentInput({ expectedRevision: content.revision, patch }, [], '') : null, preview, skipped };
}
