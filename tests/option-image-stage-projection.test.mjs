import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
function ui(h,overrides={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/product-option-board.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,URL,Error,require(name){if(name.endsWith('.css'))return{};if(name in overrides)return overrides[name];return name.startsWith('@/')?h.load(name.slice(2)+'.ts'):native(name);}});return exports;}
function renderedStage(f,data,optionId){
 let slot=0;const states=[{productId:f.product.id,attempt:0,data,error:''},0,''],react={useState(initial){const i=slot++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],()=>{}];},useEffect(){}};
 const tree=ui(f.h,{react}).ProductOptionBoard({productId:f.product.id,sourceUrl:f.product.source_url,imageKeys:f.product.image_keys,onQuotation(){},onEdit(){},onStage(){}}),nodes=value=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.props?.children)];
 return nodes(tree).find(node=>node.props?.['aria-label']===`옵션 ${optionId} 대표이미지 편집`).props['data-stage-state'];
}
async function fixture(){
 const h=mobileIntakeHarness({companyCode:'A01526306',companyName:'유앤채'});try{
  await h.intake();let product=h.sqlite.prepare('SELECT * FROM products').get();const base='/api/products/'+product.id;
  await json(await h.route(base+'/work-draft',{method:'POST',body:{expectedVersion:product.updated_at,roles:['main','additional']}}));
  product=h.sqlite.prepare('SELECT * FROM products').get();const options=await h.load('db/product-options.ts').readProductOptions('owner',product.id);
  options.rows.forEach((row,index)=>row.included=index<2);options.rows[1].imageKey=JSON.parse(product.image_keys).find(key=>key!==options.rows[0].imageKey);options.rows[1].provenance.imageKey='collected';h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options),product.id);
  h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('owner','jwhj1116@kakao.com','fixture','admin','approved','A01526306','유앤채',product.updated_at,product.updated_at);
  Object.assign(h.bindings,{SOURCEFLOW_IMAGE_TEXT_PROVIDER:'workers-ai-vision',SOURCEFLOW_IMAGE_TEXT_MODEL:'@cf/qwen/qwen3.8-27b',SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED:'true'});
  const content=await h.load('db/product-content.ts').readProductContent('owner',product.id),vision=h.load('app/automation/workers-image-vision.ts'),configuration=vision.imageVisionConfiguration(h.bindings),ledger=h.load('db/image-vision-requests.ts'),requests=[];
  let counter=0,intercept;
  const record=async(key,status='completed')=>{
   const requestId='12345678-1234-4123-8123-'+String(++counter).padStart(12,'0'),sha=value=>createHash('sha256').update(value).digest('hex');
   const scope={owner:'owner',productId:product.id,requestId,company:{code:'A01526306',name:'유앤채'},member:{email:'jwhj1116@kakao.com',role:'admin'},model:configuration.model,fingerprint:sha(requestId),sourceScope:sha(key),productVersion:product.updated_at,contentRevision:content.revision,inspection:{sourceKey:key,sourceSha256:sha(h.objects.get(key)),width:1,height:1,sourceLanguage:'zh',configuration}};
   assert.equal((await ledger.claimImageVisionRequest(scope)).claimed,true);
   const result=vision.parseImageVisionResponse({response:{decision:'product-markings-only',blocks:[{original:'SPORT',translated:'스포츠',kind:'product-marking',box:{x:0,y:0,width:1,height:1}}]}},1,1,'product-text-preservation-v2');
   await ledger.finishImageVisionRequest(scope,status==='completed'?{status,result,requests:1}:{status:'uncertain',failure:'TIMEOUT',requests:1});return requestId;
  };
  const fetcher=async(path,init={})=>{requests.push({path,method:init.method??'GET'});const mocked=await intercept?.(path,init);if(mocked)return mocked;
   if(path===base+'/content')return h.load('app/api/products/[id]/content/route.ts').GET(new Request('https://app.test'+path,{headers:init.headers}),{params:Promise.resolve({id:product.id})});
   return h.route(path,{method:init.method??'GET'});
  };
  const model=ui(h),read=()=>model.readOptionBoard(product.id,new AbortController().signal,fetcher);
  return{h,product,base,content,options,record,requests,read,intercept(value){intercept=value;},close(){h.close();}};
 }catch(error){h.close();throw error;}
}

test('actual current preservation receipts reach only their option image stages through the existing three GETs',async()=>{
 const f=await fixture();try{
  const [proved,unproved]=f.options.rows;assert.notEqual(proved.imageKey,unproved.imageKey);
  await f.record(proved.imageKey);const unknown=await f.record(unproved.imageKey,'uncertain');
  const before=JSON.stringify(f.h.sqlite.prepare('SELECT * FROM image_vision_requests').all()),products=JSON.stringify(f.h.sqlite.prepare('SELECT * FROM products').all()),network=f.h.network.length,ai=f.h.aiSources.length;
  const board=await f.read();assert.equal(board.optionStages[proved.id].mainImage.state,'complete');assert.match(board.optionStages[proved.id].mainImage.detail,/실물 인쇄/);assert.equal(board.optionStages[unproved.id].mainImage.state,'pending');
  assert.equal(board.registrationStages.mainImage.state,'pending');assert.ok(f.requests.every(request=>request.method==='GET'));assert.equal(f.requests.length,3);
  assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM image_vision_requests').all()),before);assert.equal(JSON.stringify(f.h.sqlite.prepare('SELECT * FROM products').all()),products);assert.equal(f.h.sqlite.prepare('SELECT status FROM image_vision_requests WHERE request_id=?').get(unknown).status,'uncertain');assert.equal(f.h.network.length,network);assert.equal(f.h.aiSources.length,ai);
 }finally{f.close();}
});

