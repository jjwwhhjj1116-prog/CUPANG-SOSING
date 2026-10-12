import {env} from 'cloudflare:workers';
import {managedProductSchema,managedProductImportAuthorization} from '@/db/managed-products';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import {managedImportPriceSha,ManagedImportPriceConflict,ManagedImportPriceInputError,type ManagedImportPriceFile,type ManagedImportPriceCounts,type ManagedImportPriceRecord} from '@/app/managed-import-prices';
export const managedImportPriceSchema=`CREATE TABLE IF NOT EXISTS managed_import_prices (
 owner_id TEXT NOT NULL, company_code TEXT NOT NULL, sku_id TEXT NOT NULL, import_date TEXT NOT NULL,
 price TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), source_name TEXT NOT NULL, source_sha256 TEXT NOT NULL,
 source_row INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,company_code,sku_id,import_date),
 FOREIGN KEY(owner_id,company_code,sku_id) REFERENCES managed_products(owner_id,company_code,sku_id)
)`;
async function database(){if(!env.DB)throw Error('D1 unavailable');await env.DB.batch([env.DB.prepare(managedProductSchema),env.DB.prepare(managedImportPriceSchema)]);return env.DB;}
export function managedImportHistorySql(alias:string){if(!['m','managed_products'].includes(alias))throw Error('Invalid import history source');return `(SELECT COALESCE(json_group_array(json_object('date',import_date,'price',price,'revision',revision,'sourceName',source_name,'sourceSha256',source_sha256,'sourceRow',source_row,'createdAt',created_at,'updatedAt',updated_at)),'[]') FROM (SELECT * FROM managed_import_prices WHERE owner_id=${alias}.owner_id AND company_code=${alias}.company_code AND sku_id=${alias}.sku_id ORDER BY import_date))`;}
type Source={sku_id:string;title:string;source_payload:string;source_sha256:string;source_row:number;imported_at:string;history:string};
type Guard={sku:string;payload:string;sha:string;row:number;importedAt:string;history:string};
export type ManagedImportPricePlan={snapshot:string;counts:ManagedImportPriceCounts;sample:ManagedImportPriceRecord[];rows:(ManagedImportPriceRecord&{sourceRow:number})[];guards:Guard[];matching:ManagedImportPriceFile['matching']};
export async function planManagedImportPrices(owner:string,company:SupplierHubCompany,file:ManagedImportPriceFile,accountContext:string):Promise<ManagedImportPricePlan>{
 const db=await database(),identifiers=[...new Set(file.rows.map(row=>row.identifier))],match=file.matching==='sku'?'m.sku_id':`json_extract(m.source_payload,'$."바코드"')`,found=await db.prepare(`SELECT m.*,${managedImportHistorySql('m')} AS history FROM managed_products m WHERE m.owner_id=? AND m.company_code=? AND ${match} IN (SELECT value FROM json_each(?)) ORDER BY m.sku_id`).bind(owner,company.code,JSON.stringify(identifiers)).all<Source>();
 const matches=new Map<string,Source[]>();for(const row of found.results){const id=file.matching==='sku'?row.sku_id:JSON.parse(row.source_payload)['바코드'];const group=matches.get(id)??[];group.push(row);matches.set(id,group);}
 const guards:Guard[]=[],guarded=new Set<string>(),keys=new Set<string>(),rows:ManagedImportPricePlan['rows']=[],counts={total:file.rows.length,added:0,replaced:0,unchanged:0};
 for(const input of file.rows){const group=matches.get(input.identifier);if(group?.length!==1)throw new ManagedImportPriceInputError(`원본 ${file.matching==='sku'?'SKUID':'바코드'}가 현재 회사에 없거나 여러 SKU에 연결되어 있습니다. 파일 전체를 확인해주세요.`);const source=group[0],key=JSON.stringify([source.sku_id,input.date]);if(keys.has(key))throw new ManagedImportPriceInputError('같은 SKU·매입일자가 파일 안에서 중복되었습니다.');keys.add(key);
  const history=JSON.parse(source.history) as {date:string;price:string}[],prior=history.find(row=>row.date===input.date);if(!prior)counts.added++;else if(prior.price===input.price)counts.unchanged++;else counts.replaced++;
  const raw=JSON.parse(source.source_payload);rows.push({skuId:source.sku_id,title:source.title,exposureId:raw['노출ID']??'',date:input.date,price:input.price,sourceRow:input.sourceRow});
  if(!guarded.has(source.sku_id)){guarded.add(source.sku_id);guards.push({sku:source.sku_id,payload:source.source_payload,sha:source.source_sha256,row:source.source_row,importedAt:source.imported_at,history:source.history});}
 }
 const evidence=JSON.stringify([accountContext,file.matching,file.sha256,guards]);if(new TextEncoder().encode(evidence).length>1_500_000)throw new RangeError('현재 원문과 매입내역 확인 범위가 큽니다. 파일의 상품 수를 줄여주세요.');
 return {snapshot:await managedImportPriceSha(new TextEncoder().encode(evidence)),counts,sample:rows.slice(0,10),rows,guards,matching:file.matching};
}
/** All rows share one atomic source/history/member proof. Original source rows never change. */
export async function commitManagedImportPrices(owner:string,company:SupplierHubCompany,plan:ManagedImportPricePlan,file:ManagedImportPriceFile,name:string){
 const db=await database(),payload=JSON.stringify(plan.rows.map(row=>({sku:row.skuId,date:row.date,price:row.price,row:row.sourceRow}))),expected=JSON.stringify(plan.guards),now=new Date().toISOString();
 const barcodeUnique=file.matching==='barcode'?` OR (SELECT COUNT(*) FROM managed_products b WHERE b.owner_id=m.owner_id AND b.company_code=m.company_code AND json_extract(b.source_payload,'$."바코드"')=json_extract(m.source_payload,'$."바코드"'))<>1`:'';
 const proof=`${managedProductImportAuthorization} AND NOT EXISTS(SELECT 1 FROM json_each(?) e LEFT JOIN managed_products m ON m.owner_id=? AND m.company_code=? AND m.sku_id=json_extract(e.value,'$.sku') WHERE m.sku_id IS NULL OR m.source_payload<>json_extract(e.value,'$.payload') OR m.source_sha256<>json_extract(e.value,'$.sha') OR m.source_row<>json_extract(e.value,'$.row') OR m.imported_at<>json_extract(e.value,'$.importedAt') OR ${managedImportHistorySql('m')}<>json_extract(e.value,'$.history')${barcodeUnique})`,args=[owner,company.code,company.name,expected,owner,company.code];
 const result=await db.batch([
  db.prepare(`SELECT CASE WHEN ${proof} THEN 1 ELSE 0 END AS allowed`).bind(...args),
  db.prepare(`WITH allowed AS MATERIALIZED (SELECT CASE WHEN ${proof} THEN 1 ELSE 0 END AS ok) INSERT INTO managed_import_prices(owner_id,company_code,sku_id,import_date,price,revision,source_name,source_sha256,source_row,created_at,updated_at)
   SELECT ?,?,json_extract(value,'$.sku'),json_extract(value,'$.date'),json_extract(value,'$.price'),1,?,?,json_extract(value,'$.row'),?,? FROM json_each(?) WHERE (SELECT ok FROM allowed)=1
   ON CONFLICT(owner_id,company_code,sku_id,import_date) DO UPDATE SET price=excluded.price,revision=managed_import_prices.revision+1,source_name=excluded.source_name,source_sha256=excluded.source_sha256,source_row=excluded.source_row,updated_at=excluded.updated_at WHERE managed_import_prices.price<>excluded.price RETURNING sku_id,import_date,price`).bind(...args,owner,company.code,name,file.sha256,now,now,payload),
 ]);
 if((result[0].results[0] as {allowed:number})?.allowed!==1)throw new ManagedImportPriceConflict('원본 상품·매입내역 또는 승인 회사가 변경되었습니다. 파일을 다시 미리보기해주세요.');
 if(result[1].results.length!==plan.counts.added+plan.counts.replaced)throw Error('매입정보 저장 결과를 확인하지 못했습니다.');
 return plan.counts;
}
export async function readManagedImportPrices(owner:string,company:SupplierHubCompany,query:{page:number;pageSize:number;skuId?:string;search?:string}){
 const db=await database(),args:(string|number)[]=[owner,company.code],parts=['i.owner_id=?','i.company_code=?'];if(query.skuId){parts.push('i.sku_id=?');args.push(query.skuId);}if(query.search){parts.push(`(m.title LIKE ? ESCAPE '\\' OR i.sku_id LIKE ? ESCAPE '\\')`);const value='%'+query.search.replace(/[\\%_]/g,value=>'\\'+value)+'%';args.push(value,value);}
 const from=`FROM managed_import_prices i JOIN managed_products m ON m.owner_id=i.owner_id AND m.company_code=i.company_code AND m.sku_id=i.sku_id WHERE ${parts.join(' AND ')}`,result=await db.batch([db.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...args),db.prepare(`SELECT i.sku_id AS skuId,m.title,json_extract(m.source_payload,'$."노출ID"') AS exposureId,i.import_date AS date,i.price ${from} ORDER BY i.import_date DESC,i.sku_id LIMIT ? OFFSET ?`).bind(...args,query.pageSize,(query.page-1)*query.pageSize)]);
 return {records:(result[1].results as ManagedImportPriceRecord[]).map(row=>({...row,exposureId:row.exposureId??''})),total:Number((result[0].results[0] as {total:number}).total),page:query.page,pageSize:query.pageSize};
}
export async function readManagedImportPricesForExport(owner:string,company:SupplierHubCompany,query:{skuId?:string;search?:string}){
 const data=await readManagedImportPrices(owner,company,{...query,page:1,pageSize:5001});
 if(data.total>5000)throw new RangeError('매입내역이 5000개를 초과합니다. 검색 조건을 좁혀주세요.');
 if(data.records.length!==data.total)throw Error('매입내역 전체 조회 결과를 확인하지 못했습니다.');
 return data.records;
}
