import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/db/queries';
import { productRemovalDecisionFromReceipts, type ProductRemovalDecision, type ProductRemovalReceiptRow } from '@/app/product-removal-policy';
import { ensureSupplierHubReceiptDatabase } from '@/db/supplier-hub-receipts';

export type ProductRemovalRecord = {
  product_id:string;owner_id:string;removed_at:string;product_version:string;
};

async function database() {
  await ensureDatabase();
  if (!env.DB) throw new Error('D1 binding DB is unavailable.');
  await ensureSupplierHubReceiptDatabase();
  return env.DB;
}

async function receiptRows(ownerId:string,products:readonly {id:string}[],existingDb?:Awaited<ReturnType<typeof database>>) {
  const rows:Record<string,ProductRemovalReceiptRow[]>=Object.fromEntries(products.map(product=>[product.id,[]]));
  if(!products.length)return rows;
  const db=existingDb??await database();
  for(let offset=0;offset<products.length;offset+=80){
    const ids=products.slice(offset,offset+80).map(product=>product.id);
    const saved=await db.prepare(`SELECT product_id,fingerprint,payload,observed_at,evidence_order FROM supplier_hub_receipts
      WHERE owner_id=? AND product_id IN (${ids.map(()=>'?').join(',')})`).bind(ownerId,...ids).all<ProductRemovalReceiptRow & {product_id:string}>();
    for(const row of saved.results)if(Object.hasOwn(rows,row.product_id))rows[row.product_id].push({fingerprint:row.fingerprint,payload:row.payload,observed_at:row.observed_at,evidence_order:row.evidence_order});
  }
  return rows;
}

/** Historical accepted/pending evidence remains protected after draft edits. */
export async function readProductRemovalPolicies(ownerId:string,products:readonly {id:string}[]):Promise<Record<string,ProductRemovalDecision>> {
  const rows=await receiptRows(ownerId,products);
  return Object.fromEntries(products.map(product=>[product.id,productRemovalDecisionFromReceipts(rows[product.id])]));
}

/** Mark a current owned product as removed without changing its saved data. */
export async function removeProduct(ownerId:string,productId:string,expectedVersion:string) {
  const db=await database();
  const rows=(await receiptRows(ownerId,[{id:productId}],db))[productId];
  if(productRemovalDecisionFromReceipts(rows).blocked)return null;
  return db.prepare(`INSERT INTO product_removals(product_id,owner_id,removed_at,product_version)
    SELECT p.id,p.owner_id,?,p.updated_at FROM products p
    WHERE p.id=? AND p.owner_id=? AND p.updated_at=?
      AND NOT EXISTS(SELECT 1 FROM product_removals r WHERE r.product_id=p.id)
      AND NOT EXISTS(SELECT 1 FROM supplier_hub_receipts receipt
        WHERE receipt.owner_id=p.owner_id AND receipt.product_id=p.id
          AND NOT EXISTS(SELECT 1 FROM json_each(?) reviewed
            WHERE json_extract(reviewed.value,'$.fingerprint')=receipt.fingerprint
              AND json_extract(reviewed.value,'$.payload')=receipt.payload
              AND json_extract(reviewed.value,'$.observed_at')=receipt.observed_at
              AND json_extract(reviewed.value,'$.evidence_order')=receipt.evidence_order))
    RETURNING product_id,owner_id,removed_at,product_version`)
    .bind(new Date().toISOString(),productId,ownerId,expectedVersion,JSON.stringify(rows))
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
