import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/db/queries';

export type ProductRemovalRecord = {
  product_id:string;owner_id:string;removed_at:string;product_version:string;
};

async function database() {
  await ensureDatabase();
  if (!env.DB) throw new Error('D1 binding DB is unavailable.');
  return env.DB;
}

/** Mark a current owned product as removed without changing its saved data. */
export async function removeProduct(ownerId:string,productId:string,expectedVersion:string) {
  const db=await database();
  return db.prepare(`INSERT INTO product_removals(product_id,owner_id,removed_at,product_version)
    SELECT p.id,p.owner_id,?,p.updated_at FROM products p
    WHERE p.id=? AND p.owner_id=? AND p.updated_at=?
      AND NOT EXISTS(SELECT 1 FROM product_removals r WHERE r.product_id=p.id)
    RETURNING product_id,owner_id,removed_at,product_version`)
    .bind(new Date().toISOString(),productId,ownerId,expectedVersion)
    .first<ProductRemovalRecord>();
}

/** Restore only the removal the caller saw and the current owned version. */
export async function restoreProduct(ownerId:string,productId:string,expectedVersion:string,expectedRemovedAt:string) {
  const db=await database();
  return db.prepare(`DELETE FROM product_removals
    WHERE product_id=? AND owner_id=? AND removed_at=?
      AND EXISTS(SELECT 1 FROM products p WHERE p.id=product_removals.product_id
        AND p.owner_id=product_removals.owner_id AND p.updated_at=?)
    RETURNING product_id,owner_id,removed_at,product_version`)
    .bind(productId,ownerId,expectedRemovedAt,expectedVersion)
    .first<ProductRemovalRecord>();
}
