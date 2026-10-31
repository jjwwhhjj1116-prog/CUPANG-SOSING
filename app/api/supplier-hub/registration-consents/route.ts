import {env} from 'cloudflare:workers';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {matchesWorkspaceAccount} from '@/app/workspace-members';
import {supplierHubCompany} from '@/app/supplier-hub-company';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {MemberRegistrationConsentsError,memberRegistrationConsentInput,validateMemberRegistrationConsentsView,type MemberRegistrationConsentScope} from '@/app/member-registration-consents';
import {readMemberConnections} from '@/db/member-connections';
import {readMemberRegistrationConsents,writeMemberRegistrationConsent} from '@/db/member-registration-consents';

const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','pragma':'no-cache'}});
async function scope():Promise<MemberRegistrationConsentScope>{
 let ownerId:string;try{ownerId=await getWorkspaceOwnerId();}catch{throw new MemberRegistrationConsentsError(401,'REGISTRATION_CONSENTS_AUTH','승인된 회원 계정으로 로그인해주세요.');}
 const user=await getChatGPTUser(),member=user?.membership,company=supplierHubCompany(member?.companyCode,member?.companyName);
 if(!user?.verifiedAccess||!member)throw new MemberRegistrationConsentsError(401,'REGISTRATION_CONSENTS_AUTH','승인된 회원 계정으로 로그인해주세요.');
 if(member.status!=='approved'||member.id!==ownerId||user.userId!==ownerId||member.email!==user.email||!matchesWorkspaceAccount(member)||!company)
  throw new MemberRegistrationConsentsError(403,'REGISTRATION_CONSENTS_AUTH','현재 회원·회사에서 사용할 수 있는 등록전송 설정을 확인해주세요.');
 const row=await env.DB?.prepare(`SELECT credential_version AS version FROM members WHERE id=? AND lower(trim(email))=? AND role=? AND status='approved' AND company_code=? AND company_name=?`)
  .bind(ownerId,member.email.trim().toLowerCase(),member.role,company.code,company.name).first<{version:number}>();
 if(!row||!Number.isSafeInteger(row.version)||row.version<0)throw new MemberRegistrationConsentsError(409,'REGISTRATION_CONSENTS_CHANGED','현재 회원의 승인·인증 상태를 다시 확인해주세요.');
 return {ownerId,company,actor:{email:member.email.trim().toLowerCase(),role:member.role,credentialVersion:row.version}};
}
async function view(current:MemberRegistrationConsentScope){
 const connectionScope={ownerId:current.ownerId,company:current.company,email:current.actor.email,role:current.actor.role};
 const [connections,policies]=await Promise.all([readMemberConnections(connectionScope),readMemberRegistrationConsents(current)]);
 const result=await validateMemberRegistrationConsentsView({format:'yoofam-member-registration-consents-v1',ownerId:current.ownerId,company:current.company,actor:current.actor,connections,policies},current);
 // These are separate reads. A connection disabled or revised after the first
 // metadata snapshot must not pair with an old policy as a current approval.
 if(JSON.stringify(await readMemberConnections(connectionScope))!==JSON.stringify(connections))throw new MemberRegistrationConsentsError(409,'REGISTRATION_CONSENTS_CHANGED','설정을 불러오는 동안 연동 계정이 변경되었습니다. 다시 확인해주세요.');
 if(JSON.stringify(await scope())!==JSON.stringify(current))throw new MemberRegistrationConsentsError(409,'REGISTRATION_CONSENTS_CHANGED','설정을 불러오는 동안 회원·회사가 변경되었습니다.');
 return result;
}
function failure(error:unknown){
 if(error instanceof MemberRegistrationConsentsError)return reply({code:error.code,error:error.message},error.status);
 if(error instanceof RequestBodyError)return reply({code:'REGISTRATION_CONSENTS_INPUT',error:error.message},error.status);
 return reply({code:'REGISTRATION_CONSENTS_UNAVAILABLE',error:'등록전송 동의 설정을 확인하지 못했습니다. 현재 설정을 다시 불러와주세요.'},503);
}
export async function GET(request:Request){
 try{if(new URL(request.url).search)throw new MemberRegistrationConsentsError(400,'REGISTRATION_CONSENTS_INPUT','동의 설정 목록 주소를 확인해주세요.');const current=await scope();return reply(await view(current));}catch(error){return failure(error);}
}
export async function POST(request:Request){
 try{
  if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw new MemberRegistrationConsentsError(403,'REGISTRATION_CONSENTS_CSRF','같은 사이트의 회원 설정에서 요청해주세요.');
  const current=await scope(),input=await memberRegistrationConsentInput(await readBoundedJson(request,64*1024),current);
  if(JSON.stringify(await scope())!==JSON.stringify(current))throw new MemberRegistrationConsentsError(409,'REGISTRATION_CONSENTS_CHANGED','확인 중 회원·회사가 변경되었습니다.');
  await writeMemberRegistrationConsent(current,input);return reply(await view(current));
 }catch(error){return failure(error);}
}
