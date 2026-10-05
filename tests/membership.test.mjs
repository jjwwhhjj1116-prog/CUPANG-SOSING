import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
const cryptoEnv={crypto,TextEncoder,TextDecoder,URL,Response,Request};
function runtime({authenticate=false}={}){
 const sql=new DatabaseSync(':memory:');sql.exec(fs.readFileSync('db/migrations/0009_members.sql','utf8'));
 const DB={prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)??null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return {meta:sql.prepare(query).run(...args)};}};},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const env={DB,YOOFAM_AUTH_ENABLED:'true',YOOFAM_PASSWORD_PEPPER:'fixture-pepper-with-at-least-32-characters'};let user=null;const cache=new Map();
 class Reply extends Response {cookieWrites=[];cookies={set:(name,value,options)=>this.cookieWrites.push({name,value,options})};static json(body,init){return new Reply(JSON.stringify(body),init);}}
 function load(file){if(cache.has(file))return cache.get(file);const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{...cryptoEnv,exports,process:{env:{NODE_ENV:'production'}},require(name){if(name==='cloudflare:workers')return {env};if(name==='next/headers')return {headers:async()=>new Headers({cookie:env.TEST_COOKIE??''})};if(name==='next/navigation')return {redirect:()=>{throw Error('redirect');}};if(name==='next/server')return {NextResponse:Reply};if(name==='@/app/chatgpt-auth'&&!authenticate)return {getChatGPTUser:async()=>user};if(name.startsWith('@/'))return load(name.slice(2)+'.ts');throw Error(name);}});cache.set(file,exports);return exports;}
 const helper=load('app/workspace-members.ts'),store=load('db/members.ts'),route=load('app/api/membership/route.ts');
 function insert(id,role,status,passwordHash='unused',overrides={}){const account=helper.WORKSPACE_ACCOUNTS.find(value=>value.role===role);sql.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,overrides.email??(id==='second'?'unlisted@example.test':account.email),passwordHash,role,status,overrides.companyCode??account.companyCode,overrides.companyName??account.companyName,'now','now');}
 const post=(body,origin='https://app.test')=>route.POST(new Request('https://app.test/api/membership',{method:'POST',headers:{origin,'content-type':'application/json',cookie:env.TEST_COOKIE??''},body:JSON.stringify(body)}));
 return {sql,env,helper,store,route,insert,post,load,setUser(value){user=value;}};
}
test('password storage is salted, pepper bound and never plaintext',async()=>{
 const r=runtime(),password='fixture-password-123';
 const hash=await r.helper.passwordHash(password,r.env.YOOFAM_PASSWORD_PEPPER);
 assert.ok(!hash.includes(password));assert.notEqual(hash,await r.helper.passwordHash(password,r.env.YOOFAM_PASSWORD_PEPPER));
 assert.equal(await r.helper.verifyPassword(password,hash,r.env.YOOFAM_PASSWORD_PEPPER),true);
 assert.equal(await r.helper.verifyPassword('incorrect-password',hash,r.env.YOOFAM_PASSWORD_PEPPER),false);
 assert.equal(await r.helper.verifyPassword(password,hash,'another-pepper-with-at-least-32-chars'),false);
 r.sql.close();
});
test('only the designated member can be approved; suspension revokes sessions and never opens a third account slot',async()=>{
 const r=runtime();try{
  r.insert('admin','admin','approved');r.insert('first','member','pending');r.insert('second','member','pending');
  assert.equal(await r.store.reviewMember('first','second','approve'),false);
  assert.equal(await r.store.reviewMember('admin','first','approve'),true);
  assert.equal(await r.store.reviewMember('admin','second','approve'),false);
  const token=await r.store.createSession('first');assert.equal((await r.store.sessionMember(`yoofam_session=${token}`)).id,'first');
  assert.equal(await r.store.sessionMember('yoofam_session=forged'),null);
  assert.equal(await r.store.reviewMember('admin','first','suspend'),true);
  assert.equal(await r.store.sessionMember(`yoofam_session=${token}`),null);
  assert.equal(await r.store.reviewMember('admin','second','approve'),false);
  assert.equal(await r.store.reviewMember('admin','first','approve'),true);
  assert.equal(await r.store.sessionMember(`yoofam_session=${token}`),null);
  assert.equal(r.sql.prepare('SELECT count(*) n FROM member_audit').get().n,3);
 }finally{r.sql.close();}
});

