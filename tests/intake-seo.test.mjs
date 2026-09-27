import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Date,require:name=>load(name.slice(2)+'.ts')});return exports;}
const {prepareIntakeSeo:run}=load('app/intake-seo.ts');
const job={id:'j',productId:'p',productVersion:'v',contentRevision:1,status:'prepared',review:{fingerprint:'f',expiresAt:'2099-01-01T00:00:00Z',destination:'Cloudflare Workers AI'}};
test('automatic intake uses one generation and exact preview fingerprint before saving',async()=>{
 const actions=[];
 const message=await run('p',async(url,init)=>{const b=JSON.parse(init.body);actions.push(b.action);
 if(b.action==='prepare-collected'){assert.equal(b.intake,true);return Response.json({job,autoDraft:true});}
 if(b.action==='prepare-intake-options')return Response.json({done:true,productId:'p',productVersion:b.expectedVersion});
 if(b.action==='approve')return Response.json({job:{...job,status:'approved'}});
 if(b.action==='execute')return Response.json({job:{...job,status:'completed',result:{draft:{}}}});
 assert.equal(url,'/api/products/p/translation-apply');assert.equal(b.expectedVersion,'v');
 if(b.action==='preview')return Response.json({productId:'p',productVersion:'v',preview:[{}],fingerprint:'a'.repeat(64)});
 assert.equal(b.fingerprint,'a'.repeat(64));return Response.json({productId:'p',productVersion:'2026-09-27T10:00:00Z',applied:1});
 },new AbortController().signal);
 assert.deepEqual(actions,['prepare-collected','approve','execute','preview','apply','prepare-intake-options']);assert.match(message,/초안을 생성해 반영/);
});
test('preserved revisions and terminal failures cannot trigger another generation or apply',async()=>{
 for(const reply of [{job,intakePreserved:true,autoDraft:false},...['running','failed','uncertain'].map(status=>({job:{...job,status,error:{message:'확인 필요'}},autoDraft:true})),{job:{...job,review:{...job.review,destination:'OpenAI Responses API'}},autoDraft:true}]){
 let calls=0;const message=await run('p',async()=>{calls++;return Response.json(reply);},new AbortController().signal);assert.equal(calls,1);assert.doesNotMatch(message,/생성해 반영/);
 }
});
test('mismatched preview and uncertain apply are not reported as success or retried',async()=>{
 for(const mismatch of [true,false]){
 const actions=[];const message=await run('p',async(_url,init)=>{const b=JSON.parse(init.body);actions.push(b.action);
 if(b.action==='prepare-collected')return Response.json({job:{...job,status:'completed',result:{draft:{}}},autoDraft:true});
 if(b.action==='preview')return Response.json({productId:mismatch?'other':'p',productVersion:'v',preview:[{}],fingerprint:'a'.repeat(64)});
 throw Error('lost save acknowledgement');
 },new AbortController().signal);assert.deepEqual(actions,mismatch?['prepare-collected','preview']:['prepare-collected','preview','apply']);assert.doesNotMatch(message,/생성해 반영/);assert.match(message,/자동 재요청하지/);
 }
});

test('unchanged initial SEO still advances to pending options without a redundant save',async()=>{
 const actions=[];const version='2026-09-27T10:00:00Z';
 const message=await run('p',async(_url,init)=>{
  const b=JSON.parse(init.body);actions.push(b.action);
  if(b.action==='prepare-collected')return Response.json({job:{...job,status:'completed',result:{draft:{}}},autoDraft:true,remainingOptions:2});
  if(b.action==='prepare-intake-options'){
   if(b.expectedVersion===version)return Response.json({done:true,productId:'p',productVersion:version});
   assert.equal(b.expectedVersion,'v');
   return Response.json({job:{...job,id:'options',status:'completed',result:{draft:{}}},autoDraft:true,optionsOnly:true});
  }
  if(b.action==='preview'){
   if(b.jobId==='j'){assert.equal(b.scope,undefined);return Response.json({productId:'p',productVersion:'v',preview:[],fingerprint:'a'.repeat(64)});}
   assert.equal(b.scope,'options');return Response.json({productId:'p',productVersion:'v',preview:[{}],fingerprint:'b'.repeat(64)});
  }
  assert.equal(b.action,'apply');assert.equal(b.jobId,'options');assert.equal(b.scope,'options');assert.equal(b.fingerprint,'b'.repeat(64));
  return Response.json({productId:'p',productVersion:version,applied:2});
 },new AbortController().signal);
 assert.deepEqual(actions,['prepare-collected','preview','prepare-intake-options','preview','apply','prepare-intake-options']);
 assert.match(message,/초안을 생성해 반영/);
});

test('unchanged option result stops instead of repeating a no-progress batch',async()=>{
 const actions=[];
 const message=await run('p',async(_url,init)=>{
  const b=JSON.parse(init.body);actions.push(b.action);
  if(b.action==='prepare-collected')return Response.json({job,intakePreserved:true,productVersion:'v'});
  if(b.action==='prepare-intake-options')return Response.json({job:{...job,status:'completed',result:{draft:{}}},autoDraft:true,optionsOnly:true,remainingOptions:2});
  assert.equal(b.action,'preview');assert.equal(b.scope,'options');return Response.json({productId:'p',productVersion:'v',preview:[],fingerprint:'a'.repeat(64)});
 },new AbortController().signal);
 assert.deepEqual(actions,['prepare-collected','prepare-intake-options','preview']);
 assert.match(message,/반영할 추가 항목이 없어/);assert.doesNotMatch(message,/초안을 생성해 반영/);
});
