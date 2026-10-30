import test from 'node:test';
import assert from 'node:assert/strict';
import {memberPhoneSecurityFixture} from './helpers/member-phone-security.mjs';

async function json(response,status=200){assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');return response.json();}
const enrollment=(f,phone='010-1234-5678')=>f.postAccount({action:'phone-start',expectedOwnerId:'member',phone,currentPassword:f.password});
const verifyEnrollment=(f,challengeId,code=f.code())=>f.postAccount({action:'phone-verify',expectedOwnerId:'member',challengeId,code});
const recoveryStart=(purpose='find-id',patch={})=>({action:'start',purpose,name:'기존회원',phone:'010-1234-5678',...(purpose==='reset-password'?{loginId:'unari8484'}:{}),...patch});
async function enroll(f){await f.login();const challenge=await json(await enrollment(f));const code=f.code();await json(await verifyEnrollment(f,challenge.challengeId,code));await f.login();return {challenge,code};}
async function resetToken(f){const start=await json(await f.postRecovery(recoveryStart('reset-password')));await f.flush();const verification=await json(await f.postRecovery({action:'verify',challengeId:start.challengeId,code:f.code()}));return verification.resetToken;}

test('unconfigured SMS fails closed without challenges or delivery while signup remains pending and usable',async()=>{
 const f=await memberPhoneSecurityFixture();try{
  await f.login();const view=await json(await f.account.GET());assert.equal(view.smsConfigured,false);
  await json(await enrollment(f),503);await json(await f.postRecovery(recoveryStart()),503);assert.equal(f.messages.length,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM member_phone_challenges').get().n,0);
  const signup=await json(await f.postMembership({action:'signup',loginId:'independent.signup',password:'synthetic-signup-password',name:'가입회원',phone:'010-9876-5432'}),201);assert.equal(signup.status,'pending');
 }finally{f.close();}
});
test('only the designated admin can store AES-GCM SMS configuration and settings responses never return secrets',async()=>{
 const f=await memberPhoneSecurityFixture();try{
  assert.equal((await f.settings.GET()).status,403);await f.login();assert.equal((await f.postSettings({expectedOwnerId:'member',currentPassword:f.password,...f.sms})).status,403);
  await f.login('admin');await json(await f.postSettings({expectedOwnerId:'admin',currentPassword:'incorrect-current-password',...f.sms}),400);
  const response=await json(await f.postSettings({expectedOwnerId:'admin',currentPassword:f.password,...f.sms}));assert.equal(response.configured,true);assert.equal(response.sender,f.sms.sender);
  const row=f.sql.prepare('SELECT * FROM member_sms_settings').get(),serialized=JSON.stringify(row);assert.equal(row.updated_by,'admin');assert.ok(!serialized.includes(f.sms.apiKey));assert.ok(!serialized.includes(f.sms.apiSecret));assert.ok(!serialized.includes(f.sms.sender));
  const view=await json(await f.settings.GET());for(const secret of [f.sms.apiKey,f.sms.apiSecret,row.ciphertext,row.nonce])assert.ok(!JSON.stringify(view).includes(secret));assert.equal(view.apiKeyHint,'••••'+f.sms.apiKey.slice(-4));
  const first=row.nonce;await json(await f.postSettings({expectedOwnerId:'admin',currentPassword:f.password,...f.sms}));assert.notEqual(f.sql.prepare('SELECT nonce FROM member_sms_settings').get().nonce,first);
  const decrypted=await f.smsModule.readSmsConfiguration();assert.equal(decrypted.apiSecret,f.sms.apiSecret);
  f.sql.prepare("UPDATE member_sms_settings SET ciphertext='tampered'").run();await json(await f.settings.GET(),503);
 }finally{f.close();}
});
test('phone enrollment checks current password, hides OTP, binds the owner and consumes the code once while revoking all sessions',async()=>{
 const f=await memberPhoneSecurityFixture({configured:true});try{
  const token=await f.login(),parallel=await f.store.createSession('member');await json(await f.postAccount({action:'phone-start',expectedOwnerId:'member',phone:'010-1234-5678',currentPassword:'incorrect-current-password'}),400);assert.equal(f.messages.length,0);
  const started=await json(await enrollment(f)),code=f.code();assert.match(code,/^\d{6}$/);assert.ok(!JSON.stringify(started).includes(code));const stored=f.sql.prepare('SELECT * FROM member_phone_challenges').get();assert.notEqual(stored.code_hash,code);assert.ok(!JSON.stringify(stored).includes('인증번호'));
  assert.equal(f.messages.length,1);assert.equal(f.messages[0].body.messages[0].to,'01012345678');assert.ok(!f.messages[0].options.headers.authorization.includes(f.sms.apiSecret));
  await f.login('admin');await json(await f.postAccount({action:'phone-verify',expectedOwnerId:'admin',challengeId:started.challengeId,code}),400);
  await f.login();const response=await verifyEnrollment(f,started.challengeId,code),verified=await json(response);assert.equal(verified.reauthenticate,true);assert.equal(response.cookieWrites[0].options.maxAge,0);
  const member=f.sql.prepare("SELECT * FROM members WHERE id='member'").get();assert.equal(member.phone_number,'+821012345678');assert.ok(member.phone_verified_at);assert.equal(member.credential_version,1);assert.equal(await f.store.sessionMember('yoofam_session='+token),null);assert.equal(await f.store.sessionMember('yoofam_session='+parallel),null);
  await f.login();await json(await verifyEnrollment(f,started.challengeId,code),400);assert.equal(f.sql.prepare("SELECT count(*) n FROM member_audit WHERE action='phone-verified'").get().n,1);
 }finally{f.close();}
});
test('phone verification expires, caps attempts at five and rejects replaced passwords or suspended approvals',async()=>{
 for(const mode of ['expired','attempts','password-change','suspend-resume']){
  const f=await memberPhoneSecurityFixture({configured:true});try{
   await f.login();const started=await json(await enrollment(f)),code=f.code();
   if(mode==='expired')f.advance(5*60000+1);
   if(mode==='attempts'){const wrong=code==='000000'?'000001':'000000';for(let index=0;index<5;index++)await json(await verifyEnrollment(f,started.challengeId,wrong),400);assert.equal(f.sql.prepare('SELECT attempts FROM member_phone_challenges').get().attempts,5);}
   if(mode==='password-change'){await json(await f.postMembership({action:'change-password',memberId:'member',currentPassword:f.password,newPassword:'synthetic-replacement-password'}));await f.login();}
   if(mode==='suspend-resume'){assert.equal(await f.store.reviewMember('admin','member','suspend','approved'),true);assert.equal(await f.store.reviewMember('admin','member','approve','suspended'),true);await f.login();}
   await json(await verifyEnrollment(f,started.challengeId,code),400);assert.equal(f.sql.prepare("SELECT phone_verified_at FROM members WHERE id='member'").get().phone_verified_at,null);
  }finally{f.close();}
 }
});
test('public recovery gives identical generic replies for unknown or unverified identities and only sends to verified matches',async()=>{
 const known=await memberPhoneSecurityFixture({configured:true}),unknown=await memberPhoneSecurityFixture({configured:true});try{
  await enroll(known);known.advance(60001);const found=await json(await known.postRecovery(recoveryStart()));await known.flush();const code=known.code(),sent=known.messages.length;
  const missing=await json(await unknown.postRecovery(recoveryStart('find-id',{name:'존재하지않음'})));await unknown.flush();assert.equal(found.message,missing.message);assert.deepEqual(Object.keys(found).sort(),Object.keys(missing).sort());assert.equal(unknown.messages.length,0);
  const identity=await json(await known.postRecovery({action:'verify',challengeId:found.challengeId,code}));assert.equal(identity.loginId,'unari8484@gmail.com');await json(await known.postRecovery({action:'verify',challengeId:found.challengeId,code}),400);assert.equal(known.messages.length,sent);
  await json(await unknown.postRecovery({action:'verify',challengeId:missing.challengeId,code}),400);
  unknown.advance(60001);const unverified=await json(await unknown.postRecovery(recoveryStart()));await unknown.flush();assert.equal(unverified.message,found.message);assert.equal(unknown.messages.length,0);
 }finally{known.close();unknown.close();}
});
test('verified password recovery issues a hashed single-use token, uses credential CAS and revokes every old session',async()=>{
 const f=await memberPhoneSecurityFixture({configured:true});try{
  await enroll(f);f.advance(60001);const old=await f.login(),parallel=await f.store.createSession('member'),other=await f.store.createSession('admin'),token=await resetToken(f);assert.match(token,/^[a-f0-9]{64}$/);
  const challenge=f.sql.prepare("SELECT * FROM member_phone_challenges WHERE purpose='reset-password'").get();assert.notEqual(challenge.reset_token_hash,token);assert.equal(challenge.reset_token_hash,await f.helpers.tokenHash(token));
  const responses=await Promise.all([f.postRecovery({action:'reset',resetToken:token,newPassword:'first-recovery-password'}),f.postRecovery({action:'reset',resetToken:token,newPassword:'second-recovery-password'})]);assert.deepEqual(responses.map(response=>response.status).sort(),[200,400]);
  assert.equal(await f.store.sessionMember('yoofam_session='+old),null);assert.equal(await f.store.sessionMember('yoofam_session='+parallel),null);assert.ok(await f.store.sessionMember('yoofam_session='+other));assert.equal(f.sql.prepare("SELECT count(*) n FROM member_audit WHERE action='password-reset'").get().n,1);
  const member=f.sql.prepare("SELECT * FROM members WHERE id='member'").get();assert.equal(member.credential_version,2);assert.equal(await f.helpers.verifyPassword(f.password,member.password_hash,f.env.YOOFAM_PASSWORD_PEPPER),false);assert.ok((await Promise.all(['first-recovery-password','second-recovery-password'].map(password=>f.helpers.verifyPassword(password,member.password_hash,f.env.YOOFAM_PASSWORD_PEPPER)))).some(Boolean));
  await json(await f.postRecovery({action:'reset',resetToken:token,newPassword:'third-recovery-password'}),400);assert.equal(f.sql.prepare("SELECT count(*) n FROM member_phone_challenges WHERE reset_token_hash IS NOT NULL").get().n,0);
 }finally{f.close();}
});
test('recovery reset tokens expire and suspension followed by approval invalidates earlier codes and tokens',async()=>{
 for(const mode of ['expired','suspended','resumed','password-change']){
  const f=await memberPhoneSecurityFixture({configured:true});try{
   await enroll(f);f.advance(60001);const token=await resetToken(f);
   if(mode==='expired')f.advance(5*60000+1);
   if(mode==='suspended'||mode==='resumed'){assert.equal(await f.store.reviewMember('admin','member','suspend'),true);if(mode==='resumed')assert.equal(await f.store.reviewMember('admin','member','approve'),true);}
   if(mode==='password-change'){await f.login();await json(await f.postMembership({action:'change-password',currentPassword:f.password,newPassword:'synthetic-new-current-password'}));}
   await json(await f.postRecovery({action:'reset',resetToken:token,newPassword:'invalidated-recovery-password'}),400);assert.equal(f.sql.prepare("SELECT count(*) n FROM member_audit WHERE action='password-reset'").get().n,0);
  }finally{f.close();}
 }
});
test('an approved new registration can verify its own phone and recover its login ID without borrowing a seeded company',async()=>{
 const f=await memberPhoneSecurityFixture({configured:true});try{
  await json(await f.postMembership({action:'signup',loginId:'registered.phone',password:f.password,name:'신규회원',phone:'010-9876-5432'}),201);const member=f.sql.prepare("SELECT * FROM members WHERE login_id='registered.phone'").get();assert.equal(await f.store.reviewMember('admin',member.id,'approve','pending'),true);
  await f.login(member.id);const start=await json(await f.postAccount({action:'phone-start',expectedOwnerId:member.id,phone:'010-9876-5432',currentPassword:f.password}));await json(await f.postAccount({action:'phone-verify',expectedOwnerId:member.id,challengeId:start.challengeId,code:f.code()}));
  const row=f.sql.prepare('SELECT * FROM members WHERE id=?').get(member.id);assert.equal(row.company_code,'');assert.equal(row.company_name,'');assert.equal(row.credential_version,2);assert.ok(row.phone_verified_at);
  f.advance(60001);const recovery=await json(await f.postRecovery(recoveryStart('find-id',{name:'신규회원',phone:'010-9876-5432'})));await f.flush();assert.equal((await json(await f.postRecovery({action:'verify',challengeId:recovery.challengeId,code:f.code()}))).loginId,'registered.phone');
 }finally{f.close();}
});