test('a proved included option does not turn an excluded unproved original green, and running feedback remains authoritative',async()=>{
 const f=await fixture();try{
  const [proved,unproved]=f.options.rows;unproved.included=false;f.h.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(f.options),f.product.id);await f.record(proved.imageKey);
  const board=await f.read();assert.equal(board.registrationStages.mainImage.state,'complete');assert.equal(renderedStage(f,board,proved.id),'complete');assert.equal(renderedStage(f,board,unproved.id),'pending');
  board.registrationStages.mainImage={state:'running',detail:'원래 요청 결과 확인 중'};assert.equal(renderedStage(f,board,proved.id),'running');
 }finally{f.close();}
});

test('additional completion requires receipts for every selected original',async()=>{
 const f=await fixture();try{
  const keys=[...new Set(f.content.assets.additional.value)];assert.ok(keys.length>1);for(const key of keys.slice(0,-1))await f.record(key);
  const partial=await f.read();assert.ok(f.options.rows.every(row=>partial.optionStages[row.id].additionalImages.state==='pending'));
  await f.record(keys.at(-1));const complete=await f.read();assert.ok(f.options.rows.every(row=>complete.optionStages[row.id].additionalImages.state==='complete'));assert.equal(f.requests.length,6);assert.ok(f.requests.every(request=>request.method==='GET'));
 }finally{f.close();}
});

test('unauthenticated development keeps legacy board data without projecting preservation evidence',async()=>{
 const f=await fixture();try{
  f.h.auth.getChatGPTUser=async()=>null;const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../db/option-image-stage-projection.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {exports,process:{env:{NODE_ENV:'development'}},require(name){return name==='@/app/chatgpt-auth'?f.h.auth:f.h.load(name.slice(2)+'.ts');}});
  assert.equal(await exports.readOptionImageStageProjection('owner',f.product,f.content),undefined);
 }finally{f.close();}
});

for(const change of ['product','content','options','settings','owner','company'])test(`an intervening ${change} change cannot apply receipt-based option completion`,async()=>{
 const f=await fixture();try{
  await f.record(f.options.rows[0].imageKey);const reader=f.h.load('db/image-no-text-receipts.ts'),original=reader.readImageNoTextReceipts;let reads=0;
  reader.readImageNoTextReceipts=async(...args)=>{const proofs=await original(...args);if(++reads===2){
   if(change==='product')f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z',f.product.id);
   if(change==='content'){const value=plain(f.content);value.revision++;f.h.sqlite.prepare('UPDATE product_content SET revision=?,payload=? WHERE product_id=?').run(value.revision,JSON.stringify(value),f.product.id);}
   if(change==='options'){const value=plain(f.options);value.revision++;f.h.sqlite.prepare('UPDATE product_options SET revision=?,payload=? WHERE product_id=?').run(value.revision,JSON.stringify(value),f.product.id);}
   if(change==='settings')await f.h.load('db/queries.ts').saveSettings('owner',JSON.stringify({...f.h.settings,brand:'변경된 설정'}));
   if(change==='owner')f.h.auth.getWorkspaceOwnerId=async()=>'other';
   if(change==='company')f.h.setCompany({code:'A01464742',name:'와이홉'});
  }return proofs;};
  await assert.rejects(f.read());assert.equal(reads,2);assert.ok(f.requests.every(request=>request.method==='GET'));
  assert.deepEqual(f.requests.map(request=>request.path),['options','content','quotation-fields'].map(route=>`${f.base}/${route}`));
 }finally{f.close();}
});

for(const stale of ['productVersion','contentRevision','optionRevision','quotationRevision','inputFingerprint','owner','malformed stage'])test(`a ${stale} projection is rejected against the board's current reads`,async()=>{
 const f=await fixture();try{
  await f.record(f.options.rows[0].imageKey);f.intercept(async(path,init)=>{if(path!==f.base+'/content')return;
   const body=await json(await f.h.load('app/api/products/[id]/content/route.ts').GET(new Request('https://app.test'+path,{headers:init.headers}),{params:Promise.resolve({id:f.product.id})}));
   const projection=body.optionImageStages;assert.ok(projection);
   if(stale==='productVersion')projection.productVersion='2099-01-01T00:00:00.000Z';
   else if(stale==='inputFingerprint')projection.inputFingerprint='9'.repeat(64);
   else if(stale==='owner')projection.scope.ownerId='other';
   else if(stale==='malformed stage')projection.stages[f.options.rows[0].id].mainImage={state:'complete',detail:''};
   else projection[stale]++;
   return Response.json(body);
  });
  await assert.rejects(f.read(),/옵션 이미지/);assert.equal(f.requests.length,3);assert.ok(f.requests.every(request=>request.method==='GET'));
 }finally{f.close();}
});
