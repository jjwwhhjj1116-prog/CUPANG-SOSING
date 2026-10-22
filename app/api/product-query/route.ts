import {env} from 'cloudflare:workers';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany,type SupplierHubCompany} from '@/app/supplier-hub-company';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {ProductQueryError,productQueryService,queryProductSource} from '@/app/product-query';

const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
type Scope={ownerId:string;company:SupplierHubCompany};
async function scope():Promise<Scope|null>{
  const user=await getChatGPTUser(),company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;
  if(!company||!user?.verifiedAccess||user.userId!==await getWorkspaceOwnerId())return null;
  return {ownerId:user.userId,company};
}
const same=(a:Scope,b:Scope|null)=>Boolean(b&&a.ownerId===b.ownerId&&a.company.code===b.company.code&&a.company.name===b.company.name);

export async function GET(){
  try{const current=await scope();if(!current)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);
    return reply({...current,service:productQueryService(env as unknown as Record<string,unknown>)});
  }catch{return reply({error:'상품조회 서버 연결 상태를 확인하지 못했습니다.'},503);}
}

export async function POST(request:Request){
  try{
    const url=new URL(request.url);
    if(url.search||request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'로그인된 YOOFAM 앱에서 상품조회를 요청해주세요.',code:'INVALID_QUERY_ORIGIN'},403);
    const current=await scope();if(!current)return reply({error:'승인된 회사 계정으로 로그인해주세요.'},401);
    const body=await readBoundedJson(request,4096) as Record<string,unknown>;
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==3||Object.keys(body).some(key=>!['sourceUrl','expectedOwnerId','expectedCompany'].includes(key)))return reply({error:'상품조회 요청 형식을 확인해주세요.',code:'INVALID_QUERY_REQUEST'},400);
    const company=body.expectedCompany;
    if(!company||typeof company!=='object'||Array.isArray(company)||Object.keys(company).length!==2||Object.keys(company).some(key=>!['code','name'].includes(key))||body.expectedOwnerId!==current.ownerId||(company as SupplierHubCompany).code!==current.company.code||(company as SupplierHubCompany).name!==current.company.name)return reply({error:'상품조회 중 로그인 계정·회사가 변경되었습니다.',code:'QUERY_SCOPE_CHANGED'},409);
    const result=await queryProductSource(body.sourceUrl,env as unknown as Record<string,unknown>,{signal:request.signal});
    if(!same(current,await scope()))return reply({error:'상품조회 중 로그인 계정·회사가 변경되었습니다. 결과를 전달하지 않았습니다.',code:'QUERY_SCOPE_CHANGED'},409);
    if(request.signal.aborted)return reply({error:'상품조회를 취소했습니다.',code:'SOURCE_QUERY_CANCELLED'},409);
    return reply({...current,...result});
  }catch(error){
    if(error instanceof ProductQueryError||error instanceof RequestBodyError)return reply({error:error.message,code:error instanceof ProductQueryError?error.code:'INVALID_QUERY_REQUEST'},error.status);
    return reply({error:'상품조회 응답을 확인하지 못했습니다. 기존 작업 상품은 변경하지 않았습니다.',code:'QUERY_UNAVAILABLE'},503);
  }
}
