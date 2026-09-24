import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,deps={},mode='development') {const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,TextEncoder,TextDecoder,Uint8Array,DataView,Response,process:{env:{NODE_ENV:mode}},require(name){if(name in deps)return deps[name];if(name==='next/server')return {NextResponse:Response};if(name.startsWith('@/app/'))return load(name.slice(2)+'.ts',deps,mode);throw Error(name);}});return exports;}
const context={params:Promise.resolve({id:'job'})};
function route({linked=false,cancelled=false,missing=false,mode='development'}={}){
 const reads=[];const track=(name,value)=>async(...args)=>{reads.push([name,...args]);return value;};
 const deps={
 '@/app/chatgpt-auth':{getChatGPTUser:async()=>null,getWorkspaceOwnerId:async()=>'owner'},
 '@/db/collection-jobs':{findCollectionJob:track('job',missing?null:{status:cancelled?'cancelled':'awaiting_connector',context:{settings:{topImageEnabled:true,topImageKey:'owner/top.png',bottomImageEnabled:true,bottomImageKey:'owner/bottom.png'}}})},
 '@/db/collection-results':{readCollectionResult:track('result',{result:{images:Array(49).fill({})}})},
 '@/db/collection-products':{findCollectionProduct:track('link',linked?{product_id:'product'}:null)},
 '@/db/collection-images':{listCollectionImageIndices:track('images',[0,1]),listDisconnectedCollectionImageIndices:track('detached',[3])},
 '@/db/queries':{findProduct:track('product',{image_keys:JSON.stringify(['owner/a','owner/b','owner/c'])})}
 };
 return {reads,...load('app/api/collection-jobs/[id]/capacity/route.ts',deps,mode)};
}
test('capacity reserves captured banners before promotion and reads actual files for an existing product',async()=>{
 const fresh=route();const response=await fresh.GET(null,context);assert.equal(response.status,200);assert.deepEqual((await response.json()).capacity,{usedSlots:2,totalImages:49,reusableIndices:[],blockedIndices:[]});
 const existing=route({linked:true});const state=await (await existing.GET(null,context)).json();assert.deepEqual(state.capacity,{usedSlots:3,totalImages:49,reusableIndices:[0,1],blockedIndices:[3]});
 assert.deepEqual(existing.reads.find(([name])=>name==='images'),['images','owner','job','product']);
 assert.ok(existing.reads.every(([,owner])=>owner==='owner'));
});
test('unauthenticated, missing and cancelled requests do not expose capacity',async()=>{
 for(const [options,status] of [[{mode:'production'},503],[{missing:true},404],[{cancelled:true},409]]){
  const r=route(options);assert.equal((await r.GET(null,context)).status,status);if(options.mode)assert.equal(r.reads.length,0);
 }
});

test('image recommendations prioritize main and option images within actual remaining capacity',()=>{
 const {recommendCollectionImages:recommend,collectionSelectionFits:fits}=load('app/collection-capacity.ts');
 const source={images:Array.from({length:200},(_,i)=>({role:i===150?'main':i===100?'additional':'detail'})),options:[{imageIndex:180},{imageIndex:180},{imageIndex:199}]};
 const cap={usedSlots:47,totalImages:200,reusableIndices:[0,120],blockedIndices:[199]};
 const before=JSON.stringify({source,cap});const selected=Array.from(recommend(source,cap));
 assert.deepEqual(selected,[0,100,120,150,180]);assert.equal(fits(cap,selected),true);assert.equal(JSON.stringify({source,cap}),before);
 const empty=Array.from(recommend(source,{...cap,usedSlots:50,reusableIndices:[]}));assert.deepEqual(empty,[]);
 assert.deepEqual(Array.from(recommend(source,{...cap,usedSlots:50})),[0,120]);
 const many=Array.from(recommend(source,{...cap,usedSlots:0,reusableIndices:[],blockedIndices:[]}));
 assert.equal(many.length,50);assert.ok(many.includes(150)&&many.includes(180)&&many.includes(199)&&many.includes(100));
 assert.equal(new Set(many).size,50);assert.deepEqual(many,[...many].sort((a,b)=>a-b));
 assert.throws(()=>recommend(source,{...cap,totalImages:199}),/확인/);
 assert.deepEqual(Array.from(recommend({images:[],options:[]},{usedSlots:50,totalImages:0,reusableIndices:[]})),[]);
});
