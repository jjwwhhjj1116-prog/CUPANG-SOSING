import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';

function load(get) {
  const source=ts.transpileModule(fs.readFileSync(new URL('../app/exports/attachments.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  vm.runInNewContext(source,{exports,Uint8Array,crypto:webcrypto,require(name){
    if(name==='cloudflare:workers')return{env:{FILES:{get}}};
    if(name==='@/app/image-files')return{PRODUCT_IMAGE_POOL_LIMIT:200,isOwnedImageKey:(owner,key)=>typeof key==='string'&&key.startsWith(owner+'/')};
    if(name==='@/app/exports/review-bundle')return{imageExtension:data=>{if(data[0]!==137)throw Error('image');return'png';}};
    throw Error(name);
  }});
  return exports;
}
const object=(value=1,size=2)=>({size,arrayBuffer:async()=>new Uint8Array([137,value]).buffer});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};

test('native attachment reads overlap at most three and preserve key/name order despite reversed completion',async()=>{
  const gates=Array.from({length:5},deferred),started=[];let active=0,peak=0;
  const api=load(async key=>{const index=Number(key.split('/')[1]);started.push(index);peak=Math.max(peak,++active);await gates[index].promise;active--;return object(index);});
  const keys=gates.map((_,i)=>'owner/'+i),pending=api.loadAttachments('owner',JSON.stringify(keys),keys,{concurrency:3});
  assert.deepEqual(started,[0,1,2]);
  gates[2].resolve();gates[1].resolve();gates[0].resolve();
  while(started.length<5)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(peak,3);gates[4].resolve();gates[3].resolve();
  const assets=await pending;
  assert.deepEqual(Array.from(assets,file=>file.key),keys);
  assert.deepEqual(Array.from(assets,file=>file.name),keys.map((_,i)=>`assets/image-${String(i+1).padStart(3,'0')}.png`));
  assert.equal(new Set(assets.map(file=>file.sha256)).size,5);
});

test('legacy callers retain one active attachment read and duplicate keys are read once',async()=>{
  let active=0,peak=0;const requested=[];
  const api=load(async key=>{requested.push(key);peak=Math.max(peak,++active);await new Promise(resolve=>setImmediate(resolve));active--;return object();});
  const assets=await api.loadAttachments('owner','["owner/a","owner/b"]',['owner/a','owner/b','owner/a']);
  assert.equal(peak,1);assert.equal(assets.length,2);assert.deepEqual(requested,['owner/a','owner/b']);
});

test('ownership is checked for every requested key before starting any parallel storage read',async()=>{
  let reads=0;const api=load(async()=>{reads++;return object();});
  await assert.rejects(api.loadAttachments('owner','["owner/a","other/b"]',['owner/a','other/b'],{concurrency:3}),error=>error.status===409);
  assert.equal(reads,0);
});

test('aggregate 20MB limit is reserved before opening any body in an oversized batch',async()=>{
  let bodies=0;const api=load(async()=>({size:8*1024*1024,arrayBuffer:async()=>{bodies++;return new Uint8Array([137,1]).buffer;}}));
  await assert.rejects(api.loadAttachments('owner','["owner/a","owner/b","owner/c"]',['owner/a','owner/b','owner/c'],{concurrency:3}),error=>error.status===413);
  assert.equal(bodies,0);
});

test('failed reads settle their batch and do not start later files or return partial attachments',async()=>{
  const gate=deferred(),started=[];let settled=false;
  const api=load(async key=>{started.push(key);if(key==='owner/a')throw Error('storage failed');await gate.promise;settled=true;return object();});
  const keys=['owner/a','owner/b','owner/c','owner/d'],pending=api.loadAttachments('owner',JSON.stringify(keys),keys,{concurrency:3});
  gate.resolve();await assert.rejects(pending,/storage failed/);
  assert.equal(settled,true);assert.deepEqual(started,keys.slice(0,3));
});

test('missing and unsupported files remain blocking errors during concurrent reads',async()=>{
  const keys=['owner/a','owner/b'];
  const missing=load(async key=>key==='owner/b'?null:object());
  await assert.rejects(missing.loadAttachments('owner',JSON.stringify(keys),keys,{concurrency:3}),error=>error.status===409);
  const invalid=load(async key=>key==='owner/b'?{size:1,arrayBuffer:async()=>new Uint8Array([0]).buffer}:object());
  await assert.rejects(invalid.loadAttachments('owner',JSON.stringify(keys),keys,{concurrency:3}),error=>error.status===400);
});
