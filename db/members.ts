import {env} from 'cloudflare:workers';
import {newToken,tokenHash,WORKSPACE_ACCOUNTS,type WorkspaceMember} from '@/app/workspace-members';
export const memberColumns='id,email,role,status,company_code AS companyCode,company_name AS companyName';
// All aliases are internal literals. Keep identity checks in the mutation itself.
function accountCondition(alias=''){
 const column=(name:string)=>alias?`${alias}.${name}`:name;
 return `(${WORKSPACE_ACCOUNTS.map(()=>`(lower(trim(${column('email')}))=? AND ${column('role')}=? AND ${column('company_code')}=? AND ${column('company_name')}=?)`).join(' OR ')})`;
}
const accountValues=()=>WORKSPACE_ACCOUNTS.flatMap(account=>[account.email,account.role,account.companyCode,account.companyName]);
export function membersDb(){if(!env.DB)throw Error('회원 DB 연결이 필요합니다.');return env.DB;}
function sessionToken(cookie:string|null){
 const token=cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('yoofam_session='))?.slice(15);
 return token&&/^[a-f0-9]{64}$/.test(token)?token:null;
}
export const sessionMaxAge=(rememberMe=true)=>rememberMe?30*24*60*60:8*60*60;
export async function sessionMember(cookie:string|null):Promise<WorkspaceMember|null>{
 const token=sessionToken(cookie);if(!token)return null;
 return membersDb().prepare(`SELECT m.id,m.email,m.role,m.status,m.company_code AS companyCode,m.company_name AS companyName FROM member_sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND s.expires_at>? AND m.status='approved' AND ${accountCondition('m')}`).bind(await tokenHash(token),Date.now(),...accountValues()).first<WorkspaceMember>();
}
export async function createSession(id:string,rememberMe=true,expectedPasswordHash?:string){
 const token=newToken(),now=Date.now(),db=membersDb();const results=await db.batch([
 db.prepare('DELETE FROM member_sessions WHERE expires_at<=?').bind(now),
 db.prepare(`INSERT INTO member_sessions(token_hash,member_id,expires_at) SELECT ?,id,? FROM members WHERE id=? AND status='approved' AND ${accountCondition()} AND (? IS NULL OR password_hash=?)`).bind(await tokenHash(token),now+sessionMaxAge(rememberMe)*1000,id,...accountValues(),expectedPasswordHash??null,expectedPasswordHash??null)]);
 return results[1].meta.changes===1?token:null;
}
/** Rotate only the authenticated current session; the old token cannot be replayed. */
export async function rotateSession(cookie:string|null,id:string,rememberMe=true){
 const previous=sessionToken(cookie);if(!previous)return null;
 const token=newToken(),now=Date.now();
 const result=await membersDb().prepare(`UPDATE member_sessions SET token_hash=?,expires_at=? WHERE token_hash=? AND member_id=? AND expires_at>? AND EXISTS(SELECT 1 FROM members m WHERE m.id=member_sessions.member_id AND m.status='approved' AND ${accountCondition('m')})`).bind(await tokenHash(token),now+sessionMaxAge(rememberMe)*1000,await tokenHash(previous),id,now,...accountValues()).run();
 return result.meta.changes===1?token:null;
}
export async function rateLimit(key:string,maximum:number){
 const now=Date.now(),db=membersDb();
 const row=await db.prepare(`INSERT INTO member_rate_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts`).bind(await tokenHash(key),now+15*60*1000,now,now).first<{attempts:number}>();
 return !!row&&row.attempts<=maximum;
}
export async function reviewMember(actor:string,id:string,action:'approve'|'reject'|'suspend'){
 const db=membersDb(),status={approve:'approved',reject:'rejected',suspend:'suspended'}[action],now=new Date().toISOString();
 // Only the one designated member can be reviewed by the designated active admin.
 const results=await db.batch([
 db.prepare(`UPDATE members SET status=?,updated_at=?,reviewed_by=? WHERE id=? AND role='member' AND ${accountCondition()} AND EXISTS(SELECT 1 FROM members a WHERE a.id=? AND a.role='admin' AND a.status='approved' AND ${accountCondition('a')}) AND ((?='approve' AND status IN ('pending','rejected','suspended')) OR (?='reject' AND status='pending') OR (?='suspend' AND status='approved'))`).bind(status,now,actor,id,...accountValues(),actor,...accountValues(),action,action,action),
 db.prepare(`INSERT INTO member_audit(id,actor_id,member_id,action,created_at) SELECT ?,?,?,?,? WHERE changes()=1`).bind(crypto.randomUUID(),actor,id,action,now),
 db.prepare(`DELETE FROM member_sessions WHERE member_id=? AND EXISTS(SELECT 1 FROM members WHERE id=? AND status<>'approved')`).bind(id,id)]);
 return results[0].meta.changes===1;
}

/** Company changes revoke prior sessions so an old company session cannot survive reassignment. */
export async function updateMemberCompany(actor:string,id:string,code:string,name:string){
 const account=WORKSPACE_ACCOUNTS.find(value=>value.companyCode===code&&value.companyName===name);if(!account)return false;
 const db=membersDb(),now=new Date().toISOString(),auditId=crypto.randomUUID();
 const results=await db.batch([
 db.prepare(`UPDATE members SET company_code=?,company_name=?,updated_at=?,reviewed_by=? WHERE id=? AND lower(trim(email))=? AND role=? AND EXISTS(SELECT 1 FROM members a WHERE a.id=? AND a.role='admin' AND a.status='approved' AND ${accountCondition('a')}) AND (company_code<>? OR company_name<>?)`).bind(code,name,now,actor,id,account.email,account.role,actor,...accountValues(),code,name),
 db.prepare(`INSERT INTO member_audit(id,actor_id,member_id,action,created_at) SELECT ?,?,?,?,? WHERE changes()=1`).bind(auditId,actor,id,'company',now),
 db.prepare(`DELETE FROM member_sessions WHERE member_id=? AND EXISTS(SELECT 1 FROM member_audit WHERE id=?)`).bind(id,auditId),
 ]);
 return results[0].meta.changes===1;
}
