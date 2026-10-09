import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const version='2026-10-10T00:00:00.000Z',next='2026-10-10T00:00:00.001Z';
function ui({badAck=false}={}){
 const slots=[],effects=[],cache=new Map(),calls=[];let cursor=0,saved=0;
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useCallback:fn=>fn,useMemo:fn=>fn(),useEffect(fn,deps){const i=cursor++;if(!slots[i]||JSON.stringify(slots[i].deps)!==JSON.stringify(deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {exports,Error,AbortController,structuredClone,fetch:async(url,init)=>{calls.push({url,init});if(!init?.method)return Response.json(base);
  assert.ok(url.endsWith('/option-names'));const value=JSON.parse(init.body);const changed=names.applyOptionNameChanges(base.options,value.changes,next),body={...base,options:changed,productVersion:next};
  if(badAck)body.options.rows[1].unitCostCny=999;return Response.json(body);},require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name.startsWith('@/app/components/'))return new Proxy({},{get:()=>()=>null});if(name.startsWith('@/'))return load(name.slice(2)+'.ts');throw Error(name);}});return exports;}
 const options=load('app/product-options.ts'),names=load('app/option-seo-names.ts'),policy={exchangeRate:350,supplyMargin:50,coupangMargin:40,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10};
 const rows=['a','b'].map(id=>({...options.emptyOptionInput(id),originalName:'黑色',translatedName:id==='b'?'다른 이름':'',unitCostCny:null,imageKey:id==='a'?null:'owner/photo.png',provenance:Object.fromEntries(Object.keys(options.optionFieldNames).map(key=>[key,key==='translatedName'?'unverified':'collected'])),updatedAt:version}));
 const base={options:{schemaVersion:1,productId:'p',revision:2,updatedAt:version,rows},productVersion:version,sourceImageKeys:{a:'owner/photo.png'},pricing:{policy,policySource:'product-and-workspace',rows:options.calculateOptionPrices(options.optionInputs({rows}),policy)}};
 const Component=load('app/components/product-options-editor.tsx').ProductOptionsEditor;
 const render=()=>{cursor=0;const outer=Component({product:{id:'p',title:'상품',updated_at:version,image_keys:'["owner/photo.png"]'},seoView:true,onSaved(){saved++;}});
  const editor=nodes(outer).find(node=>typeof node.type==='function');const tree=editor.type(editor.props);effects.splice(0).forEach(fn=>fn());return tree;};
 const idle=async()=>{for(let i=0;i<10;i++){render();await new Promise(resolve=>setImmediate(resolve));}};
 render();return{render,idle,calls,base,input:label=>nodes(render()).find(node=>node.type==='input'&&node.props['aria-label']===label),button:label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label),get saved(){return saved;},close(){slots.forEach(slot=>slot?.cleanup?.());}};
}
test('SEO option-name UI sends only the explicitly edited ID, including an unchanged manual blank',async()=>{
 const h=ui();try{await h.idle();assert.equal(h.calls.length,1);assert.ok(nodes(h.render()).some(node=>node.type==='img'&&node.props.src==='/api/files/owner/photo.png'));assert.equal(h.base.options.rows[0].imageKey,null);h.input('1번째 한국어 옵션명').props.onChange({target:{value:''}});assert.equal(h.button('옵션명 저장').props.disabled,false);h.button('옵션명 저장').props.onClick();await h.idle();
  const write=h.calls.find(call=>call.init?.method==='PATCH'),body=JSON.parse(write.init.body);assert.deepEqual(body,{expectedRevision:2,expectedProductVersion:version,changes:[{optionId:'a',value:''}]});assert.equal(h.saved,1);assert.equal(h.input('2번째 한국어 옵션명').props.value,'다른 이름');assert.equal(h.input('1번째 한국어 옵션명').props.value,'');
 }finally{h.close();}
});
test('SEO option-name UI retains its draft when the acknowledgement changes another option cost',async()=>{
 const h=ui({badAck:true});try{await h.idle();h.input('1번째 한국어 옵션명').props.onChange({target:{value:'검정'}});h.button('옵션명 저장').props.onClick();await h.idle();assert.equal(h.saved,0);assert.equal(h.input('1번째 한국어 옵션명').props.value,'검정');assert.match(text(h.render()),/일치하지/);assert.equal(h.calls.filter(call=>call.init?.method==='PATCH').length,1);}finally{h.close();}
});
