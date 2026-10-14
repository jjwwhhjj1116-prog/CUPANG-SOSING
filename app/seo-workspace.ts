import { applyContentPatch, validateContentInput, type ProductContent } from '@/app/product-content';
import { applySeoDocumentTitlePolicy } from '@/app/seo-title-document';
import { cleanSeoKeywordCandidates, prepareSeoKeywordText, quotationSeoKeywordText, seoKeywordDocumentText } from '@/app/seo-keyword-text';
import { applyOptionNameChanges, validateOptionNamesInput, type OptionNameChange } from '@/app/option-seo-names';
import { OPTIONS_BODY_LIMIT, type ProductOptions } from '@/app/product-options';

export const SEO_WORKSPACE_BODY_LIMIT = OPTIONS_BODY_LIMIT;
export type SeoWorkspaceView = { productId: string; productVersion: string; content: ProductContent; options: ProductOptions; imageKeys: string[]; sourceImageKeys?: Record<string, string> };
export type SeoWorkspaceInput = {
  expectedProductVersion: string; expectedContentRevision: number; expectedOptionRevision: number;
  seo?: { title?: string; keywords?: string[]; description?: string; keywordText?: string };
  optionNames?: OptionNameChange[];
};
export class SeoWorkspaceConflict extends Error {}

/** A manual stage-one save only accepts SEO fields and exact name deltas. */
export function validateSeoWorkspaceInput(value: unknown): SeoWorkspaceInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('SEO 저장 요청을 확인해주세요.');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !['expectedProductVersion', 'expectedContentRevision', 'expectedOptionRevision', 'seo', 'optionNames'].includes(key))
    || typeof body.expectedProductVersion !== 'string' || body.expectedProductVersion.length > 30 || !Number.isFinite(Date.parse(body.expectedProductVersion))
    || !Number.isSafeInteger(body.expectedContentRevision) || (body.expectedContentRevision as number) < 0
    || !Number.isSafeInteger(body.expectedOptionRevision) || (body.expectedOptionRevision as number) < 0)
    throw Error('상품·SEO·옵션 저장 버전을 확인해주세요.');
  const input: SeoWorkspaceInput = { expectedProductVersion: body.expectedProductVersion, expectedContentRevision: body.expectedContentRevision as number, expectedOptionRevision: body.expectedOptionRevision as number };
  if (Object.hasOwn(body, 'seo')) {
    const rawSeo = body.seo;
    if (!rawSeo || typeof rawSeo !== 'object' || Array.isArray(rawSeo)
      || Object.keys(rawSeo).some(key => !['title', 'keywords', 'description', 'keywordText'].includes(key))) throw Error('SEO 저장 항목을 확인해주세요.');
    const value = rawSeo as Record<string, unknown>, hasKeywordText = Object.hasOwn(value, 'keywordText');
    const { keywordText, keywords, ...other } = value;
    const contentSeo = hasKeywordText ? other : { ...other, ...(Object.hasOwn(value, 'keywords') ? { keywords } : {}) };
    const seo: NonNullable<SeoWorkspaceInput['seo']> = Object.keys(contentSeo).length
      ? validateContentInput({ expectedRevision: input.expectedContentRevision, patch: { seo: contentSeo } }, [], '').patch.seo! : {};
    if (hasKeywordText) {
      if (typeof keywordText !== 'string') throw Error('검색태그 원문을 확인해주세요.');
      const prepared = prepareSeoKeywordText(keywordText);
      const cleaned = cleanSeoKeywordCandidates(prepared.keywords);
      if (Object.hasOwn(value, 'keywords') && (!Array.isArray(keywords) || keywords.some(item => typeof item !== 'string')
        || JSON.stringify(keywords) !== JSON.stringify(cleaned))) throw Error('검색태그 원문과 저장 목록이 일치하지 않습니다.');
      seo.keywordText = keywordText; seo.keywords = cleaned;
    }
    if (!Object.keys(seo).length) throw Error('저장할 SEO 항목을 선택해주세요.');
    if (seo.title !== undefined && seo.title.length > 100) throw Error('SEO 상품명은 100자 이내로 입력해주세요.');
    if (!hasKeywordText && seo.keywords !== undefined && seo.keywords.join(', ').length > 150) throw Error('검색태그는 쉼표 구분을 포함해 150자 이내로 입력해주세요.');
    input.seo = seo;
  }
  if (Object.hasOwn(body, 'optionNames')) input.optionNames = validateOptionNamesInput({
    expectedProductVersion: input.expectedProductVersion, expectedRevision: input.expectedOptionRevision, changes: body.optionNames,
  }).changes;
  if (!input.seo && !input.optionNames) throw Error('저장할 상품명·검색태그 또는 옵션명을 입력해주세요.');
  return input;
}

/** Absent sections remain identical, including their provenance and clocks. */
export function applySeoWorkspaceChanges(before: SeoWorkspaceView, input: SeoWorkspaceInput, now: string): SeoWorkspaceView {
  if (before.productVersion !== input.expectedProductVersion || before.content.revision !== input.expectedContentRevision || before.options.revision !== input.expectedOptionRevision)
    throw new SeoWorkspaceConflict('상품·SEO·옵션이 변경되었습니다. 수정한 입력은 유지하고 저장본을 확인해주세요.');
  if (before.content.productId !== before.productId || before.options.productId !== before.productId || !Number.isFinite(Date.parse(now)) || Date.parse(now) <= Date.parse(before.productVersion))
    throw Error('같은 상품의 최신 SEO 저장 자료를 확인해주세요.');
  const content = input.seo ? applyContentPatch(before.content, { seo: input.seo }, now) : before.content;
  applySeoDocumentTitlePolicy(content, input.seo);
  if (input.seo?.keywordText !== undefined) {
    const keywords = content.seo.keywords.value;
    content.seoKeywordDocument = { policy: 'couplus-service-v1', sourceKeywords: [...keywords], sourceUpdatedAt: now,
      value: keywords.length ? seoKeywordDocumentText(keywords) : quotationSeoKeywordText(before.content) };
  }
  return { ...before, productVersion: now,
    content,
    options: input.optionNames ? applyOptionNameChanges(before.options, input.optionNames, now) : before.options,
  };
}
