import {NextResponse} from 'next/server';
import {env} from 'cloudflare:workers';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {findProduct} from '@/db/queries';
import {readProductContent} from '@/db/product-content';
import {readQuotationFields} from '@/db/quotation-fields';
import {readStageTwoPricingFence} from '@/db/stage-two-pricing';
import {commitSizeChartSave} from '@/db/size-chart-save';
import {stableQuotationFieldsView,QuotationFieldsSnapshotError} from '@/app/quotation-fields-snapshot';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {imageFileType,isOwnedImageKey,MAX_IMAGE_BYTES,MAX_IMAGE_MULTIPART_BYTES,PRODUCT_IMAGE_POOL_LIMIT} from '@/app/image-files';
import {readBoundedBytes,readBoundedStream,RequestBodyError} from '@/app/request-body';
import {sizeChartBytesDigest,sizeChartDigest,sizeChartSaveKey,sizeChartSavePlan,sizeChartSavedContent,validateSizeChartSaveInput,type SizeChartSaveSnapshot,type SizeChartUpload} from '@/app/size-chart-save';

type Context={params:Promise<{id:string}>};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
const conflict=()=>new QuotationFieldsSnapshotError('사이즈표를 만드는 동안 상품·옵션·회사 또는 카테고리가 변경되었습니다. 입력과 이미지는 보관하고 저장 결과를 확인해주세요.',409,'SIZE_CHART_SAVE_CONFLICT');
function selection(request:Request,allowUpload:boolean){const query=new URL(request.url).searchParams,profileId=query.get('profileId'),uploadId=query.get('uploadId');if([...query.keys()].some(key=>key!=='profileId'&&(!allowUpload||key!=='uploadId'))||query.getAll('profileId').length>1||query.getAll('uploadId').length>1||profileId!==null&&!/^[a-zA-Z0-9_-]{1,100}$/.test(profileId)||uploadId!==null&&!/^[a-f0-9]{64}$/.test(uploadId))throw new QuotationFieldsSnapshotError('사이즈표 프로필과 저장 번호를 확인해주세요.',400);return{profileId,uploadId};}
async function storedUpload(owner:string,id:string,uploadId:string):Promise<SizeChartUpload|null>{
 if(!env.FILES)throw Error('Missing PNG storage');const key=sizeChartSaveKey(owner,uploadId);if(!isOwnedImageKey(owner,key))throw Error('Invalid owner');
 const object=await env.FILES.get(key);if(!object)return null;const meta=object.customMetadata??{};
 if(object.size<1||object.size>MAX_IMAGE_BYTES||object.httpMetadata?.contentType!=='image/png'||meta.sizeChartProductId!==id||meta.sizeChartUploadId!==uploadId||[meta.sizeChartPngSha256,meta.sizeChartSourceFingerprint,meta.sizeChartChartSha256,meta.sizeChartPlanSha256].some(value=>!/^[a-f0-9]{64}$/.test(value??'')))throw conflict();
 const bytes=await readBoundedStream(object.body,MAX_IMAGE_BYTES);if(bytes.byteLength!==object.size||imageFileType(bytes).contentType!=='image/png'||await sizeChartBytesDigest(bytes)!==meta.sizeChartPngSha256)throw conflict();
 return{uploadId,key,size:object.size,sha256:meta.sizeChartPngSha256,contentType:'image/png',sourceFingerprint:meta.sizeChartSourceFingerprint,chartSha256:meta.sizeChartChartSha256,planSha256:meta.sizeChartPlanSha256};
}
async function snapshot(owner:string,id:string,profileId:string|null,uploadId:string|null):Promise<SizeChartSaveSnapshot>{
 const before=await stableQuotationFieldsView(owner,id,profileId),product=await findProduct(owner,id),content=await readProductContent(owner,id),quotation=await readQuotationFields(owner,id),upload=uploadId?await storedUpload(owner,id,uploadId):null;
 const after=await stableQuotationFieldsView(owner,id,profileId),latestQuotation=await readQuotationFields(owner,id);
 if(!product||product.updated_at!==before.view.productVersion||JSON.stringify(JSON.parse(product.image_keys))!==JSON.stringify(before.view.imageKeys)||new Set(before.view.imageKeys).size!==before.view.imageKeys.length||content.revision!==before.view.contentRevision||quotation.revision!==before.view.revision||JSON.stringify(latestQuotation)!==JSON.stringify(quotation)||after.view.inputFingerprint!==before.view.inputFingerprint||after.view.revision!==before.view.revision||JSON.stringify(after.options)!==JSON.stringify(before.options))throw conflict();
 return{productId:id,ownerId:owner,productVersion:product.updated_at,imageKeys:before.view.imageKeys,content,options:before.options,quotationRevision:before.view.revision,quotationStateSha256:await sizeChartDigest(quotation),inputFingerprint:before.view.inputFingerprint,profileId,categoryId:before.view.categoryContext.categoryId,upload};
}
function failure(error:unknown){if(error instanceof QuotationFieldsSnapshotError)return json({error:error.message,code:error.code},error.status);if(error instanceof RequestBodyError)return json({error:error.message},error.status);return json({error:'사이즈표 저장 결과를 확인하지 못했습니다. 입력을 유지하고 저장 결과를 조회해주세요.'},503);}
export async function GET(request:Request,context:Context){
 if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return json({error:'운영 인증 연결 후 사이즈표를 확인할 수 있습니다.'},503);
 try{const owner=await getWorkspaceOwnerId(),{id}=await context.params,{profileId,uploadId}=selection(request,true);return json(await snapshot(owner,id,profileId,uploadId));}catch(error){return failure(error);}
}
export async function POST(request:Request,context:Context){
 if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)return json({error:'운영 인증 연결 후 사이즈표를 저장할 수 있습니다.'},503);
 try{
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw new QuotationFieldsSnapshotError('같은 사이트에서 저장해주세요.',400);
  const{profileId}=selection(request,false),contentType=request.headers.get('content-type')??'';if(!/^multipart\/form-data(?:\s*;|$)/i.test(contentType))throw new QuotationFieldsSnapshotError('표와 PNG를 함께 전송해주세요.',400);
  const bytes=await readBoundedBytes(request,MAX_IMAGE_MULTIPART_BYTES+98304),form=await new Response(bytes.buffer as ArrayBuffer,{headers:{'content-type':contentType}}).formData();
  if(form.getAll('file').length!==1||form.getAll('input').length!==1||[...form.keys()].some(key=>!['file','input'].includes(key)))throw new QuotationFieldsSnapshotError('PNG 한 장과 사이즈표 정보를 확인해주세요.',400);
  const file=form.get('file'),raw=form.get('input');if(!(file instanceof File)||file.type!=='image/png'||file.size<1||file.size>MAX_IMAGE_BYTES||typeof raw!=='string'||new TextEncoder().encode(raw).length>98304)throw new QuotationFieldsSnapshotError('10MB 이하 PNG와 사이즈표를 전송해주세요.',400);
  let input;try{input=validateSizeChartSaveInput(JSON.parse(raw));}catch(error){throw new QuotationFieldsSnapshotError(error instanceof Error?error.message:'사이즈표 입력을 확인해주세요.',400);}
  const png=new Uint8Array(await file.arrayBuffer());if(imageFileType(png).contentType!=='image/png'||await sizeChartBytesDigest(png)!==input.pngSha256)throw new QuotationFieldsSnapshotError('생성한 PNG 내용이 전송한 이미지와 다릅니다.',400);
  const owner=await getWorkspaceOwnerId(),{id}=await context.params,saved=await stableQuotationFieldsView(owner,id,profileId),product=await findProduct(owner,id),content=await readProductContent(owner,id),quotation=await readQuotationFields(owner,id);
  if(!product||JSON.stringify(JSON.parse(product.image_keys))!==JSON.stringify(saved.view.imageKeys)||new Set(saved.view.imageKeys).size!==saved.view.imageKeys.length||saved.view.productVersion!==input.expectedProductVersion||content.revision!==input.expectedContentRevision||saved.options.revision!==input.expectedOptionRevision||saved.view.revision!==input.expectedQuotationRevision||await sizeChartDigest(quotation)!==input.expectedQuotationStateSha256||saved.view.inputFingerprint!==input.expectedInputFingerprint)throw conflict();
  const fence=await readStageTwoPricingFence(owner,id,profileId),actor=await getChatGPTUser(),company=approvedSupplierHubCompany(actor?.membership);
  if((env as {YOOFAM_AUTH_ENABLED?:string}).YOOFAM_AUTH_ENABLED==='true'){
   if(!actor?.verifiedAccess||actor.userId!==owner||!actor.membership||actor.membership.status!=='approved'||!company)throw conflict();
   fence.actor={email:actor.membership.email,role:actor.membership.role,companyCode:company.code,companyName:company.name};
  }
  const key=sizeChartSaveKey(owner,input.uploadId);if(saved.view.imageKeys.includes(key)||saved.view.imageKeys.length>=PRODUCT_IMAGE_POOL_LIMIT)throw conflict();
  let plan;try{plan=sizeChartSavePlan(content,saved.options,input.chart);}catch(error){throw new QuotationFieldsSnapshotError(error instanceof Error?error.message:'표 내용을 확인해주세요.',400);}
  const expected={uploadId:input.uploadId,key,size:png.byteLength,sha256:input.pngSha256,contentType:'image/png',sourceFingerprint:input.expectedInputFingerprint,chartSha256:await sizeChartDigest(input.chart),planSha256:await sizeChartDigest(plan)};
  if(!env.FILES)throw Error('Missing PNG storage');let upload=await storedUpload(owner,id,input.uploadId);
  if(upload&&JSON.stringify(upload)!==JSON.stringify(expected))throw conflict();
  if(!upload){
   await env.FILES.put(key,png,{httpMetadata:{contentType:'image/png'},customMetadata:{sizeChartProductId:id,sizeChartUploadId:input.uploadId,sizeChartPngSha256:input.pngSha256,sizeChartSourceFingerprint:input.expectedInputFingerprint,sizeChartChartSha256:expected.chartSha256,sizeChartPlanSha256:expected.planSha256},onlyIf:new Headers({'if-none-match':'*'})});
   upload=await storedUpload(owner,id,input.uploadId);if(!upload||JSON.stringify(upload)!==JSON.stringify(expected))throw conflict();
  }
  const checked=await stableQuotationFieldsView(owner,id,profileId);if(checked.view.inputFingerprint!==saved.view.inputFingerprint||checked.view.revision!==saved.view.revision)throw conflict();
  const version=new Date(Math.max(Date.now(),Date.parse(product.updated_at)+1)).toISOString(),next=sizeChartSavedContent(content,input.chart,key,version);
  if(!await commitSizeChartSave(owner,product,next,[...saved.view.imageKeys,key],saved.source,fence))throw conflict();
  const receipt=await snapshot(owner,id,profileId,input.uploadId);if(receipt.productVersion!==version||receipt.content.revision!==next.revision)throw conflict();return json(receipt);
 }catch(error){return failure(error);}
}
