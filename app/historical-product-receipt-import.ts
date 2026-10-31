import {historicalProductReceiptSourceFromNativePlan,validateHistoricalProductReceiptCandidate} from '../extensions/supplier-hub/preserved-product-receipt.mjs';
import {productReceiptCanonical,parseStoredProductReceipt,type ProductReceiptObservation} from '@/app/supplier-hub-product-receipt';
import type {NativeAssetSourcePlan} from '@/app/native-asset-source-plan';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import {SingleReceiptError} from '@/app/supplier-hub-single-receipt';

const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(productReceiptCanonical(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const fail=():never=>{throw new SingleReceiptError('원래 요청·본문·문서와 현재 접수 결과의 연결이 다릅니다. 다시 전송하지 않고 확인을 중단했습니다.',409,'HISTORICAL_RECEIPT_IMPORT');};

/** Receipt-only import. A historical checkpoint is not permission to resume a
 * document. Retain its original identity; independently require today's saved
 * body to reproduce both historical hashes before the first local insert. New
 * transmission readiness and image-edit sidecars remain separate concerns. */
export async function historicalProductReceiptImport(value:unknown,input:{origin:string;ownerId:string;productId:string;company:SupplierHubCompany;plan:NativeAssetSourcePlan;now?:number}):Promise<ProductReceiptObservation>{
 productReceiptCanonical(value);
 if(!object(value)||!object(value.anchor)||!object(value.anchor.identity))return fail();
 const requested=value.anchor.identity.requestedProfileId;
 if(requested!==null&&(typeof requested!=='string'||!/^\w[\w-]{0,99}$/.test(requested)))return fail();
 const plan=input.plan,body=plan.body;
 if(!plan.identity||plan.identity.ownerId!==input.ownerId||plan.identity.productId!==input.productId||!body||!Array.isArray(body.jsonDocument))return fail();
 const currentSource=await historicalProductReceiptSourceFromNativePlan({plan,requestedProfileId:requested,productName:body.productName,categoryPath:body.categoryPath});
 const candidate=await validateHistoricalProductReceiptCandidate(value,{scope:{origin:input.origin,ownerId:input.ownerId,company:input.company},currentSource,now:input.now??Date.now()});
 if(candidate.anchor.target.productId!==input.productId)return fail();
 const prepared=JSON.parse(productReceiptCanonical(body));
 for(const document of prepared.jsonDocument){
  if(!object(document))return fail();
  const image=document.imagePage;
  if(object(image))for(const key of ['msrpAgree','labelContactAgreed'])if(Object.hasOwn(image,key)){
   if(typeof image[key]!=='boolean')return fail();image[key]=false;
  }
 }
 if(await hash(body)!==candidate.anchor.originalBodySha256||await hash(prepared)!==candidate.anchor.preparedBodySha256)return fail();
 const a=candidate.anchor,i=a.identity;
 const record=parseStoredProductReceipt({format:'yoofam-product-document-receipt-v1',recordType:'product-document',evidence:'chrome-observation',productId:i.productId,
  profileId:i.profileId,requestedProfileId:i.requestedProfileId,categoryId:i.categoryId,fingerprint:i.fingerprint,inputFingerprint:i.inputFingerprint,schemaSha256:i.schemaSha256,
  source:i.source,company:i.company,members:i.members,requestId:a.target.requestId,docId:a.target.docId,identity:i,identityDigest:a.identityDigest,packetDigest:a.packetDigest,
  preparedBodySha256:a.preparedBodySha256,originalBodySha256:a.originalBodySha256,receipt:candidate.receipt,registered:false,recordedAt:new Date(input.now??Date.now()).toISOString()});
 const {recordedAt:omitted,...observation}=record;void omitted;return observation;
}
