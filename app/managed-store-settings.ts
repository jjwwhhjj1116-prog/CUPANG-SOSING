import type {SupplierHubCompany} from '@/app/supplier-hub-company';

export const MANAGED_VENDOR_NAME_LIMIT=100;
export const MANAGED_VENDOR_NAME_LENGTH=200;
export const MANAGED_STORE_SETTINGS_BYTES=32*1024;
export type ManagedStoreSettingsView={company:SupplierHubCompany;accountContext:string;revision:number;inputFingerprint:string;allowedVendorNames:string[];updatedAt:string|null};
export class ManagedStoreSettingsError extends Error {constructor(message:string,public status=400,public code='MANAGED_STORE_SETTINGS_INVALID'){super(message);}}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const timestamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
/** Observed Couplus CSV semantics: comma, trim, nonempty, preserving order,
 * case and duplicates. No seller match or inventory classification is inferred. */
export function normalizeManagedVendorNames(value:unknown):string[] {
 if(typeof value!=='string'&&!Array.isArray(value)||Array.isArray(value)&&value.some(item=>typeof item!=='string'||item.includes(',')))throw new ManagedStoreSettingsError('허용 판매처는 쉼표로 구분해주세요. 이름 배열의 개별 이름 안에는 쉼표를 넣을 수 없습니다.');
 if(new TextEncoder().encode(JSON.stringify(value)).length>MANAGED_STORE_SETTINGS_BYTES)throw new ManagedStoreSettingsError('허용 판매처 입력은 32KB 이하로 나누어주세요.',413);
 const names=(typeof value==='string'?value.split(','):value as string[]).map(name=>name.trim()).filter(name=>name.length>0);
 if(names.length>MANAGED_VENDOR_NAME_LIMIT||names.some(name=>name.length>MANAGED_VENDOR_NAME_LENGTH||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(name)))throw new ManagedStoreSettingsError('허용 판매처는 이름당 200자 이하, 최대 100개로 입력해주세요.');
 return names;
}
export function validateManagedStoreSettingsView(value:unknown,expected:{company:SupplierHubCompany;accountContext:string}):ManagedStoreSettingsView {
 if(!object(value)||Object.keys(value).length!==6||Object.keys(value).some(key=>!['company','accountContext','revision','inputFingerprint','allowedVendorNames','updatedAt'].includes(key))
  ||!object(value.company)||Object.keys(value.company).length!==2||value.company.code!==expected.company.code||value.company.name!==expected.company.name||!digest(value.accountContext)||value.accountContext!==expected.accountContext||!digest(value.inputFingerprint)
  ||!Number.isSafeInteger(value.revision)||(value.revision as number)<0||(value.revision as number)>=Number.MAX_SAFE_INTEGER||!Array.isArray(value.allowedVendorNames)
  ||(value.revision===0?value.updatedAt!==null||value.allowedVendorNames.length!==0:!timestamp(value.updatedAt)))throw new ManagedStoreSettingsError('허용 판매처 설정의 계정·회사·저장 버전을 확인하지 못했습니다.',409,'MANAGED_STORE_SETTINGS_CONFLICT');
 const names=normalizeManagedVendorNames(value.allowedVendorNames);if(JSON.stringify(names)!==JSON.stringify(value.allowedVendorNames))throw new ManagedStoreSettingsError('허용 판매처 조회 결과의 이름 원문을 확인하지 못했습니다.',409,'MANAGED_STORE_SETTINGS_CONFLICT');
 return {company:{...expected.company},accountContext:expected.accountContext,revision:value.revision as number,inputFingerprint:value.inputFingerprint,allowedVendorNames:names,updatedAt:value.updatedAt as string|null};
}
export const managedStoreSettingsConflict=()=>new ManagedStoreSettingsError('로그인 계정·회사 또는 허용 판매처 설정이 변경되었습니다. 입력을 유지하고 현재 저장본을 다시 확인해주세요.',409,'MANAGED_STORE_SETTINGS_CONFLICT');
