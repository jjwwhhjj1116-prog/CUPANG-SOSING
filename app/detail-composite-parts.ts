import {MAX_IMAGE_BYTES} from '@/app/image-files';
import {labelUploadDigest} from '@/app/label-upload-key';
import type {DetailSaveSource} from '@/app/detail-save-plan';

export const DETAIL_COMPOSITE_PARTS_POLICY='photo-boundary-parts-v2' as const;
export const DETAIL_COMPOSITE_PARTS_MAX_BYTES=30*1024*1024;
export type DetailCompositePartDescriptor={start:number;end:number;width:800;height:number;sha256:string;bytes:number;uploadId:string};
export type DetailCompositePart=DetailCompositePartDescriptor&{output:Blob};
export type DetailSavedCompositePart=DetailCompositePartDescriptor&{key:string};
export type DetailCompositePartsIdentity={productId:string;optionId:string;category:unknown;fingerprint:string;sources:DetailSaveSource[];
 workspace?:{revision:number;digest:string};peerDigest?:string;publicationPolicy?:string;publishedBodyImages?:unknown};
const failure=()=>Error('상세 분할 이미지의 순서·원본 범위·파일 증거를 확인해주세요. 원본을 생략하거나 나누어 저장하지 않았습니다.');
export const detailCompositePartMetadata=(part:Omit<DetailCompositePartDescriptor,'uploadId'>)=>({start:part.start,end:part.end,width:part.width,height:part.height,sha256:part.sha256,bytes:part.bytes});
export const detailCompositePartDescriptor=(part:DetailCompositePartDescriptor)=>({...detailCompositePartMetadata(part),uploadId:part.uploadId});
/** A manifest covers every ordered photo exactly once; no image is cut or dropped. */
export function validateDetailCompositeParts(value:unknown,sourceCount?:number,saved=false):DetailCompositePartDescriptor[]{
 if(!Array.isArray(value)||value.length<2||value.length>30)throw failure();
 let end=0,total=0;const uploads=new Set<string>();
 const result=value.map(raw=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!==(saved?'bytes,end,height,key,sha256,start,uploadId,width':'bytes,end,height,sha256,start,uploadId,width'))throw failure();
  const part=raw as DetailCompositePartDescriptor;
  if(![part.start,part.end,part.height,part.bytes].every(Number.isSafeInteger)||part.start!==end||part.end<=part.start||part.end>150||part.width!==800||part.height<1||part.height>16000
   ||part.bytes<1||part.bytes>MAX_IMAGE_BYTES||!/^[a-f0-9]{64}$/u.test(part.sha256)||!/^[a-f0-9]{64}$/u.test(part.uploadId)||uploads.has(part.uploadId))throw failure();
  if(saved&&typeof (raw as DetailSavedCompositePart).key!=='string')throw failure();
  end=part.end;total+=part.bytes;uploads.add(part.uploadId);
  return{...detailCompositePartMetadata(part),uploadId:part.uploadId};
 });
 if(sourceCount!==undefined&&end!==sourceCount||total>DETAIL_COMPOSITE_PARTS_MAX_BYTES)throw failure();
 return result;
}
export function validateDetailCompositePartSources(parts:readonly DetailCompositePartDescriptor[],sources:readonly DetailSaveSource[]):void{
 validateDetailCompositeParts(parts,sources.length);
 for(const part of parts){const height=sources.slice(part.start,part.end).reduce((sum,source)=>sum+Math.max(1,Math.round(source.height*800/source.width)),0);if(height!==part.height)throw failure();}
}
export async function detailCompositePartsUploadId(input:DetailCompositePartsIdentity,parts:readonly Omit<DetailCompositePartDescriptor,'uploadId'>[]):Promise<string>{
 return labelUploadDigest(new TextEncoder().encode(JSON.stringify({kind:input.workspace?'workspace-detail-composite-parts-v2':'detail-composite-parts-v2',productId:input.productId,optionId:input.optionId,
  category:input.category,fingerprint:input.fingerprint,...(input.workspace?{workspace:input.workspace}:{}),sources:input.sources,width:800,partsPolicy:DETAIL_COMPOSITE_PARTS_POLICY,
  parts:parts.map(detailCompositePartMetadata),...(input.peerDigest?{peerDigest:input.peerDigest}:{}),...(input.publicationPolicy?{publicationPolicy:input.publicationPolicy,publishedBodyImages:input.publishedBodyImages}:{})})));
}
export async function detailCompositePartUploadId(root:string,index:number,part:Omit<DetailCompositePartDescriptor,'uploadId'>):Promise<string>{
 if(index===0)return root;
 return labelUploadDigest(new TextEncoder().encode(JSON.stringify({kind:'detail-composite-part-v2',root,index,...detailCompositePartMetadata(part)})));
}
