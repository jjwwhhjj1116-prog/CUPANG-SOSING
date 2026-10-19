import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const owner='category-owner-a';
const company={code:'A01526306',name:'유앤채'};
const otherCompany={code:'A01464742',name:'와이홉'};
const clone=value=>JSON.parse(JSON.stringify(value));
const envelope=(name='방한 귀달이 모자')=>({source:'supplier-hub-category-predict-api',ownerId:owner,company:{...company},productName:name,observedAt:Date.now(),items:[
 {id:'hat-prediction',code:'900',path:['패션의류잡화','남성패션','귀달이 모자'],label:'패션의류잡화 > 남성패션 > 귀달이 모자'},
]});
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');

function loader(overrides={},globals={}){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file);
  const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
   exports,Response,Request,TextEncoder,TextDecoder,ReadableStream,Uint8Array,AbortController,URL,Date,Error,
   ...globals,
   require:name=>{
    if(Object.hasOwn(overrides,name))return overrides[name];
    const target=name.startsWith('@/')?name.slice(2)+'.ts':null;
    if(['app/request-body.ts','app/supplier-hub-catalog.ts','app/supplier-hub-company.ts'].includes(target))return load(target);
    // The live catalogue's schema/template dependencies are not called by recommendations.
    if(target&&file==='app/supplier-hub-catalog.ts')return {};
    throw Error('Unexpected dependency: '+name);
   },
  },{filename:file});
  return exports;
 }
 return load;
}

function clientFixture({recommendation=envelope(),capability=true,translation,translateStatus=200,branches=[],onExchange,onFetch}={}){
 const calls=[],requests=[];let branchIndex=0;
 const load=loader({'@/app/supplier-hub-handoff':{exchange:async(type,payload,signal)=>{
  calls.push({type,payload:clone(payload),signal});
  await onExchange?.(type,payload,signal);
  signal.throwIfAborted();
  if(type==='PING')return {categoryRecommendations:capability,categoryCatalog:true};
  if(type==='RECOMMEND_CATEGORIES')return {recommendations:clone(recommendation)};
  if(type==='CATEGORIES'){
   const children=branches[branchIndex++];
   assert.ok(children,'Unexpected catalogue traversal');
   return {branch:{source:'supplier-hub-category-api',fullCatalogVerified:false,ownerId:owner,company:{...company},observedAt:Date.now(),trail:clone(payload.trail),children:clone(children)}};
  }
  throw Error('Unexpected extension action: '+type);
 }}},{fetch:async(path,options)=>{
  requests.push({path,options});
  assert.equal(path,'/api/category-recommendation-title');
  assert.equal(options.method,'POST');
  await onFetch?.(path,options);
  return Response.json(translation??{ownerId:owner,company,productName:'冬季保暖护耳帽',queryProductName:'겨울 방한 귀달이 모자'},{status:translateStatus});
 }});
 return {exports:load('app/supplier-hub-category-recommendations.ts'),calls,requests};
}
const branches=()=>[
 [{categoryId:'100',name:'패션의류잡화',isLeaf:false},{categoryId:'101',name:'생활용품',isLeaf:false}],
 [{categoryId:'200',name:'남성패션',isLeaf:false},{categoryId:'201',name:'여성패션',isLeaf:false}],
 [{categoryId:'900',name:'귀달이 모자',isLeaf:true},{categoryId:'901',name:'야구 모자',isLeaf:true}],
];

test('Korean title goes directly to the official recommendation capability and preserves source input',async()=>{
 const h=clientFixture(),source={title:'  방한 귀달이 모자  ',untouched:{price:5.3}},before=clone(source);
 const result=await h.exports.loadSupplierHubCategoryRecommendations(source.title,{workspaceOwnerId:owner,signal:new AbortController().signal});
 assert.deepEqual(h.calls.map(call=>call.type),['PING','RECOMMEND_CATEGORIES']);
 assert.deepEqual(h.calls[1].payload,{productName:'방한 귀달이 모자',expectedOwnerId:owner});
 assert.equal(result.productName,'방한 귀달이 모자');assert.equal(result.queryProductName,undefined);
 assert.deepEqual(source,before);assert.equal(h.requests.length,0);
});

