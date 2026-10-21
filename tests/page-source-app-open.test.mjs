import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPageSource} from '../extensions/supplier-hub/page-source.mjs';
import {savePageSource,sourceFingerprint} from '../extensions/supplier-hub/source-inbox.mjs';

const app='https://sourceflow.jjwwhhjj1116.workers.dev/';
const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const bounds={timeoutMs:500,pollMs:1};
let serial=78500;
const never=()=>new Promise(()=>{});
async function until(predicate){for(let count=0;count<200;count++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}assert.fail('The expected fake Chrome boundary was not reached');}
function snapshot(offerId='700000000785'){
 return extractPageSource({sourceUrl:`https://detail.1688.com/offer/${offerId}.html`,title:'合成耳帽商品',description:'원문 보존 테스트',priceText:'¥5.00 ~ ¥5.30',minimumOrderText:'1件起批',scripts:[JSON.stringify({skuModel:{offerId,skuInfoMap:{black:{specAttrs:'黑色',skuId:'black-785',price:'5.30'},grey:{specAttrs:'灰色',skuId:'grey-785',price:'5.00'}}},offerImgList:['https://cbu01.alicdn.com/synthetic-785.jpg']})]});
}
function harness({company=companies[1],existing=false,ready=true}={}){
 const windowId=++serial,sourceId=++serial,appId=++serial,tabs=new Map(),scopes=new Map(),records=new Map(),server=new Map(),calls=[];
 const h={windowId,sourceId,appId,tabs,scopes,records,server,calls,ready,contextReads:0,onContext:null,onQuery:null,onGet:null,onCreate:null,onSave:null,onUpdate:null,onStore:null};
 const add=(id=appId,extra={})=>{tabs.set(id,{id,windowId,url:app,active:false,...extra});scopes.set(id,{ok:true,ownerId:'owner_785',company:structuredClone(company)});return tabs.get(id);};h.add=add;if(existing)add();
 h.api={tabs:{
  query:async input=>{calls.push({type:'query',input:structuredClone(input)});if(h.onQuery)return h.onQuery(input);return [...tabs.values()].filter(tab=>tab.windowId===input.windowId).map(tab=>({...tab}));},
  create:async input=>{calls.push({type:'create',input:structuredClone(input)});assert.deepEqual(input,{windowId,url:app,active:true});const tab=add(appId,{active:true});if(h.onCreate)return h.onCreate(input,tab);return {...tab};},
  get:async id=>{calls.push({type:'get',id});if(h.onGet)return h.onGet(id);const tab=tabs.get(id);if(!tab)throw Error('closed tab');return {...tab};},
  sendMessage:async(id,message,options)=>{
   assert.deepEqual(options,{frameId:0});calls.push({type:message.type,id,...(message.record?{record:structuredClone(message.record)}:{})});
   if(message.type==='YOOFAM_READ_CATALOG_CONTEXT'){h.contextReads++;if(h.onContext)return h.onContext(id);return h.ready?structuredClone(scopes.get(id)):{ok:false};}
   assert.equal(message.type,'YOOFAM_SAVE_SOURCE_CAPTURE');assert.equal(records.has(message.record.id),true,'the immutable bound record must precede delivery');
   if(h.onSave)return h.onSave(id,message.record);
   const record=message.record,duplicate=server.has(record.id);server.set(record.id,structuredClone(record));
   return {ok:true,id:record.id,fingerprint:record.fingerprint,ownerId:record.ownerId,company:record.company,duplicate};
  },
  update:async(id,input)=>{calls.push({type:'update',id,input:structuredClone(input)});if(h.onUpdate)return h.onUpdate(id,input);assert.equal(tabs.get(id).windowId,windowId);assert.deepEqual(input,{active:true});tabs.get(id).active=true;return {...tabs.get(id)};},
 }};
 h.store=async(action,value)=>{calls.push({type:'store:'+action,...(action==='put'?{record:structuredClone(value)}:{})});if(h.onStore)await h.onStore(action,value);if(action==='list')return [...records.values()].map(row=>structuredClone(row));if(action==='put')records.set(value.id,structuredClone(value));if(action==='delete')records.delete(value);};
 h.source=(data,id=sourceId)=>({frameId:0,url:data.sourceUrl,tab:{id,windowId}});
 h.save=(data=snapshot(),id=sourceId,options=bounds)=>savePageSource({snapshot:data},h.source(data,id),h.api,h.store,options);
 h.count=type=>calls.filter(call=>call.type===type).length;
 return h;
}

