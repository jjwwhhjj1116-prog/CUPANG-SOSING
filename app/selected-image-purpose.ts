import type {FreeImageLoaded,FreeImageRegion} from '@/app/free-image-translation-client';
import {validateFreeImageEditDocument} from '@/app/free-image-edit-document';
import {initializeVisionRegions} from '@/app/free-image-vision-style';
import {IMAGE_TEXT_PRESERVATION_POLICY,parseImageTextVisionResult} from '@/app/image-text-vision';

export const selectedImagePurpose=(stage:'main'|'additional'|'detail')=>stage==='detail'?'translation':'cleanup';
export const hasForeignImageText=(text:string)=>/\p{Script=Han}/u.test(text)||/[a-z]{2}/iu.test(text);
// This exact diagnostic is emitted by the shared initial style builder. Only
// its complete marker is translation-specific; any other issue still blocks.
const textFitIssue='VISION_TEXT_FIT: 한국어를 읽을 수 있는 크기로 넣기 어렵습니다. 문구와 영역을 직접 조정한 뒤 선택해주세요.';
const translationIssue='번역 검증을 통과하지 못했습니다. 원문과 영역을 확인해주세요.';
const withoutTextFit=(issue:string|null)=>issue===textFitIssue?null:issue?.endsWith(' '+textFitIssue)?issue.slice(0,-textFitIssue.length-1):issue;
const review=(issues:readonly string[])=>Error(`문구 제거 전 영역·배경 검토가 필요합니다: ${issues.join(', ')}. 원본을 유지했습니다. 이미지 편집에서 문구와 영역을 확인해주세요.`);

/** Restore only validated, selected OCR rectangles. The existing background,
 * overlap and uncertainty gates still apply: OCR is not product segmentation.
 * Keep every original row available in the editable document. */
export function prepareSelectedImageCleanup(image:FreeImageLoaded,recognized:readonly FreeImageRegion[]):FreeImageRegion[]{
 let regions=validateFreeImageEditDocument({format:'free-image-edit-v1',width:image.width,height:image.height,sourceLanguage:'zh',regions:[...recognized]},image.source).regions;
 const vision=['main','additional'].includes(image.source.role)?parseImageTextVisionResult(image.visionResult,image.width,image.height):null;
 const classified=vision?.inspection?.policy===IMAGE_TEXT_PRESERVATION_POLICY;
 const exactBlocks=!!vision&&vision.blocks.length===regions.length&&regions.every((region,index)=>{const block=vision.blocks[index];return block.id===region.id&&block.text===region.text&&(['x','y','width','height'] as const).every(key=>block.box[key]===region.box[key]);});
 const twoPass=image.visionPaintOrder==='backgrounds-first-v1';
 if(twoPass&&(!classified||!exactBlocks||vision.blocks.some(row=>row.kind!=='overlay'||row.issue!==null)))throw review(['실물 인쇄·별도 문구 분류를 확인해주세요']);
 if(classified&&(!exactBlocks||vision.inspection?.decision==='unreadable'||vision.blocks.some(row=>row.kind==='uncertain')))throw review(['실물 인쇄·별도 문구 분류를 확인해주세요']);
 const preserved=new Set(classified?vision.blocks.filter(row=>row.kind==='product-marking').map(row=>row.id):[]);
 if(vision?.inspection?.decision==='foreign-text'&&vision.blocks.length===regions.length&&regions.every((region,index)=>{
  const block=vision.blocks[index];return block.id===region.id&&block.text===region.text&&(['x','y','width','height'] as const).every(key=>block.box[key]===region.box[key]);
 })){
  // Erasing a validated OCR block needs no Korean replacement (for example an unchanged model code).
  regions=regions.map((region,index)=>{
   if(vision.blocks[index].translated!==null||vision.blocks[index].issue!==translationIssue)return region;
   if(region.issue===translationIssue)return{...region,issue:null};
   return region.issue===translationIssue+' '+textFitIssue?{...region,issue:textFitIssue}:region;
  });
 }
 const blockers=image.visionStyleIssues?.filter(issue=>issue!=='VISION_TEXT_FIT')??[];
 if(blockers.length)throw review(blockers);
 // Local OCR defaults to white; that default is not evidence of a safe fill.
 // Reuse the same surrounding-pixel and overlap checks as Vision, for both.
 const sampled=initializeVisionRegions(regions.map(({id,text,box},index)=>({id,text,box,translated:null,issue:null,...(twoPass?{kind:vision!.blocks[index].kind}:preserved.has(id)?{kind:'product-marking' as const}:{})})),image.canvas,image.width,image.height,{allowSafeOverlayOverlap:twoPass});
 if(twoPass&&sampled.paintOrder!==image.visionPaintOrder)throw review(['배경·문구 처리 순서를 다시 확인해주세요']);
 const unsafe=sampled.issues.filter(issue=>issue!=='VISION_TEXT_FIT');
 if(unsafe.length)throw review(unsafe);
 const issues=regions.filter(region=>hasForeignImageText(region.text)&&!preserved.has(region.id)).map(region=>withoutTextFit(region.issue)).filter((issue):issue is string=>!!issue?.trim());
 if(issues.length)throw review([...new Set(issues)]);
 const fitOnly=(region:FreeImageRegion)=>region.issue===textFitIssue&&image.visionStyleIssues?.includes('VISION_TEXT_FIT')===true;
 if(regions.some(region=>hasForeignImageText(region.text)&&!preserved.has(region.id)&&!region.selected&&!fitOnly(region)))throw review(['인식 신뢰도를 확인할 미선택 외국어 문구가 남아 있습니다']);
 return regions.map((region,index)=>{
  const selected=hasForeignImageText(region.text)&&!preserved.has(region.id)&&(region.selected||fitOnly(region));
  return selected?{...region,selected:true,erase:true,translated:'',translationProvenance:'empty',issue:withoutTextFit(region.issue),background:sampled.regions[index].background,backgroundMode:'inpaint-telea-v1'}:{...region,selected:false};
 });
}
