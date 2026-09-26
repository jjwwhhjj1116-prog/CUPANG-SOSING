import type { BundleAsset } from '@/app/exports/review-bundle';
import { imageFileType, MAX_IMAGE_BYTES } from '@/app/image-files';

/** Local comparison of archived bytes. The fast bucket hash is not trusted as
 * proof: every candidate must also match byte-for-byte. No network requests. */
export function quotationAssetIdentities(assets: readonly BundleAsset[]): Map<string, string> {
  const identities = new Map<string, string>();
  const buckets = new Map<string, BundleAsset[]>();
  for (const asset of assets) {
    const bytes = asset.data;
    if (!bytes?.length || bytes.length > MAX_IMAGE_BYTES) continue;
    try { imageFileType(bytes); } catch { continue; }
    let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    const bucketKey = `${bytes.length}:${hash}`;
    const candidates = buckets.get(bucketKey) ?? [];
    const same = candidates.find(candidate => candidate.data.every((byte, index) => byte === bytes[index]));
    identities.set(asset.key, same?.key ?? asset.key);
    if (!same) { candidates.push(asset); buckets.set(bucketKey, candidates); }
  }
  return identities;
}
