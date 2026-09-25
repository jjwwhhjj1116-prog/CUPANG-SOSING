import { env } from 'cloudflare:workers';
import type { ProductContent } from '@/app/product-content';
import type { ProductOptions } from '@/app/product-options';

/** Existing tables are initialized by the source reads. D1 batch is atomic. */
export async function saveIntegratedTranslation(owner: string, content: ProductContent, options: ProductOptions, source: {
  productVersion: string; imageKeys: string; contentRevision: number; optionRevision: number; jobId: string;
}) {
  if (!env.DB || content.productId !== options.productId || !content.updatedAt || content.updatedAt !== options.updatedAt
    || content.revision !== source.contentRevision + 1 || options.revision !== source.optionRevision + 1) throw Error('통합 저장 자료가 일치하지 않습니다.');
  const id = content.productId, now = content.updatedAt;
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE products SET updated_at=?,quote_status='대기',options_count=?
      WHERE id=? AND owner_id=? AND updated_at=? AND image_keys=?
      AND NOT EXISTS(SELECT 1 FROM product_content c WHERE c.product_id=products.id AND c.owner_id<>products.owner_id)
      AND NOT EXISTS(SELECT 1 FROM product_options o WHERE o.product_id=products.id AND o.owner_id<>products.owner_id)
      AND COALESCE((SELECT revision FROM product_content WHERE product_id=? AND owner_id=?),0)=?
      AND COALESCE((SELECT revision FROM product_options WHERE product_id=? AND owner_id=?),0)=?
      AND EXISTS(SELECT 1 FROM translation_jobs WHERE id=? AND owner_id=? AND product_id=? AND status='completed' AND product_version=? AND content_revision=?)
      RETURNING id`).bind(now, options.rows.filter(row => row.included).length, id, owner, source.productVersion, source.imageKeys,
        id, owner, source.contentRevision, id, owner, source.optionRevision, source.jobId, owner, id, source.productVersion, source.contentRevision),
    env.DB.prepare(`INSERT INTO product_content(product_id,owner_id,revision,payload,updated_at)
      SELECT ?,?,?,?,? WHERE changes()=1
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at`)
      .bind(id, owner, content.revision, JSON.stringify(content), now),
    env.DB.prepare(`INSERT INTO product_options(product_id,owner_id,revision,payload,updated_at)
      SELECT ?,?,?,?,? WHERE changes()=1
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at`)
      .bind(id, owner, options.revision, JSON.stringify(options), now),
  ]);
  return Boolean(result[0].results.length);
}
