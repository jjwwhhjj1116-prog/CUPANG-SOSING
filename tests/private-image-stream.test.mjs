import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture({user={userId:'owner',verifiedAccess:true},mode='production',native=false,object}={}){
 const cache=new Map(),counts={auth:0,reads:0};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {exports,Error,URL,Headers,Request,Response,ReadableStream,TextEncoder,TextDecoder,Uint8Array,DataView,crypto,process:{env:{NODE_ENV:mode}},require(name){
    if(name==='@/app/chatgpt-auth')return {getChatGPTUser:async()=>{counts.auth++;return user;},getWorkspaceOwnerId:()=>{throw Error('Duplicate identity lookup');}};
    if(name==='cloudflare:workers')return {env:{YOOFAM_AUTH_ENABLED:native?'true':'false',FILES:{get:async()=>{counts.reads++;return object;}}}};
    assert.ok(name.startsWith('@/'));return load(name.slice(2)+'.ts');
   }});return exports;
 }
 return {counts,load,get:(key='owner/image.png')=>load('app/api/files/[...key]/route.ts').GET(new Request('https://studio.test/api/files/'+key),{params:Promise.resolve({key:key.split('/')})})};
}
function source(chunks){let index=0,reads=0,cancelled=false;return {stream:new ReadableStream({pull(controller){reads++;if(index===chunks.length)controller.close();else controller.enqueue(chunks[index++]);},cancel(){cancelled=true;}},{highWaterMark:0}),get reads(){return reads;},get cancelled(){return cancelled;}};}
const png=[137,80,78,71,13,10,26,10];

test('private image GET returns after the signature prefix, authenticates once and forwards original chunks without a whole-image copy',async()=>{
 const bytes=new Uint8Array(8*1024*1024);bytes.set(png);bytes[bytes.length-1]=73;
 const chunks=Array.from({length:128},(_,i)=>bytes.subarray(i*65536,(i+1)*65536)),input=source(chunks),f=fixture({object:{size:bytes.length,body:input.stream}});
 const response=await f.get();assert.equal(response.status,200);assert.equal(f.counts.auth,1);assert.equal(f.counts.reads,1);assert.equal(input.reads,1,'GET must not drain the image before returning');
 assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('content-length'),String(bytes.length));
 assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-security-policy'),/sandbox/);
 const reader=response.body.getReader();let total=0,index=0;
 for(;;){const part=await reader.read();if(part.done)break;assert.equal(part.value,chunks[index++],'forward each source chunk without a full-file clone');total+=part.value.length;}
 assert.equal(total,bytes.length);assert.equal(index,chunks.length);assert.equal(input.reads,chunks.length+1);
});

test('split signatures retain all supported actual formats and active formats remain downloadable attachments',async()=>{
 const avif=new Uint8Array(1024);new DataView(avif.buffer).setUint32(0,1024);avif.set(new TextEncoder().encode('ftypmif1'),4);avif.set(new TextEncoder().encode('avif'),1020);
 for(const [bytes,type,disposition]of [
  [new Uint8Array(png),'image/png','inline'],[new Uint8Array([255,216,255,1]),'image/jpeg','inline'],
  [new TextEncoder().encode('RIFF0000WEBPrest'),'image/webp','inline'],[new TextEncoder().encode('GIF89arest'),'image/gif','inline'],
  [avif,'image/avif','inline'],[new TextEncoder().encode('<svg onload="bad"></svg>'),'application/octet-stream','attachment'],
 ]){
  const input=source([...bytes].map(value=>new Uint8Array([value]))),response=await fixture({object:{size:bytes.length,body:input.stream,httpMetadata:{contentType:'text/html'}}}).get();
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),type);assert.ok(response.headers.get('content-disposition').startsWith(disposition+';'));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
 }
});

test('authentication and owned-key fences precede any storage read in production and native development',async()=>{
 for(const input of [{user:null},{user:{userId:'owner'}},{user:null,mode:'development',native:true},{user:{userId:'owner'},mode:'development',native:true}]){
  const f=fixture(input);assert.equal((await f.get()).status,503);assert.equal(f.counts.auth,1);assert.equal(f.counts.reads,0);
 }
 for(const key of ['other/image.png','owner/nested/file.png','owner/../file.png','owner2/image.png']){
  const f=fixture();assert.equal((await f.get(key)).status,403);assert.equal(f.counts.reads,0);
 }
 const hidden=fixture();assert.equal((await hidden.get('owner/free-image-private.png.edit.json')).status,404);assert.equal(hidden.counts.reads,0);
 const local=fixture({user:null,mode:'development'});assert.equal((await local.get('local-demo/image.png')).status,404);assert.equal(local.counts.auth,1);
});

test('actual excess and truncated storage streams fail rather than complete or forward bytes past the limit',async()=>{
 const helper=fixture().load('app/private-image-stream.ts');
 for(const chunks of [[new Uint8Array(1024),new Uint8Array(3073)],[new Uint8Array(1024)]]){
  const input=source(chunks),result=await helper.privateImageStream(input.stream,4096,4096),reader=result.body.getReader();
  assert.equal((await reader.read()).value.byteLength,1024);
  await assert.rejects(()=>reader.read(),/Image exceeds|Image storage length changed/);
  if(chunks.length>1)assert.equal(input.cancelled,true); // A truncated source already closed itself.
 }
 const early=source([new Uint8Array(4097)]);await assert.rejects(()=>helper.privateImageStream(early.stream,4096,4096),error=>error.status===413);assert.equal(early.cancelled,true);
 const response=await fixture({object:{size:10*1024*1024+1}}).get();assert.equal(response.status,413);
});

test('client cancellation propagates to the private object without draining the remaining bytes',async()=>{
 const input=source([new Uint8Array([...png,...new Uint8Array(2040)]),new Uint8Array(2048)]),response=await fixture({object:{size:4096,body:input.stream}}).get();
 assert.equal(response.status,200);const reader=response.body.getReader();await reader.read();await reader.cancel('closed image');
 assert.equal(input.cancelled,true);assert.ok(input.reads<=2);
});
