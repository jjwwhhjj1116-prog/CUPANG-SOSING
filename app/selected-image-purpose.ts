import {initializedVisionRegionBox,type FreeImageLoaded,type FreeImageRegion} from '@/app/free-image-translation-client';
import {validateFreeImageEditDocument} from '@/app/free-image-edit-document';
import {initializeVisionRegions} from '@/app/free-image-vision-style';
import {IMAGE_TEXT_PRESERVATION_POLICY,parseImageTextVisionResult} from '@/app/image-text-vision';
import {freeImageInpaintRoi,MAX_FREE_IMAGE_INPAINT_TOTAL_PIXELS} from '@/app/free-image-inpaint';

export const selectedImagePurpose=(stage:'main'|'additional'|'detail')=>stage==='detail'?'translation':'cleanup';
export const hasForeignImageText=(text:string)=>/\p{Script=Han}/u.test(text)||/[a-z]{2}/iu.test(text);
// This exact diagnostic is emitted by the shared initial style builder. Only
// its complete marker is translation-specific; any other issue still blocks.
const textFitIssue='VISION_TEXT_FIT: 한국어를 읽을 수 있는 크기로 넣기 어렵습니다. 문구와 영역을 직접 조정한 뒤 선택해주세요.';
const translationIssue='번역 검증을 통과하지 못했습니다. 원문과 영역을 확인해주세요.';
const withoutTextFit=(issue:string|null)=>issue===textFitIssue?null:issue?.endsWith(' '+textFitIssue)?issue.slice(0,-textFitIssue.length-1):issue;
const review=(issues:readonly string[])=>Error(`문구 제거 전 영역·배경 검토가 필요합니다: ${issues.join(', ')}. 원본을 유지했습니다. 이미지 편집에서 문구와 영역을 확인해주세요.`);

function flatCleanupBackgrounds(image:FreeImageLoaded,rows:readonly FreeImageRegion[]):boolean{
 const uncertain=()=>review(['문구 영역 주변의 획·기호 또는 배경 경계를 확인해주세요']);
 const context=image.canvas.getContext('2d');
 if(!context)throw uncertain();
 const selected=rows.filter(region=>region.selected);
 let pixelsRead=0,allFlat=true;
 for(const row of selected){
  const roi=freeImageInpaintRoi(row.box,image.width,image.height);
  if((pixelsRead+=roi.width*roi.height)>MAX_FREE_IMAGE_INPAINT_TOTAL_PIXELS)throw uncertain();
  const data=context.getImageData(roi.x,roi.y,roi.width,roi.height).data;
  if(data.length!==roi.width*roi.height*4)throw uncertain();
  const adjacent=selected.filter(other=>other!==row&&other.box.x<roi.x+roi.width&&other.box.x+other.box.width>roi.x&&other.box.y<roi.y+roi.height&&other.box.y+other.box.height>roi.y);
  const [red,green,blue]=[1,3,5].map(start=>parseInt(row.background.slice(start,start+2),16));
  let samples=0;
  for(let y=roi.y;y<roi.y+roi.height;y++){
   // Interior pixels will be painted. Only pixels in the restoration context can leak ink back into the mask.
   const insideRow=y>=row.box.y&&y<row.box.y+row.box.height;
   for(let x=roi.x;x<roi.x+roi.width;x++){
    const index=((y-roi.y)*roi.width+x-roi.x)*4;
    if(insideRow&&x===row.box.x){
     for(let offset=0;allFlat&&offset<row.box.width;offset++)if(data[index+offset*4+3]!==255)allFlat=false;
     x+=row.box.width-1;
     continue;
    }
    if(adjacent.some(({box})=>x>=box.x&&x<box.x+box.width&&y>=box.y&&y<box.y+box.height))continue;
    const distance=Math.max(Math.abs(data[index]-red),Math.abs(data[index+1]-green),Math.abs(data[index+2]-blue));
    if(data[index+3]<250||distance>32)throw uncertain();
    if(distance>6||data[index+3]!==255)allFlat=false;
    samples++;
   }
  }
  if(samples<12)throw uncertain();
 }
 return allFlat;
}

/** Restore only validated, selected OCR rectangles. The existing background,
 * overlap and uncertainty gates still apply: OCR is not product segmentation.
 * Keep every original row available in the editable document. */
export function prepareSelectedImageCleanup(image:FreeImageLoaded,recognized:readonly FreeImageRegion[]):FreeImageRegion[]{
 let regions=validateFreeImageEditDocument({format:'free-image-edit-v1',width:image.width,height:image.height,sourceLanguage:'zh',regions:[...recognized]},image.source).regions;
 const vision=['main','additional'].includes(image.source.role)?parseImageTextVisionResult(image.visionResult,image.width,image.height):null;
 const classified=vision?.inspection?.policy===IMAGE_TEXT_PRESERVATION_POLICY;
 const verifyAdditional=classified&&image.source.role==='additional';
 const exactBlocks=!!vision&&vision.blocks.length===regions.length&&regions.every((region,index)=>{
  const block=vision.blocks[index],box=verifyAdditional?initializedVisionRegionBox(image,index):block.box;
  return block.id===region.id&&block.text===region.text&&(['x','y','width','height'] as const).every(key=>box[key]===region.box[key]);
 });
 const twoPass=image.visionPaintOrder==='backgrounds-first-v1';
 if(twoPass&&(!classified||!exactBlocks||vision.blocks.some(row=>row.kind!=='overlay'||row.issue!==null)))throw review(['실물 인쇄·별도 문구 분류를 확인해주세요']);
 if(classified&&(!exactBlocks||vision.inspection?.decision==='unreadable'||vision.blocks.some(row=>row.kind==='uncertain')))throw review(['실물 인쇄·별도 문구 분류를 확인해주세요']);
 const preserved=new Set(classified?vision.blocks.filter(row=>row.kind==='product-marking').map(row=>row.id):[]);
 if(vision?.inspection?.decision==='foreign-text'&&exactBlocks){
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
 const prepared=regions.map((region,index):FreeImageRegion=>{
  const selected=hasForeignImageText(region.text)&&!preserved.has(region.id)&&(region.selected||fitOnly(region));
  return selected?{...region,selected:true,erase:true,translated:'',translationProvenance:'empty',issue:withoutTextFit(region.issue),background:sampled.regions[index].background,backgroundMode:'inpaint-telea-v1'}:{...region,selected:false};
 });
 if(!verifyAdditional)return prepared;
 if(flatCleanupBackgrounds(image,prepared))return prepared.map(region=>({...region,backgroundMode:undefined}));
 if(prepared.filter(region=>region.selected).length>1)image.visionPaintOrder='backgrounds-first-v1';
 return prepared;
}
