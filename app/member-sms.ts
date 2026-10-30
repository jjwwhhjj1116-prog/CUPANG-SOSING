import {env} from 'cloudflare:workers';
import {membersDb} from '@/db/members';

export class MemberSecurityError extends Error {constructor(public status:number,message:string){super(message);}}
export type SmsConfiguration={apiKey:string;apiSecret:string;sender:string};
const bindings=()=>env as {YOOFAM_CREDENTIAL_ENCRYPTION_KEY?:string;SOLAPI_API_KEY?:string;SOLAPI_API_SECRET?:string;SOLAPI_SENDER?:string};
const bytesToBase64=(bytes:Uint8Array)=>btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join(''));
const fromBase64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const aad=new TextEncoder().encode('yoofam-solapi-configuration-v1');
async function configurationKey(){
 const value=bindings().YOOFAM_CREDENTIAL_ENCRYPTION_KEY;
 if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value))throw new MemberSecurityError(503,'문자 서비스 암호화 설정을 확인해주세요.');
 const bytes=fromBase64(value);if(bytes.length!==32||bytesToBase64(bytes)!==value)throw new MemberSecurityError(503,'문자 서비스 암호화 설정을 확인해주세요.');
 return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export function smsConfigurationInput(input:Record<string,unknown>):SmsConfiguration{
 if(typeof input.apiKey!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(input.apiKey)||typeof input.apiSecret!=='string'||!/^[A-Za-z0-9_-]{8,256}$/.test(input.apiSecret))throw new MemberSecurityError(400,'SOLAPI API Key와 API Secret을 확인해주세요.');
 if(typeof input.sender!=='string'||input.sender.length>25||!/^\d{8,12}$/.test(input.sender.replace(/[ -]/g,'')))throw new MemberSecurityError(400,'SOLAPI에 등록한 발신번호를 입력해주세요.');
 return {apiKey:input.apiKey,apiSecret:input.apiSecret,sender:input.sender.replace(/[ -]/g,'')};
}
export async function readSmsConfiguration():Promise<SmsConfiguration|null>{
 const variables=bindings();
 if(variables.SOLAPI_API_KEY&&variables.SOLAPI_API_SECRET&&variables.SOLAPI_SENDER)return smsConfigurationInput({apiKey:variables.SOLAPI_API_KEY,apiSecret:variables.SOLAPI_API_SECRET,sender:variables.SOLAPI_SENDER});
 const row=await membersDb().prepare("SELECT ciphertext,nonce FROM member_sms_settings WHERE id='solapi'").first<{ciphertext:string;nonce:string}>();
 if(!row)return null;
 try{const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(row.nonce),additionalData:aad,tagLength:128},await configurationKey(),fromBase64(row.ciphertext));return smsConfigurationInput(JSON.parse(new TextDecoder().decode(bytes)));}
 catch{throw new MemberSecurityError(503,'문자 서비스 연결 설정을 다시 저장해주세요.');}
}
export async function saveSmsConfiguration(ownerId:string,credentialVersion:number,input:SmsConfiguration){
 if(bindings().SOLAPI_API_KEY||bindings().SOLAPI_API_SECRET||bindings().SOLAPI_SENDER)throw new MemberSecurityError(409,'서버 환경변수로 연결된 문자 서비스는 서버 설정에서 변경해주세요.');
 const key=await configurationKey(),nonce=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:aad,tagLength:128},key,new TextEncoder().encode(JSON.stringify(input)));
 const result=await membersDb().prepare("INSERT INTO member_sms_settings(id,ciphertext,nonce,updated_by,updated_at) SELECT 'solapi',?,?,id,? FROM members WHERE id=? AND role='admin' AND status='approved' AND lower(email)='jwhj1116@kakao.com' AND company_code='A01526306' AND company_name='유앤채' AND credential_version=? ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,nonce=excluded.nonce,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(bytesToBase64(new Uint8Array(cipher)),bytesToBase64(nonce),new Date().toISOString(),ownerId,credentialVersion).run();
 if(result.meta.changes!==1)throw new MemberSecurityError(409,'관리자 계정이 변경됐습니다. 다시 로그인해주세요.');
}
export async function smsSettingsView(){const value=await readSmsConfiguration();return {configured:!!value,sender:value?.sender??null,apiKeyHint:value?'••••'+value.apiKey.slice(-4):null};}
/** One provider dispatch, no retry. Codes, recipients and provider responses are never logged. */
export async function sendVerificationSms(configuration:SmsConfiguration,phone:string,code:string){
 if(!/^\+8210\d{8}$/.test(phone)||!/^\d{6}$/.test(code))throw new MemberSecurityError(400,'인증 요청을 확인해주세요.');
 const date=new Date().toISOString(),salt=bytesToBase64(crypto.getRandomValues(new Uint8Array(16))).replace(/[^a-zA-Z0-9]/g,'');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(configuration.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(date+salt))),byte=>byte.toString(16).padStart(2,'0')).join('');
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetch('https://api.solapi.com/messages/v4/send-many/detail',{method:'POST',redirect:'error',signal:controller.signal,headers:{'content-type':'application/json',authorization:`HMAC-SHA256 apiKey=${configuration.apiKey}, date=${date}, salt=${salt}, signature=${signature}`},body:JSON.stringify({messages:[{to:'0'+phone.slice(3),from:configuration.sender,type:'SMS',text:`[YOOFAM] 인증번호 ${code} (5분). 타인에게 알려주지 마세요.`}],allowDuplicates:false})});
  if(!response.ok)throw Error('provider-rejected');
  const text=await response.text();if(text.length>65536)throw Error('provider-size');
  const data=JSON.parse(text) as {failedMessageList?:unknown[];messageList?:{statusCode?:string;messageId?:string}[];groupInfo?:{count?:{registeredSuccess?:number;registeredFailed?:number}}};
  if((data.failedMessageList?.length??0)>0||data.groupInfo?.count?.registeredFailed||data.messageList?.length!==1||data.messageList[0].statusCode!=='2000'||typeof data.messageList[0].messageId!=='string')throw Error('provider-ack');
 }catch{throw new MemberSecurityError(503,'인증문자 발송을 확인하지 못했습니다. 잠시 후 다시 요청하거나 관리자에게 문의해주세요.');}
 finally{clearTimeout(timeout);}
}
