import type {SupplierHubCompany} from '@/app/supplier-hub-company';

export type ManagedPurchaseInfoEntry=Record<string,unknown>;
export type ManagedPurchaseInfoProduct={title:string;barcode:string;image:string};
export type ManagedPurchaseInfoView={skuId:string;company:SupplierHubCompany;accountContext:string;revision:number;inputFingerprint:string;sourceVersion:string;
 product:ManagedPurchaseInfoProduct;purchaseInfo:ManagedPurchaseInfoEntry[];originalPurchaseInfo:ManagedPurchaseInfoEntry[];updatedAt:string|null;purchaseInfoComplete:boolean};
export const MANAGED_PURCHASE_INFO_LIMIT=128*1024;
export const MANAGED_PURCHASE_INFO_ROWS=100;
export class ManagedPurchaseInfoError extends Error{constructor(message:string,public status=400,public code='MANAGED_PURCHASE_INFO_INVALID'){super(message);}}
export const managedPurchaseInfoMatchingFields=['구매링크','구매링크init','옵션1_중국어','옵션2_중국어','구매sku','item','상품매칭'] as const;
export const managedPurchaseInfoRequestFields=['요청내역','한글표시사항'] as const;
const textFields=['바코드','상품명','상품명init','등록이미지','구매링크','구매링크init','옵션1_중국어','옵션2_중국어','옵션이미지','매칭상태','요청사항','신고영문명','HSCODE','협의ID','진행현황','묶음대상바코드'];
const quantities=[['판매구성수량',1,true],['구매요청수량',0,true],['묶음구성수량',1,true],['구매재고',0,true],['협의총금액',0,false],['협의단가',0,false],['구매가격',0,false],['신고가격',0,false]] as const;
const object=(value:unknown):value is ManagedPurchaseInfoEntry=>!!value&&typeof value==='object'&&!Array.isArray(value);
const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
function cloneJson(value:unknown,depth=0,path=new Set<object>()):unknown{
 if(depth>16)throw new ManagedPurchaseInfoError('구매정보의 중첩 범위를 확인해주세요.');
 if(value===null||typeof value==='boolean'||typeof value==='string'){if(typeof value==='string'&&(/\u0000/u.test(value)||value.length>MANAGED_PURCHASE_INFO_LIMIT))throw new ManagedPurchaseInfoError('구매정보 텍스트의 범위를 확인해주세요.');return value;}
 if(typeof value==='number'){if(!Number.isFinite(value))throw new ManagedPurchaseInfoError('구매정보에 유효하지 않은 숫자가 있습니다.');return value;}
 if(!object(value)&&!Array.isArray(value))throw new ManagedPurchaseInfoError('구매정보는 JSON으로 보관할 수 있는 값만 입력해주세요.');
 if(path.has(value))throw new ManagedPurchaseInfoError('구매정보에 순환 참조가 있습니다.');path.add(value);
 let result:unknown;if(Array.isArray(value)){if(value.length>10000)throw new ManagedPurchaseInfoError('구매정보 부속 배열의 범위를 확인해주세요.');result=value.map(item=>cloneJson(item,depth+1,path));}
 else{if(Object.keys(value).length>1000)throw new ManagedPurchaseInfoError('구매정보 부속 항목의 범위를 확인해주세요.');result=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,cloneJson(item,depth+1,path)]));}
 path.delete(value);return result;
}
/** Do not drop provider extensions, deliberately empty strings or array order. */
export function validateManagedPurchaseInfo(value:unknown):ManagedPurchaseInfoEntry[]{
 if(!Array.isArray(value)||value.length>MANAGED_PURCHASE_INFO_ROWS||value.some(row=>!object(row)))throw new ManagedPurchaseInfoError('구매정보는 0~100개의 객체 행으로 입력해주세요.');
 const rows=cloneJson(value) as ManagedPurchaseInfoEntry[];
 const payload=JSON.stringify(rows);if(payload.length>20000||new TextEncoder().encode(payload).length>MANAGED_PURCHASE_INFO_LIMIT)throw new ManagedPurchaseInfoError('구매정보는 내보내기 가능한 20,000자·128KB 이하로 나누어 입력해주세요.',413);
 for(const row of rows){
  for(const key of textFields)if(Object.hasOwn(row,key)&&row[key]!==null&&typeof row[key]!=='string')throw new ManagedPurchaseInfoError(`${key}는 원문 텍스트로 입력해주세요.`);
  for(const [key,min,integer]of quantities){const raw=row[key];if(raw===undefined||raw===null||raw==='')continue;
   if(typeof raw!=='number'&&typeof raw!=='string'||typeof raw==='string'&&!/^\d+(?:\.\d+)?$/u.test(raw)||!Number.isFinite(Number(raw))||Number(raw)<min||Number(raw)>1e9||integer&&!Number.isSafeInteger(Number(raw)))throw new ManagedPurchaseInfoError(`${key}의 수량·금액을 확인해주세요.`);
  }
  for(const key of ['checked','showspinner','묶음구성여부','재고동봉'])if(Object.hasOwn(row,key)&&row[key]!==null&&typeof row[key]!=='boolean')throw new ManagedPurchaseInfoError(`${key}는 선택 여부로 입력해주세요.`);
  for(const key of ['요청내역','한글표시사항'])if(Object.hasOwn(row,key)&&row[key]!==null&&!object(row[key]))throw new ManagedPurchaseInfoError(`${key}의 원문 객체를 확인해주세요.`);
 }
 return rows;
}
/** An explicitly present empty legacy cell stays empty in the editable view;
 * missing or damaged source is never silently replaced with an empty array. */
