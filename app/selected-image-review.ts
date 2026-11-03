import {validateFreeImageSource,type FreeImageSource} from '@/app/free-image-translation';
import {IMAGE_TEXT_INSPECTION_POLICY,isImageTextInspectionPolicy,type ImageTextInspectionPolicy,parseImageTextVisionConfiguration,parseImageTextVisionResult,type ImageTextVisionConfiguration,type ImageTextVisionResult} from '@/app/image-text-vision';
import {parseWorkspaceSettingsScope,type WorkspaceSettingsScope} from '@/app/workspace-settings-scope';
import {exactPrimaryQuotationTarget} from '@/app/quotation-seo-targets';
import {quotationImageKeys} from '@/app/quotation-image-targets';
import {isOwnedImageKey} from '@/app/image-files';
import type {QuotationFieldsView} from '@/app/quotation-schema';
import type {FreeImageLoaded,FreeImageQuotationRequest} from '@/app/free-image-translation-client';

/** In-memory completed recognition, never an image save or automatic-apply authority. */
export type SelectedImageReview={format:'selected-image-review-v1';ownerId:string;company:NonNullable<WorkspaceSettingsScope['company']>;source:FreeImageSource;
 requestId:string;sourceLanguage:'zh'|'en';configuration:ImageTextVisionConfiguration;inspectionPolicy:ImageTextInspectionPolicy;result:ImageTextVisionResult;
 category:string;schema:string;options:string;sources:string;styleIssues:string[];message:string};
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const changed=()=>Error('계정·카테고리·옵션 또는 검토 이미지가 변경됐습니다. 최신 원본에서 다시 확인해주세요.');
function selection(view:QuotationFieldsView,source:FreeImageSource){
 const target=source.quotationTarget;if(!target||!['main','additional'].includes(source.role))throw changed();
 if(!view.categoryContext||target.profileId!==null&&view.categoryContext.profileId!==target.profileId||!Array.isArray(view.resolved?.rows)||view.resolved.rows.length>201||view.resolved.rows.filter(row=>row.optionId!==null).length>200
  ||!Number.isFinite(Date.parse(view.productVersion))||![view.revision,view.optionRevision].every(value=>Number.isSafeInteger(value)&&value>=0)||!/^[a-f0-9]{64}$/.test(view.inputFingerprint))throw changed();
 const fields=exactPrimaryQuotationTarget(view.resolved.schema.fields,target.input as 'mainImage'|'additionalImages'),rows=view.resolved.rows.filter(row=>row.optionId===target.optionId),row=rows[0];
 if(rows.length!==1||!row.included||fields.primary!==target.fieldKey||fields.fields.some(field=>field.readOnly)||fields.linked.some(key=>row.fields[key]?.value!==target.value)
  ||quotationImageKeys(target.value)[target.slotIndex]!==source.sourceKey||!view.imageKeys.includes(source.sourceKey))throw changed();
 return{category:canonical(view.categoryContext),schema:canonical(fields.fields),options:canonical(view.resolved.rows.map(row=>[row.optionId,row.included])),sources:canonical(fields.linked.map(key=>[key,row.fields[key]?.source]))};
}
export function parseSelectedImageReview(value:unknown):SelectedImageReview|null{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).length>131072)return null;
  const row=value as SelectedImageReview;
  if(Object.keys(row).sort().join(',')!=='category,company,configuration,format,inspectionPolicy,message,options,ownerId,requestId,result,schema,source,sourceLanguage,sources,styleIssues'
   ||row.format!=='selected-image-review-v1'||!['zh','en'].includes(row.sourceLanguage)||!isImageTextInspectionPolicy(row.inspectionPolicy)
   ||!/^\w[\w-]{0,199}$/.test(row.ownerId)||!isOwnedImageKey(row.ownerId,row.source?.sourceKey)
   ||!/^([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(row.requestId))return null;
  const scope=parseWorkspaceSettingsScope({ownerId:row.ownerId,company:row.company}),source=validateFreeImageSource(row.source),configuration=parseImageTextVisionConfiguration(row.configuration),result=parseImageTextVisionResult(row.result,source.width,source.height);
  if(!scope?.company||canonical(scope.company)!==canonical(row.company)||!configuration?.configured||!result?.blocks.length||result.inspection?.policy!==row.inspectionPolicy
   ||!['main','additional'].includes(source.role)||!source.quotationTarget||source.editorSource||source.workspaceTarget||source.optionImages
   ||source.quotationTarget.input!==(source.role==='main'?'mainImage':'additionalImages')
   ||![row.category,row.schema,row.options,row.sources].every(text=>typeof text==='string'&&text.length>0&&text.length<=32768)
   ||typeof row.message!=='string'||row.message.length>2000||!Array.isArray(row.styleIssues)||row.styleIssues.length>5
   ||new Set(row.styleIssues).size!==row.styleIssues.length||row.styleIssues.some(issue=>!['VISION_REGION_OVERLAP','VISION_BACKGROUND_COMPLEX','VISION_BACKGROUND_UNAVAILABLE','VISION_TEXT_FIT','VISION_TEXT_CLASSIFICATION'].includes(issue)))return null;
  return JSON.parse(JSON.stringify({...row,source,configuration,result}));
 }catch{return null;}
}
export function createSelectedImageReview(scope:WorkspaceSettingsScope,view:QuotationFieldsView,image:FreeImageLoaded,sourceLanguage:'zh'|'en',message:string):SelectedImageReview|null{
 try{return parseSelectedImageReview({format:'selected-image-review-v1',ownerId:scope.ownerId,company:scope.company,source:image.source,requestId:image.visionRequestId,
  sourceLanguage,configuration:image.visionConfiguration,inspectionPolicy:image.visionResult?.inspection?.policy??IMAGE_TEXT_INSPECTION_POLICY,result:image.visionResult,...selection(view,image.source),styleIssues:image.visionStyleIssues??[],message:message.slice(0,2000)});}catch{return null;}
}
/** Only clocks may advance. The existing source GET must issue the fresh binding. */
export function rebindSelectedImageReview(value:unknown,scope:WorkspaceSettingsScope,view:QuotationFieldsView):FreeImageQuotationRequest{
 const review=parseSelectedImageReview(value);if(!review||scope.ownerId!==review.ownerId||canonical(scope.company)!==canonical(review.company))throw changed();
 const target=review.source.quotationTarget!,current=selection(view,review.source);
 if(view.optionRevision!==target.optionRevision||Object.entries(current).some(([key,value])=>value!==review[key as keyof typeof current]))throw changed();
 return{kind:'quotation',profileId:target.profileId,optionId:target.optionId,input:target.input,fieldKey:target.fieldKey,slotIndex:target.slotIndex,value:target.value,
  revision:view.revision,inputFingerprint:view.inputFingerprint,optionRevision:view.optionRevision};
}
export function matchSelectedImageReview(value:unknown,image:FreeImageLoaded,target:FreeImageQuotationRequest):SelectedImageReview{
 const review=parseSelectedImageReview(value),source=validateFreeImageSource(image.source);
 if(!review||source.productId!==review.source.productId||source.sourceKey!==review.source.sourceKey||source.role!==review.source.role||source.sourceSha256!==review.source.sourceSha256
  ||source.width!==review.source.width||source.height!==review.source.height||image.width!==source.width||image.height!==source.height||source.editorSource||source.workspaceTarget||source.optionImages
  ||canonical(image.visionConfiguration)!==canonical(review.configuration)||!source.quotationTarget
  ||canonical(Object.fromEntries(Object.entries(source.quotationTarget).filter(([key])=>key!=='bindingSha256')))!==canonical(target))throw changed();
 return review;
}
