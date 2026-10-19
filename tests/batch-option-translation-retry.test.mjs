import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const native=createRequire(import.meta.url),fixtureUrl=new URL('./options-translation-retry.test.mjs',import.meta.url);
const source=fs.readFileSync(fixtureUrl,'utf8'),ast=ts.createSourceFile(fixtureUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),limit=source.indexOf('\nfor(const company');
const declarations=ast.statements.filter(node=>node.pos<limit&&(ts.isVariableStatement(node)||ts.isFunctionDeclaration(node))).map(node=>node.getText(ast)).join('\n');
const {fixture,payload}=vm.runInNewContext(declarations+'\n({fixture,payload})',{assert,mobileIntakeHarness,URL,Response,crypto:globalThis.crypto,structuredClone});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function ui(initial,fetcher,retryApi){
 const slots=[],effects=[],storage=new Map(),busy=[],pending=[],uncertain=[],settled=[];let cursor=0,props=initial,mountedKey=null;
 const hook=(fn,deps,layout)=>{const index=cursor++,old=slots[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps?.[i]))){old?.cleanup?.();slots[index]={deps};const run=()=>{slots[index].cleanup=fn();};if(layout)run();else effects.push(run);}};
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>slots[index]=typeof value==='function'?value(slots[index]):value];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useLayoutEffect:(fn,deps)=>hook(fn,deps,true),useEffect:(fn,deps)=>hook(fn,deps,false),useCallback(fn,deps){const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))slots[index]={fn,deps};return slots[index].fn;}};
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/batch-option-translation-retry.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,Error,AbortController,JSON,Promise,setTimeout,clearTimeout,fetch:fetcher,sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},require(name){if(name==='react')return hooks;if(name==='@/app/options-translation-retry')return retryApi;return native(name);}});
 function render(next={}){props={...props,...next};cursor=0;const outer=exports.BatchOptionTranslationRetry({...props,onBusyChange:value=>busy.push(value),onPendingChange:value=>pending.push(value),onUncertainChange:value=>uncertain.push(value),onSettled:(...args)=>settled.push(args)});
  if(mountedKey!==null&&outer.key!==mountedKey){slots.forEach(slot=>slot?.cleanup?.());slots.length=0;effects.length=0;}mountedKey=outer.key;cursor=0;const tree=outer.type(outer.props);effects.splice(0).forEach(run=>run());return tree;}
 async function idle(){for(let i=0;i<10;i++){render();await turn();}const deadline=Date.now()+5000;while(render().props['aria-busy']){if(Date.now()>deadline)throw Error('Option UI did not settle');await turn();}return render();}
 return{render,idle,storage,busy,pending,uncertain,settled,button(){return nodes(render()).find(node=>node.type==='button');},async click(){const button=this.button();assert.equal(button.props.disabled,false);button.props.onClick();return idle();},close(){slots.forEach(slot=>slot?.cleanup?.());}};
}
const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
async function context(f){
 const api=f.h.load('app/batch-seo-work.ts'),fetcher=(url,init)=>url==='/api/supplier-hub/catalog-context'?f.h.load('app/api/supplier-hub/catalog-context/route.ts').GET():f.fetcher(url,init);
 const products=[{id:f.productId,title:'저장된 완성 SEO'}],plan=await api.planBatchSeoWork(products,new AbortController().signal,fetcher),task=plan.tasks[0];
 assert.deepEqual(Array.from(task.seoMissingFields),[]);assert.ok(task.pendingOptionAttributes>0);
 return{api,fetcher,plan,task,props:{plan,task,beforeRetry:signal=>api.refreshBatchSeoWorkTask(task,plan,signal,fetcher)}};
}
const fields=row=>({name:row.translatedName,color:row.color,size:row.size,cost:row.unitCostCny,provenance:row.provenance,included:row.included});
for(const company of companies)test(`explicit option-only batch preserves completed SEO, manual blanks, excluded rows and prices (${company.companyCode})`,async()=>{
 const f=await fixture(company);let h;try{
  if(company.companyCode==='A01526306'){const content=payload(f.h,'product_content');content.seo.title={...content.seo.title,provenance:'generated'};f.h.sqlite.prepare('UPDATE product_content SET payload=?').run(JSON.stringify(content));}
  const c=await context(f),before=payload(f.h,'product_content'),options=payload(f.h,'product_options'),immutable=f.immutable();
  h=ui(c.props,c.fetcher,f.h.load('app/options-translation-retry.ts'));await h.idle();assert.equal(f.executePosts,0);assert.equal(f.queries.length,0);assert.equal(h.settled.length,0);
  await h.click();assert.equal(f.executePosts,1);assert.equal(h.settled.length,1);assert.equal(h.settled[0][0],true);
  const after=payload(f.h,'product_options'),content=payload(f.h,'product_content');assert.deepEqual(content.seo,before.seo);assert.deepEqual(content.label,before.label);
  for(const index of [1,2,3])assert.deepEqual(fields(after.rows[index]),fields(options.rows[index]));
  assert.deepEqual(after.rows.map(row=>row.unitCostCny),options.rows.map(row=>row.unitCostCny));
  assert.ok(after.rows[0].translatedName);assert.equal(after.rows[0].color,'유광 검정');assert.equal(after.rows[0].size,'선글라스');assert.equal(f.immutable(),immutable);
  const progress=await c.api.refreshBatchSeoWorkProgress(c.task,c.plan,new AbortController().signal,c.fetcher,true);assert.equal(progress.task,null);
  const original=payload(f.h,'collection_results');assert.ok(f.queries.every(query=>!query.includes(original.title)&&(!original.description||!query.includes(original.description))));assert.equal(h.storage.size,0);
 }finally{h?.close();f.h.close();}
});

