import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';

function fixture() {
  const slots=[], pending=[], timers=new Map(), requests=[];
  let cursor=0, changed=true, timerId=0, value;
  const same=(a,b)=>a && b && a.length===b.length && a.every((v,i)=>Object.is(v,b[i]));
  const react={
    useState(initial){const i=cursor++;slots[i]??={value:initial};return[slots[i].value,v=>{const next=typeof v==='function'?v(slots[i].value):v;if(!Object.is(next,slots[i].value)){slots[i].value=next;changed=true;}}];},
    useRef(initial){const i=cursor++;slots[i]??={current:initial};return slots[i];},
    useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,fn};return slots[i].fn;},
    useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){const previous=slots[i];slots[i]={deps,cleanup:previous?.cleanup};pending.push(()=>{previous?.cleanup?.();slots[i].cleanup=fn();});}},
  };
  const exports={};
  const draftModule={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/intake-draft.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:draftModule,Error,Date});
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/use-intake-draft.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,AbortController,Error,Date,Promise,
    require(name){if(name==='react')return react;assert.equal(name,'@/app/intake-draft');return draftModule;},
    window:{setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},addEventListener(){},removeEventListener(){}},
    fetch(url,options={}){return new Promise((resolve,reject)=>requests.push({options,resolve,reject}));},
  });
  function render(){while(changed){changed=false;cursor=0;value=exports.useIntakeDraft();while(pending.length)pending.shift()();}}
  async function settle(){for(let i=0;i<8;i++){await Promise.resolve();render();}await new Promise(setImmediate);render();}
  function respond(index,status=200,revision=1){
    const body=requests[index].options.body?JSON.parse(requests[index].options.body):{rows:[],goal:'price'};
    const rows=body.rows.map(row=>({id:row.id,profile:{id:row.profileId,revision:row.profileRevision},url:row.url,features:row.features,keywords:row.keywords,status:'draft',message:''}));
    requests[index].resolve({ok:status===200,json:async()=>status===200?{draft:{revision,rows,goal:body.goal,updatedAt:null}}:{error:'revision conflict'}});
  }
  return{requests,timers,get value(){return value;},render,settle,respond,
    respondBody(index,body,status=200){requests[index].resolve({ok:status===200,json:async()=>body});},
    async start(){render();await settle();respond(0,200,0);await settle();},
    async tick(){const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn());await settle();},
    stop(){slots.forEach(s=>s?.cleanup?.());},
  };
}

test('autosave coalesces edits and serializes edits made during a pending write using the returned revision',async()=>{
  const f=fixture();await f.start();assert.equal(f.timers.size,0);
  f.value.setGoal('collect');f.render();f.value.setGoal('work');f.render();assert.equal(f.timers.size,1);
  await f.tick();assert.equal(f.requests.length,2);assert.equal(JSON.parse(f.requests[1].options.body).goal,'work');
  assert.equal(f.value.loading,false);assert.equal(f.value.saving,true);
  f.value.setGoal('transmit');f.render();assert.equal(f.timers.size,0);
  f.respond(1,200,1);await f.settle();assert.equal(f.value.dirty,true);assert.equal(f.value.goal,'transmit');
  await f.tick();assert.equal(f.requests.length,3);assert.equal(JSON.parse(f.requests[2].options.body).expectedRevision,1);
  assert.equal(JSON.parse(f.requests[2].options.body).goal,'transmit');
  f.respond(2,200,2);await f.settle();assert.equal(f.value.dirty,false);assert.equal(f.timers.size,0);f.stop();
});

test('lost save acknowledgement recovers the exact category and URL without discarding newer input',async()=>{
  const f=fixture();await f.start();
  const profile={id:'00000000-0000-0000-0000-000000000001',revision:3};
  const row={id:'draft1',profile,url:'https://detail.1688.com/offer/813724060928.html',features:'우드 다리',keywords:'선글라스',status:'draft',message:''};
  f.value.setRows(()=>[row]);f.render();await f.tick();
  f.value.setRows(rows=>rows.map(value=>({...value,features:'수동 수정한 특징'})));f.render();
  f.requests[1].reject(Error('save response disconnected'));await f.settle();
  assert.equal(f.requests.length,3,'query the persisted input after a lost response');
  assert.equal(f.requests[2]?.options.method,undefined,'read persisted input before offering a conflicting write');
  f.respondBody(2,{draft:{revision:1,rows:[row],goal:'price',updatedAt:'2026-10-01T00:00:00.000Z'}});await f.settle();
  assert.equal(f.value.autoPaused,false);assert.equal(f.value.dirty,true);
  assert.equal(f.value.rows[0].features,'수동 수정한 특징');
  await f.tick();assert.equal(JSON.parse(f.requests[3].options.body).expectedRevision,1);
  assert.equal(JSON.parse(f.requests[3].options.body).rows[0].features,'수동 수정한 특징');f.stop();
});

