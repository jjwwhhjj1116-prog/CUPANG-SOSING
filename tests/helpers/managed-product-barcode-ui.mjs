import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {managedProductHarness,managedFixture} from './managed-products.mjs';
import {workbookArchive} from './quotation-workbook.mjs';

const native=createRequire(import.meta.url);
export const barcodeCompanies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
export const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
export const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
export const plain=value=>JSON.parse(JSON.stringify(value));
export const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
export const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};};

/** Load the real read-only barcode/API graph against a private memory DB.
 * Native JsBarcode is the only third-party module allowed by this adapter. */
export function barcodeRuntime(h,globals={},overrides={}){
 const cache=new Map(),db={prepare(sql){let args=[];const query={sql,bind(...values){args=values;return query;},execute(){return h.sqlite.prepare(sql).all(...args);},async all(){return{results:query.execute()};},async first(){return query.execute()[0]??null;},async run(){return h.sqlite.prepare(sql).run(...args);}};return query;},async batch(queries){h.state.beforeBatch?.(queries);h.sqlite.exec('BEGIN');try{const results=queries.map(query=>({results:query.execute()}));h.sqlite.exec('COMMIT');return results;}catch(error){h.sqlite.exec('ROLLBACK');throw error;}}};
 function load(file){
  if(overrides[file])return overrides[file];if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,Error,RangeError,URL,URLSearchParams,Response,Request,File,FormData,Blob,AbortController,AbortSignal,DOMException,DecompressionStream,TextEncoder,TextDecoder,Uint8Array,DataView,Date,JSON,structuredClone,crypto,queueMicrotask,setTimeout,clearTimeout,process:{env:{NODE_ENV:'production'}},...globals,
    require(name){if(name==='cloudflare:workers')return{env:{DB:db}};if(name==='next/server')return{NextResponse:Response};if(name==='@/app/chatgpt-auth')return{getChatGPTUser:async()=>h.state.user};if(name==='jsbarcode'){const value=native(name);return{default:value,...value};}if(name.endsWith('.css'))return{};if(name==='react'||name==='react/jsx-runtime')return globals.modules?.[name]??native(name);
     if(name.startsWith('@/'))return load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts'));
     if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');throw Error('Unsupported barcode fixture module '+name);}});
  return exports;
 }
 return{load};
}

export async function barcodeFixture(company=barcodeCompanies[0],{count=30,mutate,ownerId,productLabel}={}){
 const h=managedProductHarness();h.state.user={...h.state.user,userId:ownerId??'barcode-'+company.code,membership:{...h.state.user.membership,id:ownerId??'barcode-'+company.code,companyCode:company.code,companyName:company.name}};h.syncMember();
 let bytes=managedFixture(count,rows=>{for(const[index,row]of rows.entries()){
  row['상품명']=`${company.name} 합성 바코드 상품 ${index+1}`;row['바코드']=index===2?'':index===1?'YF645-'+company.code:('00'+String(1234567890+index));row['발주가능상태']=['정상','품절','발주중지',''][index%4];row['썸네일']='';row['판매링크']='';row['구매링크']='';
  row['구매정보']=JSON.stringify([{'상품명':row['상품명'],'바코드':row['바코드'],'한글표시사항':{'제품명':row['상품명'],'제조국':'중국','내용량':'1개','kc인증':false,'확장객체':{preserve:'private'}}}]);
  if(productLabel)row['제품분류']=JSON.stringify(productLabel);
 }mutate?.(rows);});
 if(productLabel){const archive=await h.load('app/xlsx-template.ts').readXlsxArchive(bytes.buffer),sheet='xl/worksheets/sheet1.xml',original=new TextDecoder().decode(archive.get(sheet));assert.ok(original.includes('<t>제품분류</t>'));archive.set(sheet,new TextEncoder().encode(original.replace('<t>제품분류</t>','<t>한글표시사항</t>')));bytes=workbookArchive([...archive]);}
 const preview=await json(await h.submit(bytes,{companyCode:company.code}));await json(await h.submit(bytes,{companyCode:company.code,action:'import',sha256:preview.sha256,accountContext:preview.accountContext}),201);
 const list=await json(await h.fetcher('/api/managed-products')),runtime=barcodeRuntime(h),requests=[];
 const request=async(url,init={})=>{const local=new URL(url,'https://app.test');requests.push({url:local.pathname+local.search,method:init.method??'GET'});const match=local.pathname.match(/^\/api\/managed-products\/([^/]+)\/barcode$/u);if(!match)return h.fetcher(local.pathname+local.search,init);return runtime.load('app/api/managed-products/[skuId]/barcode/route.ts').GET(new Request(local.href,init),{params:Promise.resolve({skuId:decodeURIComponent(match[1])})});};
 const snapshot=()=>JSON.stringify(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,h.sqlite.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()]));
 const endpoint=(skuId='1000000000',sourceVersion)=>'/api/managed-products/'+encodeURIComponent(skuId)+'/barcode?'+new URLSearchParams({expectedAccountContext:list.accountContext,...(sourceVersion?{expectedSourceVersion:sourceVersion}:{})});
 return{h,company,skuId:'1000000000',accountContext:list.accountContext,list,bytes,runtime,requests,request,endpoint,snapshot,view:(skuId,sourceVersion)=>request(endpoint(skuId,sourceVersion)).then(response=>json(response)),close:()=>h.close()};
}

