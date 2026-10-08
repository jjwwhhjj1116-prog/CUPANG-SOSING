import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
function fixture(){
  const slots=[],effects=new Map(),calls=[];let cursor=0;
  const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
    useEffect(callback,deps){const i=cursor++,previous=effects.get(i);if(previous&&JSON.stringify(previous.deps)===JSON.stringify(deps))return;previous?.cleanup?.();effects.set(i,{deps,cleanup:callback()});}};
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/supplier-hub-extension-check.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,AbortController,Boolean,Error,require(name){if(name==='react')return hooks;if(name==='@/app/supplier-hub-handoff')return{readSupplierHubExtensionInfo(signal){return new Promise((resolve,reject)=>calls.push({signal,resolve,reject}));}};return native(name);}});
  const render=()=>{cursor=0;return exports.SupplierHubExtensionCheck();};
  const text=()=>nodes(render()).flatMap(node=>{const value=node.props?.children;return Array.isArray(value)?value.filter(item=>typeof item==='string'):typeof value==='string'?[value]:[];}).join(' ');
  return{calls,render,text,unmount(){for(const effect of effects.values())effect.cleanup?.();effects.clear();slots.length=0;},
    retry(){const button=nodes(render()).find(node=>node.type==='button');assert.equal(button.props.disabled,false);button.props.onClick();render();}};
}
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
test('settings shows the returned installed version and flags, not the download label as installed evidence',async()=>{
  const ui=fixture();ui.render();assert.equal(ui.calls.length,1);
  ui.calls[0].resolve({version:'0.2.54',pendingReceiptRefreshRecovery:false,registrationObservationCas:false});await settle();
  assert.match(ui.text(),/설치된 버전 0\.2\.54/);assert.match(ui.text(),/확장 업데이트 필요/);
  assert.equal(nodes(ui.render()).find(node=>node.type==='a').props.href,'/downloads/yoofam-plus-supplier-hub-extension-0.2.58.zip');
  ui.retry();assert.equal(ui.calls.length,2);assert.equal(ui.calls[0].signal.aborted,true);
  ui.calls[1].resolve({version:'0.2.57',pendingReceiptRefreshRecovery:true,registrationObservationCas:true,productTransmissionHistory:true,historicalReceiptLookup:true});await settle();
  assert.match(ui.text(),/설치된 버전 0\.2\.57/);assert.doesNotMatch(ui.text(),/업데이트 필요/);assert.equal(nodes(ui.render()).some(node=>node.type==='a'),false);
  ui.unmount();
});
test('a closed settings dialog aborts the read and its late response cannot replace the newly opened version',async()=>{
  const ui=fixture();ui.render();const old=ui.calls[0];ui.unmount();assert.equal(old.signal.aborted,true);ui.render();
  ui.calls[1].resolve({version:'0.2.57',pendingReceiptRefreshRecovery:true,registrationObservationCas:true,productTransmissionHistory:true,historicalReceiptLookup:true});await settle();
  old.resolve({version:'0.2.1',pendingReceiptRefreshRecovery:false,registrationObservationCas:false});await settle();
  assert.match(ui.text(),/설치된 버전 0\.2\.57/);assert.doesNotMatch(ui.text(),/0\.2\.1|업데이트 필요/);
  ui.unmount();
});
