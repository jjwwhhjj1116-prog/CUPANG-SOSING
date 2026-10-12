import { getImageJob } from '@/db/image-jobs';
import { imageByteLimit, imageMetadata, type ImageMetadata } from '@/app/automation/image-edit';
import { readBoundedStream } from '@/app/request-body';
import { reviewedImageRoleReplacements } from '@/app/image-role-adoption';
import type { ContentPatch, ProductContent } from '@/app/product-content';

/** No provider call or file write: validate the stored, user-reviewed lineage. */
export async function verifiedGeneratedImageReplacements(owner:string,current:ProductContent,imageKeys:readonly string[],ids:readonly string[],patch:ContentPatch,files:Pick<R2Bucket,'get'>) {
 const jobs=[];
 const failure=()=>new Error('완료 이미지의 원본·결과 연결을 확인하지 못했습니다. 실행 이력을 다시 불러와주세요.');
 async function metadata(key:string,expected:ImageMetadata,jobId?:string) {
  if(!key.startsWith(`${owner}/`)||!imageKeys.includes(key))throw failure();
  const object=await files.get(key);
  if(!object||!Number.isSafeInteger(object.size)||object.size<1||object.size>imageByteLimit||object.size!==expected.bytes)throw failure();
  if(jobId&&(object.httpMetadata?.contentType!=='image/png'||object.customMetadata?.imageJobId!==jobId||object.customMetadata?.provenance!=='generated'||object.customMetadata?.sha256!==expected.sha256))throw failure();
  const actual=await imageMetadata(await readBoundedStream(object.body,imageByteLimit));
  if((['mime','width','height','bytes','sha256'] as const).some(key=>actual[key]!==expected[key]))throw failure();
 }
 for(const id of ids) {
  const job=await getImageJob(owner,current.productId,id),result=job?.result;
  if(!job||job.id!==id||job.productId!==current.productId||job.status!=='completed'||job.contentRevision!==current.revision||!result?.attached||result.storageKey!==`${owner}/ai-${id}.png`||result.mime!=='image/png'||result.provenance!=='generated'||result.assignedRole!==false||result.reviewRequired!==true)throw failure();
  await metadata(job.review.sourceKey,job.review.source);
  await metadata(result.storageKey,result,id);
  jobs.push(job);
 }
 return reviewedImageRoleReplacements(current,jobs,imageKeys,patch);
}
