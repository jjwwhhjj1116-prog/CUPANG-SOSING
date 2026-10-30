import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {sourceReviewModule,reviewSourceFixture} from './helpers/source-review-intake.mjs';
import {savePageSource,flushPageSources} from '../extensions/supplier-hub/source-inbox.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
const origin='http://localhost:3000',company={code:'A01464742',name:'와이홉'},otherCompany={code:'A01526306',name:'유앤채'};
const json=(body,path='/api/source-inbox')=>{const response=Response.json(body);Object.defineProperty(response,'url',{value:origin+path});return response;};

function fixture({list=async owner=>json({ownerId:owner,company,items:[]}),context=async owner=>json({ownerId:owner,company},'/api/supplier-hub/catalog-context'),post=()=>{}}={}){
 const slots=[],layouts=[],effects=[],listeners={window:new Map(),document:new Map()},timers=new Map(),intervals=new Map(),calls=[],posted=[];
 let cursor=0,owner='owner',clock=100000,timer=0;
 const effect=(queue,fn,deps)=>{const index=cursor++,previous=slots[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i]))){slots[index]={deps,cleanup:previous?.cleanup};queue.push(()=>{slots[index].cleanup?.();slots[index].cleanup=fn();});}};
 const hooks={useState(value){const index=cursor++;if(!(index in slots))slots[index]=value;return[slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next;}];},useRef(value){const index=cursor++;return slots[index]??(slots[index]={current:value});},useMemo(fn,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))slots[index]={deps,value:fn()};return slots[index].value;},useCallback:fn=>fn,useLayoutEffect(fn,deps){effect(layouts,fn,deps);},useEffect(fn,deps){effect(effects,fn,deps);}};
 const add=(target,name,fn)=>{if(!listeners[target].has(name))listeners[target].set(name,new Set());listeners[target].get(name).add(fn);};
 const remove=(target,name,fn)=>listeners[target].get(name)?.delete(fn);
 const window={addEventListener:(name,fn)=>add('window',name,fn),removeEventListener:(name,fn)=>remove('window',name,fn),postMessage:(data,target)=>{posted.push({data:structuredClone(data),target});post(data,target);}};
 const document={visibilityState:'visible',addEventListener:(name,fn)=>add('document',name,fn),removeEventListener:(name,fn)=>remove('document',name,fn)};
 const location={origin};
 const {useSourceRegistrations}=sourceReviewModule('app/components/use-source-registrations.ts',{hooks,window,document,location,crypto:webcrypto,Date:class extends Date{static now(){return clock;}},
  setTimeout:(fn,delay)=>{const id=++timer;timers.set(id,{fn,due:clock+delay});return id;},clearTimeout:id=>timers.delete(id),setInterval:(fn)=>{const id=++timer;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),
  fetch:(path,init)=>{calls.push({path,init,owner});assert.ok(['/api/source-inbox','/api/supplier-hub/catalog-context','/api/source-inbox/title'].includes(path),'no upstream source or working product request');if(path==='/api/source-inbox/title'){assert.equal(init.method,'POST');const body=JSON.parse(init.body);assert.equal(body.expectedOwnerId,owner);assert.ok(body.id&&body.expectedFingerprint&&body.expectedRevision);return Response.json({error:'Title preparation is outside this delivery fixture'},{status:503});}return path==='/api/source-inbox'?list(owner,init):context(owner,init);}});
 function FixtureRender(passive=true){cursor=0;const result=useSourceRegistrations(owner);layouts.splice(0).forEach(fn=>fn());if(passive)effects.splice(0).forEach(fn=>fn());return result;}
 const emit=(target,name,event)=>{for(const fn of [...(listeners[target].get(name)??[])])fn(event);};
 const reply=(result,extra={})=>emit('window','message',{source:window,origin,data:{channel:'YOOFAM_SOURCE_INBOX_RESULT',requestId:posted.at(-1)?.data.requestId,result},...extra});
 return {calls,posted,window,document,location,render:FixtureRender,reply,
  setOwner(value,passive=true){owner=value;return FixtureRender(passive);},handlers:(target,name)=>[...(listeners[target].get(name)??[])],
  focus(trusted=true){emit('window','focus',{isTrusted:trusted});},visible(trusted=true){emit('document','visibilitychange',{isTrusted:trusted});},
  update(){emit('window','message',{source:window,origin,data:{channel:'YOOFAM_SOURCE_INBOX_UPDATED'}});},
  interval(){for(const fn of intervals.values())fn();},
  elapse(ms){clock+=ms;},
  async advance(ms){clock+=ms;for(let round=0;round<10;round++){const due=[...timers].filter(([,value])=>value.due<=clock).sort((a,b)=>a[1].due-b[1].due);if(!due.length){await turn();if(![...timers.values()].some(value=>value.due<=clock))break;continue;}for(const [id,value] of due)if(timers.delete(id))value.fn();await turn();}},
  close(){for(const slot of slots)slot?.cleanup?.();}};
}
const ack=(patch={})=>({ok:true,ownerId:'owner',company,delivered:0,pending:1,errors:['transient save ACK missing'],...patch});

