import {env} from 'cloudflare:workers';
import {managedProductAccountContext} from '@/app/managed-products';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import {ManagedProductBarcodeError,projectManagedBarcodeLabel,projectManagedBarcodeProductLabel,validateManagedProductBarcodeView,type ManagedBarcodeLabel,type ManagedProductBarcodeView} from '@/app/managed-product-barcode';

type Source={owner_id:string;company_code:string;sku_id:string;title:string;source_payload:string;source_name:string;source_sha256:string;source_row:number;first_imported_at:string;imported_at:string;manual_revision:number|null;manual_payload:string|null;manual_updated_at:string|null;account_authorized:number};
export type ManagedProductBarcodeSnapshot={view:ManagedProductBarcodeView;source:Source};
const changed=()=>new ManagedProductBarcodeError('계정·회사·원본 상품 또는 표시사항이 변경되었습니다. 현재 저장본을 다시 확인해주세요.',409,'MANAGED_PRODUCT_BARCODE_CONFLICT');
async function sourceRow(owner:string,company:SupplierHubCompany,skuId:string):Promise<Source|null> {
 if(!env.DB)throw Error('D1 unavailable');
 // Read-only means no lazy CREATE TABLE, purchase sidecar, history or import.
 const tables=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('managed_products','managed_purchase_info')").all<{name:string}>();
 const names=new Set(tables.results.map(row=>row.name));if(!names.has('managed_products'))return null;
 const manual=names.has('managed_purchase_info'),projection=manual?'i.revision AS manual_revision,i.payload AS manual_payload,i.updated_at AS manual_updated_at':'NULL AS manual_revision,NULL AS manual_payload,NULL AS manual_updated_at';
 return env.DB.prepare(`SELECT m.owner_id,m.company_code,m.sku_id,m.title,m.source_payload,m.source_name,m.source_sha256,m.source_row,m.first_imported_at,m.imported_at,${projection},
  EXISTS(SELECT 1 FROM members WHERE id=? AND status='approved' AND company_code=? AND company_name=?) AS account_authorized
  FROM managed_products m ${manual?'LEFT JOIN managed_purchase_info i ON i.owner_id=m.owner_id AND i.company_code=m.company_code AND i.sku_id=m.sku_id':''} WHERE m.owner_id=? AND m.company_code=? AND m.sku_id=?`).bind(owner,company.code,company.name,owner,company.code,skuId).first<Source>();
}
const digest=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
export async function readManagedProductBarcode(owner:string,company:SupplierHubCompany,skuId:string):Promise<ManagedProductBarcodeSnapshot> {
 const source=await sourceRow(owner,company,skuId);if(!source)throw new ManagedProductBarcodeError('현재 회사의 저장된 상품 SKU를 찾을 수 없습니다.',404,'MANAGED_PRODUCT_BARCODE_NOT_FOUND');if(source.account_authorized!==1)throw changed();
 const values=JSON.parse(source.source_payload) as Record<string,unknown>;if(!values||typeof values!=='object'||Array.isArray(values)||typeof values['바코드']!=='string')throw new ManagedProductBarcodeError('원본 상품의 바코드를 확인해주세요.',409,'MANAGED_PRODUCT_BARCODE_SOURCE_INVALID');
 const barcode=values['바코드'],labelInfo:ManagedBarcodeLabel[]=[],own=projectManagedBarcodeProductLabel(values);if(own)labelInfo.push({source:'product',index:null,fields:own});
 const manual=source.manual_payload!==null;let purchase:unknown=manual?JSON.parse(source.manual_payload!):values['구매정보'];if(typeof purchase==='string'){try{purchase=JSON.parse(purchase);}catch{purchase=null;}}
 if(Array.isArray(purchase)&&purchase.length<=100)for(const [index,entry] of purchase.entries())if(entry&&typeof entry==='object'&&!Array.isArray(entry)&&entry['바코드']===barcode){const fields=projectManagedBarcodeLabel(entry['한글표시사항']);if(fields)labelInfo.push({source:manual?'purchase-info-manual':'purchase-info-original',index,fields});}
 const accountContext=await managedProductAccountContext(owner,company),sourceVersion=await digest(['managed-product-barcode-v1',accountContext,source]);
 const view=validateManagedProductBarcodeView({skuId,company,accountContext,sourceVersion,product:{title:source.title,barcode},labelInfo,sourceName:source.source_name,sourceRow:source.source_row,importedAt:source.imported_at},{skuId,company,accountContext});
 return {view,source};
}
export async function managedProductBarcodeSourcesCurrent(owner:string,company:SupplierHubCompany,snapshot:ManagedProductBarcodeSnapshot):Promise<boolean> {
 const current=await sourceRow(owner,company,snapshot.view.skuId);return !!current&&current.account_authorized===1&&JSON.stringify(current)===JSON.stringify(snapshot.source);
}
