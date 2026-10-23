import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {validatePageSourceForDelivery,PAGE_SOURCE_LIMIT,pageSourceUrl} from '@/extensions/supplier-hub/page-source.mjs';
import {pageSourceFingerprint,reviewPageSource} from '@/app/source-inbox';
import {listSourceInboxJson,readSourceInbox,storeSourceInbox,reviewSourceInbox,archiveSourceInbox,restoreSourceInbox,SourceInboxConflict,SOURCE_INBOX_ACTIVE_LIMIT,SOURCE_INBOX_RETENTION_LIMIT} from '@/db/source-inbox';
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
async function access(){const user=await getChatGPTUser(),company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;return company?{owner:await getWorkspaceOwnerId(),company}:null;}
export async function GET(){try{const auth=await access();if(!auth)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);const items=await listSourceInboxJson(auth.owner,auth.company),metadata=JSON.stringify({ownerId:auth.owner,company:auth.company,limits:{active:SOURCE_INBOX_ACTIVE_LIMIT,retained:SOURCE_INBOX_RETENTION_LIMIT}});return new Response(metadata.slice(0,-1)+',"items":'+items+'}',{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}catch{return reply({error:'수집함을 불러오지 못했습니다. 이전 목록은 최신 수집 상태가 아닐 수 있습니다.'},503);}}
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
  return reply({ok:true,id:body.id,fingerprint:body.fingerprint,ownerId:auth.owner,company:auth.company,storedId:existing.id,storedFingerprint:existing.fingerprint,duplicate:saved.duplicate,captureOriginId:existing.captureOriginId,captureVersion:existing.captureVersion,
   receivedAt:existing.receivedAt,collectedAt:existing.snapshot.collectedAt,sourceUrl:existing.snapshot.sourceUrl});
 }catch(error){return reply({error:error instanceof Error?error.message:'수집함 저장 결과를 확인하지 못했습니다.'},error instanceof RequestBodyError?error.status:error instanceof SourceInboxConflict?409:503);}
}
export async function DELETE(request:Request){
 try{
  // Read the owner before the latest member so an async owner lookup cannot
  // leave an older company/status snapshot authorizing the mutation.
  const currentAccess=async()=>{const owner=await getWorkspaceOwnerId(),user=await getChatGPTUser(),member=user?.membership,company=user?.verifiedAccess?approvedSupplierHubCompany(member):null;
   return company&&user?.userId===owner&&member?.id===owner&&typeof member.email==='string'&&['admin','member'].includes(member.role)
    ?{owner,company,member:{id:member.id,email:member.email.trim().toLowerCase(),role:member.role}}:null;};
  const auth=await currentAccess();if(!auth)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);
  const body=await readBoundedJson(request,4096) as Record<string,unknown>,identity=['expectedCompany','expectedFingerprint','expectedSourceUrl'];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['expectedOwnerId','id','expectedRevision',...identity].includes(key))||typeof body.id!=='string'||!/^[a-f0-9-]{36}$/.test(body.id)||!Number.isSafeInteger(body.expectedRevision)||(body.expectedRevision as number)<1)return reply({error:'수집함 제외 요청을 확인해주세요.'},400);
  const strict=identity.some(key=>Object.hasOwn(body,key));
  if(strict){
   const company=body.expectedCompany;
   if(!identity.every(key=>Object.hasOwn(body,key))||!company||typeof company!=='object'||Array.isArray(company)||Object.keys(company).sort().join(',')!=='code,name'
    ||typeof body.expectedFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedFingerprint)||typeof body.expectedSourceUrl!=='string')return reply({error:'선택한 수집 원문의 회사·확인값·주소를 함께 확인해주세요.'},400);
   let source;try{source=pageSourceUrl(body.expectedSourceUrl);}catch{return reply({error:'선택한 수집 원문의 주소를 확인해주세요.'},400);}
   if(source.sourceUrl!==body.expectedSourceUrl)return reply({error:'선택한 수집 원문의 정확한 주소를 확인해주세요.'},400);
   if((company as {code?:unknown}).code!==auth.company.code||(company as {name?:unknown}).name!==auth.company.name)return reply({error:'선택 이후 로그인 회사가 변경되었습니다.'},409);
  }
  if(body.expectedOwnerId!==auth.owner)return reply({error:'로그인 계정이 변경되었습니다.'},409);
  const item=await readSourceInbox(auth.owner,body.id);if(!item||item.company.code!==auth.company.code||item.company.name!==auth.company.name)return reply({error:'이 회사의 수집 상품을 찾을 수 없습니다.'},404);
  if(item.archivedAt||item.revision!==body.expectedRevision||strict&&(item.fingerprint!==body.expectedFingerprint||item.snapshot.sourceUrl!==body.expectedSourceUrl)
   ||await pageSourceFingerprint(item.snapshot)!==item.fingerprint)return reply({error:'선택한 수집 원문 또는 검토 버전이 변경되었습니다. 다시 선택해주세요.'},409);
  const latest=await currentAccess();if(!latest||latest.owner!==auth.owner||JSON.stringify(latest.company)!==JSON.stringify(auth.company)||JSON.stringify(latest.member)!==JSON.stringify(auth.member))return reply({error:'수집함을 제외하는 동안 로그인 회원·회사가 변경되었습니다.'},409);
  const saved=await archiveSourceInbox(auth.owner,item.id,body.expectedRevision as number,{item,member:auth.member});
  return saved?reply(strict?{ownerId:auth.owner,company:auth.company,id:item.id,fingerprint:item.fingerprint,sourceUrl:item.snapshot.sourceUrl,previousRevision:item.revision,revision:saved.revision,archived:true,archivedAt:saved.archivedAt}:{ownerId:auth.owner,id:item.id,archived:true}):reply({error:'수집함이 변경되었습니다. 새로고침 후 확인해주세요.'},409);
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
