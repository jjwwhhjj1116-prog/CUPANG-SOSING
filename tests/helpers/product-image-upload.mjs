import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import assert from 'node:assert/strict';
import {optionPriceTableUI,priceTableCompanies} from './option-price-table-ui.mjs';
export {priceTableCompanies};
export const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
export const imageFile=(name='image.png')=>new File([png],name,{type:'image/png',lastModified:1});
export const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
export const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
export const plain=value=>JSON.parse(JSON.stringify(value));
export async function productImageUploadFixture(company=priceTableCompanies[0]){
 const objects=new Map(),metadata=new Map(),storage={
  async head(key){return objects.has(key)?{size:objects.get(key).byteLength,...metadata.get(key)}:null;},
  async put(key,bytes,options){objects.set(key,new Uint8Array(bytes));metadata.set(key,options);return {};},
  async get(key,options){const bytes=objects.get(key);if(!bytes)return null;const selected=options?.range?bytes.slice(options.range.offset??0,(options.range.offset??0)+options.range.length):bytes;
   return{size:bytes.byteLength,...metadata.get(key),body:new Response(selected).body,arrayBuffer:async()=>bytes.slice().buffer};},
 };
 const api=await optionPriceTableUI(company,{count:2,integrated:true,fileStorage:storage}),owner=api.product.owner_id,id=api.product.id,originalKey=owner+'/original.png';objects.set(originalKey,new Uint8Array(png));metadata.set(originalKey,{httpMetadata:{contentType:'image/png'}});api.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([originalKey]),id);
 const protectedTables=['product_options','product_content','product_price_policy','workspace_settings','collection_context','collection_products'];
 const protectedSnapshot=()=>JSON.stringify(protectedTables.map(table=>[table,api.sqlite.prepare('SELECT * FROM '+table).all()]));const before=protectedSnapshot(),calls=[],controls={};
 const fetcher=async(url,init={})=>{
  const parsed=new URL(url,'https://app.test'),method=init.method??'GET',call={url,method,signal:init.signal,...(init.body instanceof FormData?{name:init.body.get('file').name}:{body:typeof init.body==='string'?JSON.parse(init.body):undefined})};calls.push(call);await controls.before?.(call);
  let response;if(parsed.pathname==='/api/files'){assert.equal(method,'POST');response=await api.load('app/api/files/route.ts').POST(new Request(parsed.href,{method,body:init.body}));}
  else{assert.ok(['', '/content','/attachments','/quotation-fields','/image-upload-link'].some(suffix=>parsed.pathname===`/api/products/${id}`+suffix));const kind=parsed.pathname===`/api/products/${id}`?'':parsed.pathname.split('/').at(-1)+'/';response=await api.load('app/api/products/[id]/'+kind+'route.ts')[method](new Request(parsed.href,{method,...(method==='GET'?{}:{headers:{'content-type':'application/json'},body:init.body})}),{params:Promise.resolve({id})});}
  return controls.response?controls.response(call,response):response;
 };
 const product=()=>api.sqlite.prepare('SELECT * FROM products WHERE id=?').get(id);
 function ui({stage='additional',immediate=false,active=true,onSaved,...extra}={}){
  let props={productId:id,ownerId:owner,version:product().updated_at,storedCount:JSON.parse(product().image_keys).length,stage,active,immediate,...extra},tree,cursor=0,closed=false,saved=0,late=0;const slots=[],effects=[],layouts=[],busyLeases=[];
  const schedule=(queue,effect,deps)=>{const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){slots[index]={deps,cleanup:old?.cleanup};queue.push(()=>{slots[index].cleanup?.();slots[index].cleanup=effect();});}};
  const hooks={useCallback(fn,deps){const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))slots[index]={deps,fn};return slots[index].fn;},useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>{if(closed){late++;return;}slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},useLayoutEffect:(effect,deps)=>schedule(layouts,effect,deps),useEffect:(effect,deps)=>schedule(effects,effect,deps)};
  const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../app/components/product-image-upload-queue.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,File,FormData,Intl,AbortController,Error,fetch:fetcher,require:name=>name.endsWith('.css')?{}:name==='@/app/image-pool-limit'?api.load('app/image-pool-limit.ts'):name==='react'?hooks:name==='react/jsx-runtime'?{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})}:name==='@/app/product-image-upload-queue'?api.load('app/product-image-upload-queue.ts'):(()=>{throw Error(name);})()});
  const render=(next={})=>{props={...props,...next};cursor=0;tree=exports.ProductImageUploadQueue({...props,onBusyChange:value=>busyLeases.push(value),onSaved:()=>{saved++;props={...props,version:product().updated_at,storedCount:JSON.parse(product().image_keys).length};onSaved?.();}});layouts.splice(0).forEach(effect=>effect());effects.splice(0).forEach(effect=>effect());return tree;};
  const settle=async()=>{for(let i=0;i<12;i++){render();await new Promise(resolve=>setImmediate(resolve));}return render();};
  const idle=async()=>{await settle();const until=Date.now()+5000;while(render().props['aria-busy']){if(Date.now()>until)throw Error('queue UI timeout: '+text(render()));await new Promise(resolve=>setTimeout(resolve,1));await settle();}return render();};
  const button=label=>{const value=nodes(render()).find(node=>node.type==='button'&&(text(node)===label||node.props['aria-label']===label));assert.ok(value,label);return value;};
  const select=async files=>{const input=nodes(render()).find(node=>node.type==='input'&&node.props.type==='file');assert.equal(input.props.multiple,props.stage!=='main');const target={files,value:'chosen'};input.props.onChange({target});assert.equal(target.value,'');await idle();};
  render();return {render,settle,idle,button,select,busyLeases,get saved(){return saved;},get late(){return late;},async click(label){const target=button(label);assert.equal(Boolean(target.props.disabled),false,label);target.props.onClick();await idle();},close(){slots.forEach(slot=>slot?.cleanup?.());closed=true;}};
 }
 return {api,owner,id,originalKey,objects,metadata,storage,calls,controls,product,fetcher,protectedSnapshot,before,ui,model:api.load('app/product-image-upload-queue.ts'),close:()=>api.close()};
}