test('an absent app opens only the fixed production URL in the source window, waits for approved identity, preserves the click snapshot and activates the exact ACK receiver for both companies',async()=>{
 for(const company of companies){
  const h=harness({company,ready:false}),input=snapshot(),original=JSON.stringify(input);
  h.onCreate=async(_input,tab)=>{tab.pendingUrl=app;return {...tab};};
  const pending=h.save(input);await until(()=>h.count('create')===1);
  input.title='this later source edit must not replace the clicked snapshot';
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(h.count('store:put'),0);assert.equal(h.count('YOOFAM_SAVE_SOURCE_CAPTURE'),0);
  delete h.tabs.get(h.appId).pendingUrl;h.ready=true;
  const result=await pending;assert.equal(result.ok,true);assert.equal(result.delivered,true);assert.equal(h.count('create'),1);assert.equal(h.count('store:put'),1);assert.equal(h.records.size,0);
  const saved=h.server.get(result.id);assert.equal(JSON.stringify(saved.snapshot),original);assert.equal(saved.fingerprint,await sourceFingerprint(JSON.parse(original)));assert.deepEqual(saved.company,company);assert.equal(saved.ownerId,'owner_785');assert.equal(saved.windowId,h.windowId);assert.equal(saved.origin,new URL(app).origin);
  const activation=h.calls.find(call=>call.type==='update');assert.deepEqual(activation,{type:'update',id:h.appId,input:{active:true}});assert.ok(h.calls.findIndex(call=>call.type==='store:delete')<h.calls.findIndex(call=>call.type==='update'));
 }
});

test('an existing valid app is reused and activated; loading app tabs are waited for without another create',async()=>{
 const h=harness({existing:true,ready:false});h.tabs.get(h.appId).pendingUrl=app;
 const pending=h.save();await until(()=>h.count('query')>1);assert.equal(h.count('create'),0);assert.equal(h.count('store:put'),0);
 delete h.tabs.get(h.appId).pendingUrl;h.ready=true;assert.equal((await pending).delivered,true);assert.equal(h.count('create'),0);assert.equal(h.count('update'),1);
});

test('concurrent product clicks from distinct source tabs share one same-window app creation and keep separate immutable bound records',async()=>{
 const h=harness({ready:false}),first=snapshot('700000000786'),second=snapshot('700000000787');
 const one=h.save(first),two=h.save(second,h.sourceId+1000);await until(()=>h.count('create')===1);await new Promise(resolve=>setTimeout(resolve,5));assert.equal(h.count('create'),1);assert.equal(h.count('store:put'),0);
 h.ready=true;const results=await Promise.all([one,two]);assert.ok(results.every(result=>result.delivered));assert.equal(h.count('create'),1);assert.equal(h.count('store:put'),2);assert.equal(h.server.size,2);assert.deepEqual([...h.server.values()].map(row=>row.snapshot.offerId).sort(),['700000000786','700000000787']);
 assert.equal(h.count('update'),2);assert.ok(h.calls.filter(call=>call.type==='update').every(call=>call.id===h.appId));
});

test('an exact duplicate click shares its operation, but another offer or changed snapshot in the same pending source tab never receives the first product ACK',async()=>{
 const h=harness({ready:false}),first=snapshot('700000000788'),original=JSON.stringify(first);
 const one=h.save(first);await until(()=>h.count('create')===1);
 const duplicate=h.save(structuredClone(first));
 const another=snapshot('700000000789');await assert.rejects(h.save(another),/이전 상품 수집이 진행 중.*현재 상품은 아직 수집하지 않았습니다/);
 const edited=structuredClone(first);edited.title='different snapshot';await assert.rejects(h.save(edited),/이전 상품 수집이 진행 중/);
 const movedSender={...h.source(first),tab:{id:h.sourceId,windowId:h.windowId+1}};
 await assert.rejects(savePageSource({snapshot:first},movedSender,h.api,h.store,bounds),/이전 상품 수집이 진행 중/);
 assert.equal(h.count('store:put'),0);h.ready=true;const [result,repeated]=await Promise.all([one,duplicate]);assert.deepEqual(result,repeated);assert.equal(h.count('create'),1);assert.equal(h.count('store:put'),1);assert.equal(h.count('YOOFAM_SAVE_SOURCE_CAPTURE'),1);assert.equal(JSON.stringify(h.server.get(result.id).snapshot),original);
 assert.equal([...h.server.values()].some(record=>record.snapshot.offerId===another.offerId),false,'no automatic second capture may follow the first ACK');
});

