import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
function client({capability='couplus-consumer-keywords-v1',malformed=false,onLookup}={}){
 const listeners=new Set(),messages=[],window={location:{origin:'http://localhost:3000'},addEventListener:(type,fn)=>listeners.add(fn),removeEventListener:(type,fn)=>listeners.delete(fn),postMessage(message){messages.push(message);if(message.type==='SEO_KEYWORDS_CANCEL')return;if(message.type==='SEO_KEYWORDS')onLookup?.();queueMicrotask(()=>{const result=message.type==='PING'?{ok:true,seoKeywords:capability}:{ok:true,capability,requestId:message.requestId,query:message.payload.query,keywords:malformed?['x'.repeat(201)]:['양말',' 양말 ','양말'],warnings:[]};for(const listener of listeners)listener({source:window,origin:window.location.origin,data:{channel:'YOOFAM_HUB_HANDOFF_RESULT',requestId:message.requestId,result}});});}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/seo-related-keywords-client.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,window,Error,crypto:webcrypto,setTimeout,clearTimeout,require:name=>providedOptionModule(name.slice(2)+'.ts')});return {...exports,messages,listeners};
}
const memo={brand:'',features:'',keywords:'양말'};
test('provided preferences win, exact strings survive and absent target never contacts extension',async()=>{
 const c=client(),signal=new AbortController().signal,result=await c.acquireSeoComposition(memo,signal,()=>true,[' 양말 ','양말',' 양말 ',' ']);assert.equal(result.related.source,'provided');assert.deepEqual(Array.from(result.related.keywords),[' 양말 ','양말']);assert.equal(c.messages.length,0);await c.acquireSeoComposition({...memo,keywords:''},signal,()=>true);assert.equal(c.messages.length,0);
});
test('exact capability query and id bind consumer preferences; old/malformed replies warn and continue',async()=>{
 for(const options of [{},{capability:'relatedKeywords'},{malformed:true}]){const c=client(options),result=await c.acquireSeoComposition(memo,new AbortController().signal,()=>true);assert.equal(c.listeners.size,0);if(!Object.keys(options).length){assert.equal(result.related.source,'consumer');assert.deepEqual(Array.from(result.related.keywords),['양말',' 양말 ']);assert.equal(c.messages.length,2);}else{assert.equal(result.related.source,'unavailable');assert.equal(result.related.keywords.length,0);assert.equal(result.related.warnings.length,1);if(options.capability)assert.equal(c.messages.length,1);}}
});
test('abort and changed memo epoch during lookup cannot return late provider inputs',async()=>{
 const controller=new AbortController(),c=client({onLookup:()=>controller.abort()});await assert.rejects(c.acquireSeoComposition(memo,controller.signal,()=>true));assert.ok(c.messages.some(value=>value.type==='SEO_KEYWORDS_CANCEL'));assert.equal(c.listeners.size,0);
 let current=true;const changed=client({onLookup:()=>{current=false;}});await assert.rejects(changed.acquireSeoComposition(memo,new AbortController().signal,()=>current));
});
