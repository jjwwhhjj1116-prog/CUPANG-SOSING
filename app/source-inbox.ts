import {validatePageSource,pageSourceIssues,type PageSource} from '@/extensions/supplier-hub/page-source.mjs';
import {validateCollectionResult,type CollectionResult} from '@/app/collection-result';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
export type SourceInboxItem={id:string;ownerId:string;company:SupplierHubCompany;fingerprint:string;snapshot:PageSource;revision:number;receivedAt:string;reviewed:PageSource|null;issues:string[];archivedAt:string|null;captureOriginId?:string;captureVersion?:number};
export function sourceInboxStatus(snapshot:PageSource,reviewed:PageSource|null){return pageSourceIssues(reviewed??snapshot);}
export function pageSourceCollectionResult(snapshot:PageSource,reviewed=false):CollectionResult{
 const source=validatePageSource(snapshot),issues=pageSourceIssues(source);if(issues.length)throw Error(`수집함에서 ${issues.join('·')}을 확인해주세요.`);
 const result=validateCollectionResult({schemaVersion:1,sourceUrl:source.sourceUrl,provider:reviewed?'chrome-reviewed-page-v1':'chrome-current-page-v1',collectedAt:source.collectedAt,title:source.title,description:source.description,attributes:source.attributes,images:source.images,
  options:source.options.map(row=>({sku:row.supplierSku,name:row.name,unitPriceCny:row.unitPriceCny,minimumOrder:row.minimumOrder,stock:row.stock,...(row.imageUrl&&source.images.some(item=>item.url===row.imageUrl)?{imageIndex:source.images.findIndex(item=>item.url===row.imageUrl)}:{})}))},source.offerId);
 return result;
}
export async function pageSourceFingerprint(snapshot:PageSource){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot))))].map(value=>value.toString(16).padStart(2,'0')).join('');}
/** Review is separate from the immutable observed snapshot. Never manufacture
 * a supplier SKU from a display-name/map key or silently assume CNY / MOQ=1. */
export function reviewPageSource(snapshot:PageSource,input:unknown):PageSource{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['title','options'].includes(key)))throw Error('검토할 상품명·옵션을 확인해주세요.');
 const value=input as {title:unknown;options:unknown};
 if(!Array.isArray(value.options)||!value.options.length||value.options.length>snapshot.options.length)throw Error('검토할 옵션을 선택해주세요.');
 const options=value.options.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!['key','name','supplierSku','unitPriceCny','currency','minimumOrder'].includes(key)))throw Error('옵션 검토 항목을 확인해주세요.');
  const body=row as PageSource['options'][number],original=snapshot.options.find(item=>item.key===body.key);if(!original)throw Error('수집 원문에 없는 옵션입니다.');
  return {...original,...body};
 });
 const reviewed=validatePageSource({...snapshot,title:value.title,options});pageSourceCollectionResult(reviewed,true);return reviewed;
}