test('public signup cannot create or replace either designated account or a third account',async()=>{
 const r=runtime();try{
  r.insert('admin','admin','approved');r.insert('member','member','approved');
  const before=r.sql.prepare('SELECT * FROM members ORDER BY id').all();
  for(const email of ['new@example.test','jwhj1116@kakao.com','unari8484@gmail.com']){
   const response=await r.post({action:'signup',email,password:'fixture-password-123',companyCode:'A01526306',companyName:'유앤채',role:'admin',status:'approved'});
   assert.equal(response.status,403);assert.deepEqual(r.sql.prepare('SELECT * FROM members ORDER BY id').all(),before);
  }
 }finally{r.sql.close();}
});

test('admin listing never exposes password hashes and ordinary members cannot approve',async()=>{
 const r=runtime();r.insert('admin','admin','approved');r.insert('member','member','pending');
 assert.equal((await r.route.GET()).status,401);
 r.setUser({userId:'member',membership:{id:'member',role:'member'}});
 assert.equal((await r.post({action:'approve',memberId:'member'})).status,403);
 r.setUser({userId:'admin',membership:{id:'admin',role:'admin'}});
 const response=await r.route.GET(),body=await response.json();assert.equal(body.members.length,2);assert.equal(JSON.stringify(body).includes('password_hash'),false);
 assert.equal((await r.post({action:'approve',memberId:'member'},'https://other.test')).status,403);
 assert.equal((await r.post({action:'approve',memberId:'member'})).status,200);r.sql.close();
});
test('sessions expire and suspended members cannot use a surviving token',async()=>{
 const r=runtime();r.insert('admin','admin','approved');const token=await r.store.createSession('admin');
 r.sql.prepare('UPDATE member_sessions SET expires_at=0').run();assert.equal(await r.store.sessionMember(`yoofam_session=${token}`),null);
 const next=await r.store.createSession('admin');r.sql.prepare("UPDATE members SET status='suspended'").run();assert.equal(await r.store.sessionMember(`yoofam_session=${next}`),null);r.sql.close();
});
test('rate limit counts attempts atomically and does not retain raw keys',async()=>{
 const r=runtime();for(let i=0;i<8;i++)assert.equal(await r.store.rateLimit('private-email@example.test',8),true);
 assert.equal(await r.store.rateLimit('private-email@example.test',8),false);
 assert.notEqual(r.sql.prepare('SELECT key FROM member_rate_limits').get().key,'private-email@example.test');r.sql.close();
});

test('native login identity resolves from approved session only and never falls back to Access',async()=>{
 const r=runtime();r.insert('admin','admin','approved');
 const auth=r.load('app/chatgpt-auth.ts');assert.equal(await auth.getChatGPTUser(),null);
 await assert.rejects(()=>auth.getWorkspaceOwnerId());
 r.env.TEST_COOKIE=`yoofam_session=${await r.store.createSession('admin')}`;
 assert.equal((await auth.getChatGPTUser()).membership.role,'admin');assert.equal(await auth.getWorkspaceOwnerId(),'admin');
 r.sql.prepare("UPDATE members SET status='suspended'").run();assert.equal(await auth.getChatGPTUser(),null);r.sql.close();
});

