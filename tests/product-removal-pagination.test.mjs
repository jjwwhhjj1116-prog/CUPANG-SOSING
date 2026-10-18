import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {memoryDatabase,runtimeDDL} from '../scripts/check-db-schema.mjs';
const native=createRequire(import.meta.url),stamp='2026-10-01T01:00:00.000Z',version='2026-10-01T00:00:00.000Z';
const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};

function api(){
 const sqlite=memoryDatabase();for(const declaration of runtimeDDL())sqlite.exec(declaration.sql);
 const state={owner:'owner-a',verified:true,requests:[],fileCalls:[]};
 const db={prepare(sql){let args=[];const query={bind(...values){args=values;return query;},execute:()=>sqlite.prepare(sql).all(...args),async first(){return query.execute()[0]??null;},async all(){return{results:query.execute()};},async run(){return sqlite.prepare(sql).run(...args);}};return query;},async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(statement=>({results:statement.execute()}));sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const env={DB:db,FILES:new Proxy({},{get:(_,key)=>()=>{state.fileCalls.push(key);throw Error('File access is forbidden for pagination.');}})},cache=new Map();
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,URLSearchParams,Date,Error,crypto,Request,Response,Headers,TextEncoder,TextDecoder,Uint8Array,DataView,atob,btoa,process:{env:{NODE_ENV:'production'}},require(name){if(name==='cloudflare:workers')return{env};if(name==='next/server')return{NextResponse:Response};if(name==='@/app/chatgpt-auth')return{getChatGPTUser:async()=>state.verified?{verifiedAccess:true,userId:state.owner}:null,getWorkspaceOwnerId:async()=>state.owner};assert.ok(name.startsWith('@/'),name);return load(name.slice(2)+'.ts');}},{filename:file});return exports;}
 async function seed(count,owner=state.owner){
  const queries=load('db/queries.ts');const ids=[];
  for(let index=0;index<count;index++){
   const id=owner+'-'+String(index).padStart(4,'0');ids.push(id);
   await queries.insertProduct({id,owner_id:owner,source_url:'https://fixture.invalid/'+id,title:'보관 '+id,source_price_cny:1,exchange_rate:200,supply_margin:25,coupang_margin:15,supply_price:400,sale_price:900,msrp:1000,options_count:1,seo_status:'입력됨',image_status:'대기',quote_status:'대기',registration_status:'검토 대기',supplier_hub_status:'미전송',image_keys:'[]',goal_stage:'price',created_at:version,updated_at:version});
   sqlite.prepare('INSERT INTO product_removals VALUES(?,?,?,?)').run(id,owner,stamp,version);
  }
  return ids.reverse();
 }
 const fetcher=async(path,init={})=>{state.requests.push({path,method:init.method??'GET',body:init.body,signal:init.signal});const request=new Request('https://fixture.invalid'+path,{...init});if(path.startsWith('/api/products/removed'))return load('app/api/products/removed/route.ts').GET(request);if(path.startsWith('/api/products?'))return load('app/api/products/route.ts').GET(request);return load('app/api/products/[id]/route.ts')[init.method??'GET'](request,{params:Promise.resolve({id:decodeURIComponent(path.split('/').at(-1))})});};
 const list=cursor=>fetcher('/api/products/removed'+(cursor?'?cursor='+encodeURIComponent(cursor):''));
 const restore=row=>fetcher('/api/products/'+row.id,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({action:'restore',expectedVersion:row.updated_at,expectedRemovedAt:row.removed_at})});
 const snapshot=()=>JSON.stringify(sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,sqlite.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
 return{sqlite,state,load,seed,fetcher,list,restore,snapshot,close:()=>sqlite.close()};
}

function dialog(fetcher,owner='owner-a'){
 const slots=[],effects=[],requests=[],busy=[];let index=0,closed=false,lateWrites=0,restored=0;
 const props={workspaceOwnerId:owner,onRestored:async()=>{restored++;},onBusyChange:value=>busy.push(value)};
 const hooks={useState(initial){const slot=index++;if(!(slot in slots))slots[slot]=typeof initial==='function'?initial():initial;return[slots[slot],value=>{if(closed){lateWrites++;return;}slots[slot]=typeof value==='function'?value(slots[slot]):value;}];},useRef(initial){const slot=index++;return slots[slot]??(slots[slot]={current:initial});},useEffect(fn,deps){const slot=index++,old=slots[slot];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){const next={deps,cleanup:old?.cleanup};slots[slot]=next;effects.push(()=>{next.cleanup?.();next.cleanup=fn();});}}};
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,Date,AbortController,fetch:async(url,init)=>{requests.push({url,init});return fetcher(url,init);},require:name=>name==='react'?hooks:name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name)},{filename:file});return exports;}
 const Component=load('app/components/product-removal-dialog.tsx').ProductRemovalDialog;
 const render=()=>{index=0;const tree=Component(props);effects.splice(0).forEach(effect=>effect());return tree;};
 const settle=async()=>{for(let i=0;i<12;i++){if(!closed)render();await new Promise(resolve=>setImmediate(resolve));}};
 const buttons=()=>nodes(render()).filter(node=>node.type==='button');
 const button=label=>{const value=buttons().find(node=>text(node)===label);assert.ok(value,label);return value;};
 render();return{render,settle,buttons,button,requests,busy,changeOwner(value){props.workspaceOwnerId=value;render();},close(){closed=true;slots.forEach(slot=>slot?.cleanup?.());},get restored(){return restored;},get lateWrites(){return lateWrites;}};
}

