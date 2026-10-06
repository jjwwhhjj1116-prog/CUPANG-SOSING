import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
import {memoryDatabase,runtimeDDL} from '../scripts/check-db-schema.mjs';

const accounts=[
 {id:'settings-admin-fixture',email:'jwhj1116@kakao.com',role:'admin',companyCode:'A01526306',companyName:'유앤채'},
 {id:'settings-member-fixture',email:'unari8484@gmail.com',role:'member',companyCode:'A01464742',companyName:'와이홉'},
];
const scope=account=>({ownerId:account.id,company:{code:account.companyCode,name:account.companyName}});

/** Native session authentication and real settings queries run only against
 * private in-memory SQLite. Tokens, owner ids, banners and passwords are fixtures. */
async function harness({native=true,production=true}={}){
 const sqlite=memoryDatabase();for(const statement of runtimeDDL())sqlite.exec(statement.sql);
 const calls=[],bannerReads=[],cache=new Map(),cookies=new Map();let currentCookie=null,headerReads=0,onHeaders;
 const db={prepare(sql){let values=[];const q={bind(...args){values=args;return q;},execute(){calls.push({sql,values});return sqlite.prepare(sql).all(...values);},async first(){return q.execute()[0]??null;},async all(){return {results:q.execute()};},async run(){calls.push({sql,values});return sqlite.prepare(sql).run(...values);}};return q;},async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(statement=>({results:statement.execute()}));sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const bindings={DB:db,YOOFAM_AUTH_ENABLED:native?'true':'false',FILES:{get:async key=>{bannerReads.push(key);return {size:8,body:new Response(new Uint8Array([137,80,78,71,13,10,26,10])).body};}}};
 const deps={
  'cloudflare:workers':{env:bindings},
  'next/server':{NextResponse:Response},
  'next/headers':{headers:async()=>{headerReads++;const result=new Headers(currentCookie?{cookie:currentCookie}:{});onHeaders?.();return result;}},
  'next/navigation':{redirect:()=>{throw Error('Unexpected redirect');}},
  '@/app/cloudflare-access':{AccessAuthenticationError:class extends Error{},authenticateCloudflareAccess:async()=>({userId:'access-fixture',email:'access@example.test',displayName:'Access fixture'})},
 };
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  const output=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(output,{exports,Error,Date,URL,Response,Request,Headers,TextEncoder,TextDecoder,Uint8Array,DataView,crypto:webcrypto,process:{env:{NODE_ENV:production?'production':'development'}},require(name){if(name in deps)return deps[name];if(name.startsWith('@/'))return load(name.slice(2)+'.ts');if(name.startsWith('.'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');throw Error(name);}});return exports;
 }
 for(let index=0;index<accounts.length;index++){
  const account=accounts[index],token=(index?'b':'a').repeat(64),now='2026-01-01T00:00:00.000Z';
  sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(account.id,account.email,'fixture-password-is-never-used',account.role,'approved',account.companyCode,account.companyName,now,now);
  sqlite.prepare('INSERT INTO member_sessions VALUES(?,?,?)').run(await load('app/workspace-members.ts').tokenHash(token),account.id,Date.now()+60000);cookies.set(account.id,`yoofam_session=${token}`);
 }
 const route=load('app/api/settings/route.ts');
 return {sqlite,calls,bannerReads,load,login(account){currentCookie=cookies.get(account.id);},logout(){currentCookie=null;},afterAuth(fn){onHeaders=fn;},get headerReads(){return headerReads;},get:()=>route.GET(),put:body=>route.PUT(new Request('https://app.test/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)})),seed(account,settings){sqlite.prepare('INSERT INTO workspace_settings VALUES(?,?,?)').run(account.id,JSON.stringify(settings),'2026-01-01T00:00:00.000Z');},rows(){return sqlite.prepare('SELECT * FROM workspace_settings ORDER BY owner_id').all().map(row=>({...row}));},close(){sqlite.close();}};
}

test('native settings GET exposes current owner and fixed company without copying another saved row',async()=>{
 const h=await harness();try{
  h.seed(accounts[0],{brand:'와이홉',manufacturer:'기존 제조사',importer:'와이홉',exchangeRate:321});const original=h.rows();
  h.login(accounts[1]);let response=await h.get();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{settings:null,scope:scope(accounts[1])});assert.deepEqual(h.rows(),original);
  h.login(accounts[0]);response=await h.get();const body=await response.json();assert.deepEqual(body.scope,scope(accounts[0]));assert.equal(body.settings.brand,'와이홉');assert.equal(body.settings.manufacturer,'기존 제조사');assert.equal(body.settings.serviceContact,'');assert.equal(body.settings.exchangeRate,321);assert.deepEqual(h.rows(),original);
 }finally{h.close();}
});

test('two native accounts save distinct settings; registration blanks and reserved ownership fields stay isolated',async()=>{
 const h=await harness();try{
  for(const [index,account] of accounts.entries()){
   h.login(account);const body={expectedOwnerId:account.id,brand:index?'회원 브랜드':'',manufacturer:index?'':'관리자 제조사',importer:'',exchangeRate:index?444:333,ownerId:accounts[1-index].id,owner_id:accounts[1-index].id,scope:scope(accounts[1-index]),companyCode:accounts[1-index].companyCode};
   const response=await h.put(body);assert.equal(response.status,200,await response.clone().text());const {settings}=await response.json();
   assert.equal(settings.brand,body.brand);assert.equal(settings.manufacturer,body.manufacturer);assert.equal(settings.importer,'');for(const key of ['expectedOwnerId','ownerId','owner_id','scope','companyCode'])assert.equal(Object.hasOwn(settings,key),false,key);
  }
  assert.equal(h.rows().length,2);
  for(const [index,account] of accounts.entries()){
   h.login(account);const {settings,scope:actualScope}=await(await h.get()).json();assert.deepEqual(actualScope,scope(account));assert.equal(settings.exchangeRate,index?444:333);assert.equal(settings.brand,index?'회원 브랜드':'');assert.equal(settings.manufacturer,index?'':'관리자 제조사');assert.equal(settings.importer,'');
  }
 }finally{h.close();}
});

test('stale-tab expected owner or a missing native guard fails before settings DB and banner work',async()=>{
 const h=await harness();try{
  for(const account of accounts)h.seed(account,{brand:account.id});const original=h.rows();
  for(const expectedOwnerId of [accounts[0].id,undefined]){
   h.login(accounts[1]);const before=h.calls.length,response=await h.put({...(expectedOwnerId!==undefined?{expectedOwnerId}:{}),brand:'오래된 탭',topImageEnabled:true,topImageKey:`${accounts[1].id}/banner.png`});
   assert.equal(response.status,409,await response.clone().text());const body=await response.json();assert.match(body.error,/계정|다시/);assert.equal(Object.hasOwn(body,'settings'),false);assert.equal(Object.hasOwn(body,'scope'),false);
   assert.equal(h.calls.slice(before).some(call=>/workspace_settings|CREATE TABLE/.test(call.sql)),false);assert.deepEqual(h.bannerReads,[]);assert.deepEqual(h.rows(),original);
  }
 }finally{h.close();}
});

test('malformed expected owner is rejected and supplied foreign owner cannot choose a write target',async()=>{
 const h=await harness();try{
  h.login(accounts[0]);h.seed(accounts[0],{brand:'원본'});const original=h.rows();
  for(const expectedOwnerId of [null,{},[],42,'',' owner ','a'.repeat(201),'bad\nowner'])assert.equal((await h.put({expectedOwnerId,brand:'변경'})).status,400);
  assert.equal((await h.put({expectedOwnerId:accounts[1].id,ownerId:accounts[1].id,brand:'변경'})).status,409);assert.deepEqual(h.rows(),original);assert.deepEqual(h.bannerReads,[]);
 }finally{h.close();}
});

test('each settings request resolves its native session once even if the cookie changes during authentication',async()=>{
 const h=await harness();try{
  h.login(accounts[0]);h.afterAuth(()=>h.login(accounts[1]));let before=h.headerReads;
  assert.equal((await h.put({expectedOwnerId:accounts[0].id,brand:'첫 계정'})).status,200);assert.equal(h.headerReads-before,1);assert.equal(h.rows()[0].owner_id,accounts[0].id);
  h.login(accounts[0]);before=h.headerReads;const body=await(await h.get()).json();assert.equal(h.headerReads-before,1);assert.deepEqual(body.scope,scope(accounts[0]));assert.equal(body.settings.brand,'첫 계정');
 }finally{h.close();}
});

test('expired or invalid native account membership never falls back to another settings owner',async()=>{
 const h=await harness();try{
  h.seed(accounts[0],{brand:'비공개 원본'});const original=h.rows();h.login(accounts[0]);h.sqlite.prepare("UPDATE members SET company_code='A01464742',company_name='와이홉' WHERE id=?").run(accounts[0].id);
  assert.equal((await h.get()).status,503);assert.equal((await h.put({expectedOwnerId:accounts[0].id,brand:'변경'})).status,503);
  h.logout();assert.equal((await h.get()).status,503);assert.equal((await h.put({brand:'변경'})).status,503);assert.deepEqual(h.rows(),original);
 }finally{h.close();}
});

test('legacy Access and development settings remain usable without a native expected owner, with explicit mismatches blocked',async()=>{
 for(const production of [true,false]){
  const h=await harness({native:false,production});try{
   const owner=production?'access-fixture':'local-demo';assert.equal((await h.put({brand:'직접 저장'})).status,200);const body=await(await h.get()).json();assert.deepEqual(body.scope,{ownerId:owner,company:null});assert.equal(body.settings.brand,'직접 저장');const original=h.rows();
   assert.equal((await h.put({expectedOwnerId:'foreign-fixture',brand:'변경'})).status,409);assert.deepEqual(h.rows(),original);
  }finally{h.close();}
 }
});

test('client scope parser accepts only valid owner ids and the fixed company pairs',async()=>{
 const h=await harness();try{
  const {parseWorkspaceSettingsScope:parse}=h.load('app/workspace-settings-scope.ts');
  for(const account of accounts)assert.deepEqual(JSON.parse(JSON.stringify(parse(scope(account)))),scope(account));assert.deepEqual(JSON.parse(JSON.stringify(parse({ownerId:'local-demo',company:null}))),{ownerId:'local-demo',company:null});
  for(const input of [undefined,null,{},[],{ownerId:'',company:null},{ownerId:' x ',company:null},{ownerId:42,company:null},{ownerId:'x'},{ownerId:'x',company:{}},{ownerId:'x',company:{code:'A01526306',name:'와이홉'}},{ownerId:'x',company:{code:'unknown',name:'unknown'}},{ownerId:'bad\nowner',company:null}])assert.equal(parse(input),null);
 }finally{h.close();}
});