test('reactivation requires the exact assigned company and never revives revoked sessions',async()=>{
 const r=runtime();try{
  r.insert('admin','admin','approved');r.insert('member','member','approved');
  const token=await r.store.createSession('member');assert.equal(await r.store.reviewMember('admin','member','suspend'),true);
  for(const [code,name] of [['',''],['A01526306','유앤채'],['A01464742','유앤채']]){
   r.sql.prepare("UPDATE members SET company_code=?,company_name=? WHERE id='member'").run(code,name);
   assert.equal(await r.store.reviewMember('admin','member','approve'),false);
  }
  assert.equal(await r.store.updateMemberCompany('admin','member','A01464742','와이홉'),true);
  assert.equal(await r.store.reviewMember('admin','member','approve'),true);
  assert.equal(await r.store.sessionMember(`yoofam_session=${token}`),null);
 }finally{r.sql.close();}
});

test('company repair is limited to the assigned company, audited and revokes only repaired member sessions',async()=>{
 const r=runtime();try{
  r.insert('admin','admin','approved');r.insert('member','member','approved');r.insert('second','member','approved');
  const adminToken=await r.store.createSession('admin'),token=await r.store.createSession('member');
  r.setUser({userId:'admin',membership:{id:'admin',role:'admin'}});
  for(const [id,code,name] of [['admin','A01464742','와이홉'],['member','A01526306','유앤채'],['second','A01464742','와이홉']]){
   assert.equal(await r.store.updateMemberCompany('admin',id,code,name),false);
   assert.equal((await r.post({action:'company',memberId:id,companyCode:code,companyName:name})).status,403);
  }
  assert.equal((await r.post({action:'company',memberId:'missing',companyCode:'A01526306',companyName:'유앤채'})).status,404);
  assert.equal(r.sql.prepare('SELECT count(*) n FROM member_audit').get().n,0);
  assert.ok(await r.store.sessionMember(`yoofam_session=${token}`));
  r.sql.prepare("UPDATE members SET company_code='',company_name='' WHERE id='member'").run();
  assert.equal(await r.store.sessionMember(`yoofam_session=${token}`),null);
  const response=await r.post({action:'company',memberId:'member',companyCode:' A01464742 ',companyName:' 와이홉 '});
  assert.equal(response.status,200);assert.equal((await response.json()).reauthenticate,false);
  assert.equal(r.sql.prepare("SELECT count(*) n FROM member_sessions WHERE member_id='member'").get().n,0);
  assert.ok(await r.store.sessionMember(`yoofam_session=${adminToken}`));
  assert.equal(r.sql.prepare('SELECT count(*) n FROM member_audit').get().n,1);
  assert.equal(r.sql.prepare("SELECT company_code FROM members WHERE id='member'").get().company_code,'A01464742');
  assert.equal((await r.post({action:'company',companyCode:'A01526306',companyName:'유앤채'})).status,200);
  assert.ok(await r.store.sessionMember(`yoofam_session=${adminToken}`));
 }finally{r.sql.close();}
});

test('both exact email role company assignments are required for login and surviving sessions',async()=>{
 for(const role of ['admin','member']){
  const r=runtime({authenticate:true});try{
   const password='fixture-password-123',account=r.helper.WORKSPACE_ACCOUNTS.find(value=>value.role===role);
   r.insert('self',role,'approved',await r.helper.passwordHash(password,r.env.YOOFAM_PASSWORD_PEPPER));
   const response=await r.post({action:'login',email:account.email.toUpperCase(),password});assert.equal(response.status,200);
   const token=response.cookieWrites[0].value;r.env.TEST_COOKIE='yoofam_session='+token;
   assert.equal((await r.route.GET()).status,200);
   for(const changes of [{email:'other@example.test'},{company_code:role==='admin'?'A01464742':'A01526306',company_name:role==='admin'?'와이홉':'유앤채'},{role:role==='admin'?'member':'admin'}]){
    const columns=Object.keys(changes);r.sql.prepare(`UPDATE members SET ${columns.map(key=>key+'=?').join(',')} WHERE id='self'`).run(...Object.values(changes));
    assert.equal(await r.store.sessionMember(r.env.TEST_COOKIE),null);
    assert.equal(await r.store.createSession('self'),null);assert.equal(await r.store.rotateSession(r.env.TEST_COOKIE,'self'),null);
    assert.equal((await r.post({action:'login',email:changes.email??account.email,password})).status,401);
    assert.equal((await r.route.GET()).status,401);
    r.sql.prepare("UPDATE members SET email=?,role=?,company_code=?,company_name=? WHERE id='self'").run(account.email,role,account.companyCode,account.companyName);
   }
  }finally{r.sql.close();}
 }
});

