import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {optionPriceTableUI} from './helpers/option-price-table-ui.mjs';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settle=async()=>{for(let index=0;index<12;index++)await new Promise(resolve=>setImmediate(resolve));};
async function harness(){
 const api=await optionPriceTableUI(undefined,{count:1,integrated:true});
 const product={...api.product,image_keys:JSON.stringify([api.product.owner_id+'/a.png'])},imageKey=JSON.parse(product.image_keys)[0];
 const stored=api.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(product.id),options=JSON.parse(stored.payload);
 options.rows[0].originalName='원문';options.rows[0].translatedName='';options.rows[0].unitCostCny=2;
 api.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options),product.id);
 api.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(product.image_keys,product.id);
 const instances=new Map(),effects=[],layouts=[],cache=new Map(),savedPolicies=[],writes=[],calls=[];let active;
 const sameDeps=(previous,next)=>Array.isArray(previous)&&Array.isArray(next)&&previous.length===next.length&&next.every((value,index)=>Object.is(value,previous[index]));
 const hooks={useState(initial){const index=active.index++,instance=active;if(!(index in instance.slots))instance.slots[index]=typeof initial==='function'?initial():initial;return[instance.slots[index],value=>instance.slots[index]=typeof value==='function'?value(instance.slots[index]):value];},useRef(initial){const index=active.index++;return active.slots[index]??(active.slots[index]={current:initial});},
  // Scope tokens must have React's dependency-stable identity. Recreating a
  // useMemo token on every render incorrectly makes live callbacks stale.
  useMemo(fn,deps){const index=active.index++,previous=active.slots[index];if(!previous||!sameDeps(previous.deps,deps))active.slots[index]={deps,value:fn()};return active.slots[index].value;},
  useCallback(fn,deps){return hooks.useMemo(()=>fn,deps);},useEffect(fn,deps){schedule(effects,fn,deps);},useLayoutEffect(fn,deps){schedule(layouts,fn,deps);}};
 function schedule(queue,fn,deps){const instance=active,index=instance.index++,previous=instance.slots[index];if(!previous||!sameDeps(previous.deps,deps)){const next={deps,cleanup:previous?.cleanup};instance.slots[index]=next;queue.push(()=>{next.cleanup?.();next.cleanup=fn();});}}
 const implemented=new Set(['dashboard-client','product-options-editor','stage-two-price-policy-fields','option-quotation-prices','option-price-table','use-registration-layout']);
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  const source=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8')+(file.endsWith('dashboard-client.tsx')?'\nexport {DetailPanel};':'');
  vm.runInNewContext(ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,TextEncoder,crypto,fetch:async(url,init={})=>{calls.push({url,method:init.method??'GET'});if((init.method??'GET')!=='GET'){writes.push({url,init});throw Error('Navigation-only fixture forbids writes');}return api.request(url,init);},require(name){
   if(name==='react')return hooks;
   if(name==='react/jsx-runtime')return{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
   if(name.endsWith('.css'))return{};
   if(name.startsWith('@/app/components/')&&!implemented.has(name.split('/').at(-1)))return new Proxy({},{get:()=>()=>null});
   return name.startsWith('@/')?load(name.slice(2)+(name.includes('/components/')&&fs.existsSync(new URL('../'+name.slice(2)+'.tsx',import.meta.url))?'.tsx':'.ts')):native(name);
  }});return exports;
 }
 const settings=load('app/workspace-settings.ts').defaultSettings,policy=api.policy;
 const Detail=load('app/components/dashboard-client.tsx').DetailPanel,read=load('app/workspace-close.ts').quotationSourceState;
 function expand(tree,path='root'){
  if(Array.isArray(tree))return tree.map((child,index)=>expand(child,path+'/'+(child?.key??index)));if(!tree||typeof tree!=='object')return tree;
  if(typeof tree.type==='function'){
   const identity=path+':'+(tree.type.name||'component')+':'+(tree.key??'');
   const instance=instances.get(identity)??{slots:[]};instances.set(identity,instance);instance.index=0;active=instance;
   const child=tree.type(tree.props);return expand(child,path+'/component');
  }
  return {...tree,props:{...tree.props,children:expand(tree.props?.children,path+'/children')}};
 }
 const render=tab=>{const result=expand({type:Detail,props:{tab,product,workspaceOwnerId:product.owner_id,settings,onUpload(){},onSaved(){},onManageCategories(){},onSavePrice:async policy=>{savedPolicies.push(policy);}}});layouts.splice(0).forEach(effect=>effect());effects.splice(0).forEach(effect=>effect());return result;};
 const matches=(node,selector)=>{const [,key,value]=selector.match(/^\[([^=\]]+)(?:="([^"]+)")?\]$/);return value===undefined?node.props?.[key]!==undefined:String(node.props?.[key])===value;};
 const element=node=>({getAttribute:key=>node.props?.[key]===undefined?null:String(node.props[key]),querySelector:selector=>nodes(node.props?.children).find(child=>matches(child,selector))??null});
 const pending=tab=>{const tree=render(tab);return Array.from(read({querySelector:selector=>nodes(tree).find(node=>matches(node,selector))??null,querySelectorAll:selector=>nodes(tree).filter(node=>matches(node,selector)).map(element)}).steps);};
 const input=(label,tab='가격')=>{const node=nodes(render(tab)).find(node=>node.props?.['aria-label']===label);assert.ok(node,'Missing actual input '+label);return node;};
 return {render,pending,savedPolicies,writes,calls,policy,imageKey,policyInput:(tab='가격')=>input('적용 환율 (CNY → KRW)',tab),async start(){for(let index=0;index<6;index++){render('가격');await settle();}assert.ok(calls.some(call=>call.url.endsWith('/quotation-fields')),'Actual price controller must read its quotation base');assert.equal(input('적용 환율 (CNY → KRW)').props.value,policy.exchangeRate);},input,
  close(){for(const instance of instances.values())for(const slot of instance.slots)slot?.cleanup?.();api.close();}};
}

