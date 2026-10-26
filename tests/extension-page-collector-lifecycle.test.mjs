import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {pageCollectorDom} from './helpers/page-collector-dom.mjs';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../deployment/extension-page-collector.mjs',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',target:'chrome120',plugins:[{name:'inert-lifecycle-source',setup(build){
 build.onLoad({filter:/[/\\]page-source\.mjs$/},()=>({loader:'js',contents:`
  export const pageSourceUrl=value=>{const url=new URL(value);return {sourceUrl:url.origin+url.pathname};};
  export const extractPageSource=()=>{globalThis.sourceReads++;return globalThis.captureFixture;};
  export const readPageSourceDomOptions=()=>[];export const readPageSourceDomFacts=()=>({});export const readPageSourceElementImage=()=>null;
  export const readPageSourceDescriptionReference=()=>null;export const validatePageSourceForDelivery=value=>value;
 `}));
 build.onLoad({filter:/[/\\]page-dom-details\.mjs$/},()=>({loader:'js',contents:'export const waitForPageDomDetails=()=>{globalThis.sourceReads++;return globalThis.readDetails();};'}));
}}]});
const HOST='yoofam-page-collector',OWNER='data-yoofam-collector-owner',VERSION='data-yoofam-collector-version',LEASE='data-yoofam-collector-capture';
const sourceUrl='https://detail.1688.com/offer/886034098637.html',snapshot={format:'yoofam-page-source-v1',sourceUrl,offerId:'886034098637',collectedAt:'2026-10-23T01:00:00.000Z',title:'합성 상품',description:'',attributes:[],options:[{key:'black',name:'검정'}],images:[]};
function harness(){
 const dom=pageCollectorDom(),messages=[];let now=Date.parse('2026-10-23T01:00:00.000Z');
 class ClockDate extends Date{static now(){return now;}}
 const window={};window.top=window;
 const context={window,document:dom.document,location:{href:sourceUrl},URL,Date:ClockDate,Error,TextEncoder,captureFixture:snapshot,sourceReads:0,readDetails:()=>({description:'',detailImages:[]}),
  respond:()=>({ok:true,delivered:true}),chrome:{runtime:{getManifest(){assert.fail('no manifest identity shortcut');},sendMessage:async message=>{messages.push(structuredClone(message));return context.respond(message);}}},fetch(){assert.fail('lifecycle must not fetch');}};
 const makeHost=({owner,version,tag='div',open=false}={})=>{const host=dom.document.createElement(tag);host.id=HOST;host.style.cssText='position:fixed;right:22px;bottom:86px;z-index:2147483646;';host.attachShadow({mode:open?'open':'closed'});if(owner!==undefined)host.setAttribute(OWNER,owner);if(version!==undefined)host.setAttribute(VERSION,version);dom.document.documentElement.append(host);return host;};
 const install=(version='2.1.38')=>{vm.runInNewContext(bundle.outputFiles[0].text.replaceAll('"2.1.38"',JSON.stringify(version)),context);const host=dom.document.getElementById(HOST),children=host?.testShadow?.childNodes??[];return {host,button:children.find(node=>node.tag==='button'),status:children.find(node=>node.tag==='p'),badge:children.find(node=>node.tag==='small')};};
 return {...dom,context,messages,makeHost,install,advance:ms=>{now+=ms;},get now(){return now;}};
}

test('only the exact legacy closed-shadow host or an explicitly owned older/unversioned host is replaced without reading the product',()=>{
 for(const attributes of [{},{owner:'yoofam-studio'},{owner:'yoofam-studio',version:'2.1.23'}]){
  const h=harness(),old=h.makeHost(attributes),current=h.install();assert.notEqual(current.host,old);assert.equal(old.isConnected,false);
  assert.equal(current.host.getAttribute(OWNER),'yoofam-studio');assert.equal(current.host.getAttribute(VERSION),'2.1.38');assert.equal(current.badge.textContent,'수집기 2.1.38');
  assert.equal(h.context.sourceReads,0);assert.equal(h.messages.length,0);
 }
});

test('same/newer versions are idempotent; foreign/open-shadow/unknown-version same-ID hosts fail closed',()=>{
 for(const attributes of [{owner:'yoofam-studio',version:'2.1.38'},{owner:'yoofam-studio',version:'2.1.38'},
  {owner:'someone-else',version:'2.1.23'},{owner:'yoofam-studio',version:'unknown'},{tag:'span'},{open:true}]){
  const h=harness(),old=h.makeHost(attributes),count=h.elements.length,current=h.install();assert.equal(current.host,old);assert.equal(old.isConnected,true);assert.equal(h.elements.length,count);assert.equal(h.context.sourceReads,0);assert.equal(h.messages.length,0);
 }
 const h=harness(),first=h.install(),count=h.elements.length;assert.equal(h.install().host,first.host);assert.equal(h.elements.length,count);
});

