import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {validatePageSource,PAGE_SOURCE_LIMIT} from '@/extensions/supplier-hub/page-source.mjs';
import {pageSourceFingerprint,reviewPageSource} from '@/app/source-inbox';
import {listSourceInbox,readSourceInbox,findSourceInbox,storeSourceInbox,reviewSourceInbox,archiveSourceInbox,restoreSourceInbox} from '@/db/source-inbox';
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
async function access(){const user=await getChatGPTUser(),company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;return company?{owner:await getWorkspaceOwnerId(),company}:null;}
export async function GET(){try{const auth=await access();if(!auth)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);return reply({ownerId:auth.owner,company:auth.company,items:await listSourceInbox(auth.owner,auth.company)});}catch{return reply({error:'수집함을 불러오지 못했습니다.'},503);}}
export async function POST(request:Request){
 try{
  const auth=await access();if(!auth)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);
  const body=await readBoundedJson(request,PAGE_SOURCE_LIMIT+4096) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['expectedOwnerId','expectedCompany','id','fingerprint','snapshot'].includes(key)))return reply({error:'상품 수집 요청을 확인해주세요.'},400);
  const company=body.expectedCompany as {code?:unknown;name?:unknown}|undefined;
  if(body.expectedOwnerId!==auth.owner||company?.code!==auth.company.code||company?.name!==auth.company.name)return reply({error:'수집 중 로그인 회원·회사가 변경되었습니다.'},409);
  if(typeof body.id!=='string'||!/^[a-f0-9-]{36}$/.test(body.id)||typeof body.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(body.fingerprint))return reply({error:'수집 요청 번호를 확인해주세요.'},400);
  let snapshot;try{snapshot=validatePageSource(body.snapshot);}catch(error){return reply({error:error instanceof Error?error.message:'상품 수집 내용을 확인해주세요.'},400);}
  if(await pageSourceFingerprint(snapshot)!==body.fingerprint)return reply({error:'수집 원문 확인값이 일치하지 않습니다.'},400);
  const saved=await storeSourceInbox(auth.owner,auth.company,body.id,body.fingerprint,snapshot);
  if(saved&&saved.fingerprint!==body.fingerprint)return reply({error:'같은 요청에 다른 원문이 있습니다. 기존 원문은 유지됩니다.'},409);
  let existing=saved??await findSourceInbox(auth.owner,snapshot.offerId);
  if(!existing||existing.company.code!==auth.company.code||existing.company.name!==auth.company.name)return reply({error:'수집함 저장을 확인하지 못했습니다. 최대 40개까지 보관합니다.'},409);
  if(existing.archivedAt){existing=await restoreSourceInbox(auth.owner,existing.id);if(!existing)return reply({error:'수집함이 가득 찼습니다. 확인한 상품을 수집함에서 제외한 뒤 다시 불러오세요.'},409);}
  // Explicit duplicate acknowledgement. The incoming copy is discarded only
  // after the server proves the original is durably stored in this account.
  return reply({ok:true,id:body.id,fingerprint:body.fingerprint,ownerId:auth.owner,company:auth.company,storedId:existing.id,storedFingerprint:existing.fingerprint,duplicate:!saved});
 }catch(error){return reply({error:error instanceof Error?error.message:'수집함 저장 결과를 확인하지 못했습니다.'},error instanceof RequestBodyError?error.status:503);}
}
export async function DELETE(request:Request){
 try{
  const auth=await access();if(!auth)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);
  const body=await readBoundedJson(request,4096) as {expectedOwnerId?:unknown;id?:unknown;expectedRevision?:unknown};
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['expectedOwnerId','id','expectedRevision'].includes(key))||typeof body.id!=='string'||!/^[a-f0-9-]{36}$/.test(body.id)||!Number.isSafeInteger(body.expectedRevision))return reply({error:'수집함 제외 요청을 확인해주세요.'},400);
  if(body.expectedOwnerId!==auth.owner)return reply({error:'로그인 계정이 변경되었습니다.'},409);
  const item=await readSourceInbox(auth.owner,body.id);if(!item||item.company.code!==auth.company.code||item.company.name!==auth.company.name)return reply({error:'이 회사의 수집 상품을 찾을 수 없습니다.'},404);
  const saved=await archiveSourceInbox(auth.owner,item.id,body.expectedRevision as number);
  return saved?reply({ownerId:auth.owner,id:item.id,archived:true}):reply({error:'수집함이 변경되었습니다. 새로고침 후 확인해주세요.'},409);
 }catch(error){return reply({error:error instanceof RequestBodyError?error.message:'수집함 제외 결과를 확인하지 못했습니다.'},error instanceof RequestBodyError?error.status:503);}
}
export async function PUT(request:Request){
 try{
  const auth=await access();if(!auth)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);
  const body=await readBoundedJson(request,PAGE_SOURCE_LIMIT) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['expectedOwnerId','id','expectedRevision','review'].includes(key))||typeof body.id!=='string'||!/^[a-f0-9-]{36}$/.test(body.id)||!Number.isSafeInteger(body.expectedRevision))return reply({error:'수집함 검토 요청을 확인해주세요.'},400);
  if(body.expectedOwnerId!==auth.owner)return reply({error:'로그인 계정이 변경되었습니다.'},409);
  const item=await readSourceInbox(auth.owner,body.id);if(!item||item.company.code!==auth.company.code||item.company.name!==auth.company.name)return reply({error:'이 회사의 수집 상품을 찾을 수 없습니다.'},404);
  let reviewed;try{reviewed=reviewPageSource(item.snapshot,body.review);}catch(error){return reply({error:error instanceof Error?error.message:'상품정보를 확인해주세요.'},422);}
  const saved=await reviewSourceInbox(auth.owner,item.id,body.expectedRevision as number,reviewed);
  return saved?reply({ownerId:auth.owner,company:auth.company,item:saved}):reply({error:'다른 창에서 검토 내용이 변경되었습니다. 새로고침 후 확인해주세요.'},409);
 }catch(error){return reply({error:error instanceof RequestBodyError?error.message:'수집함 검토 저장을 확인하지 못했습니다.'},error instanceof RequestBodyError?error.status:503);}
}
