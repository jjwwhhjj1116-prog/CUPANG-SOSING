import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
function harness(handle){
 const slots=[],effects=[],cleanups=[],cache=new Map();let index=0,first=true,notices=0,content;
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useCallback:fn=>fn,useEffect(fn){if(first)effects.push(fn);}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,structuredClone,TextEncoder,crypto,fetch:async(url,init)=>handle(url,init,content)??Response.json({content}),require(name){if(name==='react')return hooks;if(name.startsWith('@/'))return load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts'));return native(name);}});return exports;}
 const model=load('app/product-content.ts');content=model.emptyProductContent('p');
 const component=load('app/components/product-content-editor.tsx').ProductContentEditor;
 const render=(section='이미지')=>{index=0;const root=component({product:{id:'p',title:'상품',image_keys:'["owner/a.png"]'},section,onSaved(){notices++;}});const tree=root.type(root.props);first=false;return tree;};
 const button=(name,section)=>nodes(render(section)).find(n=>n.type==='button'&&n.props.children===name);
 return{render,button,model,load,get notices(){return notices;},async start(){render();effects.forEach(fn=>cleanups.push(fn()));await settle();},unmount(){cleanups.forEach(fn=>fn?.());}};
}

test('image save sends once, retains another tab draft and reaches resolved quotation image cells',async()=>{
 let finish,saved;const pending=new Promise(resolve=>{finish=resolve;});const calls=[];
 const h=harness((url,init,content)=>{if(init?.method!=='PATCH')return;calls.push(JSON.parse(init.body));return pending.then(()=>{saved=h.model.applyContentPatch(content,calls[0].patch,'2026-09-24T01:00:00Z');return Response.json({content:saved});});});
 await h.start();nodes(h.render('SEO')).find(n=>n.type==='input'&&n.props.maxLength===500).props.onChange({target:{value:'미저장 SEO'}});
 nodes(h.render()).find(n=>n.props?.['aria-label']==='이미지 1 역할').props.onChange({target:{value:'main'}});
 const click=h.button('이미지 역할·순서 저장').props.onClick;click();click();assert.equal(calls.length,1);finish();await settle();assert.equal(h.notices,1);
 assert.equal(nodes(h.render('SEO')).find(n=>n.type==='input'&&n.props.maxLength===500).props.value,'미저장 SEO');
 const resolved=h.load('app/quotation-schema.ts').resolveQuotationFields({categoryId:'80719',product:{id:'p',title:'상품',image_keys:'["owner/a.png"]',source_price_cny:1,supply_price:1,sale_price:2,msrp:3},content:saved,options:h.load('app/product-options.ts').emptyProductOptions('p'),settings:h.load('app/workspace-settings.ts').defaultSettings});
 assert.equal(resolved.rows[0].fields.mainImage.value,'owner/a.png');assert.equal(calls[0].patch.seo,undefined);
});

test('label fill and save cannot overlap; unmount ignores late fill and write responses',async()=>{
 for(const operation of ['fill','save']){
  let finish,signal;const pending=new Promise(resolve=>{finish=resolve;});let count=0;
  const h=harness((url,init,content)=>{if(url==='/api/settings'||init?.method==='PATCH'){count++;signal=init.signal;return pending.then(()=>Response.json(url==='/api/settings'?{settings:{manufacturer:'제조사'}}:{content}));}});
  await h.start();const fill=h.button('상품명·저장 기본설정으로 빈 표시사항 채우기','표시사항').props.onClick;
  const save=h.button('표시사항 저장','표시사항').props.onClick;
  if(operation==='fill'){fill();fill();save();}else{save();save();fill();}
  assert.equal(count,1);h.unmount();assert.equal(signal.aborted,true);finish();await settle();assert.equal(h.notices,0);assert.doesNotMatch(JSON.stringify(h.render('표시사항')),/저장 완료|입력을 채웠습니다/);
 }
});
