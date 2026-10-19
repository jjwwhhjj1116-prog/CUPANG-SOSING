import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {providedOptionModule} from './provided-option-quotation.mjs';
import * as rejectionDetails from '../../extensions/supplier-hub/rejection-details.mjs';
const native=createRequire(import.meta.url);
export const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
export function quotationAiUI(props,fetcher,component='app/components/quotation-ai-panel.tsx',exportName='QuotationAiPanel'){
  const slots=[],effects=[],modules=new Map(),calls=[];let cursor=0,current=props,mountedKey=null;
  const hook=(effect,deps,layout)=>{const i=cursor++,old=slots[i];if(!old||!deps||deps.some((d,j)=>!Object.is(d,old.deps[j]))){old?.cleanup?.();slots[i]={deps,cleanup:null};const run=()=>{slots[i].cleanup=effect();};if(layout)run();else effects.push(run);}};
  const hooks={useCallback(callback,deps){const i=cursor++,old=slots[i];if(!old||deps.some((value,index)=>!Object.is(value,old.deps[index])))slots[i]={callback,deps};return slots[i].callback;},useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect:(e,d)=>hook(e,d,false),useLayoutEffect:(e,d)=>hook(e,d,true)};
  const load=file=>{if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
      {exports,Error,Date,TextEncoder,AbortController,structuredClone,queueMicrotask,crypto:webcrypto,fetch:async(url,init)=>{calls.push({url,method:init?.method??'GET',body:init?.body?JSON.parse(init.body):undefined});return fetcher(url,init);},require:name=>name==='../../extensions/supplier-hub/rejection-details.mjs'?rejectionDetails:name==='react'?hooks:name==='@/app/components/supplier-hub-product-transport'?{SupplierHubProductTransport:()=>null}:name.startsWith('@/app/components/')?load(name.slice(2)+'.tsx'):name.startsWith('@/')?providedOptionModule(name.slice(2)+'.ts'):native(name)});return exports;};
  const render=(next=current)=>{current=next;cursor=0;let tree=load(component)[exportName](current);if(typeof tree.type==='function'){if(mountedKey!==null&&mountedKey!==tree.key){slots.forEach(slot=>slot?.cleanup?.());slots.length=0;effects.length=0;}mountedKey=tree.key;cursor=0;tree=tree.type(tree.props);}return tree;};
  const flush=()=>{render();effects.splice(0).forEach(run=>run());};
  const button=label=>nodes(render()).find(node=>node.type==='button'&&node.props.children===label);
  async function idle(){flush();await Promise.resolve();const deadline=Date.now()+5000;while(render().props['aria-busy']){if(Date.now()>deadline)throw Error('UI timeout');await new Promise(r=>setTimeout(r,1));}}
  return {calls,render,flush,idle,button,async click(label){const b=button(label);if(!b||b.props.disabled)throw Error('Unavailable '+label);b.props.onClick();await idle();},checkbox(index=0){return nodes(render()).filter(node=>node.type==='input'&&node.props.type==='checkbox')[index];},unmount(){slots.forEach(slot=>slot?.cleanup?.());},alerts:()=>nodes(render()).filter(node=>node.props?.role==='alert').map(node=>node.props.children)};
}
