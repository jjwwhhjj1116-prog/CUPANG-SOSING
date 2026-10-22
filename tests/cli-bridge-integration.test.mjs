import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';
import {APP_ORIGIN,createCliServer} from '../cli/server.mjs';

const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/cli-bridge-client.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,URLSearchParams,Request,Response,Headers,TextEncoder,TextDecoder,Uint8Array,AbortController,Date,setTimeout,clearTimeout,setInterval,clearInterval,fetch(){throw Error('Unexpected external request');}});
const {createCliBridge,parseCliLink}=exports;
const scopes=[{ownerId:'synthetic-789-a',company:{code:'A01526306',name:'유앤채'}},{ownerId:'synthetic-789-b',company:{code:'A01464742',name:'와이홉'}}];
const sourceUrl='https://detail.1688.com/offer/700000000789.html';
const plain=x=>JSON.parse(JSON.stringify(x));

async function setup(t,initialScope){
  const server=createCliServer({port:0,jobTimeoutMs:3000});const connection=await server.listen();
  const calls=[],events=[];let scope=plain(initialScope),approved=false;
  const source={schemaVersion:1,sourceUrl,offerId:'700000000789',provider:'synthetic-integration-only',collectedAt:new Date().toISOString(),title:'합성 CLI 상품조회 검수',description:'외부 요청 없는 합성 원문',options:[{sku:'synthetic-789-sku',name:'합성 검정',unitPriceCny:5.3,minimumOrder:2,stock:0}],images:[{url:'https://cbu01.alicdn.com/synthetic-cli-789.jpg',role:'main'}]};
  const fetcher=async(input,init={})=>{
    if(input.startsWith('http://127.0.0.1:')){
      assert.equal(new URL(input).origin,'http://127.0.0.1:'+connection.port);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'manual');
      assert.equal(new Headers(init.headers).get('cookie'),null);
      calls.push({local:new URL(input).pathname});
      return fetch(input,{...init,headers:{...init.headers,origin:APP_ORIGIN}});
    }
    assert.ok(input.startsWith('/api/'));assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'manual');
    assert.equal(new Headers(init.headers).get('authorization'),null);
    calls.push({app:input,method:init.method??'GET'});
    if(input==='/api/supplier-hub/catalog-context')return Response.json(scope);
    if(input==='/api/product-query'&&init.method==='POST'){
      const body=JSON.parse(init.body);assert.deepEqual(body,{sourceUrl,expectedOwnerId:scope.ownerId,expectedCompany:scope.company});
      return Response.json({...scope,offerId:source.offerId,source,provider:'public-page',sourceStored:false,draftCreated:false});
    }
    if(input==='/api/product-query')return Response.json({...scope,service:{format:'yoofam-product-query-service-v1',provider:'public-page',configured:true,liveVerified:false,queryPath:'/api/product-query'}});
    if(input==='/api/cli-read?resource=category-profiles'){assert.deepEqual(JSON.parse(decodeURIComponent(new Headers(init.headers).get('x-yoofam-cli-scope'))),scope);return Response.json({...scope,profiles:[{id:'synthetic-profile-789',company:scope.company}],nextCursor:null});}
    if(input.startsWith('/api/cli-read?resource=collection-job&jobId=')){assert.deepEqual(JSON.parse(decodeURIComponent(new Headers(init.headers).get('x-yoofam-cli-scope'))),scope);return Response.json({...scope,job:{id:new URL(input,APP_ORIGIN).searchParams.get('jobId'),owner_id:scope.ownerId,status:'awaiting_connector'}});}
    throw Error('No arbitrary API route may be requested: '+input);
  };
  const bridge=createCliBridge({link:parseCliLink(new URL(connection.connectUrl).hash),scope,queryApproved:()=>approved,fetcher,onState:value=>events.push(plain(value)),contextIntervalMs:60000});
  t.after(async()=>{await bridge.disconnect();await server.close();});
  return{server,connection,bridge,calls,events,approve:value=>{approved=value;},scope:value=>{scope=plain(value);}};
}

for(const scope of scopes)test('actual CLI and browser bridge interoperate for all four tools in '+scope.company.name,async t=>{
  const f=await setup(t,scope);await f.bridge.start();assert.equal(f.server.getState().connected,true);assert.equal(f.events.at(-1).phase,'connected');
  const status=await f.server.enqueue('status',{});assert.equal(status.service.liveVerified,false);assert.equal(status.ownerId,scope.ownerId);
  const categories=await f.server.enqueue('category-profiles/list',{});assert.equal(categories.profiles.length,1);assert.deepEqual(categories.profiles[0].company,scope.company);
  const jobId=randomUUID(),job=await f.server.enqueue('collection-job/status',{jobId});assert.equal(job.job.id,jobId);assert.equal(job.job.owner_id,scope.ownerId);
  const before=f.calls.filter(row=>row.app==='/api/product-query'&&row.method==='POST').length;
  await assert.rejects(f.server.enqueue('product-query',{sourceUrl}),{code:'QUERY_NOT_APPROVED'});assert.equal(f.calls.filter(row=>row.app==='/api/product-query'&&row.method==='POST').length,before);
  f.approve(true);const queried=await f.server.enqueue('product-query',{sourceUrl:sourceUrl+'?spm=synthetic'});
  assert.equal(queried.source.options[0].unitPriceCny,5.3);assert.equal(queried.sourceStored,false);assert.equal(queried.draftCreated,false);assert.equal(queried.ownerId,scope.ownerId);
  assert.equal(f.calls.filter(row=>row.app==='/api/product-query'&&row.method==='POST').length,before+1);assert.equal(f.server.getState().pendingCount,0);
  assert.ok(f.calls.some(row=>row.local==='/pair'));assert.ok(f.calls.filter(row=>row.local==='/result').length>=5);
});

test('actual bridge tears down after account change and does not execute a source query',async t=>{
  const f=await setup(t,scopes[0]);await f.bridge.start();f.scope(scopes[1]);
  const pending=f.server.enqueue('status',{});await assert.rejects(pending);
  assert.equal(f.calls.filter(row=>row.app==='/api/product-query').length,0);
  assert.equal(f.events.at(-1).phase,'stopped');
});
