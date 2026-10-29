import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {reviewSourceFixture} from './helpers/source-review-intake.mjs';

const native=createRequire(import.meta.url),companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const plain=value=>JSON.parse(JSON.stringify(value));
function dashboard(company,initialMode='history'){
 const slots=[],layouts=[],effects=[],cache=new Map(),requests=[];let index=0,closed=false,lateWrites=0,owner='owner-a',mode=initialMode,currentCompany=company;
 const saved=reviewSourceFixture(owner,company).saved;
 const products=[{id:'protected-product',owner_id:owner,source_url:'synthetic://protected-product',title:'기존 작업 유지',updated_at:'2026-10-21T00:00:00.000Z',created_at:'2026-10-21T00:00:00.000Z',image_keys:'[]',options_count:1}];
 const jobs=[];
 const draft={rows:[{id:'old-pending',url:'기존 미완성 URL',features:'입력 보존',keywords:'수동',status:'draft'}],goal:'work',ready:true,loading:false,saving:false,dirty:true,message:'기존 입력 보관',setRows(update){draft.rows=update(draft.rows);},setGoal(){},save(){},load(){}};
 const effect=(queue,fn,deps)=>{const i=index++,previous=slots[i];if(!previous||!deps||deps.some((value,n)=>!Object.is(value,previous.deps[n]))){const next={deps,cleanup:previous?.cleanup};slots[i]=next;queue.push(()=>{next.cleanup?.();next.cleanup=fn();});}};
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{if(closed){lateWrites++;return;}slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useMemo(fn,deps){const i=index++,previous=slots[i];if(!previous||deps.some((value,n)=>!Object.is(value,previous.deps[n])))slots[i]={deps,value:fn()};return slots[i].value;},useCallback(fn,deps){const i=index++,previous=slots[i];if(!previous||deps.some((value,n)=>!Object.is(value,previous.deps[n])))slots[i]={deps,fn};return slots[i].fn;},useLayoutEffect(fn,deps){effect(layouts,fn,deps);},useEffect(fn,deps){effect(effects,fn,deps);}};
 const fetcher=async(url,init={})=>{
  requests.push({url,method:init.method??'GET'});assert.equal(init.method??'GET','GET','preparing a category never creates or transmits products');
  if(url==='/api/products')return mode==='products'?Response.json({error:'상품 목록 조회 실패'},{status:503}):Response.json({products});
  if(url==='/api/collection-jobs')return mode==='history'?Response.json({error:'이전 수집 요청 목록 조회 실패'},{status:503}):Response.json({jobs});
  if(url==='/api/settings')return mode==='settings'?Response.json({error:'설정 조회 실패'},{status:503}):Response.json({settings:{brand:currentCompany.name},scope:{ownerId:mode==='wrong-owner'?'foreign-owner':owner,company:mode==='no-company'?null:currentCompany}});
  assert.fail('Unexpected synthetic dashboard request '+url);
 };
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,URL,URLSearchParams,Date,AbortController,AbortSignal,crypto,structuredClone,fetch:fetcher,window:{addEventListener(){},removeEventListener(){},setTimeout:()=>0,confirm:()=>false},require(name){
  if(name==='react')return hooks;if(name.endsWith('.css'))return{};
  if(name==='@/app/components/use-intake-draft')return{useIntakeDraft:()=>draft};
  if(name==='@/app/components/use-source-registrations')return{useSourceRegistrations:()=>({items:[saved],error:'',reload(){},acceptReviewed:()=>false})};
  if(name==='@/app/components/use-registration-layout')return{useRegistrationLayout:()=>({layout:null,pendingLayout:null,loading:false,error:''})};
  if(name==='@/app/load-category-profiles')return{loadCategoryProfiles:async()=>{requests.push({url:'/api/category-profiles',method:'GET'});if(mode==='categories')throw Error('카테고리 조회 실패');return[];}};
  if(name.startsWith('@/app/components/')){const Component=()=>null;Component.displayName=name.slice('@/app/components/'.length);return new Proxy({default:Component},{get(target,key){return key in target?target[key]:Component;}});}
  return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);
 }});return exports;}
 const Dashboard=load('app/components/dashboard-client.tsx').default;
 const render=()=>{if(closed)return null;index=0;const tree=Dashboard({userName:currentCompany.name,workspaceOwnerId:owner});layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;};
 const component=name=>nodes(render()).find(node=>node.type?.displayName===name)?.props;
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label);
 return{render,component,button,requests,draft,products,jobs,saved,get lateWrites(){return lateWrites;},async settle(){for(let n=0;n<15;n++){render();await new Promise(resolve=>setImmediate(resolve));}},setMode(value){mode=value;},switchOwner(value,nextCompany=currentCompany){owner=value;currentCompany=nextCompany;render();},close(){if(closed)return;closed=true;for(const slot of slots)slot?.cleanup?.();}};
}

