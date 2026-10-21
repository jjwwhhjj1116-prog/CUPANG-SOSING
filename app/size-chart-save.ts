import {applyContentPatch,type ProductContent} from '@/app/product-content';
import {validateManualSizeChart,type ManualSizeChart} from '@/app/manual-size-chart';
import {documentImagePlan,type DocumentImagePlan} from '@/app/document-image';
import type {ProductOptions} from '@/app/product-options';

export type SizeChartSaveInput={expectedProductVersion:string;expectedContentRevision:number;expectedOptionRevision:number;expectedQuotationRevision:number;expectedQuotationStateSha256:string;expectedInputFingerprint:string;chart:ManualSizeChart|null;uploadId:string;pngSha256:string};
export type SizeChartUpload={uploadId:string;key:string;size:number;sha256:string;contentType:'image/png';sourceFingerprint:string;chartSha256:string;planSha256:string};
export type SizeChartSaveSnapshot={productId:string;ownerId:string;productVersion:string;imageKeys:string[];content:ProductContent;options:ProductOptions;quotationRevision:number;quotationStateSha256:string;inputFingerprint:string;profileId:string|null;categoryId:string|null;upload:SizeChartUpload|null};
export const sizeChartCanonical=(value:unknown):string=>value===null||typeof value!=='object'?(JSON.stringify(value)??'undefined'):Array.isArray(value)?'['+value.map(sizeChartCanonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+sizeChartCanonical((value as Record<string,unknown>)[key])).join(',')+'}';
export const sameSizeChartValue=(a:unknown,b:unknown)=>sizeChartCanonical(a)===sizeChartCanonical(b);
export async function sizeChartDigest(value:unknown){const bytes=new TextEncoder().encode(sizeChartCanonical(value));return sizeChartBytesDigest(bytes);}
export async function sizeChartBytesDigest(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))].map(value=>value.toString(16).padStart(2,'0')).join('');}
export const sizeChartSaveKey=(owner:string,uploadId:string)=>`${owner}/size-chart-${uploadId}.png`;
export function validateSizeChartSaveInput(value:unknown):SizeChartSaveInput{
 const keys=['expectedProductVersion','expectedContentRevision','expectedOptionRevision','expectedQuotationRevision','expectedQuotationStateSha256','expectedInputFingerprint','chart','uploadId','pngSha256'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))throw Error('사이즈표 저장 내용을 확인해주세요.');
 const input=value as SizeChartSaveInput;
 if(typeof input.expectedProductVersion!=='string'||!Number.isFinite(Date.parse(input.expectedProductVersion))||[input.expectedContentRevision,input.expectedOptionRevision,input.expectedQuotationRevision].some(value=>!Number.isSafeInteger(value)||value<0)
  ||[input.expectedInputFingerprint,input.expectedQuotationStateSha256,input.uploadId,input.pngSha256].some(value=>typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value)))throw Error('사이즈표 저장 버전과 이미지 번호를 확인해주세요.');
 return {...input,chart:input.chart===null?null:validateManualSizeChart(input.chart)};
}
/** An explicit save writes the reviewed chart and its PNG together. The
 * generic content PATCH intentionally still requires separate operations. */
export function sizeChartSavedContent(before:ProductContent,chart:ManualSizeChart|null,key:string,now:string):ProductContent{
 const next=applyContentPatch(before,{manualSizeChart:chart},now);
 next.assets.size={value:[key],provenance:'manual',updatedAt:now};return next;
}
export function sizeChartSavePlan(before:ProductContent,options:ProductOptions,chart:ManualSizeChart|null):DocumentImagePlan{
 const candidate=structuredClone(before);if(chart===null)delete candidate.manualSizeChart;else candidate.manualSizeChart=validateManualSizeChart(chart);
 return documentImagePlan('size',candidate,options);
}
export async function verifySizeChartSaveReceipt(before:SizeChartSaveSnapshot,input:SizeChartSaveInput,value:unknown,pngSize:number):Promise<boolean>{
 try{
  const after=value as SizeChartSaveSnapshot,key=sizeChartSaveKey(before.ownerId,input.uploadId),upload=after.upload;
  if(!after||after.productId!==before.productId||after.ownerId!==before.ownerId||after.profileId!==before.profileId||after.categoryId!==before.categoryId
   ||!Number.isFinite(Date.parse(after.productVersion))||Date.parse(after.productVersion)<=Date.parse(before.productVersion)
   ||after.content.revision!==before.content.revision+1||after.content.updatedAt!==after.productVersion||!sameSizeChartValue(after.content,sizeChartSavedContent(before.content,input.chart,key,after.productVersion))
   ||!sameSizeChartValue(after.options,before.options)||after.quotationRevision!==before.quotationRevision||after.quotationStateSha256!==before.quotationStateSha256||after.inputFingerprint===before.inputFingerprint||!/^[a-f0-9]{64}$/.test(after.inputFingerprint)
   ||!sameSizeChartValue(after.imageKeys,[...before.imageKeys,key])||!upload||upload.uploadId!==input.uploadId||upload.key!==key||upload.sha256!==input.pngSha256||upload.size!==pngSize||upload.contentType!=='image/png'||upload.sourceFingerprint!==before.inputFingerprint
   ||upload.chartSha256!==await sizeChartDigest(input.chart)||upload.planSha256!==await sizeChartDigest(sizeChartSavePlan(before.content,before.options,input.chart)))return false;
  return true;
 }catch{return false;}
}
export function unchangedSizeChartSaveSnapshot(before:SizeChartSaveSnapshot,after:SizeChartSaveSnapshot){
 return sameSizeChartValue({...before,upload:null},{...after,upload:null});
}