test('login timeout creates no unbound capture, releases the window lease, and explicit retry reuses the now-ready tab',async()=>{
 const h=harness({ready:false});await assert.rejects(h.save(snapshot(),h.sourceId,{timeoutMs:25,pollMs:1}),/초과.*로그인.*다시.*아직 수집함에 저장하지 않았습니다/);
 assert.equal(h.count('create'),1);assert.equal(h.count('store:put'),0);assert.equal(h.count('YOOFAM_SAVE_SOURCE_CAPTURE'),0);assert.equal(h.count('update'),0);
 h.ready=true;assert.equal((await h.save()).delivered,true);assert.equal(h.count('create'),1);assert.equal(h.count('store:put'),1);
});

test('every readiness Chrome RPC is bounded, including query, create, get and a context that never replies',async()=>{
 for(const method of ['query','create','get','sendMessage']){
  const h=harness();h.api.tabs[method]=never;const started=Date.now();
  await assert.rejects(h.save(snapshot(),h.sourceId,{timeoutMs:25,pollMs:1}),/초과.*다시.*아직 수집함에 저장하지 않았습니다/);
  assert.ok(Date.now()-started<1000,method+' must not hold the operation indefinitely');assert.equal(h.count('store:put'),0);assert.equal(h.count('store:delete'),0);
 }
});

test('conflicting approved owners or companies, including a new candidate appearing before storage, reject without routing or persistence',async()=>{
 for(const conflict of [{ownerId:'foreign_owner'},{company:companies[0]}]){
  const h=harness({existing:true});h.add(h.appId+1000);Object.assign(h.scopes.get(h.appId+1000),conflict);
  await assert.rejects(h.save(),/서로 다릅니다/);assert.equal(h.count('store:put'),0);assert.equal(h.count('YOOFAM_SAVE_SOURCE_CAPTURE'),0);assert.equal(h.count('create'),0);
 }
 const h=harness({existing:true});let lists=0;
 h.onStore=async action=>{if(action==='list'&&++lists===1){h.add(h.appId+1000);h.scopes.get(h.appId+1000).company=companies[0];}};
 await assert.rejects(h.save(),/서로 다릅니다/);assert.equal(h.count('store:put'),0);assert.equal(h.count('YOOFAM_SAVE_SOURCE_CAPTURE'),0);
});

test('a conflicting second context that hangs cannot let the first ready context bypass the bounded complete candidate check',async()=>{
 const h=harness({existing:true});h.add(h.appId+1000);h.onContext=id=>id===h.appId?structuredClone(h.scopes.get(id)):never();
 await assert.rejects(h.save(snapshot(),h.sourceId,{timeoutMs:25,pollMs:1}),/초과/);assert.equal(h.count('store:put'),0);assert.equal(h.count('YOOFAM_SAVE_SOURCE_CAPTURE'),0);
});

test('moved, navigating, or origin-changed receiving tabs cannot bind a snapshot or trigger a second app creation',async()=>{
 for(const mutate of [tab=>{tab.windowId++;},tab=>{tab.pendingUrl='https://unrelated.test/';},tab=>{tab.url='http://localhost:3000/';}]){
  const h=harness();h.onCreate=async(_input,tab)=>{mutate(tab);return {id:h.appId,windowId:h.windowId,url:app};};
  await assert.rejects(h.save(snapshot(),h.sourceId,{timeoutMs:25,pollMs:1}),/초과/);assert.equal(h.count('create'),1);assert.equal(h.count('store:put'),0);assert.equal(h.count('YOOFAM_SAVE_SOURCE_CAPTURE'),0);assert.equal(h.count('update'),0);
 }
});