test('all 203 removed products are reached once across tied timestamps, independently of another owner and the legacy 200 list',async()=>{
 const h=api();try{
  const expected=await h.seed(203);await h.seed(4,'owner-b');const before=h.snapshot(),seen=[],sizes=[];let cursor=null;
  do{const response=await h.list(cursor);assert.equal(response.headers.get('cache-control'),'no-store');const page=await json(response);sizes.push(page.products.length);seen.push(...page.products.map(row=>row.id));assert.ok(page.products.every(row=>row.owner_id==='owner-a'&&row.removed_at===stamp));assert.ok(page.products.every(row=>!Object.hasOwn(row,'image_keys')));cursor=page.nextCursor;}while(cursor);
  assert.deepEqual(sizes,[50,50,50,50,3]);assert.deepEqual(seen,expected);assert.equal(new Set(seen).size,203);
  const legacy=await json(await h.fetcher('/api/products?removed=only'));assert.equal(legacy.products.length,200);assert.equal(Object.hasOwn(legacy,'nextCursor'),false);
  assert.equal(h.snapshot(),before);assert.deepEqual(h.state.fileCalls,[]);
 }finally{h.close();}
});

test('pagination rejects foreign-owner and malformed cursors, duplicate/unknown query keys and oversized limits without writes',async()=>{
 const h=api();try{
  await h.seed(51);await h.seed(1,'owner-b');const first=await json(await h.list()),before=h.snapshot();assert.ok(first.nextCursor);
  h.state.owner='owner-b';await json(await h.list(first.nextCursor),400);assert.deepEqual((await json(await h.list())).products.map(row=>row.id),['owner-b-0000']);h.state.owner='owner-a';
  for(const query of ['cursor=','cursor=not-json','cursor='+('a'.repeat(1025)),'limit=0','limit=101','limit=1.5','limit=10&limit=20','page=2','cursor=a&cursor=b'])await json(await h.fetcher('/api/products/removed?'+query),400);
  const body=JSON.parse(Buffer.from(first.nextCursor,'base64url').toString('utf8'));body.removedAt='not-a-date';await json(await h.list(Buffer.from(JSON.stringify(body)).toString('base64url')),400);
  const hundred=await json(await h.fetcher('/api/products/removed?limit=100'));assert.equal(hundred.products.length,51);assert.equal(hundred.nextCursor,null);
  h.state.verified=false;await json(await h.list(),503);assert.equal(h.snapshot(),before);assert.deepEqual(h.state.fileCalls,[]);
 }finally{h.close();}
});

test('restoring cursor-boundary and later-page rows retains exact CAS and does not skip the next page',async()=>{
 const h=api();try{
  const ids=await h.seed(103),first=await json(await h.list()),boundary=first.products.at(-1);assert.equal(boundary.id,ids[49]);
  const productsBefore=JSON.stringify(h.sqlite.prepare('SELECT * FROM products ORDER BY id').all());
  await json(await h.restore(boundary));await json(await h.restore(boundary),409);
  const second=await json(await h.list(first.nextCursor));assert.deepEqual(second.products.map(row=>row.id),ids.slice(50,100));
  const later=second.products[10];await json(await h.restore(later));
  const reloaded=await json(await h.list(first.nextCursor));assert.deepEqual(reloaded.products.map(row=>row.id),ids.slice(50,101).filter(id=>id!==later.id));
  const third=await json(await h.list(reloaded.nextCursor));assert.deepEqual(third.products.map(row=>row.id),ids.slice(101));assert.equal(third.nextCursor,null);
  h.sqlite.prepare('INSERT INTO product_removals VALUES(?,?,?,?)').run(later.id,'owner-a','2026-10-02T00:00:00.000Z',version);await json(await h.restore(later),409);
  const refreshed=await json(await h.list());assert.equal(refreshed.products[0].id,later.id);assert.equal(refreshed.products[0].removed_at,'2026-10-02T00:00:00.000Z');
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products ORDER BY id').all()),productsBefore);assert.deepEqual(h.state.fileCalls,[]);
 }finally{h.close();}
});

