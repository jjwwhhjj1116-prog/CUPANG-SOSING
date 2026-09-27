import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/load-category-profiles.ts', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {exports,Error,fetch});
const load = exports.loadCategoryProfiles;
test('loads settings after the first 100 without dropping any category', async()=>{
  const calls=[];
  const result=await load(undefined,async url=>{calls.push(url);return Response.json(calls.length===1?{profiles:Array.from({length:100},(_,i)=>({id:String(i).padStart(3,'0')})),nextCursor:'099'}:{profiles:[{id:'100',categoryId:'80719'}],nextCursor:null});});
  assert.equal(result.length,101);assert.equal(result[100].categoryId,'80719');
  assert.deepEqual(calls,['/api/category-profiles','/api/category-profiles?after=099']);
});
test('later failure never returns a truncated list, invalid cursors cannot loop',async()=>{
  let count=0;
  await assert.rejects(load(undefined,async()=>++count===1?Response.json({profiles:[{id:'a'}],nextCursor:'a'}):Response.json({error:'retry'},{status:503})),/retry/);
  for(const nextCursor of ['', '../foreign','b',12]) await assert.rejects(load(undefined,async()=>Response.json({profiles:[{id:'a'}],nextCursor})),/위치/);
  count=0;
  await assert.rejects(load(undefined,async()=>Response.json(++count===1?{profiles:[{id:'a'}],nextCursor:'a'}:{profiles:[{id:'a'}],nextCursor:null})),/변경/);
});
test('abort stops before the next page and a legacy single page remains compatible',async()=>{
  const controller=new AbortController();let calls=0;
  await assert.rejects(load(controller.signal,async()=>{calls++;controller.abort();return Response.json({profiles:[{id:'a'}],nextCursor:'a'});}),{name:'AbortError'});
  assert.equal(calls,1);
  assert.equal((await load(undefined,async()=>Response.json({profiles:[{id:'legacy'}]})))[0].id,'legacy');
});
