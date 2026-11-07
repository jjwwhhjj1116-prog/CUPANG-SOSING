import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {Window} from 'happy-dom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
const require=createRequire(import.meta.url);
const load=file=>{const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require(name){return name==='@/app/free-image-brush'?{MAX_FREE_IMAGE_BRUSH_POINTS:2048}:name.startsWith('@/')?load(name.slice(2)+'.ts'):require(name);}});return exports;};

test('actual React crop and brush pointers keep native coordinates at zoom and scroll, and cancel moved surfaces',async()=>{
 const window=new Window(),previous=new Map();
 for(const [key,value] of Object.entries({window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});}
 try{
 for(const [file,name,crop] of [['app/components/free-image-brush-canvas.tsx','FreeImageBrushCanvas',false],['app/components/free-image-crop-canvas.tsx','FreeImageCropCanvas',true]]){
 const Component=load(file)[name],container=document.createElement('div');document.body.append(container);const root=createRoot(container),completed=[],canceled=[];let serial=0,rect;
 const base={sourceUrl:'data:image/png;base64,',width:200,height:100,scopeKey:'one',enabled:true,disabled:false,size:3,color:'#000000',maxPoints:20,strokes:[],crop:null,onBegin:()=>String(++serial),onComplete:(id,value)=>completed.push(value),onCancel:id=>canceled.push(id)};
 for(const scale of [0.5,1,2]){
 await act(async()=>root.render(React.createElement(Component,{...base,displayScale:scale})));
 const svg=container.querySelector('svg');rect={left:-37,top:-21,width:200*scale,height:100*scale};svg.getBoundingClientRect=()=>({...rect});let captured=false;svg.setPointerCapture=()=>{captured=true;};svg.hasPointerCapture=()=>captured;svg.releasePointerCapture=()=>{captured=false;};
 const send=async(type,x,y)=>act(async()=>svg.dispatchEvent(new window.PointerEvent(type,{bubbles:true,clientX:rect.left+x*scale,clientY:rect.top+y*scale,pointerId:1,button:0,buttons:1,isPrimary:true,pointerType:'mouse'})));
 assert.equal(container.querySelector('div').style.width,`${200*scale}px`);
 await send('pointerdown',20,30);await send('pointermove',40,50);await send('pointerup',40,50);
 assert.deepEqual(JSON.parse(JSON.stringify(completed.at(-1))),crop?{x:20,y:30,width:21,height:21}:[{x:20,y:30},{x:40,y:50}]);assert.equal(captured,false);
 await send('pointerdown',20,30);rect.left-=10;await send('pointerup',40,50);assert.ok(canceled.length);assert.equal(captured,false);
 }
 const photo={rotation:90,flipX:true,flipY:false,brightness:100,contrast:100,saturation:100,hue:0};
 await act(async()=>root.render(React.createElement(Component,{...base,scopeKey:'oriented',displayScale:2,photo})));
 const oriented=container.querySelector('svg');rect={left:-39,top:-27,width:200,height:400};
 oriented.getBoundingClientRect=()=>({...rect});let orientedCapture=false;
 oriented.setPointerCapture=()=>{orientedCapture=true;};oriented.hasPointerCapture=()=>orientedCapture;oriented.releasePointerCapture=()=>{orientedCapture=false;};
 const point=async(type,x,y)=>act(async()=>oriented.dispatchEvent(new window.PointerEvent(type,{bubbles:true,clientX:rect.left+x*2,clientY:rect.top+y*2,pointerId:1,button:0,buttons:1,isPrimary:true,pointerType:'mouse'})));
 await point('pointerdown',30,20);await point('pointerup',50,40);
 assert.deepEqual(JSON.parse(JSON.stringify(completed.at(-1))),crop?{x:20,y:30,width:21,height:21}:[{x:20,y:30},{x:40,y:50}]);
 await act(async()=>root.unmount());container.remove();
 }
 }finally{window.happyDOM.abort();for(const [key,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
});
