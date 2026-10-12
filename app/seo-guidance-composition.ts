import { QUOTATION_TAG_ITEM_LIMIT, QUOTATION_TAG_TOTAL_LIMIT, quotationKeywordPlan } from '@/app/quotation-keywords';
import { validateContentInput, type ProductContent } from '@/app/product-content';
import { untouchedIntakeKeywords } from '@/app/translation-batch-adoption';
import { GOOGLE_TEXT_MODEL, type TranslationDraft, type TranslationJob } from '@/app/automation/translation';
import type { integratedTranslationPlan } from '@/app/translation-integrated-adoption';

/** Explicit owner-written SEO, separate from the provider's translated facts. */
export type SeoGuidanceComposition = { brand: string; features: string; keywords: string; title: string; replaceTitle?: boolean; replaceKeywords?: boolean };
const text = (value: unknown, maximum: number, name: string) => {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))
    throw Error(`${name}의 길이와 문자를 확인해주세요.`);
  return value;
};
function targetKeywords(value: string): string[] {
  const plan = quotationKeywordPlan(value);
  if (plan.omitted.some(item => item.reason !== '중복 검색어'))
    throw Error('타겟 검색태그는 태그별 20자, 전체 150자 이하로 직접 수정해주세요. 입력을 자르지 않았습니다.');
  return plan.kept;
}
export function validateSeoGuidanceComposition(raw: unknown): SeoGuidanceComposition {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ['brand','features','keywords','title'].some(key=>!Object.hasOwn(raw,key))
    || Object.keys(raw).some(key=>!['brand','features','keywords','title','replaceTitle','replaceKeywords'].includes(key)))
    throw Error('브랜드·특징·타겟·구성 상품명을 확인해주세요.');
  const value = raw as Record<string, unknown>;
  const result: SeoGuidanceComposition = { brand: text(value.brand,100,'브랜드'), features: text(value.features,2000,'상품 특징'),
    keywords: text(value.keywords,2000,'타겟 검색태그'), title: text(value.title,100,'구성 상품명') };
  for(const key of ['replaceTitle','replaceKeywords'] as const)if(Object.hasOwn(value,key)){
    if(typeof value[key]!=='boolean')throw Error('저장된 상품명·검색태그 교체 선택을 확인해주세요.');result[key]=value[key];
  }
  if (!result.title.trim()) throw Error('상품명에 사용할 짧은 특징을 선택하여 구성 상품명을 100자 이내로 직접 입력해주세요.');
  if (/[\r\n]/u.test(result.title)) throw Error('구성 상품명은 한 줄로 입력해주세요.');
  targetKeywords(result.keywords);
  // Keep exact caller strings for the preview fingerprint, including whitespace.
  return result;
}

export function seoGuidanceTitle(draft: Pick<TranslationDraft,'title'>, memo: Pick<SeoGuidanceComposition,'brand'|'features'|'keywords'>): string {
  const features = memo.features.trim();
  // A long specification/prompt is not a product name. The owner chooses a
  // short phrasing while the original translation remains available separately.
  if (features.length > 100 || /[\r\n]/u.test(features)) return '';
  const title=draft.title.trim(),brand=memo.brand.trim();
  const existingBrand=!!brand&&(title===brand||title.startsWith(brand+' '));
  const base=existingBrand?title.slice(brand.length).trimStart():title;
  let result = [brand,features&&!base.includes(features)&&features,base].filter(Boolean).join(' ');
  for (const target of quotationKeywordPlan(memo.keywords).kept) if (!result.includes(target)) result += (result ? ' ' : '') + target;
  return result;
}
export function seoGuidanceTags(draft: Pick<TranslationDraft,'keywords'>, input: SeoGuidanceComposition) {
  const tags = targetKeywords(input.keywords), omitted: string[] = [];
  for (const value of draft.keywords) {
    if (tags.includes(value)) continue;
    if (!value || value.length > QUOTATION_TAG_ITEM_LIMIT || /[\r\n]/u.test(value) || [...tags,value].join(', ').length > QUOTATION_TAG_TOTAL_LIMIT) {
      omitted.push(value); continue;
    }
    tags.push(value);
  }
  return { tags, omitted };
}

