import {imageFileType,isOwnedImageKey,MAX_IMAGE_BYTES} from '@/app/image-files';
import {PRODUCT_IMAGE_POOL_LIMIT} from '@/app/image-pool-limit';
import {productImageKeys,type ProductContent} from '@/app/product-content';
export type ImageUploadPhase='pending'|'uploading'|'uploaded'|'attaching'|'done'|'failed'|'uncertain-upload'|'uncertain-attachment';
export type ProductImageUploadBasis={productId:string;ownerId:string;productVersion:string;imageKeys:string[];content:ProductContent};
export type ProductImageUploadItem={id:string;file:File;contentType:string;phase:ImageUploadPhase;key?:string;error?:string;attachmentBasis?:ProductImageUploadBasis;retryAttach?:boolean;dismissed?:boolean};
type Controls={fetcher?:typeof fetch;signal?:AbortSignal;current:()=>boolean;onItem?:(item:ProductImageUploadItem)=>void};
type UploadReply={error?:string;key?:unknown;contentType?:string;size?:number;product?:{id:string;owner_id:string;updated_at:string;image_keys:string};content?:ProductContent};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const valid=()=>Error('상품 또는 이미지 저장 상태가 변경됐습니다. 파일과 연결 결과를 유지했습니다.');
function current(controls:Controls){if(controls.signal?.aborted||!controls.current())throw valid();}
export function imageUploadIdentity(file:File){return JSON.stringify([file.name,file.size,file.type,file.lastModified]);}
export async function prepareProductImageFiles(files:readonly File[],existing:readonly ProductImageUploadItem[],storedCount:number){
 if(!Number.isInteger(storedCount)||storedCount<0||storedCount>PRODUCT_IMAGE_POOL_LIMIT)throw Error('저장한 이미지 개수를 확인해주세요.');
 const waiting=existing.filter(item=>item.phase!=='done').length;
 if(!files.length||files.length+waiting+storedCount>PRODUCT_IMAGE_POOL_LIMIT)throw Error(`저장한 파일과 대기 파일을 합해 이미지 ${PRODUCT_IMAGE_POOL_LIMIT}개 이내로 선택해주세요.`);
 const ids=new Set(existing.map(item=>imageUploadIdentity(item.file))),results:ProductImageUploadItem[]=[];
 for(const file of files){
  if(!(file instanceof File)||!file.name||file.size<1||file.size>MAX_IMAGE_BYTES)throw Error(`${file.name||'파일'}: 내용이 있는 10MB 이하 이미지를 선택해주세요.`);
  const identity=imageUploadIdentity(file);if(ids.has(identity))throw Error(`${file.name}: 이미 대기하거나 처리한 파일입니다. 저장 결과를 먼저 확인해주세요.`);ids.add(identity);
  let actual;try{actual=imageFileType(new Uint8Array(await file.slice(0,1024).arrayBuffer()));}catch{throw Error(`${file.name}: PNG·JPEG·WebP·GIF·AVIF 이미지만 선택해주세요.`);}
  if(file.type&&file.type!==actual.contentType)throw Error(`${file.name}: 파일 형식과 실제 이미지가 다릅니다.`);
  results.push({id:crypto.randomUUID(),file,contentType:actual.contentType,phase:'pending'});
 }
 return results;
}
export async function readProductImageUploadBasis(productId:string,ownerId:string,controls:Controls):Promise<ProductImageUploadBasis>{
 current(controls);const request=controls.fetcher??fetch,endpoint=`/api/products/${encodeURIComponent(productId)}`;
 const get=async(url:string)=>{const response=await request(url,{cache:'no-store',signal:controls.signal});const body=await response.json() as UploadReply;current(controls);if(!response.ok)throw Error(body?.error||'상품 이미지 저장본을 확인하지 못했습니다.');return body;};
 const before=await get(endpoint),content=await get(endpoint+'/content'),after=await get(endpoint),product=before?.product;
 if(!product||product.id!==productId||product.owner_id!==ownerId||!Number.isFinite(Date.parse(product.updated_at))||!after?.product
  ||after.product.id!==productId||after.product.owner_id!==ownerId||after.product.updated_at!==product.updated_at||after.product.image_keys!==product.image_keys
  ||!content.content||content.content.productId!==productId||!Number.isSafeInteger(content.content.revision)||content.content.revision<0)throw valid();
 const imageKeys=productImageKeys(product.image_keys);if(imageKeys.length>PRODUCT_IMAGE_POOL_LIMIT||imageKeys.some(key=>!key.startsWith(ownerId+'/')))throw valid();
 return {productId,ownerId,productVersion:product.updated_at,imageKeys,content:content.content};
}
export function sameProductImageUploadBasis(a:ProductImageUploadBasis,b:ProductImageUploadBasis){return same(a,b);}
function verifyAttachment(basis:ProductImageUploadBasis,key:string,receipt:unknown):ProductImageUploadBasis{
 const value=receipt as {content?:ProductContent;imageKeys?:string[];productVersion?:string};
 if(!value||typeof value.productVersion!=='string'||!Number.isFinite(Date.parse(value.productVersion))||Date.parse(value.productVersion)<=Date.parse(basis.productVersion)
  ||!same(value.imageKeys,[...basis.imageKeys,key])||!same(value.content,basis.content))throw valid();
 return {...basis,productVersion:value.productVersion,imageKeys:value.imageKeys!,content:value.content!};
}
/** One explicit file attempt. Unknown general-file ACKs cannot be looked up by
 * this API, so they never select a second upload. Attachment recovery is GET-only. */
