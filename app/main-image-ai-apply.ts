import {imageMetadata,type ImageEditJob,type ImageEditView} from '@/app/automation/image-edit';
import {isOwnedImageKey,MAX_IMAGE_BYTES} from '@/app/image-files';
import {mainImageChanges,mainImageValue,readMainImageView,saveMainImageView,verifyMainImageSave,verifyMainImageView} from '@/app/quotation-main-image';
import {verifyOptionImageRecovery} from '@/app/quotation-image-targets';
import type {QuotationFieldsView} from '@/app/quotation-schema';
import type {FreeImageQuotationRequest} from '@/app/free-image-translation-client';

export type MainImageAiTarget={ownerId:string;productId:string;sourceKey:string;productVersion:string;quotationTarget:FreeImageQuotationRequest;quotationView:QuotationFieldsView};
export type MainImageAiApplyAttempt={target:MainImageAiTarget;job:ImageEditJob;before:QuotationFieldsView;alreadyApplied?:QuotationFieldsView};
const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
const fail=():never=>{throw Error('AI 결과를 만들 때 선택한 옵션·대표이미지 또는 견적서 저장값이 변경되었습니다. 현재 이미지에서 다시 확인해주세요.');};
function validateTarget(target:MainImageAiTarget){
 const {quotationTarget:slot,quotationView:view}=target,binding=verifyMainImageView(view);
 if(!/^\w[\w-]{0,99}$/.test(target.productId)||!isOwnedImageKey(target.ownerId,target.sourceKey)||slot.kind!=='quotation'||slot.input!=='mainImage'||slot.slotIndex!==0
   ||slot.value!==target.sourceKey||slot.fieldKey!==binding.primary||slot.revision!==view.revision||slot.inputFingerprint!==view.inputFingerprint||slot.optionRevision!==view.optionRevision
   ||view.productVersion!==target.productVersion||slot.profileId!==null&&slot.profileId!==view.categoryContext.profileId||mainImageValue(view,slot.optionId)!==target.sourceKey
   ||!view.imageKeys.includes(target.sourceKey))return fail();
 return binding;
}
function validateJob(target:MainImageAiTarget,job:ImageEditJob){
 const result=job.result;
 if(job.productId!==target.productId||job.productVersion!==target.productVersion||job.contentRevision!==target.quotationView.contentRevision||job.status!=='completed'||job.error!==null
   ||job.review.sourceKey!==target.sourceKey||job.review.purpose!=='cleanup'||!result?.attached||result.purpose!=='cleanup'||result.provenance!=='generated'||result.reviewRequired!==true||result.assignedRole!==false
   ||!isOwnedImageKey(target.ownerId,result.storageKey)||result.storageKey===target.sourceKey||target.quotationView.imageKeys.includes(result.storageKey)
   ||!/^[a-f0-9]{64}$/.test(job.review.fingerprint)||!/^[a-f0-9]{64}$/.test(result.sha256)||result.mime!=='image/png')return fail();
 return result;
}
function comparable(view:QuotationFieldsView,optionId?:string,fields:readonly string[]=[]){
 const value=JSON.parse(JSON.stringify(view)) as Record<string,unknown>;
 for(const key of ['productVersion','inputFingerprint','imageKeys'])delete value[key];
 if(optionId){
  delete value.revision;delete value.updatedAt;
  const overrides=value.overrides as QuotationFieldsView['overrides'];for(const field of fields)delete overrides.options[optionId]?.[field];
  if(overrides.options[optionId]&&!Object.keys(overrides.options[optionId]).length)delete overrides.options[optionId];
  const resolved=value.resolved as QuotationFieldsView['resolved'];for(const field of fields)delete resolved.rows.find(row=>row.optionId===optionId)?.fields[field];
 }
 return value;
}
/** Anchor the original generation source/version, require its single owned
 * result append and reread unchanged quotation facts before a current CAS. */
