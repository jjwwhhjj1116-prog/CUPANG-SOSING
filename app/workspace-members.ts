export type WorkspaceMember = { id: string; email: string; role: 'admin'|'member'; status: 'pending'|'approved'|'rejected'|'suspended'; companyCode: string; companyName: string };
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
