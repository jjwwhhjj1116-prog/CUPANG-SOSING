import {env} from 'cloudflare:workers';
import {emptyOperationsDocument,parseOperationsDocument,OperationsError} from '@/app/operations/engine';
import type {OperationsDocument,OperationsScope,Values} from '@/app/operations/types';

export const operationsSchema=`CREATE TABLE IF NOT EXISTS operations_workspaces (
 owner_id TEXT NOT NULL,company_code TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),payload TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,company_code)
)`;
async function database(){if(!env.DB)throw Error('운영관리 DB 연결이 필요합니다.');await env.DB.prepare(operationsSchema).run();return env.DB;}
const authorization=`EXISTS(SELECT 1 FROM members WHERE id=? AND status='approved' AND company_code=? AND company_name=?)`;
export type StoredOperations={document:OperationsDocument;revision:number;updatedAt:string|null};
export async function readOperations(scope:OperationsScope):Promise<StoredOperations>{
 const db=await database(),record=await db.prepare('SELECT revision,payload,updated_at FROM operations_workspaces WHERE owner_id=? AND company_code=?').bind(scope.ownerId,scope.companyCode).first<{revision:number;payload:string;updated_at:string}>();
 if(!record)return{document:emptyOperationsDocument(),revision:0,updatedAt:null};
 try{if(!Number.isSafeInteger(record.revision)||record.revision<1)throw Error('revision');return{document:parseOperationsDocument(JSON.parse(record.payload)),revision:record.revision,updatedAt:record.updated_at};}catch{throw new OperationsError('저장된 운영 자료를 읽지 못했습니다. 빈 자료로 덮어쓰지 않았습니다.',503,'OPERATIONS_READ_FAILED');}
}
export async function saveOperations(scope:OperationsScope,expectedRevision:number,document:OperationsDocument):Promise<StoredOperations>{
 const db=await database(),revision=expectedRevision+1,updatedAt=new Date().toISOString(),payload=JSON.stringify(parseOperationsDocument(document));
 const q=db.prepare(`INSERT INTO operations_workspaces(owner_id,company_code,revision,payload,updated_at)
 SELECT ?,?,?,?,? WHERE ${authorization}
 AND ((?=0 AND NOT EXISTS(SELECT 1 FROM operations_workspaces WHERE owner_id=? AND company_code=?))
 OR EXISTS(SELECT 1 FROM operations_workspaces WHERE owner_id=? AND company_code=? AND revision=?))
 ON CONFLICT(owner_id,company_code) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at
 WHERE operations_workspaces.revision=? AND ${authorization}
 RETURNING revision,payload,updated_at`).bind(scope.ownerId,scope.companyCode,revision,payload,updatedAt,
 scope.ownerId,scope.companyCode,scope.companyName,expectedRevision,scope.ownerId,scope.companyCode,scope.ownerId,scope.companyCode,expectedRevision,expectedRevision,scope.ownerId,scope.companyCode,scope.companyName);
 const result=await db.batch([q]);if(result[0].results.length!==1)throw new OperationsError('다른 창의 수정 또는 승인 회사가 변경되었습니다. 입력을 유지하고 최신 자료를 불러오세요.',409,'OPERATIONS_CONFLICT');
 const returned=result[0].results[0] as {revision:number;payload:string;updated_at:string};if(returned.revision!==revision||returned.payload!==payload)throw new OperationsError('서버 저장 결과가 일치하지 않습니다. 다시 확인해주세요.',503);
 return{document,revision,updatedAt:returned.updated_at};
}
/** Read current company-owned managed SKUs only. Source registration drafts have
 * no company key and are intentionally not assigned to an arbitrary company. */
export async function operationsProductRows(scope:OperationsScope):Promise<Values[]>{
 const db=await database(),tables=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='managed_products'").all<{name:string}>();if(!tables.results.length)return[];
 const rows=await db.prepare(`SELECT sku_id,title,source_payload FROM managed_products WHERE owner_id=? AND company_code=? AND ${authorization} ORDER BY sku_id LIMIT 5001`).bind(scope.ownerId,scope.companyCode,scope.ownerId,scope.companyCode,scope.companyName).all<{sku_id:string;title:string;source_payload:string}>();
 if(rows.results.length>5000)throw new OperationsError('한 번에 연결할 상품은 5000개까지 지원합니다.',413);
 const number=(value:unknown)=>{if(typeof value!=='string'&&typeof value!=='number')return undefined;const literal=String(value).replace(/[,\s₩]/g,'');if(!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(literal))return undefined;const parsed=Number(literal);return Number.isFinite(parsed)&&Math.abs(parsed)<=1e12?parsed:undefined;};
 const first=(...values:unknown[])=>values.map(value=>String(value??'')).find(value=>value.trim())??'';
 return rows.results.map(r=>{let v:Values;try{v=JSON.parse(r.source_payload);if(!v||typeof v!=='object'||Array.isArray(v))throw Error('source');}catch{throw new OperationsError('상품관리 원본 자료를 읽지 못했습니다.',503);}
 const prices:Values={},links:Values={};
 // Missing source cells are unknown, not zero. Omit them so re-sync preserves
 // an existing operations price; an explicitly exported zero still updates it.
 for(const [target,source]of [['supplyPrice','공급가'],['salePrice','판매가'],['costPrice','매입단가']]){const amount=number(v[source]);if(amount!==undefined)prices[target]=amount;}
 // Optional blank source identifiers do not express a request to unlink an
 // operations SKU. Keep explicit current source values when they are present.
 for(const [target,value]of [['barcode',first(v['바코드'])],['optionId',first(v['옵션ID'],v.vendorItemId)],['productId',first(v['노출ID'],v.productId)],['sourceUrl',first(v['구매링크'])]])if(value)links[target]=value;
 return{id:'managed:'+r.sku_id,name:r.title,supplierSkuId:r.sku_id,...links,...prices,source:'managed-products'};});
}