test('Chinese title translates only the search name before the official prediction, retaining its original title',async()=>{
 const translated='겨울 방한 귀달이 모자',h=clientFixture({recommendation:envelope(translated)});
 const result=await h.exports.loadSupplierHubCategoryRecommendations('冬季保暖护耳帽',{workspaceOwnerId:owner,signal:new AbortController().signal});
 assert.equal(h.requests.length,1);
 const request=h.requests[0].options;
 assert.deepEqual(JSON.parse(request.body),{expectedOwnerId:owner,productName:'冬季保暖护耳帽'});
 assert.equal(request.cache,'no-store');assert.equal(request.redirect,'error');
 assert.deepEqual(h.calls.map(call=>call.type),['PING','RECOMMEND_CATEGORIES']);
 assert.equal(h.calls[1].payload.productName,translated);
 assert.equal(result.productName,'冬季保暖护耳帽');assert.equal(result.queryProductName,translated);
});

test('missing capability stops before recommendation and never substitutes a local category',async()=>{
 const h=clientFixture({capability:false});
 await assert.rejects(h.exports.loadSupplierHubCategoryRecommendations('방한 모자',{workspaceOwnerId:owner,signal:new AbortController().signal}),/통합 확장/);
 assert.deepEqual(h.calls.map(call=>call.type),['PING']);assert.equal(h.requests.length,0);
});

test('a failed, foreign-owner or foreign-company translation stops without prediction or fallback',async()=>{
 const original='冬季保暖护耳帽';
 for(const option of [
  {translateStatus:502,translation:{error:'검색명 번역 실패'}},
  {translation:{ownerId:'other-owner',company,productName:original,queryProductName:'방한 모자'}},
  {translation:{ownerId:owner,company:{code:'A00000000',name:'외부회사'},productName:original,queryProductName:'방한 모자'}},
  {translation:{ownerId:owner,company,productName:'다른 상품',queryProductName:'방한 모자'}},
  {translation:{ownerId:owner,company,productName:original,queryProductName:' ' }},
 ]){
  const h=clientFixture(option);
  await assert.rejects(h.exports.loadSupplierHubCategoryRecommendations(original,{workspaceOwnerId:owner,signal:new AbortController().signal}));
  assert.equal(h.calls.length,0);assert.equal(h.requests.length,1);
 }
});

test('company changes between translation and prediction reject the result',async()=>{
 const recommendation={...envelope('겨울 방한 귀달이 모자'),company:otherCompany},h=clientFixture({recommendation});
 await assert.rejects(h.exports.loadSupplierHubCategoryRecommendations('冬季保暖护耳帽',{workspaceOwnerId:owner,signal:new AbortController().signal}),/로그인 회사가 변경/);
 assert.deepEqual(h.calls.map(call=>call.type),['PING','RECOMMEND_CATEGORIES']);
});

test('aborted requests and missing owner stop before any network or extension use',async()=>{
 const h=clientFixture(),controller=new AbortController();controller.abort();
 await assert.rejects(h.exports.loadSupplierHubCategoryRecommendations('방한 모자',{workspaceOwnerId:owner,signal:controller.signal}));
 await assert.rejects(h.exports.loadSupplierHubCategoryRecommendations('방한 모자',{signal:new AbortController().signal}),/로그인 회원/);
 assert.equal(h.calls.length,0);assert.equal(h.requests.length,0);
});

test('aborting during title translation prevents a stale official prediction',async()=>{
 const controller=new AbortController(),h=clientFixture({onFetch:()=>controller.abort()});
 await assert.rejects(h.exports.loadSupplierHubCategoryRecommendations('冬季保暖护耳帽',{workspaceOwnerId:owner,signal:controller.signal}));
 assert.equal(h.requests.length,1);assert.equal(h.calls.length,0);
});

