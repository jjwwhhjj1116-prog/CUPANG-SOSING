import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{code:'A01526306',name:'유앤채',email:'jwhj1116@kakao.com',role:'admin'},{code:'A01464742',name:'와이홉',email:'unari8484@gmail.com',role:'member'}];
const fakeKey=Buffer.from(Array.from({length:32},(_,index)=>index+1)).toString('base64'),origin='https://app.test';
function fixture(company=companies[0]){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});h.bindings.YOOFAM_CREDENTIAL_ENCRYPTION_KEY=fakeKey;
 h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('owner',company.email,'synthetic-test-only',company.role,'approved',company.code,company.name,'2026-10-29','2026-10-29');
 const api=h.load('app/api/member-connections/route.ts'),scope={ownerId:'owner',company:{code:company.code,name:company.name}};
 const body=patch=>({action:'save',expectedOwnerId:'owner',expectedCompany:scope.company,id:webcrypto.randomUUID(),expectedRevision:0,service:'supplier-hub',alias:'검수 연동',loginId:'synthetic-login',password:'synthetic-test-password',...patch});
 const post=(input,headers={})=>api.POST(new Request(origin+'/api/member-connections',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(input)}));
 const get=(query='')=>api.GET(new Request(origin+'/api/member-connections'+query));
 const rows=()=>h.sqlite.prepare('SELECT * FROM member_connections ORDER BY profile_id').all();
 const allOriginal=()=>JSON.stringify(Object.fromEntries(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name<>'member_connections' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,h.sqlite.prepare('SELECT * FROM "'+name+'"').all()])));
 return{h,api,scope,body,post,get,rows,allOriginal,close:()=>h.close()};
}
async function json(response,status=200){assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');return response.json();}
const profileKeys=['alias','createdAt','enabled','hasPassword','id','loginId','revision','service','updatedAt'];
function metadataOnly(view){assert.deepEqual(Object.keys(view).sort(),['company','ownerId','profiles']);for(const row of view.profiles)assert.deepEqual(Object.keys(row).sort(),profileKeys);}
async function decrypt(row,scope){
 const key=await webcrypto.subtle.importKey('raw',Buffer.from(fakeKey,'base64'),'AES-GCM',false,['decrypt']);
 return new TextDecoder().decode(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(row.password_nonce,'base64'),additionalData:new TextEncoder().encode(JSON.stringify(['yoofam-member-credential-v1',scope.ownerId,scope.company.code,scope.company.name,row.profile_id,row.service])),tagLength:128},key,Buffer.from(row.password_ciphertext,'base64')));
}

for(const company of companies)test(company.code+': multiple own profiles encrypt independently, keep blank passwords and disable/restore without touching business rows',async()=>{
 const f=fixture(company);try{
  const original=f.allOriginal(),one=f.body(),two=f.body({service:'1688',alias:'보조 계정',loginId:'other-synthetic-login'});
  const first=await json(await f.post(one));metadataOnly(first);assert.equal(first.profiles.length,1);assert.equal(first.profiles[0].hasPassword,true);assert.equal(first.profiles[0].enabled,true);
  const second=await json(await f.post(two));metadataOnly(second);assert.equal(second.profiles.length,2);const stored=f.rows();assert.notEqual(stored[0].password_nonce,stored[1].password_nonce);assert.notEqual(stored[0].password_ciphertext,stored[1].password_ciphertext);
  for(const row of stored){assert.equal(row.encryption_version,1);assert.equal(Buffer.from(row.password_nonce,'base64').length,12);assert.ok(Buffer.from(row.password_ciphertext,'base64').length>16);assert.equal(await decrypt(row,f.scope),one.password);assert.equal(JSON.stringify(row).includes(one.password),false);}
  const before=f.rows().find(row=>row.profile_id===one.id),saved=await json(await f.post({...one,expectedRevision:1,alias:'변경 별칭',password:''}));metadataOnly(saved);
  const kept=f.rows().find(row=>row.profile_id===one.id);assert.equal(kept.password_ciphertext,before.password_ciphertext);assert.equal(kept.password_nonce,before.password_nonce);assert.equal(kept.revision,2);
  const state=enabled=>({action:'set-enabled',expectedOwnerId:'owner',expectedCompany:f.scope.company,id:one.id,expectedRevision:enabled?3:2,enabled});
  await json(await f.post(state(false)));assert.equal(f.rows().find(row=>row.profile_id===one.id).enabled,0);await json(await f.post(state(true)));assert.equal(f.rows().find(row=>row.profile_id===one.id).enabled,1);
  const viewed=await json(await f.get());metadataOnly(viewed);assert.equal(JSON.stringify(viewed).includes(one.password),false);assert.equal(f.allOriginal(),original);assert.equal(f.h.network.length,0);
 }finally{f.close();}
});

