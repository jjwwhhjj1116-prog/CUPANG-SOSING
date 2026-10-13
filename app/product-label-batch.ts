import { PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-pool-limit';
import { productLabelPlan, verifyProductLabelsView, type ProductLabelsView } from '@/app/product-label';
import { attachProductLabel, productLabelReferenceSelection } from '@/app/product-label-attachment';
import { findProductLabelUpload, productLabelPreviewSignature } from '@/app/product-label-upload';
import { applyQuotationChanges, type QuotationChange, type QuotationFieldsView } from '@/app/quotation-schema';
import type { DocumentImagePlan } from '@/app/document-image';
import { readProductLabelReceipt } from '@/app/product-label-proof';
import { labelUploadDigest } from '@/app/label-upload-key';

type Pending = { view: ProductLabelsView; optionId: string | null; key: string | null; operation: 'upload'|'pool'|'reference';
  quotation: QuotationFieldsView | null; changes: QuotationChange[] | null; blob: Blob | null; released: boolean };
type Entry = { signature: string; uploaded: Map<string|null,string>; pending: Pending|null };
export type ProductNineLabelBatchCache = Map<string,Entry>;
type Options = { cache: ProductNineLabelBatchCache; render: (plan: DocumentImagePlan, optionId: string|null) => Promise<{blob:Blob}>;
  shouldStop:()=>boolean; onProgress:(value:{completed:number;total:number;optionLabel:string})=>void; fetcher?:typeof fetch };
export type ProductNineLabelBatchResult = { completed:number;total:number;stopped:boolean;uncertain:boolean };
const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
const included=(view:ProductLabelsView)=>view.rows.filter(row=>row.included);
const signature=(productId:string,endpoint:string,view:ProductLabelsView)=>JSON.stringify({category:view.categoryContext,
  plans:included(view).map(row=>[row.optionId,productLabelPreviewSignature({productId,endpoint,view,optionId:row.optionId})])});
const paths=(productId:string)=>({endpoint:`/api/products/${encodeURIComponent(productId)}/product-labels`,quotationEndpoint:`/api/products/${encodeURIComponent(productId)}/quotation-fields`});
class LabelReadError extends Error{constructor(message:string,public status:number,public code?:string){super(message);}}
async function readView(productId:string,endpoint:string,request:typeof fetch){
 const response=await request(endpoint,{cache:'no-store'}),value=await response.json() as ProductLabelsView&{error?:string;code?:string};
 if(!response.ok)throw new LabelReadError(value?.error||'저장된 9항목 표시사항을 읽지 못했습니다.',response.status,value?.code);verifyProductLabelsView(value,null);
 if(value.productId!==productId)throw Error('선택한 상품의 표시사항을 확인해주세요.');return value;
}
export function pendingProductNineLabelBatch(cache:ProductNineLabelBatchCache){return [...cache].find(([,entry])=>entry.pending!==null)?.[0]??null;}
export function productNineLabelBatchHeld(cache:ProductNineLabelBatchCache){return [...cache.values()].some(entry=>entry.pending&&!entry.pending.released);}
/** An explicit stop may leave safely, retaining uploaded bytes and the exact
 * pending recipe. A subsequent execution still requires read-only recovery. */
export function releaseProductNineLabelBatch(cache:ProductNineLabelBatchCache){for(const entry of cache.values())if(entry.pending)entry.pending.released=true;}

export async function recoverProductNineLabelBatch(productId:string,cache:ProductNineLabelBatchCache,request:typeof fetch=fetch):Promise<'applied'|'ready'|'changed'> {
 const entry=cache.get(productId),pending=entry?.pending;if(!entry||!pending)throw Error('읽기 확인할 현재 표시사항 연결이 없습니다.');
 const {endpoint,quotationEndpoint}=paths(productId);let view:ProductLabelsView;
 try{view=await readView(productId,endpoint,request);}catch(error){
  if(error instanceof LabelReadError&&(error.status===404||error.status===409&&['COLLECTION_COMPANY_MISMATCH','COLLECTION_COMPANY_INVALID','QUOTATION_COMPANY_MISMATCH','QUOTATION_COMPANY_INVALID','PRODUCT_LABELS_CATEGORY_REQUIRED'].includes(error.code??''))){entry.pending=null;return 'changed';}throw error;
 }
 if(signature(productId,endpoint,view)!==entry.signature){entry.pending=null;return 'changed';}
 const stored=await findProductLabelUpload({productId,endpoint,view:pending.view,optionId:pending.optionId},request);
 if(pending.key&&stored.key!==pending.key)throw Error('같은 표시사항의 업로드 저장본을 확인하지 못했습니다. 원본을 유지했습니다.');
 if(stored.key){
  const receipt=await readProductLabelReceipt(stored.uploadId,request),proof=receipt.proof;
  const [planSha,categorySha]=await Promise.all([labelUploadDigest(new TextEncoder().encode(JSON.stringify(productLabelPlan(pending.view,pending.optionId)))),
    labelUploadDigest(new TextEncoder().encode(JSON.stringify([pending.view.categoryContext.categoryId,pending.view.categoryContext.categoryPath])))]);
  if(receipt.key!==stored.key||!proof||proof.productId!==productId||proof.optionId!==pending.optionId||proof.profileId!==pending.view.categoryContext.profileId||proof.planSha256!==planSha||proof.categorySha256!==categorySha)
    throw Error('현재 저장된 PNG의 정확한 9항목 원천을 확인하지 못했습니다. 자동 연결하지 않았습니다.');
  entry.uploaded.set(pending.optionId,stored.key);pending.key=stored.key;
 }
 if(pending.operation!=='reference'){entry.pending=null;return 'ready';}
 const response=await request(quotationEndpoint,{cache:'no-store'}),quotation=await response.json() as QuotationFieldsView&{error?:string};
 if(!response.ok)throw Error(quotation?.error||'현재 라벨 연결을 읽지 못했습니다.');
 const before=pending.quotation,changes=pending.changes;
 if(!before||!changes||!stored.key||quotation.productVersion!==view.productVersion||quotation.revision!==view.quotationRevision
   ||quotation.inputFingerprint!==view.quotationInputFingerprint||!same(quotation.categoryContext,view.categoryContext))throw Error('현재 옵션 라벨 연결의 저장 원천을 확인하지 못했습니다.');
 if(quotation.revision===before.revision&&quotation.inputFingerprint===before.inputFingerprint&&same(quotation.overrides,before.overrides)){
   entry.pending=null;return 'ready';
 }
 if(quotation.revision!==before.revision+1||Date.parse(quotation.productVersion)<=Date.parse(before.productVersion)
   ||quotation.contentRevision!==before.contentRevision||quotation.optionRevision!==before.optionRevision||!same(quotation.imageKeys,before.imageKeys)
   ||!same(quotation.overrides,applyQuotationChanges(before.overrides,changes)))throw Error('라벨 연결에 다른 수정값이 있습니다. 자동으로 재저장하지 않았습니다.');
 if(!changes.every(change=>quotation.resolved.rows.find(row=>row.optionId===pending.optionId)?.fields[change.fieldKey]?.value===change.value))throw Error('선택 옵션의 최종 라벨 연결을 확인하지 못했습니다.');
 entry.pending=null;return 'applied';
}

/** Saved stage-six nine rows only. Stage-seven notice tables retain their own
 * existing batch helper; neither path invents legal/source attributes. */
export async function runProductNineLabels(productId:string,options:Options):Promise<ProductNineLabelBatchResult|null>{
 if(options.shouldStop())return null;
 const request=options.fetcher??fetch,{endpoint,quotationEndpoint}=paths(productId),view=await readView(productId,endpoint,request);
 if(options.shouldStop())return null;
 const rows=included(view);if(!rows.length)throw Error('견적에 포함할 옵션을 선택해주세요.');
 const planSignature=signature(productId,endpoint,view);let entry=options.cache.get(productId);
 if(entry?.pending)return {completed:0,total:rows.length,stopped:true,uncertain:true};
 if(!entry||entry.signature!==planSignature){entry={signature:planSignature,uploaded:new Map(),pending:null};options.cache.set(productId,entry);}
 const result=(completed:number,stopped:boolean,uncertain=false)=>({completed,total:rows.length,stopped,uncertain});
 // Validate all included nine-row plans and exact per-option reference limits
 // before rendering/uploading. Durable recipes are the reuse authority.
 const quoteResponse=await request(quotationEndpoint,{cache:'no-store'}),quote=await quoteResponse.json() as QuotationFieldsView&{error?:string};
 if(!quoteResponse.ok)throw Error(quote?.error||'선택 상품의 견적을 읽지 못했습니다.');
 if(quote.productVersion!==view.productVersion||quote.revision!==view.quotationRevision||quote.inputFingerprint!==view.quotationInputFingerprint
   ||!same(quote.categoryContext,view.categoryContext)||!same(quote.imageKeys,view.imageKeys))throw Error('표시사항과 견적서 저장값이 변경됐습니다. 다시 확인해주세요.');
 const additions=new Set<string>();let newFiles=0;
 for(const row of rows){
  if(options.shouldStop())return result(0,true);
  productLabelPlan(view,row.optionId);const stored=await findProductLabelUpload({productId,endpoint,view,optionId:row.optionId},request);
  if(stored.key)entry.uploaded.set(row.optionId,stored.key);else entry.uploaded.delete(row.optionId);
  const references=await productLabelReferenceSelection({productId,view:quote,optionId:row.optionId},stored.key,request),limit=Math.min(...references.target.fields.map(field=>field.maxItems??30));
  if(references.retained.length+(stored.key&&references.retained.includes(stored.key)?0:1)>limit)throw Error(`${row.optionLabel}: 표시사항 이미지 ${limit}개 한도입니다.`);
  if(!stored.key)newFiles++;else if(!view.imageKeys.includes(stored.key))additions.add(stored.key);
 }
 if(view.imageKeys.length+newFiles+additions.size>PRODUCT_IMAGE_POOL_LIMIT)throw Error(`상품 이미지 ${PRODUCT_IMAGE_POOL_LIMIT}개 한도입니다. 원본을 보존할 라벨 공간을 확인해주세요.`);
 for(const [index,row]of rows.entries()){
  if(options.shouldStop())return result(index,true);
  const current=await readView(productId,endpoint,request);
  if(signature(productId,endpoint,current)!==planSignature)throw Error('포함 옵션 또는 9항목 표시사항이 변경됐습니다. 완료한 파일은 보존했습니다.');
  options.onProgress({completed:index,total:rows.length,optionLabel:row.optionLabel});
  const key=entry.uploaded.get(row.optionId)??null,blob=key?null:(await options.render(productLabelPlan(current,row.optionId),row.optionId)).blob;
  if(options.shouldStop())return result(index,true);
  let uncertain=false,lastWriteOk=false,lastQuote:QuotationFieldsView|null=null;
  const guarded:typeof fetch=async(url,init)=>{
   const method=init?.method??'GET',write=method!=='GET';
   if(write&&uncertain)throw Error('이전 저장 응답을 확인 중입니다. 추가 저장하지 않았습니다.');
   if(write){const operation=url==='/api/files'?'upload':String(url).endsWith('/attachments')?'pool':'reference';
    entry!.pending={view:current,optionId:row.optionId,key:entry!.uploaded.get(row.optionId)??null,operation,quotation:lastQuote,
     changes:operation==='reference'?JSON.parse(String(init?.body)).changes:null,blob,released:false};}
   let response:Response;try{response=await request(url,init);}catch(error){if(write)uncertain=true;throw error;}
   if(write){lastWriteOk=response.ok;if(response.status>=500||response.status===429)uncertain=true;}
   if(String(url)===quotationEndpoint&&method==='GET'&&response.ok)lastQuote=await response.clone().json() as QuotationFieldsView;
   return response;
  };
  try{
   await attachProductLabel({productId,endpoint,quotationEndpoint,renderedView:current,optionId:row.optionId,blob,uploadedKey:key,
    onUploaded:value=>{entry!.uploaded.set(row.optionId,value);if(entry!.pending)entry!.pending.key=value;}},guarded);
   entry.pending=null;options.onProgress({completed:index+1,total:rows.length,optionLabel:row.optionLabel});
   // Even a successfully read-back lost ACK ends this run at the current SKU.
   if(uncertain)return result(index+1,true);
  }catch(error){if(entry.pending&&lastWriteOk)uncertain=true;if(uncertain)return result(index,true,true);entry.pending=null;throw error;}
 }
 return result(rows.length,false);
}
