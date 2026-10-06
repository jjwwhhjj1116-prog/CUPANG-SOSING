import { env } from 'cloudflare:workers';
import type { ProductContent } from '@/app/product-content';
import type { ProductOptions } from '@/app/product-options';

/** Explicit image adoption changes only the chosen matching option references.
 * Content, option references and the appended file commit in one D1 batch. */
export async function applyProductImageTranslation(ownerId: string, input: {
  productId: string; expectedVersion: string; expectedContentRevision: number; previousImageKeys: string;
  imageKeys: string[]; content: ProductContent; contentMutated: boolean; productVersion: string; options: ProductOptions;
  optionImageIds: string[]; sourceKey: string; outputKey: string;
}) {
  const { options, optionImageIds } = input;
  if (!env.DB || input.content.productId !== input.productId || input.content.revision !== input.expectedContentRevision + (input.contentMutated ? 1 : 0)
    || input.contentMutated && (!input.content.updatedAt || input.content.updatedAt !== input.productVersion)
    || options.productId !== input.productId || !Number.isSafeInteger(options.revision) || options.revision < 1
    || !optionImageIds.length || optionImageIds.length > 200 || new Set(optionImageIds).size !== optionImageIds.length
    || optionImageIds.some(id => !/^[A-Za-z0-9_-]{1,80}$/.test(id)) || input.sourceKey === input.outputKey) throw Error('Invalid option image attachment request.');
  const selected = new Set(optionImageIds);
  const matches = options.rows.filter(row => selected.has(row.id));
  if (matches.length !== selected.size || matches.some(row => row.imageKey !== input.sourceKey)) throw Error('Option image references changed.');
  const nextOptions: ProductOptions = {
    ...options, revision: options.revision + 1, updatedAt: input.productVersion,
    rows: options.rows.map(row => selected.has(row.id)
      ? { ...row, imageKey: input.outputKey, provenance: { ...row.provenance, imageKey: 'manual' as const }, updatedAt: input.productVersion }
      : row),
  };
  if (!input.contentMutated) {
    // Individual option photos need not occupy the common main role. Its
    // document and provenance remain byte-for-byte untouched in this branch.
    const result = await env.DB.batch<{ payload?: string; updated_at?: string }>([
      env.DB.prepare(`UPDATE product_options SET revision=?,payload=?,updated_at=?
        WHERE product_id=? AND owner_id=? AND revision=?
        AND EXISTS(SELECT 1 FROM products WHERE id=? AND owner_id=? AND updated_at=? AND image_keys=?)
        AND ((?=0 AND NOT EXISTS(SELECT 1 FROM product_content WHERE product_id=?))
          OR EXISTS(SELECT 1 FROM product_content WHERE product_id=? AND owner_id=? AND revision=?)) RETURNING payload`)
        .bind(nextOptions.revision, JSON.stringify(nextOptions), input.productVersion, input.productId, ownerId, options.revision,
          input.productId, ownerId, input.expectedVersion, input.previousImageKeys, input.expectedContentRevision, input.productId, input.productId, ownerId, input.expectedContentRevision),
      env.DB.prepare(`UPDATE products SET image_keys=?,quote_status='대기',updated_at=?
        WHERE id=? AND owner_id=? AND updated_at=? AND image_keys=? AND changes()=1
        AND EXISTS(SELECT 1 FROM product_options WHERE product_id=? AND owner_id=? AND revision=?)
        AND ((?=0 AND NOT EXISTS(SELECT 1 FROM product_content WHERE product_id=?))
          OR EXISTS(SELECT 1 FROM product_content WHERE product_id=? AND owner_id=? AND revision=?)) RETURNING updated_at`)
        .bind(JSON.stringify(input.imageKeys), input.productVersion, input.productId, ownerId, input.expectedVersion, input.previousImageKeys,
          input.productId, ownerId, nextOptions.revision, input.expectedContentRevision, input.productId, input.productId, ownerId, input.expectedContentRevision),
    ]);
    if (!result[0].results[0] && !result[1].results[0]) return null;
    if (!result[0].results[0] || !result[1].results[0]) throw Error('Option-only image attachment acknowledgement was incomplete.');
    return { content: input.content, imageKeys: input.imageKeys, productVersion: input.productVersion, optionRevision: nextOptions.revision };
  }
  const result = await env.DB.batch<{ payload?: string; updated_at?: string }>([
    env.DB.prepare(`INSERT INTO product_content(product_id,owner_id,revision,payload,updated_at)
      SELECT id,owner_id,?,?,? FROM products WHERE id=? AND owner_id=? AND updated_at=? AND image_keys=?
      AND EXISTS(SELECT 1 FROM product_options WHERE product_id=? AND owner_id=? AND revision=?)
      AND (?=0 OR EXISTS(SELECT 1 FROM product_content WHERE product_id=? AND owner_id=? AND revision=?))
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at
      WHERE product_content.owner_id=excluded.owner_id AND product_content.revision=? RETURNING payload`)
      .bind(input.content.revision, JSON.stringify(input.content), input.productVersion, input.productId, ownerId, input.expectedVersion, input.previousImageKeys,
        input.productId, ownerId, options.revision, input.expectedContentRevision, input.productId, ownerId, input.expectedContentRevision, input.expectedContentRevision),
    env.DB.prepare(`UPDATE product_options SET revision=?,payload=?,updated_at=?
      WHERE product_id=? AND owner_id=? AND revision=? AND changes()=1
      AND EXISTS(SELECT 1 FROM products WHERE id=? AND owner_id=? AND updated_at=? AND image_keys=?)
      AND EXISTS(SELECT 1 FROM product_content WHERE product_id=? AND owner_id=? AND revision=?) RETURNING payload`)
      .bind(nextOptions.revision, JSON.stringify(nextOptions), input.productVersion, input.productId, ownerId, options.revision,
        input.productId, ownerId, input.expectedVersion, input.previousImageKeys, input.productId, ownerId, input.content.revision),
    env.DB.prepare(`UPDATE products SET image_keys=?,quote_status='대기',updated_at=?
      WHERE id=? AND owner_id=? AND updated_at=? AND image_keys=? AND changes()=1
      AND EXISTS(SELECT 1 FROM product_content WHERE product_id=? AND owner_id=? AND revision=?)
      AND EXISTS(SELECT 1 FROM product_options WHERE product_id=? AND owner_id=? AND revision=?) RETURNING updated_at`)
      .bind(JSON.stringify(input.imageKeys), input.productVersion, input.productId, ownerId, input.expectedVersion, input.previousImageKeys,
        input.productId, ownerId, input.content.revision, input.productId, ownerId, nextOptions.revision),
  ]);
  if (!result[0].results[0] && !result[1].results[0] && !result[2].results[0]) return null;
  if (!result[0].results[0] || !result[1].results[0] || !result[2].results[0]) throw Error('Option image attachment acknowledgement was incomplete.');
  return { content: input.content, imageKeys: input.imageKeys, productVersion: input.productVersion, optionRevision: nextOptions.revision };
}
