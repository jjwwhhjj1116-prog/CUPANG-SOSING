import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';

function load(timers={}){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/automation/google-free-translation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,URLSearchParams,AbortController,TextDecoder,setTimeout:timers.setTimeout??setTimeout,clearTimeout:timers.clearTimeout??clearTimeout,fetch:()=>{throw Error('Live requests forbidden');},require:name=>{assert.equal(name,'parse5');return parse5;}});return exports.translateGoogleFree;
}
const translate=load(),plain=value=>JSON.parse(JSON.stringify(value)),payload=(text='번역 상품',language='zh-CN')=>[[[text,'原文',null,null]],null,language];

test('source/target language options match the supplied method without accepting query injection',async()=>{
 for(const [sourceLanguage,targetLanguage,expectedSource,expectedTarget]of [[null,'ko','auto','ko'],['  ','ko','auto','ko'],['en','ko','en','ko'],['zh-CN','en','zh-CN','en']]){
  const result=await translate('source text',{sourceLanguage,targetLanguage,fetcher:async url=>{const parsed=new URL(url);assert.equal(parsed.searchParams.get('sl'),expectedSource);assert.equal(parsed.searchParams.get('tl'),expectedTarget);return Response.json(payload());}});assert.equal(result.translatedText,'번역 상품');
 }
 for(const options of [{sourceLanguage:'en&tl=fr'},{targetLanguage:'ko&q=other'},{targetLanguage:'auto'}])assert.equal(await translate('text',{...options,fetcher:()=>{throw Error('invalid language must not send');}}),null);
});

test('supplied gtx single contract keeps exact text/query, joins segments and decodes entities once as display text',async()=>{
 const original='木纹 & SKU+001 / 蓝色\nq=secret&tl=en',resultBody=[[['나무 &amp; ','木纹'],['&lt;b&gt;파랑&lt;/b&gt; &#x1F600; &quot;A&quot; &amp;lt;','蓝色']],null,'zh-CN'];let calls=0;
 const result=await translate(original,{fetcher:async function(url,init){assert.equal(this,undefined);calls++;const parsed=new URL(url);assert.equal(parsed.origin,'https://translate.googleapis.com');assert.equal(parsed.pathname,'/translate_a/single');assert.deepEqual([...parsed.searchParams],Object.entries({client:'gtx',sl:'auto',tl:'ko',dt:'t',q:original}));assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store');assert.equal(init.signal.aborted,false);return Response.json(resultBody);}});
 assert.deepEqual(plain(result),{translatedText:'나무 & <b>파랑</b> 😀 "A" &lt;',detectedSourceLanguage:'zh-CN'});assert.equal(calls,1);assert.equal(resultBody[0][0][0],'나무 &amp; ');
 assert.equal((await translate('<script>plain</script>',{fetcher:async()=>Response.json(payload('<script>그대로</script>'))})).translatedText,'<script>그대로</script>');
});

test('blank/over-limit input is never truncated or sent; default 5000 and explicit smaller limits preserve exact boundaries',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json(payload());};
 for(const value of ['', ' \n ', 'a'.repeat(5001), null])assert.equal(await translate(value,{fetcher}),null);
 assert.equal(await translate('abcd',{maxCharacters:3,fetcher}),null);assert.equal(calls,0);
 assert.ok(await translate('a'.repeat(5000),{fetcher}));assert.ok(await translate('abc',{maxCharacters:3,fetcher}));
 assert.equal(await translate('a'.repeat(5001),{maxCharacters:10000,fetcher}),null);assert.equal(calls,2);
});

test('bad status, network, JSON, roots and malformed segments return null without retry or partial success',async()=>{
 for(const body of [null,{},[],[[]],[[null]],[[['정상'],null]],[[[123]]],[[{}]],payload(' \n ')]){
  let calls=0;assert.equal(await translate('原文',{fetcher:async()=>{calls++;return Response.json(body);}}),null);assert.equal(calls,1);
 }
 for(const fetcher of [async()=>new Response('private upstream error',{status:429}),async()=>new Response('redirect',{status:302}),async()=>new Response('<html>login</html>'),async()=>{throw Error('private upstream error');}])assert.equal(await translate('原文',{fetcher}),null);
 for(const language of [undefined,null,42,'secret<script>','en_US'])assert.deepEqual(plain(await translate('原文',{fetcher:async()=>Response.json([[['번역']],null,language])})),{translatedText:'번역',detectedSourceLanguage:null});
});

test('streamed UTF-8 is bounded by bytes and overflow cancels reading; declared oversize and invalid UTF-8 are rejected',async()=>{
 let cancelled=0,pulls=0;const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(256*1024));},cancel(){cancelled++;}});
 assert.equal(await translate('原文',{fetcher:async()=>new Response(stream)}),null);assert.equal(cancelled,1);assert.ok(pulls<=4);
 let declaredCancel=0;assert.equal(await translate('原文',{fetcher:async()=>new Response(new ReadableStream({cancel(){declaredCancel++;}}),{headers:{'content-length':String(512*1024+1)}})}),null);assert.equal(declaredCancel,1);
 const encoded=new TextEncoder().encode(JSON.stringify(payload('한글 😀'))),split=new ReadableStream({start(controller){for(const byte of encoded)controller.enqueue(Uint8Array.of(byte));controller.close();}});
 assert.equal((await translate('原文',{fetcher:async()=>new Response(split)})).translatedText,'한글 😀');
 assert.equal(await translate('原文',{fetcher:async()=>new Response(Uint8Array.of(0xff))}),null);
});

