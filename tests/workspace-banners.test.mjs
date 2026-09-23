import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,deps={},cache=new Map()) {
 if(cache.has(file))return cache.get(file);
 const exports={};cache.set(file,exports);
 const output=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(output,{exports,Response,TextEncoder,TextDecoder,Uint8Array,DataView,process:{env:{NODE_ENV:'development'}},require(name){
  if(name in deps)return deps[name];if(name==='next/server')return {NextResponse:Response};
  if(name.startsWith('@/'))return load(name.slice(2)+'.ts',deps,cache);throw Error(name);
 }});return exports;
}
const png=new Uint8Array([137,80,78,71,13,10,26,10]);
function fixture(file={size:8,bytes:png}) {
 const writes=[],reads=[];
 const deps={'cloudflare:workers':{env:{FILES:{get:async key=>{reads.push(key);return file?{size:file.size,body:new Response(file.bytes).body}:null;}}}},
 '@/app/chatgpt-auth':{getWorkspaceOwnerId:async()=>'owner'},'@/db/queries':{saveSettings:async(owner,payload)=>writes.push({owner,payload})}};
 return {writes,reads,route:load('app/api/settings/route.ts',deps)};
}
function request(input){return new Request('http://localhost/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(input)});}
const settings={topImageEnabled:true,topImageKey:'owner/banner.png'};
test('settings stores verified banners and preserves disabled selection for later use',async()=>{
 const f=fixture();const response=await f.route.PUT(request({...settings,bottomImageEnabled:false,bottomImageKey:'owner/footer.png'}));
 assert.equal(response.status,200);assert.equal(f.writes.length,1);assert.equal(f.writes[0].owner,'owner');assert.deepEqual(f.reads,['owner/banner.png','owner/footer.png']);
 assert.equal(JSON.parse(f.writes[0].payload).bottomImageEnabled,false);
});
test('invalid, foreign, missing and oversized banners never replace saved settings',async()=>{
 for(const key of ['other/private.png','owner/../private','https://example.invalid/image']){const f=fixture();assert.equal((await f.route.PUT(request({...settings,topImageKey:key}))).status,400);assert.equal(f.writes.length,0);assert.equal(f.reads.length,0);}
 for(const file of [null,{size:11*1024*1024,bytes:png},{size:4,bytes:new Uint8Array([1,2,3,4])}]){const f=fixture(file);assert.equal((await f.route.PUT(request(settings))).status,400);assert.equal(f.writes.length,0);}
 const f=fixture();assert.equal((await f.route.PUT(request({...settings,bottomImageEnabled:true,bottomImageKey:settings.topImageKey}))).status,400);assert.equal(f.writes.length,0);
});
test('legacy switches without files stay compatible; oversized settings bodies are rejected',async()=>{
 const f=fixture();assert.equal((await f.route.PUT(request({topImageEnabled:true}))).status,200);assert.equal(f.reads.length,0);
 const response=await f.route.PUT(request({extra:'x'.repeat(40000)}));assert.equal(response.status,413);assert.equal(f.writes.length,1);
});
