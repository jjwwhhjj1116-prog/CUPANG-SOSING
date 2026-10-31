import { freeImageEditDigest, MAX_FREE_IMAGE_EDIT_RECORD_BYTES, prepareFreeImageEditRecord, type FreeImageEditRecord } from '@/app/free-image-edit-record';
import { freeImageSourceIdentity, validateFreeImageSource } from '@/app/free-image-translation';
import { isOwnedImageKey, MAX_IMAGE_BYTES } from '@/app/image-files';
import { PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-pool-limit';
import { readBoundedStream } from '@/app/request-body';
import { supplierHubCompany } from '@/app/supplier-hub-company';

export type FreeImageEditReviewMetadata = { size: number; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> };
export type FreeImageEditReview = { format: 'free-image-edit-review-v1'; productId: string; key: string;
  status: 'clear' | 'unresolved' | 'unconfirmed'; unresolvedRegions: number | null };
type Bucket = Pick<R2Bucket, 'head' | 'get'>;
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/u.test(value);
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => Boolean(value && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));

/** A filename selects the records to inspect; it is never proof of completion. */
export function isFreeImageEditOutputKey(owner: string, key: unknown): key is string {
  return isOwnedImageKey(owner, key) && key.slice(owner.length + 1).startsWith('free-image-');
}
function validContext(value: unknown): value is FreeImageEditRecord['context'] {
  return exact(value, ['source', 'profileId', 'categoryId', 'categoryPath']) && ['profile', 'collection', 'unknown'].includes(String(value.source))
    && (value.profileId === null || identifier(value.profileId)) && (value.categoryId === null || identifier(value.categoryId))
    && (value.source !== 'profile' || value.profileId !== null) && Array.isArray(value.categoryPath) && value.categoryPath.length <= 40
    && value.categoryPath.every(part => typeof part === 'string' && Boolean(part.trim()) && part.length <= 500 && !/[\u0000-\u001f]/u.test(part))
    && (value.categoryId === null || value.categoryPath.length > 0);
}
const unconfirmed = (productId: string, key: string): FreeImageEditReview => ({ format: 'free-image-edit-review-v1', productId, key, status: 'unconfirmed', unresolvedRegions: null });

/** Read-only diagnostic of an exact selected output. HEAD binds the immutable
 * sidecar and image digest; only the bounded JSON sidecar is downloaded. This
 * is not an image-byte verification or authorization to submit a quotation.
 * The stored source role/category describe its creation, not its current
 * destination: an explicit cross-role/category reuse keeps the same pixels. */
export async function readFreeImageEditReview(bucket: Bucket, owner: string, productId: string, key: string,
  suppliedMetadata?: FreeImageEditReviewMetadata | null): Promise<FreeImageEditReview> {
  const unknown = unconfirmed(productId, key);
  if (!identifier(productId) || productId.length > 80 || !isFreeImageEditOutputKey(owner, key)
    || !new RegExp(`^free-image-(?:workspace-)?${productId}-[a-f0-9]{64}-[a-f0-9]{64}\\.png$`, 'u').test(key.slice(owner.length + 1))) return unknown;
  try {
    const metadata = suppliedMetadata === undefined ? await bucket.head(key) : suppliedMetadata, markers = metadata?.customMetadata;
    if (!metadata || !Number.isSafeInteger(metadata.size) || metadata.size < 1 || metadata.size > MAX_IMAGE_BYTES || metadata.httpMetadata?.contentType !== 'image/png'
      || !hash(markers?.freeImageEditDocumentSha256) || !hash(markers?.freeImageEditRecordSha256) || !hash(markers?.freeImageOutputSha256)
      || !hash(markers?.freeImageSourceSha256)) return unknown;
    const sidecar = await bucket.get(key + '.edit.json');
    if (!sidecar || !Number.isSafeInteger(sidecar.size) || sidecar.size < 1 || sidecar.size > MAX_FREE_IMAGE_EDIT_RECORD_BYTES
      || sidecar.httpMetadata?.contentType !== 'application/json') { void sidecar?.body?.cancel().catch(() => {}); return unknown; }
    const bytes = await readBoundedStream(sidecar.body, MAX_FREE_IMAGE_EDIT_RECORD_BYTES);
    if (bytes.length !== sidecar.size || await freeImageEditDigest(bytes) !== markers.freeImageEditRecordSha256) return unknown;
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!exact(value, ['format', 'source', 'document', 'context', 'company', 'result']) || value.format !== 'free-image-edit-record-v1'
      || !exact(value.result, ['key', 'sha256', 'bytes', 'width', 'height']) || !validContext(value.context)
      || !exact(value.company, ['code', 'name'])) return unknown;
    const company = supplierHubCompany(value.company.code, value.company.name);
    if (!company || company.code !== value.company.code || company.name !== value.company.name) return unknown;
    const source = validateFreeImageSource(value.source);
    if (source.productId !== productId || !isOwnedImageKey(owner, source.sourceKey) || source.editorSource && !isOwnedImageKey(owner, source.editorSource.resultKey)) return unknown;
    const prepared = await prepareFreeImageEditRecord(source, value.document, value.context, value.company as FreeImageEditRecord['company'], value.result as FreeImageEditRecord['result']);
    const record = prepared.record;
    if (record.result.key !== key || record.result.sha256 !== markers.freeImageOutputSha256 || record.result.bytes !== metadata.size
      || String(record.result.width) !== markers.imageWidth || String(record.result.height) !== markers.imageHeight
      || prepared.recordSha256 !== markers.freeImageEditRecordSha256 || prepared.documentSha256 !== markers.freeImageEditDocumentSha256
      || prepared.bytes.length !== bytes.length || await freeImageEditDigest(new TextEncoder().encode(freeImageSourceIdentity(record.source))) !== markers.freeImageSourceSha256) return unknown;
    const unresolvedRegions = record.document.regions.filter(region => Boolean(region.issue?.trim())).length;
    return { ...unknown, status: unresolvedRegions ? 'unresolved' : 'clear', unresolvedRegions };
  } catch { return unknown; }
}

/** Callers supply only effective included main/additional/detail references.
 * Deduplication, the product's 150-object bound and three readers keep listing
 * diagnostics bounded. A supplied metadata map is authoritative for this read:
 * an absent entry is unconfirmed, never permission for an extra HEAD request. */
export async function readFreeImageEditReviews(bucket: Bucket, owner: string, productId: string, keys: readonly string[],
  metadata?: ReadonlyMap<string, FreeImageEditReviewMetadata | null>): Promise<FreeImageEditReview[]> {
  const selected = [...new Set(keys.filter(key => isFreeImageEditOutputKey(owner, key)))];
  if (selected.length > PRODUCT_IMAGE_POOL_LIMIT) return selected.map(key => unconfirmed(productId, key));
  const reviews: FreeImageEditReview[] = [];
  for (let offset = 0; offset < selected.length; offset += 3) {
    reviews.push(...await Promise.all(selected.slice(offset, offset + 3).map(key => readFreeImageEditReview(bucket, owner, productId, key,
      metadata === undefined ? undefined : metadata.get(key) ?? null))));
  }
  return reviews;
}
