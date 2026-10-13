import {env} from 'cloudflare:workers';
import {normalizeManagedProductHistory} from '@/app/managed-product-history';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import {ManagedProductContextChanged} from '@/app/managed-products';

export const managedProductHistorySchema=`CREATE TABLE IF NOT EXISTS managed_product_history (
 owner_id TEXT NOT NULL,company_code TEXT NOT NULL,sku_id TEXT NOT NULL,
 title TEXT NOT NULL,source_payload TEXT NOT NULL,source_name TEXT NOT NULL,source_sha256 TEXT NOT NULL,source_row INTEGER NOT NULL,
 first_imported_at TEXT NOT NULL,imported_at TEXT NOT NULL,payload TEXT NOT NULL,
 product_id_latest_at INTEGER,price_latest_at INTEGER,other_sellers INTEGER NOT NULL,source_import_price TEXT,source_import_value REAL,source_no_import INTEGER,
 PRIMARY KEY(owner_id,company_code,sku_id),FOREIGN KEY(owner_id,company_code,sku_id) REFERENCES managed_products(owner_id,company_code,sku_id)
)`;
type Source={owner_id:string;company_code:string;sku_id:string;title:string;source_payload:string;source_name:string;source_sha256:string;source_row:number;first_imported_at:string;imported_at:string};
function alias(value:string){if(!['m','managed_products'].includes(value))throw Error('Invalid managed history alias');return value;}
export function managedHistorySourceProof(name:string){const m=alias(name);return`h.owner_id=${m}.owner_id AND h.company_code=${m}.company_code AND h.sku_id=${m}.sku_id AND h.title=${m}.title AND h.source_payload=${m}.source_payload AND h.source_name=${m}.source_name AND h.source_sha256=${m}.source_sha256 AND h.source_row=${m}.source_row AND h.first_imported_at=${m}.first_imported_at AND h.imported_at=${m}.imported_at`;}
export function managedHistorySql(name:string,column:'payload'|'product_id_latest_at'|'price_latest_at'|'other_sellers'|'source_import_price'|'source_import_value'|'source_no_import'){return`(SELECT h.${column} FROM managed_product_history h WHERE ${managedHistorySourceProof(name)})`;}
export function managedHistoryPendingSql(name:string){return`NOT EXISTS(SELECT 1 FROM managed_product_history h WHERE ${managedHistorySourceProof(name)})`;}
/** Read-time cache for existing imports, not a fabricated source change.
 * Exact source/provenance comparison guards every cache commit and later read. */
