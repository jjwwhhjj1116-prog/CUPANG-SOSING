import {NextResponse} from 'next/server';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {readBoundedJson} from '@/app/request-body';
import {MemberSecurityError,saveSmsConfiguration,smsConfigurationInput,smsSettingsView} from '@/app/member-sms';
import {securityMember,verifyCurrentPassword} from '@/db/member-security';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
async function actor(){const user=await getChatGPTUser();if(!user?.verifiedAccess||user.membership?.role!=='admin'||user.userId!==user.membership.id)return null;const member=await securityMember(user.userId);return member?.role==='admin'?member:null;}
export async function GET(){try{const member=await actor();return member?reply({ownerId:member.id,...await smsSettingsView()}):reply({error:'관리자 로그인이 필요합니다.'},403);}catch{return reply({error:'문자 서비스 설정을 확인하지 못했습니다.'},503);}}
export async function POST(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'같은 사이트에서 요청해주세요.'},403);
 try{const member=await actor();if(!member)return reply({error:'관리자 로그인이 필요합니다.'},403);const body=await readBoundedJson(request,4096) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!==['expectedOwnerId','currentPassword','apiKey','apiSecret','sender'].sort().join(','))throw new MemberSecurityError(400,'문자 연결 항목을 확인해주세요.');
  if(body.expectedOwnerId!==member.id)throw new MemberSecurityError(409,'로그인 계정이 변경됐습니다. 다시 열어주세요.');
  await verifyCurrentPassword(member,body.currentPassword);const configuration=smsConfigurationInput(body);await saveSmsConfiguration(member.id,member.credentialVersion,configuration);return reply({ok:true,ownerId:member.id,...await smsSettingsView()});
 }catch(error){return reply({error:error instanceof MemberSecurityError?error.message:'문자 서비스 설정을 저장하지 못했습니다.'},error instanceof MemberSecurityError?error.status:400);}
}
