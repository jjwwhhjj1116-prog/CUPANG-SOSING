import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import * as parse5 from 'parse5';
import {webcrypto} from 'node:crypto';
import * as productJsonLd from '../extensions/supplier-hub/product-jsonld.mjs';

const sourceUrl='https://detail.1688.com/offer/700000000789.html';
const company={code:'A01526306',name:'유앤채'};
const member=()=>({userId:'synthetic-query-owner',verifiedAccess:true,membership:{id:'synthetic-query-owner',email:'jwhj1116@kakao.com',role:'admin',status:'approved',companyCode:company.code,companyName:company.name}});
const apiBindings=()=>({ALIBABA_PRODUCT_API_ENABLED:'true',ALIBABA_APP_KEY:'12345',ALIBABA_APP_SECRET:'synthetic-secret-never-print',ALIBABA_ACCESS_TOKEN:'synthetic-token-never-print'});
const source=()=>({schemaVersion:1,sourceUrl,offerId:'700000000789',provider:'public-product-jsonld-v1',collectedAt:new Date().toISOString(),title:'합성 상품조회 검수',description:'합성 상품 설명',options:[{sku:'synthetic-sku-789',name:'합성 검정',unitPriceCny:5.3,minimumOrder:2,stock:0,imageIndex:0}],images:[{url:'https://cbu01.alicdn.com/synthetic-789.jpg',role:'main'}]});
function fixture({bindings={},overrides={},realCollectors=false}={}){
  const state={bindings,user:member(),owner:'synthetic-query-owner',calls:[],readOwners:[],onRead:()=>{},jobCompany:company,collect:async()=>source()};
  const cache=new Map();
  const supplied={
    'cloudflare:workers':{env:bindings},
    '@/extensions/supplier-hub/product-jsonld.mjs':productJsonLd,
    '@/app/chatgpt-auth':{getChatGPTUser:async()=>state.user,getWorkspaceOwnerId:async()=>state.owner},
    '@/db/category-profiles':{listCategoryProfiles:async(owner)=>{state.readOwners.push(owner);state.onRead();return[{id:'synthetic-profile-'+owner}];}},
    '@/db/collection-jobs':{findCollectionJob:async(owner,id)=>{state.readOwners.push(owner);state.onRead();return{id,owner_id:owner,context:{company:state.jobCompany}};}},
    ...(!realCollectors?{
      '@/app/public-product-collector':{collectPublicProduct:async(url,options)=>{state.calls.push({kind:'public-page',url});return state.collect(url,options);}},
      '@/app/alibaba-product-collector':{collectAlibabaProduct:async(url,credentials,options)=>{state.calls.push({kind:'alibaba-api',url});return state.collect(url,options,credentials);}},
    }:{}),...overrides,
  };
  function load(file){
    if(cache.has(file))return cache.get(file);
    const exports={};cache.set(file,exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
      exports,URL,URLSearchParams,Request,Response,Headers,Date,TextEncoder,TextDecoder,Uint8Array,AbortController,AbortSignal,setTimeout,clearTimeout,structuredClone,crypto:webcrypto,process:{env:{NODE_ENV:'production'}},fetch:()=>{throw Error('Unexpected external request in synthetic query fixture');},
      require(name){if(Object.hasOwn(supplied,name))return supplied[name];if(name==='parse5')return parse5;if(name.startsWith('@/'))return load(name.slice(2)+'.ts');if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');throw Error('Unsupported dependency '+name);},
    },{filename:file});return exports;
  }
  return {...state,state,service:load('app/product-query.ts'),route:load('app/api/product-query/route.ts'),readRoute:load('app/api/cli-read/route.ts')};
}
const body=()=>({sourceUrl,expectedOwnerId:'synthetic-query-owner',expectedCompany:company});
const request=(value=body(),{origin='https://sourceflow.jjwwhhjj1116.workers.dev',query='',headers={},signal}={})=>new Request('https://sourceflow.jjwwhhjj1116.workers.dev/api/product-query'+query,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(value),signal});

test('category-independent service status distinguishes configured transport from live verification without credentials',async()=>{
  for(const bindings of [{},apiBindings(),{ALIBABA_PRODUCT_API_ENABLED:'true'},{ALIBABA_PRODUCT_API_ENABLED:'wrong'}]){
    const f=fixture({bindings}),response=await f.route.GET(),result=await response.json();
    assert.equal(response.status,200);assert.equal(result.ownerId,'synthetic-query-owner');assert.deepEqual(result.company,company);
    assert.equal(result.service.liveVerified,false);assert.equal(result.service.configured,bindings.ALIBABA_PRODUCT_API_ENABLED==='true'?!!bindings.ALIBABA_APP_KEY:bindings.ALIBABA_PRODUCT_API_ENABLED===undefined);
    assert.doesNotMatch(JSON.stringify(result),/synthetic-secret|synthetic-token|12345|ALIBABA_/);
    assert.equal(f.state.calls.length,0);
  }
});

