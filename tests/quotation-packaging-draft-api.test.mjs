import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import {apiFixture,companies} from './helpers/supplier-hub-single-projection.mjs';
import {aiFixture} from './helpers/quotation-ai.mjs';
const json=async(response,status=200)=>{const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;};
import {packagingResponse as qwen,packagingItem} from './helpers/quotation-packaging-provider.mjs';
async function fixture(company=companies[0]){const f=await apiFixture(company,aiFixture({company}).snapshot),calls=[];
 f.h.bindings.SOURCEFLOW_QUOTATION_AI_PROVIDER='workers-ai';f.h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY='true';
 f.h.bindings.AI.run=async(model,input)=>{calls.push({model,input});const source=JSON.parse(input.messages[1].content.slice(0,-'\n/no_think'.length));return qwen(source.packages.map(item=>packagingItem(item,{weightG:40,widthMm:60,lengthMm:80,heightMm:15})));};
 const read=()=>f.h.route(f.base+'/quotation-fields'+f.query),view=await json(await read());
 const body={action:'generate',profileId:f.profile.id,expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,optionId:null,applyToAllOptions:true};
 const request=input=>f.h.route(f.base+'/quotation-packaging-draft',{method:'POST',body:input??body});
 const mutateOptions=mutate=>{const row=f.h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id),value=JSON.parse(row.payload);mutate(value);f.h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(value),f.id);};
 return{...f,calls,view,body,read,request,mutateOptions};}
test('actual packaging POST returns a reviewable Qwen draft without saving product/quote/options or weakening GET',async()=>{
 const f=await fixture();try{const state=f.state(),before=JSON.stringify(await json(await f.read())),result=await json(await f.request());
  assert.equal(result.proposals.length,2);assert.equal(result.aiRequests,1);assert.equal(result.model,'@cf/qwen/qwen3-30b-a3b-fp8');assert.ok(result.proposals.every(item=>item.origin==='ai-estimate'&&item.measured===false));
  assert.equal(f.state(),state);assert.equal(JSON.stringify(await json(await f.read())),before);assert.equal(f.calls.length,1);assert.equal(f.h.sqlite.prepare('SELECT requests FROM quotation_ai_daily').get().requests,1);
  assert.deepEqual(f.h.network,[]);assert.equal(f.h.load('app/api/products/[id]/quotation-packaging-draft/route.ts').GET,undefined);
 }finally{f.close();}
});
test('source10g is retained across actual route while only dimensions are drafted',async()=>{
 const f=await fixture();try{f.mutateOptions(options=>{options.rows[0].packagedWeightG=10;options.rows[0].provenance.packagedWeightG='collected';options.rows[0].packagingUnitsPerPack=1;});
  const view=await json(await f.read()),state=f.state(),result=await json(await f.request({...f.body,expectedInputFingerprint:view.inputFingerprint}));
  assert.equal(result.proposals.length,1);assert.equal(result.proposals[0].value,'60*80*15');assert.equal(result.preserved[0].value,'10');assert.equal(f.state(),state);
 }finally{f.close();}
});

