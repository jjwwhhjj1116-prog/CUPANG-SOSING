import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import * as pageSource from '../../extensions/supplier-hub/page-source.mjs';
const native=createRequire(import.meta.url);
export function sourceReviewModule(file,scope={},cache=new Map()){
 if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,Error,URL,URLSearchParams,Date,Response,Request,Headers,structuredClone,AbortController,crypto:webcrypto,setTimeout,clearTimeout,setInterval,clearInterval,...scope,require(name){
   if(name==='react'&&scope.hooks)return scope.hooks;
   if(name.endsWith('/extensions/supplier-hub/page-source.mjs')||name==='../extensions/supplier-hub/page-source.mjs')return pageSource;
   if(name.startsWith('@/app/'))return sourceReviewModule(name.slice(2)+'.ts',scope,cache);
   if(name.startsWith('.'))return sourceReviewModule(path.posix.join(path.posix.dirname(file),name)+'.ts',scope,cache);
   return native(name);
  }},{filename:file});return exports;
}
export const reviewSourceUrl='https://detail.1688.com/offer/764000000001.html';
export function reviewSourceFixture(ownerId='owner',company={code:'A01464742',name:'와이홉'}){
 const snapshot={format:'yoofam-page-source-v1',sourceUrl:reviewSourceUrl,offerId:'764000000001',collectedAt:'2026-10-20T00:00:00.000Z',title:'합성 수집 상품',description:'합성 원문',
  options:[{key:'black',name:'黑色',supplierSku:null,unitPriceCny:null,currency:null,minimumOrder:null,stock:null,imageUrl:null}],images:[{url:'https://cbu01.alicdn.com/synthetic-764.png',role:'main'}],attributes:[]};
 const before={id:'76400000-0000-4000-8000-000000000001',ownerId,company,fingerprint:'a'.repeat(64),snapshot,revision:1,receivedAt:'2026-10-20T00:00:01.000Z',reviewed:null,issues:['옵션 원가','위안(CNY) 통화'],archivedAt:null,captureOriginId:'76400000-0000-4000-8000-000000000001',captureVersion:1};
 const saved={...structuredClone(before),revision:2,reviewed:{...structuredClone(snapshot),title:'검토한 상품명',options:snapshot.options.map(row=>({...row,unitPriceCny:2.99,currency:'CNY'}))},issues:[]};
 return {before,saved};
}
export function sourceReviewHookFixture(fetcher){
 const slots=[],effects=[],layouts=[],calls=[],events=new Map(),timers=new Map();let cursor=0,owner='owner',timer=0;
 const effect=(queue,fn,deps)=>{const index=cursor++,previous=slots[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i]))){slots[index]={deps,cleanup:previous?.cleanup};queue.push(()=>{slots[index].cleanup?.();slots[index].cleanup=fn();});}};
 const hooks={useState(value){const index=cursor++;if(!(index in slots))slots[index]=typeof value==='function'?value():value;return[slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next;}];},useRef(value){const index=cursor++;return slots[index]??(slots[index]={current:value});},useMemo(fn,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))slots[index]={deps,value:fn()};return slots[index].value;},useCallback:fn=>fn,useLayoutEffect(fn,deps){effect(layouts,fn,deps);},useEffect(fn,deps){effect(effects,fn,deps);}};
 const window={addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name,fn)=>{if(events.get(name)===fn)events.delete(name);},postMessage(){}},document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 const {useSourceRegistrations}=sourceReviewModule('app/components/use-source-registrations.ts',{hooks,window,document,location:{origin:'https://app.test'},
  setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id),setInterval:()=>999,clearInterval(){},fetch:(url,init)=>{calls.push({url,init});return fetcher(url,init);}});
 function FixtureRender(passive=true){cursor=0;const result=useSourceRegistrations(owner);layouts.splice(0).forEach(fn=>fn());if(passive)effects.splice(0).forEach(fn=>fn());return result;}
 return {render:FixtureRender,calls,event(){events.get('focus')?.();},owner(value,{passive=true}={}){owner=value;return FixtureRender(passive);},close(){for(const slot of slots)slot?.cleanup?.();}};
}
export const sourceReviewNodes=tree=>Array.isArray(tree)?tree.flatMap(sourceReviewNodes):tree&&typeof tree==='object'?[tree,...sourceReviewNodes(tree.props?.children)]:[];
export const sourceReviewText=tree=>Array.isArray(tree)?tree.map(sourceReviewText).join(''):tree&&typeof tree==='object'?sourceReviewText(tree.props?.children):tree==null?'':String(tree);
