import type { ProductContent } from '@/app/product-content';

export const SEO_KEYWORD_TEXT_LIMIT = 5050;
export const SEO_KEYWORD_SAVE_LIMIT = 150;

export type SeoKeywordText = { text: string; keywords: string[]; shortened: boolean; originalLength: number; removedTags: number };

/** Manual SEO uses commas and UTF-16 length. Drop complete trailing tags only
 * when the original input exceeds the save limit; preserve duplicate tags. */
export function prepareSeoKeywordText(raw: string): SeoKeywordText {
  if (typeof raw !== 'string' || raw.length > SEO_KEYWORD_TEXT_LIMIT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(raw))
    throw Error(`검색태그 입력은 ${SEO_KEYWORD_TEXT_LIMIT}자 이내의 텍스트로 확인해주세요.`);
  const parts = raw.split(',').map(value => value.trim());
  const shortened = raw.length > SEO_KEYWORD_SAVE_LIMIT;
  let text = raw, retained = parts.length;
  if (shortened) {
    retained = 0;
    let length = 0;
    for (const part of parts) {
      const next = length + (retained ? 2 : 0) + part.length;
      if (next > SEO_KEYWORD_SAVE_LIMIT) break;
      retained++; length = next;
    }
    text = parts.slice(0, retained).join(', ');
  }
  return { text, keywords: text.split(',').map(value => value.trim()).filter(Boolean), shortened,
    originalLength: raw.length, removedTags: shortened ? parts.slice(retained).filter(Boolean).length : 0 };
}

/** Preparation applied by the observed partial-update service, after the UI
 * comma/prefix pass. No split words, case folding or invented replacement. */
export function cleanSeoKeywordCandidates(values: readonly unknown[]): string[] {
  const keywords: string[] = [];
  for (const value of values) {
    const raw = String(value ?? '');
    if (/[ㄱ-ㅎㅏ-ㅣ]/u.test(raw)) continue;
    const normalized = raw.replace(/[^가-힣A-Za-z0-9 ]/gu, ' ').replace(/\s+/gu, ' ').trim();
    if (normalized && normalized.length <= 20 && !keywords.includes(normalized)) keywords.push(normalized);
  }
  return keywords;
}

/** The document keeps the longest prefix of complete service-cleaned tags. */
export function seoKeywordDocumentText(keywords: readonly string[]): string {
  let length = 0, count = 0;
  for (const word of keywords) {
    const next = length + (count ? 2 : 0) + word.length;
    if (next > SEO_KEYWORD_SAVE_LIMIT) break;
    count++; length = next;
  }
  return keywords.slice(0, count).join(', ');
}

/** Only the exact saved manual keyword basis supplies a prepared document
 * value; unrelated/legacy metadata and later edits retain their old contract. */
export function quotationSeoKeywordText(content: ProductContent): string {
  const field = content.seo.keywords, document = content.seoKeywordDocument;
  if (document?.policy === 'couplus-service-v1' && document.sourceUpdatedAt === field.updatedAt
    && Array.isArray(document.sourceKeywords) && document.sourceKeywords.length === field.value.length
    && document.sourceKeywords.every((word, index) => word === field.value[index])
    && typeof document.value === 'string' && document.value.length <= SEO_KEYWORD_TEXT_LIMIT
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(document.value)
    && (!field.value.length || document.value === seoKeywordDocumentText(field.value))) return document.value;
  return field.value.join(', ');
}
