import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];

// Chrome's Window.fetch rejects an arbitrary object receiver. Arrow-only test
// fetchers hid the production failure when called as options.fetcher(...).
function windowFetch(route){
 return function(input,init){
  if(this!==undefined)throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
  return route(input,init);
 };
}

async function queue(h,interrupted){
 const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',h.context.category);
 h.context.category=profile;
 await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(h.settings));
 h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
 h.sqlite.prepare("UPDATE collection_jobs SET goal='work' WHERE id='job'").run();
 let rows=[{id:'pending-row',profile,url:h.sourceUrl,features:h.context.features,keywords:h.context.keywords,status:'draft',message:''}];
 const slots=[],busy=[],opened=[],calls=[],published=[];let cursor=0,finish,resolve,fail=interrupted;
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(){}};
 const fetcher=windowFetch(async(path,init)=>{
  calls.push(path);
  const response=path==='/api/collection-jobs'
   ?await h.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test'+path,init))
   :await h.route(path,{method:init?.method??'GET',body:init?.body});
  if(path.endsWith('/image-draft')&&fail){fail=false;assert.equal(response.status,200,await response.clone().text());throw Error('image draft acknowledgement lost');}
  return response;
 });
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/intake-queue-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,URL,AbortController,crypto,fetch:fetcher,require(name){
  if(name==='react')return hooks;
  if(name==='@/app/components/category-picker')return{CategoryPicker:()=>null};
  if(name==='@/app/components/intake-quotation-preview')return{IntakeQuotationPreview:()=>null};
  if(name==='@/app/browser-product-bridge')return{capture1688FromChrome:()=>assert.fail('recorded public source needs no browser')};
  return name.startsWith('@/')?h.load(name.slice(2)+'.ts'):native(name);
 }});
 const render=()=>{cursor=0;return exports.IntakeQueuePanel({rows,settings:h.settings,profiles:[profile],jobs:published,goal:'work',onRows:update=>{rows=update(rows);},onGoal(){},onProfile(){},onAdvanced(){},onJobs:jobs=>published.push(...jobs),onBusy:value=>{busy.push(value);if(!value)resolve();},onSettingsReloaded(){assert.fail('unchanged settings');},onOpenProduct:async id=>opened.push(id)});};
 return{calls,opened,busy,published,get row(){return rows[0];},async start(){finish=new Promise(done=>{resolve=done;});const click=nodes(render()).find(node=>node.type==='button'&&String(node.props.children).includes('시작 (')).props.onClick;click();click();await finish;}};
}

for(const interrupted of [false,true])test(`browser fetch receiver supports recorded URL draft and preserved retry (interrupted=${interrupted})`,async()=>{
 const h=mobileIntakeHarness();
 try{
  const ui=await queue(h,interrupted);await ui.start();
  assert.equal(ui.row.status,interrupted?'error':'saved',ui.row.message);
  assert.ok(ui.row.productId,ui.row.message);
  assert.equal(ui.row.id,'pending-row');assert.equal(ui.row.url,h.sourceUrl);
  const productId=ui.row.productId;
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_jobs').get().n,1);
  assert.equal(h.objects.size,19);assert.equal(h.aiSources.length,1);
  assert.equal(JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload).rows.length,6);
  if(interrupted){
   assert.match(ui.row.message,/image draft acknowledgement lost/);assert.deepEqual(ui.opened,[]);
   const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
   const saved=await h.route(`/api/products/${productId}/content`,{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'검토한 상품명',keywords:[]},assets:{main:[]}}}});
   assert.equal(saved.status,200,await saved.clone().text());
   await ui.start();assert.equal(ui.row.status,'saved',ui.row.message);assert.equal(ui.row.productId,productId);
   const after=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
   assert.equal(after.seo.title.value,'검토한 상품명');assert.deepEqual(after.seo.keywords.value,[]);assert.deepEqual(after.assets.main.value,[]);
   assert.equal(h.aiSources.length,1);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);
  }
  assert.deepEqual(ui.opened,[productId]);
  assert.equal(ui.calls.filter(path=>path==='/api/collection-jobs').length,interrupted?2:1);
  assert.ok(ui.calls.some(path=>path.endsWith('/collect')));assert.ok(ui.calls.some(path=>path.endsWith('/images-batch')));assert.ok(ui.calls.some(path=>path.endsWith('/translation')));assert.ok(ui.calls.some(path=>path.endsWith('/image-draft')));
  assert.ok(ui.published.every(job=>job.id==='job'));
 }finally{h.close();}
});

test('idempotent collection retries call native-shaped fetch without a dependency object receiver',async()=>{
 const h=mobileIntakeHarness();
 try{
  let calls=0;const waits=[],attempts=[];
  const response=await h.load('app/collection-retry.ts').collectionRequestWithRetry('/api/collection-jobs/job/result',{method:'GET'},{fetcher:windowFetch(async()=>{calls++;return calls===1?new Response('',{status:503,headers:{'retry-after':'0'}}):Response.json({received:true});}),attempts:2,wait:async ms=>waits.push(ms),onRetry:attempt=>attempts.push(attempt)});
  assert.equal(response.status,200);assert.equal(calls,2);assert.deepEqual(waits,[0]);assert.deepEqual(attempts,[2]);
 }finally{h.close();}
});
