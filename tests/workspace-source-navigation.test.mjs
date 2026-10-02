import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settle=async()=>{for(let index=0;index<12;index++)await new Promise(resolve=>setImmediate(resolve));};
function harness(){
 const instances=new Map(),effects=[],cache=new Map();let active;
 const hooks={useState(initial){const index=active.index++,instance=active;if(!(index in instance.slots))instance.slots[index]=typeof initial==='function'?initial():initial;return[instance.slots[index],value=>instance.slots[index]=typeof value==='function'?value(instance.slots[index]):value];},useRef(initial){const index=active.index++;return active.slots[index]??(active.slots[index]={current:initial});},useMemo:fn=>fn(),useCallback:fn=>fn,useEffect(fn){if(active.first)effects.push(fn);}};
 const implemented=new Set(['dashboard-client','price-editor','product-options-editor']);
 let body;
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  const source=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8')+(file.endsWith('dashboard-client.tsx')?'\nexport {DetailPanel};':'');
  vm.runInNewContext(ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,TextEncoder,crypto,fetch:async()=>Response.json(body),require(name){
   if(name==='react')return hooks;
   if(name.startsWith('@/app/components/')&&!implemented.has(name.split('/').at(-1)))return new Proxy({},{get:()=>()=>null});
   return name.startsWith('@/')?load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts')):native(name);
  }});return exports;
 }
 const options=load('app/product-options.ts'),settings=load('app/workspace-settings.ts').defaultSettings;
 const policy={exchangeRate:200,supplyMargin:50,coupangMargin:40,minimumMargin:0,msrpMultiple:1.3,roundingUnit:10};
 body={options:{...options.emptyProductOptions('p'),revision:1,rows:[{...options.emptyOptionInput('a'),originalName:'원문',unitCostCny:2,included:true,updatedAt:'before',provenance:{}}]},productVersion:'2026-10-03T00:00:00Z',pricing:{policy,policySource:'saved-product',rows:[]}};
 const product={id:'p',title:'상품',source_price_cny:2,image_keys:'["owner/a.png"]',pricing_policy:JSON.stringify(policy),updated_at:body.productVersion};
 const Detail=load('app/components/dashboard-client.tsx').DetailPanel,read=load('app/workspace-close.ts').quotationSourceState;
 function expand(tree){
  if(Array.isArray(tree))return tree.map(expand);if(!tree||typeof tree!=='object')return tree;
  if(typeof tree.type==='function'){
   const instance=instances.get(tree.type)??{slots:[],first:true};instances.set(tree.type,instance);instance.index=0;active=instance;
   const child=tree.type(tree.props);instance.first=false;return expand(child);
  }
  return {...tree,props:{...tree.props,children:expand(tree.props?.children)}};
 }
 const render=tab=>{const result=expand({type:Detail,props:{tab,product,settings,onUpload(){},onSaved(){},onManageCategories(){},onSavePrice:async()=>{}}});effects.splice(0).forEach(effect=>effect());return result;};
 const matches=(node,selector)=>{const [,key,value]=selector.match(/^\[([^=\]]+)(?:="([^"]+)")?\]$/);return value===undefined?node.props?.[key]!==undefined:String(node.props?.[key])===value;};
 const element=node=>({getAttribute:key=>node.props?.[key]===undefined?null:String(node.props[key]),querySelector:selector=>nodes(node.props?.children).find(child=>matches(child,selector))??null});
 const pending=tab=>{const tree=render(tab);return Array.from(read({querySelector:selector=>nodes(tree).find(node=>matches(node,selector))??null,querySelectorAll:selector=>nodes(tree).filter(node=>matches(node,selector)).map(element)}).steps);};
 return {render,pending,async start(){render('가격');await settle();},input(label,tab='가격'){return nodes(render(tab)).find(node=>node.props?.['aria-label']===label);}};
}

test('quotation entry routes a retained price policy to price saving after visiting image stage',async()=>{
 const h=harness();await h.start();
 const exchange=nodes(h.render('가격')).find(node=>node.type==='label'&&node.props.children?.[0]?.props?.children==='환율 (원/CNY)').props.children[1];
 exchange.props.onChange({target:{value:'275'}});
 assert.deepEqual(h.pending('대표 이미지'),['가격']);
 assert.deepEqual(h.pending('상세 이미지'),['가격']);
});

test('quotation entry distinguishes option metadata drafts from image-only drafts across stages',async()=>{
 const h=harness();await h.start();
 h.input('옵션 1 옵션명 원문','옵션').props.onChange({target:{value:'수정 옵션명'}});
 assert.deepEqual(h.pending('대표 이미지'),['가격']);
 h.input('옵션 1 옵션명 원문','옵션').props.onChange({target:{value:'원문'}});
 h.input('옵션 1 이미지','옵션').props.onChange({target:{value:'owner/a.png'}});
 assert.deepEqual(h.pending('가격'),['대표 이미지']);
 h.input('옵션 1 옵션명 원문','옵션').props.onChange({target:{value:''}});
 assert.deepEqual(h.pending('대표 이미지'),['가격','대표 이미지']);
 assert.equal(h.input('옵션 1 옵션명 원문','옵션').props.value,'');
});
