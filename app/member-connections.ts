import type {SupplierHubCompany} from '@/app/supplier-hub-company';

export type MemberConnectionService='supplier-hub'|'1688';
export type MemberConnectionProfile={id:string;service:MemberConnectionService;alias:string;loginId:string;hasPassword:boolean;enabled:boolean;revision:number;createdAt:string;updatedAt:string};
export type MemberConnectionsView={ownerId:string;company:SupplierHubCompany;profiles:MemberConnectionProfile[]};
export type MemberConnectionScope={ownerId:string;company:SupplierHubCompany;email:string;role:'admin'|'member'};
export type MemberConnectionSave={action:'save';id:string;expectedRevision:number;service:MemberConnectionService;alias:string;loginId:string;password:string};
export type MemberConnectionState={action:'set-enabled';id:string;expectedRevision:number;enabled:boolean};
export class MemberConnectionsError extends Error{constructor(public status:400|401|403|409|503,public code:string,message:string){super(message);}}
const fail=(message:string):never=>{throw new MemberConnectionsError(400,'MEMBER_CONNECTIONS_INPUT',message);};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export const memberConnectionId=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const text=(value:unknown,max:number,label:string)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/u.test(value))return fail(label+'을 확인해주세요.');return value.trim();};
export function memberConnectionInput(input:unknown,scope:MemberConnectionScope):MemberConnectionSave|MemberConnectionState{
 if(!object(input))return fail('연동 계정 입력을 확인해주세요.');
 const common=['action','expectedOwnerId','expectedCompany','id','expectedRevision'],fields=input.action==='save'?['service','alias','loginId','password']:input.action==='set-enabled'?['enabled']:[];
 if(!fields.length||Object.keys(input).length!==common.length+fields.length||[...common,...fields].some(key=>!Object.hasOwn(input,key)))return fail('연동 계정 항목을 확인해주세요.');
 const company=input.expectedCompany;
 if(input.expectedOwnerId!==scope.ownerId||!object(company)||Object.keys(company).sort().join(',')!=='code,name'||company.code!==scope.company.code||company.name!==scope.company.name)
  throw new MemberConnectionsError(409,'MEMBER_CONNECTIONS_SCOPE','로그인 회원·회사가 변경되었습니다. 연동 계정을 다시 불러와주세요.');
 if(!memberConnectionId(input.id)||!Number.isSafeInteger(input.expectedRevision)||Number(input.expectedRevision)<(input.action==='save'?0:1))return fail('연동 계정의 저장 버전을 확인해주세요.');
 const id=input.id,expectedRevision=Number(input.expectedRevision);
 if(input.action==='set-enabled'){if(typeof input.enabled!=='boolean')return fail('사용 상태를 확인해주세요.');return{action:'set-enabled',id,expectedRevision,enabled:input.enabled};}
 if(!['supplier-hub','1688'].includes(String(input.service)))return fail('연동 서비스를 확인해주세요.');
 if(typeof input.password!=='string'||input.password.length>1024||/[\u0000-\u001f\u007f]/u.test(input.password)||expectedRevision===0&&!input.password.length)return fail('비밀번호를 확인해주세요. 새 계정에는 비밀번호가 필요합니다.');
 return{action:'save',id,expectedRevision,service:input.service as MemberConnectionService,alias:text(input.alias,60,'별칭'),loginId:text(input.loginId,254,'로그인 ID'),password:input.password};
}
/** Independent 256-bit key only; login peppers and account passwords are never accepted as substitutes. */
export async function memberCredentialKey(value:unknown):Promise<CryptoKey>{
 try{
  if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/u.test(value))throw Error();
  const binary=atob(value),bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));
  if(bytes.length!==32||btoa(binary)!==value)throw Error();
  return await crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt']);
 }catch{throw new MemberConnectionsError(503,'MEMBER_CONNECTIONS_NOT_CONFIGURED','연동 비밀번호 암호화 키가 설정되지 않았거나 올바르지 않습니다. 관리자 설정 후 사용할 수 있습니다.');}
}
export function memberCredentialAad(scope:Pick<MemberConnectionScope,'ownerId'|'company'>,id:string,service:MemberConnectionService){
 return new TextEncoder().encode(JSON.stringify(['yoofam-member-credential-v1',scope.ownerId,scope.company.code,scope.company.name,id,service]));
}
export async function sealMemberCredential(key:CryptoKey,scope:MemberConnectionScope,id:string,service:MemberConnectionService,password:string){
 const nonce=crypto.getRandomValues(new Uint8Array(12)),bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:memberCredentialAad(scope,id,service),tagLength:128},key,new TextEncoder().encode(password));
 const base64=(value:Uint8Array)=>btoa(Array.from(value,byte=>String.fromCharCode(byte)).join(''));
 return{version:1,nonce:base64(nonce),ciphertext:base64(new Uint8Array(bytes))};
}
