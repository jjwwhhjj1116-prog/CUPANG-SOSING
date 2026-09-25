import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function api({verified=true,product=true,captured=null,fail=false}={}) {
 const calls=[];
 const deps={
 'next/server':{NextResponse:Response},
 '@/app/chatgpt-auth':{getChatGPTUser:async()=>({verifiedAccess:verified}),getWorkspaceOwnerId:async()=> 'owner'},
 '@/db/queries':{findProduct:async(owner,id)=>{calls.push(['product',owner,id]);return product?{id,source_url:'https://detail.1688.com/offer/813724060928.html'}:null;},getSettings:async()=>({payload:JSON.stringify({manufacturer:'현재 제조사',importer:'현재 수입원',serviceContact:'현재 연락처'})})},
 '@/db/quotation-fields':{readQuotationCollectionSource:async(...args)=>{calls.push(['source',...args]);if(fail)throw Error('unavailable');return captured;}},
 };
 function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,TextEncoder,process:{env:{NODE_ENV:'production'}},require(name){return deps[name]??load(name.replace('@/','')+'.ts');}});return exports;}
 return {calls,get:()=>load('app/api/products/[id]/registration-settings/route.ts').GET(new Request('https://example.test'),{params:Promise.resolve({id:'p'})})};
}
test('product label settings prefer the linked snapshot including explicit blanks',async()=>{
 const h=api({captured:{linked:true,payload:JSON.stringify({settings:{manufacturer:'등록 당시 제조사',importer:'',serviceContact:'등록 당시 연락처'}})}});
 const response=await h.get(),body=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(body.source,'collection');
 assert.deepEqual(body.settings,{manufacturer:'등록 당시 제조사',importer:'',serviceContact:'등록 당시 연락처'});
 assert.deepEqual(h.calls[1],['source','owner','813724060928','p']);
});
test('unlinked same-URL settings cannot overwrite this product and sparse snapshots retain current missing fields',async()=>{
 for(const linked of [false,true]){
  const h=api({captured:{linked,payload:JSON.stringify({settings:{manufacturer:'당시'}})}}),body=await(await h.get()).json();
  assert.equal(body.settings.manufacturer,linked?'당시':'현재 제조사');assert.equal(body.settings.importer,'현재 수입원');
 }
});
test('authentication, ownership and unavailable source stop before misleading defaults',async()=>{
 const denied=api({verified:false});assert.equal((await denied.get()).status,503);assert.equal(denied.calls.length,0);
 const missing=api({product:false});assert.equal((await missing.get()).status,404);assert.equal(missing.calls.length,1);
 for(const opts of [{fail:true},{captured:{linked:true,payload:'invalid'}}])assert.equal((await api(opts).get()).status,503);
});