export async function uploadProductImageQueueItem(basis:ProductImageUploadBasis,input:ProductImageUploadItem,controls:Controls){
 let item={...input},next=basis;const request=controls.fetcher??fetch;
 const publish=(patch:Partial<ProductImageUploadItem>)=>{item={...item,...patch};controls.onItem?.(item);};
 try{
  current(controls);if(item.phase!=='pending'&&!(item.phase==='uploaded'&&item.retryAttach))throw Error('대기 파일 또는 미연결을 확인한 파일만 처리할 수 있습니다.');
  const observed=await readProductImageUploadBasis(basis.productId,basis.ownerId,controls);if(!sameProductImageUploadBasis(observed,basis))throw valid();
  if(basis.imageKeys.length>=PRODUCT_IMAGE_POOL_LIMIT)throw Error(`상품 이미지는 최대 ${PRODUCT_IMAGE_POOL_LIMIT}개입니다.`);
  if(item.phase==='pending'){
   const form=new FormData();form.set('file',item.file);publish({phase:'uploading',error:undefined});
   let response:Response|undefined;
   try{
    response=await request('/api/files',{method:'POST',body:form,signal:controls.signal});const body=await response.json() as UploadReply;current(controls);
    if(!response.ok){if(response.status<500){publish({phase:'failed',error:body?.error||'파일 업로드가 거절됐습니다.'});return {item,basis:next,stop:false};}throw Error(body?.error||'업로드 응답 확인 불가');}
    if(!isOwnedImageKey(basis.ownerId,body?.key)||basis.imageKeys.includes(body.key)||body.contentType!==item.contentType||body.size!==item.file.size)throw Error('업로드한 파일의 소유자·형식·크기를 확인하지 못했습니다.');
    publish({phase:'uploaded',key:body.key,error:undefined});
   }catch(cause){publish({phase:'uncertain-upload',error:cause instanceof Error?cause.message:'파일 업로드 결과 확인 불가'});return {item,basis:next,stop:controls.signal?.aborted||!controls.current()};}
  }
  current(controls);if(!item.key||!isOwnedImageKey(basis.ownerId,item.key))throw valid();
  const beforeAttach=await readProductImageUploadBasis(basis.productId,basis.ownerId,controls);if(!sameProductImageUploadBasis(beforeAttach,basis))throw valid();
  publish({phase:'attaching',attachmentBasis:basis,retryAttach:false,error:undefined});
  let response:Response|undefined;
  try{
   response=await request(`/api/products/${encodeURIComponent(basis.productId)}/attachments`,{method:'POST',signal:controls.signal,headers:{'content-type':'application/json'},body:JSON.stringify({key:item.key,role:null,expectedVersion:basis.productVersion,expectedContentRevision:basis.content.revision})});
   const body=await response.json() as UploadReply;current(controls);
   if(!response.ok){if(response.status<500){publish({phase:'uploaded',retryAttach:false,error:body?.error||'이미지 연결을 확인해주세요.'});return {item,basis:next,stop:true};}throw Error(body?.error||'이미지 연결 결과 확인 불가');}
   next=verifyAttachment(basis,item.key,body);publish({phase:'done',error:undefined});return {item,basis:next,stop:false};
  }catch(cause){publish({phase:'uncertain-attachment',error:cause instanceof Error?cause.message:'이미지 연결 결과 확인 불가'});return {item,basis:next,stop:true};}
 }catch(cause){publish({phase:item.key?'uploaded':'failed',retryAttach:false,error:cause instanceof Error?cause.message:'현재 상품의 이미지 연결을 확인해주세요.'});return {item,basis:next,stop:true};}
}
export async function recoverProductImageQueueItem(item:ProductImageUploadItem,controls:Controls){
 const base=item.attachmentBasis;if(!base||!item.key||!isOwnedImageKey(base.ownerId,item.key))throw Error('연결을 요청한 파일의 저장 기준을 확인해주세요.');
 const latest=await readProductImageUploadBasis(base.productId,base.ownerId,controls);
 if(sameProductImageUploadBasis(latest,base))return {item:{...item,phase:'uploaded' as const,retryAttach:true,error:'아직 연결되지 않은 동일한 저장본입니다. 저장된 파일 연결을 누르면 다시 연결합니다.'},basis:latest};
 const committed=verifyAttachment(base,item.key,{content:latest.content,imageKeys:latest.imageKeys,productVersion:latest.productVersion});
 return {item:{...item,phase:'done' as const,retryAttach:false,error:undefined},basis:committed};
}