test('replacing a password rotates its nonce and AES-GCM AAD refuses owner/company/profile/service swaps',async()=>{
 const f=fixture();try{
  const input=f.body();await json(await f.post(input));const old=f.rows()[0];await json(await f.post({...input,expectedRevision:1,password:'synthetic-replacement'}));const row=f.rows()[0];
  assert.notEqual(row.password_nonce,old.password_nonce);assert.notEqual(row.password_ciphertext,old.password_ciphertext);assert.equal(await decrypt(row,f.scope),'synthetic-replacement');
  for(const [other,scope] of [[row,{...f.scope,ownerId:'other'}],[row,{...f.scope,company:{code:'A01464742',name:'와이홉'}}],[{...row,profile_id:webcrypto.randomUUID()},f.scope],[{...row,service:'1688'},f.scope]])await assert.rejects(decrypt(other,scope));
 }finally{f.close();}
});

test('missing, malformed or pepper-only encryption configuration fails closed with 503 before any profile data is read or written',async()=>{
 const f=fixture();try{
  for(const value of [undefined,'',Buffer.alloc(31).toString('base64'),'a'.repeat(64),fakeKey.replace('=','')]){
   f.h.bindings.YOOFAM_CREDENTIAL_ENCRYPTION_KEY=value;f.h.bindings.YOOFAM_PASSWORD_PEPPER=fakeKey;
   const read=await json(await f.get(),503);assert.equal(read.code,'MEMBER_CONNECTIONS_NOT_CONFIGURED');assert.equal(read.profiles,undefined);assert.equal((await json(await f.post(f.body()),503)).code,'MEMBER_CONNECTIONS_NOT_CONFIGURED');assert.equal(f.rows().length,0);
  }
 }finally{f.close();}
});

test('cross-origin, missing Origin, scope overrides, stale CAS, service replacement and credential export requests fail without changing any row',async()=>{
 const f=fixture();try{
  const input=f.body();await json(await f.post(input));const before=JSON.stringify(f.rows());
  for(const origin of ['https://foreign.test','null',''])await json(await f.post({...input,expectedRevision:1},{origin}),403);
  await json(await f.post({...input,expectedRevision:1},{'sec-fetch-site':'cross-site'}),403);
  for(const patch of [{expectedOwnerId:'other'},{expectedCompany:{code:'A01464742',name:'와이홉'}},{id:webcrypto.randomUUID(),expectedRevision:1},{expectedRevision:0},{expectedRevision:2},{expectedRevision:1,service:'1688'}])await json(await f.post({...input,...patch}),409);
  for(const patch of [{password:undefined},{secret:true},{expectedRevision:-1},{id:'invalid'},{service:'unknown'},{action:'delete'},{action:'reveal'}])await json(await f.post({...input,...patch}),400);
  await json(await f.get('?includePassword=true'),400);assert.equal(JSON.stringify(f.rows()),before);assert.equal(f.h.network.length,0);
 }finally{f.close();}
});

test('a suspended/changed member and an unknown third account cannot access or mutate the vault',async()=>{
 const f=fixture();try{
  const input=f.body();await json(await f.post(input));const before=JSON.stringify(f.rows());f.h.setMembershipStatus('suspended');await json(await f.get(),403);await json(await f.post({...input,expectedRevision:1}),403);
  f.h.setMembershipStatus('approved');f.h.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='owner'").run();await json(await f.get(),409);await json(await f.post({...input,expectedRevision:1}),409);
  assert.equal(JSON.stringify(f.rows()),before);
 }finally{f.close();}
 const third=fixture({code:'UNKNOWN',name:'unknown',email:'other@example.test',role:'member'});try{await json(await third.get(),403);await json(await third.post(third.body()),403);assert.equal(third.rows().length,0);}finally{third.close();}
});

test('the vault returns only own-company metadata and enforces the retained 20-profile bound',async()=>{
 const f=fixture();try{
  for(let index=0;index<20;index++)await json(await f.post(f.body({alias:'계정 '+index})));
  const before=JSON.stringify(f.rows());await json(await f.post(f.body()),409);assert.equal(JSON.stringify(f.rows()),before);
  f.h.sqlite.prepare("UPDATE member_connections SET owner_id='foreign-owner' WHERE profile_id=?").run(f.rows()[0].profile_id);
  const own=await json(await f.get());metadataOnly(own);assert.equal(own.profiles.length,19);assert.ok(own.profiles.every(row=>row.id!==JSON.parse(before)[0].profile_id));
 }finally{f.close();}
});