test('a successful HTTP response for different saved input must not clear unsaved category and URL',async()=>{
  const f=fixture();await f.start();f.value.setGoal('work');f.render();await f.tick();
  f.respondBody(1,{draft:{revision:1,rows:[],goal:'collect',updatedAt:null}});await f.settle();
  assert.equal(f.value.dirty,true,'an unrelated save acknowledgement cannot confirm local input');
  assert.equal(f.value.goal,'work');
  f.respondBody(2,{draft:{revision:1,rows:[],goal:'collect',updatedAt:null}});await f.settle();
  assert.equal(f.value.autoPaused,true);assert.equal(f.timers.size,0);f.stop();
});

test('another window conflict preserves input until an explicit server reload, then saves against the new version',async()=>{
  const f=fixture();await f.start();f.value.setGoal('work');f.render();await f.tick();
  f.respond(1,409);await f.settle();
  f.respondBody(2,{draft:{revision:1,rows:[],goal:'collect',updatedAt:null}});await f.settle();
  assert.equal(f.value.autoPaused,true);assert.equal(f.value.dirty,true);assert.equal(f.value.goal,'work');
  f.value.setGoal('price');f.render();await f.tick();assert.equal(f.requests.length,3);
  f.value.load();f.render();f.respondBody(3,{draft:{revision:1,rows:[],goal:'collect',updatedAt:null}});await f.settle();
  f.value.setGoal('work');f.render();const saved=f.value.save();f.render();
  assert.equal(JSON.parse(f.requests[4].options.body).expectedRevision,1);f.respond(4,200,2);await saved;await f.settle();
  assert.equal(f.value.autoPaused,false);assert.equal(f.value.goal,'work');assert.equal(f.value.dirty,false);f.stop();
});

test('unmount cancels debounce and aborts pending saves without accepting a late response',async()=>{
  const f=fixture();await f.start();f.value.setGoal('work');f.render();f.stop();assert.equal(f.timers.size,0);
  const g=fixture();await g.start();g.value.setGoal('work');g.render();await g.tick();g.stop();
  assert.equal(g.requests[1].options.signal.aborted,true);g.respond(1);await g.settle();assert.equal(g.value.dirty,true);
});

test('an uncommitted failed write keeps inputs and can retry the unchanged server revision',async()=>{
  const f=fixture();await f.start();f.value.setGoal('work');f.render();await f.tick();
  f.respondBody(1,{error:'storage unavailable'},503);await f.settle();f.respond(2,200,0);await f.settle();
  assert.equal(f.value.autoPaused,true);assert.equal(f.value.dirty,true);
  const retry=f.value.save();f.render();assert.equal(JSON.parse(f.requests[3].options.body).expectedRevision,0);
  f.respond(3,200,1);await retry;await f.settle();assert.equal(f.value.dirty,false);f.stop();
});

test('unmount aborts recovery reads and rejects their late acknowledgement',async()=>{
  const f=fixture();await f.start();f.value.setGoal('work');f.render();await f.tick();
  f.requests[1].reject(Error('lost acknowledgement'));await f.settle();f.stop();
  assert.equal(f.requests[2].options.signal.aborted,true);
  f.respondBody(2,{draft:{revision:1,rows:[],goal:'work',updatedAt:null}});await f.settle();
  assert.equal(f.value.dirty,true);assert.equal(f.requests.length,3);
});

test('malformed server reload cannot replace edited input',async()=>{
  const f=fixture();await f.start();f.value.setGoal('work');f.render();f.value.load();f.render();
  f.respondBody(1,{draft:{revision:2,rows:null,goal:'collect',updatedAt:null}});await f.settle();
  assert.equal(f.value.goal,'work');assert.equal(f.value.dirty,true);
  assert.match(f.value.message,/확인/);f.stop();
});

