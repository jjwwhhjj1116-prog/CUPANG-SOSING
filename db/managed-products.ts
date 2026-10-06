import {env} from 'cloudflare:workers';
import type {ManagedProduct,ManagedProductFilter,ManagedProductImport,ManagedProductImportCounts,ManagedProductList} from '@/app/managed-products';
import {ManagedProductContextChanged} from '@/app/managed-products';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';

export const managedProductSchema=`CREATE TABLE IF NOT EXISTS managed_products (
 owner_id TEXT NOT NULL, company_code TEXT NOT NULL, sku_id TEXT NOT NULL,
 title TEXT NOT NULL, source_payload TEXT NOT NULL, source_name TEXT NOT NULL,
 source_sha256 TEXT NOT NULL, source_row INTEGER NOT NULL,
 first_imported_at TEXT NOT NULL, imported_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,company_code,sku_id)
)`;
export const managedProductImportAuthorization=`EXISTS(SELECT 1 FROM members WHERE id=? AND status='approved' AND company_code=? AND company_name=?)`;
async function database(){if(!env.DB)throw Error('D1 unavailable');await env.DB.prepare(managedProductSchema).run();return env.DB;}
type Stored={sku_id:string;title:string;source_payload:string;company_code:string;source_name:string;source_row:number;first_imported_at:string;imported_at:string};
const toProduct=(row:Stored):ManagedProduct=>({skuId:row.sku_id,title:row.title,values:JSON.parse(row.source_payload),companyCode:row.company_code,sourceName:row.source_name,sourceRow:row.source_row,firstImportedAt:row.first_imported_at,importedAt:row.imported_at});
function chunks(source:ManagedProductImport){
 const result:string[]=[],encoder=new TextEncoder();let group:unknown[]=[],size=2;
 for(const row of source.rows){const entry={sku:row.skuId,title:row.title,row:row.sourceRow,payload:JSON.stringify(row.values)},length=encoder.encode(JSON.stringify(entry)).length;
  if(group.length&&(group.length>=500||size+length>400000)){result.push(JSON.stringify(group));group=[];size=2;}
  group.push(entry);size+=length+1;
 }if(group.length)result.push(JSON.stringify(group));return result;
}
/** Counts and inserts run in one D1 transaction. Unchanged SKUs retain their original provenance. */
export async function importManagedProducts(ownerId:string,source:ManagedProductImport,name:string,preview:boolean):Promise<ManagedProductImportCounts>{
 const db=await database(),now=new Date().toISOString(),queries=[];
 for(const payload of chunks(source)){
  queries.push(db.prepare(`SELECT COUNT(*) AS total,
   SUM(CASE WHEN m.sku_id IS NULL THEN 1 ELSE 0 END) AS added,
   SUM(CASE WHEN m.sku_id IS NOT NULL AND m.source_payload=json_extract(j.value,'$.payload') THEN 1 ELSE 0 END) AS unchanged,
   ${managedProductImportAuthorization} AS accountAuthorized
   FROM json_each(?) j LEFT JOIN managed_products m ON m.owner_id=? AND m.company_code=? AND m.sku_id=json_extract(j.value,'$.sku')`).bind(ownerId,source.company.code,source.company.name,payload,ownerId,source.company.code));
  if(!preview)queries.push(db.prepare(`INSERT INTO managed_products(owner_id,company_code,sku_id,title,source_payload,source_name,source_sha256,source_row,first_imported_at,imported_at)
   SELECT ?,?,json_extract(value,'$.sku'),json_extract(value,'$.title'),json_extract(value,'$.payload'),?,?,json_extract(value,'$.row'),?,? FROM json_each(?) WHERE ${managedProductImportAuthorization}
   ON CONFLICT(owner_id,company_code,sku_id) DO UPDATE SET title=excluded.title,source_payload=excluded.source_payload,source_name=excluded.source_name,
   source_sha256=excluded.source_sha256,source_row=excluded.source_row,imported_at=excluded.imported_at
   WHERE managed_products.source_payload<>excluded.source_payload`).bind(ownerId,source.company.code,name,source.sha256,now,now,payload,ownerId,source.company.code,source.company.name));
 }
 const results=await db.batch(queries),counts={total:0,added:0,updated:0,unchanged:0};
 for(let i=0;i<results.length;i+=preview?1:2){const row=results[i].results[0] as {total:number;added:number;unchanged:number;accountAuthorized:number};if(row.accountAuthorized!==1)throw new ManagedProductContextChanged('로그인 계정 또는 회사정보가 변경되었습니다. 선택한 파일을 다시 미리보기해주세요.');counts.total+=row.total;counts.added+=row.added;counts.unchanged+=row.unchanged;}
 counts.updated=counts.total-counts.added-counts.unchanged;return counts;
}
const filters:Record<ManagedProductFilter,string>={all:'1',unavailable:`json_extract(source_payload,'$."발주가능상태"')='품절'`,loser:`json_extract(source_payload,'$.winner')='LOSER'`,
 'no-purchase':`COALESCE(json_extract(source_payload,'$."구매정보"'),'') IN ('','[]','null')`,'no-import':`COALESCE(json_extract(source_payload,'$."매입정보"'),'') IN ('','[]','null')`};
export async function listManagedProducts(ownerId:string,company:SupplierHubCompany,query:{page:number;pageSize:number;search:string;filter:ManagedProductFilter}):Promise<ManagedProductList>{
 const db=await database(),search='%'+query.search.replace(/[\\%_]/g,value=>'\\'+value)+'%',where=`owner_id=? AND company_code=? AND ${filters[query.filter]} AND (title LIKE ? ESCAPE '\\' OR sku_id LIKE ? ESCAPE '\\' OR json_extract(source_payload,'$."바코드"') LIKE ? ESCAPE '\\')`;
 const result=await db.batch([
  db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN ${filters.unavailable} THEN 1 ELSE 0 END) AS unavailable,SUM(CASE WHEN ${filters.loser} THEN 1 ELSE 0 END) AS loser,
   SUM(CASE WHEN ${filters['no-purchase']} THEN 1 ELSE 0 END) AS noPurchase,SUM(CASE WHEN ${filters['no-import']} THEN 1 ELSE 0 END) AS noImport,
   MAX(imported_at) AS lastImportedAt,MIN(NULLIF(json_extract(source_payload,'$."판매가기준일"'),'')) AS priceDate
   FROM managed_products WHERE owner_id=? AND company_code=?`).bind(ownerId,company.code),
  db.prepare(`SELECT COUNT(*) AS total FROM managed_products WHERE ${where}`).bind(ownerId,company.code,search,search,search),
  db.prepare(`SELECT * FROM managed_products WHERE ${where} ORDER BY first_imported_at DESC,source_row,sku_id LIMIT ? OFFSET ?`).bind(ownerId,company.code,search,search,search,query.pageSize,(query.page-1)*query.pageSize),
 ]);
 const summary=result[0].results[0] as ManagedProductList['summary'];
 return {company,products:(result[2].results as Stored[]).map(toProduct),total:Number((result[1].results[0] as {total:number}).total),page:query.page,pageSize:query.pageSize,
  summary:{...summary,unavailable:summary.unavailable??0,loser:summary.loser??0,noPurchase:summary.noPurchase??0,noImport:summary.noImport??0}};
}
