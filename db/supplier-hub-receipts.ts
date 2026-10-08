import { env } from 'cloudflare:workers';
import { sourceGuard, type QuotationSourceGuard } from '@/db/quotation-fields';
import { parseStoredSupplierHubReceipt, supplierHubReceiptSummary, supplierHubReceiptObservationTime, supplierHubReceiptOrder, type SupplierHubReceipt, type SupplierHubReceiptSummary } from '@/app/supplier-hub-receipt';
import { supplierHubTransmissionHistory } from '@/app/supplier-hub-transmission-history';

async function database(){
  if(!env.DB)throw new Error('D1 unavailable');
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS supplier_hub_receipts (
    owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id), fingerprint TEXT NOT NULL,
    observed_at INTEGER NOT NULL, evidence_order INTEGER NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY(owner_id,product_id,fingerprint)
  )`).run();
  return env.DB;
}
export { database as ensureSupplierHubReceiptDatabase };
/** Save an observation without changing product versions or invalidating its XLSX. */
export async function saveSupplierHubReceipt(owner:string,productId:string,receipt:SupplierHubReceipt,source:QuotationSourceGuard,quotationRevision:number){
  const db=await database(),guard=sourceGuard(owner,productId,source);
  // Hub pending rows carry an empty ID. Pin only an ID that has been assigned.
  const row=await db.prepare(`INSERT INTO supplier_hub_receipts(owner_id,product_id,fingerprint,observed_at,evidence_order,payload)
    SELECT p.owner_id,p.id,?,?,?,? FROM products p WHERE ${guard.sql}
      AND COALESCE((SELECT revision FROM product_quotation_fields WHERE product_id=p.id AND owner_id=p.owner_id),0)=?
    ON CONFLICT(owner_id,product_id,fingerprint) DO UPDATE SET observed_at=excluded.observed_at,evidence_order=excluded.evidence_order,payload=excluded.payload
      WHERE (excluded.observed_at>supplier_hub_receipts.observed_at
        OR excluded.observed_at=supplier_hub_receipts.observed_at AND excluded.evidence_order>supplier_hub_receipts.evidence_order)
      AND (NULLIF(json_extract(supplier_hub_receipts.payload,'$.result.quotationId'),'') IS NULL
        OR json_extract(supplier_hub_receipts.payload,'$.result.quotationId')=json_extract(excluded.payload,'$.result.quotationId'))
      AND NOT (excluded.evidence_order=1 AND supplier_hub_receipts.evidence_order>1)
    RETURNING fingerprint`).bind(receipt.fingerprint,supplierHubReceiptObservationTime(receipt.result),supplierHubReceiptOrder(receipt.result),JSON.stringify(receipt),...guard.args,quotationRevision).first();
  if(row)return true;
  // Equal/older repeated observations are harmless, but a changed saved source is not.
  return Boolean(await db.prepare(`SELECT p.id FROM products p WHERE ${guard.sql}
    AND COALESCE((SELECT revision FROM product_quotation_fields WHERE product_id=p.id AND owner_id=p.owner_id),0)=?
    AND EXISTS(SELECT 1 FROM supplier_hub_receipts r WHERE r.owner_id=p.owner_id AND r.product_id=p.id AND r.fingerprint=?
      AND (NULLIF(json_extract(r.payload,'$.result.quotationId'),'') IS NULL OR json_extract(r.payload,'$.result.quotationId') IS ?))`)
    .bind(...guard.args,quotationRevision,receipt.fingerprint,receipt.result.quotationId??null).first());
}
export async function readSupplierHubReceipt(owner:string,productId:string,fingerprint:string):Promise<SupplierHubReceipt|null>{
  const db=await database();
  const row=await db.prepare('SELECT fingerprint,payload FROM supplier_hub_receipts WHERE owner_id=? AND product_id=? AND fingerprint=?').bind(owner,productId,fingerprint).first<{fingerprint:string;payload:string}>();
  if(!row)return null;
  const receipt=parseStoredSupplierHubReceipt(row.payload);
  if(receipt.fingerprint!==row.fingerprint)throw Error('전송 기록의 확인값이 다릅니다.');
  return receipt;
}
/** Read every draft identity for one owned product; never infer an empty history from a partial read. */
export async function readSupplierHubTransmissionHistory(owner:string,productId:string){
  const db=await database();
  const rows=await db.prepare(`SELECT fingerprint,payload FROM supplier_hub_receipts
    WHERE owner_id=? AND product_id=? ORDER BY observed_at DESC,fingerprint DESC LIMIT 201`).bind(owner,productId).all<{fingerprint:string;payload:string}>();
  if(rows.results.length>200)throw Error('상품의 전체 전송 이력 조회 범위를 초과했습니다.');
  const receipts=rows.results.map(row=>{const receipt=parseStoredSupplierHubReceipt(row.payload);if(receipt.fingerprint!==row.fingerprint)throw Error('전송 이력의 확인값이 다릅니다.');return receipt;});
  return supplierHubTransmissionHistory(productId,receipts);
}
/** Refresh an already stored receipt after the editable draft changed, without changing that draft. */
export async function saveHistoricalSupplierHubReceipt(owner:string,productId:string,receipt:SupplierHubReceipt,previous:SupplierHubReceipt,productVersion:string){
  if(receipt.schemaVersion!==previous.schemaVersion||receipt.evidence!==previous.evidence||receipt.fingerprint!==previous.fingerprint
    ||receipt.profileId!==previous.profileId||receipt.categoryId!==previous.categoryId||receipt.productVersion!==previous.productVersion)throw Error('원래 전송 기록의 연결값이 바뀌었습니다.');
  const db=await database();
  const previousPayload=JSON.stringify(previous),payload=JSON.stringify(receipt);
  const row=await db.prepare(`UPDATE supplier_hub_receipts SET observed_at=?,evidence_order=?,payload=?
    WHERE owner_id=? AND product_id=? AND fingerprint=? AND payload=?
      AND EXISTS(SELECT 1 FROM products p WHERE p.id=supplier_hub_receipts.product_id AND p.owner_id=supplier_hub_receipts.owner_id AND p.updated_at=?
        AND NOT EXISTS(SELECT 1 FROM product_removals r WHERE r.product_id=p.id AND r.owner_id=p.owner_id))
      AND (? > observed_at OR ? = observed_at AND ? > evidence_order)
      AND (NULLIF(json_extract(payload,'$.result.quotationId'),'') IS NULL
        OR json_extract(payload,'$.result.quotationId')=json_extract(?,'$.result.quotationId'))
      AND NOT (?=1 AND evidence_order>1)
    RETURNING fingerprint`).bind(supplierHubReceiptObservationTime(receipt.result),supplierHubReceiptOrder(receipt.result),payload,
      owner,productId,receipt.fingerprint,previousPayload,productVersion,
      supplierHubReceiptObservationTime(receipt.result),supplierHubReceiptObservationTime(receipt.result),supplierHubReceiptOrder(receipt.result),payload,supplierHubReceiptOrder(receipt.result)).first();
  if(row)return true;
  // Equal or older repeated observations are harmless only while the pinned draft and receipt remain unchanged.
  return Boolean(await db.prepare(`SELECT p.id FROM products p JOIN supplier_hub_receipts r ON r.product_id=p.id AND r.owner_id=p.owner_id
    WHERE p.id=? AND p.owner_id=? AND p.updated_at=? AND r.fingerprint=? AND r.payload=?
      AND r.observed_at>=? AND NOT EXISTS(SELECT 1 FROM product_removals removed WHERE removed.product_id=p.id AND removed.owner_id=p.owner_id)`)
    .bind(productId,owner,productVersion,previous.fingerprint,previousPayload,supplierHubReceiptObservationTime(receipt.result)).first());
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