test('recommendation envelope accepts zero to three choices but rejects foreign identity, stale time and malformed paths/codes',()=>{
 const {exports}=clientFixture(),valid=envelope(),before=clone(valid);
 assert.equal(exports.validateHubCategoryRecommendations(valid,valid.productName,owner),valid);
 assert.deepEqual(valid,before);
 for(const mutate of [
  value=>value.source='local-guess',value=>value.ownerId='foreign-owner',value=>value.productName='다른 상품',
  value=>value.company={code:'A01526306',name:'와이홉'},value=>value.company={code:'A00000000',name:'외부회사'},
  value=>value.observedAt=Date.now()-300001,value=>value.observedAt=Date.now()+60001,value=>value.observedAt=1.5,
  value=>value.items.push(clone(value.items[0])),
  value=>value.items=Array.from({length:4},(_,index)=>({...value.items[0],id:String(index),code:String(900+index)})),
  value=>value.items[0].code='0900',value=>value.items[0].code='900x',value=>value.items[0].id='',
  value=>value.items[0].path=[],value=>value.items[0].path=[' 분류'],value=>value.items[0].path=['분류\u0000'],
  value=>value.items[0].path=Array(11).fill('분류'),value=>value.items[0].label='귀달이 모자',
 ]){
  const bad=clone(valid);mutate(bad);
  assert.throws(()=>exports.validateHubCategoryRecommendations(bad,valid.productName,owner));
 }
 for(const length of [0,3]){
  const value=clone(valid);value.items=Array.from({length},(_,index)=>({...value.items[0],id:'choice-'+index,code:String(900+index)}));
  assert.equal(exports.validateHubCategoryRecommendations(value,valid.productName,owner),value);
 }
});

test('a recommendation resolves every live ancestor and exact leaf before returning an observed Hub choice',async()=>{
 const h=clientFixture({branches:branches()}),result=envelope(),before=clone(result);
 const choice=await h.exports.resolveRecommendedHubCategoryChoice(result.items[0],result,owner,new AbortController().signal);
 assert.equal(choice.categoryId,'900');assert.equal(choice.evidence,'observed');assert.equal(choice.codeEvidence,'supplier-hub');assert.equal(choice.isLeaf,true);
 assert.deepEqual(clone(choice.path),result.items[0].path);assert.equal(choice.templateLinked,false);
 assert.deepEqual(clone(choice.supplierHub.company),company);assert.equal(choice.supplierHub.ownerId,owner);
 assert.deepEqual(h.calls.map(call=>call.type),['PING','CATEGORIES','PING','CATEGORIES','PING','CATEGORIES']);
 assert.deepEqual(h.calls.filter(call=>call.type==='CATEGORIES').map(call=>call.payload.trail.map(node=>node.categoryId)),[[],['100'],['100','200']]);
 assert.deepEqual(result,before);assert.equal(h.requests.length,0);
});

test('translated recommendation resolves by its verified search name while retaining the source title',async()=>{
 const h=clientFixture({branches:branches()}),result={...envelope(),productName:'冬季保暖护耳帽',queryProductName:'방한 귀달이 모자'};
 assert.equal((await h.exports.resolveRecommendedHubCategoryChoice(result.items[0],result,owner,new AbortController().signal)).categoryId,'900');
 assert.equal(result.productName,'冬季保暖护耳帽');assert.equal(result.queryProductName,'방한 귀달이 모자');
});

test('a forged recommendation item is rejected before reading any live category branch',async()=>{
 for(const change of [item=>item.code='901',item=>item.id='another-id',item=>item.path[1]='여성패션',item=>item.label='다른 경로']){
  const h=clientFixture({branches:branches()}),result=envelope(),item=clone(result.items[0]);change(item);
  await assert.rejects(h.exports.resolveRecommendedHubCategoryChoice(item,result,owner,new AbortController().signal),/현재 추천 목록/);
  assert.equal(h.calls.length,0);assert.equal(h.requests.length,0);
 }
});

test('wrong ancestor name, leaf flags or final category code never turn into a usable category choice',async()=>{
 for(const change of [
  value=>value[0][0].name='다른 최상위',value=>value[0][0].isLeaf=true,
  value=>value[1][0].name='다른 부모',value=>value[1][0].isLeaf=true,
  value=>value[2][0].isLeaf=false,value=>value[2][0].categoryId='999',value=>value[2][0].name='다른 모자',
 ]){
  const catalogue=branches();change(catalogue);const h=clientFixture({branches:catalogue}),result=envelope();
  await assert.rejects(h.exports.resolveRecommendedHubCategoryChoice(result.items[0],result,owner,new AbortController().signal),/전체 경로|최종 코드/);
  assert.equal(h.requests.length,0);
 }
});

