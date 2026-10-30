import {waitUntil} from 'cloudflare:workers';
import {NextResponse} from 'next/server';
import {readBoundedJson} from '@/app/request-body';
import {MemberSecurityError} from '@/app/member-sms';
import {resetRecoveredPassword,startAccountRecovery,verifyAccountRecovery} from '@/db/member-security';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}});
export async function POST(request:Request){
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'같은 사이트에서 요청해주세요.'},403);
 try{
  const body=await readBoundedJson(request,4096) as Record<string,unknown>;if(!body||typeof body!=='object'||Array.isArray(body))throw new MemberSecurityError(400,'입력값을 확인해주세요.');
  const fields=body.action==='start'?['purpose','name','phone',...(body.purpose==='reset-password'?['loginId']:[])]:body.action==='verify'?['challengeId','code']:body.action==='reset'?['resetToken','newPassword']:null;
  if(!fields||Object.keys(body).sort().join(',')!==['action',...fields].sort().join(','))throw new MemberSecurityError(400,'입력 항목을 확인해주세요.');
  const ip=request.headers.get('cf-connecting-ip')??'local';
  if(body.action==='start'){if(typeof waitUntil!=='function')throw new MemberSecurityError(503,'휴대폰 인증 서버 준비 중입니다.');const result=await startAccountRecovery(body,ip);waitUntil(result.send);return reply(result.response);}
  if(body.action==='verify')return reply(await verifyAccountRecovery(body.challengeId,body.code));
  return reply(await resetRecoveredPassword(body.resetToken,body.newPassword,ip));
 }catch(error){return reply({error:error instanceof MemberSecurityError?error.message:'입력값을 확인하거나 잠시 후 다시 시도해주세요.'},error instanceof MemberSecurityError?error.status:400);}
}
