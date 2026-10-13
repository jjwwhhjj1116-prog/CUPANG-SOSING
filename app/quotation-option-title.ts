/** Observed Couplus convertToJsonDocument appends the selected saved korName.
 * Keep the two saved strings exact; do not substitute a source name, colour or
 * SKU, truncate a title, or restore a deliberately cleared SEO title. Manual
 * quotation titles are applied later by the existing override resolver. */
export function quotationOptionTitle(savedBaseTitle: string, option: { translatedName: string } | null | undefined): string {
  return savedBaseTitle && option?.translatedName ? `${savedBaseTitle}, ${option.translatedName}` : savedBaseTitle;
}
