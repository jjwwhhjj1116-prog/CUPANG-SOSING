import {env} from 'cloudflare:workers';
import type {SourceInboxItem} from '@/app/source-inbox';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import {sourceHasManualTitle,sourceInboxDisplayTitle,validCollectedTitleTranslation,type SourceInboxTitlePreparation} from '@/app/source-inbox-title';
import {savedRegistrationSettings} from '@/app/workspace-settings';
import {sourceTitleProvider,sourceTitleErrorMessage,confirmedInvalidSourceTitleError,LEGACY_SOURCE_TITLE_SIGNATURE,type SourceTitleProvider,type SourceTitleEnvironment} from '@/app/source-inbox-title-provider';
export const sourceInboxTitleSchema=`CREATE TABLE IF NOT EXISTS source_inbox_titles (
 owner_id TEXT NOT NULL,capture_id TEXT NOT NULL,company_code TEXT NOT NULL,company_name TEXT NOT NULL,
 fingerprint TEXT NOT NULL,source_revision INTEGER NOT NULL,source_title TEXT NOT NULL,
 status TEXT NOT NULL,translated_title TEXT,error TEXT,attempts INTEGER NOT NULL,retryable INTEGER NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,capture_id)
)`;
export const sourceInboxTitleRunSchema=`CREATE TABLE IF NOT EXISTS source_inbox_title_runs (
 owner_id TEXT NOT NULL,capture_id TEXT NOT NULL,fingerprint TEXT NOT NULL,source_revision INTEGER NOT NULL,
 provider_signature TEXT NOT NULL,provider TEXT NOT NULL,model TEXT,attempts INTEGER NOT NULL,
 status TEXT NOT NULL,retryable INTEGER NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,capture_id,fingerprint,source_revision,provider_signature)
)`;
type Row={owner_id:string;capture_id:string;company_code:string;company_name:string;fingerprint:string;source_revision:number;source_title:string;status:string;translated_title:string|null;error:string|null;attempts:number;retryable:number;updated_at:string};
type Run={owner_id:string;capture_id:string;fingerprint:string;source_revision:number;provider_signature:string;provider:string;model:string|null;attempts:number;status:string;retryable:number;updated_at:string};
export type SourceTitleWork={claimed:boolean;row:Row|undefined;run:Run|undefined};
export type SourceTitleMember={id:string;email:string;role:'admin'|'member'};
async function database(){if(!env.DB)throw Error('D1 unavailable');await env.DB.prepare(sourceInboxTitleSchema).run();await env.DB.prepare(sourceInboxTitleRunSchema).run();return env.DB;}
const matches=(row:Row,item:SourceInboxItem)=>row.owner_id===item.ownerId&&row.capture_id===item.id&&row.company_code===item.company.code&&row.company_name===item.company.name&&row.fingerprint===item.fingerprint&&row.source_revision===item.revision&&row.source_title===item.snapshot.title;
export async function sourceTitleBrand(owner:string){
 const row=await env.DB.prepare('SELECT payload FROM workspace_settings WHERE owner_id=?').bind(owner).first<{payload:string}>();return savedRegistrationSettings(row?JSON.parse(row.payload):null).brand;
}
function preparation(item:SourceInboxItem,row:Row|undefined,brand:string,run?:Run):SourceInboxTitlePreparation{
 const configured=sourceTitleProvider(env as SourceTitleEnvironment),actual=run?{provider:run.provider,model:run.model,signature:run.provider_signature}:row?{provider:'google-free',model:'google-translate-literal-v1',signature:LEGACY_SOURCE_TITLE_SIGNATURE}:configured;
 const provider=run?.status==='uncertain'||row?.status==='completed'?actual:configured;
 const base={format:'yoofam-collected-title-v1' as const,fingerprint:item.fingerprint,revision:item.revision,sourceTitle:item.snapshot.title,brand,provider:provider.provider,model:provider.model,providerSignature:provider.signature};
 if(sourceHasManualTitle(item))return {...base,state:'completed',translatedTitle:item.reviewed!.title,attempts:0,retryable:false,message:'직접 검토한 상품명 유지'};
 if(row&&matches(row,item)&&row.status==='completed'&&validCollectedTitleTranslation(item.snapshot.title,row.translated_title))return {...base,state:'completed',translatedTitle:row.translated_title,attempts:row.attempts,retryable:false,message:'수집 상품명 번역 완료 · SEO 작업 전'};
 if(!configured.configured)return {...base,state:'failed',translatedTitle:null,attempts:0,retryable:false,message:'설정된 상품명 번역 서비스를 확인해주세요. 원문은 보존됩니다.'};
 const changed=actual.signature!==configured.signature;
 if(!row||!matches(row,item)||changed&&(actual.provider==='google-free'&&(row.status!=='completed'||!validCollectedTitleTranslation(item.snapshot.title,row.translated_title))||run?.status==='failed'&&confirmedInvalidSourceTitleError(row.error)))return {...base,state:'pending',translatedTitle:null,attempts:0,retryable:true,message:'설정된 서비스로 한국어 상품명 준비 대기'};
 const running=row.status==='running',stale=running&&Date.now()-Date.parse(row.updated_at)>30000;
 const uncertain=run?.status==='uncertain'||stale&&actual.provider==='workers-ai';
 return {...base,state:running&&!stale?'running':'failed',translatedTitle:null,attempts:row.attempts,retryable:!uncertain&&!changed&&row.attempts<2&&(stale||row.retryable===1),message:running&&!stale?'한국어 상품명 준비 중':uncertain?'상품명 번역 결과가 확정되지 않았습니다. 자동 재요청하지 않으며 원문은 보존됩니다.':sourceTitleErrorMessage(row.error)||'상품명 번역을 완료하지 못했습니다. 원문은 보존됩니다.'};
}
export function sourceTitleFields(item:SourceInboxItem,row:Row|undefined,brand:string,run?:Run){const titlePreparation=preparation(item,row,brand,run),decorated={...item,titlePreparation};return {titlePreparation,displayTitle:sourceInboxDisplayTitle(decorated)};}
export async function decorateSourceInboxTitles(owner:string,company:SupplierHubCompany,items:SourceInboxItem[]){
 if(!items.length)return items;const db=await database(),brand=await sourceTitleBrand(owner);
 const rows=await db.prepare(`SELECT * FROM source_inbox_titles WHERE owner_id=? AND company_code=? AND company_name=? AND capture_id IN (${items.map(()=>'?').join(',')})`).bind(owner,company.code,company.name,...items.map(item=>item.id)).all<Row>(),byId=new Map(rows.results.map(row=>[row.capture_id,row]));
 const runs=await db.prepare(`SELECT * FROM source_inbox_title_runs WHERE owner_id=? AND capture_id IN (${items.map(()=>'?').join(',')}) ORDER BY updated_at DESC,provider_signature DESC`).bind(owner,...items.map(item=>item.id)).all<Run>();
 return items.map(item=>({...item,...sourceTitleFields(item,byId.get(item.id),brand,runs.results.find(run=>run.capture_id===item.id&&run.fingerprint===item.fingerprint&&run.source_revision===item.revision))}));
}
const sourceGuard=(item:SourceInboxItem,member:SourceTitleMember)=>({sql:`EXISTS(SELECT 1 FROM (SELECT owner_id,id,company_code,company_name,fingerprint,revision,payload,review_payload,archived_at FROM source_inbox UNION ALL SELECT owner_id,id,company_code,company_name,fingerprint,revision,payload,review_payload,archived_at FROM source_inbox_captures) s
 WHERE s.owner_id=? AND s.id=? AND s.company_code=? AND s.company_name=? AND s.fingerprint=? AND s.revision=? AND s.payload=? AND s.review_payload IS ? AND s.archived_at IS NULL)
 AND EXISTS(SELECT 1 FROM members m WHERE m.id=? AND m.status='approved' AND lower(trim(m.email))=? AND m.role=? AND m.company_code=? AND m.company_name=?)`,args:[item.ownerId,item.id,item.company.code,item.company.name,item.fingerprint,item.revision,JSON.stringify(item.snapshot),item.reviewed?JSON.stringify(item.reviewed):null,member.id,member.email.trim().toLowerCase(),member.role,item.company.code,item.company.name]});
