import {env} from 'cloudflare:workers';
import {MemberConnectionsError,type MemberConnectionProfile,type MemberConnectionScope,type MemberConnectionSave,type MemberConnectionState,type sealMemberCredential} from '@/app/member-connections';

export const memberConnectionsSchema=`CREATE TABLE IF NOT EXISTS member_connections (
 owner_id TEXT NOT NULL,profile_id TEXT NOT NULL,company_code TEXT NOT NULL,company_name TEXT NOT NULL,
 service TEXT NOT NULL CHECK(service IN ('supplier-hub','1688')),alias TEXT NOT NULL,login_id TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),revision INTEGER NOT NULL CHECK(revision>=1),
 encryption_version INTEGER NOT NULL CHECK(encryption_version=1),password_nonce TEXT NOT NULL,password_ciphertext TEXT NOT NULL,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner_id,profile_id)
)`;
const ready=new WeakSet<D1Database>();
async function database(){if(!env.DB)throw new MemberConnectionsError(503,'MEMBER_CONNECTIONS_STORAGE','연동 계정 저장소를 확인하지 못했습니다.');if(!ready.has(env.DB)){await env.DB.prepare(memberConnectionsSchema).run();ready.add(env.DB);}return env.DB;}
const memberSql=`EXISTS(SELECT 1 FROM members m WHERE m.id=? AND lower(trim(m.email))=? AND m.role=? AND m.status='approved' AND m.company_code=? AND m.company_name=?)`;
const memberArgs=(scope:MemberConnectionScope)=>[scope.ownerId,scope.email,scope.role,scope.company.code,scope.company.name];
const conflict=():never=>{throw new MemberConnectionsError(409,'MEMBER_CONNECTIONS_CHANGED','회원·회사 또는 연동 계정의 저장 버전이 변경되었습니다. 목록을 다시 불러와주세요.');};
const columns=`profile_id AS id,service,alias,login_id AS loginId,enabled,revision,created_at AS createdAt,updated_at AS updatedAt,CASE WHEN length(password_ciphertext)>0 THEN 1 ELSE 0 END AS hasPassword`;
type Metadata=Omit<MemberConnectionProfile,'enabled'|'hasPassword'>&{enabled:number;hasPassword:number};
const metadata=(row:Metadata):MemberConnectionProfile=>({id:row.id,service:row.service,alias:row.alias,loginId:row.loginId,enabled:row.enabled===1,hasPassword:row.hasPassword===1,revision:row.revision,createdAt:row.createdAt,updatedAt:row.updatedAt});
export async function readMemberConnections(scope:MemberConnectionScope){
 const db=await database();if(!await db.prepare(`SELECT 1 AS valid WHERE ${memberSql}`).bind(...memberArgs(scope)).first())return conflict();
 const rows=await db.prepare(`SELECT ${columns} FROM member_connections WHERE owner_id=? AND company_code=? AND company_name=? AND ${memberSql} ORDER BY created_at,profile_id LIMIT 20`).bind(scope.ownerId,scope.company.code,scope.company.name,...memberArgs(scope)).all<Metadata>();
 return rows.results.map(metadata);
}
export async function writeMemberConnection(scope:MemberConnectionScope,input:MemberConnectionSave|MemberConnectionState,sealed:Awaited<ReturnType<typeof sealMemberCredential>>|null){
 const db=await database(),now=new Date().toISOString();let row:Metadata|null;
 if(input.action==='save'&&input.expectedRevision===0){
  if(!sealed)return conflict();
  row=await db.prepare(`INSERT INTO member_connections(owner_id,profile_id,company_code,company_name,service,alias,login_id,enabled,revision,encryption_version,password_nonce,password_ciphertext,created_at,updated_at)
   SELECT ?,?,?,?,?,?,?,1,1,?,?,?, ?,? WHERE ${memberSql} AND (SELECT count(*) FROM member_connections WHERE owner_id=? AND company_code=? AND company_name=?)<20
   ON CONFLICT(owner_id,profile_id) DO NOTHING RETURNING ${columns}`).bind(scope.ownerId,input.id,scope.company.code,scope.company.name,input.service,input.alias,input.loginId,sealed.version,sealed.nonce,sealed.ciphertext,now,now,...memberArgs(scope),scope.ownerId,scope.company.code,scope.company.name).first<Metadata>();
 }else if(input.action==='save'){
  row=await db.prepare(`UPDATE member_connections SET alias=?,login_id=?,revision=revision+1,updated_at=?,encryption_version=COALESCE(?,encryption_version),password_nonce=COALESCE(?,password_nonce),password_ciphertext=COALESCE(?,password_ciphertext)
   WHERE owner_id=? AND profile_id=? AND company_code=? AND company_name=? AND service=? AND revision=? AND ${memberSql} RETURNING ${columns}`)
   .bind(input.alias,input.loginId,now,sealed?.version??null,sealed?.nonce??null,sealed?.ciphertext??null,scope.ownerId,input.id,scope.company.code,scope.company.name,input.service,input.expectedRevision,...memberArgs(scope)).first<Metadata>();
 }else{
  row=await db.prepare(`UPDATE member_connections SET enabled=?,revision=revision+1,updated_at=? WHERE owner_id=? AND profile_id=? AND company_code=? AND company_name=? AND revision=? AND ${memberSql} RETURNING ${columns}`)
   .bind(input.enabled?1:0,now,scope.ownerId,input.id,scope.company.code,scope.company.name,input.expectedRevision,...memberArgs(scope)).first<Metadata>();
 }
 if(!row)return conflict();return metadata(row);
}
