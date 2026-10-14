import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';

const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];

/** Actual picker, observed catalog and paginated reader. No real browser or Hub is used. */
export function categoryPickerUI(request,{catalog,profiles=[],selectedId='',workspaceOwnerId,connectExcel=false}={}){
 const slots=[],modules=new Map(),selected=[],calls=[],effects=[];let cursor=0,changed=true,props={profiles,selectedId,workspaceOwnerId};
 const fetcher=async(path,init)=>{calls.push({path,method:init?.method??'GET'});return request(path,init);};
 const hooks={useMemo:fn=>fn(),useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>{const next=typeof value==='function'?value(slots[index]):value;if(!Object.is(next,slots[index])){slots[index]=next;changed=true;}}];},
  useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useEffect(effect,deps){const index=cursor++,previous=slots[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps?.[i]))){slots[index]={deps,effect,cleanup:previous?.cleanup};effects.push(()=>{previous?.cleanup?.();slots[index].cleanup=effect();});}}};
 hooks.useLayoutEffect=hooks.useEffect;
 function load(file){
  if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,
   {exports,Error,crypto,AbortController,TextEncoder,TextDecoder,structuredClone,fetch:fetcher,require(name){
    if(name==='react')return hooks;if(name.endsWith('.css'))return {};
    if(name==='@/app/supplier-hub-catalog'&&catalog)return catalog;
    if(name.startsWith('../docs/')&&name.endsWith('.json'))return JSON.parse(fs.readFileSync(new URL('../../docs/'+name.slice(8),import.meta.url),'utf8'));
    if(name.startsWith('@/')){const stem=name.slice(2);return load(stem+(fs.existsSync(new URL('../../'+stem+'.ts',import.meta.url))?'.ts':'.tsx'));}
    return native(name);
   }});return exports;
 }
 const Component=load('app/components/category-picker.tsx').CategoryPicker;
 const render=()=>{let tree,turns=0;do{changed=false;cursor=0;tree=Component({...props,onSelected:profile=>selected.push(profile),onAdvanced(){}});while(effects.length)effects.shift()();if(++turns>20)throw Error('Category fixture render loop');}while(changed);return tree;};
 const close=()=>{for(const slot of slots)slot?.cleanup?.();};
 const settle=async()=>{const deadline=Date.now()+5000;while(nodes(render()).some(node=>node.props?.className==='category-picker'&&node.props['aria-busy'])){
  if(Date.now()>deadline)throw Error('Category lookup timeout');await new Promise(resolve=>setTimeout(resolve,1));
 }};
 const chooseConnection=enabled=>{const control=nodes(render()).find(node=>node.type==='input'&&node.props['aria-label']==='상품 추가 전에 공식 Excel 양식도 연결');if(!control)throw Error('Category Excel choice unavailable');control.props.onChange({target:{checked:enabled}});render();};
 if(connectExcel)chooseConnection(true);
 return {render,selected,calls,close,chooseConnection,replayEffects(){for(const slot of slots)if(slot?.effect){slot.cleanup?.();slot.cleanup=slot.effect();}return render();},reopen(){close();slots.length=0;if(connectExcel)chooseConnection(true);},setProps(patch){props={...props,...patch};render();},alerts:()=>nodes(render()).filter(node=>node.props?.role==='alert').map(node=>node.props.children),async confirm(){nodes(render()).find(node=>node.type==='button'&&node.props.children==='선택 완료 · URL 입력').props.onClick();await settle();},async chooseLive(choice){
  nodes(render()).find(node=>node.type?.name==='SupplierHubCategoryBrowser').props.onChoice(choice);
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