test('actual dialog reaches and restores the 201st row with real routes, preserves other rows and rejects an old-page callback',async()=>{
 const h=api();let ui;try{
  const ids=await h.seed(201);ui=dialog(h.fetcher);await ui.settle();assert.equal(ui.buttons().filter(button=>text(button)==='복원').length,50);
  const retained=ui.buttons().find(button=>text(button)==='복원').props.onClick;
  for(let page=1;page<5;page++){assert.equal(ui.button('다음').props.disabled,false);ui.button('다음').props.onClick();await ui.settle();assert.match(text(ui.render()),new RegExp(`${page+1} 페이지`));}
  assert.match(text(ui.render()),/보관 owner-a-0000/);assert.equal(ui.button('다음').props.disabled,true);
  const writes=()=>h.state.requests.filter(request=>request.method==='DELETE');retained();await ui.settle();assert.equal(writes().length,0);
  ui.button('복원').props.onClick();await ui.settle();assert.equal(ui.restored,1);assert.equal(writes().length,1);assert.equal(writes()[0].path,'/api/products/'+ids.at(-1));assert.deepEqual(JSON.parse(writes()[0].body),{action:'restore',expectedVersion:version,expectedRemovedAt:stamp});
  assert.match(text(ui.render()),/이 페이지에 남은 삭제 상품이 없습니다/);assert.equal(ui.button('이전').props.disabled,false);assert.equal(h.sqlite.prepare("SELECT COUNT(*) count FROM product_removals WHERE owner_id='owner-a'").get().count,200);
  ui.button('이전').props.onClick();await ui.settle();assert.match(text(ui.render()),/4 페이지/);assert.equal(ui.button('다음').props.disabled,true);
  ui.button('새로고침').props.onClick();await ui.settle();assert.match(text(ui.render()),/1 페이지/);assert.match(text(ui.render()),/보관 owner-a-0200/);assert.deepEqual(h.state.fileCalls,[]);
 }finally{ui?.close();h.close();}
});

test('late next-page responses and retained restore callbacks cannot cross an owner change or unmount',async()=>{
 const h=api(),pending=deferred();let ui;try{
  await h.seed(51);await h.seed(1,'owner-b');let delay=true;
  ui=dialog(async(path,init)=>path.includes('?cursor=')&&delay?pending.promise:h.fetcher(path,init));await ui.settle();
  const stale=ui.button('복원').props.onClick;ui.button('다음').props.onClick();await ui.settle();const oldRequest=ui.requests.at(-1);assert.ok(oldRequest.url.includes('?cursor='));
  const delayedResponse=await h.fetcher(oldRequest.url,oldRequest.init);h.state.owner='owner-b';delay=false;ui.changeOwner('owner-b');await ui.settle();assert.equal(oldRequest.init.signal.aborted,true);
  assert.match(text(ui.render()),/보관 owner-b-0000/);assert.match(text(ui.render()),/1 페이지/);pending.resolve(delayedResponse);await ui.settle();assert.doesNotMatch(text(ui.render()),/owner-a-/);
  stale();await ui.settle();assert.equal(h.state.requests.filter(request=>request.method==='DELETE').length,0);
  const next=ui.button('복원').props.onClick;ui.close();next();await ui.settle();assert.equal(ui.lateWrites,0);assert.equal(h.state.requests.filter(request=>request.method==='DELETE').length,0);
 }finally{ui?.close();h.close();}
});

test('the page validator fails closed on missing/malformed cursors, duplicate rows and invalid clocks',()=>{
 const h=api();try{
  const parse=h.load('app/product-removal-pagination.ts').parseRemovedProductsPage,row={id:'r',owner_id:'owner-a',title:'제목',source_url:'https://fixture.invalid/r',updated_at:version,removed_at:stamp};
  assert.deepEqual(plain(parse({products:[row],nextCursor:null},'owner-a')),{products:[row],nextCursor:null});
  for(const page of [{products:[row]},{products:[],nextCursor:'abc'},{products:[row],nextCursor:''},{products:[row,row],nextCursor:null},{products:[{...row,owner_id:'owner-b'}],nextCursor:null},{products:[{...row,removed_at:'yesterday'}],nextCursor:null},{products:Array.from({length:101},(_,i)=>({...row,id:String(i)})),nextCursor:null}])assert.throws(()=>parse(page,'owner-a'));
 }finally{h.close();}
});
