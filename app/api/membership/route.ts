import {env} from 'cloudflare:workers';
import {NextResponse} from 'next/server';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {membersDb,memberColumns,createSession,rotateSession,sessionMaxAge,rateLimit,reviewMember,updateMemberCompany} from '@/db/members';
import {memberEmail,memberCompany,validPassword,verifyPassword,tokenHash,WORKSPACE_ACCOUNTS,workspaceAccount,matchesWorkspaceAccount,type WorkspaceMember} from '@/app/workspace-members';
import {readBoundedJson} from '@/app/request-body';
import {supplierHubCompany} from '@/app/supplier-hub-company';
const config=()=>env as {YOOFAM_AUTH_ENABLED?:string;YOOFAM_PASSWORD_PEPPER?:string};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
function sessionReply(request:Request,token:string,rememberMe:boolean){
 const response=reply({ok:true,rememberMe});
 response.cookies.set('yoofam_session',token,{httpOnly:true,secure:new URL(request.url).protocol==='https:',sameSite:'strict',path:'/',maxAge:sessionMaxAge(rememberMe)});
 return response;
}
export async function GET(){
 const user=await getChatGPTUser();
 if(!user?.membership)return reply({error:'로그인이 필요합니다.'},401);
 if(user.membership.role!=='admin')return reply({member:user.membership});
 const members=await membersDb().prepare(`SELECT ${memberColumns},created_at AS createdAt FROM members WHERE lower(trim(email)) IN (?,?) ORDER BY created_at DESC`).bind(...WORKSPACE_ACCOUNTS.map(account=>account.email)).all();
 return reply({member:user.membership,members:members.results});
}
export async function POST(request:Request){
 if(config().YOOFAM_AUTH_ENABLED!=='true')return reply({error:'회원 로그인 준비 중입니다.'},503);
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'같은 사이트에서 요청해주세요.'},403);
 try{
 const body=await readBoundedJson(request,8192) as Record<string,unknown>;
 if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'입력값을 확인해주세요.'},400);
 const action=body.action,db=membersDb();
 if((action==='login'||action==='remember-session')&&body.rememberMe!==undefined&&typeof body.rememberMe!=='boolean')return reply({error:'자동로그인 선택을 확인해주세요.'},400);
 const rememberMe=body.rememberMe!==false;
 if(action==='signup')return reply({error:'지정된 두 계정만 이용할 수 있습니다. 회원가입은 지원하지 않습니다.'},403);
 if(action==='login'){
  const email=memberEmail(body.email);validPassword(body.password);
  const ip=request.headers.get('cf-connecting-ip')??'local';
  if(!await rateLimit(`${action}:ip:${ip}`,30)||!await rateLimit(`${action}:email:${email}`,8))return reply({error:'요청이 많습니다. 15분 후 다시 시도해주세요.'},429);
  const pepper=config().YOOFAM_PASSWORD_PEPPER;
  if(!pepper||pepper.length<32)return reply({error:'로그인 서버 설정이 필요합니다.'},503);
  const member=await db.prepare(`SELECT ${memberColumns},password_hash AS passwordHash FROM members WHERE email=?`).bind(email).first<WorkspaceMember&{passwordHash:string}>();
  if(!member||!matchesWorkspaceAccount(member)||!await verifyPassword(body.password,member.passwordHash,pepper)||member.status!=='approved')return reply({error:'이메일·비밀번호 또는 계정 상태를 확인해주세요.'},401);
  const token=await createSession(member.id,rememberMe,member.passwordHash);
  return token?sessionReply(request,token,rememberMe):reply({error:'이메일·비밀번호 또는 가입 승인 상태를 확인해주세요.'},401);
 }
 const user=await getChatGPTUser();
 if(!user?.membership)return reply({error:'로그인이 필요합니다.'},401);
 if(action==='remember-session'){
  if(body.memberId!==undefined&&body.memberId!==user.userId)return reply({error:'본인의 로그인 설정만 변경할 수 있습니다.'},403);
  const token=await rotateSession(request.headers.get('cookie'),user.userId,rememberMe);
  return token?sessionReply(request,token,rememberMe):reply({error:'다시 로그인해주세요.'},401);
 }
 if(action==='logout'){
  const token=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('yoofam_session='))?.slice(15);
  if(token)await db.prepare('DELETE FROM member_sessions WHERE token_hash=?').bind(await tokenHash(token)).run();
  const response=reply({ok:true});response.cookies.set('yoofam_session','',{httpOnly:true,sameSite:'strict',secure:new URL(request.url).protocol==='https:',path:'/',maxAge:0});return response;
 }
 if(user.membership.role!=='admin')return reply({error:'관리자만 승인할 수 있습니다.'},403);
 if(action==='company'){
  const code=memberCompany(body.companyCode),name=memberCompany(body.companyName);
  if(!supplierHubCompany(code,name))return reply({error:'허용된 Supplier Hub 회사코드와 회사명을 함께 선택해주세요.'},400);
  const id=body.memberId===undefined?user.userId:body.memberId;
  if(typeof id!=='string'||!id||id.length>100)return reply({error:'수정할 계정을 선택해주세요.'},400);
  const target=await db.prepare('SELECT email,role FROM members WHERE id=?').bind(id).first<{email:string;role:string}>();
  if(!target)return reply({error:'계정을 찾을 수 없습니다.'},404);
  const account=workspaceAccount(target.email);
  if(!account||account.role!==target.role||account.companyCode!==code||account.companyName!==name)return reply({error:'이 계정에 지정된 회사는 변경할 수 없습니다.'},403);
  const changed=await updateMemberCompany(user.userId,id,code,name);
  return reply({ok:true,reauthenticate:changed&&id===user.userId});
 }
 if(!['approve','reject','suspend'].includes(String(action))||typeof body.memberId!=='string')return reply({error:'처리할 가입 요청을 선택해주세요.'},400);
 if(action==='approve'){
  const target=await db.prepare(`SELECT ${memberColumns} FROM members WHERE id=?`).bind(body.memberId).first<WorkspaceMember>();
  if(target&&!matchesWorkspaceAccount(target))return reply({error:'이 계정에 지정된 역할과 회사정보를 확인해주세요.'},400);
 }
 const changed=await reviewMember(user.userId,body.memberId,action as 'approve'|'reject'|'suspend');
 return changed?reply({ok:true}):reply({error:'지정된 계정과 처리 상태를 확인해주세요.'},409);
 }catch{return reply({error:'입력값을 확인하거나 잠시 후 다시 시도해주세요.'},400);}
}
