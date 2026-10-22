import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany,type SupplierHubCompany} from '@/app/supplier-hub-company';
import {listCategoryProfiles} from '@/db/category-profiles';
import {findCollectionJob} from '@/db/collection-jobs';
import {verifyCapturedCollectionCompany,CollectionCompanyError} from '@/app/collection-company';

type Scope={ownerId:string;company:SupplierHubCompany};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const same=(a:Scope,b:Scope|null)=>Boolean(b&&a.ownerId===b.ownerId&&a.company.code===b.company.code&&a.company.name===b.company.name);
async function current():Promise<Scope|null>{
 const user=await getChatGPTUser(),company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;
 if(!company||!user?.verifiedAccess||user.userId!==await getWorkspaceOwnerId())return null;
 return{ownerId:user.userId,company};
}
function expectedScope(request:Request):Scope{
 const raw=request.headers.get('x-yoofam-cli-scope');if(!raw||raw.length>2000)throw Error('scope');
 const value=JSON.parse(decodeURIComponent(raw));
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||typeof value.ownerId!=='string'||!value.ownerId||value.ownerId.length>256||!value.company||typeof value.company!=='object'||Array.isArray(value.company)||Object.keys(value.company).length!==2||typeof value.company.code!=='string'||typeof value.company.name!=='string'||!((value.company.code==='A01526306'&&value.company.name==='유앤채')||(value.company.code==='A01464742'&&value.company.name==='와이홉')))throw Error('scope');
 return{ownerId:value.ownerId,company:{code:value.company.code,name:value.company.name}};
}
/** Explicit-owner reads keep a transient account change from reading another
 * company's data even if that account changes back before the final check. */
export async function GET(request:Request){
 try{
  const active=await current();if(!active)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);
  let expected:Scope;try{expected=expectedScope(request);}catch{return reply({error:'CLI 연결 계정·회사를 확인해주세요.',code:'CLI_SCOPE_REQUIRED'},400);}
  if(!same(expected,active))return reply({error:'CLI 연결 계정·회사가 변경되었습니다.',code:'QUERY_SCOPE_CHANGED'},409);
  const query=new URL(request.url).searchParams,resource=query.get('resource');
  if(query.getAll('resource').length!==1||[...query.keys()].some(key=>!['resource','jobId'].includes(key)))return reply({error:'허용된 CLI 조회 경로를 확인해주세요.'},400);
  let result:Record<string,unknown>;
  if(resource==='category-profiles'&&!query.has('jobId')){
   const rows=await listCategoryProfiles(expected.ownerId,'');const profiles=rows.slice(0,100);
   result={profiles,nextCursor:rows.length>100?profiles.at(-1)!.id:null};
  }else if(resource==='collection-job'&&query.getAll('jobId').length===1&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(query.get('jobId')??'')){
   const job=await findCollectionJob(expected.ownerId,query.get('jobId')!);
   if(!job)return reply({error:'이 계정의 수집 요청을 찾을 수 없습니다.'},404);
   verifyCapturedCollectionCompany(job.context,expected.company);result={job};
  }else return reply({error:'허용된 CLI 조회 경로를 확인해주세요.'},400);
  if(request.signal.aborted)return reply({error:'CLI 조회를 취소했습니다.'},409);
  if(!same(expected,await current()))return reply({error:'CLI 연결 계정·회사가 변경되어 결과를 전달하지 않았습니다.',code:'QUERY_SCOPE_CHANGED'},409);
  return reply({...expected,...result});
 }catch(error){return reply({error:error instanceof CollectionCompanyError?error.message:'CLI 읽기 결과를 확인하지 못했습니다.',code:error instanceof CollectionCompanyError?error.code:'CLI_READ_UNAVAILABLE'},error instanceof CollectionCompanyError?409:503);}
}