export async function claimSourceInboxTitle(item:SourceInboxItem,member:SourceTitleMember,configured:SourceTitleProvider=sourceTitleProvider(env as SourceTitleEnvironment)):Promise<SourceTitleWork>{
 const db=await database(),guard=sourceGuard(item,member),before=await db.prepare('SELECT * FROM source_inbox_titles WHERE owner_id=? AND capture_id=?').bind(item.ownerId,item.id).first<Row>();
 const prior=await db.prepare('SELECT * FROM source_inbox_title_runs WHERE owner_id=? AND capture_id=? AND fingerprint=? AND source_revision=? ORDER BY updated_at DESC,provider_signature DESC LIMIT 1').bind(item.ownerId,item.id,item.fingerprint,item.revision).first<Run>();
 if(!configured.configured||before&&matches(before,item)&&before.status==='completed'&&validCollectedTitleTranslation(item.snapshot.title,before.translated_title))return {claimed:false,row:before??undefined,run:prior??undefined};
 const legacy=!!before&&matches(before,item)&&!prior&&configured.signature===LEGACY_SOURCE_TITLE_SIGNATURE;
 if(legacy&&(before.attempts>=2||before.status==='failed'&&before.retryable!==1||before.status==='running'&&Date.now()-Date.parse(before.updated_at)<=30000))return {claimed:false,row:before,run:undefined};
 const now=new Date(Math.max(Date.now(),Date.parse(before?.updated_at??'')+1||0)).toISOString(),stale=new Date(Date.now()-30000).toISOString();
 const runWhere='owner_id=? AND capture_id=? AND fingerprint=? AND source_revision=? AND provider_signature=?';
 const identity=[item.ownerId,item.id,item.fingerprint,item.revision,configured.signature];
 const result=await db.batch<Row|Run>([
  db.prepare(`INSERT INTO source_inbox_title_runs(owner_id,capture_id,fingerprint,source_revision,provider_signature,provider,model,attempts,status,retryable,updated_at)
   SELECT ?,?,?,?,?,?,?,?,'running',0,? WHERE ${guard.sql}
   AND NOT EXISTS(SELECT 1 FROM source_inbox_title_runs r WHERE r.owner_id=? AND r.capture_id=? AND r.fingerprint=? AND r.source_revision=? AND r.provider='workers-ai' AND (r.status='uncertain' OR r.status='running'))
   ON CONFLICT(owner_id,capture_id,fingerprint,source_revision,provider_signature) DO UPDATE SET attempts=source_inbox_title_runs.attempts+1,status='running',retryable=0,updated_at=excluded.updated_at
   WHERE source_inbox_title_runs.attempts<2 AND ((source_inbox_title_runs.status='failed' AND source_inbox_title_runs.retryable=1) OR (source_inbox_title_runs.provider='google-free' AND source_inbox_title_runs.status='running' AND source_inbox_title_runs.updated_at<?)) RETURNING *`)
   .bind(...identity,configured.provider,configured.model,legacy?Math.min(before.attempts+1,2):1,now,...guard.args,item.ownerId,item.id,item.fingerprint,item.revision,stale),
  db.prepare(`INSERT INTO source_inbox_titles(owner_id,capture_id,company_code,company_name,fingerprint,source_revision,source_title,status,translated_title,error,attempts,retryable,updated_at)
   SELECT ?,?,?,?,?,?,?,'running',NULL,NULL,r.attempts,? ,? FROM source_inbox_title_runs r WHERE ${runWhere} AND r.updated_at=? AND changes()=1
   ON CONFLICT(owner_id,capture_id) DO UPDATE SET company_code=excluded.company_code,company_name=excluded.company_name,fingerprint=excluded.fingerprint,source_revision=excluded.source_revision,source_title=excluded.source_title,status='running',translated_title=NULL,error=NULL,attempts=excluded.attempts,retryable=0,updated_at=excluded.updated_at RETURNING *`)
   .bind(item.ownerId,item.id,item.company.code,item.company.name,item.fingerprint,item.revision,item.snapshot.title,0,now,...identity,now),
 ]);
 const claimed=result[0].results[0] as Run|undefined,row=result[1].results[0] as Row|undefined;
 if(Boolean(claimed)!==Boolean(row))throw Error('Incomplete title claim');
 return claimed&&row?{claimed:true,row,run:claimed}:{claimed:false,row:before??undefined,run:prior??undefined};
}
export async function reusableSourceInboxTitle(item:SourceInboxItem,signature:string):Promise<string|null>{
 const db=await database(),row=await db.prepare(`SELECT t.translated_title FROM source_inbox_titles t JOIN source_inbox_title_runs r ON r.owner_id=t.owner_id AND r.capture_id=t.capture_id AND r.fingerprint=t.fingerprint AND r.source_revision=t.source_revision AND r.updated_at=t.updated_at
 WHERE t.owner_id=? AND t.company_code=? AND t.company_name=? AND t.source_title=? AND t.status='completed' AND r.status='completed' AND r.provider_signature=? ORDER BY t.updated_at DESC LIMIT 1`).bind(item.ownerId,item.company.code,item.company.name,item.snapshot.title,signature).first<{translated_title:string}>();return row?.translated_title??null;
}
export async function finishSourceInboxTitle(item:SourceInboxItem,member:SourceTitleMember,work:SourceTitleWork,title:string|null,message:string|null,retryable:boolean,uncertain=false):Promise<SourceTitleWork|null>{
 const claim=work.row,run=work.run;if(!claim||!run)return null;
 const db=await database(),guard=sourceGuard(item,member);
 const now=new Date(Math.max(Date.now(),Date.parse(claim.updated_at)+1)).toISOString();
 const result=await db.batch<Row|Run>([
  db.prepare(`UPDATE source_inbox_titles SET status=?,translated_title=?,error=?,retryable=?,updated_at=? WHERE owner_id=? AND capture_id=? AND fingerprint=? AND source_revision=? AND status='running' AND attempts=? AND updated_at=? AND ${guard.sql} RETURNING *`)
   .bind(title?'completed':'failed',title,message,retryable?1:0,now,item.ownerId,item.id,item.fingerprint,item.revision,claim.attempts,claim.updated_at,...guard.args),
  db.prepare(`UPDATE source_inbox_title_runs SET status=?,retryable=?,updated_at=? WHERE owner_id=? AND capture_id=? AND fingerprint=? AND source_revision=? AND provider_signature=? AND attempts=? AND updated_at=? AND changes()=1 RETURNING *`)
   .bind(title?'completed':uncertain?'uncertain':'failed',retryable?1:0,now,item.ownerId,item.id,item.fingerprint,item.revision,run.provider_signature,run.attempts,run.updated_at),
 ]);
 if(Boolean(result[0].results[0])!==Boolean(result[1].results[0]))throw Error('Incomplete title result');
 return result[0].results[0]?{claimed:false,row:result[0].results[0] as Row,run:result[1].results[0] as Run}:null;
}
