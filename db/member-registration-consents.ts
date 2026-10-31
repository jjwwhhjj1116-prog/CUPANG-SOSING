import {env} from 'cloudflare:workers';
import {MemberRegistrationConsentsError,type MemberRegistrationConsentInput,type MemberRegistrationConsentPolicy,type MemberRegistrationConsentScope} from '@/app/member-registration-consents';

export const memberRegistrationConsentsSchema=`CREATE TABLE IF NOT EXISTS member_registration_consents (
 owner_id TEXT NOT NULL,company_code TEXT NOT NULL,company_name TEXT NOT NULL,connection_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('price-data','label-contact')),connection_revision INTEGER NOT NULL CHECK(connection_revision>=1),
 revision INTEGER NOT NULL CHECK(revision>=1),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 terms_version TEXT NOT NULL,terms_sha256 TEXT NOT NULL,terms_payload TEXT NOT NULL,
 accepted_at TEXT NOT NULL,updated_at TEXT NOT NULL,actor_email TEXT NOT NULL,actor_role TEXT NOT NULL CHECK(actor_role IN ('admin','member')),
 actor_credential_version INTEGER NOT NULL CHECK(actor_credential_version>=0),PRIMARY KEY(owner_id,company_code,connection_id,kind)
)`;
const ready=new WeakSet<D1Database>();
async function database(){
 if(!env.DB)throw new MemberRegistrationConsentsError(503,'REGISTRATION_CONSENTS_STORAGE','등록전송 동의 설정 저장소를 확인하지 못했습니다.');
 if(!ready.has(env.DB)){await env.DB.prepare(memberRegistrationConsentsSchema).run();ready.add(env.DB);}return env.DB;
}
const conflict=():never=>{throw new MemberRegistrationConsentsError(409,'REGISTRATION_CONSENTS_CHANGED','회원·회사·연동 계정 또는 동의 설정이 변경되었습니다. 최신 설정을 다시 확인해주세요.');};
const memberSql=`EXISTS(SELECT 1 FROM members m WHERE m.id=? AND lower(trim(m.email))=? AND m.role=? AND m.status='approved' AND m.company_code=? AND m.company_name=? AND m.credential_version=?)`;
const memberArgs=(scope:MemberRegistrationConsentScope)=>[scope.ownerId,scope.actor.email,scope.actor.role,scope.company.code,scope.company.name,scope.actor.credentialVersion];
const connectionSql=(enabled:boolean)=>`EXISTS(SELECT 1 FROM member_connections c WHERE c.owner_id=? AND c.profile_id=? AND c.company_code=? AND c.company_name=? AND c.service='supplier-hub' AND c.revision=?${enabled?" AND c.enabled=1 AND length(c.password_ciphertext)>0":''})`;
const connectionArgs=(scope:MemberRegistrationConsentScope,input:MemberRegistrationConsentInput)=>[scope.ownerId,input.connectionId,scope.company.code,scope.company.name,input.expectedConnectionRevision];
const columns=`kind,connection_id AS connectionId,connection_revision AS connectionRevision,revision,enabled,terms_version AS termsVersion,terms_sha256 AS termsSha256,terms_payload AS termsPayload,accepted_at AS acceptedAt,updated_at AS updatedAt,actor_email AS actorEmail,actor_role AS actorRole,actor_credential_version AS actorCredentialVersion`;
type Row=Omit<MemberRegistrationConsentPolicy,'enabled'|'terms'|'actor'>&{enabled:number;termsPayload:string;actorEmail:string;actorRole:'admin'|'member';actorCredentialVersion:number};
function policy(row:Row):MemberRegistrationConsentPolicy{
 const {termsPayload,actorEmail,actorRole,actorCredentialVersion,...rest}=row;
 return {...rest,enabled:row.enabled===1,terms:JSON.parse(termsPayload),actor:{email:actorEmail,role:actorRole,credentialVersion:actorCredentialVersion}};
}
export async function readMemberRegistrationConsents(scope:MemberRegistrationConsentScope){
 const db=await database();if(!await db.prepare(`SELECT 1 AS valid WHERE ${memberSql}`).bind(...memberArgs(scope)).first())return conflict();
 const rows=await db.prepare(`SELECT ${columns} FROM member_registration_consents WHERE owner_id=? AND company_code=? AND company_name=? AND ${memberSql} ORDER BY connection_id,kind LIMIT 40`)
  .bind(scope.ownerId,scope.company.code,scope.company.name,...memberArgs(scope)).all<Row>();
 return rows.results.map(policy);
}
export async function writeMemberRegistrationConsent(scope:MemberRegistrationConsentScope,input:MemberRegistrationConsentInput){
 const db=await database(),now=new Date().toISOString();let row:Row|null;
 if(input.action==='save'&&input.expectedRevision===0){
  row=await db.prepare(`INSERT INTO member_registration_consents(owner_id,company_code,company_name,connection_id,kind,connection_revision,revision,enabled,terms_version,terms_sha256,terms_payload,accepted_at,updated_at,actor_email,actor_role,actor_credential_version)
   SELECT ?,?,?,?,?,?,1,1,?,?,?,?,?,?,?,? WHERE ${memberSql} AND ${connectionSql(true)}
   ON CONFLICT(owner_id,company_code,connection_id,kind) DO NOTHING RETURNING ${columns}`)
   .bind(scope.ownerId,scope.company.code,scope.company.name,input.connectionId,input.kind,input.expectedConnectionRevision,input.termsVersion,input.termsSha256,JSON.stringify(input.terms),now,now,scope.actor.email,scope.actor.role,scope.actor.credentialVersion,...memberArgs(scope),...connectionArgs(scope,input)).first<Row>();
 }else if(input.action==='save'){
  row=await db.prepare(`UPDATE member_registration_consents SET connection_revision=?,revision=revision+1,enabled=1,terms_version=?,terms_sha256=?,terms_payload=?,accepted_at=?,updated_at=?,actor_email=?,actor_role=?,actor_credential_version=?
   WHERE owner_id=? AND company_code=? AND company_name=? AND connection_id=? AND kind=? AND revision=? AND ${memberSql} AND ${connectionSql(true)} RETURNING ${columns}`)
   .bind(input.expectedConnectionRevision,input.termsVersion,input.termsSha256,JSON.stringify(input.terms),now,now,scope.actor.email,scope.actor.role,scope.actor.credentialVersion,scope.ownerId,scope.company.code,scope.company.name,input.connectionId,input.kind,input.expectedRevision,...memberArgs(scope),...connectionArgs(scope,input)).first<Row>();
 }else{
  // Withdrawal remains possible after a credential or connection revision
  // changes. Re-enabling cannot silently adopt that new account identity.
  const retained=input.enabled?' AND connection_revision=? AND actor_email=? AND actor_role=? AND actor_credential_version=?':'';
  row=await db.prepare(`UPDATE member_registration_consents SET enabled=?,revision=revision+1,updated_at=?
   WHERE owner_id=? AND company_code=? AND company_name=? AND connection_id=? AND kind=? AND revision=?${retained} AND ${memberSql} AND ${connectionSql(input.enabled)} RETURNING ${columns}`)
   .bind(input.enabled?1:0,now,scope.ownerId,scope.company.code,scope.company.name,input.connectionId,input.kind,input.expectedRevision,
    ...(input.enabled?[input.expectedConnectionRevision,scope.actor.email,scope.actor.role,scope.actor.credentialVersion]:[]),...memberArgs(scope),...connectionArgs(scope,input)).first<Row>();
 }
 if(!row)return conflict();return policy(row);
}
