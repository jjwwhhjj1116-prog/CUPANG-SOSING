import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {validatePageSourceForDelivery,PAGE_SOURCE_LIMIT} from '@/extensions/supplier-hub/page-source.mjs';
import {pageSourceFingerprint,reviewPageSource} from '@/app/source-inbox';
import {listSourceInbox,readSourceInbox,storeSourceInbox,reviewSourceInbox,archiveSourceInbox,restoreSourceInbox,SourceInboxConflict,SOURCE_INBOX_ACTIVE_LIMIT,SOURCE_INBOX_RETENTION_LIMIT} from '@/db/source-inbox';
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
async function access(){const user=await getChatGPTUser(),company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;return company?{owner:await getWorkspaceOwnerId(),company}:null;}
export async function GET(){try{const auth=await access();if(!auth)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);return reply({ownerId:auth.owner,company:auth.company,items:await listSourceInbox(auth.owner,auth.company),limits:{active:SOURCE_INBOX_ACTIVE_LIMIT,retained:SOURCE_INBOX_RETENTION_LIMIT}});}catch{return reply({error:'수집함을 불러오지 못했습니다.'},503);}}
export async function POST(request:Request){
 try{
  const auth=await access();if(!auth)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);
  const body=await readBoundedJson(request,PAGE_SOURCE_LIMIT+4096) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['expectedOwnerId','expectedCompany','id','fingerprint','snapshot'].includes(key)))return reply({error:'상품 수집 요청을 확인해주세요.'},400);
  const company=body.expectedCompany as {code?:unknown;name?:unknown}|undefined;
  if(body.expectedOwnerId!==auth.owner||company?.code!==auth.company.code||company?.name!==auth.company.name)return reply({error:'수집 중 로그인 회원·회사가 변경되었습니다.'},409);
  if(typeof body.id!=='string'||!/^[a-f0-9-]{36}$/.test(body.id)||typeof body.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(body.fingerprint))return reply({error:'수집 요청 번호를 확인해주세요.'},400);
  let snapshot;try{snapshot=validatePageSourceForDelivery(body.snapshot);}catch(error){return reply({error:error instanceof Error?error.message:'상품 수집 내용을 확인해주세요.'},400);}
  if(await pageSourceFingerprint(snapshot)!==body.fingerprint)return reply({error:'수집 원문 확인값이 일치하지 않습니다.'},400);
  const saved=await storeSourceInbox(auth.owner,auth.company,body.id,body.fingerprint,snapshot);
  if(!saved)return reply({error:`수집함은 표시 중인 원문 ${SOURCE_INBOX_ACTIVE_LIMIT}개·보존된 전체 원문 ${SOURCE_INBOX_RETENTION_LIMIT}개까지 보관합니다. 기존 원문과 작업 상품은 유지됩니다.`},409);
  let existing=saved.item;
  if(existing.archivedAt){const restored=await restoreSourceInbox(auth.owner,existing.id,existing.revision);if(!restored)return reply({error:'수집함이 변경됐거나 표시 가능한 원문 수를 초과했습니다. 확인한 상품을 제외한 뒤 다시 불러오세요.'},409);existing=restored;}
  // A changed snapshot is a separately stored immutable capture. Only the
  // exact same fingerprint may acknowledge a previously retained version.
  if(existing.fingerprint!==body.fingerprint||existing.company.code!==auth.company.code||existing.company.name!==auth.company.name)return reply({error:'저장된 수집 원문과 회사·확인값이 다릅니다.'},409);
  return reply({ok:true,id:body.id,fingerprint:body.fingerprint,ownerId:auth.owner,company:auth.company,storedId:existing.id,storedFingerprint:existing.fingerprint,duplicate:saved.duplicate,captureOriginId:existing.captureOriginId,captureVersion:existing.captureVersion});
 }catch(error){return reply({error:error instanceof Error?error.message:'수집함 저장 결과를 확인하지 못했습니다.'},error instanceof RequestBodyError?error.status:error instanceof SourceInboxConflict?409:503);}
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
