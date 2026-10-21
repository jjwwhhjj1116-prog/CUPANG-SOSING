import { validateCollectionResult, type CollectionResult } from '@/app/collection-result';
import type { ProductOptions, OptionInput } from '@/app/product-options';
import type { CollectionJob } from '@/app/sourcing';

/** Server-issued at the first product import only. A page key is never a SKU. */
export type CollectedPageOptionBindings = {
  format: 'yoofam-collected-page-option-bindings-v1'; ownerId: string; productId: string; jobId: string;
  sourceUrl: string; offerId: string; receiptFingerprint: string;
  rows: { optionId: string; sourceIndex: number; sourceKey: string }[];
};
// findCollectionJob is already owner-scoped and omits owner_id from its view;
// storage readers may additionally provide it and must match when present.
type SourceJob = Pick<CollectionJob, 'id' | 'source_url' | 'offer_id'> & { owner_id?: string };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/u.test(value);
// Match the existing image namespace contract, including cf:<hash> owners.
const ownerId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\/\\\u0000-\u0020%?#]/u.test(value);
async function sourceFingerprint(source: CollectionResult) {
  const { offerId, ...body } = source, validated = validateCollectionResult(body, offerId);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(validated))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function binding(value: unknown, productId: string): CollectedPageOptionBindings | null {
  if (!object(value) || !keys(value, ['format', 'ownerId', 'productId', 'jobId', 'sourceUrl', 'offerId', 'receiptFingerprint', 'rows'])
    || value.format !== 'yoofam-collected-page-option-bindings-v1' || value.productId !== productId || !ownerId(value.ownerId) || !id(value.jobId)
    || typeof value.sourceUrl !== 'string' || typeof value.offerId !== 'string' || typeof value.receiptFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(value.receiptFingerprint)
    || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 200) return null;
  const optionIds = new Set(), sourceKeys = new Set(), indices = new Set();
  for (const row of value.rows) {
    if (!object(row) || !keys(row, ['optionId', 'sourceIndex', 'sourceKey']) || !Number.isInteger(row.sourceIndex) || (row.sourceIndex as number) < 0 || (row.sourceIndex as number) >= 200
      || row.optionId !== `collected-${(row.sourceIndex as number) + 1}` || typeof row.sourceKey !== 'string' || !row.sourceKey.trim() || row.sourceKey !== row.sourceKey.trim() || row.sourceKey.length > 200
      || /[\u0000-\u001f\u007f]/u.test(row.sourceKey) || optionIds.has(row.optionId) || sourceKeys.has(row.sourceKey) || indices.has(row.sourceIndex)) return null;
    optionIds.add(row.optionId); sourceKeys.add(row.sourceKey); indices.add(row.sourceIndex);
  }
  return value as CollectedPageOptionBindings;
}
/** Validate the creation contract before any product transaction is written. */
export async function issueCollectedPageOptionBindings(owner: string, job: SourceJob, receipt: CollectionResult, options: ProductOptions): Promise<void> {
  if (!receipt.pageOptionIdentity || !receipt.options.some(row => row.sku === '')) return;
  if ((job.owner_id !== undefined && job.owner_id !== owner) || !ownerId(owner) || !id(job.id) || job.source_url !== receipt.sourceUrl || job.offer_id !== receipt.offerId
    || options.revision !== 1 || !id(options.productId) || options.rows.length !== receipt.options.length || options.collectedPageOptionBindings !== undefined) throw Error('최초 수집 옵션 연결을 확인해주세요.');
  const fingerprint = await sourceFingerprint(receipt);
  for (const [index, source] of receipt.options.entries()) {
    const row = options.rows[index];
    if (row.id !== `collected-${index + 1}` || row.originalName !== source.name || row.supplierSku !== source.sku || row.unitCostCny !== source.unitPriceCny
      || row.provenance.originalName !== 'collected' || row.provenance.unitCostCny !== 'collected' || row.imageKey !== null || row.provenance.imageKey !== 'unverified') throw Error('최초 수집 옵션의 원문 연결이 다릅니다.');
  }
  options.collectedPageOptionBindings = { format: 'yoofam-collected-page-option-bindings-v1', ownerId: owner, productId: options.productId, jobId: job.id,
    sourceUrl: receipt.sourceUrl, offerId: receipt.offerId, receiptFingerprint: fingerprint,
    rows: receipt.options.flatMap((row, sourceIndex) => row.sku === '' ? [{ optionId: options.rows[sourceIndex].id, sourceIndex, sourceKey: receipt.pageOptionIdentity!.sourceKeys[sourceIndex] }] : []) };
}
/** Only the first import's stored binding can resolve anonymous option images.
 * Current row order, matching names and a coincidental URL never create proof. */
export async function collectedPageOptionImageIndices(owner: string, job: SourceJob, receipt: CollectionResult, options: ProductOptions): Promise<Map<string, number>> {
  const result = new Map<string, number>(), proof = binding(options.collectedPageOptionBindings, options.productId);
  if (!proof || !object(receipt) || proof.ownerId !== owner || proof.jobId !== job.id || (job.owner_id !== undefined && job.owner_id !== owner) || proof.sourceUrl !== job.source_url || proof.offerId !== job.offer_id
    || receipt.sourceUrl !== proof.sourceUrl || receipt.offerId !== proof.offerId || !receipt.pageOptionIdentity) return result;
  try { if (proof.receiptFingerprint !== await sourceFingerprint(receipt)) return result; } catch { return result; }
  const counts = new Map<string, number>(); for (const row of options.rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  for (const entry of proof.rows) {
    const source = receipt.options[entry.sourceIndex], row = options.rows.find(row => row.id === entry.optionId);
    if (!source || source.sku !== '' || receipt.pageOptionIdentity.sourceKeys[entry.sourceIndex] !== entry.sourceKey) return new Map();
    if (!row || counts.get(row.id) !== 1 || row.supplierSku !== '' || row.provenance.supplierSku !== 'unverified'
      || row.originalName !== source.name || row.provenance.originalName !== 'collected' || source.imageIndex === undefined) continue;
    result.set(row.id, source.imageIndex);
  }
  return result;
}
/** Normal edits retain creation proof. Removed/re-created IDs, rewritten source
 * names or a changed supplier identity permanently lose their old binding. */
export function retainedCollectedPageOptionBindings(current: ProductOptions, rows: readonly OptionInput[]): CollectedPageOptionBindings | undefined {
  const proof = binding(current.collectedPageOptionBindings, current.productId); if (!proof) return;
  const retained = proof.rows.filter(entry => {
    const before = current.rows.filter(row => row.id === entry.optionId), after = rows.filter(row => row.id === entry.optionId);
    return before.length === 1 && after.length === 1 && before[0].provenance.originalName === 'collected' && before[0].supplierSku === ''
      && after[0].supplierSku === '' && after[0].originalName === before[0].originalName;
  });
  return retained.length ? { ...structuredClone(proof), rows: retained.map(row => ({ ...row })) } : undefined;
}
