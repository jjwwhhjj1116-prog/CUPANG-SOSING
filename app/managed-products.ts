import {readXlsxArchive,inspectXlsxArchive} from '@/app/xlsx-template';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import type {ManagedTableFilter,ManagedTableSort} from '@/app/managed-product-table';
import type {ManagedPurchaseInfoEntry} from '@/app/managed-purchase-info';
import type {ManagedProductHistory} from '@/app/managed-product-history';

export const MANAGED_PRODUCT_FILE_LIMIT=5_000_000;
export type ManagedProductInput={skuId:string;title:string;sourceRow:number;values:Record<string,string>};
export type ManagedProduct=ManagedProductInput&{companyCode:string;sourceName:string;importedAt:string;firstImportedAt:string;importPrices?:{date:string;price:string}[];latestImportedPrice?:{date:string;price:string};effectiveImportPrice?:string|null;history?:ManagedProductHistory;purchaseInfo?:ManagedPurchaseInfoEntry[];purchaseInfoRevision?:number;purchaseInfoUpdatedAt?:string};
export type ManagedProductImport={rows:ManagedProductInput[];headers:string[];sha256:string;company:SupplierHubCompany};
export type ManagedProductImportCounts={total:number;added:number;updated:number;unchanged:number};
export type ManagedProductAccountContext={accountContext:string};
export class ManagedProductContextChanged extends Error {}
/** Identify the authenticated import owner and exact company without exposing an owner ID. */
export async function managedProductAccountContext(ownerId:string,company:SupplierHubCompany):Promise<string>{
 const bytes=new TextEncoder().encode(JSON.stringify(['sourceflow-managed-product-account-v1',ownerId,company.code,company.name]));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
}
export type ManagedProductFilter='all'|'unavailable'|'loser'|'no-purchase'|'no-import'|'product-id-changed'|'price-changed'|'other-sellers';
export type ManagedProductQuery={page:number;pageSize:number;search:string;filter:ManagedProductFilter;sort?:ManagedTableSort|null;columnFilters?:ManagedTableFilter[];orderStatus?:string};
export const MANAGED_ORDER_STATUS_LIMIT=200,MANAGED_ORDER_STATUS_LENGTH_LIMIT=2000;
export type ManagedOrderStatusCount={value:string;count:number};
export function validManagedOrderStatus(value:unknown):value is string{return typeof value==='string'&&value.length<=MANAGED_ORDER_STATUS_LENGTH_LIMIT&&!/[\u0000\ud800-\udfff]/u.test(value);}
/** Absence means all statuses; an explicitly supplied empty string means the
 * original blank cell. Never trim, rename or infer a supplier status. */
export function parseManagedOrderStatus(params:URLSearchParams):string|undefined{
 const values=params.getAll('orderStatus');if(!values.length)return undefined;
 if(values.length!==1||!validManagedOrderStatus(values[0]))throw Error('발주가능상태는 원본의 한 가지 값을 그대로 선택해주세요.');
 return values[0];
}
export type ManagedProductList={products:ManagedProduct[];total:number;page:number;pageSize:number;company:SupplierHubCompany;summary:{total:number;unavailable:number;loser:number;noPurchase:number;noImport:number;productIdChanged:number;priceChanged:number;otherSellers:number;lastImportedAt:string|null;priceDate:string|null;orderStatuses:ManagedOrderStatusCount[]}};
const required=['상품명','SKUID','바코드','발주가능상태','판매가','판매가기준일','공급가','구매정보','매입정보'];

/** Import only the seller's exported rows. No registration or pricing state is inferred. */
export async function parseManagedProductWorkbook(bytes:ArrayBuffer,company:SupplierHubCompany):Promise<ManagedProductImport>{
 if(bytes.byteLength>MANAGED_PRODUCT_FILE_LIMIT)throw Error('상품 DB 파일은 5MB 이하만 지원합니다.');
 const inspection=inspectXlsxArchive(await readXlsxArchive(bytes),{rowLimit:5001});
 if(inspection.sheets.length!==1||inspection.sheets[0].name!=='로켓배송상품DB')throw Error('쿠플러스에서 내려받은 로켓배송상품DB XLSX를 선택해주세요.');
 if(inspection.warnings.some(message=>/수식|오류 셀|200열/.test(message)))throw Error('상품 DB에 수식·오류 셀 또는 지원 범위를 넘는 열이 있습니다. 값이 저장된 원본을 확인해주세요.');
 const sheet=inspection.sheets[0],header=sheet.rows.find(row=>row.rowNumber===1),headers=header?.values??[];
 if(headers.length<required.length||headers.length>80||headers.some(name=>!name||name!==name.trim()||name.length>100||['__proto__','constructor','prototype'].includes(name))
  ||new Set(headers).size!==headers.length||required.some(name=>!headers.includes(name)))throw Error('상품 DB 머리글을 확인해주세요. 상품명·SKUID·가격·구매 및 매입정보 열이 필요합니다.');
 if(['YOOFAM 매입내역','YOOFAM 적용 매입일자','YOOFAM 적용 매입가','YOOFAM 적용 구매정보','YOOFAM 구매정보 기준시각'].some(key=>headers.includes(key)))throw Error('YOOFAM 매입내역·구매정보가 포함된 내보내기는 조회·보관용입니다. 상품 DB 가져오기에는 쿠플러스 원본 DB를 사용하고, 매입가 업로드는 별도 3열 양식을 사용해주세요.');
 const rows:ManagedProductInput[]=[],skus=new Set<string>();let totalBytes=0;
 for(const row of sheet.rows.filter(row=>row.rowNumber>1)){
  if(row.values.length>headers.length)throw Error(`${row.rowNumber}행에 머리글이 없는 값이 있습니다.`);
  const values=Object.fromEntries(headers.map((name,index)=>[name,row.values[index]??'']));
  const skuId=values.SKUID.trim(),title=values['상품명'].trim();
  if(!/^\d{1,30}$/.test(skuId)||!title||title.length>2000)throw Error(`${row.rowNumber}행의 SKUID 또는 상품명을 확인해주세요.`);
  if(skus.has(skuId))throw Error(`${row.rowNumber}행에 중복 SKUID가 있습니다. 중복 행을 확인해주세요.`);
  for(const key of ['회사코드','Company Code','companyCode'])if(Object.hasOwn(values,key)&&values[key].trim()!==company.code)throw Error(`${row.rowNumber}행의 회사코드가 로그인한 회사와 다릅니다.`);
  const length=new TextEncoder().encode(JSON.stringify(values)).length;totalBytes+=length;
  if(length>32000||totalBytes>3_000_000||Object.values(values).some(value=>value.length>20000||/\u0000/.test(value)))throw Error('상품 DB의 행 또는 전체 내용이 가져오기 한도를 초과했습니다.');
  skus.add(skuId);rows.push({skuId,title,sourceRow:row.rowNumber,values});
 }
 if(!rows.length||rows.length>5000)throw Error('상품 DB는 1~5000개 상품을 한 번에 가져올 수 있습니다.');
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
 return {rows,headers,sha256,company};
}
