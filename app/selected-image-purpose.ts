import type {FreeImageLoaded,FreeImageRegion} from '@/app/free-image-translation-client';
import {validateFreeImageEditDocument} from '@/app/free-image-edit-document';
import {initializeVisionRegions} from '@/app/free-image-vision-style';

export const selectedImagePurpose=(stage:'main'|'additional'|'detail')=>stage==='detail'?'translation':'cleanup';
export const hasForeignImageText=(text:string)=>/\p{Script=Han}/u.test(text)||/[a-z]{2}/iu.test(text);
// This exact diagnostic is emitted by the shared initial style builder. Only
// its complete marker is translation-specific; any other issue still blocks.
const textFitIssue='VISION_TEXT_FIT: 한국어를 읽을 수 있는 크기로 넣기 어렵습니다. 문구와 영역을 직접 조정한 뒤 선택해주세요.';
const withoutTextFit=(issue:string|null)=>issue===textFitIssue?null:issue?.endsWith(' '+textFitIssue)?issue.slice(0,-textFitIssue.length-1):issue;
const review=(issues:readonly string[])=>Error(`문구 제거 전 영역·배경 검토가 필요합니다: ${issues.join(', ')}. 원본을 유지했습니다. 이미지 편집에서 문구와 영역을 확인해주세요.`);

/** Erase only validated, selected OCR rectangles using the existing sampled
 * flat fill. This does not reconstruct texture or infer which text is printed
 * on a product. Keep every original row available in the editable document. */
export function prepareSelectedImageCleanup(image:FreeImageLoaded,recognized:readonly FreeImageRegion[]):FreeImageRegion[]{
 const regions=validateFreeImageEditDocument({format:'free-image-edit-v1',width:image.width,height:image.height,sourceLanguage:'zh',regions:[...recognized]},image.source).regions;
 const blockers=image.visionStyleIssues?.filter(issue=>issue!=='VISION_TEXT_FIT')??[];
 if(blockers.length)throw review(blockers);
 // Local OCR defaults to white; that default is not evidence of a safe fill.
 // Reuse the same surrounding-pixel and overlap checks as Vision, for both.
 const sampled=initializeVisionRegions(regions.map(({id,text,box})=>({id,text,box,translated:null,issue:null})),image.canvas,image.width,image.height);
 const unsafe=sampled.issues.filter(issue=>issue!=='VISION_TEXT_FIT');
 if(unsafe.length)throw review(unsafe);
 const issues=regions.filter(region=>hasForeignImageText(region.text)).map(region=>withoutTextFit(region.issue)).filter((issue):issue is string=>!!issue?.trim());
 if(issues.length)throw review([...new Set(issues)]);
 const fitOnly=(region:FreeImageRegion)=>region.issue===textFitIssue&&image.visionStyleIssues?.includes('VISION_TEXT_FIT')===true;
 if(regions.some(region=>hasForeignImageText(region.text)&&!region.selected&&!fitOnly(region)))throw review(['인식 신뢰도를 확인할 미선택 외국어 문구가 남아 있습니다']);
 return regions.map((region,index)=>{
  const selected=hasForeignImageText(region.text)&&(region.selected||fitOnly(region));
  return selected?{...region,selected:true,erase:true,translated:'',translationProvenance:'empty',issue:withoutTextFit(region.issue),background:sampled.regions[index].background}:{...region,selected:false};
 });
}
