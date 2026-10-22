import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';

const owner={ownerId:'synthetic-query-owner',company:{code:'A01526306',name:'유앤채'}},other={ownerId:'synthetic-query-other',company:{code:'A01464742',name:'와이홉'}};
const sourceUrl='https://detail.1688.com/offer/700000000791.html';
const snapshot={schemaVersion:1,sourceUrl,offerId:'700000000791',provider:'synthetic-local-query',collectedAt:new Date().toISOString(),title:'합성 서버 원문 상품',description:'합성 상세 설명',attributes:[{name:'재질',value:'합성 원문'}],options:[{sku:'synthetic-sku',name:'원문 옵션',unitPriceCny:3.5,minimumOrder:1,stock:5}],images:[{url:'https://cbu01.alicdn.com/synthetic-query-main.jpg',role:'main'}]};
const clone=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(' '):tree&&typeof tree==='object'?text(tree.props?.children):tree===null||tree===undefined||typeof tree==='boolean'?'':String(tree);
async function until(predicate){for(let index=0;index<200;index++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}throw Error('Synthetic component operation timed out');}
function harness({handler,scope=owner,disabled=false}={}){
 const cache=new Map(),slots=[],calls=[],added=[];let cursor=0,tree,requestNumber=0,props={ownerId:scope.ownerId,company:scope.company,disabled,onAdd:item=>added.push(item)},effects=[];
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];},useMemo(factory,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((value,i)=>value!==previous.deps[i]))slots[index]={deps,value:factory()};return slots[index].value;}};
 const effect=(setup,deps)=>{const index=cursor++,previous=slots[index];if(!previous||!deps||deps.some((value,i)=>value!==previous.deps?.[i])){slots[index]={deps,setup,cleanup:previous?.cleanup};effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=setup();});}};hooks.useEffect=effect;hooks.useLayoutEffect=effect;
 const fetcher=async(path,init={})=>{const call={path,...init,body:init.body?JSON.parse(init.body):undefined};calls.push(call);if(handler)return handler(call,api);if(path==='/api/supplier-hub/catalog-context')return Response.json(scope);if(path==='/api/query-captures'&&init.method==='GET')return Response.json({...scope,captures:[]});if(path==='/api/query-captures'&&init.method==='POST')return Response.json({...scope,item:await item(call.body.id),duplicate:false,sourceStored:true,draftCreated:false});throw Error('No real network permitted');};
 const crypto={subtle:webcrypto.subtle,randomUUID:()=>`00000000-0000-4000-8000-${String(++requestNumber).padStart(12,'0')}`};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);const jsx=(type,props)=>({type,props});vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,Date,URL,URLSearchParams,Response,Request,Headers,AbortController,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,structuredClone,crypto,setTimeout,clearTimeout,fetch:fetcher,require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name.startsWith('@/'))return load(name.slice(2)+'.ts');throw Error('Unsupported synthetic dependency '+name);}},{filename:file});return exports;}
 const model=load('app/query-source-capture.ts');
 async function item(id='00000000-0000-4000-8000-000000000791',patch={}){const source=model.normalizeQuerySourceCapture(clone(snapshot));return{id,...scope,fingerprint:await model.querySourceFingerprint(source),snapshot:source,revision:1,captureVersion:1,receivedAt:new Date().toISOString(),archivedAt:null,...patch};}
 const component=load('app/components/query-source-panel.tsx').QuerySourcePanel;
 const api={calls,added,item,summary:item=>model.querySourceCaptureSummary(item),load,render(next){if(next)props={...props,...next};cursor=0;effects=[];tree=component(props);for(const run of effects)run();return tree;},find(predicate){return nodes(tree).find(predicate);},message(){return nodes(tree).filter(node=>node.props?.role==='status').map(text).join(' ');},text:()=>text(tree),input(value){api.find(node=>node.type==='input').props.onChange({target:{value}});api.render();},capture(){api.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});},loadList(){api.find(node=>node.type==='button'&&text(node)==='서버 수집함 불러오기').props.onClick();},select(){api.find(node=>node.type==='button'&&text(node)==='카테고리 선택·초안 작성').props.onClick();},unmount(){for(const slot of slots)slot?.cleanup?.();},get busy(){return slots[2]?.busy??false;}};
 api.render();return api;
}
test('mounting the URL collector performs no network work and leaves the source input empty',()=>{
 const h=harness();try{assert.equal(h.calls.length,0);assert.equal(h.find(node=>node.type==='input').props.value,'');assert.equal(h.added.length,0);}finally{h.unmount();}
});
test('explicit source capture stores a validated full server source without making a product or category selection',async()=>{
 const h=harness();try{h.input(sourceUrl+'?spm=synthetic');h.capture();await until(()=>h.calls.length===1);await until(()=>h.busy===false);h.render();assert.equal(h.calls[0].path,'/api/query-captures');assert.equal(h.calls[0].method,'POST');assert.deepEqual(h.calls[0].body.expectedCompany,owner.company);assert.equal(h.calls[0].body.sourceUrl,sourceUrl);assert.equal(h.calls[0].redirect,'manual');assert.match(h.message(),/서버 수집함에 저장/);assert.match(h.text(),/합성 서버 원문 상품/);assert.equal(h.added.length,0);assert.ok(h.calls.every(call=>!call.path.includes('1688.com')));}finally{h.unmount();}
});
test('uncertain ACK retries exactly the same id and canonical URL until a valid stored acknowledgement',async()=>{
 let count=0;const h=harness({handler:async(call,h)=>{count++;if(count===1)throw new TypeError('synthetic lost ACK');return Response.json({...owner,item:await h.item(call.body.id),duplicate:true,sourceStored:true,draftCreated:false});}});
 try{h.input(sourceUrl);h.capture();await until(()=>!h.busy);h.render();assert.doesNotMatch(h.message(),/保存|保存済み|저장했습니다/);h.capture();await until(()=>h.calls.length===2&&!h.busy);h.render();assert.deepEqual(h.calls[0].body,h.calls[1].body);assert.match(h.message(),/서버 수집함에 저장/);}finally{h.unmount();}
});
test('editing to another offer after uncertainty starts a new request id',async()=>{
 const h=harness({handler:async()=>Response.json({code:'QUERY_CAPTURE_UNCERTAIN'},{status:503})});try{h.input(sourceUrl);h.capture();await until(()=>!h.busy);h.render();h.input('https://detail.1688.com/offer/700000000792.html');h.capture();await until(()=>h.calls.length===2&&!h.busy);assert.notEqual(h.calls[0].body.id,h.calls[1].body.id);assert.notEqual(h.calls[0].body.sourceUrl,h.calls[1].body.sourceUrl);}finally{h.unmount();}
});
test('invalid URL and disabled workspace cannot execute a capture',async()=>{
 const h=harness();try{h.input('https://evil.test/offer/700000000791.html');h.capture();await until(()=>!h.busy);assert.equal(h.calls.length,0);h.render({disabled:true});h.input(sourceUrl);h.capture();assert.equal(h.calls.length,0);}finally{h.unmount();}
});
test('a saved summary enters category selection only after a fresh current-company check',async()=>{
 const h=harness({handler:async(call,h)=>call.path==='/api/supplier-hub/catalog-context'?Response.json(owner):Response.json({...owner,captures:[h.summary(await h.item())]})});try{h.loadList();await until(()=>!h.busy);h.render();h.select();await until(()=>h.added.length===1);assert.equal(h.calls.length,2);assert.equal(h.calls[1].path,'/api/supplier-hub/catalog-context');assert.equal(h.added[0].sourceUrl,sourceUrl);const selected=h.load('app/source-capture-selection.ts').querySourceCaptureSelection(h.added[0]);assert.equal(selected.format,'yoofam-saved-query-capture-v1');assert.equal(h.calls.filter(call=>call.method==='POST').length,0);}finally{h.unmount();}
});
test('wrong-company list and category-selection recheck cannot open an old capture',async()=>{
 const h=harness({handler:async()=>Response.json({...other,captures:[]})});try{h.loadList();await until(()=>!h.busy);h.render();assert.match(h.message(),/현재 계정/);assert.equal(h.added.length,0);}finally{h.unmount();}
 const second=harness({handler:async(call,h)=>call.path==='/api/supplier-hub/catalog-context'?Response.json(other):Response.json({...owner,captures:[h.summary(await h.item())]})});try{second.loadList();await until(()=>!second.busy);second.render();second.select();await until(()=>!second.busy);second.render();assert.match(second.message(),/변경/);assert.equal(second.added.length,0);}finally{second.unmount();}
});
test('scope replacement aborts the old request and drops its late completion without hiding new-owner controls',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const h=harness({handler:async(call,h)=>{const result=await h.item(call.body.id);await gate;return Response.json({...owner,item:result,duplicate:false,sourceStored:true,draftCreated:false});}});try{h.input(sourceUrl);h.capture();await until(()=>h.calls.length===1);h.render({ownerId:other.ownerId,company:other.company});assert.equal(h.calls[0].signal.aborted,true);release();await new Promise(resolve=>setTimeout(resolve,5));h.render();assert.doesNotMatch(h.text(),/합성 서버 원문 상품|서버 수집함에 저장했습니다/);assert.equal(h.added.length,0);}finally{release?.();h.unmount();}
});
test('duplicate ACK requires source fingerprint, owner and a never-created draft flag',async()=>{
 for(const mutation of [item=>({...item,id:'not-an-id'}),item=>({...item,fingerprint:'0'.repeat(64)}),item=>({...item,company:other.company}),item=>({...item,revision:0})]){
  const h=harness({handler:async(call,h)=>Response.json({...owner,item:mutation(await h.item(call.body.id)),duplicate:true,sourceStored:true,draftCreated:false})});try{h.input(sourceUrl);h.capture();await until(()=>!h.busy);h.render();assert.doesNotMatch(h.message(),/서버 수집함에 저장했습니다/);assert.equal(h.find(node=>node.type==='button'&&text(node)==='카테고리 선택·초안 작성'),undefined);assert.equal(h.added.length,0);}finally{h.unmount();}
 }
 const h=harness({handler:async(call,h)=>Response.json({...owner,item:await h.item(call.body.id),duplicate:false,sourceStored:true,draftCreated:true})});try{h.input(sourceUrl);h.capture();await until(()=>!h.busy);h.render();assert.doesNotMatch(h.message(),/서버 수집함에 저장했습니다/);assert.equal(h.added.length,0);}finally{h.unmount();}
});
test('a duplicate can acknowledge an already-stored immutable id, but a new save cannot substitute its request id',async()=>{
 for(const duplicate of [true,false]){const h=harness({handler:async(_call,h)=>Response.json({...owner,item:await h.item('00000000-0000-4000-8000-000000000799'),duplicate,sourceStored:true,draftCreated:false})});try{h.input(sourceUrl);h.capture();await until(()=>!h.busy);h.render();assert.equal(Boolean(h.find(node=>node.type==='button'&&text(node)==='카테고리 선택·초안 작성')),duplicate);assert.equal(/서버 수집함에 저장했습니다/.test(h.message()),duplicate);assert.equal(h.added.length,0);}finally{h.unmount();}}
});
test('HTML/login redirects never turn an uncertain capture into a completed row',async()=>{
 const h=harness({handler:async()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}})});try{h.input(sourceUrl);h.capture();await until(()=>!h.busy);h.render();assert.match(h.message(),/응답/);assert.equal(h.added.length,0);assert.equal(h.find(node=>node.type==='button'&&text(node)==='카테고리 선택·초안 작성'),undefined);}finally{h.unmount();}
});
test('archive and restore use the exact capture revision without deleting a source or preparing a product',async()=>{
 let revision=1,archivedAt=null;const h=harness({handler:async(call,h)=>{
  const row=()=>h.item('00000000-0000-4000-8000-000000000791',{revision,archivedAt});
  if(call.method==='PATCH'){assert.equal(call.body.expectedRevision,revision);assert.deepEqual(call.body.expectedCompany,owner.company);revision++;archivedAt=call.body.action==='archive'?new Date().toISOString():null;return Response.json({...owner,item:h.summary(await row()),sourceStored:true,draftCreated:false});}
  assert.equal(call.method,'GET');return Response.json({...owner,captures:call.path.endsWith('?view=archived')===Boolean(archivedAt)?[h.summary(await row())]:[]});
 }});try{
  h.loadList();await until(()=>!h.busy);h.render();h.find(node=>node.type==='button'&&text(node)==='보관').props.onClick();await until(()=>!h.busy);h.render();assert.match(h.message(),/원문과 기존 작업 상품은 유지/);assert.equal(h.find(node=>node.type==='button'&&text(node)==='카테고리 선택·초안 작성'),undefined);
  h.find(node=>node.type==='button'&&text(node)==='보관된 수집함').props.onClick();await until(()=>!h.busy);h.render();assert.equal(h.find(node=>node.type==='button'&&text(node)==='카테고리 선택·초안 작성'),undefined);h.find(node=>node.type==='button'&&text(node)==='보관 해제').props.onClick();await until(()=>!h.busy);h.render();assert.match(h.message(),/보관을 해제/);assert.equal(revision,3);assert.equal(h.added.length,0);assert.equal(h.calls.some(call=>call.method==='POST'||call.method==='DELETE'),false);assert.equal(h.calls.filter(call=>call.method==='PATCH').length,2);
 }finally{h.unmount();}
});
test('stale archive acknowledgement preserves the visible record and never retries automatically',async()=>{
 const h=harness({handler:async(call,h)=>call.method==='PATCH'?Response.json({error:'stale'},{status:409}):Response.json({...owner,captures:[h.summary(await h.item())]})});try{h.loadList();await until(()=>!h.busy);h.render();h.find(node=>node.type==='button'&&text(node)==='보관').props.onClick();await until(()=>!h.busy);h.render();assert.match(h.message(),/목록을 다시/);assert.match(h.text(),/합성 서버 원문 상품/);assert.equal(h.calls.filter(call=>call.method==='PATCH').length,1);assert.equal(h.added.length,0);}finally{h.unmount();}
});
