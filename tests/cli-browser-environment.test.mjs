import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(environment={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/cli-browser-environment.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,TypeError,Promise,setTimeout,clearTimeout,...environment,fetch(){throw Error('No socket or app network is permitted');}});return exports.readCliBrowserEnvironment;}
const read=load();
for(const state of ['granted','prompt','denied'])test(`readonly diagnosis distinguishes actual ${state} without requesting access`,async()=>{
 const queries=[];const report=await read({environment:{secureContext:true,visibility:'visible',permissions:{query(descriptor){queries.push(descriptor);return Promise.resolve({state});},request(){throw Error('Permission request forbidden');}}}});
 assert.deepEqual(JSON.parse(JSON.stringify(report)),{secureContext:true,visibility:'visible',loopbackPermission:state});assert.equal(queries.length,1);assert.equal(queries[0].name,'loopback-network');assert.equal(JSON.stringify(queries).includes('local-network-access'),false);
});
test('unavailable query API reports unsupported without trying a fallback permission',async()=>{
 for(const permissions of [undefined,null,{}, {query:1}]){const result=await read({environment:{secureContext:true,visibility:'hidden',permissions}});assert.equal(result.loopbackPermission,'unsupported');assert.equal(result.visibility,'hidden');}
});
test('an unsupported permission name rejection stays unknown instead of being reported denied',async()=>{
 for(const error of [new TypeError('secret runtime URL'),{name:'NotSupportedError',message:'secret runtime URL'}]){let queries=0;const result=await read({environment:{secureContext:true,permissions:{query(){queries++;return Promise.reject(error);}}}});assert.equal(result.loopbackPermission,'unsupported');assert.equal(queries,1);assert.doesNotMatch(JSON.stringify(result),/secret/);}
});
test('other query failures report unavailable and never expose exception text or identity',async()=>{
 for(const error of [new Error('private token and owner'),{name:'SecurityError',message:'private token and owner'},{get name(){throw Error('private token');}}]){const result=await read({environment:{secureContext:true,visibility:'unknown',permissions:{query(){throw error;}}}});assert.equal(result.loopbackPermission,'unavailable');assert.doesNotMatch(JSON.stringify(result),/private|token|owner/);assert.deepEqual(Object.keys(result).sort(),['loopbackPermission','secureContext','visibility']);}
});
test('a hanging permissions query has a forced deadline and late completion is discarded',async()=>{
 let resolveQuery,queries=0;const report=await read({timeoutMs:20,environment:{secureContext:true,visibility:'visible',permissions:{query(){queries++;return new Promise(resolve=>{resolveQuery=resolve;});}}}});assert.equal(report.loopbackPermission,'timeout');resolveQuery({state:'granted'});await Promise.resolve();await Promise.resolve();assert.equal(report.loopbackPermission,'timeout');assert.equal(queries,1);
});
test('invalid result states and hostile status getters cannot masquerade as an explicit denial',async()=>{
 for(const value of [null,undefined,{state:'unknown'},{state:1},{permission:'denied'},{get state(){throw Error('private status');}}]){const result=await read({environment:{secureContext:true,permissions:{query(){return value;}}}});assert.equal(result.loopbackPermission,'unavailable');assert.doesNotMatch(JSON.stringify(result),/private/);}
});
test('insecure context and missing document visibility do not trigger a query',async()=>{
 let queries=0;const result=await read({environment:{secureContext:false,permissions:{query(){queries++;return{state:'granted'};}}}});assert.equal(result.secureContext,false);assert.equal(result.visibility,'unknown');assert.equal(result.loopbackPermission,'unavailable');assert.equal(queries,0);
});
test('default browser environment reads only secure context, visibility and permissions API',async()=>{
 const queries=[],getters=[];const browserRead=load({isSecureContext:true,document:{get visibilityState(){getters.push('visibilityState');return'visible';}},navigator:{get permissions(){getters.push('permissions');return{query(value){queries.push(value.name);return Promise.resolve({state:'prompt'});}};},get userAgent(){throw Error('User agent must never be read');}}});
 const report=await browserRead();assert.equal(report.loopbackPermission,'prompt');assert.deepEqual(queries,['loopback-network']);assert.deepEqual(getters,['visibilityState','permissions']);
});
test('throwing environment getters and permissions API getters are contained',async()=>{
 const report=await read({environment:{get secureContext(){throw Error('private context');},get visibility(){throw Error('private document');},get permissions(){throw Error('private permission');}}});assert.deepEqual(JSON.parse(JSON.stringify(report)),{secureContext:false,visibility:'unknown',loopbackPermission:'unavailable'});
 const another=await read({environment:{secureContext:true,permissions:{get query(){throw Error('private method');}}}});assert.equal(another.loopbackPermission,'unavailable');
});