test('a company change after API review cannot approve a now-mismatched row or occupy the second account slot',async()=>{
 const r=runtime();try{
  r.insert('admin','admin','approved');r.insert('member','member','pending');r.setUser({userId:'admin',membership:{id:'admin',role:'admin'}});
  const originalBatch=r.env.DB.batch;
  r.env.DB.batch=async statements=>{r.sql.prepare("UPDATE members SET company_name='유앤채' WHERE id='member'").run();return originalBatch(statements);};
  assert.equal((await r.post({action:'approve',memberId:'member'})).status,409);
  assert.equal(r.sql.prepare("SELECT status FROM members WHERE id='member'").get().status,'pending');
  assert.equal(r.sql.prepare("SELECT count(*) n FROM members WHERE status='approved'").get().n,1);assert.equal(r.sql.prepare('SELECT count(*) n FROM member_audit').get().n,0);
 }finally{r.sql.close();}
});

test('native login defaults to 30 days and explicit remember choices match secure cookie and DB expiry',async()=>{
 const r=runtime({authenticate:true});try{
  const password='fixture-password-123',hash=await r.helper.passwordHash(password,r.env.YOOFAM_PASSWORD_PEPPER);
  r.insert('member','member','approved',hash);
  for(const [rememberMe,seconds] of [[undefined,30*24*60*60],[true,30*24*60*60],[false,8*60*60]]){
   const before=Date.now(),response=await r.post({action:'login',email:'unari8484@gmail.com',password,...rememberMe===undefined?{}:{rememberMe}}),after=Date.now();
   assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,rememberMe:rememberMe!==false});assert.equal(response.cookieWrites.length,1);
   const cookie=response.cookieWrites[0];assert.equal(cookie.name,'yoofam_session');assert.match(cookie.value,/^[a-f0-9]{64}$/);
   assert.deepEqual(JSON.parse(JSON.stringify(cookie.options)),{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:seconds});
   const row=r.sql.prepare('SELECT * FROM member_sessions WHERE token_hash=?').get(await r.helper.tokenHash(cookie.value));
   assert.equal(row.member_id,'member');assert.ok(row.expires_at>=before+seconds*1000&&row.expires_at<=after+seconds*1000);assert.notEqual(row.token_hash,cookie.value);
   r.env.TEST_COOKIE='yoofam_session='+cookie.value;assert.equal((await r.route.GET()).status,200);
  }
 }finally{r.sql.close();}
});

test('login and session preferences reject nonboolean values without issuing or replacing sessions',async()=>{
 const r=runtime({authenticate:true});try{
  const password='fixture-password-123';r.insert('member','member','approved',await r.helper.passwordHash(password,r.env.YOOFAM_PASSWORD_PEPPER));
  const token=await r.store.createSession('member',false);r.env.TEST_COOKIE='yoofam_session='+token;
  const before=r.sql.prepare('SELECT * FROM member_sessions').all();
  for(const rememberMe of [null,'true','false',1,0,{},[]])for(const action of ['login','remember-session']){
   const response=await r.post({action,email:'unari8484@gmail.com',password,rememberMe});assert.equal(response.status,400);assert.equal(response.cookieWrites.length,0);
   assert.deepEqual(r.sql.prepare('SELECT * FROM member_sessions').all(),before);
  }
 }finally{r.sql.close();}
});

