import {env} from 'cloudflare:workers';
import {newToken,tokenHash,type WorkspaceMember} from '@/app/workspace-members';
import {SUPPLIER_HUB_COMPANIES,supplierHubCompany} from '@/app/supplier-hub-company';
export const memberColumns='id,email,role,status,company_code AS companyCode,company_name AS companyName';
export function membersDb(){if(!env.DB)throw Error('회원 DB 연결이 필요합니다.');return env.DB;}
function sessionToken(cookie:string|null){
 const token=cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('yoofam_session='))?.slice(15);
 return token&&/^[a-f0-9]{64}$/.test(token)?token:null;
}
export const sessionMaxAge=(rememberMe=true)=>rememberMe?30*24*60*60:8*60*60;
export async function sessionMember(cookie:string|null):Promise<WorkspaceMember|null>{
 const token=sessionToken(cookie);if(!token)return null;
 return membersDb().prepare(`SELECT m.id,m.email,m.role,m.status,m.company_code AS companyCode,m.company_name AS companyName FROM member_sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND s.expires_at>? AND m.status='approved'`).bind(await tokenHash(token),Date.now()).first<WorkspaceMember>();
}
export async function createSession(id:string,rememberMe=true){
 const token=newToken(),now=Date.now(),db=membersDb();const results=await db.batch([
 db.prepare('DELETE FROM member_sessions WHERE expires_at<=?').bind(now),
 db.prepare("INSERT INTO member_sessions(token_hash,member_id,expires_at) SELECT ?,id,? FROM members WHERE id=? AND status='approved'").bind(await tokenHash(token),now+sessionMaxAge(rememberMe)*1000,id)]);
 return results[1].meta.changes===1?token:null;
}
/** Rotate only the authenticated current session; the old token cannot be replayed. */
export async function rotateSession(cookie:string|null,id:string,rememberMe=true){
 const previous=sessionToken(cookie);if(!previous)return null;
 const token=newToken(),now=Date.now();
 const result=await membersDb().prepare(`UPDATE member_sessions SET token_hash=?,expires_at=? WHERE token_hash=? AND member_id=? AND expires_at>? AND EXISTS(SELECT 1 FROM members m WHERE m.id=member_sessions.member_id AND m.status='approved')`).bind(await tokenHash(token),now+sessionMaxAge(rememberMe)*1000,await tokenHash(previous),id,now).run();
 return result.meta.changes===1?token:null;
}
export async function rateLimit(key:string,maximum:number){
 const now=Date.now(),db=membersDb();
 const row=await db.prepare(`INSERT INTO member_rate_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts`).bind(await tokenHash(key),now+15*60*1000,now,now).first<{attempts:number}>();
 return !!row&&row.attempts<=maximum;
}
export async function reviewMember(actor:string,id:string,action:'approve'|'reject'|'suspend'){
 const db=membersDb(),status={approve:'approved',reject:'rejected',suspend:'suspended'}[action],now=new Date().toISOString();
 const companyCondition=SUPPLIER_HUB_COMPANIES.map(()=>'(trim(company_code)=? AND trim(company_name)=?)').join(' OR ');
 const companyValues=SUPPLIER_HUB_COMPANIES.flatMap(company=>[company.code,company.name]);
 // Single conditional UPDATE makes the two-account limit safe under concurrent approvals.
 const results=await db.batch([
 db.prepare(`UPDATE members SET status=?,updated_at=?,reviewed_by=? WHERE id=? AND role='member' AND EXISTS(SELECT 1 FROM members WHERE id=? AND role='admin' AND status='approved') AND ((?='approve' AND status IN ('pending','rejected','suspended') AND (${companyCondition}) AND (SELECT count(*) FROM members WHERE status='approved')<2) OR (?='reject' AND status='pending') OR (?='suspend' AND status='approved'))`).bind(status,now,actor,id,actor,action,...companyValues,action,action),
 db.prepare(`INSERT INTO member_audit(id,actor_id,member_id,action,created_at) SELECT ?,?,?,?,? WHERE changes()=1`).bind(crypto.randomUUID(),actor,id,action,now),
 db.prepare(`DELETE FROM member_sessions WHERE member_id=? AND EXISTS(SELECT 1 FROM members WHERE id=? AND status<>'approved')`).bind(id,id)]);
 return results[0].meta.changes===1;
}

/** Company changes revoke prior sessions so an old company session cannot survive reassignment. */
export async function updateMemberCompany(actor:string,id:string,code:string,name:string){
 const company=supplierHubCompany(code,name);if(!company)return false;
 code=company.code;name=company.name;
 const db=membersDb(),now=new Date().toISOString(),auditId=crypto.randomUUID();
 const results=await db.batch([
 db.prepare(`UPDATE members SET company_code=?,company_name=?,updated_at=?,reviewed_by=? WHERE id=? AND EXISTS(SELECT 1 FROM members WHERE id=? AND role='admin' AND status='approved') AND (company_code<>? OR company_name<>?)`).bind(code,name,now,actor,id,actor,code,name),
 db.prepare(`INSERT INTO member_audit(id,actor_id,member_id,action,created_at) SELECT ?,?,?,?,? WHERE changes()=1`).bind(auditId,actor,id,'company',now),
 db.prepare(`DELETE FROM member_sessions WHERE member_id=? AND EXISTS(SELECT 1 FROM member_audit WHERE id=?)`).bind(id,auditId),
 ]);
 return results[0].meta.changes===1;
}