test('quotation entry routes a retained price policy to price saving after visiting image stage',async t=>{
 const h=await harness();t.after(()=>h.close());await h.start();
 const exchange=h.policyInput();assert.equal(exchange.props.value,h.policy.exchangeRate);
 exchange.props.onChange({target:{value:'275'}});
 assert.equal(h.policyInput().props.value,275);
 assert.deepEqual(h.pending('대표 이미지'),['가격']);
 assert.equal(h.policyInput('대표 이미지').props.value,275);
 assert.deepEqual(h.pending('상세 이미지'),['가격']);
 assert.equal(h.policyInput('상세 이미지').props.value,275);
 assert.equal(h.savedPolicies.length,0);assert.equal(h.writes.length,0);
});

test('quotation entry distinguishes option metadata drafts from image-only drafts across stages',async t=>{
 const h=await harness();t.after(()=>h.close());await h.start();
 h.input('옵션 1 옵션명 원문','옵션').props.onChange({target:{value:'수정 옵션명'}});
 assert.deepEqual(h.pending('대표 이미지'),['가격']);
 h.input('옵션 1 옵션명 원문','옵션').props.onChange({target:{value:'원문'}});
 h.input('옵션 1 이미지','옵션').props.onChange({target:{value:h.imageKey}});
 assert.deepEqual(h.pending('가격'),['대표 이미지']);
 h.input('옵션 1 옵션명 원문','옵션').props.onChange({target:{value:''}});
 assert.deepEqual(h.pending('대표 이미지'),['가격','대표 이미지']);
 assert.equal(h.input('옵션 1 옵션명 원문','옵션').props.value,'');
 assert.equal(h.savedPolicies.length,0);assert.equal(h.writes.length,0);
});