function draftApiFixture(companyCode,companyName){
  const sqlite=new DatabaseSync(':memory:'),cache=new Map(),owner=companyCode;
  const profile={id:'00000000-0000-0000-0000-000000000001',revision:3,categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']};
  const DB={prepare(sql){let args=[];const query={bind(...values){args=values;return query;},async run(){return sqlite.exec(sql);},async first(){return sqlite.prepare(sql).get(...args)??null;}};return query;}};
  function load(file){
    if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
      exports,Error,Response,TextDecoder,TextEncoder,Uint8Array,Date,process:{env:{NODE_ENV:'production'}},require(name){
        if(name==='cloudflare:workers')return{env:{DB}};
        if(name==='@/app/chatgpt-auth')return{getWorkspaceOwnerId:async()=>owner,getChatGPTUser:async()=>({verifiedAccess:true,membership:{companyCode,companyName}})};
        if(name==='@/db/category-profiles')return{getCategoryProfile:async(requestedOwner,id)=>requestedOwner===owner&&id===profile.id?profile:null};
        return load(name.slice(2));
      },
    });return exports;
  }
  const api=load('app/api/intake-draft/route');
  return{sqlite,profile,async request(options={}){return options.method==='PUT'?api.PUT(new Request('https://example.test/api/intake-draft',{...options,body:options.body})):api.GET();},read:()=>load('db/intake-draft').readIntakeDraft(owner)};
}

for(const [code,name] of [['A01526306','유앤채'],['A01464742','와이홉']])test(`${code}: actual draft API and SQLite recover lost save/read replies before saving later URL edits`,async()=>{
  const api=draftApiFixture(code,name),f=fixture();
  try{
    f.render();await f.settle();f.requests[0].resolve(await api.request());await f.settle();
    const row={id:'input-1',profile:api.profile,url:'https://detail.1688.com/offer/813724060928.html',features:'우드 다리',keywords:'선글라스',status:'draft',message:''};
    f.value.setRows(()=>[row]);f.render();await f.tick();
    const committed=await api.request(f.requests[1].options);assert.equal(committed.status,200);
    f.requests[1].reject(Error('HTTP acknowledgement lost after DB commit'));await f.settle();
    f.requests[2].reject(Error('recovery read disconnected'));await f.settle();
    assert.equal(f.value.dirty,true);assert.equal(f.value.autoPaused,true);assert.equal((await api.read()).revision,1);
    f.value.setRows(rows=>rows.map(value=>({...value,url:value.url+'?offerId=813724060928',keywords:'수동 수정한 키워드'})));f.render();
    const retry=f.value.save();f.render();assert.equal(f.requests[3].options.method,undefined,'first reconcile original input, never resend blindly');
    f.requests[3].resolve(await api.request());await f.settle();
    assert.equal(JSON.parse(f.requests[4].options.body).expectedRevision,1);
    f.requests[4].resolve(await api.request(f.requests[4].options));await retry;await f.settle();
    assert.equal(f.value.dirty,false);assert.equal(f.value.autoPaused,false);
    const saved=await api.read();assert.equal(saved.revision,2);assert.equal(saved.rows[0].url,f.value.rows[0].url);
    assert.equal(saved.rows[0].keywords,'수동 수정한 키워드');assert.equal(saved.rows[0].profile.categoryId,'80719');
    assert.equal(sqliteRows(api.sqlite),1,'recovery does not create extra drafts or duplicate rows');
  }finally{f.stop();api.sqlite.close();}
});

function sqliteRows(sqlite){return sqlite.prepare('SELECT COUNT(*) AS count FROM intake_drafts').get().count;}

test('confirmed persisted acknowledgement with no newer edit avoids any duplicate PUT',async()=>{
  const api=draftApiFixture('A01464742','와이홉'),f=fixture();
  try{
    await f.start();f.value.setGoal('work');f.render();await f.tick();
    await api.request(f.requests[1].options);f.requests[1].reject(Error('response lost'));await f.settle();
    f.requests[2].reject(Error('read lost'));await f.settle();const retry=f.value.save();f.render();
    f.requests[3].resolve(await api.request());await retry;await f.settle();
    assert.equal(f.value.dirty,false);assert.equal(f.requests.length,4);assert.equal((await api.read()).revision,1);
    assert.equal(f.timers.size,0);
  }finally{f.stop();api.sqlite.close();}
});
