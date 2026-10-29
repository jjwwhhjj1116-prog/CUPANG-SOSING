import {env} from 'cloudflare:workers';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {matchesWorkspaceAccount} from '@/app/workspace-members';
import {supplierHubCompany} from '@/app/supplier-hub-company';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {MemberConnectionsError,memberCredentialKey,memberConnectionInput,sealMemberCredential,type MemberConnectionScope} from '@/app/member-connections';
import {readMemberConnections,writeMemberConnection} from '@/db/member-connections';

const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','pragma':'no-cache'}});
async function scope():Promise<MemberConnectionScope>{
 let ownerId:string;try{ownerId=await getWorkspaceOwnerId();}catch{throw new MemberConnectionsError(401,'MEMBER_CONNECTIONS_AUTH','승인된 회원 계정으로 로그인해주세요.');}
 const user=await getChatGPTUser(),member=user?.membership;
 if(!user?.verifiedAccess||!member)throw new MemberConnectionsError(401,'MEMBER_CONNECTIONS_AUTH','승인된 회원 계정으로 로그인해주세요.');
 const company=supplierHubCompany(member.companyCode,member.companyName);
 if(member.status!=='approved'||member.id!==ownerId||user.userId!==ownerId||member.email!==user.email||!matchesWorkspaceAccount(member)||!company)
  throw new MemberConnectionsError(403,'MEMBER_CONNECTIONS_AUTH','이 회원·회사에서는 연동 계정을 사용할 수 없습니다.');
 return{ownerId,company,email:member.email.trim().toLowerCase(),role:member.role};
}
const key=()=>memberCredentialKey((env as {YOOFAM_CREDENTIAL_ENCRYPTION_KEY?:string}).YOOFAM_CREDENTIAL_ENCRYPTION_KEY);
const view=async(current:MemberConnectionScope)=>({ownerId:current.ownerId,company:current.company,profiles:await readMemberConnections(current)});
function failure(error:unknown){
 if(error instanceof MemberConnectionsError)return reply({code:error.code,error:error.message},error.status);
 if(error instanceof RequestBodyError)return reply({code:'MEMBER_CONNECTIONS_INPUT',error:error.message},error.status);
 return reply({code:'MEMBER_CONNECTIONS_UNAVAILABLE',error:'연동 계정의 처리 결과를 확인하지 못했습니다. 목록을 다시 불러와주세요.'},503);
}
export async function GET(request:Request){
 try{const current=await scope();await key();if(new URL(request.url).search)throw new MemberConnectionsError(400,'MEMBER_CONNECTIONS_INPUT','연동 계정 목록 주소를 확인해주세요.');return reply(await view(current));}catch(error){return failure(error);}
}
export async function POST(request:Request){
 try{
  if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw new MemberConnectionsError(403,'MEMBER_CONNECTIONS_CSRF','같은 사이트의 계정 관리에서 요청해주세요.');
  const current=await scope(),encryptionKey=await key(),input=memberConnectionInput(await readBoundedJson(request,8192),current);
  const sealed=input.action==='save'&&input.password!==''?await sealMemberCredential(encryptionKey,current,input.id,input.service,input.password):null;
  if(JSON.stringify(await scope())!==JSON.stringify(current))throw new MemberConnectionsError(409,'MEMBER_CONNECTIONS_SCOPE','로그인 회원·회사가 변경되었습니다. 목록을 다시 불러와주세요.');
  await writeMemberConnection(current,input,sealed);return reply(await view(current));
 }catch(error){return failure(error);}
}