test('timeouts default to 10 seconds, clamp to 3–30, and abort a pending fetch without retry',async()=>{
 for(const [timeoutSeconds,expected]of [[undefined,10000],[1,3000],[99,30000],[NaN,10000]]){
  let fire,clears=0,calls=0;const failures=[],fn=load({setTimeout(callback,ms){assert.equal(ms,expected);fire=callback;return 1;},clearTimeout(id){assert.equal(id,1);clears++;}}),promise=fn('原文',{timeoutSeconds,onFailure:failure=>failures.push(plain(failure)),fetcher:async(_url,init)=>{calls++;return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
  fire();assert.equal(await promise,null);assert.equal(calls,1);assert.equal(clears,1);assert.deepEqual(failures,[{reason:'timeout'}]);
 }
});

test('caller cancellation before send and during body reading returns null and cancels the stream',async()=>{
 const failures=[],onFailure=failure=>failures.push(plain(failure));
 const before=new AbortController();before.abort();assert.equal(await translate('原文',{signal:before.signal,onFailure,fetcher:()=>{throw Error('must not send');}}),null);
 const controller=new AbortController();let started,cancelled=0;const ready=new Promise(resolve=>{started=resolve;});
 const promise=translate('原文',{signal:controller.signal,onFailure,fetcher:async()=>new Response(new ReadableStream({pull(){started();},cancel(){cancelled++;}}))});
 await ready;await new Promise(resolve=>setImmediate(resolve));controller.abort();assert.equal(await promise,null);assert.equal(cancelled,1);assert.deepEqual(failures,[]);
});

test('optional diagnostics expose only a fixed reason and HTTP status, once, without changing null returns',async()=>{
 const cases=[
  ['private source',async()=>new Response('private response https://secret.invalid?q=private',{status:429}),{reason:'http',status:429}],
  ['private source',async()=>{throw Error('private source/token');},{reason:'network'}],
  ['private source',async()=>new Response(new ReadableStream({start(controller){controller.error(Error('private stream'));}})),{reason:'network'}],
  ['private source',async()=>new Response('private non-JSON body'),{reason:'invalid-response'}],
  ['private source',async()=>Response.json([[['safe'],null]]),{reason:'invalid-response'}],
  ['private source',async()=>new Response(Uint8Array.of(255)),{reason:'invalid-response'}],
  ['private source',async()=>new Response('x',{headers:{'content-length':String(512*1024+1)}}),{reason:'invalid-response'}],
  ['a'.repeat(5001),()=>{throw Error('must not send oversized input');},{reason:'input-limit'}],
 ];
 for(const [text,fetcher,expected]of cases){const failures=[];assert.equal(await translate(text,{fetcher,onFailure:failure=>failures.push(plain(failure))}),null);assert.deepEqual(failures,[expected]);}
 const failures=[];assert.ok(await translate('text',{fetcher:async()=>Response.json(payload()),onFailure:failure=>failures.push(failure)}));assert.deepEqual(failures,[]);
 assert.equal(await translate('text',{fetcher:async()=>new Response('private',{status:500}),onFailure:()=>{throw Error('diagnostic consumer failed');}}),null);
});

test('transport diagnostics classify only allowlisted causes and never expose private exception text',async()=>{
 const cases=[
  [new TypeError('Unsupported cache mode: private-token'),'request-init'],
  [new TypeError('Illegal invocation private-url'),'invocation'],
  [new Error('Redirect received for https://private.invalid?q=secret'),'redirect'],
  [new Error('Too many subrequests: private-source'),'subrequest-limit'],
  [new Error('Network connection lost https://private.invalid'),'connection'],
  [new TypeError('arbitrary private source/token'),'type-error'],
  [new Error('arbitrary private source/token'),undefined],
 ];
 for(const [error,detail]of cases){const failures=[];assert.equal(await translate('private source',{fetcher:async()=>{throw error;},onFailure:failure=>failures.push(plain(failure))}),null);assert.deepEqual(failures,[{reason:'network',...(detail?{detail}:{})}]);}
});