test('ambiguous sibling names reject even when one candidate has the expected leaf flag or final code',async()=>{
 for(const change of [
  value=>value[0].push({categoryId:'102',name:'패션의류잡화',isLeaf:false}),
  value=>value[0].push({categoryId:'102',name:'패션의류잡화',isLeaf:true}),
  value=>value[2].push({categoryId:'902',name:'귀달이 모자',isLeaf:true}),
  value=>value[2].push({categoryId:'902',name:'귀달이 모자',isLeaf:false}),
 ]){
  const catalogue=branches();change(catalogue);const h=clientFixture({branches:catalogue}),result=envelope();
  await assert.rejects(h.exports.resolveRecommendedHubCategoryChoice(result.items[0],result,owner,new AbortController().signal),/전체 경로|최종 코드/);
 }
});

test('a changed owner/company during traversal or aborted final response cannot create a category selection',async()=>{
 for(const field of ['owner','company','abort']){
  let reads=0;const controller=new AbortController(),result=envelope();
  const load=loader({'@/app/supplier-hub-handoff':{exchange:async(type,payload)=>{
   if(type==='PING')return {categoryCatalog:true};assert.equal(type,'CATEGORIES');const index=reads++;
   if(field==='abort'&&index===2)controller.abort();
   return {branch:{source:'supplier-hub-category-api',fullCatalogVerified:false,ownerId:field==='owner'&&index===1?'foreign-owner':owner,company:field==='company'&&index===1?otherCompany:company,observedAt:Date.now(),trail:clone(payload.trail),children:branches()[index]}};
  }}},{fetch:()=>{throw Error('Recommendations must not write products or profiles');}});
  await assert.rejects(load('app/supplier-hub-category-recommendations.ts').resolveRecommendedHubCategoryChoice(result.items[0],result,owner,controller.signal));
  assert.equal(reads,field==='abort'?3:2);
 }
});

function apiFixture({firstUser,latestUser,firstOwner=owner,latestOwner=firstOwner,translation='겨울 방한 귀달이 모자',translationThrows=false}={}){
 const approved={verifiedAccess:true,membership:{status:'approved',companyCode:company.code,companyName:company.name}};
 let userReads=0,ownerReads=0;const translations=[];
 const initial=firstUser===undefined?approved:firstUser,latest=latestUser===undefined?initial:latestUser;
 const load=loader({
  '@/app/chatgpt-auth':{getChatGPTUser:async()=>userReads++===0?initial:latest,getWorkspaceOwnerId:async()=>ownerReads++===0?firstOwner:latestOwner},
  '@/app/automation/google-free-translation':{translateGoogleFree:async(text,options)=>{
   translations.push({text,options});if(translationThrows)throw Error('translator unavailable');
   return translation===null?null:{translatedText:translation,detectedSourceLanguage:'zh-CN'};
  }},
 },{fetch:()=>{throw Error('No product/profile writes or external fallback allowed');}});
 const exports=load('app/api/category-recommendation-title/route.ts');
 return {exports,translations,get userReads(){return userReads;},get ownerReads(){return ownerReads;},async post(body,options={}){
  const request=new Request('https://app.invalid/api/category-recommendation-title',{method:'POST',headers:{'content-type':'application/json',...options.headers},body:typeof body==='string'?body:JSON.stringify(body),signal:options.signal});
  const response=await exports.POST(request);return {response,body:await response.json(),request};
 }};
}

