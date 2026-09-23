import type { ProductContent, ContentPatch } from '@/app/product-content';
import type { ImageEditJob } from '@/app/automation/image-edit';
/** User-reviewed replacement only, using the content revision captured before generation. */
export function generatedImageRolePatch(content:ProductContent,job:ImageEditJob,imageKeys:readonly string[]):ContentPatch {
 if(job.productId!==content.productId||job.status!=='completed'||!job.result?.attached)throw new Error('현재 상품에 첨부된 완료 이미지가 필요합니다.');
 if(content.revision!==job.contentRevision)throw new Error('가공 요청 이후 이미지 역할이나 콘텐츠가 수정되었습니다. 이미지 편집에서 결과를 직접 선택해주세요.');
 const source=job.review.sourceKey;const result=job.result.storageKey;
 if(source===result||!imageKeys.includes(source)||!imageKeys.includes(result))throw new Error('원본과 결과 이미지의 상품 연결을 확인해주세요.');
 if(Object.values(content.assets).some(field=>field.value.includes(result)))throw new Error('결과 이미지가 이미 지정되어 있습니다. 이미지 편집에서 순서를 확인해주세요.');
 const assets:NonNullable<ContentPatch['assets']>={};
 for(const role of ['main','additional','detail'] as const){
  const before=content.assets[role].value;
  if(!before.includes(source))continue;
  if(before.includes(result))throw new Error('결과 이미지가 이미 지정되어 있습니다. 이미지 편집에서 순서를 확인해주세요.');
  assets[role]=before.map(key=>key===source?result:key);
 }
 if(!Object.keys(assets).length)throw new Error('원본이 대표·추가·상세 역할에 없습니다. 이미지 편집에서 결과를 직접 선택해주세요.');
 return {assets};
}

/** Combine reviewed results against one snapshot, then save with one revision check. */
export function generatedImagesRolePatch(content:ProductContent,jobs:readonly ImageEditJob[],imageKeys:readonly string[]):ContentPatch {
 if(!jobs.length||jobs.length>50)throw new Error('검토한 결과를 1~50개 선택해주세요.');
 const replacements=new Map<string,string>();const outputs=new Set<string>();
 for(const job of jobs){
  generatedImageRolePatch(content,job,imageKeys);
  const source=job.review.sourceKey;const output=job.result!.storageKey;
  if(replacements.has(source)||outputs.has(output))throw new Error('같은 원본 또는 결과가 중복 선택되었습니다. 원본당 결과 하나를 선택해주세요.');
  replacements.set(source,output);outputs.add(output);
 }
 if([...outputs].some(key=>replacements.has(key)))throw new Error('다른 선택 작업의 원본을 결과로 사용하는 연결은 한 번에 적용할 수 없습니다.');
 const assets:NonNullable<ContentPatch['assets']>={};
 for(const role of ['main','additional','detail'] as const){
  const current=content.assets[role].value;
  if(current.some(key=>replacements.has(key)))assets[role]=current.map(key=>replacements.get(key)??key);
 }
 return {assets};
}