/** Preserve normal translation/label/option policy; replace only eligible SEO
 * candidates. Provider result and supplier attributes are never rewritten. */
export function applySeoGuidanceComposition(plan: ReturnType<typeof integratedTranslationPlan>, content: ProductContent,
  job: TranslationJob, input: SeoGuidanceComposition): ReturnType<typeof integratedTranslationPlan> {
  if (job.status !== 'completed' || !job.result || job.review.model !== GOOGLE_TEXT_MODEL || job.result.model !== GOOGLE_TEXT_MODEL
    || job.review.destination !== 'Google 번역' || job.review.instructionsVersion !== 'sourceflow-translation-v6'
    || ['optionsRetry','intakeOptions','seoRetry'].some(key => Object.hasOwn(job.review,key)))
    throw Error('사용자 SEO 구성안은 현재 일반 Google 번역 초안과 함께 검토해주세요. 전용 재시도 범위는 변경하지 않았습니다.');
  const composition = validateSeoGuidanceComposition(input), values = { title: composition.title.trim(), keywords: seoGuidanceTags(job.result.draft,composition) };
  const next = { ...plan, patch: { ...plan.patch, seo: { ...plan.patch?.seo }, ...(plan.patch?.label ? {label:{...plan.patch.label}} : {}) },
    preview: [...plan.preview], skipped: [...plan.skipped] };
  for (const field of ['title','keywords'] as const) {
    const replace = field === 'title' ? composition.replaceTitle === true : composition.replaceKeywords === true;
    const eligible = replace || content.seo[field].provenance !== 'manual' || field === 'keywords' && untouchedIntakeKeywords(content,job);
    if (!eligible) continue;
    if(replace)next.skipped=next.skipped.filter(value=>value!==(field==='title'?'상품명':'검색어')+': 직접 수정한 값을 유지합니다.');
    next.preview = next.preview.filter(row => row.name !== (field === 'title' ? '상품명' : '검색어'));
    delete next.patch.seo[field];
    const value = field === 'title' ? values.title : values.keywords.tags;
    if (JSON.stringify(content.seo[field].value) === JSON.stringify(value)) continue;
    const checked = validateContentInput({expectedRevision:content.revision,patch:{seo:{[field]:value}}},[],'');
    Object.assign(next.patch.seo,checked.patch.seo);
    next.preview.push({name:field==='title'?'상품명 · 사용자 구성안':'검색어 · 사용자 구성안',
      before:Array.isArray(content.seo[field].value)?(content.seo[field].value as string[]).join(', '):content.seo[field].value as string,
      after:Array.isArray(value)?value.join(', '):value});
  }
  if (values.keywords.omitted.length) next.skipped.push(`타겟 검색태그를 우선 반영하여 150자에 들어가지 않는 번역 상품명 검색어 ${values.keywords.omitted.length}개는 구성안에서 제외했습니다: ${values.keywords.omitted.join(', ')}`);
  // Follow only the existing explicit SEO-name link or its untouched first
  // automatic copy. A separate source/manual label name remains separate.
  const linked = next.patch.labelProductNameLinked ?? content.labelProductNameLinked;
  if (linked && next.patch.seo.title !== undefined) {
    if (next.patch.label?.productName !== undefined) next.patch.label.productName = next.patch.seo.title;
    next.preview = next.preview.filter(row=>row.name!=='품명 · SEO 상품명 연동');
    if(content.label.productName.value!==next.patch.seo.title)next.preview.push({name:'품명 · SEO 상품명 연동',before:content.label.productName.value,after:next.patch.seo.title});
  }
  return next;
}