test('URL query canonicalizes exact offer and returns original SKU facts before category without storing product or source',async()=>{
  const f=fixture(),input=body();input.sourceUrl=sourceUrl+'?spm=synthetic';
  const response=await f.route.POST(request(input)),result=await response.json();
  assert.equal(response.status,200);assert.equal(result.offerId,'700000000789');assert.equal(result.sourceStored,false);assert.equal(result.draftCreated,false);
  assert.equal(result.source.options[0].unitPriceCny,5.3);assert.equal(result.source.options[0].stock,0);assert.equal(result.source.options[0].minimumOrder,2);
  assert.deepEqual(f.state.calls,[{kind:'public-page',url:sourceUrl}]);
});

test('configured official provider performs signed query and strict normalization with synthetic response',async()=>{
  const f=fixture({bindings:apiBindings(),realCollectors:true});let calls=0;
  const result=await f.service.queryProductSource(sourceUrl,apiBindings(),{fetcher:async(url,options)=>{
    calls++;assert.equal(new URL(url).hostname,'gw.open.1688.com');assert.equal(options.redirect,'manual');
    return Response.json({result:{success:true,result:{offerId:'700000000789',subject:'合成原文商品',minOrderQuantity:'2',description:'<p>合成详情</p>',productImage:{images:['https://cbu01.alicdn.com/synthetic-789.jpg']},productSkuInfos:[{skuId:'789001',price:'5.30',amountOnSale:'0',skuAttributes:[{attributeName:'颜色',value:'合成黑色'}]}]}}});
  }});
  assert.equal(calls,1);assert.equal(result.provider,'alibaba-api');assert.equal(result.source.options[0].sku,'789001');assert.equal(result.source.options[0].unitPriceCny,5.3);assert.equal(result.source.options[0].stock,0);assert.equal(result.source.options[0].color,'合成黑色');assert.equal(result.sourceStored,false);
});

test('provider failure never switches provider or leaks signed URL and credentials',async()=>{
  const f=fixture({bindings:apiBindings()});f.state.collect=async()=>{throw Error('https://gw.open.1688.com/?access_token=synthetic-token-never-print&secret=synthetic-secret-never-print');};
  const response=await f.route.POST(request()),result=await response.json();assert.equal(response.status,422);assert.equal(result.code,'SOURCE_PROVIDER_FAILED');assert.doesNotMatch(JSON.stringify(result),/access_token|synthetic-token|synthetic-secret|gw\.open/);assert.equal(f.state.calls.length,1);assert.equal(f.state.calls[0].kind,'alibaba-api');
});

test('invalid provider configuration and invalid target cannot start any source request',async()=>{
  const unconfigured=fixture({bindings:{ALIBABA_PRODUCT_API_ENABLED:'true'}});
  assert.equal((await unconfigured.route.POST(request())).status,503);assert.equal(unconfigured.state.calls.length,0);
  for(const url of ['http://127.0.0.1/private','https://detail.1688.com.evil.test/offer/700000000789.html','https://detail.1688.com/offer/no.html','https://user:password@detail.1688.com/offer/700000000789.html']){
    const f=fixture();assert.equal((await f.route.POST(request({...body(),sourceUrl:url}))).status,400);assert.equal(f.state.calls.length,0);
  }
});

test('missing authentication, wrong owner/company and cross-site origin cannot request a source',async()=>{
  for(const mutate of [f=>f.state.user=null,f=>f.state.owner='different-owner',f=>f.state.user.membership.companyCode='wrong']){
    const f=fixture();mutate(f);assert.equal((await f.route.GET()).status,401);assert.equal((await f.route.POST(request())).status,401);assert.equal(f.state.calls.length,0);
  }
  for(const options of [{origin:'https://evil.test'},{query:'?provider=public-page'},{headers:{'sec-fetch-site':'cross-site'}}]){
    const f=fixture();assert.equal((await f.route.POST(request(body(),options))).status,403);assert.equal(f.state.calls.length,0);
  }
  for(const input of [{...body(),expectedOwnerId:'other'},{...body(),expectedCompany:{code:'A01464742',name:'와이홉'}},{...body(),expectedCompany:{...company,token:'no'}},{...body(),provider:'public-page'}]){
    const f=fixture();assert.ok([400,409].includes((await f.route.POST(request(input))).status));assert.equal(f.state.calls.length,0);
  }
});

