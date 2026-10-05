import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';

const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];

/** Actual picker, observed catalog and paginated reader. No real browser or Hub is used. */
export function categoryPickerUI(request,{catalog}={}){
 const slots=[],modules=new Map(),selected=[],calls=[];let cursor=0;
 const fetcher=async(path,init)=>{calls.push({path,method:init?.method??'GET'});return request(path,init);};
 const hooks={useMemo:fn=>fn(),useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},
  useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useEffect(){}};
 function load(file){
  if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,
   {exports,Error,crypto,AbortController,structuredClone,fetch:fetcher,require(name){
    if(name==='react')return hooks;if(name.endsWith('.css'))return {};
    if(name==='@/app/supplier-hub-catalog'&&catalog)return catalog;
    if(name.startsWith('../docs/')&&name.endsWith('.json'))return JSON.parse(fs.readFileSync(new URL('../../docs/'+name.slice(8),import.meta.url),'utf8'));
    if(name.startsWith('@/')){const stem=name.slice(2);return load(stem+(fs.existsSync(new URL('../../'+stem+'.ts',import.meta.url))?'.ts':'.tsx'));}
    return native(name);
   }});return exports;
 }
 const Component=load('app/components/category-picker.tsx').CategoryPicker;
 const render=()=>{cursor=0;return Component({profiles:[],selectedId:'',onSelected:profile=>selected.push(profile),onAdvanced(){}});};
 const settle=async()=>{const deadline=Date.now()+5000;while(nodes(render()).some(node=>node.props?.className==='category-picker'&&node.props['aria-busy'])){
  if(Date.now()>deadline)throw Error('Category lookup timeout');await new Promise(resolve=>setTimeout(resolve,1));
 }};
 return {render,selected,calls,alerts:()=>nodes(render()).filter(node=>node.props?.role==='alert').map(node=>node.props.children),async chooseLive(choice){
  nodes(render()).find(node=>node.type?.name==='SupplierHubCategoryBrowser').props.onChoice(choice);
  nodes(render()).find(node=>node.type==='button'&&String(node.props.children).includes('URL 입력')).props.onClick();
  await settle();
 },async chooseCode(code){
  nodes(render()).find(node=>node.type==='input'&&node.props.type==='search').props.onChange({target:{value:code}});
  const results=nodes(render()).find(node=>node.props?.className==='category-search-results');
  const button=nodes(results).find(node=>node.type==='button'&&nodes(node).some(child=>child.type==='small'&&child.props.children===code));
  if(!button)throw Error('Observed category unavailable: '+code);button.props.onClick();
  const deadline=Date.now()+5000;while(nodes(render()).find(node=>node.props?.className==='category-search-results')?.props.children[0]?.[0]?.props.disabled){
   if(Date.now()>deadline)throw Error('Category lookup timeout');await new Promise(resolve=>setTimeout(resolve,1));
  }
 }};
}
