import {collectionNewDraftFixture,forkCompanies} from './collection-new-draft.mjs';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

export {forkCompanies};
export const plain=value=>JSON.parse(JSON.stringify(value));
export const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
export async function collectionSingleNewDraftFixture(company=forkCompanies[0]){
 const f=await collectionNewDraftFixture(company),snapshot=structuredClone(f.snapshot),raw=JSON.parse(snapshot.schemaString);
 raw.metadata='scope:Retail_Categorized_Single;categoryId:3000;productNoticeCategoryId:17;version:73';snapshot.schemaString=JSON.stringify(raw);
 const target=await f.api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 Single만 연결된 새 초안',categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,hubSchema:snapshot,template:null,mappings:[]});
 const input={...f.input,profileId:target.id,expectedProfileRevision:target.revision};
 return {...f,excelTarget:f.target,target,input,snapshot,preview:(value=input)=>f.preview(value),create:(preview,value=input,requestId=crypto.randomUUID())=>f.create(preview,value,requestId)};
}
export const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
export const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);

/** Actual queue callbacks and actual local handlers. Hooks/category display are
 * adapters; no seller fetch, operating browser, or transmission is available. */
export function singleNewDraftQueue(f,{pending=false,collect=true}={}){
 const native=createRequire(import.meta.url),modules=new Map(),slots=[],effects=[],layouts=[],calls=[],opened=[],collections=[];
 let cursor=0,owner='owner',jobs=[],rows=[{id:'single-row',profile:f.target,url:f.sourceUrl,features:f.input.features,keywords:f.input.keywords,status:'draft',message:''}];
 const request=async(url,init={})=>{calls.push({url:String(url),method:init.method??'GET'});
  if(String(url)==='/api/settings')return f.api.load('app/api/settings/route.ts').GET();
  if(String(url).split('?')[0]==='/api/collection-jobs')return f.api.load('app/api/collection-jobs/route.ts')[init.method??'GET'](new Request('https://app.test'+url,init));
  if(String(url).startsWith('/api/supplier-hub/catalog-context'))return f.api.load('app/api/supplier-hub/catalog-context/route.ts').GET();
  return f.request(url,init);
 };
 const effect=(queue,fn,deps)=>{const index=cursor++,before=slots[index];if(!before||!deps||deps.some((item,i)=>!Object.is(item,before.deps[i]))){const next={deps,cleanup:before?.cleanup};slots[index]=next;queue.push(()=>{before?.cleanup?.();next.cleanup=fn();});}};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,value=>slots[i].value=typeof value==='function'?value(slots[i].value):value];},useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value});},useEffect(fn,deps){effect(effects,fn,deps);},useLayoutEffect(fn,deps){effect(layouts,fn,deps);}};
 function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,Error,URL,URLSearchParams,Date,TextEncoder,TextDecoder,Uint8Array,structuredClone,AbortController,AbortSignal,crypto,setTimeout,clearTimeout,fetch:request,
  require(name){if(name==='react')return hooks;if(name==='@/app/components/category-picker')return{CategoryPicker:()=>null};if(name==='@/app/components/intake-quotation-preview')return{IntakeQuotationPreview:()=>null};if(name==='@/app/browser-product-bridge')return{capture1688FromChrome:()=>assert.fail('Synthetic stored source must not call Chrome')};
   if(name==='@/app/intake-collection'){const actual=f.api.load('app/intake-collection.ts');return{collectIntakeProduct:async(job,options)=>{collections.push(job);if(!collect){options.onJob(job);return'합성 검토용 초안';}return actual.collectIntakeProduct(job,options);}};}
   if(name.startsWith('@/'))return load(name.slice(2)+'.ts');if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');return native(name);}
 });return exports;}
 const Component=load('app/components/intake-queue-panel.tsx').IntakeQueuePanel;
 if(pending)rows=[{...rows[0],status:'error',message:'원래 요청 보존',pendingJobId:f.oldJobId}];
 const render=()=>{cursor=0;const tree=Component({rows,onRows:update=>rows=update(rows),profiles:[f.target],onProfile(){},onAdvanced(){},onJobs:values=>jobs=[...values,...jobs.filter(job=>!values.some(value=>value.id===job.id))],onBusy(){},goal:'work',onGoal(){},settings:f.settings,workspaceOwnerId:owner,onSettingsReloaded(){},jobs,onOpenProduct:async id=>opened.push(id)});layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node).includes(label));
 const idle=async()=>{for(let n=0;n<50;n++){render();await new Promise(resolve=>setImmediate(resolve));}};
 const settle=async predicate=>{const deadline=Date.now()+12000;do{await idle();if(Date.now()>deadline)throw Error('Single new-draft UI timed out: '+text(render()));}while(!predicate());};
 render();return{calls,opened,collections,render,button,load,get rows(){return rows;},async click(label){const selected=button(label);assert.ok(selected&&!selected.props.disabled,label);selected.props.onClick();await idle();},idle,settle,setOwner(value){owner=value;render();},edit(patch){rows=rows.map(row=>({...row,...patch}));render();},close(){slots.forEach(slot=>slot?.cleanup?.());}};
}
