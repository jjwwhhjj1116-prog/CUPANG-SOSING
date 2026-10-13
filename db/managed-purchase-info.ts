import {env} from 'cloudflare:workers';
import {managedProductSchema,managedProductImportAuthorization} from '@/db/managed-products';
import {managedProductAccountContext} from '@/app/managed-products';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import {parseManagedPurchaseInfo,validateManagedPurchaseInfo,managedPurchaseInfoDigest,managedPurchaseInfoComplete,ManagedPurchaseInfoError,type ManagedPurchaseInfoEntry,type ManagedPurchaseInfoView} from '@/app/managed-purchase-info';

export const managedPurchaseInfoSchema=`CREATE TABLE IF NOT EXISTS managed_purchase_info (
 owner_id TEXT NOT NULL,company_code TEXT NOT NULL,sku_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),payload TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,company_code,sku_id),
 FOREIGN KEY(owner_id,company_code,sku_id) REFERENCES managed_products(owner_id,company_code,sku_id)
)`;
async function database(){if(!env.DB)throw Error('D1 unavailable');await env.DB.batch([env.DB.prepare(managedProductSchema),env.DB.prepare(managedPurchaseInfoSchema)]);return env.DB;}
type Source={owner_id:string;company_code:string;sku_id:string;title:string;source_payload:string;source_name:string;source_sha256:string;source_row:number;first_imported_at:string;imported_at:string;manual_revision:number|null;manual_payload:string|null;manual_updated_at:string|null};
export type ManagedPurchaseInfoSnapshot={view:ManagedPurchaseInfoView;source:Source};
const from=`FROM managed_products m LEFT JOIN managed_purchase_info i ON i.owner_id=m.owner_id AND i.company_code=m.company_code AND i.sku_id=m.sku_id`;
async function sourceRow(owner:string,company:SupplierHubCompany,skuId:string){return (await database()).prepare(`SELECT m.*,i.revision AS manual_revision,i.payload AS manual_payload,i.updated_at AS manual_updated_at ${from} WHERE m.owner_id=? AND m.company_code=? AND m.sku_id=?`).bind(owner,company.code,skuId).first<Source>();}
function sourceTuple(row:Source){return[row.owner_id,row.company_code,row.sku_id,row.title,row.source_payload,row.source_name,row.source_sha256,row.source_row,row.first_imported_at,row.imported_at];}
export async function readManagedPurchaseInfo(owner:string,company:SupplierHubCompany,skuId:string):Promise<ManagedPurchaseInfoSnapshot>{
 const row=await sourceRow(owner,company,skuId);if(!row)throw new ManagedPurchaseInfoError('현재 회사의 상품 SKU를 찾을 수 없습니다.',404,'MANAGED_PURCHASE_INFO_NOT_FOUND');
 const values=JSON.parse(row.source_payload) as Record<string,unknown>,originalPurchaseInfo=parseManagedPurchaseInfo(values['구매정보']),revision=row.manual_revision??0;
 if(!Number.isSafeInteger(revision)||revision<0||row.manual_payload!==null&&(!revision||!row.manual_updated_at))throw Error('Invalid managed purchase record');
 const purchaseInfo=row.manual_payload===null?originalPurchaseInfo:validateManagedPurchaseInfo(JSON.parse(row.manual_payload)),accountContext=await managedProductAccountContext(owner,company),sourceVersion=await managedPurchaseInfoDigest(sourceTuple(row));
 const inputFingerprint=await managedPurchaseInfoDigest(['managed-purchase-info-v1',accountContext,skuId,sourceVersion,revision,row.manual_payload,row.manual_updated_at]);
 const product={title:row.title,barcode:typeof values['바코드']==='string'?values['바코드']:'',image:typeof values['썸네일']==='string'?values['썸네일']:''};
 return{source:row,view:{skuId,company,accountContext,revision,inputFingerprint,sourceVersion,product,purchaseInfo,originalPurchaseInfo,updatedAt:row.manual_updated_at,purchaseInfoComplete:managedPurchaseInfoComplete(purchaseInfo)}};
}
export async function managedPurchaseInfoSourcesCurrent(owner:string,company:SupplierHubCompany,expected:ManagedPurchaseInfoSnapshot){
 const current=await sourceRow(owner,company,expected.view.skuId);return !!current&&JSON.stringify(current)===JSON.stringify(expected.source);
}
/** Current owned SKU, original source and complete sidecar compare in the same
 * statement. No original rows, inventory, prices or supplier receipts change. */
