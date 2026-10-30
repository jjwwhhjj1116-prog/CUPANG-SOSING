import {NextResponse} from 'next/server';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {readBoundedJson} from '@/app/request-body';
import {MemberSecurityError,readSmsConfiguration} from '@/app/member-sms';
import {securityMember,securityProfile,startPhoneEnrollment,updateSecurityProfile,verifyPhoneEnrollment} from '@/db/member-security';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
async function actor(){const user=await getChatGPTUser();return user?.verifiedAccess&&user.membership?.id===user.userId?securityMember(user.userId):null;}
export async function GET(){try{const member=await actor();if(!member)return reply({error:'로그인이 필요합니다.'},401);return reply({ownerId:member.id,profile:securityProfile(member),smsConfigured:!!await readSmsConfiguration()});}catch{return reply({error:'계정 정보를 확인하지 못했습니다.'},503);}}
export async function POST(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'같은 사이트에서 요청해주세요.'},403);
 try{
  const member=await actor();if(!member)return reply({error:'로그인이 필요합니다.'},401);
  const body=await readBoundedJson(request,4096) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body))throw new MemberSecurityError(400,'입력값을 확인해주세요.');
  if(body.expectedOwnerId!==member.id)throw new MemberSecurityError(409,'로그인 계정이 변경됐습니다. 계정 정보를 다시 열어주세요.');
  const fields=body.action==='update-profile'?['name']:body.action==='phone-start'?['phone','currentPassword']:body.action==='phone-verify'?['challengeId','code']:null;
  if(!fields||Object.keys(body).sort().join(',')!==['action','expectedOwnerId',...fields].sort().join(','))throw new MemberSecurityError(400,'입력 항목을 확인해주세요.');
  if(body.action==='update-profile')return reply({ok:true,ownerId:member.id,profile:await updateSecurityProfile(member,body.name)});
  if(body.action==='phone-start')return reply(await startPhoneEnrollment(member,body.phone,body.currentPassword,request.headers.get('cf-connecting-ip')??'local'));
  const result=await verifyPhoneEnrollment(member.id,body.challengeId,body.code),response=reply(result);response.cookies.set('yoofam_session','',{httpOnly:true,secure:new URL(request.url).protocol==='https:',sameSite:'strict',path:'/',maxAge:0});return response;
 }catch(error){return reply({error:error instanceof MemberSecurityError?error.message:'입력값을 확인하거나 잠시 후 다시 시도해주세요.'},error instanceof MemberSecurityError?error.status:400);}
}
