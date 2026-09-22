import { env } from 'cloudflare:workers';
import type { ProductContent } from '@/app/product-content';

/** The caller reads content, and options when guarded, to ensure their tables exist. */
export async function attachProductDocument(ownerId: string, input: {
  productId: string; expectedVersion: string; expectedContentRevision: number; previousImageKeys: string;
  imageKeys: string[]; content: ProductContent; productVersion: string; contentMutated: boolean;
  expectedOptionRevision?: number;
}) {
  if (!env.DB || input.content.revision !== input.expectedContentRevision + (input.contentMutated ? 1 : 0)) throw new Error('Invalid attachment storage request.');
  const guardOptions = input.expectedOptionRevision !== undefined;
  if (guardOptions && (!Number.isSafeInteger(input.expectedOptionRevision) || input.expectedOptionRevision! < 0)) throw new Error('Invalid attachment option revision.');
  // Optional SQL keeps label/plain attachments compatible with workspaces that
  // have never opened options. For size documents the comparison is atomic with
  // the content/key writes, including an explicitly absent options row at rev 0.
  const optionsGuard = guardOptions ? `AND ((?=0 AND NOT EXISTS(SELECT 1 FROM product_options WHERE product_id=?))
    OR EXISTS(SELECT 1 FROM product_options WHERE product_id=? AND owner_id=? AND revision=?))` : '';
  const optionsArgs = guardOptions ? [input.expectedOptionRevision!, input.productId, input.productId, ownerId, input.expectedOptionRevision!] : [];
  if (!input.contentMutated) {
    const result = await env.DB.batch<{ id: string }>([env.DB.prepare(`UPDATE products SET image_keys=?,quote_status='대기',updated_at=?
      WHERE id=? AND owner_id=? AND updated_at=? AND image_keys=?
      AND ((?=0 AND NOT EXISTS(SELECT 1 FROM product_content WHERE product_id=?))
        OR EXISTS(SELECT 1 FROM product_content WHERE product_id=? AND owner_id=? AND revision=?)) ${optionsGuard} RETURNING id`)
      .bind(JSON.stringify(input.imageKeys), input.productVersion, input.productId, ownerId, input.expectedVersion, input.previousImageKeys,
        input.expectedContentRevision, input.productId, input.productId, ownerId, input.expectedContentRevision, ...optionsArgs)]);
    return result[0].results[0] ? { content: input.content, imageKeys: input.imageKeys, productVersion: input.productVersion } : null;
  }
  if (!input.content.updatedAt) throw new Error('Invalid content timestamp.');
  const result = await env.DB.batch<{ payload: string }>([
    env.DB.prepare(`INSERT INTO product_content(product_id,owner_id,revision,payload,updated_at)
      SELECT id,owner_id,?,?,? FROM products WHERE id=? AND owner_id=? AND updated_at=? AND image_keys=?
      ${optionsGuard}
      AND (?=0 OR EXISTS(SELECT 1 FROM product_content WHERE product_id=? AND owner_id=? AND revision=?))
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at
      WHERE product_content.owner_id=excluded.owner_id AND product_content.revision=? RETURNING payload`)
      .bind(input.content.revision, JSON.stringify(input.content), input.content.updatedAt, input.productId, ownerId, input.expectedVersion, input.previousImageKeys,
        ...optionsArgs, input.expectedContentRevision, input.productId, ownerId, input.expectedContentRevision, input.expectedContentRevision),
    env.DB.prepare(`UPDATE products SET image_keys=?,quote_status='대기',updated_at=?
      WHERE id=? AND owner_id=? AND updated_at=? AND image_keys=? AND changes()=1
      AND EXISTS(SELECT 1 FROM product_content WHERE product_id=? AND owner_id=? AND revision=?) ${optionsGuard}`)
      .bind(JSON.stringify(input.imageKeys), input.productVersion, input.productId, ownerId, input.expectedVersion, input.previousImageKeys,
        input.productId, ownerId, input.content.revision, ...optionsArgs),
  ]);
  return result[0].results[0] ? { content: input.content, imageKeys: input.imageKeys, productVersion: input.productVersion } : null;
}
