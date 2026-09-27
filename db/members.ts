import {env} from 'cloudflare:workers';
import {newToken,tokenHash,type WorkspaceMember} from '@/app/workspace-members';
export const memberColumns='id,email,role,status,company_code AS companyCode,company_name AS companyName';
export function membersDb(){if(!env.DB)throw Error('회원 DB 연결이 필요합니다.');return env.DB;}
export async function sessionMember(cookie:string|null):Promise<WorkspaceMember|null>{
 const token=cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('yoofam_session='))?.slice(15);
 if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
 return membersDb().prepare(`SELECT m.id,m.email,m.role,m.status,m.company_code AS companyCode,m.company_name AS companyName FROM member_sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND s.expires_at>? AND m.status='approved'`).bind(await tokenHash(token),Date.now()).first<WorkspaceMember>();
}
export async function createSession(id:string){
 const token=newToken();await membersDb().batch([
 membersDb().prepare('DELETE FROM member_sessions WHERE expires_at<=?').bind(Date.now()),
 membersDb().prepare('INSERT INTO member_sessions(token_hash,member_id,expires_at) VALUES(?,?,?)').bind(await tokenHash(token),id,Date.now()+8*60*60*1000)]);
 return token;
}
export async function rateLimit(key:string,maximum:number){
 const now=Date.now(),db=membersDb();
 const row=await db.prepare(`INSERT INTO member_rate_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts`).bind(await tokenHash(key),now+15*60*1000,now,now).first<{attempts:number}>();
 return !!row&&row.attempts<=maximum;
}
export async function reviewMember(actor:string,id:string,action:'approve'|'reject'|'suspend'){
 const db=membersDb(),status={approve:'approved',reject:'rejected',suspend:'suspended'}[action],now=new Date().toISOString();
 // Single conditional UPDATE makes the two-account limit safe under concurrent approvals.
 const results=await db.batch([
 db.prepare(`UPDATE members SET status=?,updated_at=?,reviewed_by=? WHERE id=? AND role='member' AND EXISTS(SELECT 1 FROM members WHERE id=? AND role='admin' AND status='approved') AND ((?='approve' AND status='pending' AND (SELECT count(*) FROM members WHERE status='approved')<2) OR (?='reject' AND status='pending') OR (?='suspend' AND status='approved'))`).bind(status,now,actor,id,actor,action,action,action),
 db.prepare(`INSERT INTO member_audit(id,actor_id,member_id,action,created_at) SELECT ?,?,?,?,? WHERE changes()=1`).bind(crypto.randomUUID(),actor,id,action,now),
 db.prepare(`DELETE FROM member_sessions WHERE member_id=? AND EXISTS(SELECT 1 FROM members WHERE id=? AND status<>'approved')`).bind(id,id)]);
 return results[0].meta.changes===1;
}