/** Actual hooks and module graph, with only physical output replaced by spies.
 * API reads still use the real route; no OS printing, canvas or external I/O. */
export function barcodeUI(f,{fetcher=f.request,...initialProps}={}){
 let cursor=0,epoch=0,closed=false,lateUpdates=0,props={skuId:f.skuId,company:f.company,accountContext:f.accountContext,...initialProps};const slots=[],effects=[],layouts=[],requests=[],outputs=[],closes=[],locks=[],outputInterceptors={};
 const effect=(queue,callback,deps)=>{const index=cursor++,old=slots[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps[i]))){const next={deps,cleanup:old?.cleanup};slots[index]=next;queue.push(()=>{old?.cleanup?.();next.cleanup=callback();});}};
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,value=>{if(closed){lateUpdates++;return;}epoch++;slots[index].value=typeof value==='function'?value(slots[index].value):value;}];},useRef(value){const index=cursor++;return slots[index]??(slots[index]={current:value});},useEffect(callback,deps){effect(effects,callback,deps);},useLayoutEffect(callback,deps){effect(layouts,callback,deps);}};
 const outputRuntime=barcodeRuntime(f.h),builds=[],actualOutput=outputRuntime.load('app/managed-product-barcode-output.ts');
 const output={...actualOutput,buildManagedBarcodeOutput(view,settings){builds.push({view:plain(view),settings:plain(settings)});return actualOutput.buildManagedBarcodeOutput(view,settings);},async printManagedBarcode(value,signal){outputs.push({action:'print',output:plain(value),signal});return outputInterceptors.print?.(value,signal);},async downloadManagedBarcodePng(value,filename,signal){outputs.push({action:'download',output:plain(value),filename,signal});return outputInterceptors.download?.(value,filename,signal);}};
 const runtime=barcodeRuntime(f.h,{modules:{react:hooks,'react/jsx-runtime':{jsx:(type,children)=>({type,props:children}),jsxs:(type,children)=>({type,props:children})}},fetch:async(url,init={})=>{requests.push({url,init});return fetcher(url,init);}}, {'app/managed-product-barcode-output.ts':output});
 const Component=runtime.load('app/components/managed-product-barcode-panel.tsx').ManagedProductBarcodePanel;
 const render=()=>{cursor=0;const tree=Component({...props,onClose:(...args)=>{closes.push(args);props.onClose?.(...args);},onBusyChange:value=>{locks.push(value);props.onBusyChange?.(value);}});layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;};
 const idle=async()=>{let quiet=0;const deadline=Date.now()+10000;for(;;){const before=epoch,count=requests.length;render();await new Promise(resolve=>setTimeout(resolve,2));render();if(before===epoch&&count===requests.length)quiet++;else quiet=0;if(quiet>=3)return;if(Date.now()>deadline)throw Error('Managed barcode UI did not settle');}};
 const field=label=>nodes(render()).find(node=>node.props?.['aria-label']===label),button=label=>nodes(render()).find(node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label));render();
 return{render,idle,field,button,requests,outputs,builds,closes,locks,get lateUpdates(){return lateUpdates;},props(patch){props={...props,...patch};render();},output(action,intercept){outputInterceptors[action]=intercept;},async click(label){const node=button(label);assert.ok(node&&!node.props.disabled,'Unavailable '+label);node.props.onClick();await idle();},edit(label,value){const node=field(label);assert.ok(node&&node.props.onChange&&!node.props.disabled,'Unavailable '+label);node.props.onChange({target:{value:String(value),valueAsNumber:Number(value)}});render();},close(){if(closed)return;closed=true;slots.forEach(slot=>slot?.cleanup?.());}};
}
