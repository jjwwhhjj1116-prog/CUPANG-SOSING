import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {Window} from 'happy-dom';

const native=createRequire(import.meta.url);
export async function stageRefreshDOM(fetcher,{components={},exposeDetail=true}={}){
 const window=new Window({url:'https://app.test/'}),previous=new Map();
 for(const [key,value] of Object.entries({window,document:window.document,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,HTMLDetailsElement:window.HTMLDetailsElement,MutationObserver:window.MutationObserver,IS_REACT_ACT_ENVIRONMENT:true})){
  previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 }
 const {createRoot}=await import('react-dom/client'),cache=new Map(),records=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  let source=fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
  if(exposeDetail&&file.endsWith('dashboard-client.tsx'))source+='\nexport { DetailPanel };';
  vm.runInNewContext(ts.transpileModule(source,{fileName:file.endsWith('.mjs')?file+'.ts':file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,fetch:fetcher,window,location:window.location,document:window.document,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,AbortController,AbortSignal,URL,URLSearchParams,TextEncoder,TextDecoder,Date,Intl,crypto,structuredClone,console,setTimeout,clearTimeout,setInterval,clearInterval,Request,Response,Headers,Blob,File,FormData,Buffer,
    require(name){
     if(name.endsWith('.css'))return {};
     if(name.startsWith('@/app/components/')){
      const key=name.split('/').at(-1);if(components[key]===true)return load(name.slice(2)+'.tsx');
      if(components[key])return components[key];
      if(key==='detail-image-edit-dialog')return {DetailImageEditDialog:props=>props.children};
      if(key==='use-menu-dismissal')return {useMenuDismissal(){}};
      if(key==='use-registration-layout')return {useRegistrationLayout:()=>({layout:null,pendingLayout:null,loading:false,error:''})};
      if(key==='use-source-registrations')return {useSourceRegistrations:()=>({items:[],queryItems:[],reload(){}})};
      if(key==='use-intake-draft')return {useIntakeDraft:()=>({rows:[],ready:true,loading:false,saving:false})};
      const Stub=props=>{records.set(key,props);return React.createElement('div',{'data-stub':key});};
      return new Proxy({__esModule:true,default:Stub,registrationTitle:product=>product.title},{get(target,key){return key in target?target[key]:Stub;}});
     }
     if(name.startsWith('@/')){const stem=name.slice(2);if(stem.endsWith('.mjs'))return load(stem);return load(stem+(fs.existsSync(new URL('../../'+stem+'.ts',import.meta.url))?'.ts':'.tsx'));}
     if(name.startsWith('.')){const stem=path.posix.join(path.posix.dirname(file),name);return load(stem+(stem.endsWith('.mjs')?'':'.ts'));}
     return native(name);
    }});
  return exports;
 }
 const container=window.document.createElement('div');window.document.body.append(container);const root=createRoot(container);
 const settle=()=>React.act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
 return {React,window,container,load,records,settle,async render(Component,props){await React.act(async()=>{root.render(React.createElement(Component,props));});await settle();},async close(){await React.act(async()=>root.unmount());await window.happyDOM.abort();for(const[key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}};
}