test('search-title API authenticates and translates Chinese text only, with no GET or product/profile write API',async()=>{
 const h=apiFixture(),input={expectedOwnerId:owner,productName:'冬季保暖护耳帽'},before=clone(input),result=await h.post(input);
 assert.equal(result.response.status,200);assert.equal(result.response.headers.get('cache-control'),'no-store');
 assert.deepEqual(result.body,{ownerId:owner,company,productName:input.productName,queryProductName:'겨울 방한 귀달이 모자'});
 assert.equal(h.translations.length,1);assert.equal(h.translations[0].text,input.productName);
 assert.deepEqual({...h.translations[0].options,signal:undefined},{targetLanguage:'ko',maxCharacters:500,timeoutSeconds:10,signal:undefined});
 assert.equal(h.translations[0].options.signal,result.request.signal);assert.deepEqual(input,before);
 assert.equal(h.userReads,2);assert.equal(h.ownerReads,2);assert.equal(h.exports.GET,undefined);
});

test('Korean search-title API returns the input without translation and keeps it independent of product data',async()=>{
 const h=apiFixture(),result=await h.post({expectedOwnerId:owner,productName:'  방한 귀달이 모자  '});
 assert.equal(result.response.status,200);assert.equal(result.body.productName,'방한 귀달이 모자');
 assert.equal(result.body.queryProductName,'방한 귀달이 모자');assert.equal(h.translations.length,0);
});

test('unauthorized users and owner mismatch fail before any translation',async()=>{
 for(const user of [null,{verifiedAccess:false,membership:{status:'approved',companyCode:company.code,companyName:company.name}},{verifiedAccess:true,membership:{status:'pending',companyCode:company.code,companyName:company.name}},{verifiedAccess:true,membership:{status:'approved',companyCode:'A00000000',companyName:'외부회사'}}]){
  const h=apiFixture({firstUser:user}),result=await h.post({expectedOwnerId:owner,productName:'冬季保暖护耳帽'});
  assert.equal(result.response.status,401);assert.equal(h.translations.length,0);assert.equal(h.ownerReads,0);
 }
 const h=apiFixture(),result=await h.post({expectedOwnerId:'foreign-owner',productName:'冬季保暖护耳帽'});
 assert.equal(result.response.status,409);assert.equal(h.translations.length,0);
});

test('invalid JSON, extra product-write fields and invalid names are rejected before translation',async()=>{
 for(const body of ['{broken',[],null,{expectedOwnerId:owner,productName:'帽',productId:'existing-product'},
  {expectedOwnerId:owner,productName:''},{expectedOwnerId:owner,productName:' '},{expectedOwnerId:owner,productName:'帽'.repeat(501)},
  {expectedOwnerId:owner,productName:'帽\u0000'},
 ]){
  const h=apiFixture(),result=await h.post(body);
  assert.equal(result.response.status,400);assert.equal(h.translations.length,0);
 }
 const h=apiFixture(),result=await h.post({expectedOwnerId:owner,productName:'帽'},{headers:{'content-type':'text/plain'}});
 assert.equal(result.response.status,400);assert.equal(h.translations.length,0);
});

test('translation failures return an error without overwriting source title or selecting a category',async()=>{
 for(const options of [{translation:null},{translation:''},{translation:' '},{translation:'가'.repeat(501)},{translation:'번역\u0000'},{translationThrows:true}]){
  const h=apiFixture(options),input={expectedOwnerId:owner,productName:'冬季保暖护耳帽'},before=clone(input),result=await h.post(input);
  assert.equal(result.response.status,options.translationThrows?503:502);assert.deepEqual(input,before);
  assert.equal(result.body.queryProductName,undefined);assert.equal(result.body.company,undefined);assert.equal(h.translations.length,1);
 }
});

test('auth/company changes or cancellation after translation reject the stale response',async()=>{
 const foreign={verifiedAccess:true,membership:{status:'approved',companyCode:otherCompany.code,companyName:otherCompany.name}};
 for(const options of [{latestOwner:'foreign-owner'},{latestUser:foreign},{latestUser:null}]){
  const h=apiFixture(options),result=await h.post({expectedOwnerId:owner,productName:'冬季保暖护耳帽'});
  assert.equal(result.response.status,409);assert.equal(h.translations.length,1);assert.equal(result.body.queryProductName,undefined);
 }
 const h=apiFixture(),controller=new AbortController();controller.abort();
 const result=await h.post({expectedOwnerId:owner,productName:'방한 모자'},{signal:controller.signal});
 assert.equal(result.response.status,503);assert.equal(result.body.queryProductName,undefined);assert.equal(h.translations.length,0);
});
