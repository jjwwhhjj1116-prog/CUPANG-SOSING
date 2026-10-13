import {env} from 'cloudflare:workers';
import type {ManagedProduct,ManagedProductFilter,ManagedProductImport,ManagedProductImportCounts,ManagedProductList,ManagedProductQuery} from '@/app/managed-products';
import {ManagedProductContextChanged} from '@/app/managed-products';
import {managedTableSql} from '@/app/managed-product-table';
import {managedImportPriceSchema,managedImportHistorySql} from '@/db/managed-import-prices';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import {managedPurchaseInfoSchema,managedPurchaseInfoSql,managedPurchaseInfoCompleteSql} from '@/db/managed-purchase-info';
import {validateManagedPurchaseInfo} from '@/app/managed-purchase-info';
import {prepareManagedProductHistory,managedHistorySql,managedHistoryPendingSql} from '@/db/managed-product-history';
import {managedHistoryCutoff,managedProductHistoryView,type NormalizedManagedHistory} from '@/app/managed-product-history';

export const managedProductSchema=`CREATE TABLE IF NOT EXISTS managed_products (
 owner_id TEXT NOT NULL, company_code TEXT NOT NULL, sku_id TEXT NOT NULL,
 title TEXT NOT NULL, source_payload TEXT NOT NULL, source_name TEXT NOT NULL,
 source_sha256 TEXT NOT NULL, source_row INTEGER NOT NULL,
 first_imported_at TEXT NOT NULL, imported_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,company_code,sku_id)
)`;
export const managedProductImportAuthorization=`EXISTS(SELECT 1 FROM members WHERE id=? AND status='approved' AND company_code=? AND company_name=?)`;
async function database(includeImportPrices=false){if(!env.DB)throw Error('D1 unavailable');await env.DB.prepare(managedProductSchema).run();if(includeImportPrices)await env.DB.batch([env.DB.prepare(managedImportPriceSchema),env.DB.prepare(managedPurchaseInfoSchema)]);return env.DB;}
type Stored={sku_id:string;title:string;source_payload:string;company_code:string;source_name:string;source_row:number;first_imported_at:string;imported_at:string;import_history?:string;history_payload?:string|null;purchase_info?:string|null;purchase_revision?:number|null;purchase_updated_at?:string|null};
const toProduct=(row:Stored,cutoff:number):ManagedProduct=>{const records=(JSON.parse(row.import_history??'[]') as {date:string;price:string}[]).map(({date,price})=>({date,price}));if(!row.history_payload)throw new ManagedProductContextChanged('상품 원본이 변경되었습니다. 변경내역을 다시 조회해주세요.');const history=managedProductHistoryView(JSON.parse(row.history_payload) as NormalizedManagedHistory,cutoff);return {skuId:row.sku_id,title:row.title,values:JSON.parse(row.source_payload),companyCode:row.company_code,sourceName:row.source_name,sourceRow:row.source_row,firstImportedAt:row.first_imported_at,importedAt:row.imported_at,history,effectiveImportPrice:records.at(-1)?.price??history.sourceImportPrice.latest?.price??(history.sourceImportPrice.value===0?'0':null),...(records.length?{importPrices:records,latestImportedPrice:records.at(-1)}:{}),...(row.purchase_info!=null?{purchaseInfo:validateManagedPurchaseInfo(JSON.parse(row.purchase_info)),purchaseInfoRevision:row.purchase_revision??undefined,purchaseInfoUpdatedAt:row.purchase_updated_at??undefined}:{})};};
const purchaseProjection=`${managedPurchaseInfoSql('managed_products')} AS purchase_info,(SELECT revision FROM managed_purchase_info i WHERE i.owner_id=managed_products.owner_id AND i.company_code=managed_products.company_code AND i.sku_id=managed_products.sku_id) AS purchase_revision,(SELECT updated_at FROM managed_purchase_info i WHERE i.owner_id=managed_products.owner_id AND i.company_code=managed_products.company_code AND i.sku_id=managed_products.sku_id) AS purchase_updated_at`;
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
function filterSql(cutoff:number):Record<ManagedProductFilter,string>{if(!Number.isSafeInteger(cutoff))throw Error('Invalid history cutoff');const noImport=`COALESCE((SELECT CAST(price AS REAL)<=0 FROM managed_import_prices i WHERE i.owner_id=managed_products.owner_id AND i.company_code=managed_products.company_code AND i.sku_id=managed_products.sku_id ORDER BY import_date DESC LIMIT 1),${managedHistorySql('managed_products','source_no_import')},0)=1`;return{all:'1',unavailable:`COALESCE(json_extract(source_payload,'$."발주가능상태"'),'')<>'정상'`,loser:`json_extract(source_payload,'$.winner')='LOSER'`,
 'no-purchase':`NOT ${managedPurchaseInfoCompleteSql('managed_products')}`,'no-import':noImport,'product-id-changed':`${managedHistorySql('managed_products','product_id_latest_at')}>=${cutoff}`,'price-changed':`${managedHistorySql('managed_products','price_latest_at')}>=${cutoff}`,'other-sellers':`${managedHistorySql('managed_products','other_sellers')}=1`};}
