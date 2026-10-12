import {env} from 'cloudflare:workers';
import type {ManagedProduct,ManagedProductFilter,ManagedProductImport,ManagedProductImportCounts,ManagedProductList,ManagedProductQuery} from '@/app/managed-products';
import {ManagedProductContextChanged} from '@/app/managed-products';
import {managedTableSql} from '@/app/managed-product-table';
import {managedImportPriceSchema,managedImportHistorySql} from '@/db/managed-import-prices';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';

export const managedProductSchema=`CREATE TABLE IF NOT EXISTS managed_products (
 owner_id TEXT NOT NULL, company_code TEXT NOT NULL, sku_id TEXT NOT NULL,
 title TEXT NOT NULL, source_payload TEXT NOT NULL, source_name TEXT NOT NULL,
 source_sha256 TEXT NOT NULL, source_row INTEGER NOT NULL,
 first_imported_at TEXT NOT NULL, imported_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,company_code,sku_id)
)`;
export const managedProductImportAuthorization=`EXISTS(SELECT 1 FROM members WHERE id=? AND status='approved' AND company_code=? AND company_name=?)`;
async function database(includeImportPrices=false){if(!env.DB)throw Error('D1 unavailable');await env.DB.prepare(managedProductSchema).run();if(includeImportPrices)await env.DB.prepare(managedImportPriceSchema).run();return env.DB;}
type Stored={sku_id:string;title:string;source_payload:string;company_code:string;source_name:string;source_row:number;first_imported_at:string;imported_at:string;import_history?:string};
const toProduct=(row:Stored):ManagedProduct=>{const records=(JSON.parse(row.import_history??'[]') as {date:string;price:string}[]).map(({date,price})=>({date,price}));return {skuId:row.sku_id,title:row.title,values:JSON.parse(row.source_payload),companyCode:row.company_code,sourceName:row.source_name,sourceRow:row.source_row,firstImportedAt:row.first_imported_at,importedAt:row.imported_at,...(records.length?{importPrices:records,latestImportedPrice:records.at(-1)}:{})};};
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
 'no-purchase':`COALESCE(json_extract(source_payload,'$."구매정보"'),'') IN ('','[]','null')`,'no-import':`COALESCE(json_extract(source_payload,'$."매입정보"'),'') IN ('','[]','null') AND NOT EXISTS(SELECT 1 FROM managed_import_prices i WHERE i.owner_id=managed_products.owner_id AND i.company_code=managed_products.company_code AND i.sku_id=managed_products.sku_id)`};
function listingQuery(ownerId:string,company:SupplierHubCompany,query:ManagedProductQuery){
 const search='%'+query.search.replace(/[\\%_]/g,value=>'\\'+value)+'%',table=managedTableSql({sort:query.sort??null,columnFilters:query.columnFilters??[]}),where=`owner_id=? AND company_code=? AND ${filters[query.filter]} AND (title LIKE ? ESCAPE '\\' OR sku_id LIKE ? ESCAPE '\\' OR json_extract(source_payload,'$."바코드"') LIKE ? ESCAPE '\\')${table.where}`;
 return{where,args:[ownerId,company.code,search,search,search,...table.args],orderBy:table.orderBy};
}
export async function listManagedProducts(ownerId:string,company:SupplierHubCompany,query:ManagedProductQuery):Promise<ManagedProductList>{
 const db=await database(true),{where,args,orderBy}=listingQuery(ownerId,company,query);
 const result=await db.batch([
  db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN ${filters.unavailable} THEN 1 ELSE 0 END) AS unavailable,SUM(CASE WHEN ${filters.loser} THEN 1 ELSE 0 END) AS loser,
   SUM(CASE WHEN ${filters['no-purchase']} THEN 1 ELSE 0 END) AS noPurchase,SUM(CASE WHEN ${filters['no-import']} THEN 1 ELSE 0 END) AS noImport,
   MAX(imported_at) AS lastImportedAt,MIN(NULLIF(json_extract(source_payload,'$."판매가기준일"'),'')) AS priceDate
   FROM managed_products WHERE owner_id=? AND company_code=?`).bind(ownerId,company.code),
  db.prepare(`SELECT COUNT(*) AS total FROM managed_products WHERE ${where}`).bind(...args),
  db.prepare(`SELECT managed_products.*,${managedImportHistorySql('managed_products')} AS import_history FROM managed_products WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).bind(...args,query.pageSize,(query.page-1)*query.pageSize),
 ]);
 const summary=result[0].results[0] as ManagedProductList['summary'];
 return {company,products:(result[2].results as Stored[]).map(toProduct),total:Number((result[1].results[0] as {total:number}).total),page:query.page,pageSize:query.pageSize,
  summary:{...summary,unavailable:summary.unavailable??0,loser:summary.loser??0,noPurchase:summary.noPurchase??0,noImport:summary.noImport??0}};
}
/** One bounded owned read of the complete filtered result, never a page export. */
export async function readManagedProductsForExport(ownerId:string,company:SupplierHubCompany,query:ManagedProductQuery){
 const db=await database(true),{where,args,orderBy}=listingQuery(ownerId,company,query),result=await db.prepare(`SELECT managed_products.*,${managedImportHistorySql('managed_products')} AS import_history FROM managed_products WHERE ${where} ORDER BY ${orderBy} LIMIT 5001`).bind(...args).all<Stored>();
 if(result.results.length>5000)throw new RangeError('다운로드는 필터 결과 5000개 이하만 지원합니다. 조건을 좁혀주세요.');
 return result.results.map(toProduct);
}
