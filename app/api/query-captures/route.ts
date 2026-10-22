import {env} from 'cloudflare:workers';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany,type SupplierHubCompany} from '@/app/supplier-hub-company';
import {parseCollectionRequest} from '@/app/sourcing';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {ProductQueryError,queryProductSource} from '@/app/product-query';
import {listQuerySourceCaptures,readQuerySourceCapture,storeQuerySourceCapture,archiveQuerySourceCapture,restoreQuerySourceCapture,QuerySourceCaptureConflict} from '@/db/query-source-captures';
import {querySourceFingerprint,querySourceCaptureSummary} from '@/app/query-source-capture';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
type Scope={ownerId:string;company:SupplierHubCompany};
async function scope():Promise<Scope|null>{const user=await getChatGPTUser(),company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;
 if(!company||!user?.verifiedAccess||user.userId!==await getWorkspaceOwnerId())return null;return {ownerId:user.userId,company};}
const same=(a:Scope,b:Scope|null)=>Boolean(b&&a.ownerId===b.ownerId&&a.company.code===b.company.code&&a.company.name===b.company.name);
export async function GET(request?:Request){try{const current=await scope();if(!current)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);
 const query=request?new URL(request.url).searchParams:new URLSearchParams();
 if([...query.keys()].some(key=>key!=='view')||query.has('view')&&(query.getAll('view').length!==1||query.get('view')!=='archived'))return reply({error:'수집함 조회 범위를 확인해주세요.'},400);
 const captures=await listQuerySourceCaptures(current.ownerId,current.company,{archived:query.get('view')==='archived'});if(!same(current,await scope()))return reply({error:'로그인 계정·회사가 변경되었습니다.',code:'QUERY_SCOPE_CHANGED'},409);
 return reply({...current,captures});}catch{return reply({error:'저장된 상품 원문을 확인하지 못했습니다.'},503);}}
/** An explicit URL collection stores only a fresh server-owned result. Clients
 * cannot upload a replacement source; retrying an uncertain ACK uses the ID. */
export async function POST(request:Request){try{
 const url=new URL(request.url);if(url.search||request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'로그인된 스튜디오에서 상품을 수집해주세요.',code:'INVALID_QUERY_ORIGIN'},403);
 const current=await scope();if(!current)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);
 const body=await readBoundedJson(request,4096) as Record<string,unknown>;
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==4||Object.keys(body).some(key=>!['id','sourceUrl','expectedOwnerId','expectedCompany'].includes(key))
  ||typeof body.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id))return reply({error:'상품 수집 요청을 확인해주세요.',code:'INVALID_QUERY_REQUEST'},400);
 const company=body.expectedCompany;if(!company||typeof company!=='object'||Array.isArray(company)||Object.keys(company).length!==2||Object.keys(company).some(key=>!['code','name'].includes(key))||body.expectedOwnerId!==current.ownerId
  ||(company as SupplierHubCompany).code!==current.company.code||(company as SupplierHubCompany).name!==current.company.name)return reply({error:'로그인 계정·회사가 변경되었습니다.',code:'QUERY_SCOPE_CHANGED'},409);
 let sourceUrl:string;try{sourceUrl=parseCollectionRequest({urls:[body.sourceUrl]})[0].sourceUrl;}catch{return reply({error:'1688 상품 상세 URL을 확인해주세요.',code:'INVALID_SOURCE_URL'},400);}
 if(request.signal.aborted)return reply({error:'상품 수집을 취소했습니다.',code:'SOURCE_QUERY_CANCELLED'},409);
 const previous=await readQuerySourceCapture(current.ownerId,body.id);
 if(previous){
  if(previous.archivedAt!==null||previous.company.code!==current.company.code||previous.company.name!==current.company.name||previous.snapshot.sourceUrl!==sourceUrl||await querySourceFingerprint(previous.snapshot)!==previous.fingerprint)return reply({error:'같은 요청 번호에 다른 수집 원문이 있습니다. 기존 원문은 유지됩니다.',code:'QUERY_CAPTURE_CONFLICT'},409);
  if(!same(current,await scope()))return reply({error:'로그인 계정·회사가 변경되었습니다.',code:'QUERY_SCOPE_CHANGED'},409);
  return reply({...current,item:previous,duplicate:true,sourceStored:true,draftCreated:false});
 }
 const result=await queryProductSource(sourceUrl,env as unknown as Record<string,unknown>,{signal:request.signal});
 if(!same(current,await scope()))return reply({error:'수집 중 로그인 계정·회사가 변경되었습니다.',code:'QUERY_SCOPE_CHANGED'},409);
 if(request.signal.aborted)return reply({error:'상품 수집을 취소했습니다.',code:'SOURCE_QUERY_CANCELLED'},409);
 const fingerprint=await querySourceFingerprint(result.source);
 if(!same(current,await scope()))return reply({error:'수집 중 로그인 계정·회사가 변경되었습니다.',code:'QUERY_SCOPE_CHANGED'},409);
 if(request.signal.aborted)return reply({error:'상품 수집을 취소했습니다.',code:'SOURCE_QUERY_CANCELLED'},409);
 const saved=await storeQuerySourceCapture(current.ownerId,current.company,body.id,fingerprint,result.source);
 if(!saved)return reply({error:'수집함 보관 한도에 도달했습니다. 보관한 상품을 확인해주세요.',code:'QUERY_CAPTURE_FULL'},409);
 if(saved.item.archivedAt!==null)return reply({error:'보관된 수집본입니다. 새 수집 원문을 확인해주세요.',code:'QUERY_CAPTURE_CONFLICT'},409);
 if(!same(current,await scope()))return reply({error:'수집 결과 확인 중 로그인 계정·회사가 변경되었습니다.',code:'QUERY_SCOPE_CHANGED'},409);
 return reply({...current,...saved,sourceStored:true,draftCreated:false});
 }catch(error){if(error instanceof ProductQueryError||error instanceof RequestBodyError)return reply({error:error.message,code:error instanceof ProductQueryError?error.code:'INVALID_QUERY_REQUEST'},error.status);
 if(error instanceof QuerySourceCaptureConflict)return reply({error:error.message,code:'QUERY_CAPTURE_CONFLICT'},409);
 return reply({error:'수집 저장 여부를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.',code:'QUERY_CAPTURE_UNCERTAIN'},503);}}