for(const selectedCompany of [company,otherCompany])test(selectedCompany.code+': retained trusted capture survives a transient ACK failure, then genuine app focus delivers exact immutable record to the saved own list',async()=>{
 const company=selectedCompany,backend=mobileIntakeHarness({companyCode:company.code,companyName:company.name}),records=new Map(),{before}=reviewSourceFixture('owner',company),source=before.snapshot,api=backend.load('app/api/source-inbox/route.ts');
 const working={id:'untouched-working-product',title:'수정 중인 기존 상품',source_url:'https://detail.1688.com/offer/764000000002.html'},workingBefore=JSON.stringify(working);
 let offline=true,h,flushComplete=Promise.resolve();
 const store=async(action,value)=>action==='list'?[...records.values()]:action==='put'?records.set(value.id,structuredClone(value)):records.delete(value);
 const appTab={id:20,windowId:3,url:origin+'/'},extension={tabs:{query:async()=>[appTab],get:async()=>appTab,sendMessage:async(_tab,message)=>{
  if(message.type==='YOOFAM_READ_CATALOG_CONTEXT')return {ok:true,ownerId:'owner',company};
  assert.equal(message.type,'YOOFAM_SAVE_SOURCE_CAPTURE');if(offline)throw Error('transient save ACK missing');
  const record=message.record,response=await api.POST(new Request(origin+'/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:record.ownerId,expectedCompany:record.company,id:record.id,fingerprint:record.fingerprint,snapshot:record.snapshot})}));
  assert.equal(response.status,200);return response.json();
 }}};
 try{
  const captured=await savePageSource({snapshot:source},{frameId:0,url:source.sourceUrl,tab:{id:21,windowId:3}},extension,store);
  assert.equal(captured.delivered,false);assert.equal(records.size,1);const immutable=JSON.stringify([...records.values()][0]);
  h=fixture({list:async()=>api.GET(),context:async()=>json({ownerId:'owner',company},'/api/supplier-hub/catalog-context'),post:()=>{flushComplete=flushPageSources({}, {frameId:0,url:appTab.url,tab:appTab},extension,store).then(result=>h.reply(result));}});
  h.render();await turn();await h.advance(1500);await turn();assert.equal(h.posted.length,1);assert.equal(records.size,1);assert.equal(h.render().items.length,0);
  offline=false;await h.advance(1000);h.focus();h.visible();await h.advance(250);await flushComplete;await turn();assert.equal(h.posted.length,2);assert.equal(records.size,0);
  await turn();const rows=h.render().items;assert.equal(rows.length,1);assert.equal(rows[0].id,captured.id);assert.equal(rows[0].ownerId,'owner');assert.equal(rows[0].company.code,company.code);
  const retained=JSON.parse(immutable);assert.equal(rows[0].fingerprint,retained.fingerprint);assert.deepEqual(JSON.parse(JSON.stringify(rows[0].snapshot)),retained.snapshot);
  assert.equal(JSON.stringify(working),workingBefore);assert.equal(backend.sqlite.prepare('SELECT count(*) n FROM source_inbox').get().n,1);
  h.interval();await turn();await h.advance(30000);assert.equal(h.posted.length,2,'the list polling interval cannot flush or fetch a source page');
  assert.ok(h.calls.every(call=>!call.init.method||call.init.method==='GET'||call.path==='/api/source-inbox/title'&&call.init.method==='POST'));
 }finally{h?.close();backend.close();}
});

test('duplicate foreground events retain one outstanding lease; untrusted and interval events cannot flush',async()=>{
 const h=fixture();try{
  h.render();await turn();await h.advance(1500);assert.equal(h.posted.length,1);
  h.focus();h.visible();h.focus(false);h.interval();await h.advance(500);assert.equal(h.posted.length,1);
  h.reply(ack(),{origin:'https://foreign.test'});h.reply(ack(),{source:{}});h.reply(ack(),{data:{channel:'YOOFAM_SOURCE_INBOX_RESULT',requestId:'wrong',result:ack()}});await turn();
  h.focus();await h.advance(250);assert.equal(h.posted.length,1);
  h.reply(ack({ownerId:'foreign'}));h.focus();await h.advance(250);assert.equal(h.posted.length,1,'foreign ACK cannot release current delivery');
  h.reply(ack());await turn();await h.advance(1000);h.focus();h.visible();await h.advance(250);assert.equal(h.posted.length,2);
  h.reply(ack({ok:false,error:'extension disconnected'}));await turn();await h.advance(1500);h.focus(false);h.visible(false);h.interval();await h.advance(30000);assert.equal(h.posted.length,2);
 }finally{h.close();}
});

for(const selectedCompany of [company,otherCompany])test(selectedCompany.code+': lost flush result expires without a write, then extension recovery and trusted foreground replay exact persisted capture idempotently',async()=>{
 const company=selectedCompany,backend=mobileIntakeHarness({companyCode:company.code,companyName:company.name}),records=new Map(),source=reviewSourceFixture('owner',company).before.snapshot,api=backend.load('app/api/source-inbox/route.ts');
 let extensionAvailable=false,loseSaveAck=true,postCount=0,h,flushComplete=Promise.resolve();
 const store=async(action,value)=>action==='list'?[...records.values()]:action==='put'?records.set(value.id,structuredClone(value)):records.delete(value);
 const appTab={id:20,windowId:3,url:origin+'/'},extension={tabs:{query:async()=>[appTab],get:async()=>appTab,sendMessage:async(_tab,message)=>{
  if(message.type==='YOOFAM_READ_CATALOG_CONTEXT')return {ok:true,ownerId:'owner',company};
  assert.equal(message.type,'YOOFAM_SAVE_SOURCE_CAPTURE');postCount++;const record=message.record;
  const response=await api.POST(new Request(origin+'/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:record.ownerId,expectedCompany:record.company,id:record.id,fingerprint:record.fingerprint,snapshot:record.snapshot})}));
  assert.equal(response.status,200);const saved=await response.json();if(loseSaveAck)throw Error('durable POST committed but result was lost');return saved;
 }}};
 try{
  const first=await savePageSource({snapshot:source},{frameId:0,url:source.sourceUrl,tab:{id:21,windowId:3}},extension,store);assert.equal(first.delivered,false);assert.equal(records.size,1);const immutable=JSON.stringify([...records.values()][0]);
  assert.equal(backend.sqlite.prepare('SELECT count(*) n FROM source_inbox').get().n,1);
  h=fixture({list:async()=>api.GET(),context:async()=>json({ownerId:'owner',company},'/api/supplier-hub/catalog-context'),post:()=>{if(extensionAvailable)flushComplete=flushPageSources({}, {frameId:0,url:appTab.url,tab:appTab},extension,store).then(result=>h.reply(result));}});
  h.render();await turn();await h.advance(1500);assert.equal(h.posted.length,1);assert.equal(postCount,1);assert.equal(records.size,1);
  await h.advance(20000);assert.equal(h.posted.length,1,'deadline itself must never flush');assert.equal(postCount,1);assert.equal(JSON.stringify([...records.values()][0]),immutable);
  loseSaveAck=false;extensionAvailable=true;h.focus();h.visible();await h.advance(250);await flushComplete;await turn();await turn();
  assert.equal(h.posted.length,2);assert.equal(postCount,2);assert.equal(records.size,0);assert.equal(h.render().items.length,1);assert.equal(h.render().items[0].id,first.id);
  assert.equal(backend.sqlite.prepare('SELECT count(*) n FROM source_inbox').get().n,1);assert.equal(backend.sqlite.prepare('SELECT count(*) n FROM source_inbox_captures').get().n,0,'an exact retry is not a new capture version');
  assert.equal(h.render().items[0].fingerprint,JSON.parse(immutable).fingerprint);assert.deepEqual(JSON.parse(JSON.stringify(h.render().items[0].snapshot)),JSON.parse(immutable).snapshot);
 }finally{h?.close();backend.close();}
});

test('foreground checks the deadline even when background timers were throttled',async()=>{
 const h=fixture();try{h.render();await turn();await h.advance(1500);assert.equal(h.posted.length,1);h.elapse(20001);h.focus();await h.advance(250);assert.equal(h.posted.length,2);assert.equal(h.render().items.length,0);}
 finally{h.close();}
});

test('unknown old-owner delivery cannot block the next approved owner and old results cannot affect that owner',async()=>{
 const {before}=reviewSourceFixture('other',otherCompany);const h=fixture({context:async owner=>json({ownerId:owner,company:owner==='owner'?company:otherCompany},'/api/supplier-hub/catalog-context'),list:async owner=>json({ownerId:owner,company:owner==='owner'?company:otherCompany,items:owner==='other'?[before]:[]})});
 try{
  h.render();await turn();await h.advance(1500);const oldId=h.posted[0].data.requestId,oldMessage=h.handlers('window','message')[0];
  h.setOwner('other');await turn();await h.advance(1500);assert.equal(h.posted.length,2,'new owner gets its own bounded attempt without waiting for old ACK');const reads=h.calls.length;
  oldMessage({source:h.window,origin,data:{channel:'YOOFAM_SOURCE_INBOX_RESULT',requestId:oldId,result:ack()}});await turn();assert.equal(h.calls.length,reads);assert.equal(h.render().items[0].ownerId,'other');
  h.reply(ack({ownerId:'other',company:otherCompany,delivered:1,pending:0,errors:[]}));await turn();assert.equal(h.render().items[0].ownerId,'other');
 }finally{h.close();}
});

test('owner change before effect cleanup, ABA and stale callbacks cannot deliver or publish the old attempt',async()=>{
 let releaseContext;const h=fixture({context:()=>new Promise(resolve=>{releaseContext=resolve;})});
 try{
  h.render();await turn();const oldFocus=h.handlers('window','focus')[0],oldMessage=h.handlers('window','message')[0];await h.advance(1500);
  h.setOwner('other',false);oldFocus({isTrusted:true});releaseContext(json({ownerId:'owner',company},'/api/supplier-hub/catalog-context'));await turn();assert.equal(h.posted.length,0);assert.equal(h.render().items.length,0);
  h.setOwner('owner');oldFocus({isTrusted:true});oldMessage({source:h.window,origin,data:{channel:'YOOFAM_SOURCE_INBOX_UPDATED'}});await h.advance(250);assert.equal(h.posted.length,0,'A→B→A creates a new incarnation');
 }finally{h.close();}
});

test('posted old-owner result may settle its latch but cannot refresh after owner ABA or unmount',async()=>{
 const h=fixture();try{
  h.render();await turn();await h.advance(1500);const requestId=h.posted[0].data.requestId,oldMessage=h.handlers('window','message')[0];
  h.setOwner('other');await turn();h.setOwner('owner');await turn();const reads=h.calls.length;
  oldMessage({source:h.window,origin,data:{channel:'YOOFAM_SOURCE_INBOX_RESULT',requestId,result:ack()}});await turn();assert.equal(h.calls.length,reads);
  h.close();oldMessage({source:h.window,origin,data:{channel:'YOOFAM_SOURCE_INBOX_UPDATED'}});await h.advance(30000);assert.equal(h.posted.length,1);assert.equal(h.calls.length,reads);
 }finally{h.close();}
});

test('fresh approved company and exact same-origin response are required before and after delivery',async()=>{
 for(const response of [()=>json({ownerId:'other',company},'/api/supplier-hub/catalog-context'),()=>json({ownerId:'owner',company:{code:'A01464742',name:'유앤채'}},'/api/supplier-hub/catalog-context'),()=>json({ownerId:'owner',company:{code:'unknown'}},'/api/supplier-hub/catalog-context'),()=>json({ownerId:'owner',company},'/foreign')]){
  const h=fixture({context:async()=>response()});try{h.render();await turn();await h.advance(1500);assert.equal(h.posted.length,0);}finally{h.close();}
 }
 let current=company;const h=fixture({context:async()=>json({ownerId:'owner',company:current},'/api/supplier-hub/catalog-context')});
 try{
  h.render();await turn();await h.advance(1500);const reads=h.calls.filter(call=>call.path==='/api/source-inbox').length;
  current=otherCompany;h.reply(ack());await turn();assert.equal(h.calls.filter(call=>call.path==='/api/source-inbox').length,reads,'late result from previous company cannot refresh the saved list');
  current=company;await h.advance(1500);h.focus();await h.advance(250);assert.equal(h.posted.length,2);
  h.location.origin='https://changed.test';h.reply(ack());h.focus();await h.advance(30000);assert.equal(h.posted.length,2);
 }finally{h.close();}
});

test('company changes during the ACK-following list read cannot publish a foreign row',async()=>{
 let reads=0;const {before}=reviewSourceFixture();const h=fixture({list:async()=>++reads===1?json({ownerId:'owner',company,items:[]}):json({ownerId:'owner',company:otherCompany,items:[{...before,company:otherCompany}]})});
 try{h.render();await turn();await h.advance(1500);h.reply(ack({delivered:1,pending:0,errors:[]}));await turn();await turn();assert.equal(h.render().items.length,0);assert.ok(h.render().error);}
 finally{h.close();}
});

test('a saved review from the former company cannot be appended to the current company list',async()=>{
 let current=company;const {before,saved}=reviewSourceFixture();const h=fixture({list:async()=>json({ownerId:'owner',company:current,items:[]})});
 try{
  h.render();await turn();assert.equal(h.render().acceptReviewed(before,saved),true);assert.equal(h.render().items.length,1);
  current=otherCompany;h.render().reload();await turn();assert.equal(h.render().items.length,0);
 }finally{h.close();}
});
