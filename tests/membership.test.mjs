import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
const cryptoEnv={crypto,TextEncoder,TextDecoder,URL,Response,Request};
function runtime(){
 const sql=new DatabaseSync(':memory:');sql.exec(fs.readFileSync('db/migrations/0009_members.sql','utf8'));
 const DB={prepare(query){let args=[];return {bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)??null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){return {meta:sql.prepare(query).run(...args)};}};},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 const env={DB,YOOFAM_AUTH_ENABLED:'true',YOOFAM_PASSWORD_PEPPER:'fixture-pepper-with-at-least-32-characters'};let user=null;const cache=new Map();
 class Reply extends Response {cookies={set:()=>{}};static json(body,init){return new Reply(JSON.stringify(body),init);}}
 function load(file){if(cache.has(file))return cache.get(file);const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{...cryptoEnv,exports,process:{env:{NODE_ENV:'production'}},require(name){if(name==='cloudflare:workers')return {env};if(name==='next/headers')return {headers:async()=>new Headers({cookie:env.TEST_COOKIE??''})};if(name==='next/navigation')return {redirect:()=>{throw Error('redirect');}};if(name==='next/server')return {NextResponse:Reply};if(name==='@/app/chatgpt-auth')return {getChatGPTUser:async()=>user};if(name.startsWith('@/'))return load(name.slice(2)+'.ts');throw Error(name);}});cache.set(file,exports);return exports;}
 const helper=load('app/workspace-members.ts'),store=load('db/members.ts'),route=load('app/api/membership/route.ts');
 function insert(id,role,status,passwordHash='unused'){sql.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,`${id}@example.test`,passwordHash,role,status,'CODE','Company','now','now');}
 const post=(body,origin='https://app.test')=>route.POST(new Request('https://app.test/api/membership',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}));
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
test('approval requires active admin and enforces two account total; suspension revokes sessions',async()=>{
 const r=runtime();r.insert('admin','admin','approved');r.insert('first','member','pending');r.insert('second','member','pending');
 assert.equal(await r.store.reviewMember('first','second','approve'),false);
 assert.equal(await r.store.reviewMember('admin','first','approve'),true);
 assert.equal(await r.store.reviewMember('admin','second','approve'),false);
 const token=await r.store.createSession('first');assert.equal((await r.store.sessionMember(`yoofam_session=${token}`)).id,'first');
 assert.equal(await r.store.sessionMember('yoofam_session=forged'),null);
 assert.equal(await r.store.reviewMember('admin','first','suspend'),true);
 assert.equal(await r.store.sessionMember(`yoofam_session=${token}`),null);
 assert.equal(await r.store.reviewMember('admin','second','approve'),true);
 assert.equal(r.sql.prepare('SELECT count(*) n FROM member_audit').get().n,3);r.sql.close();
});
test('signup cannot set its own role or approval, duplicates cannot replace company or password',async()=>{
 const r=runtime(),body={action:'signup',email:'new@example.test',password:'fixture-password-123',companyCode:'ABC',companyName:'Example',role:'admin',status:'approved'};
 assert.equal((await r.post(body)).status,200);
 const before=r.sql.prepare('SELECT * FROM members').get();assert.equal(before.role,'member');assert.equal(before.status,'pending');
 await r.post({...body,companyCode:'OTHER',password:'replacement-password'});
 assert.deepEqual(r.sql.prepare('SELECT * FROM members').get(),before);
 assert.equal((await r.post({action:'login',email:body.email,password:body.password})).status,401);r.sql.close();
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

test('reactivation enforces capacity, requires company and never revives revoked sessions',async()=>{
 const r=runtime();r.insert('admin','admin','approved');r.insert('first','member','approved');r.insert('second','member','rejected');
 const token=await r.store.createSession('first');
 assert.equal(await r.store.reviewMember('admin','second','approve'),false);
 assert.equal(await r.store.reviewMember('admin','first','suspend'),true);
 assert.equal(await r.store.reviewMember('admin','second','approve'),true);
 assert.equal(await r.store.reviewMember('admin','first','approve'),false);
 await r.store.reviewMember('admin','second','suspend');
 r.sql.prepare("UPDATE members SET company_code='' WHERE id='first'").run();
 assert.equal(await r.store.reviewMember('admin','first','approve'),false);
 await r.store.updateMemberCompany('admin','first','NEW','New Company');
 assert.equal(await r.store.reviewMember('admin','first','approve'),true);
 assert.equal(await r.store.sessionMember(`yoofam_session=${token}`),null);r.sql.close();
});

test('company reassignment is admin only, audited and revokes only changed member sessions',async()=>{
 const r=runtime();r.insert('admin','admin','approved');r.insert('member','member','approved');
 const adminToken=await r.store.createSession('admin'),token=await r.store.createSession('member');
 assert.equal(await r.store.updateMemberCompany('member','admin','FORGED','Forged'),false);
 assert.equal(await r.store.updateMemberCompany('admin','member','CODE','Company'),false);
 assert.equal(r.sql.prepare('SELECT count(*) n FROM member_audit').get().n,0);
 assert.ok(await r.store.sessionMember(`yoofam_session=${token}`));
 r.setUser({userId:'member',membership:{id:'member',role:'member'}});
 assert.equal((await r.post({action:'company',memberId:'member',companyCode:'NEW',companyName:'New'})).status,403);
 r.setUser({userId:'admin',membership:{id:'admin',role:'admin'}});
 const response=await r.post({action:'company',memberId:'member',companyCode:'NEW',companyName:'New'});
 assert.equal(response.status,200);assert.equal((await response.json()).reauthenticate,false);
 assert.equal(await r.store.sessionMember(`yoofam_session=${token}`),null);
 assert.ok(await r.store.sessionMember(`yoofam_session=${adminToken}`));
 assert.equal(r.sql.prepare('SELECT count(*) n FROM member_audit').get().n,1);
 assert.equal(r.sql.prepare("SELECT company_code FROM members WHERE id='member'").get().company_code,'NEW');
 assert.equal((await r.post({action:'company',memberId:'missing',companyCode:'NEW',companyName:'New'})).status,404);
 const own=await r.post({action:'company',companyCode:'ADMIN',companyName:'Admin'});
 assert.equal((await own.json()).reauthenticate,true);
 assert.equal(await r.store.sessionMember(`yoofam_session=${adminToken}`),null);r.sql.close();
});