for(const company of companies){
 test(`${company.code}: a distinct immutable capture opens only a new local fork seed while five same-URL pending rows stay exact`,async()=>{
  const h=dashboard(company,'ready');try{
   const sourceUrl=h.saved.snapshot.sourceUrl,jobId='11111111-1111-4111-8111-111111111111';h.products[0].source_url=sourceUrl;
   h.jobs.push({id:jobId,product_id:h.products[0].id,source_url:sourceUrl,status:'awaiting_connector',created_at:'2026-10-20T00:00:00.000Z'});
   h.draft.rows=Array.from({length:5},(_,index)=>({id:'preserved-'+index,url:sourceUrl,status:index===4?'saved':index%2?'error':'draft',features:'수동 특징 '+index,keywords:'수동 키워드 '+index,message:'보관 '+index,
    ...(index===0?{pendingJobId:'unknown-request'}:index===1?{forkJobId:jobId,sourceCapture:{format:'yoofam-saved-page-capture-v1',sourceUrl,captureId:'22222222-2222-4222-8222-222222222222',fingerprint:'b'.repeat(64),revision:1}}:index===4?{productId:'old-saved-product'}:{})}));
   await h.settle();const before=JSON.stringify({rows:h.draft.rows,products:h.products,jobs:h.jobs}),references=[...h.draft.rows],reads=h.requests.length;
   h.component('source-inbox-panel').onAdd(h.saved);await h.settle();const queue=h.component('intake-queue-panel');assert.ok(queue);
   assert.equal(queue.sourceSeed.forkJobId,jobId);assert.equal(queue.sourceSeed.sourceCapture.captureId,h.saved.id);assert.equal(queue.sourceSeed.sourceCapture.fingerprint,h.saved.fingerprint);
   assert.equal(h.requests.length,reads,'new seed never posts or retries an existing request');assert.equal(JSON.stringify({rows:h.draft.rows,products:h.products,jobs:h.jobs}),before);assert.ok(h.draft.rows.every((row,index)=>row===references[index]));
  }finally{h.close();}
 });

 test(`${company.code}: exact capture is found after another same-URL row and reused without a new category seed`,async()=>{
  const h=dashboard(company,'ready');try{
   const sourceUrl=h.saved.snapshot.sourceUrl,jobId='11111111-1111-4111-8111-111111111111';h.products[0].source_url=sourceUrl;
   h.jobs.push({id:jobId,product_id:h.products[0].id,source_url:sourceUrl,status:'awaiting_connector',created_at:'2026-10-20T00:00:00.000Z'});
   h.draft.rows.push({id:'other-capture',url:sourceUrl,status:'error',forkJobId:jobId,sourceCapture:{format:'yoofam-saved-page-capture-v1',sourceUrl,captureId:'22222222-2222-4222-8222-222222222222',fingerprint:'b'.repeat(64),revision:1}},
    {id:'exact-capture',url:sourceUrl,status:'error',forkJobId:jobId,sourceCapture:{format:'yoofam-saved-page-capture-v1',sourceUrl,captureId:h.saved.id,fingerprint:h.saved.fingerprint,revision:h.saved.revision}});
   await h.settle();const before=JSON.stringify(h.draft.rows),reads=h.requests.length;h.component('source-inbox-panel').onAdd(h.saved);await h.settle();
   const queue=h.component('intake-queue-panel');assert.ok(queue);assert.equal(queue.sourceSeed,undefined);assert.equal(JSON.stringify(h.draft.rows),before);assert.equal(h.requests.length,reads);
  }finally{h.close();}
 });

 test(`${company.code}: no known fork, active job, changed exact request and full queues keep their original guards`,async()=>{
  for(const mode of ['no-fork','running','exact-other-request','full']){const h=dashboard(company,'ready');try{
   const sourceUrl=h.saved.snapshot.sourceUrl,jobId='11111111-1111-4111-8111-111111111111';
   if(mode!=='no-fork'){h.products[0].source_url=sourceUrl;h.jobs.push({id:jobId,product_id:h.products[0].id,source_url:sourceUrl,status:mode==='running'?'processing':'awaiting_connector',created_at:'2026-10-20T00:00:00.000Z'});}
   h.draft.rows=Array.from({length:mode==='full'?50:1},(_,index)=>({id:'pending-'+index,url:sourceUrl,status:'error',pendingJobId:'unknown-request',features:'수동 보관',...(mode==='exact-other-request'?{forkJobId:'22222222-2222-4222-8222-222222222222',sourceCapture:{format:'yoofam-saved-page-capture-v1',sourceUrl,captureId:h.saved.id,fingerprint:h.saved.fingerprint,revision:h.saved.revision}}:{})}));
   await h.settle();const before=JSON.stringify({rows:h.draft.rows,products:h.products,jobs:h.jobs}),reads=h.requests.length;h.component('source-inbox-panel').onAdd(h.saved);await h.settle();
   assert.equal(h.component('intake-queue-panel'),undefined,mode);assert.equal(JSON.stringify({rows:h.draft.rows,products:h.products,jobs:h.jobs}),before,mode);assert.equal(h.requests.length,reads,mode);
  }finally{h.close();}}
 });

 test(`${company.code}: explicit newer capture opens a separate-draft seed while saved rows and existing products remain unchanged`,async()=>{
  const h=dashboard(company,'ready');try{
   h.products[0].source_url=h.saved.snapshot.sourceUrl;
   h.jobs.push({id:'11111111-1111-4111-8111-111111111111',product_id:h.products[0].id,source_url:h.saved.snapshot.sourceUrl,status:'completed',created_at:'2026-10-20T00:00:00.000Z'});
   h.draft.rows.push({id:'saved-old',url:h.saved.snapshot.sourceUrl,status:'saved',productId:h.products[0].id,features:'직접 보존',keywords:'수동'});
   await h.settle();const before=JSON.stringify({rows:h.draft.rows,products:h.products,jobs:h.jobs}),reads=h.requests.length;
   h.component('source-inbox-panel').onAdd(h.saved);await h.settle();const queue=h.component('intake-queue-panel');
   assert.ok(queue);assert.equal(queue.sourceSeed.forkJobId,h.jobs[0].id);assert.equal(queue.sourceSeed.sourceCapture.captureId,h.saved.id);
   assert.equal(JSON.stringify({rows:h.draft.rows,products:h.products,jobs:h.jobs}),before);assert.equal(h.requests.length,reads);
   assert.equal(h.component('source-inbox-panel').existingProducts[0].id,h.products[0].id);
  }finally{h.close();}
 });

 test(`${company.code}: failed previous-job list preserves its warning but permits exact captured-source category review without writes`,async()=>{
  const h=dashboard(company);try{
   await h.settle();const previous=JSON.stringify({rows:h.draft.rows,products:h.products}),reads=h.requests.length;
   assert.match(text(h.render()),/이전 수집 요청 목록 조회 실패/);
   h.component('registration-board').onPrepareSource(h.saved);await h.settle();const queue=h.component('intake-queue-panel');assert.ok(queue);
   assert.equal(queue.sourceSeed.sourceUrl,h.saved.snapshot.sourceUrl);assert.deepEqual(plain(queue.sourceSeed.sourceCapture),{format:'yoofam-saved-page-capture-v1',sourceUrl:h.saved.snapshot.sourceUrl,captureId:h.saved.id,fingerprint:h.saved.fingerprint,revision:h.saved.revision});
   assert.equal(queue.sourceSeed.title,h.saved.reviewed.title);assert.equal(h.requests.length,reads,'only category review is opened, no background retry or generation');assert.equal(JSON.stringify({rows:h.draft.rows,products:h.products}),previous);assert.match(text(h.render()),/이전 수집 요청 목록 조회 실패/);
  }finally{h.close();}
 });

 test(`${company.code}: settings, products, categories, owner and company failures still block new captured-source preparation`,async()=>{
  for(const mode of ['settings','products','categories','wrong-owner','no-company']){
   const h=dashboard(company,mode);try{await h.settle();const before=JSON.stringify({rows:h.draft.rows,products:h.products}),reads=h.requests.length;h.component('registration-board').onPrepareSource(h.saved);await h.settle();assert.equal(h.component('intake-queue-panel'),undefined,mode);assert.equal(h.requests.length,reads,mode);assert.equal(JSON.stringify({rows:h.draft.rows,products:h.products}),before,mode);}finally{h.close();}
  }
 });

 test(`${company.code}: mismatched source identity and already-working product remain protected`,async()=>{
  for(const change of ['owner','company','capture','existing-product']){
   const h=dashboard(company);try{
    await h.settle();const item=structuredClone(h.saved);if(change==='owner')item.ownerId='foreign-owner';if(change==='company')item.company=companies.find(value=>value.code!==company.code);if(change==='capture')item.fingerprint='bad';if(change==='existing-product')item.snapshot.sourceUrl=h.products[0].source_url;
    const before=JSON.stringify({rows:h.draft.rows,products:h.products}),reads=h.requests.length;h.component('registration-board').onPrepareSource(item);await h.settle();assert.equal(h.component('intake-queue-panel'),undefined,change);assert.equal(h.requests.length,reads,change);assert.equal(JSON.stringify({rows:h.draft.rows,products:h.products}),before,change);
   }finally{h.close();}
  }
 });

 test(`${company.code}: retained callbacks cannot open a source after owner switch, owner A/B/A, unmount or failed critical refresh`,async()=>{
  for(const change of ['owner','owner-back','unmount','failed-refresh']){
   const h=dashboard(company);try{
    await h.settle();const retained=h.component('registration-board').onPrepareSource;
    if(change.startsWith('owner')){h.switchOwner('owner-b',companies.find(value=>value.code!==company.code));await h.settle();if(change==='owner-back'){h.switchOwner('owner-a',company);await h.settle();}}
    if(change==='unmount')h.close();
    if(change==='failed-refresh'){h.setMode('settings');h.button('다시 불러오기').props.onClick();await h.settle();}
    const before=JSON.stringify({rows:h.draft.rows,products:h.products}),reads=h.requests.length;retained(h.saved);await h.settle();assert.equal(h.component('intake-queue-panel'),undefined,change);assert.equal(h.requests.length,reads,change);assert.equal(JSON.stringify({rows:h.draft.rows,products:h.products}),before,change);assert.equal(h.lateWrites,0,change);
   }finally{h.close();}
  }
 });

 test(`${company.code}: actual malformed legacy job GET cannot prevent independent new POST; company/settings/category guards remain authoritative`,async()=>{
  const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,sourceFetcher:()=>assert.fail('No source URL may be fetched')});try{
   await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(h.settings));const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',h.context.category);
   h.sqlite.prepare("UPDATE collection_context SET payload='malformed legacy context' WHERE job_id='job'").run();const protectedBefore=h.sqlite.prepare("SELECT payload FROM collection_context WHERE job_id='job'").get().payload;
   const api=h.load('app/api/collection-jobs/route.ts');assert.equal((await api.GET()).status,503,'the actual list decoder rejects the corrupt prior context');
   assert.equal((await h.load('app/api/products/route.ts').GET()).status,200);assert.equal((await h.load('app/api/settings/route.ts').GET()).status,200);assert.equal((await h.load('app/api/category-profiles/route.ts').GET()).status,200);
   const body={urls:['https://detail.1688.com/offer/771000000001.html'],goal:'work',profileId:profile.id,expectedProfileRevision:profile.revision,features:'',keywords:'',expectedSettings:h.settings};
   const post=input=>api.POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));
   const response=await post(body);assert.equal(response.status,200,await response.clone().text());const created=await response.json();assert.equal(created.jobs.length,1);assert.equal(created.jobs[0].context.company.code,company.code);assert.equal(created.jobs[0].context.category.id,profile.id);assert.equal(created.jobs[0].product_id,null);
   assert.equal((await api.GET(new Request('https://app.test/api/collection-jobs?id='+created.jobs[0].id))).status,200);
   assert.equal((await post({...body,expectedProfileRevision:profile.revision+1})).status,409);assert.equal((await post({...body,expectedSettings:{...h.settings,brand:'변경된 설정'}})).status,409);
   assert.equal(h.sqlite.prepare("SELECT payload FROM collection_context WHERE job_id='job'").get().payload,protectedBefore);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM products').get().n,0);assert.equal(h.objects.size,0);assert.equal(h.network.length,0);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM supplier_hub_receipts').get().n,0);
  }finally{h.close();}
 });
}