test('admin and member can persist or shorten only their current session without password and revoke its old token',async()=>{
 for(const role of ['admin','member']){
  const r=runtime({authenticate:true});try{
   r.insert('self',role,'approved');r.insert('other',role==='admin'?'member':'admin','approved');
   let token=await r.store.createSession('self',false);const other=await r.store.createSession('other'),parallel=await r.store.createSession('self',false);
   for(const [rememberMe,seconds] of [[undefined,30*24*60*60],[false,8*60*60],[true,30*24*60*60]]){
    r.env.TEST_COOKIE='yoofam_session='+token;const old=token,before=Date.now(),response=await r.post({action:'remember-session',...rememberMe===undefined?{}:{rememberMe}}),after=Date.now();
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,rememberMe:rememberMe!==false});assert.equal(response.cookieWrites.length,1);
    const cookie=response.cookieWrites[0];token=cookie.value;assert.notEqual(token,old);assert.equal(cookie.options.maxAge,seconds);assert.equal(cookie.options.httpOnly,true);assert.equal(cookie.options.secure,true);assert.equal(cookie.options.sameSite,'strict');
    const row=r.sql.prepare('SELECT * FROM member_sessions WHERE token_hash=?').get(await r.helper.tokenHash(token));assert.equal(row.member_id,'self');assert.ok(row.expires_at>=before+seconds*1000&&row.expires_at<=after+seconds*1000);
    assert.equal(await r.store.sessionMember('yoofam_session='+old),null);assert.equal((await r.store.sessionMember('yoofam_session='+token)).id,'self');
    assert.equal((await r.store.sessionMember('yoofam_session='+other)).id,'other');assert.equal((await r.store.sessionMember('yoofam_session='+parallel)).id,'self');assert.equal(r.sql.prepare('SELECT count(*) n FROM member_sessions').get().n,3);
    // Neither a normal status read nor an already consumed request can rotate again.
    const state=r.sql.prepare('SELECT * FROM member_sessions ORDER BY token_hash').all();assert.equal((await r.post({action:'remember-session'})).status,401);
    r.env.TEST_COOKIE='yoofam_session='+token;assert.equal((await r.route.GET()).status,200);assert.deepEqual(r.sql.prepare('SELECT * FROM member_sessions ORDER BY token_hash').all(),state);
   }
   const logout=await r.post({action:'logout'});assert.equal(logout.status,200);assert.equal(logout.cookieWrites[0].options.maxAge,0);assert.equal(await r.store.sessionMember('yoofam_session='+token),null);
  }finally{r.sql.close();}
 }
});

test('remember-session preserves existing tokens on foreign origin or another requested account',async()=>{
 const r=runtime({authenticate:true});try{
  r.insert('admin','admin','approved');r.insert('member','member','approved');const token=await r.store.createSession('admin');r.env.TEST_COOKIE='yoofam_session='+token;
  const before=r.sql.prepare('SELECT * FROM member_sessions').all();
  for(const [body,origin] of [[{action:'remember-session'},'https://foreign.test'],[{action:'remember-session',memberId:'member'},'https://app.test']]){
   const response=await r.post(body,origin);assert.equal(response.status,403);assert.equal(response.cookieWrites.length,0);assert.deepEqual(r.sql.prepare('SELECT * FROM member_sessions').all(),before);
  }
 }finally{r.sql.close();}
});

