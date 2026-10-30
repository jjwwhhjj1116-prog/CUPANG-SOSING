export type WorkspaceMember = { id: string; email: string; role: 'admin'|'member'; status: 'pending'|'approved'|'rejected'|'suspended'; companyCode: string; companyName: string; loginId?:string|null; name?:string; phoneNumber?:string; phoneVerifiedAt?:string|null; registrationVersion?:number; createdAt?:string };
/** Existing native accounts retain their member IDs, credentials and assigned companies. */
export const WORKSPACE_ACCOUNTS = [
 {email:'jwhj1116@kakao.com',role:'admin',companyCode:'A01526306',companyName:'유앤채'},
 {email:'unari8484@gmail.com',role:'member',companyCode:'A01464742',companyName:'와이홉'},
] as const;
export function workspaceAccount(email:unknown){
 return typeof email==='string'?WORKSPACE_ACCOUNTS.find(account=>account.email===email.trim().toLowerCase())??null:null;
}
export function matchesWorkspaceAccount(member:Pick<WorkspaceMember,'email'|'role'|'companyCode'|'companyName'|'loginId'|'registrationVersion'>){
 const account=workspaceAccount(member.email);
 if(account)return (member.registrationVersion??0)===0&&member.role===account.role&&member.companyCode===account.companyCode&&member.companyName===account.companyName;
 return member.registrationVersion===1&&member.role==='member'&&member.companyCode===''&&member.companyName===''&&typeof member.loginId==='string'&&member.loginId===member.email&&member.loginId===member.loginId.trim().toLowerCase()&&!reservedMemberLoginId(member.loginId);
}
/** Email identities remain usable; a short alias of a seeded account is reserved. */
export function memberLoginId(value:unknown){
 if(typeof value!=='string'||value.length>254)throw Error('아이디를 확인해주세요.');
 const normalized=value.trim().toLowerCase();
 if(!/^[a-z0-9][a-z0-9._-]{3,63}$/.test(normalized)&&!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(normalized))throw Error('아이디는 영문·숫자·점·밑줄·하이픈 4~64자 또는 이메일로 입력해주세요.');
 return normalized;
}
export function reservedMemberLoginId(value:string){return WORKSPACE_ACCOUNTS.some(account=>value===account.email||value===account.email.split('@')[0]);}
export function memberName(value:unknown){
 if(typeof value!=='string'||!value.trim()||value.trim().length>80||/[\u0000-\u001f\u007f]/.test(value))throw Error('이름을 1~80자로 입력해주세요.');
 return value.trim();
}
export function normalizeMemberPhone(value:unknown){
 if(typeof value!=='string'||value.length>40||!/^[+0-9 ()-]+$/.test(value))throw Error('휴대전화번호를 확인해주세요.');
 const phone=value.replace(/[ ()-]/g,'');
 if(/^010\d{8}$/.test(phone))return '+82'+phone.slice(1);
 if(/^\+8210\d{8}$/.test(phone))return phone;
 throw Error('010 휴대전화번호를 입력해주세요.');
}
export function memberEmail(value: unknown) {
 if(typeof value!=='string'||value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))throw Error('이메일을 확인해주세요.');
 return value.trim().toLowerCase();
}
export function memberCompany(value:unknown){
 if(typeof value!=='string'||!value.trim()||value.length>200||/[\u0000-\u001f\u007f]/.test(value))throw Error('회사코드와 회사명을 입력해주세요.');
 return value.trim();
}
export function validPassword(value:unknown): asserts value is string {
 if(typeof value!=='string'||value.length<10||value.length>128)throw Error('비밀번호는 10~128자로 입력해주세요.');
}
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export async function tokenHash(value:string){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
export function newToken(){return hex(crypto.getRandomValues(new Uint8Array(32)).buffer);}
export async function passwordHash(password:string,pepper:string,salt=newToken()){
 validPassword(password);
 if(pepper.length<32)throw Error('로그인 서버 설정이 필요합니다.');
 const mac=await crypto.subtle.importKey('raw',new TextEncoder().encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const input=await crypto.subtle.sign('HMAC',mac,new TextEncoder().encode(password));
 const key=await crypto.subtle.importKey('raw',input,'PBKDF2',false,['deriveBits']);
 const hash=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256);
 return `pbkdf2-sha256-hmac-v1$${salt}$${hex(hash)}`;
}
export async function verifyPassword(password:string,stored:string,pepper:string){
 if(!/^pbkdf2-sha256-hmac-v1\$[a-f0-9]{64}\$[a-f0-9]{64}$/.test(stored))return false;
 const candidate=await passwordHash(password,pepper,stored.split('$')[1]);
 let difference=0;for(let i=0;i<stored.length;i++)difference|=stored.charCodeAt(i)^candidate.charCodeAt(i);
 return difference===0;
}
