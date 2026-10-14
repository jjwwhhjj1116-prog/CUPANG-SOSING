import type { ProductContent } from '@/app/product-content';
import { quotationOptionTitle } from '@/app/quotation-option-title';

/** An existing Couplus document is read directly after a manual SEO save;
 * comma + korName conversion is the missing-document fallback. Retain the
 * former fallback for legacy content and a later independent title writer. */
export function quotationSeoDocumentTitle(content: ProductContent, resolvedBaseTitle: string,
  option: { translatedName: string } | null | undefined): string {
  const document = content.seoTitleDocument;
  if (document && typeof document === 'object' && !Array.isArray(document)
    && Object.keys(document).length === 4
    && document.policy === 'couplus-seo-save-v1' && typeof document.sourceTitle === 'string'
    && (content.seo.title.value || content.seo.title.provenance === 'manual')
    && document.sourceTitle === content.seo.title.value && document.value === document.sourceTitle
    && document.sourceUpdatedAt === content.seo.title.updatedAt
    && (document.sourceUpdatedAt === null || typeof document.sourceUpdatedAt === 'string' && Number.isFinite(Date.parse(document.sourceUpdatedAt))))
    return document.value;
  return quotationOptionTitle(resolvedBaseTitle, option);
}
