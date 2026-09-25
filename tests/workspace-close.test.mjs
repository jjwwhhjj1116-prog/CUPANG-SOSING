import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/workspace-close.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const root=(flags)=>({querySelector:selector=>flags[selector.includes('saving')?'busy':'dirty']?{}:null});
test('unsaved workspace closes only after discard; completed saves do not prompt',()=>{
 const flags={busy:false,dirty:true};let prompts=0;
 assert.equal(exports.requestWorkspaceClose(root(flags),()=>{prompts++;return false;}),'cancel');
 assert.equal(exports.requestWorkspaceClose(root(flags),()=>{prompts++;return true;}),'close');
 flags.dirty=false;assert.equal(exports.requestWorkspaceClose(root(flags),()=>{throw Error('unexpected prompt');}),'close');assert.equal(prompts,2);
});
test('in-flight writes block close even if discard would be approved; retry reads current state',()=>{
 const flags={busy:true,dirty:true};const element=root(flags);
 assert.equal(exports.requestWorkspaceClose(element,()=>{throw Error('must not discard during write');}),'busy');
 flags.busy=false;assert.equal(exports.requestWorkspaceClose(element,()=>false),'cancel');
 flags.dirty=false;assert.equal(exports.requestWorkspaceClose(element,()=>false),'close');
});
test('closed workspace has no pending state',()=>{assert.equal(exports.requestWorkspaceClose(null,()=>{throw Error('unexpected prompt');}),'close');});