for(const company of companies)test(`${company.code}: insufficient or generic-boundary dimensions preserve source10g with no replacement or retry`,async()=>{
 for(const kind of ['insufficient','boundary']){
  const f=await fixture(company);try{
   f.mutateOptions(options=>{options.rows[0].packagedWeightG=10;options.rows[0].provenance.packagedWeightG='collected';options.rows[0].packagingUnitsPerPack=1;});
   let requests=0;f.h.bindings.AI.run=async(_model,input)=>{requests++;const source=JSON.parse(input.messages[1].content.slice(0,-'\n/no_think'.length));
    return qwen(source.packages.map(item=>packagingItem(item,kind==='insufficient'?{}:{widthMm:10,lengthMm:10,heightMm:10})));};
   const view=await json(await f.read()),state=f.state(),result=await json(await f.request({...f.body,expectedInputFingerprint:view.inputFingerprint}));
   assert.equal(result.proposals.length,0);assert.equal(result.aiRequests,1);assert.equal(requests,1);
   assert.ok(result.preserved.some(item=>item.value==='10'));assert.ok(result.warnings.some(message=>/보류했다고 응답|추정값으로 제안하지/.test(message)));
   assert.deepEqual(result.diagnostics,{promptRevision:'packaging-estimate-v4',providerVersion:2,validationCode:null,response:'parsed',expectedOptions:1,returnedOptions:1,
    options:[{index:0,returned:true,weight:false,width:kind==='boundary',length:kind==='boundary',height:kind==='boundary',dimensionsStatus:kind==='boundary'?'estimated':'abstained',dimensionsReason:kind==='boundary'?null:'insufficient-product-context',weightStatus:'not-requested',weightReason:null}]});
   assert.equal(f.state(),state);assert.equal(JSON.stringify(await json(await f.read())),JSON.stringify(view));assert.deepEqual(f.h.network,[]);
  }finally{f.close();}
 }
});
for(const company of companies)test(`${company.code}: sealed common10g is protected and supplied as reviewed context to the actual size-only draft route`,async()=>{
 const f=await fixture(company);try{
  const field=f.view.resolved.schema.fields.find(item=>item.hubInput==='packagedWeightG');assert.ok(field);
  const saved=await json(await f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:f.view.revision,expectedInputFingerprint:f.view.inputFingerprint,changes:[{optionId:null,fieldKey:field.id,value:'10'}]}}));
  const view=await json(await f.read()),before=f.state(),result=await json(await f.request({...f.body,expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint}));
  assert.equal(result.proposals.length,1);assert.ok(result.proposals.every(item=>item.value==='60*80*15'&&item.origin==='ai-estimate'&&item.measured===false));
  assert.equal(result.preserved[0].value,'10');assert.equal(f.calls.length,1);assert.equal(f.state(),before);
  const source=JSON.parse(f.calls[0].input.messages[1].content.slice(0,-'\n/no_think'.length));
  assert.deepEqual(source.packages[0].collectedPackage,{});assert.equal(Object.hasOwn(source.packages[0],'shippingContext'),false);
  assert.deepEqual(source.packages[0].reviewedPackage.weight,{origin:'saved-quotation',source:'manual-common',measured:false,values:{weightG:10}});
  const readback=await json(await f.read());assert.equal(readback.revision,saved.revision);assert.equal(readback.resolved.rows.find(row=>row.optionId==='synthetic-one').fields[field.id].value,'10');
 }finally{f.close();}
});
test('unconfigured/free-unconfirmed, quota-limit and uncertain model delivery leave missing packaging incomplete without fallback or retry',async()=>{
 for(const kind of ['unconfigured','limited','provider-failed']){const f=await fixture();try{
  if(kind==='unconfigured')f.h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY='false';
  if(kind==='limited'){const reserve=f.h.load('db/quotation-ai-jobs.ts').reserveQuotationAiRequest;for(let index=0;index<40;index++)assert.equal(await reserve(),true);}
  if(kind==='provider-failed')f.h.bindings.AI.run=async()=>{f.calls.push({model:'attempted'});throw Error('synthetic unknown outcome');};
  const state=f.state(),result=await json(await f.request());assert.equal(result.proposals.length,0);assert.equal(result.diagnostics.response,'unavailable');assert.ok(result.warnings.every(message=>!message.includes('기본 초안')));assert.equal(result.aiRequests,kind==='provider-failed'?1:0);assert.equal(f.calls.length,kind==='provider-failed'?1:0);assert.equal(f.state(),state);
 }finally{f.close();}}
});
test('manual blank/current value protects physical fields and no model is needed when every target is protected',async()=>{
 const f=await fixture();try{
  const fieldIds=f.view.resolved.schema.fields.filter(field=>f.h.load('app/quotation-packaging-basis.ts').isQuotationPackagingField(f.view.resolved.schema.fields,field.id)).map(field=>field.id);
  await json(await f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:f.view.revision,expectedInputFingerprint:f.view.inputFingerprint,changes:fieldIds.map(fieldKey=>({optionId:'synthetic-one',fieldKey,value:''}))}}));
  const view=await json(await f.read()),state=f.state(),result=await json(await f.request({...f.body,expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint}));
  assert.equal(result.proposals.length,0);assert.equal(f.calls.length,0);assert.equal(result.aiRequests,0);assert.equal(f.state(),state);
 }finally{f.close();}
});
test('unexpected data/source overrides, stale clocks and suspended membership fail before model calls',async()=>{
 const f=await fixture();try{const state=f.state();for(const body of [{...f.body,source:{title:'invented'}},{...f.body,model:'other'},{...f.body,expectedRevision:99},{...f.body,expectedInputFingerprint:'b'.repeat(64)}]){
  const response=await f.request(body);assert.ok([400,409].includes(response.status));assert.equal(f.calls.length,0);assert.equal(f.state(),state);
 }f.h.setMembershipStatus('suspended');await json(await f.request(),403);assert.equal(f.calls.length,0);
 }finally{f.close();}
});
for(const change of ['company','quantity','manual-blank'])test(`quota-boundary ${change} race cannot send or return a packaging draft`,async()=>{
 const f=await fixture();try{let changed=false,actorState;const prepare=f.h.db.prepare;
  f.h.db.prepare=function(sql){const query=prepare(sql),execute=query.execute;if(sql.startsWith('INSERT INTO quotation_ai_daily'))query.execute=function(){const rows=execute();if(!changed){changed=true;
   if(change==='company')f.h.setCompany(companies[1]);else if(change==='quantity')f.mutateOptions(options=>{options.rows[0].unitsPerPack=3;});
   else {const overrides={common:{packagedWeightG:''},options:{}},now=new Date().toISOString();f.h.sqlite.prepare('INSERT INTO product_quotation_fields(product_id,owner_id,revision,payload,updated_at) VALUES(?,?,?,?,?)').run(f.id,'owner',1,JSON.stringify({schemaVersion:1,productId:f.id,revision:1,overrides,updatedAt:now}),now);}
   actorState=f.state();}return rows;};return query;};
  const result=await json(await f.request(),409);assert.ok(result.error);assert.equal(changed,true);assert.equal(f.calls.length,0);assert.equal(f.state(),actorState);
 }finally{f.close();}
});
test('post-model company or option changes discard estimated values instead of applying stale quantities',async()=>{
 for(const change of ['company','quantity']){const f=await fixture();try{const run=f.h.bindings.AI.run;let actorState;
  f.h.bindings.AI.run=async(...args)=>{const result=await run(...args);if(change==='company')f.h.setCompany(companies[1]);else f.mutateOptions(options=>{options.rows[0].unitsPerPack=5;});actorState=f.state();return result;};
  const body=await json(await f.request(),409);assert.equal(body.proposals,undefined);assert.equal(f.calls.length,1);assert.equal(f.state(),actorState);
 }finally{f.close();}}
});
test('last authorization owner-await company change fails before the provider receives product text',async()=>{
 const f=await fixture();try{let company={...companies[0]},ownerReads=0,changed=false;
  const auth={getChatGPTUser:async()=>({verifiedAccess:true,userId:'owner',email:'synthetic@test.invalid',membership:{id:'owner',email:'synthetic@test.invalid',role:'admin',status:'approved',companyCode:company.code,companyName:company.name}}),
   getWorkspaceOwnerId:async()=>{ownerReads++;if(ownerReads===5){company={...companies[1]};f.h.setCompany(company);changed=true;}return'owner';}};
  const source=fs.readFileSync(new URL('../app/api/products/[id]/quotation-packaging-draft/route.ts',import.meta.url),'utf8'),exports={};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Response,Error,JSON,Promise,
   require(name){if(name==='cloudflare:workers')return{env:f.h.bindings};if(name==='@/app/chatgpt-auth')return auth;if(name.startsWith('@/'))return f.h.load(name.slice(2)+'.ts');throw Error(name);}});
  const before=f.state(),response=await exports.POST(new Request('https://app.test'+f.base+'/quotation-packaging-draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.body)}),{params:Promise.resolve({id:f.id})});
  const result=await json(response,409);assert.equal(result.code,'PACKAGING_DRAFT_SOURCE_CHANGED');assert.equal(changed,true);
  assert.equal(f.calls.length,0);assert.equal(ownerReads,5);assert.equal(f.state(),before);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