export async function saveManagedPurchaseInfo(owner:string,company:SupplierHubCompany,snapshot:ManagedPurchaseInfoSnapshot,rows:ManagedPurchaseInfoEntry[]){
 const db=await database(),row=snapshot.source,revision=snapshot.view.revision+1,updatedAt=new Date(Math.max(Date.now(),row.manual_updated_at?Date.parse(row.manual_updated_at)+1:0)).toISOString();
 const result=await db.batch([db.prepare(`INSERT INTO managed_purchase_info(owner_id,company_code,sku_id,revision,payload,updated_at)
  SELECT m.owner_id,m.company_code,m.sku_id,?,?,? FROM managed_products m WHERE m.owner_id=? AND m.company_code=? AND m.sku_id=?
  AND m.title=? AND m.source_payload=? AND m.source_name=? AND m.source_sha256=? AND m.source_row=? AND m.first_imported_at=? AND m.imported_at=?
  AND ${managedProductImportAuthorization}
  AND COALESCE((SELECT revision FROM managed_purchase_info i WHERE i.owner_id=m.owner_id AND i.company_code=m.company_code AND i.sku_id=m.sku_id),0)=?
  AND (SELECT payload FROM managed_purchase_info i WHERE i.owner_id=m.owner_id AND i.company_code=m.company_code AND i.sku_id=m.sku_id) IS ?
  AND (SELECT updated_at FROM managed_purchase_info i WHERE i.owner_id=m.owner_id AND i.company_code=m.company_code AND i.sku_id=m.sku_id) IS ?
  ON CONFLICT(owner_id,company_code,sku_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at
  WHERE managed_purchase_info.revision=? RETURNING revision,payload,updated_at`).bind(revision,JSON.stringify(rows),updatedAt,owner,company.code,row.sku_id,row.title,row.source_payload,row.source_name,row.source_sha256,row.source_row,row.first_imported_at,row.imported_at,
   owner,company.code,company.name,snapshot.view.revision,row.manual_payload,row.manual_updated_at,snapshot.view.revision)]);
 if(result[0].results.length!==1)throw new ManagedPurchaseInfoError('원본 상품·구매정보 또는 승인 회사가 변경되었습니다. 입력을 유지하고 현재 저장본을 다시 확인해주세요.',409,'MANAGED_PURCHASE_INFO_CONFLICT');
 return{revision,updatedAt,payload:JSON.stringify(rows)};
}
export function managedPurchaseInfoSql(alias:string){if(!['m','managed_products'].includes(alias))throw Error('Invalid purchase source alias');return `(SELECT payload FROM managed_purchase_info i WHERE i.owner_id=${alias}.owner_id AND i.company_code=${alias}.company_code AND i.sku_id=${alias}.sku_id)`;}
/** Invalid legacy strings remain raw, editable only after original verification.
 * They cannot be treated as completed purchase information by a list filter. */
export function managedPurchaseInfoCompleteSql(alias:string){
 const raw=`COALESCE(${managedPurchaseInfoSql(alias)},CAST(json_extract(${alias}.source_payload,'$."구매정보"') AS TEXT))`,array=`CASE WHEN json_valid(${raw}) THEN CASE WHEN json_type(${raw})='array' THEN ${raw} ELSE '[]' END ELSE '[]' END`;
 return`(json_array_length(${array})>0 AND NOT EXISTS(SELECT 1 FROM json_each(${array}) p WHERE CASE WHEN p.type='object' THEN json_extract(p.value,'$."매칭상태"')='매칭완료' AND json_extract(p.value,'$."요청사항"')='등록완료' ELSE 0 END IS NOT 1))`;
}