test('tab changes while a context RPC is in flight are checked again before any bound write',async()=>{
 const h=harness({existing:true});h.onContext=id=>{const scope=structuredClone(h.scopes.get(id));h.tabs.get(id).windowId++;return scope;};
 await assert.rejects(h.save(snapshot(),h.sourceId,{timeoutMs:25,pollMs:1}),/초과/);assert.equal(h.count('store:put'),0);assert.equal(h.count('YOOFAM_SAVE_SOURCE_CAPTURE'),0);
});

test('the approved owner cannot change between readiness and the record write, even when the new owner is also approved',async()=>{
 const h=harness({existing:true});h.onStore=async action=>{if(action==='list')h.scopes.get(h.appId).ownerId='different_approved_owner';};
 await assert.rejects(h.save(),/로그인 회사가 변경/);assert.equal(h.count('store:put'),0);assert.equal(h.count('YOOFAM_SAVE_SOURCE_CAPTURE'),0);
});

test('lost or mismatched ACK retains the first immutable record; explicit reclick sends that exact snapshot and deletes only for the matching durable ACK',async()=>{
 for(const mismatch of [false,true]){
  const h=harness({existing:true}),input=snapshot();h.onSave=async(_id,record)=>{
   h.server.set(record.id,structuredClone(record));if(!mismatch)throw Error('lost app ACK');
   return {ok:true,id:record.id,fingerprint:'0'.repeat(64),ownerId:record.ownerId,company:record.company};
  };
  const first=await h.save(input);assert.equal(first.delivered,false);assert.equal(h.records.size,1);assert.equal(h.count('store:delete'),0);assert.equal(h.count('update'),0);
  const immutable=JSON.stringify([...h.records.values()][0]);input.title='later reclick must not overwrite an uncertain capture';input.options[0].unitPriceCny=99;
  h.onSave=null;const second=await h.save(input);assert.equal(second.delivered,true);assert.equal(second.duplicate,true);assert.equal(second.id,first.id);assert.equal(h.count('store:put'),1);assert.equal(h.count('store:delete'),1);assert.equal(h.records.size,0);
  assert.equal(JSON.stringify(h.server.get(first.id)),immutable);assert.equal(h.count('create'),0);
 }
});

test('a company change after the bound write retains the original record and never sends it to the replacement company',async()=>{
 const h=harness({existing:true});h.onStore=async action=>{if(action==='put')h.scopes.get(h.appId).company=companies[0];};
 const result=await h.save();assert.equal(result.delivered,false);assert.equal(h.count('YOOFAM_SAVE_SOURCE_CAPTURE'),0);assert.equal(h.records.size,1);assert.deepEqual([...h.records.values()][0].company,companies[1]);assert.equal(h.count('store:delete'),0);
});

test('activation failure or a post-ACK tab move cannot turn a durable matching save into failure or activate another window',async()=>{
 for(const move of [false,true]){
  const h=harness({existing:true});h.onUpdate=async()=>{throw Error('activation failed');};
  h.onStore=async action=>{if(action==='delete'&&move)h.tabs.get(h.appId).windowId++;};
  const result=await h.save();assert.equal(result.delivered,true);assert.equal(h.records.size,0);assert.equal(h.server.size,1);assert.equal(h.count('update'),move?0:1);
 }
});

test('app tabs in another Chrome window are never read, reused, activated or used for owner binding',async()=>{
 const h=harness();h.add(h.appId+1000,{windowId:h.windowId+1});const foreignId=h.appId+1000;
 // Even a query result containing an out-of-window tab cannot expand scope.
 h.onQuery=async()=>[...h.tabs.values()].map(tab=>({...tab}));
 assert.equal((await h.save()).delivered,true);assert.equal(h.count('create'),1);assert.equal(h.calls.some(call=>['get','YOOFAM_READ_CATALOG_CONTEXT','YOOFAM_SAVE_SOURCE_CAPTURE','update'].includes(call.type)&&call.id===foreignId),false);
});
