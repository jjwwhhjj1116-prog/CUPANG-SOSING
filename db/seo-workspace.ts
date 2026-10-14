import { env } from 'cloudflare:workers';
import type { SeoWorkspaceInput, SeoWorkspaceView } from '@/app/seo-workspace';

/** Existing content/options tables have been read. One D1 batch commits both. */
export async function saveSeoWorkspace(owner: string, before: SeoWorkspaceView, next: SeoWorkspaceView, input: SeoWorkspaceInput, imageKeys: string): Promise<boolean> {
  if (!env.DB || before.productId !== next.productId || next.productVersion === before.productVersion
    || next.content.revision !== before.content.revision + (input.seo ? 1 : 0)
    || next.options.revision !== before.options.revision + (input.optionNames ? 1 : 0)
    || input.seo && next.content.updatedAt !== next.productVersion || input.optionNames && next.options.updatedAt !== next.productVersion)
    throw Error('통합 SEO 저장 자료가 일치하지 않습니다.');
  const id = before.productId, now = next.productVersion, db = env.DB;
  const statements = [db.prepare(`UPDATE products SET updated_at=?,quote_status='대기'
    WHERE id=? AND owner_id=? AND updated_at=? AND image_keys=?
    AND NOT EXISTS(SELECT 1 FROM product_removals WHERE product_id=products.id AND owner_id=products.owner_id)
    AND NOT EXISTS(SELECT 1 FROM product_content WHERE product_id=products.id AND owner_id<>products.owner_id)
    AND NOT EXISTS(SELECT 1 FROM product_options WHERE product_id=products.id AND owner_id<>products.owner_id)
    AND COALESCE((SELECT revision FROM product_content WHERE product_id=products.id AND owner_id=products.owner_id),0)=?
    AND COALESCE((SELECT revision FROM product_options WHERE product_id=products.id AND owner_id=products.owner_id),0)=?
    RETURNING id`).bind(now, id, owner, before.productVersion, imageKeys, before.content.revision, before.options.revision)];
  if (input.seo) statements.push(db.prepare(`INSERT INTO product_content(product_id,owner_id,revision,payload,updated_at)
    SELECT ?,?,?,?,? WHERE changes()=1
    ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at`)
    .bind(id, owner, next.content.revision, JSON.stringify(next.content), now));
  if (input.optionNames) statements.push(db.prepare(`INSERT INTO product_options(product_id,owner_id,revision,payload,updated_at)
    SELECT ?,?,?,?,? WHERE changes()=1
    ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at`)
    .bind(id, owner, next.options.revision, JSON.stringify(next.options), now));
  const result = await db.batch(statements);
  return result[0].results.length === 1;
}
