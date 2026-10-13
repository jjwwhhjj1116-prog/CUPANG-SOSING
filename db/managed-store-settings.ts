import {env} from 'cloudflare:workers';
import {managedProductAccountContext} from '@/app/managed-products';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import {ManagedStoreSettingsError,managedStoreSettingsConflict,normalizeManagedVendorNames,validateManagedStoreSettingsView,type ManagedStoreSettingsView} from '@/app/managed-store-settings';

export const managedStoreSettingsSchema=`CREATE TABLE IF NOT EXISTS managed_store_settings (
 owner_id TEXT NOT NULL REFERENCES members(id),company_code TEXT NOT NULL,company_name TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),payload TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,company_code)
)`;
type Source={owner_id:string;company_code:string;company_name:string;revision:number;payload:string;updated_at:string};
export type ManagedStoreSettingsSnapshot={view:ManagedStoreSettingsView;source:Source|null};
async function database(){
 if(!env.DB)throw Error('D1 unavailable');
 const table=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='managed_store_settings'").first<{name:string}>();
 if(!table)throw new ManagedStoreSettingsError('허용 판매처 설정을 아직 조회할 수 없습니다. 잠시 후 다시 확인해주세요.',503,'MANAGED_STORE_SETTINGS_UNAVAILABLE');
 return env.DB;
}
const authorization="EXISTS(SELECT 1 FROM members WHERE id=? AND status='approved' AND company_code=? AND company_name=?)";
async function sourceRow(owner:string,company:SupplierHubCompany){
 const db=await database(),observed=await db.prepare(`SELECT ${authorization} AS allowed,
  (SELECT json_object('owner_id',owner_id,'company_code',company_code,'company_name',company_name,'revision',revision,'payload',payload,'updated_at',updated_at)
   FROM managed_store_settings WHERE owner_id=? AND company_code=?) AS source_payload_snapshot`).bind(owner,company.code,company.name,owner,company.code).first<{allowed:number;source_payload_snapshot:string|null}>();
 if(observed?.allowed!==1)throw managedStoreSettingsConflict();const source:Source|null=observed.source_payload_snapshot===null?null:JSON.parse(observed.source_payload_snapshot);
 if(source&&source.company_name!==company.name)throw managedStoreSettingsConflict();return source;
}
const fingerprint=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
export async function readManagedStoreSettings(owner:string,company:SupplierHubCompany):Promise<ManagedStoreSettingsSnapshot> {
 const source=await sourceRow(owner,company),accountContext=await managedProductAccountContext(owner,company);let names:string[]=[];
 if(source){try{names=normalizeManagedVendorNames(JSON.parse(source.payload));}catch{throw new ManagedStoreSettingsError('저장된 허용 판매처 원문을 확인해주세요.',409,'MANAGED_STORE_SETTINGS_SOURCE_INVALID');}}
 if(source&&JSON.stringify(names)!==source.payload)throw new ManagedStoreSettingsError('저장된 허용 판매처 원문을 확인해주세요.',409,'MANAGED_STORE_SETTINGS_SOURCE_INVALID');
 const inputFingerprint=await fingerprint(['managed-allowed-stores-v1',accountContext,source]);
 return {source,view:validateManagedStoreSettingsView({company,accountContext,revision:source?.revision??0,inputFingerprint,allowedVendorNames:names,updatedAt:source?.updated_at??null},{company,accountContext})};
}
export async function managedStoreSettingsCurrent(owner:string,company:SupplierHubCompany,snapshot:ManagedStoreSettingsSnapshot):Promise<boolean> {
 const current=await sourceRow(owner,company);return JSON.stringify(current)===JSON.stringify(snapshot.source);
}
/** One statement compares the exact stored payload/version/time and current
 * approved company. Prices, products and other settings are never written. */
export async function saveManagedStoreSettings(owner:string,company:SupplierHubCompany,snapshot:ManagedStoreSettingsSnapshot,names:string[]):Promise<{revision:number;updatedAt:string}> {
 const db=await database(),payload=JSON.stringify(normalizeManagedVendorNames(names)),prior=snapshot.source;
 if(prior&&payload===prior.payload){if(!await managedStoreSettingsCurrent(owner,company,snapshot))throw managedStoreSettingsConflict();return {revision:prior.revision,updatedAt:prior.updated_at};}
 const revision=snapshot.view.revision+1,updatedAt=new Date(Math.max(Date.now(),prior?Date.parse(prior.updated_at)+1:0)).toISOString();
 if(!Number.isSafeInteger(revision)||revision>=Number.MAX_SAFE_INTEGER)throw managedStoreSettingsConflict();
 const compare="(SELECT revision FROM managed_store_settings WHERE owner_id=? AND company_code=?) IS ? AND (SELECT payload FROM managed_store_settings WHERE owner_id=? AND company_code=?) IS ? AND (SELECT updated_at FROM managed_store_settings WHERE owner_id=? AND company_code=?) IS ? AND (SELECT company_name FROM managed_store_settings WHERE owner_id=? AND company_code=?) IS ?";
 const result=await db.prepare(`INSERT INTO managed_store_settings(owner_id,company_code,company_name,revision,payload,updated_at)
  SELECT ?,?,?,?,?,? WHERE ${authorization} AND ${compare}
  ON CONFLICT(owner_id,company_code) DO UPDATE SET company_name=excluded.company_name,revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at
  WHERE managed_store_settings.revision=? AND managed_store_settings.payload IS ? AND managed_store_settings.updated_at IS ? AND managed_store_settings.company_name IS ? RETURNING revision,payload,updated_at`).bind(owner,company.code,company.name,revision,payload,updatedAt,owner,company.code,company.name,
   owner,company.code,prior?.revision??null,owner,company.code,prior?.payload??null,owner,company.code,prior?.updated_at??null,owner,company.code,prior?.company_name??null,
   prior?.revision??null,prior?.payload??null,prior?.updated_at??null,prior?.company_name??null).all<{revision:number;payload:string;updated_at:string}>();
 if(result.results.length!==1||result.results[0].revision!==revision||result.results[0].payload!==payload||result.results[0].updated_at!==updatedAt)throw managedStoreSettingsConflict();
 return {revision,updatedAt};
}
