import {imageFileType,isOwnedImageKey,MAX_IMAGE_BYTES} from '@/app/image-files';
import {imageDimensions} from '@/app/image-dimensions';
import type {BundleAsset} from '@/app/exports/review-bundle';

export type VerifiedImageFacts=Readonly<{byteLength:number;sha256:string;fileType:ReturnType<typeof imageFileType>;dimensions:ReturnType<typeof imageDimensions>}>;
const buckets=new WeakMap<object,Map<string,VerifiedImageFacts>>(),issued=new WeakMap<object,string>();
function scope(owner:string,key:string,metadata:unknown):string|null{
 try{
  const head=metadata as R2Object|null;
  if(!isOwnedImageKey(owner,key)||!head||typeof head.version!=='string'||!head.version.length||head.version.length>512||/[\u0000-\u0020\u007f]/.test(head.version)
    ||!Number.isSafeInteger(head.size)||head.size<1||head.size>MAX_IMAGE_BYTES)return null;
  const value=JSON.stringify([owner,key,head.version,head.size,head]);return value.length<=8192?value:null;
 }catch{return null;}
}
/** Opaque facts only: never bytes, a user DTO, an uploader SHA or an ETag. */
export function verifiedImageFacts(value:unknown,owner:string,key:string,metadata:unknown):VerifiedImageFacts|undefined{
 const expected=scope(owner,key,metadata);return expected&&value&&typeof value==='object'&&issued.get(value)===expected?value as VerifiedImageFacts:undefined;
}
export function cachedImageFacts(bucket:object,owner:string,key:string,metadata:unknown):VerifiedImageFacts|undefined{
 const identity=scope(owner,key,metadata);return identity?buckets.get(bucket)?.get(identity):undefined;
}
/** Prepare from real bytes; publish synchronously only after the loader's final
 * HEAD/source fence. Never bind an older body to a later upload's metadata. */
export async function prepareImageFacts(bucket:object,owner:string,key:string,metadata:R2Object|null|undefined,object:{version:string;size:number},asset:BundleAsset):Promise<()=>void>{
 const identity=scope(owner,key,metadata);
 if(!identity||!metadata||object.version!==metadata.version||object.size!==metadata.size||asset.key!==key||asset.data.byteLength!==metadata.size)return()=>{};
 const fileType=imageFileType(asset.data);if(!['image/png','image/jpeg'].includes(fileType.contentType)||metadata.httpMetadata?.contentType!==undefined&&metadata.httpMetadata.contentType!==fileType.contentType)return()=>{};
 const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(asset.data.buffer as ArrayBuffer,asset.data.byteOffset,asset.data.byteLength)),sha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
 if(asset.sha256!==sha256||['sha256','labelBlobSha256','freeImageOutputSha256'].some(name=>metadata.customMetadata?.[name]!==undefined&&metadata.customMetadata[name]!==sha256))return()=>{};
 const dimensions=imageDimensions(asset.data),facts=Object.freeze({byteLength:asset.data.byteLength,sha256,fileType:Object.freeze(fileType),dimensions:dimensions?Object.freeze(dimensions):null});
 return()=>{issued.set(facts,identity);let cache=buckets.get(bucket);if(!cache){cache=new Map();buckets.set(bucket,cache);}
 if(!cache.has(identity)&&cache.size>=256)cache.delete(cache.keys().next().value!);
 cache.set(identity,facts);};
}
