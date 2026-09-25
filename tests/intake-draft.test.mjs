import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
function fixture(){
 const sqlite=new DatabaseSync(':memory:');const state={owner:'alice',verified:true,reads:0};
 const DB={prepare(sql){
  state.reads++;
  return {async run(){sqlite.exec(sql);},bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)??null;}};}};
 }};
 const cache=new Map();
 function load(file){if(cache.has(file))return cache.get(file);const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Response,TextDecoder,TextEncoder,Uint8Array,process:{env:{NODE_ENV:'production'}},require(name){
  if(name==='cloudflare:workers')return{env:{DB}};
  if(name==='@/app/chatgpt-auth')return{getWorkspaceOwnerId:async()=>state.owner,getChatGPTUser:async()=>({verifiedAccess:state.verified})};
  if(name==='@/db/category-profiles')return{getCategoryProfile:async(owner,id)=>owner==='alice'&&id===profileId?{id,revision:3,categoryPath:['주방용품'],categoryId:'80719'}:null};
  return load(name.slice(2));
 }});cache.set(file,exports);return exports;}
 const api=load('app/api/intake-draft/route');
 return{sqlite,state,api,load,put:body=>api.PUT(new Request('https://example.test/api/intake-draft',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))};
}
const profileId='00000000-0000-0000-0000-000000000001';
const row={id:'draft-1',profileId,profileRevision:2,url:'아직 입력 중',features:'특징',keywords:'키워드'};
test('draft roundtrip preserves partial inputs and profile revision, isolates owners and rejects stale writes',async()=>{
 const f=fixture();try{
 assert.equal((await(await f.api.GET()).json()).draft.revision,0);
 let response=await f.put({expectedRevision:0,goal:'price',rows:[row]});assert.equal(response.status,200);let draft=(await response.json()).draft;
 assert.equal(draft.rows[0].url,'아직 입력 중');assert.equal(draft.rows[0].profile.revision,2);assert.match(draft.rows[0].message,/변경됨/);assert.equal(draft.rows[0].status,'draft');
 assert.equal((await f.put({expectedRevision:0,goal:'work',rows:[]})).status,409);
 assert.equal((await f.put({expectedRevision:1,goal:'work',rows:[{...row,features:'새 특징'}]})).status,200);
 assert.equal((await f.put({expectedRevision:1,goal:'collect',rows:[]})).status,409);
 draft=(await(await f.api.GET()).json()).draft;assert.equal(draft.rows[0].features,'새 특징');
 f.state.owner='bob';assert.equal((await(await f.api.GET()).json()).draft.revision,0);assert.equal((await f.put({expectedRevision:0,goal:'price',rows:[row]})).status,400);
 assert.equal((await f.put({expectedRevision:0,goal:'collect',rows:[]})).status,200);
 f.state.owner='alice';assert.equal((await(await f.api.GET()).json()).draft.revision,2);
 }finally{f.sqlite.close();}
});
test('unauthenticated requests cannot read or write; malformed drafts cannot mutate storage',async()=>{
 const f=fixture();try{
 f.state.verified=false;assert.equal((await f.api.GET()).status,503);assert.equal((await f.put({})).status,503);assert.equal(f.state.reads,0);
 f.state.verified=true;
 for(const body of [{expectedRevision:-1,goal:'price',rows:[]},{expectedRevision:0,goal:'invalid',rows:[]},{expectedRevision:0,goal:'price',rows:[row,row]},{expectedRevision:0,goal:'price',rows:[{...row,features:'x'.repeat(2001)}]}])assert.equal((await f.put(body)).status,400);
 assert.equal(f.state.reads,0);
 }finally{f.sqlite.close();}
});
test('persisted draft omits successfully queued rows and does not accept client profile metadata',()=>{
 const f=fixture();try{
 const model=f.load('app/intake-draft');const draftRow={id:'row1',profile:{id:profileId,revision:2,categoryPath:['fake']},url:'',features:'',keywords:'',status:'draft'};
 const body=model.intakeDraftBody([draftRow,{...draftRow,id:'row2',status:'saved'}],'price',0);
 assert.equal(body.rows.length,1);assert.equal(body.rows[0].profile,undefined);assert.equal(body.rows[0].url,'');
 }finally{f.sqlite.close();}
});
