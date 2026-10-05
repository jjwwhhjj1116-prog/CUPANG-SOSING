import {env} from 'cloudflare:workers';
import {historicalAiCompany,type HistoricalAiImport,type HistoricalAiCounts,type HistoricalAiList,type HistoricalAiQuote,type HistoricalAiRow} from '@/app/historical-ai-registrations';
export const historicalAiSchema=`CREATE TABLE IF NOT EXISTS historical_ai_records (
 owner_id TEXT NOT NULL, company_code TEXT NOT NULL, record_kind TEXT NOT NULL CHECK(record_kind IN ('registration','quotation')),
 registration_id TEXT NOT NULL, option_id TEXT NOT NULL, title TEXT NOT NULL, option_count INTEGER NOT NULL,
 source_url TEXT NOT NULL, source_status TEXT NOT NULL, source_payload TEXT NOT NULL,
 source_name TEXT NOT NULL, source_sha256 TEXT NOT NULL, source_row INTEGER NOT NULL, imported_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,company_code,record_kind,registration_id,option_id)
)`;
async function database(){if(!env.DB)throw Error('D1 unavailable');await env.DB.prepare(historicalAiSchema).run();return env.DB;}
const policy=`EXISTS(SELECT 1 FROM members WHERE id=? AND lower(trim(email))='unari8484@gmail.com' AND role='member' AND status='approved' AND company_code='A01464742' AND company_name='와이홉')`;
/** All rows are inserted together, or none on a changed/unknown original. */
export async function importHistoricalAi(owner:string,source:HistoricalAiImport,preview:boolean):Promise<HistoricalAiCounts>{
 const db=await database(),payload=JSON.stringify(source.entries),company=historicalAiCompany.code;
 const conflicts=`SELECT 1 FROM json_each(?) j JOIN historical_ai_records h ON h.owner_id=? AND h.company_code=? AND h.record_kind=json_extract(j.value,'$.kind') AND h.registration_id=json_extract(j.value,'$.registrationId') AND h.option_id=json_extract(j.value,'$.optionId') WHERE h.source_payload<>json_extract(j.value,'$.payload')`;
 const unlinked=`SELECT 1 FROM json_each(?) j WHERE json_extract(j.value,'$.kind')='quotation' AND NOT EXISTS(SELECT 1 FROM historical_ai_records h WHERE h.owner_id=? AND h.company_code=? AND h.record_kind='registration' AND h.registration_id=json_extract(j.value,'$.registrationId')) AND NOT EXISTS(SELECT 1 FROM json_each(?) r WHERE json_extract(r.value,'$.kind')='registration' AND json_extract(r.value,'$.registrationId')=json_extract(j.value,'$.registrationId'))`;
 const query=db.prepare(`SELECT COUNT(*) AS total,SUM(json_extract(j.value,'$.kind')='registration') AS registrations,SUM(json_extract(j.value,'$.kind')='quotation') AS quotations,
 SUM(h.registration_id IS NULL) AS added,COALESCE(SUM(h.source_payload=json_extract(j.value,'$.payload')),0) AS unchanged,
 (SELECT COUNT(*) FROM (${conflicts})) AS conflicts,(SELECT COUNT(*) FROM (${unlinked})) AS unlinked
 FROM json_each(?) j LEFT JOIN historical_ai_records h ON h.owner_id=? AND h.company_code=? AND h.record_kind=json_extract(j.value,'$.kind') AND h.registration_id=json_extract(j.value,'$.registrationId') AND h.option_id=json_extract(j.value,'$.optionId')`).bind(payload,owner,company,payload,owner,company,payload,payload,owner,company);
 const queries=[query];
 if(!preview)queries.push(db.prepare(`INSERT INTO historical_ai_records(owner_id,company_code,record_kind,registration_id,option_id,title,option_count,source_url,source_status,source_payload,source_name,source_sha256,source_row,imported_at)
 SELECT ?,?,json_extract(j.value,'$.kind'),json_extract(j.value,'$.registrationId'),json_extract(j.value,'$.optionId'),json_extract(j.value,'$.title'),json_extract(j.value,'$.optionCount'),json_extract(j.value,'$.sourceUrl'),json_extract(j.value,'$.status'),json_extract(j.value,'$.payload'),json_extract(j.value,'$.sourceName'),json_extract(j.value,'$.sourceSha256'),json_extract(j.value,'$.sourceRow'),?
 FROM json_each(?) j WHERE ${policy} AND NOT EXISTS(${conflicts}) AND NOT EXISTS(${unlinked})
 ON CONFLICT(owner_id,company_code,record_kind,registration_id,option_id) DO NOTHING`).bind(owner,company,new Date().toISOString(),payload,owner,payload,owner,company,payload,owner,company,payload));
 const results=await db.batch(queries),counts=results[0].results[0] as HistoricalAiCounts;
 if(!preview&&!counts.conflicts&&!counts.unlinked&&counts.added!==results[1].meta.changes)throw Error('회원 상태가 변경되었습니다. 다시 로그인해주세요.');
 return counts;
}
export async function listHistoricalAi(owner:string,page:number,search:string):Promise<HistoricalAiList>{
 const db=await database(),pattern='%'+search.replace(/[\\%_]/g,value=>'\\'+value)+'%',where=`owner_id=? AND company_code=? AND record_kind='registration' AND (title LIKE ? ESCAPE '\\' OR registration_id LIKE ? ESCAPE '\\')`,args=[owner,historicalAiCompany.code,pattern,pattern];
 const result=await db.batch([db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(option_count),0) AS options FROM historical_ai_records WHERE ${where}`).bind(...args),db.prepare(`SELECT h.*,(SELECT COUNT(*) FROM historical_ai_records q WHERE q.owner_id=h.owner_id AND q.company_code=h.company_code AND q.registration_id=h.registration_id AND q.record_kind='quotation') AS quotes FROM historical_ai_records h WHERE ${where} ORDER BY registration_id DESC LIMIT 25 OFFSET ?`).bind(...args,(page-1)*25)]);
 type Stored={registration_id:string;title:string;option_count:number;source_url:string;source_status:string;source_payload:string;quotes:number;source_name:string;imported_at:string};
 const summary=result[0].results[0] as {total:number;options:number};
 return {company:historicalAiCompany,page,pageSize:25,total:summary.total,reportedOptions:summary.options,records:(result[1].results as Stored[]).map(row=>({registrationId:row.registration_id,title:row.title,optionCount:row.option_count,sourceUrl:row.source_url,status:row.source_status,raw:JSON.parse(row.source_payload) as HistoricalAiRow,quoteCount:row.quotes,sourceName:row.source_name,importedAt:row.imported_at}))};
}
export async function historicalAiQuotes(owner:string,registrationId:string):Promise<HistoricalAiQuote[]>{
 const db=await database(),rows=await db.prepare("SELECT source_payload FROM historical_ai_records WHERE owner_id=? AND company_code=? AND record_kind='quotation' AND registration_id=? ORDER BY option_id").bind(owner,historicalAiCompany.code,registrationId).all<{source_payload:string}>();return rows.results.map(row=>JSON.parse(row.source_payload) as HistoricalAiQuote);
}