test('remember-session requires an unexpired approved native session, including changes after authentication',async()=>{
 for(const mode of ['missing','malformed','expired','pending','suspended','rejected','revoked-after-auth','suspended-after-auth','expired-after-auth']){
  const r=runtime({authenticate:true});try{
   r.insert('member','member','approved');const token=await r.store.createSession('member');r.env.TEST_COOKIE='yoofam_session='+token;
   if(mode==='missing')r.env.TEST_COOKIE='';else if(mode==='malformed')r.env.TEST_COOKIE='yoofam_session=forged';else if(mode==='expired')r.sql.prepare('UPDATE member_sessions SET expires_at=0').run();else if(['pending','suspended','rejected'].includes(mode))r.sql.prepare('UPDATE members SET status=?').run(mode);
   if(mode.endsWith('-after-auth')){
    const original=r.env.DB.prepare;r.env.DB.prepare=query=>{
     const statement=original(query),first=statement.first;
     if(query.includes('JOIN members'))statement.first=async()=>{const result=await first();if(mode==='revoked-after-auth')r.sql.prepare('DELETE FROM member_sessions').run();else if(mode==='expired-after-auth')r.sql.prepare('UPDATE member_sessions SET expires_at=0').run();else r.sql.prepare("UPDATE members SET status='suspended'").run();return result;};
     return statement;
    };
   }
   const response=await r.post({action:'remember-session'});assert.equal(response.status,401,mode);assert.equal(response.cookieWrites.length,0,mode);
   const oldHash=await r.helper.tokenHash(token),sessions=r.sql.prepare('SELECT * FROM member_sessions').all();assert.ok(sessions.every(row=>row.token_hash===oldHash));
  }finally{r.sql.close();}
 }
});

test('concurrent session preferences consume the old token once and issue only one replacement cookie',async()=>{
 const r=runtime({authenticate:true});try{
  r.insert('member','member','approved');const token=await r.store.createSession('member',false);r.env.TEST_COOKIE='yoofam_session='+token;
  const responses=await Promise.all([r.post({action:'remember-session',rememberMe:true}),r.post({action:'remember-session',rememberMe:false})]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,401]);assert.equal(responses.flatMap(response=>response.cookieWrites).length,1);
  const success=responses.find(response=>response.status===200),cookie=success.cookieWrites[0],body=await success.json();assert.equal(cookie.options.maxAge,body.rememberMe?30*24*60*60:8*60*60);
  assert.equal(await r.store.sessionMember('yoofam_session='+token),null);assert.equal((await r.store.sessionMember('yoofam_session='+cookie.value)).id,'member');assert.equal(r.sql.prepare('SELECT count(*) n FROM member_sessions').get().n,1);
 }finally{r.sql.close();}
});

test('a login whose approval is revoked before session insertion receives no token',async()=>{
 const r=runtime({authenticate:true});try{
  const password='fixture-password-123';r.insert('member','member','approved',await r.helper.passwordHash(password,r.env.YOOFAM_PASSWORD_PEPPER));
  const original=r.env.DB.batch;r.env.DB.batch=statements=>{r.sql.prepare("UPDATE members SET status='suspended' WHERE id='member'").run();return original(statements);};
  const response=await r.post({action:'login',email:'unari8484@gmail.com',password,rememberMe:true});assert.equal(response.status,401);assert.equal(response.cookieWrites.length,0);assert.equal(r.sql.prepare('SELECT count(*) n FROM member_sessions').get().n,0);
 }finally{r.sql.close();}
});

test('inflight login with the previous password cannot recreate a session after provisioning replaces credentials',async()=>{
 const r=runtime({authenticate:true});try{
  const previous='fixture-previous-password',replacement='fixture-replacement-password';
  r.insert('member','member','approved',await r.helper.passwordHash(previous,r.env.YOOFAM_PASSWORD_PEPPER));
  const nextHash=await r.helper.passwordHash(replacement,r.env.YOOFAM_PASSWORD_PEPPER),original=r.env.DB.batch;
  r.env.DB.batch=statements=>{r.sql.prepare("UPDATE members SET password_hash=? WHERE id='member'").run(nextHash);r.sql.prepare('DELETE FROM member_sessions').run();return original(statements);};
  const response=await r.post({action:'login',email:'unari8484@gmail.com',password:previous});
  assert.equal(response.status,401);assert.equal(response.cookieWrites.length,0);assert.equal(r.sql.prepare('SELECT count(*) n FROM member_sessions').get().n,0);
  r.env.DB.batch=original;const current=await r.post({action:'login',email:'unari8484@gmail.com',password:replacement});assert.equal(current.status,200);assert.equal(current.cookieWrites.length,1);
 }finally{r.sql.close();}
});