test('a disconnected/replaced old handler cannot begin another capture or change either version status',async()=>{
 const h=harness(),old=h.install('2.1.23'),fresh=h.install(),oldText=old.status.textContent;
 await old.button.click({isTrusted:true});await fresh.button.click({isTrusted:false});assert.equal(h.context.sourceReads,0);assert.equal(h.messages.length,0);assert.equal(old.status.textContent,oldText);assert.equal(fresh.status.hidden,true);
 await fresh.button.click({isTrusted:true});assert.equal(h.messages.length,1);assert.equal(fresh.button.textContent,'수집 완료');assert.match(fresh.status.textContent,/서버 수집본 상세 미확인/);
});

test('replacement during the passive detail wait stops the old capture before extraction/send and never auto-starts the new one',async()=>{
 const h=harness();let release;h.context.readDetails=()=>new Promise(resolve=>{release=resolve;});
 const old=h.install('2.1.23'),operation=old.button.click({isTrusted:true}),oldStatus=old.status.textContent;
 assert.equal(h.context.sourceReads,1);const fresh=h.install();await fresh.button.click({isTrusted:true});assert.match(fresh.status.textContent,/이전 수집 응답/);assert.equal(h.context.sourceReads,1);
 release({description:'',detailImages:[]});await operation;assert.equal(h.messages.length,0);assert.equal(old.status.textContent,oldStatus);assert.equal(h.document.documentElement.getAttribute(LEASE),null);
 h.context.readDetails=()=>({description:'',detailImages:[]});await fresh.button.click({isTrusted:true});assert.equal(h.messages.length,1);
});

test('replacement cannot cancel an already-sent request, but its late ACK never publishes old success or overlaps a new send',async()=>{
 const h=harness();let release;h.context.respond=()=>new Promise(resolve=>{release=resolve;});
 const old=h.install('2.1.23'),operation=old.button.click({isTrusted:true}),oldStatus=old.status.textContent;
 await new Promise(resolve=>setImmediate(resolve));assert.equal(h.messages.length,1);
 const fresh=h.install();await fresh.button.click({isTrusted:true});assert.equal(h.messages.length,1);assert.match(fresh.status.textContent,/이전 수집 응답/);
 release({ok:true,delivered:true});await operation;assert.equal(old.status.textContent,oldStatus);assert.notEqual(old.button.textContent,'수집 완료');assert.equal(h.messages.length,1);
 h.context.respond=()=>({ok:true,delivered:true});await fresh.button.click({isTrusted:true});assert.equal(h.messages.length,2);assert.equal(fresh.button.textContent,'수집 완료');
});

test('only a trusted click may reclaim an expired owned lease; unknown/malformed leases require explicit page refresh',async()=>{
 for(const value of ['foreign-busy','yoofam-studio:2.1.23:bad',`yoofam-studio:2.1.23:1792717200000:1792717320000:1`]){
  const h=harness(),current=h.install();h.document.documentElement.setAttribute(LEASE,value);await current.button.click({isTrusted:true});assert.equal(h.context.sourceReads,0);assert.equal(h.messages.length,0);assert.equal(h.document.documentElement.getAttribute(LEASE),value);assert.match(current.status.textContent,/새로고침/);
 }
 const h=harness(),current=h.install(),expired=`yoofam-studio:2.1.23:${h.now-120000}:${h.now-60000}:1`;h.document.documentElement.setAttribute(LEASE,expired);
 await current.button.click({isTrusted:false});assert.equal(h.document.documentElement.getAttribute(LEASE),expired);assert.equal(h.context.sourceReads,0);
 await current.button.click({isTrusted:true});assert.equal(h.messages.length,1);assert.equal(h.document.documentElement.getAttribute(LEASE),null);
});

test('after an expired lease is replaced, the old delayed closure cannot send, report success or clear the new active lease',async()=>{
 const h=harness();let releaseOld,releaseNew;h.context.readDetails=()=>new Promise(resolve=>{releaseOld=resolve;});
 const old=h.install('2.1.23'),oldOperation=old.button.click({isTrusted:true}),oldStatus=old.status.textContent,fresh=h.install();
 h.advance(60001);h.context.readDetails=()=>({description:'',detailImages:[]});h.context.respond=()=>new Promise(resolve=>{releaseNew=resolve;});
 const freshOperation=fresh.button.click({isTrusted:true}),freshLease=h.document.documentElement.getAttribute(LEASE);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(h.messages.length,1);
 releaseOld({description:'',detailImages:[]});await oldOperation;assert.equal(h.messages.length,1);assert.equal(h.document.documentElement.getAttribute(LEASE),freshLease);assert.equal(old.status.textContent,oldStatus);
 releaseNew({ok:true,delivered:true});await freshOperation;assert.equal(fresh.button.textContent,'수집 완료');assert.equal(h.document.documentElement.getAttribute(LEASE),null);
});

test('the same active handler checks its deadline after await and never sends a timed-out capture or retries automatically',async()=>{
 const h=harness();let release;h.context.readDetails=()=>new Promise(resolve=>{release=resolve;});const current=h.install(),operation=current.button.click({isTrusted:true});
 h.advance(60001);release({description:'',detailImages:[]});await operation;assert.equal(h.messages.length,0);assert.match(current.status.textContent,/60초를 초과/);assert.equal(current.button.disabled,false);assert.equal(h.document.documentElement.getAttribute(LEASE),null);
});