function listingQuery(ownerId:string,company:SupplierHubCompany,query:ManagedProductQuery,cutoff:number){
 const filters=filterSql(cutoff),search='%'+query.search.replace(/[\\%_]/g,value=>'\\'+value)+'%',table=managedTableSql({sort:query.sort??null,columnFilters:query.columnFilters??[]}),where=`owner_id=? AND company_code=? AND ${filters[query.filter]} AND (title LIKE ? ESCAPE '\\' OR sku_id LIKE ? ESCAPE '\\' OR json_extract(source_payload,'$."바코드"') LIKE ? ESCAPE '\\')${table.where}`;
 return{where,args:[ownerId,company.code,search,search,search,...table.args],orderBy:table.orderBy};
}
export async function listManagedProducts(ownerId:string,company:SupplierHubCompany,query:ManagedProductQuery):Promise<ManagedProductList>{
 const db=await database(true);await prepareManagedProductHistory(ownerId,company);const cutoff=managedHistoryCutoff(),filters=filterSql(cutoff),{where,args,orderBy}=listingQuery(ownerId,company,query,cutoff),pending=`SELECT COUNT(*) AS pending FROM managed_products m WHERE m.owner_id=? AND m.company_code=? AND ${managedHistoryPendingSql('m')}`,ready=`((${pending.replace('COUNT(*) AS pending','COUNT(*)')})=0)`;
 const result=await db.batch([
  db.prepare(pending).bind(ownerId,company.code),
  db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN ${filters.unavailable} THEN 1 ELSE 0 END) AS unavailable,SUM(CASE WHEN ${filters.loser} THEN 1 ELSE 0 END) AS loser,
   SUM(CASE WHEN ${filters['no-purchase']} THEN 1 ELSE 0 END) AS noPurchase,SUM(CASE WHEN ${filters['no-import']} THEN 1 ELSE 0 END) AS noImport,
   SUM(CASE WHEN ${filters['product-id-changed']} THEN 1 ELSE 0 END) AS productIdChanged,SUM(CASE WHEN ${filters['price-changed']} THEN 1 ELSE 0 END) AS priceChanged,SUM(CASE WHEN ${filters['other-sellers']} THEN 1 ELSE 0 END) AS otherSellers,
   MAX(imported_at) AS lastImportedAt,MIN(NULLIF(json_extract(source_payload,'$."판매가기준일"'),'')) AS priceDate
   FROM managed_products WHERE owner_id=? AND company_code=? AND ${ready}`).bind(ownerId,company.code,ownerId,company.code),
  db.prepare(`SELECT COUNT(*) AS total FROM managed_products WHERE ${where} AND ${ready}`).bind(...args,ownerId,company.code),
  db.prepare(`SELECT managed_products.*,${managedImportHistorySql('managed_products')} AS import_history,${purchaseProjection},${managedHistorySql('managed_products','payload')} AS history_payload FROM managed_products WHERE ${where} AND ${ready} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).bind(...args,ownerId,company.code,query.pageSize,(query.page-1)*query.pageSize),
 ]);
 if((result[0].results[0] as {pending:number}).pending)throw new ManagedProductContextChanged('조회 중 상품 원본이 변경되었습니다. 변경내역을 다시 조회해주세요.');const summary=result[1].results[0] as ManagedProductList['summary'];
 return {company,products:(result[3].results as Stored[]).map(row=>toProduct(row,cutoff)),total:Number((result[2].results[0] as {total:number}).total),page:query.page,pageSize:query.pageSize,
  summary:{...summary,unavailable:summary.unavailable??0,loser:summary.loser??0,noPurchase:summary.noPurchase??0,noImport:summary.noImport??0,productIdChanged:summary.productIdChanged??0,priceChanged:summary.priceChanged??0,otherSellers:summary.otherSellers??0}};
}
/** One bounded owned read of the complete filtered result, never a page export. */
export async function readManagedProductsForExport(ownerId:string,company:SupplierHubCompany,query:ManagedProductQuery){
 const db=await database(true);await prepareManagedProductHistory(ownerId,company);const cutoff=managedHistoryCutoff(),{where,args,orderBy}=listingQuery(ownerId,company,query,cutoff),pending=`SELECT COUNT(*) AS pending FROM managed_products m WHERE m.owner_id=? AND m.company_code=? AND ${managedHistoryPendingSql('m')}`,ready=`((${pending.replace('COUNT(*) AS pending','COUNT(*)')})=0)`;
 const scope=`SELECT managed_products.*,${managedImportHistorySql('managed_products')} AS import_history,${purchaseProjection},${managedHistorySql('managed_products','payload')} AS history_payload FROM managed_products WHERE ${where} AND ${ready}`,scopeArgs=[...args,ownerId,company.code];
 // Bound original JSON and both manual sidecars in SQL before sending rows to
 // the Worker. The XLSX serializer retains its stricter output-content bound.
 const stats=`SELECT COUNT(*) AS total,COALESCE(SUM(length(CAST(source_payload AS BLOB))+length(CAST(import_history AS BLOB))+length(CAST(history_payload AS BLOB))+length(CAST(COALESCE(purchase_info,'') AS BLOB))+length(CAST(title AS BLOB))+length(CAST(source_name AS BLOB))+256),0) AS bytes FROM export_scope`;
 const results=await db.batch([
  db.prepare(pending).bind(ownerId,company.code),
  db.prepare(`WITH export_scope AS (${scope}) ${stats}`).bind(...scopeArgs),
  db.prepare(`WITH export_scope AS (${scope}),export_stats AS (${stats}) SELECT managed_products.* FROM export_scope managed_products WHERE (SELECT total<=5000 AND bytes<=8000000 FROM export_stats) ORDER BY ${orderBy} LIMIT 5000`).bind(...scopeArgs),
 ]);
 if((results[0].results[0] as {pending:number}).pending)throw new ManagedProductContextChanged('조회 중 상품 원본이 변경되었습니다. 변경내역을 다시 조회해주세요.');const bounds=results[1].results[0] as {total:number;bytes:number};
 if(bounds.total>5000)throw new RangeError('다운로드는 필터 결과 5000개 이하만 지원합니다. 조건을 좁혀주세요.');
 if(bounds.bytes>8000000)throw new RangeError('원문·구매정보·매입내역의 다운로드 용량이 한도를 초과했습니다. 필터 조건을 좁혀주세요.');
 return (results[2].results as Stored[]).map(row=>toProduct(row,cutoff));
}