/** Recoverable visibility change only. Immutable source and linked products
 * are preserved; changing the revision invalidates previously pinned proofs. */
export async function PATCH(request:Request){try{
 const url=new URL(request.url);if(url.search||request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'로그인된 스튜디오에서 수집함을 변경해주세요.',code:'INVALID_QUERY_ORIGIN'},403);
 const current=await scope();if(!current)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);
 const body=await readBoundedJson(request,4096) as Record<string,unknown>;
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==5||Object.keys(body).some(key=>!['id','expectedRevision','action','expectedOwnerId','expectedCompany'].includes(key))
  ||typeof body.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)||!Number.isSafeInteger(body.expectedRevision)||Number(body.expectedRevision)<1||!['archive','restore'].includes(String(body.action)))return reply({error:'수집함 변경 요청을 확인해주세요.',code:'INVALID_QUERY_REQUEST'},400);
 const company=body.expectedCompany;if(!company||typeof company!=='object'||Array.isArray(company)||Object.keys(company).length!==2||Object.keys(company).some(key=>!['code','name'].includes(key))||body.expectedOwnerId!==current.ownerId
  ||(company as SupplierHubCompany).code!==current.company.code||(company as SupplierHubCompany).name!==current.company.name)return reply({error:'로그인 계정·회사가 변경되었습니다.',code:'QUERY_SCOPE_CHANGED'},409);
 if(request.signal.aborted)return reply({error:'수집함 변경을 취소했습니다.',code:'SOURCE_QUERY_CANCELLED'},409);
 const item=body.action==='archive'?await archiveQuerySourceCapture(current.ownerId,body.id,Number(body.expectedRevision),current.company):await restoreQuerySourceCapture(current.ownerId,body.id,Number(body.expectedRevision),current.company);
 if(!item)return reply({error:'수집본 버전 또는 수집함 보관 한도가 변경되었습니다. 목록을 다시 확인해주세요.',code:'QUERY_CAPTURE_CONFLICT'},409);
 if(!same(current,await scope()))return reply({error:'로그인 계정·회사가 변경되었습니다.',code:'QUERY_SCOPE_CHANGED'},409);
 return reply({...current,item:querySourceCaptureSummary(item),sourceStored:true,draftCreated:false});
 }catch(error){if(error instanceof RequestBodyError)return reply({error:error.message,code:'INVALID_QUERY_REQUEST'},error.status);
 return reply({error:'수집함 변경 여부를 확인하지 못했습니다. 목록을 다시 불러와주세요.',code:'QUERY_CAPTURE_UNCERTAIN'},503);}}
