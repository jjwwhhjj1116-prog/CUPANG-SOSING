import {env} from 'cloudflare:workers';
import {memberColumns,membersDb,rateLimit} from '@/db/members';
import {matchesWorkspaceAccount,memberLoginId,memberName,newToken,normalizeMemberPhone,passwordHash,tokenHash,validPassword,verifyPassword,type WorkspaceMember} from '@/app/workspace-members';
import {MemberSecurityError,readSmsConfiguration,sendVerificationSms,type SmsConfiguration} from '@/app/member-sms';

type SecurityMember=WorkspaceMember&{passwordHash:string;credentialVersion:number};
type Purpose='enroll'|'find-id'|'reset-password';
type Challenge={id:string;purpose:Purpose;member_id:string|null;phone_number:string;credential_version:number;code_hash:string;state:string;attempts:number;expires_at:number;reset_token_hash:string|null;reset_expires_at:number|null};
const invalid=()=>new MemberSecurityError(400,'인증번호가 올바르지 않거나 만료됐습니다. 인증문자를 다시 요청해주세요.');
const idValid=(id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const pepper=()=>{const value=(env as {YOOFAM_PASSWORD_PEPPER?:string}).YOOFAM_PASSWORD_PEPPER;if(!value||value.length<32)throw new MemberSecurityError(503,'계정 인증 서버 설정을 확인해주세요.');return value;};
async function codeHash(id:string,purpose:Purpose,code:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pepper()),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(['yoofam-phone-code-v1',id,purpose,code])))),b=>b.toString(16).padStart(2,'0')).join('');}
function equalSecret(a:string,b:string){let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
function otp(){const range=Math.floor(0x100000000/1000000)*1000000;let n:number;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=range);return String(n%1000000).padStart(6,'0');}
export async function securityMember(id:string){const member=await membersDb().prepare(`SELECT ${memberColumns},password_hash AS passwordHash,credential_version AS credentialVersion FROM members WHERE id=? AND status='approved'`).bind(id).first<SecurityMember>();return member&&matchesWorkspaceAccount(member)?member:null;}
export function securityProfile(member:WorkspaceMember){return {name:member.name??'',phoneNumber:member.phoneNumber??'',phoneVerifiedAt:member.phoneVerifiedAt??null};}
export async function verifyCurrentPassword(member:SecurityMember,current:unknown){
 if(!await rateLimit('password-confirm:'+member.id,8))throw new MemberSecurityError(429,'요청이 많습니다. 잠시 후 다시 시도해주세요.');
 validPassword(current);if(!await verifyPassword(current,member.passwordHash,pepper()))throw new MemberSecurityError(400,'현재 비밀번호를 확인해주세요.');
}
async function smsLimits(phone:string,ip:string,memberId?:string){
 if(!await rateLimit('phone-ip:'+ip,20)||!await rateLimit('phone-number:'+phone,5)||memberId&&!await rateLimit('phone-member:'+memberId,5))throw new MemberSecurityError(429,'인증 요청이 많습니다. 잠시 후 다시 시도해주세요.');
 const now=Date.now(),key=await tokenHash('yoofam-sms-cooldown:'+phone);
 const row=await membersDb().prepare('INSERT INTO member_phone_send_locks(key_hash,next_send_at) VALUES(?,?) ON CONFLICT(key_hash) DO UPDATE SET next_send_at=excluded.next_send_at WHERE next_send_at<=? RETURNING key_hash').bind(key,now+60000,now).first();
 if(!row)throw new MemberSecurityError(429,'인증문자는 1분 후 다시 요청할 수 있습니다.');
}
async function createChallenge(purpose:Purpose,member:SecurityMember|null,phone:string){
 const id=crypto.randomUUID(),code=otp(),now=Date.now(),db=membersDb();
 await db.batch([
  db.prepare('DELETE FROM member_phone_challenges WHERE expires_at<? AND (reset_expires_at IS NULL OR reset_expires_at<?)').bind(now-86400000,now-86400000),
  db.prepare("UPDATE member_phone_challenges SET state='failed',reset_token_hash=NULL WHERE phone_number=? AND purpose=? AND state IN ('sending','active','verified')").bind(phone,purpose),
  db.prepare("INSERT INTO member_phone_challenges(id,purpose,member_id,phone_number,credential_version,code_hash,state,created_at,expires_at) VALUES(?,?,?,?,?,?,'sending',?,?)").bind(id,purpose,member?.id??null,phone,member?.credentialVersion??-1,await codeHash(id,purpose,code),now,now+5*60000),
 ]);
 return {id,code};
}
async function dispatchChallenge(configuration:SmsConfiguration,challenge:{id:string;code:string},phone:string,deliver:boolean){
 try{if(deliver)await sendVerificationSms(configuration,phone,challenge.code);await membersDb().prepare("UPDATE member_phone_challenges SET state='active' WHERE id=? AND state='sending' AND expires_at>?").bind(challenge.id,Date.now()).run();}
 catch(error){await membersDb().prepare("UPDATE member_phone_challenges SET state='failed' WHERE id=? AND state='sending'").bind(challenge.id).run();throw error;}
}
async function requiredSms(){const configuration=await readSmsConfiguration();if(!configuration)throw new MemberSecurityError(503,'휴대폰 인증 준비 중입니다. 관리자에게 SOLAPI 연결을 요청해주세요.');return configuration;}
export async function updateSecurityProfile(member:SecurityMember,name:unknown){
 const clean=memberName(name),result=await membersDb().prepare("UPDATE members SET full_name=?,updated_at=? WHERE id=? AND status='approved' AND credential_version=?").bind(clean,new Date().toISOString(),member.id,member.credentialVersion).run();
 if(result.meta.changes!==1)throw new MemberSecurityError(409,'계정이 변경됐습니다. 다시 로그인해주세요.');
 return {...securityProfile(member),name:clean};
}
export async function startPhoneEnrollment(member:SecurityMember,phoneInput:unknown,currentPassword:unknown,ip:string){
 await verifyCurrentPassword(member,currentPassword);const phone=normalizeMemberPhone(phoneInput),configuration=await requiredSms();await smsLimits(phone,ip,member.id);
 const challenge=await createChallenge('enroll',member,phone);await dispatchChallenge(configuration,challenge,phone,true);
 return {challengeId:challenge.id,message:'인증문자를 요청했습니다. 5분 안에 입력해주세요.'};
}
async function verifiedChallenge(id:unknown,code:unknown,purposes:Purpose[],ownerId?:string){
 if(!idValid(id)||typeof code!=='string'||!/^\d{6}$/.test(code))throw invalid();
 const now=Date.now(),db=membersDb();
 const row=await db.prepare(`UPDATE member_phone_challenges SET attempts=attempts+1 WHERE id=? AND state='active' AND expires_at>? AND attempts<5 AND purpose IN (${purposes.map(()=>'?').join(',')}) ${ownerId?'AND member_id=?':''} RETURNING *`).bind(id,now,...purposes,...(ownerId?[ownerId]:[])).first<Challenge>();
 if(!row||!equalSecret(row.code_hash,await codeHash(row.id,row.purpose,code))||!row.member_id)throw invalid();
 const member=await securityMember(row.member_id);
 if(!member||member.credentialVersion!==row.credential_version||row.purpose!=='enroll'&&(!member.phoneVerifiedAt||member.phoneNumber!==row.phone_number))throw invalid();
 const resetToken=row.purpose==='reset-password'?newToken():null;
 const changed=await db.prepare("UPDATE member_phone_challenges SET state='verified',verified_at=?,reset_token_hash=?,reset_expires_at=? WHERE id=? AND state='active' AND attempts=? AND expires_at>?").bind(now,resetToken?await tokenHash(resetToken):null,resetToken?now+5*60000:null,row.id,row.attempts,now).run();
 if(changed.meta.changes!==1)throw invalid();
 return {row,member,resetToken};
}
export async function verifyPhoneEnrollment(ownerId:string,id:unknown,code:unknown){
 const {row,member}=await verifiedChallenge(id,code,['enroll'],ownerId),db=membersDb(),now=new Date().toISOString(),auditId=crypto.randomUUID();
 try{
  const result=await db.batch([
   db.prepare("UPDATE members SET phone_number=?,phone_verified_at=?,credential_version=credential_version+1,updated_at=? WHERE id=? AND status='approved' AND credential_version=? AND EXISTS(SELECT 1 FROM member_phone_challenges c WHERE c.id=? AND c.member_id=members.id AND c.state='verified' AND c.purpose='enroll' AND c.expires_at>?)").bind(row.phone_number,now,now,ownerId,member.credentialVersion,row.id,Date.now()),
   db.prepare('INSERT INTO member_audit(id,actor_id,member_id,action,created_at) SELECT ?,?,?,?,? WHERE changes()=1').bind(auditId,ownerId,ownerId,'phone-verified',now),
   db.prepare("UPDATE member_phone_challenges SET state='consumed',reset_token_hash=NULL WHERE member_id=? AND EXISTS(SELECT 1 FROM member_audit WHERE id=?)").bind(ownerId,auditId),
   db.prepare('DELETE FROM member_sessions WHERE member_id=? AND EXISTS(SELECT 1 FROM member_audit WHERE id=?)').bind(ownerId,auditId),
  ]);
  if(result[0].meta.changes!==1)throw invalid();
 }catch(error){if(error instanceof MemberSecurityError)throw error;throw new MemberSecurityError(409,'휴대폰 번호를 등록하지 못했습니다. 다른 계정에 등록된 번호인지 확인해주세요.');}
 return {ok:true,reauthenticate:true,profile:{...securityProfile(member),phoneNumber:row.phone_number,phoneVerifiedAt:now}};
}
/** Public initiation always returns the same message; the provider dispatch runs after the response. */
export async function startAccountRecovery(input:Record<string,unknown>,ip:string){
 if(input.purpose!=='find-id'&&input.purpose!=='reset-password')throw new MemberSecurityError(400,'계정 찾기 종류를 확인해주세요.');
 const purpose=input.purpose,name=memberName(input.name),phone=normalizeMemberPhone(input.phone),loginId=purpose==='reset-password'?memberLoginId(input.loginId):null;
 const configuration=await requiredSms();await smsLimits(phone,ip);
 const candidate=await membersDb().prepare(`SELECT ${memberColumns},password_hash AS passwordHash,credential_version AS credentialVersion FROM members WHERE full_name=? AND phone_number=? AND phone_verified_at IS NOT NULL AND status='approved'`).bind(name,phone).first<SecurityMember>();
 const matchesLogin=candidate&&(loginId===null||loginId===(candidate.loginId??candidate.email)||candidate.registrationVersion!==1&&candidate.email.split('@')[0]===loginId);
 const member=candidate&&matchesLogin&&matchesWorkspaceAccount(candidate)?candidate:null;
 const challenge=await createChallenge(purpose,member,phone);
 const send=dispatchChallenge(configuration,challenge,phone,!!member).catch(()=>{/* Failed delivery stays unusable; never expose account existence or OTP. */});
 return {response:{challengeId:challenge.id,message:'입력한 정보와 일치하는 인증된 번호가 있으면 인증문자를 보냅니다. 5분 안에 입력해주세요.'},send};
}
export async function verifyAccountRecovery(id:unknown,code:unknown){
 const {row,member,resetToken}=await verifiedChallenge(id,code,['find-id','reset-password']);
 if(row.purpose==='reset-password')return {resetToken};
 const result=await membersDb().prepare("UPDATE member_phone_challenges SET state='consumed' WHERE id=? AND state='verified'").bind(row.id).run();if(result.meta.changes!==1)throw invalid();
 return {loginId:member.loginId??member.email};
}
export async function resetRecoveredPassword(token:unknown,password:unknown,ip:string){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw invalid();validPassword(password);
 if(!await rateLimit('password-reset-ip:'+ip,15)||!await rateLimit('password-reset-token:'+token,5))throw new MemberSecurityError(429,'요청이 많습니다. 잠시 후 다시 시도해주세요.');
 const db=membersDb(),now=Date.now(),tokenDigest=await tokenHash(token);
 const row=await db.prepare("SELECT * FROM member_phone_challenges WHERE reset_token_hash=? AND purpose='reset-password' AND state='verified' AND reset_expires_at>?").bind(tokenDigest,now).first<Challenge>();
 if(!row?.member_id)throw invalid();const member=await securityMember(row.member_id);if(!member||member.credentialVersion!==row.credential_version||!member.phoneVerifiedAt||member.phoneNumber!==row.phone_number)throw invalid();
 const hash=await passwordHash(password,pepper()),auditId=crypto.randomUUID(),timestamp=new Date().toISOString();
 const result=await db.batch([
  db.prepare("UPDATE members SET password_hash=?,credential_version=credential_version+1,updated_at=? WHERE id=? AND status='approved' AND credential_version=? AND phone_number=? AND phone_verified_at IS NOT NULL AND EXISTS(SELECT 1 FROM member_phone_challenges c WHERE c.id=? AND c.member_id=members.id AND c.state='verified' AND c.reset_token_hash=? AND c.reset_expires_at>?)").bind(hash,timestamp,member.id,row.credential_version,row.phone_number,row.id,tokenDigest,Date.now()),
  db.prepare('INSERT INTO member_audit(id,actor_id,member_id,action,created_at) SELECT ?,?,?,?,? WHERE changes()=1').bind(auditId,member.id,member.id,'password-reset',timestamp),
  db.prepare("UPDATE member_phone_challenges SET state='consumed',reset_token_hash=NULL WHERE member_id=? AND EXISTS(SELECT 1 FROM member_audit WHERE id=?)").bind(member.id,auditId),
  db.prepare('DELETE FROM member_sessions WHERE member_id=? AND EXISTS(SELECT 1 FROM member_audit WHERE id=?)').bind(member.id,auditId),
 ]);
 if(result[0].meta.changes!==1)throw invalid();return {ok:true,reauthenticate:true};
}
