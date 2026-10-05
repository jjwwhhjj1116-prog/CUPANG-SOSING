import type { CollectionResult } from '@/app/collection-result';
import type { ProductContent } from '@/app/product-content';
import type { ProductOptions } from '@/app/product-options';
import { isOwnedImageKey } from '@/app/image-files';

export type CollectedImageLink = { imageIndex: number; key: string };

/** Source images are editable collected drafts, never evidence of translation or review. */
export function collectedImageDraft(owner: string, receipt: CollectionResult, links: CollectedImageLink[], keys: string[], content: ProductContent, options: ProductOptions, now: string) {
  const nextContent = structuredClone(content), nextOptions = structuredClone(options);
  const available = new Map<number, string>();
  for (const link of links) {
    if (!Number.isInteger(link.imageIndex) || !receipt.images[link.imageIndex] || available.has(link.imageIndex) || !isOwnedImageKey(owner, link.key)) throw Error('수집 이미지 연결을 확인해주세요.');
    if (keys.includes(link.key)) available.set(link.imageIndex, link.key);
  }
  let changedRoles = 0, changedOptions = 0;
  for (const role of ['main', 'additional', 'detail'] as const) {
    const current = content.assets[role];
    if (!['unverified', 'collected'].includes(current.provenance) || current.provenance === 'unverified' && current.value.length) continue;
    const candidates = [...new Set(receipt.images.flatMap((image, index) => image.role === role && available.has(index) ? [available.get(index)!] : []))];
    // A prior non-receipt reference or removed file is existing work, not an
    // invitation to replace the entire field with these source images.
    if (current.value.some(key => !candidates.includes(key))) continue;
    const elsewhere = new Set(Object.entries(nextContent.assets).flatMap(([name, field]) => name === role ? [] : field.value));
    const value = candidates.filter(key => !elsewhere.has(key)).slice(0, role === 'main' ? 1 : 30);
    if (JSON.stringify(value) === JSON.stringify(current.value)) continue;
    nextContent.assets[role] = { value, provenance: 'collected', updatedAt: now };
    changedRoles++;
  }
  const sourceCounts = new Map<string, number>(), optionCounts = new Map<string, number>();
  for (const row of receipt.options) sourceCounts.set(row.sku, (sourceCounts.get(row.sku) ?? 0) + 1);
  for (const row of options.rows) optionCounts.set(row.supplierSku, (optionCounts.get(row.supplierSku) ?? 0) + 1);
  for (const row of nextOptions.rows) {
    if (!row.included || row.provenance.supplierSku !== 'collected' || row.provenance.imageKey !== 'unverified' || row.imageKey || sourceCounts.get(row.supplierSku) !== 1 || optionCounts.get(row.supplierSku) !== 1) continue;
    const source = receipt.options.find(value => value.sku === row.supplierSku);
    const key = source?.imageIndex === undefined ? undefined : available.get(source.imageIndex);
    if (!key) continue;
    row.imageKey = key; row.provenance.imageKey = 'collected'; row.updatedAt = now; changedOptions++;
  }
  if (changedRoles) { nextContent.revision++; nextContent.updatedAt = now; }
  if (changedOptions) { nextOptions.revision++; nextOptions.updatedAt = now; }
  return { content: nextContent, options: nextOptions, changedRoles, changedOptions };
}
