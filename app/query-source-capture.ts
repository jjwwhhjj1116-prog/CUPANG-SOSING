import {COLLECTION_RESULT_LIMIT,validateCollectionResult,type CollectionResult} from '@/app/collection-result';
import {parseCollectionRequest} from '@/app/sourcing';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';

/** A server-query capture is its own immutable receipt. It is never converted
 * to PageSource: that would discard source pricing and gallery provenance. */
export type QuerySourceCapture={id:string;ownerId:string;company:SupplierHubCompany;fingerprint:string;snapshot:CollectionResult;revision:number;captureVersion:number;receivedAt:string;archivedAt:string|null};
export type QuerySourceCaptureSummary=Omit<QuerySourceCapture,'snapshot'>&{sourceUrl:string;offerId:string;title:string;optionCount:number;thumbnailUrl:string|null};

/** Reject accessors/non-JSON values before observing them. Validation below
 * supplies the one canonical field order for the entire source envelope. */
function jsonValue(value:unknown,depth=0):unknown{
 if(depth>30)throw Error('수집 원문 구조를 확인해주세요.');
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'){if(Number.isFinite(value))return value;throw Error('수집 원문 숫자를 확인해주세요.');}
 if(typeof value!=='object'||!value)throw Error('수집 원문은 JSON 값이어야 합니다.');
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
 if(keys.some(key=>typeof key!=='string'||!Object.hasOwn(descriptors[key],'value')))throw Error('수집 원문 속성을 확인해주세요.');
 if(Array.isArray(value)){
  if(keys.length!==value.length+1||!keys.every(key=>key==='length'||/^(?:0|[1-9]\d*)$/.test(key as string))||Object.keys(value).length!==value.length)throw Error('수집 원문 배열을 확인해주세요.');
  return value.map((_item,index)=>jsonValue(descriptors[String(index)].value,depth+1));
 }
 if(Object.prototype.toString.call(value)!=='[object Object]'||keys.some(key=>!descriptors[key as string].enumerable))throw Error('수집 원문 객체를 확인해주세요.');
 return Object.fromEntries(keys.map(key=>[key,jsonValue(descriptors[key as string].value,depth+1)]));
}

export function normalizeQuerySourceCapture(input:unknown,expectedOfferId?:string,now=Date.now()):CollectionResult{
 const value=jsonValue(input) as Record<string,unknown>;
 if(!value||Array.isArray(value)||typeof value!=='object')throw Error('수집 원문 객체를 확인해주세요.');
 const offer=parseCollectionRequest({urls:[value.sourceUrl]})[0].offerId;
 if(expectedOfferId!==undefined&&expectedOfferId!==offer||Object.hasOwn(value,'offerId')&&value.offerId!==offer)throw Error('수집 원문의 상품번호가 다릅니다.');
 const body={...value};delete body.offerId;
 const normalized=validateCollectionResult(body,offer,now);
 if(new TextEncoder().encode(JSON.stringify(normalized)).byteLength>COLLECTION_RESULT_LIMIT)throw Error('수집 원문은 512KiB 이하여야 합니다.');
 return normalized;
}
export const normalizeQuerySource=normalizeQuerySourceCapture;

export async function querySourceFingerprint(source:unknown):Promise<string>{
 const canonical=normalizeQuerySourceCapture(source);
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical))))].map(value=>value.toString(16).padStart(2,'0')).join('');
}

export function querySourceCaptureSummary(item:QuerySourceCapture):QuerySourceCaptureSummary{
 const {snapshot,...summary}=item;
 return {...summary,sourceUrl:snapshot.sourceUrl,offerId:snapshot.offerId,title:snapshot.title,optionCount:snapshot.options.length,thumbnailUrl:snapshot.images.find(image=>image.role==='main')?.url??snapshot.images[0]?.url??null};
}