export function parseManagedPurchaseInfo(raw:unknown):ManagedPurchaseInfoEntry[]{
 if(raw===null||typeof raw==='string'&&!raw.trim())return[];
 if(typeof raw!=='string')throw new ManagedPurchaseInfoError('원본 구매정보 배열을 확인하지 못했습니다. 원본 상품 DB를 확인해주세요.',409,'MANAGED_PURCHASE_INFO_SOURCE_INVALID');
 try{const parsed=JSON.parse(raw);return parsed===null?[]:validateManagedPurchaseInfo(parsed);}catch{throw new ManagedPurchaseInfoError('원본 구매정보 배열을 확인하지 못했습니다. 원본 상품 DB를 확인해주세요.',409,'MANAGED_PURCHASE_INFO_SOURCE_INVALID');}
}
export function managedPurchaseInfoComplete(rows:readonly ManagedPurchaseInfoEntry[]){return rows.length>0&&rows.every(row=>row['매칭상태']==='매칭완료'&&row['요청사항']==='등록완료');}
export function createManagedPurchaseInfoEntry(product:ManagedPurchaseInfoProduct):ManagedPurchaseInfoEntry{
 return{checked:false,showspinner:false,'바코드':product.barcode,'상품명':product.title,'상품명init':product.title,'등록이미지':product.image,
  '구매링크':'','구매링크init':'','옵션1_중국어':'','옵션2_중국어':'','판매구성수량':1,'구매요청수량':0,'매칭상태':'매칭대기','요청사항':'등록대기','신고영문명':'',HSCODE:'','협의총금액':0,'협의ID':'','묶음구성여부':false,'묶음구성수량':1,
  '요청내역':{customsType:'integrated',destination:'coupang',deliveryType:'coupang-shipment',exportType:'box',default:true,barcode:false,sticker:false,masking:false,airpacking:false,sewing:false,stamp:false,tag:false,reqcontent:'',reqcontentPurchase:''},
  '한글표시사항':{'제품명':product.title,'수입원/판매원':'','제조원':'','제조국':'','내용량':'','원료명및성분명(재질)':'','상품유형':'','사용시주의사항':'','사용기준':'',custom:'','kc인증':false,'식품용':false}};
}
export function invalidateManagedPurchaseInfoEntry(previous:ManagedPurchaseInfoEntry,next:ManagedPurchaseInfoEntry){
 const value=validateManagedPurchaseInfo([next])[0];
 if(managedPurchaseInfoMatchingFields.some(key=>!same(previous[key],value[key])))value['매칭상태']='매칭필요';
 if(managedPurchaseInfoRequestFields.some(key=>!same(previous[key],value[key])))value['요청사항']='등록대기';
 return value;
}
/** Completion can only be inherited once from a current stored matching/request
 * record. Caller-supplied IDs and cloned rows are never new completion proof. */
export function confirmManagedPurchaseInfoStatuses(previous:readonly ManagedPurchaseInfoEntry[],next:ManagedPurchaseInfoEntry[]){
 const used=new Set<number>(),exact=new Map<number,number>();
 // Reserve unchanged rows first, including after insertion/reordering. A new
 // pending row must not consume an existing completed row's origin proof.
 for(const [position,row]of next.entries()){const index=previous.findIndex((item,i)=>!used.has(i)&&same(item,row));if(index>=0){exact.set(position,index);used.add(index);}}
 for(const [position,row]of next.entries()){
  let index=exact.get(position)??-1;
  if(index<0)index=previous.findIndex((item,i)=>!used.has(i)&&managedPurchaseInfoMatchingFields.every(key=>same(item[key],row[key])));
  const nonMatching=(item:ManagedPurchaseInfoEntry)=>Object.fromEntries(Object.entries(item).filter(([key])=>!['매칭상태','요청사항',...managedPurchaseInfoMatchingFields].includes(key)));
  if(index<0)index=previous.findIndex((item,i)=>!used.has(i)&&same(nonMatching(item),nonMatching(row)));
  if(index<0)index=previous.findIndex((item,i)=>!used.has(i)&&['바코드','상품명','상품명init','등록이미지'].every(key=>same(item[key],row[key])));
  // Link and title/quantity may be edited together. Completed request facts
  // remain valid only when their exact original nested values are retained.
  if(index<0&&row['요청사항']==='등록완료')index=previous.findIndex((item,i)=>!used.has(i)&&item['요청사항']==='등록완료'&&managedPurchaseInfoRequestFields.every(key=>same(item[key],row[key])));
  const before=index<0?undefined:previous[index];if(index>=0)used.add(index);
  const matchingSame=!!before&&managedPurchaseInfoMatchingFields.every(key=>same(before[key],row[key])),requestSame=!!before&&managedPurchaseInfoRequestFields.every(key=>same(before[key],row[key]));
  const matchingAllowed=before?.['매칭상태']==='매칭완료'&&matchingSame,requestAllowed=before?.['요청사항']==='등록완료'&&requestSame;
  if(row['매칭상태']==='매칭완료'&&!matchingAllowed||row['요청사항']==='등록완료'&&!requestAllowed)throw new ManagedPurchaseInfoError('현재 원문으로 확인되지 않은 구매 매칭·요청 완료 상태를 새로 만들 수 없습니다. 변경한 항목은 대기 상태로 저장해주세요.',400,'MANAGED_PURCHASE_INFO_STATUS_INVALID');
  if(before&&(!matchingSame&&row['매칭상태']!=='매칭필요'||!requestSame&&row['요청사항']!=='등록대기'))throw new ManagedPurchaseInfoError('변경한 구매 링크·옵션은 매칭필요, 요청·표시사항은 등록대기 상태로 다시 확인해주세요.',400,'MANAGED_PURCHASE_INFO_STATUS_INVALID');
 }
}
export async function managedPurchaseInfoDigest(value:unknown){const bytes=new TextEncoder().encode(JSON.stringify(value));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');}
