import { env } from 'cloudflare:workers';
import { sourceGuard, type QuotationSourceGuard } from '@/db/quotation-fields';
import { parseStoredSupplierHubReceipt, supplierHubReceiptSummary, supplierHubReceiptObservationTime, supplierHubReceiptOrder, type SupplierHubReceipt, type SupplierHubReceiptSummary } from '@/app/supplier-hub-receipt';

async function database(){
  if(!env.DB)throw new Error('D1 unavailable');
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS supplier_hub_receipts (
    owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id), fingerprint TEXT NOT NULL,
    observed_at INTEGER NOT NULL, evidence_order INTEGER NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY(owner_id,product_id,fingerprint)
  )`).run();
  return env.DB;
}
/** Save an observation without changing product versions or invalidating its XLSX. */
export async function saveSupplierHubReceipt(owner:string,productId:string,receipt:SupplierHubReceipt,source:QuotationSourceGuard,quotationRevision:number){
  const db=await database(),guard=sourceGuard(owner,productId,source);
  const row=await db.prepare(`INSERT INTO supplier_hub_receipts(owner_id,product_id,fingerprint,observed_at,evidence_order,payload)
    SELECT p.owner_id,p.id,?,?,?,? FROM products p WHERE ${guard.sql}
      AND COALESCE((SELECT revision FROM product_quotation_fields WHERE product_id=p.id AND owner_id=p.owner_id),0)=?
    ON CONFLICT(owner_id,product_id,fingerprint) DO UPDATE SET observed_at=excluded.observed_at,evidence_order=excluded.evidence_order,payload=excluded.payload
      WHERE (excluded.observed_at>supplier_hub_receipts.observed_at
        OR excluded.observed_at=supplier_hub_receipts.observed_at AND excluded.evidence_order>supplier_hub_receipts.evidence_order)
      AND (json_extract(supplier_hub_receipts.payload,'$.result.quotationId') IS NULL
        OR json_extract(supplier_hub_receipts.payload,'$.result.quotationId')=json_extract(excluded.payload,'$.result.quotationId'))
      AND NOT (excluded.evidence_order=1 AND supplier_hub_receipts.evidence_order>1)
    RETURNING fingerprint`).bind(receipt.fingerprint,supplierHubReceiptObservationTime(receipt.result),supplierHubReceiptOrder(receipt.result),JSON.stringify(receipt),...guard.args,quotationRevision).first();
  if(row)return true;
  // Equal/older repeated observations are harmless, but a changed saved source is not.
  return Boolean(await db.prepare(`SELECT p.id FROM products p WHERE ${guard.sql}
    AND COALESCE((SELECT revision FROM product_quotation_fields WHERE product_id=p.id AND owner_id=p.owner_id),0)=?
    AND EXISTS(SELECT 1 FROM supplier_hub_receipts r WHERE r.owner_id=p.owner_id AND r.product_id=p.id AND r.fingerprint=?
      AND (json_extract(r.payload,'$.result.quotationId') IS NULL OR json_extract(r.payload,'$.result.quotationId') IS ?))`)
    .bind(...guard.args,quotationRevision,receipt.fingerprint,receipt.result.quotationId??null).first());
}
export async function readSupplierHubReceipt(owner:string,productId:string,fingerprint:string):Promise<SupplierHubReceipt|null>{
  const db=await database();
  const row=await db.prepare('SELECT payload FROM supplier_hub_receipts WHERE owner_id=? AND product_id=? AND fingerprint=?').bind(owner,productId,fingerprint).first<{payload:string}>();
  return row?parseStoredSupplierHubReceipt(row.payload):null;
}
/** Latest submitted draft is deliberately separate from the current editable draft. */
export async function readSupplierHubReceiptSummaries(owner:string,products:{id:string}[]){
  const summaries:Record<string,SupplierHubReceiptSummary|null>={};
  if(!products.length)return summaries;
  const db=await database();
  for(let offset=0;offset<products.length;offset+=80){
    const ids=products.slice(offset,offset+80).map(product=>product.id);
    const rows=await db.prepare(`SELECT r.product_id,r.payload FROM supplier_hub_receipts r
      WHERE r.owner_id=? AND r.product_id IN (${ids.map(()=>'?').join(',')})
      AND r.fingerprint=(SELECT latest.fingerprint FROM supplier_hub_receipts latest
        WHERE latest.owner_id=r.owner_id AND latest.product_id=r.product_id ORDER BY latest.observed_at DESC,latest.fingerprint DESC LIMIT 1)`)
      .bind(owner,...ids).all<{product_id:string;payload:string}>();
    for(const row of rows.results){try{summaries[row.product_id]=supplierHubReceiptSummary(parseStoredSupplierHubReceipt(row.payload));}catch{summaries[row.product_id]=null;}}
  }
  return summaries;
}
