import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
function fixture(){
 const sqlite=new DatabaseSync(':memory:');const state={owner:'alice',verified:true,reads:0,profile:{id:profileId,revision:3,categoryPath:['주방용품'],categoryId:'80719'}};
 const DB={prepare(sql){
  state.reads++;
  return {async run(){sqlite.exec(sql);},bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)??null;}};}};
 }};
 const cache=new Map();
 function load(file){if(cache.has(file))return cache.get(file);const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file==='app/api/intake-draft/route'&&process.env.TEST_INTAKE_BASELINE?process.env.TEST_INTAKE_BASELINE:new URL('../'+file+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Response,TextDecoder,TextEncoder,Uint8Array,process:{env:{NODE_ENV:'production'}},require(name){
  if(name==='cloudflare:workers')return{env:{DB}};
  if(name==='@/app/chatgpt-auth')return{getWorkspaceOwnerId:async()=>state.owner,getChatGPTUser:async()=>({verifiedAccess:state.verified})};
  if(name==='@/db/category-profiles')return{getCategoryProfile:async(owner,id)=>owner==='alice'&&id===profileId?state.profile:null};
  return load(name.slice(2));
 }});cache.set(file,exports);return exports;}
 const api=load('app/api/intake-draft/route');
 return{sqlite,state,api,load,put:body=>api.PUT(new Request('https://example.test/api/intake-draft',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))};
}
const profileId='00000000-0000-0000-0000-000000000001';
const row={id:'draft-1',profileId,profileRevision:3,url:'아직 입력 중',features:'특징',keywords:'키워드'};

test('later autosave preserves the originally selected category and company snapshot after a profile revision changes',async()=>{
 const f=fixture();try{
 f.state.profile={...f.state.profile,hubSchema:{company:{code:'A01464742',name:'와이홉'}}};
 const selected={...row,profileRevision:3};
 let response=await f.put({expectedRevision:0,goal:'price',rows:[selected]});assert.equal(response.status,200);
 const original=(await response.json()).draft.rows[0].profile;
 f.state.profile={...f.state.profile,revision:4,categoryId:'77442',categoryPath:['새 분류'],hubSchema:{company:{code:'A01526306',name:'유앤채'}}};
 response=await f.put({expectedRevision:1,goal:'price',rows:[{...selected,url:'직접 수정한 URL'}]});assert.equal(response.status,200);
 let draft=(await response.json()).draft;assert.deepEqual(draft.rows[0].profile,original,'never pair the old selected revision with the new category/company');
 assert.equal(draft.rows[0].url,'직접 수정한 URL');assert.match(draft.rows[0].message,/변경됨/);
 response=await f.put({expectedRevision:2,goal:'work',rows:[{...selected,features:'다음 수동 수정'}]});assert.equal(response.status,200);
 draft=(await(await f.api.GET()).json()).draft;assert.deepEqual(draft.rows[0].profile,original);assert.equal(draft.rows[0].features,'다음 수동 수정');
 }finally{f.sqlite.close();}
});

test('a first-save stale category revision cannot manufacture an acknowledged profile snapshot',async()=>{
 const f=fixture();try{
 const response=await f.put({expectedRevision:0,goal:'price',rows:[{...row,profileRevision:2}]});
 assert.equal(response.status,409);assert.equal((await response.json()).code,'CATEGORY_PROFILE_CHANGED');
 assert.equal((await(await f.api.GET()).json()).draft.revision,0);
 }finally{f.sqlite.close();}
});
test('draft roundtrip preserves partial inputs and profile revision, isolates owners and rejects stale writes',async()=>{
 const f=fixture();try{
 assert.equal((await(await f.api.GET()).json()).draft.revision,0);
 let response=await f.put({expectedRevision:0,goal:'price',rows:[row]});assert.equal(response.status,200);let draft=(await response.json()).draft;
 assert.equal(draft.rows[0].url,'아직 입력 중');assert.equal(draft.rows[0].profile.revision,3);assert.equal(draft.rows[0].message,'');assert.equal(draft.rows[0].profileSnapshotVerified,true);assert.equal(draft.rows[0].status,'draft');
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

test('save confirmation requires every input row, category revision and exact next revision',()=>{
 const f=fixture();try{
 const model=f.load('app/intake-draft');
 const savedRow={id:row.id,profile:{id:profileId,revision:row.profileRevision},url:row.url,features:row.features,keywords:row.keywords,status:'draft',message:''};
 const requested=model.intakeDraftBody([savedRow],'price',2);
 const draft={revision:3,rows:[savedRow],goal:'price',updatedAt:'2026-10-01T00:00:00.000Z'};
 assert.equal(model.confirmIntakeDraftSave({draft},requested).revision,3);
 for(const mismatch of [
  {...draft,revision:2},{...draft,revision:4},{...draft,rows:[]},{...draft,goal:'work'},
  ...['id','url','features','keywords'].map(key=>({...draft,rows:[{...savedRow,[key]:savedRow[key]+'changed'}]})),
  {...draft,rows:[{...savedRow,profile:{id:'00000000-0000-0000-0000-000000000002',revision:2}}]},
  {...draft,rows:[{...savedRow,profile:{id:profileId,revision:4}}]},
  {...draft,rows:[{...savedRow,status:'saved'}]},
 ])assert.throws(()=>model.confirmIntakeDraftSave({draft:mismatch},requested));
 }finally{f.sqlite.close();}
});

test('client snapshot metadata cannot bless a stale first save or overwrite an authoritative current profile',async()=>{
 const f=fixture();try{
 const forged={...row,profileRevision:2,profile:{...f.state.profile,revision:2,categoryId:'forged'},profileSnapshotVerified:true,message:''};
 let response=await f.put({expectedRevision:0,goal:'price',rows:[forged]});
 assert.equal(response.status,409);assert.equal((await(await f.api.GET()).json()).draft.revision,0);
 response=await f.put({expectedRevision:0,goal:'price',rows:[{...forged,profileRevision:3}]});assert.equal(response.status,200);
 const saved=(await response.json()).draft.rows[0];assert.equal(saved.profile.categoryId,'80719');assert.equal(saved.profile.revision,3);assert.equal(saved.profileSnapshotVerified,true);
 }finally{f.sqlite.close();}
});

test('verified prior and exact legacy snapshots preserve their identity; hybrid or other row snapshots do not',()=>{
 const f=fixture();try{
 const select=f.load('app/intake-draft').intakeDraftProfileSnapshot;
 const previous={id:row.id,profile:{...f.state.profile,revision:2,categoryId:'old-code',categoryPath:['old path']},status:'draft',message:''};
 const requested={...row,profileRevision:2};const before=JSON.stringify(previous);
 assert.equal(select(requested,f.state.profile,previous).profile.categoryId,'old-code');
 assert.equal(select(requested,f.state.profile,{...previous,message:'카테고리 설정 변경됨',profileSnapshotVerified:true}).profile.categoryId,'old-code');
 for(const bad of [{...previous,message:'카테고리 설정 변경됨'},{...previous,message:undefined},{...previous,id:'different'},{...previous,status:'saved'},{...previous,profile:{...previous.profile,revision:1}},{...previous,profile:{...previous.profile,id:'other'}}])assert.equal(select(requested,f.state.profile,bad),null);
 assert.equal(JSON.stringify(previous),before);
 }finally{f.sqlite.close();}
});