test('more than 50 pending fields stops after one batch and requires another explicit click for the remainder',async()=>{
 const f=await fixture();let h;try{
  const options=payload(f.h,'product_options'),base=options.rows[0];options.rows=[...Array.from({length:24},(_,index)=>({...structuredClone(base),id:'pending-'+index})),...options.rows.slice(1,4)];
  f.h.sqlite.prepare('UPDATE product_options SET payload=?').run(JSON.stringify(options));let c=await context(f);assert.equal(c.task.pendingOptionAttributes,72);
  h=ui(c.props,c.fetcher,f.h.load('app/options-translation-retry.ts'));await h.idle();await h.click();assert.equal(f.executePosts,1);assert.equal(h.settled.length,1);
  const progress=await c.api.refreshBatchSeoWorkProgress(c.task,c.plan,new AbortController().signal,c.fetcher,true);assert.equal(progress.task.pendingOptionAttributes,22);assert.deepEqual(Array.from(progress.task.seoMissingFields),[]);
  await h.idle();assert.equal(f.executePosts,1,'remaining work cannot trigger another request');
  c=await context(f);h.render(c.props);await h.idle();assert.match(text(h.render()),/22/);assert.equal(f.executePosts,1);await h.click();assert.equal(f.executePosts,2);
  const finished=await c.api.refreshBatchSeoWorkProgress(c.task,c.plan,new AbortController().signal,c.fetcher,true);assert.equal(finished.task,null);
 }finally{h?.close();f.h.close();}
});

test('uncertain execute delivery retains the exact request and repeated confirmation never resends execution',async()=>{
 const f=await fixture();let h;try{
  const c=await context(f);let executeAttempts=0;const requests=[];
  const fetcher=async(url,init)=>{const body=init?.body?JSON.parse(init.body):undefined;requests.push({url,body});if(body?.action==='execute'){executeAttempts++;throw Error('Synthetic delivery unknown');}return c.fetcher(url,init);};
  const modes=[];h=ui({...c.props,beforeRetry:async(signal,recovering)=>{modes.push(recovering);return c.props.beforeRetry(signal);}},fetcher,f.h.load('app/options-translation-retry.ts'));await h.idle();await h.click();assert.equal(executeAttempts,1);assert.equal(h.pending.at(-1),true);assert.equal(h.uncertain.at(-1),true);assert.equal(h.settled.length,0);
  const retained=[...h.storage.values()][0],key=JSON.parse(retained).retryKey;await h.click();assert.equal(executeAttempts,1);assert.equal(JSON.parse([...h.storage.values()][0]).retryKey,key);assert.equal(h.settled.length,0);assert.equal(f.queries.length,0);
  assert.equal(requests.filter(item=>item.body?.action==='prepare-options-retry').length,1);assert.equal(requests.filter(item=>item.body?.action==='apply').length,0);
  assert.deepEqual(modes,[false,true]);
 }finally{h?.close();f.h.close();}
});

test('source or owner invalidation during a delayed preflight cannot prepare, execute, save or notify a different task',async()=>{
 const f=await fixture();let h;try{
  const c=await context(f);let release;const gate=new Promise(resolve=>{release=resolve;});
  h=ui({...c.props,beforeRetry:async signal=>{await gate;await c.api.refreshBatchSeoWorkTask(c.task,c.plan,signal,c.fetcher);}},c.fetcher,f.h.load('app/options-translation-retry.ts'));await h.idle();h.button().props.onClick();await turn();
  h.render({...c.props,plan:{...c.plan,ownerId:'another-owner'}});release();await h.idle();assert.equal(f.executePosts,0);assert.equal(f.queries.length,0);assert.equal(h.settled.length,0);assert.equal(h.storage.size,0);
 }finally{h?.close();f.h.close();}
});