export async function prepareMainImageAiApply(target:MainImageAiTarget,selected:ImageEditJob,currentVersion:string,currentKeys:readonly string[],request:typeof fetch=fetch):Promise<MainImageAiApplyAttempt>{
 const binding=validateTarget(target),result=validateJob(target,selected),base=target.quotationView;
 const response=await request(`/api/products/${encodeURIComponent(target.productId)}/image-generation`,{cache:'no-store'});
 const history=await response.json() as ImageEditView&{error?:string};
 if(!response.ok)throw Error(history.error||'저장된 AI 결과를 확인하지 못했습니다.');
 const matches=history.jobs?.filter(job=>job.id===selected.id);
 if(matches?.length!==1||!same(matches[0],selected)||history.product?.id!==target.productId||history.product.version!==currentVersion
   ||!same(history.product.imageKeys,currentKeys)||!same(currentKeys,[...base.imageKeys,result.storageKey])||Date.parse(currentVersion)<=Date.parse(target.productVersion))return fail();
 validateJob(target,matches[0]);
 const endpoint=`/api/products/${encodeURIComponent(target.productId)}/quotation-fields${target.quotationTarget.profileId?`?profileId=${encodeURIComponent(target.quotationTarget.profileId)}`:''}`;
 const before=await readMainImageView(endpoint,request);
 if(before.productVersion!==currentVersion||!same(before.imageKeys,currentKeys)||!same(verifyMainImageView(before),binding))return fail();
 let alreadyApplied:QuotationFieldsView|undefined;
 if(!same(comparable(base),comparable(before))){
  // Another explicit save may already have chosen this identical result. It
  // is confirmed as a read-only success, never used to reconstruct stale data.
  const rebased={...base,imageKeys:before.imageKeys};
  verifyMainImageSave(rebased,before,target.quotationTarget.optionId,result.storageKey);
  if(!same(comparable(base,target.quotationTarget.optionId,binding.linked),comparable(before,target.quotationTarget.optionId,binding.linked)))return fail();
  alreadyApplied=before;
 }else if(mainImageValue(before,target.quotationTarget.optionId)!==target.sourceKey)return fail();
 const file=await request(`/api/files/${result.storageKey.split('/').map(encodeURIComponent).join('/')}`,{cache:'no-store'});
 if(!file.ok||file.redirected||file.headers.get('content-type')?.split(';')[0].trim()!=='image/png')throw Error('저장된 AI 결과 이미지 파일을 확인하지 못했습니다.');
 const blob=await file.blob();if(!blob.size||blob.size>MAX_IMAGE_BYTES)throw Error('AI 결과 이미지 용량을 확인해주세요.');
 const metadata=await imageMetadata(new Uint8Array(await blob.arrayBuffer()),'image/png');
 if(!same(metadata,{mime:result.mime,width:result.width,height:result.height,bytes:result.bytes,sha256:result.sha256}))throw Error('AI 결과 이미지 파일이 검토한 저장 결과와 다릅니다.');
 return {target,job:selected,before,...(alreadyApplied?{alreadyApplied}:{})};
}
/** Existing exact-option save, ACK/readback and read-first recovery are reused.
 * No source options, common roles, other quotations or image files are written. */
export async function applyMainImageAiResult(attempt:MainImageAiApplyAttempt,request:typeof fetch=fetch){
 validateTarget(attempt.target);const result=validateJob(attempt.target,attempt.job),{target}=attempt;
 const endpoint=`/api/products/${encodeURIComponent(target.productId)}/quotation-fields${target.quotationTarget.profileId?`?profileId=${encodeURIComponent(target.quotationTarget.profileId)}`:''}`;
 if(attempt.alreadyApplied){const current=await readMainImageView(endpoint,request);if(!same(current,attempt.alreadyApplied))return fail();return current;}
 return saveMainImageView(endpoint,attempt.before,target.quotationTarget.optionId,result.storageKey,request);
}
export async function recoverMainImageAiResult(attempt:MainImageAiApplyAttempt,request:typeof fetch=fetch){
 validateTarget(attempt.target);const result=validateJob(attempt.target,attempt.job),{target}=attempt;
 const endpoint=`/api/products/${encodeURIComponent(target.productId)}/quotation-fields${target.quotationTarget.profileId?`?profileId=${encodeURIComponent(target.quotationTarget.profileId)}`:''}`;
 const current=await readMainImageView(endpoint,request);
 if(attempt.alreadyApplied){if(!same(current,attempt.alreadyApplied))return fail();return current;}
 verifyMainImageSave(attempt.before,current,target.quotationTarget.optionId,result.storageKey);
 verifyOptionImageRecovery(attempt.before,current,target.quotationTarget.optionId,mainImageChanges(attempt.before,target.quotationTarget.optionId,result.storageKey));return current;
}
