import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const snapshot={sourceUrl:'https://detail.1688.com/offer/700000000001.html',offerId:'700000000001',title:'테스트 수집 상품',options:[{key:'one'}],images:[]};
const item={id:'capture',ownerId:'owner',snapshot,reviewed:null,receivedAt:'2026-10-19T00:00:00Z',archivedAt:null,issues:[]};
function module(file,scope={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,...scope});return exports;}

test('source list entry keeps prices unknown and never overwrites or duplicates working products',()=>{
 const {sourceRegistrationRows}=module('app/source-registration.ts');
 const product={id:'working',source_url:snapshot.sourceUrl+'?existing=1',title:'작업중 수정 제목'};
 const original=JSON.stringify(product);
 assert.equal(sourceRegistrationRows([item],[product]).length,0);
 assert.equal(JSON.stringify(product),original);
 const [row]=sourceRegistrationRows([item],[]);
 assert.equal(row.supply_price,null);assert.equal(row.sale_price,null);
 assert.equal(row.registration_status,'카테고리 대기');assert.equal(row.source_capture,item);
 assert.equal(sourceRegistrationRows([{...item,archivedAt:'2026-10-19'}],[]).length,0);
});

function hookFixture(fetcher){
 const states=[],effects=[],events=new Map(),timers=new Map(),posted=[],calls=[];let cursor=0,owner='owner',first=true,cleanup,nextTimer=0;
 const hooks={useState(initial){const index=cursor++;if(!(index in states))states[index]=initial;return[states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},useRef(value){const index=cursor++;return states[index]??(states[index]={current:value});},useCallback:fn=>fn,useEffect(fn){if(first)effects.push(fn);}};
 const window={addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name,fn)=>{if(events.get(name)===fn)events.delete(name);},postMessage:value=>posted.push(value)};
 const document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 const {useSourceRegistrations}=module('app/components/use-source-registrations.ts',{require:()=>hooks,window,document,location:{origin:'https://app.test'},crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},AbortController,Error,
  setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),setInterval:()=>999,clearInterval(){},
  fetch:(path,init)=>{calls.push({path,init});return fetcher(path,init);}});
 const render=()=>{cursor=0;const result=useSourceRegistrations(owner);effects.splice(0).forEach(fn=>{cleanup=fn();});first=false;return result;};
 return{render,calls,posted,window,close:()=>cleanup?.(),owner:value=>{cleanup?.();owner=value;first=true;},event:()=>events.get('message')?.({source:window,origin:'https://app.test',data:{channel:'YOOFAM_SOURCE_INBOX_UPDATED'}}),flush:()=>{for(const fn of [...timers.values()])fn();}};
}
test('app automatically reads captures and refreshes the registration list after extension acknowledgement',async()=>{
 let items=[];const h=hookFixture(async()=>Response.json({ownerId:'owner',items}));
 try{
  h.render();await turn();assert.equal(h.calls.length,1);assert.equal(h.render().items.length,0);
  items=[item];h.event();await turn();assert.equal(h.render().items[0].id,'capture');
  assert.ok(h.calls.every(call=>call.path==='/api/source-inbox'&&!call.init.method));
  h.flush();assert.equal(h.posted[0].channel,'YOOFAM_SOURCE_INBOX');assert.equal(h.posted[0].type,'FLUSH');
 }finally{h.close();}
});
test('capture arriving during a list read queues one refresh; account change discards late old-owner data',async()=>{
 const releases=[];const h=hookFixture(()=>new Promise(resolve=>releases.push(resolve)));
 h.render();h.event();assert.equal(h.calls.length,1);
 releases.shift()(Response.json({ownerId:'owner',items:[]}));await turn();assert.equal(h.calls.length,2);
 const old=releases.shift();h.owner('other');assert.equal(h.render().items.length,0);old(Response.json({ownerId:'owner',items:[item]}));await turn();assert.equal(h.render().items.length,0);
 releases.shift()(Response.json({ownerId:'other',items:[]}));await turn();assert.equal(h.render().items.length,0);h.close();
});
