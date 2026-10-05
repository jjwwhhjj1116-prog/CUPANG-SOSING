import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {COMPATIBILITY_DATE} from '../deployment/cloudflare-config.mjs';

// Run separately from npm test: node scripts/check-google-translation-runtime.mjs
// Uses the actual helper in workerd. Every outbound request is intercepted by
// the synthetic service below; no provider, account, database or user text is used.
const successText='合成测试 & + "값" = fixture';
const redirectText='synthetic redirect fixture';
const code=`
import {translateGoogleFree} from './app/automation/google-free-translation.ts';
export default {async fetch(request){
  const text=new URL(request.url).pathname==='/redirect'?${JSON.stringify(redirectText)}:${JSON.stringify(successText)};
  const failures=[];let contract=null;
  const result=await translateGoogleFree(text,{onFailure:value=>failures.push(value),fetcher:(input,init)=>{
    const nativeRequest=new Request(input,init);
    contract={method:nativeRequest.method,redirect:nativeRequest.redirect,cache:nativeRequest.cache,
      accept:nativeRequest.headers.get('accept'),credentials:init.credentials,referrerPolicy:init.referrerPolicy};
    const nativeFetch=fetch;
    return nativeFetch(input,init);
  }});
  return Response.json({result,failures,contract});
}};`;
const bundle=await build({stdin:{contents:code,resolveDir:fileURLToPath(new URL('../',import.meta.url)),sourcefile:'google-runtime-probe.ts',loader:'ts'},
  bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',logLevel:'silent'});
const seen=[];
const runtime=new Miniflare({modules:true,compatibilityDate:COMPATIBILITY_DATE,compatibilityFlags:['nodejs_compat'],script:bundle.outputFiles[0].text,
  outboundService:async request=>{
    const url=new URL(request.url),text=url.searchParams.get('q');
    assert.equal(url.origin,'https://translate.googleapis.com');
    assert.equal(url.pathname,'/translate_a/single');
    assert.equal(request.method,'GET');
    assert.equal(request.headers.get('accept'),'application/json');
    assert.deepEqual([...url.searchParams],Object.entries({client:'gtx',sl:'auto',tl:'ko',dt:'t',q:text}));
    assert.ok(text===successText||text===redirectText,'Only the fixed synthetic texts may leave the worker');
    seen.push(text);
    if(text===redirectText)return new Response(null,{status:308,headers:{location:'https://redirect.invalid/must-not-follow'}});
    return Response.json([[['합성 번역 &amp; &quot;값&quot;','合成测试']],null,'zh-CN']);
  }});
try{
  const expectedContract={method:'GET',redirect:'manual',cache:'no-store',accept:'application/json',credentials:'omit',referrerPolicy:'no-referrer'};
  const success=await (await runtime.dispatchFetch('http://local.test/success')).json();
  assert.deepEqual(success,{result:{translatedText:'합성 번역 & "값"',detectedSourceLanguage:'zh-CN'},failures:[],contract:expectedContract});
  assert.deepEqual(seen,[successText]);
  const redirect=await (await runtime.dispatchFetch('http://local.test/redirect')).json();
  assert.deepEqual(redirect,{result:null,failures:[{reason:'http',status:308}],contract:expectedContract});
  assert.deepEqual(seen,[successText,redirectText],'Redirect must not produce a follow-up request');
  console.log('Google translation workerd check passed: native request options, 200 translation, 308 blocked; 2 synthetic requests, 0 external requests.');
}finally{await runtime.dispose();}