export async function prepareManagedProductHistory(owner:string,company:SupplierHubCompany){
 if(!env.DB)throw Error('D1 unavailable');const db=env.DB;await db.prepare(managedProductHistorySchema).run();
 const pending=`m.owner_id=? AND m.company_code=? AND ${managedHistoryPendingSql('m')}`,scope=`SELECT m.* FROM managed_products m WHERE ${pending}`;
 const rowBytes='length(CAST(source_payload AS BLOB))+length(CAST(title AS BLOB))+length(CAST(source_name AS BLOB))+512';
 // Each batch materializes only a bounded prefix. Multiple original imports
 // may legitimately contain more than 5000 rows or 8 MB in total.
 let previousPending:number|null=null;
 while(true){
 const reads=await db.batch([db.prepare(`WITH pending AS (${scope}) SELECT COUNT(*) AS total FROM pending`).bind(owner,company.code),db.prepare(`WITH pending AS (${scope}),bounded AS (SELECT *,SUM(${rowBytes}) OVER(ORDER BY sku_id ROWS UNBOUNDED PRECEDING) AS cumulative_bytes,ROW_NUMBER() OVER(ORDER BY sku_id) AS ordinal FROM pending) SELECT * FROM bounded WHERE ordinal<=5000 AND cumulative_bytes<=8000000 ORDER BY sku_id`).bind(owner,company.code)]),total=Number((reads[0].results[0] as {total:number}).total);
 if(!total)return;if(previousPending!==null&&total>=previousPending)throw new ManagedProductContextChanged('조회 중 상품 원본이 변경되었습니다. 변경내역을 다시 조회해주세요.');previousPending=total;
 const rows=reads[1].results as Source[];if(!rows.length)throw new RangeError('상품 한 건의 변경내역 조회 용량이 한도를 초과했습니다. 원문 상품 DB를 확인해주세요.');let group:unknown[]=[],size=2;
 const save=async()=>{if(!group.length)return;const payload=JSON.stringify(group);group=[];size=2;
  const commit=db.prepare(`INSERT INTO managed_product_history(owner_id,company_code,sku_id,title,source_payload,source_name,source_sha256,source_row,first_imported_at,imported_at,payload,product_id_latest_at,price_latest_at,other_sellers,source_import_price,source_import_value,source_no_import)
   SELECT m.owner_id,m.company_code,m.sku_id,m.title,m.source_payload,m.source_name,m.source_sha256,m.source_row,m.first_imported_at,m.imported_at,json_extract(j.value,'$.payload'),json_extract(j.value,'$.idAt'),json_extract(j.value,'$.priceAt'),json_extract(j.value,'$.sellers'),json_extract(j.value,'$.importPrice'),json_extract(j.value,'$.importValue'),json_extract(j.value,'$.noImport')
   FROM json_each(?) j CROSS JOIN managed_products m ON m.owner_id=? AND m.company_code=? AND m.sku_id=json_extract(j.value,'$.sku_id')
   WHERE m.title=json_extract(j.value,'$.title') AND m.source_payload=json_extract(j.value,'$.source_payload') AND m.source_name=json_extract(j.value,'$.source_name') AND m.source_sha256=json_extract(j.value,'$.source_sha256') AND m.source_row=json_extract(j.value,'$.source_row') AND m.first_imported_at=json_extract(j.value,'$.first_imported_at') AND m.imported_at=json_extract(j.value,'$.imported_at')
   AND EXISTS(SELECT 1 FROM members WHERE id=? AND status='approved' AND company_code=? AND company_name=?)
   ON CONFLICT(owner_id,company_code,sku_id) DO UPDATE SET title=excluded.title,source_payload=excluded.source_payload,source_name=excluded.source_name,source_sha256=excluded.source_sha256,source_row=excluded.source_row,first_imported_at=excluded.first_imported_at,imported_at=excluded.imported_at,payload=excluded.payload,product_id_latest_at=excluded.product_id_latest_at,price_latest_at=excluded.price_latest_at,other_sellers=excluded.other_sellers,source_import_price=excluded.source_import_price,source_import_value=excluded.source_import_value,source_no_import=excluded.source_no_import`).bind(payload,owner,company.code,owner,company.code,company.name);
  const saved=await db.batch([commit,db.prepare(`SELECT COUNT(*) AS confirmed FROM json_each(?) j CROSS JOIN managed_products m ON m.owner_id=? AND m.company_code=? AND m.sku_id=json_extract(j.value,'$.sku_id') CROSS JOIN managed_product_history h ON ${managedHistorySourceProof('m')}
   WHERE h.title=json_extract(j.value,'$.title') AND h.source_payload=json_extract(j.value,'$.source_payload') AND h.source_name=json_extract(j.value,'$.source_name') AND h.source_sha256=json_extract(j.value,'$.source_sha256') AND h.source_row=json_extract(j.value,'$.source_row') AND h.first_imported_at=json_extract(j.value,'$.first_imported_at') AND h.imported_at=json_extract(j.value,'$.imported_at') AND h.payload=json_extract(j.value,'$.payload')
   AND EXISTS(SELECT 1 FROM members WHERE id=? AND status='approved' AND company_code=? AND company_name=?)`).bind(payload,owner,company.code,owner,company.code,company.name)]);
  if(Number((saved[1].results[0] as {confirmed:number}).confirmed)!==JSON.parse(payload).length)throw new ManagedProductContextChanged('조회 중 상품 원본 또는 승인 회사가 변경되었습니다. 변경내역을 다시 조회해주세요.');
 };
 for(const source of rows){const history=normalizeManagedProductHistory(JSON.parse(source.source_payload)),entry={...source,payload:JSON.stringify(history),idAt:history.productId.latestAt,priceAt:history.price.latestAt,sellers:history.otherSellers.matched===true?1:0,importPrice:history.sourceImportPrice.latest?.price??(history.sourceImportPrice.value===0?'0':null),importValue:history.sourceImportPrice.value,noImport:history.sourceImportPrice.noImport===null?null:history.sourceImportPrice.noImport?1:0},length=new TextEncoder().encode(JSON.stringify(entry)).length;if(group.length&&(group.length>=100||size+length>400000))await save();group.push(entry);size+=length+1;}await save();
 }
}