test('logout or owner/company change during a query withholds the result',async()=>{
  for(const change of [f=>f.state.user=null,f=>{f.state.owner='other';},f=>{f.state.user={userId:'other',verifiedAccess:true,membership:{id:'other',email:'unari8484@gmail.com',role:'member',status:'approved',companyCode:'A01464742',companyName:'와이홉'}};f.state.owner='other';}]){
    const f=fixture();f.state.collect=async()=>{change(f);return source();};const response=await f.route.POST(request()),result=await response.json();assert.equal(response.status,409);assert.equal(result.code,'QUERY_SCOPE_CHANGED');assert.equal(result.source,undefined);
  }
});

test('wrong offer, invalid SKU facts and oversized source do not become query success',async()=>{
  for(const mutate of [s=>s.offerId='700000000790',s=>s.options[0].unitPriceCny=0,s=>s.images[0].url='https://evil.test/a.jpg',s=>s.options[0].stock=-1,s=>s.description='x'.repeat(20001)]){
    const f=fixture();f.state.collect=async()=>{const value=source();mutate(value);return value;};const response=await f.route.POST(request());assert.equal(response.status,422);assert.equal((await response.json()).code,'SOURCE_RESULT_INVALID');
  }
});

test('cancellation before and during query does not return source or create any write',async()=>{
  for(const during of [false,true]){
    const f=fixture(),controller=new AbortController();if(during)f.state.collect=async()=>{controller.abort();return source();};else controller.abort();
    const response=await f.route.POST(request(body(),{signal:controller.signal}));assert.equal(response.status,409);assert.equal((await response.json()).code,'SOURCE_QUERY_CANCELLED');assert.equal(f.state.calls.length,during?1:0);
  }
});

const cliRead=(query='resource=category-profiles',expected={ownerId:'synthetic-query-owner',company})=>new Request('https://sourceflow.jjwwhhjj1116.workers.dev/api/cli-read?'+query,{headers:{'x-yoofam-cli-scope':encodeURIComponent(JSON.stringify(expected))}});
test('CLI reads explicitly bind database ownership and return scope proof for both resource types',async()=>{
  const f=fixture(),response=await f.readRoute.GET(cliRead()),result=await response.json();
  assert.equal(response.status,200);assert.equal(result.ownerId,'synthetic-query-owner');assert.deepEqual(result.company,company);assert.equal(result.profiles[0].id,'synthetic-profile-synthetic-query-owner');
  const id='00000789-0000-4000-8000-000000000001',jobResponse=await f.readRoute.GET(cliRead('resource=collection-job&jobId='+id)),jobResult=await jobResponse.json();
  assert.equal(jobResponse.status,200);assert.equal(jobResult.job.id,id);assert.equal(jobResult.job.owner_id,'synthetic-query-owner');assert.deepEqual(f.state.readOwners,['synthetic-query-owner','synthetic-query-owner']);
});

test('a transient ambient account change cannot switch the owner selected for a CLI database read',async()=>{
  const f=fixture();f.state.onRead=()=>{f.state.owner='temporary-other-owner';f.state.user={userId:'temporary-other-owner',verifiedAccess:true,membership:{id:'temporary-other-owner',email:'unari8484@gmail.com',role:'member',status:'approved',companyCode:'A01464742',companyName:'와이홉'}};f.state.user=member();f.state.owner='synthetic-query-owner';};
  const response=await f.readRoute.GET(cliRead()),result=await response.json();
  assert.equal(response.status,200);assert.deepEqual(f.state.readOwners,['synthetic-query-owner']);assert.equal(result.profiles[0].id,'synthetic-profile-synthetic-query-owner');assert.equal(result.ownerId,'synthetic-query-owner');
});

test('CLI reads reject foreign scope, invalid routes and changed authentication without returning data',async()=>{
  for(const query of ['resource=category-profiles&resource=category-profiles','resource=category-profiles&after=private','resource=collection-job&jobId=bad','resource=arbitrary']){
    const f=fixture();assert.equal((await f.readRoute.GET(cliRead(query))).status,400);assert.equal(f.state.readOwners.length,0);
  }
  const wrong=fixture();assert.equal((await wrong.readRoute.GET(cliRead('resource=category-profiles',{ownerId:'other',company}))).status,409);assert.equal(wrong.state.readOwners.length,0);
  const changed=fixture();changed.state.onRead=()=>{changed.state.user=null;};const response=await changed.readRoute.GET(cliRead());assert.equal(response.status,409);assert.equal((await response.json()).profiles,undefined);
  const invalid=fixture();assert.equal((await invalid.readRoute.GET(new Request('https://app.test/api/cli-read?resource=category-profiles'))).status,400);
  const mismatched=fixture();mismatched.state.jobCompany={code:'A01464742',name:'와이홉'};assert.equal((await mismatched.readRoute.GET(cliRead('resource=collection-job&jobId=00000789-0000-4000-8000-000000000001'))).status,409);
});
