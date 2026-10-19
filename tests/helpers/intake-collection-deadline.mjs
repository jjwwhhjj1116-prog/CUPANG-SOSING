import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {providedOptionModule} from './provided-option-quotation.mjs';

export function acknowledgementClock(load=providedOptionModule){
 const timers=new Map();let nextId=0;
 const exports={};
 const code=ts.transpileModule(fs.readFileSync(new URL('../../app/intake-collection-recovery.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,Error,AbortController,
  setTimeout(callback,delay){const id=++nextId;timers.set(id,{callback,delay});return id;},clearTimeout(id){timers.delete(id);},
  require(name){assert.equal(name,'@/app/collection-receipt-response');return load('app/collection-receipt-response.ts');},
 });
 return {...exports,timers,fire(delay){const found=[...timers].find(([,timer])=>timer.delay===delay);assert.ok(found,'Missing active deadline '+delay);timers.delete(found[0]);found[1].callback();}};
}
export const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
export function observe(promise){const state={settled:false,value:undefined,error:undefined};promise.then(value=>{state.value=value;state.settled=true;},error=>{state.error=error;state.settled=true;});return state;}
export function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

/** Actual intake orchestration with its one response reader clock controlled;
 * every other dependency remains the isolated real application implementation. */
export function intakeWithDeadline(h,clock){
 const exports={};
 const code=ts.transpileModule(fs.readFileSync(new URL('../../app/intake-collection.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,Error,AbortSignal,require(name){if(name==='@/app/intake-collection-recovery')return clock;assert.ok(name.startsWith('@/'));return h.load(name.slice(2)+'.ts');}});
 return exports.collectIntakeProduct;
}
