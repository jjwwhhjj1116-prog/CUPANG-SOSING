import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';

const native=createRequire(import.meta.url);
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
export const titleNodes=tree=>Array.isArray(tree)?tree.flatMap(titleNodes):tree&&typeof tree==='object'?[tree,...titleNodes(tree.props?.children)]:[];
export const titleText=tree=>Array.isArray(tree)?tree.map(titleText).join(''):tree&&typeof tree==='object'?titleText(tree.props?.children):tree==null?'':String(tree);

export function quotationTitleLoader(overrides={}){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file);
  const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,Error,TextEncoder,URLSearchParams,URL,structuredClone,AbortController,fetch:overrides.fetch??fetch,
    window:{addEventListener(){},removeEventListener(){}},document:{getElementById:()=>null},
    require(name){
     if(name in overrides)return overrides[name];
     if(name.endsWith('.css'))return{};
     if(name.startsWith('@/app/')&&name.endsWith('.mjs'))return native('../../'+name.slice(2));
     if(name.startsWith('@/app/')){const path=name.slice(2);return load(path+(fs.existsSync(new URL('../../'+path+'.ts',import.meta.url))?'.ts':'.tsx'));}
     if(name.startsWith('.')&&name.endsWith('.mjs'))return createRequire(new URL('../../'+file,import.meta.url))(name);
     return native(name);
    }});
  return exports;
 }
 return load;
}

/** Run the real quotation form and its event handlers with persistent React
 * hooks. Child tools stay mounted as boundaries; network requests are captured. */
export function quotationTitleUI({view,request,props={}}){
 const slots=[],effects=[],calls=[];let cursor=0,tree,currentProps={productId:'p1',refreshToken:'v1',...props},renderNeeded=true;
 const hooks={
  useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;renderNeeded=true;}];},
  useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},
  useCallback(fn,deps){const index=cursor++,previous=slots[index];if(!previous||!same(previous.deps,deps))slots[index]={deps,value:fn};return slots[index].value;},
  useId(){const index=cursor++;return slots[index]??(slots[index]='seo-title-test');},
  useEffect(fn,deps){const index=cursor++,previous=slots[index];if(!previous||!same(previous.deps,deps)){slots[index]={deps,cleanup:previous?.cleanup};effects.push(()=>{previous?.cleanup?.();slots[index].cleanup=fn();});}},
 };
 const load=quotationTitleLoader({react:hooks,fetch:async(url,init)=>{calls.push({url,init});return request?request(url,init):Response.json(view);}});
 const Form=load('app/components/quotation-fields-editor.tsx').QuotationFieldsEditor;
 function render(updates){if(updates)currentProps={...currentProps,...updates};cursor=0;renderNeeded=false;const wrapper=Form(currentProps);tree=wrapper.type(wrapper.props);effects.splice(0).forEach(fn=>fn());return tree;}
 async function idle(){for(let i=0;i<12;i++){if(renderNeeded)render();await new Promise(resolve=>setImmediate(resolve));}if(renderNeeded)render();}
 render();
 return{load,calls,render,idle,nodes:()=>titleNodes(renderNeeded?render():tree),
  field(id){return this.nodes().find(node=>['input','textarea'].includes(node.type)&&node.props.id==='seo-title-test-'+id);},
  button(label){return this.nodes().find(node=>node.type==='button'&&titleText(node.props.children).startsWith(label));},
  select(optionId){const value=optionId??'';this.nodes().find(node=>node.type==='select'&&titleNodes(node).some(item=>item.type==='option'&&item.props.value===value)).props.onChange({target:{value}});render();},
  replaceView(value){slots[0]=value;render();},
  get changes(){return slots[1];},
  close(){slots.forEach(slot=>slot?.cleanup?.());},
 };
}
