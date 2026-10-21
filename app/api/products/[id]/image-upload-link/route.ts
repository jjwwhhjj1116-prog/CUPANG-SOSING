import {NextResponse} from 'next/server';
import {env} from 'cloudflare:workers';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {readProductContent} from '@/db/product-content';
import {stableQuotationFieldsView,QuotationFieldsSnapshotError} from '@/app/quotation-fields-snapshot';
import {commitImageUploadLink} from '@/db/image-upload-link';
import {readStageTwoPricingFence} from '@/db/stage-two-pricing';
import {findProduct} from '@/db/queries';
import {imageUploadLinkRequest,prepareImageUploadLink,verifyImageUploadLinkReceipt,type ImageUploadLinkBasis,type ImageUploadLinkRequest} from '@/app/image-upload-link';
import {readBoundedJson,readBoundedStream,RequestBodyError} from '@/app/request-body';
import {imageFileType,isOwnedImageKey,MAX_IMAGE_BYTES} from '@/app/image-files';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'cache-control':'no-store'}});
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const user=await getChatGPTUser();
 if(process.env.NODE_ENV==='production'&&!user?.verifiedAccess)return json({error:'운영 인증 연결 후 이미지를 연결할 수 있습니다.'},503);
 try{
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return json({error:'같은 사이트에서 이미지를 연결해주세요.'},400);
  const input=await readBoundedJson(request,4096) as ImageUploadLinkRequest;
  const keys=['key','stage','optionId','expectedProductVersion','expectedContentRevision','expectedOptionRevision','expectedQuotationRevision','expectedInputFingerprint'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key))||Object.keys(input).some(key=>!keys.includes(key))
   ||!['additional','detail'].includes(input.stage)||input.optionId!==null&&(typeof input.optionId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/u.test(input.optionId)))return json({error:'이미지 연결 대상과 저장 버전을 확인해주세요.'},400);
  const owner=await getWorkspaceOwnerId(),{id}=await context.params,query=new URL(request.url).searchParams,profileId=query.get('profileId');
  const company=user?.verifiedAccess&&user.userId===owner?approvedSupplierHubCompany(user.membership):null;
  const member=company&&user?.membership&&user.membership.email&&user.membership.role?{email:user.membership.email,role:user.membership.role,companyCode:company.code,companyName:company.name}:undefined;
  if((env as {YOOFAM_AUTH_ENABLED?:string}).YOOFAM_AUTH_ENABLED==='true'&&!member)return json({error:'승인된 회원과 Supplier Hub 회사를 확인해주세요.'},403);
  if([...query.keys()].some(key=>key!=='profileId')||profileId!==null&&!/^[A-Za-z0-9_-]{1,100}$/u.test(profileId)||!isOwnedImageKey(owner,input.key))return json({error:'이미지 소유자와 카테고리를 확인해주세요.'},400);
  const saved=await stableQuotationFieldsView(owner,id,profileId),content=await readProductContent(owner,id);
  const base:ImageUploadLinkBasis={productId:id,ownerId:owner,productVersion:saved.view.productVersion,imageKeys:saved.view.imageKeys,content,quotation:saved.view,target:{optionId:input.optionId,...(profileId?{profileId}:{})},stage:input.stage};
  const expected=imageUploadLinkRequest(base,input.key);
  if(keys.some(key=>expected[key as keyof ImageUploadLinkRequest]!==input[key as keyof ImageUploadLinkRequest]))return json({error:'상품·옵션 또는 이미지 저장 기준이 변경됐습니다. 파일과 편집값은 유지했습니다.'},409);
  const now=new Date(Math.max(Date.now(),Date.parse(base.productVersion)+1)).toISOString();
  let prepared;try{prepared=prepareImageUploadLink(base,input.key,now);}catch(error){return json({error:error instanceof Error?error.message:'이미지 목록을 확인해주세요.'},400);}
  const product=await findProduct(owner,id),raw=await readStageTwoPricingFence(owner,id,profileId);
  if(!product||product.updated_at!==base.productVersion||JSON.stringify((await stableQuotationFieldsView(owner,id,profileId)).view)!==JSON.stringify(base.quotation)
   ||JSON.stringify(await readProductContent(owner,id))!==JSON.stringify(base.content))return json({error:'이미지 연결 기준이 변경됐습니다. 기존 파일과 편집값은 유지했습니다.'},409);
  if(!env.FILES)return json({error:'이미지 저장소가 연결되지 않았습니다.'},503);
  const file=await env.FILES.get(input.key,{range:{offset:0,length:1024}});
  if(!file||file.size<1||file.size>MAX_IMAGE_BYTES)return json({error:'본인 소유의 업로드한 이미지가 필요합니다.'},400);
  try{imageFileType(await readBoundedStream(file.body,1024));}catch{return json({error:'지원하는 이미지 파일만 연결할 수 있습니다.'},400);}
  if(JSON.stringify(await findProduct(owner,id))!==JSON.stringify(product)||JSON.stringify(await readStageTwoPricingFence(owner,id,profileId))!==JSON.stringify(raw))return json({error:'이미지를 확인하는 동안 상품 자료가 변경됐습니다. 파일은 보관했습니다.'},409);
  const committed=await commitImageUploadLink(owner,id,saved.source,saved.view.revision,saved.view.categoryContext.categoryId,prepared.content,input.optionId===null,prepared.overrides,prepared.imageKeys,now,{raw,product},member);
  if(!committed)return json({error:'연결 중 상품 자료가 변경됐습니다. 파일을 다시 업로드하지 말고 저장본을 확인해주세요.'},409);
  const after=await stableQuotationFieldsView(owner,id,profileId),reply={productVersion:after.view.productVersion,imageKeys:after.view.imageKeys,content:await readProductContent(owner,id),quotation:after.view};
  verifyImageUploadLinkReceipt(base,input.key,reply);return json(reply);
 }catch(error){
  if(error instanceof RequestBodyError||error instanceof QuotationFieldsSnapshotError)return json({error:error.message},error.status);
  return json({error:'이미지 연결 응답을 확인하지 못했습니다. 파일을 다시 올리지 말고 저장 결과를 조회해주세요.'},503);
 }
}
