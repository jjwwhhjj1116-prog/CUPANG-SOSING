import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,TextEncoder,require:name=>load(name.slice(2)+'.ts')});return exports;}
const {deliverCollectionResult:actualDeliver}=load('app/collection-delivery.ts');
const deliver=(job,offer,input,options={})=>actualDeliver(job,offer,input,{retryAttempts:1,...options,fetcher:async(url,init)=>url.endsWith('/capacity')?reply({capacity:{usedSlots:0,totalImages:input.images.length,reusableIndices:[]}}):options.fetcher(url,init)});
const input={schemaVersion:1,sourceUrl:'https://detail.1688.com/offer/123456789.html',provider:'synthetic-test',collectedAt:'2026-01-01T00:00:00Z',title:'합성 검증',description:'',options:[{sku:'a',name:'옵션',unitPriceCny:2,minimumOrder:1,stock:null}],images:[{url:'https://cbu01.alicdn.com/a.png',role:'main'}]};
const reply=(body,status=200)=>({ok:status===200,status,json:async()=>body});
const receipt=body=>({...JSON.parse(body),offerId:'123456789'});

test('a matching source from another collection job never starts product import',async()=>{
 for(const identity of [{jobId:'other-category-job',offerId:'123456789'},{jobId:'job',offerId:'987654321'},{}]){
  const calls=[];
  const outcome=await actualDeliver('job','123456789',input,{fetcher:async(url,init)=>{
   calls.push(url);return reply({...identity,receipt:{result:receipt(init.body)}});
  }});
  assert.equal(outcome.status,'failed');assert.equal(outcome.receiptConfirmed,false);assert.equal(outcome.productId,null);
  assert.deepEqual(calls,['/api/collection-jobs/job/result']);
 }
});

test('large receipts automatically import a bounded selection while preserving the full original for replay',async()=>{
 const source={...input,images:Array.from({length:200},(_,index)=>({url:`https://cbu01.alicdn.com/${index}.png`,role:index===0?'main':'detail'}))};
 const before=JSON.stringify(source),calls=[],bodies=[];
 const fetcher=async(url,init)=>{calls.push(url);if(url.endsWith('/result')){bodies.push(init.body);return reply({jobId:'job',offerId:'123456789',receipt:{result:receipt(init.body)}});}if(url.endsWith('/capacity'))return reply({capacity:{usedSlots:0,totalImages:200,reusableIndices:[]}});return reply(url.endsWith('/product')?{productId:'same'}:{key:'owner/image'});};
 const first=await actualDeliver('job','123456789',source,{fetcher});
 assert.equal(first.status,'completed');assert.equal(first.receiptConfirmed,true);assert.equal(first.productId,'same');assert.equal(first.completedImages,50);assert.match(first.warnings[0],/150/);assert.equal(calls.filter(url=>url.endsWith('/images')).length,50);
 const resumed=await actualDeliver('job','123456789',source,{fetcher,imageIndices:[0,199]});assert.equal(resumed.status,'completed');assert.equal(resumed.completedImages,2);assert.equal(resumed.productId,'same');assert.equal(bodies[0],bodies[1]);assert.equal(JSON.stringify(source),before);
 calls.length=0;await assert.rejects(()=>actualDeliver('job','123456789',source,{fetcher,imageIndices:Array.from({length:51},(_,i)=>i)}));assert.equal(calls.length,0);
 calls.length=0;let stop=false;const stopped=await actualDeliver('job','123456789',source,{shouldStop:()=>stop,fetcher:async(url,init)=>{stop=true;return fetcher(url,init);}});assert.equal(stopped.status,'stopped');assert.equal(stopped.receiptConfirmed,true);assert.equal(calls.length,1);
});

test('product-only delivery does not depend on image capacity and preserves receipt verification',async()=>{
 for(const source of [input,{...input,images:[]}]){
  const calls=[];
  const outcome=await actualDeliver('job','123456789',source,{imageIndices:[],fetcher:async(url,init)=>{
   calls.push(url);
   if(url.endsWith('/result'))return reply({jobId:'job',offerId:'123456789',receipt:{result:receipt(init.body)}});
   if(url.endsWith('/product'))return reply({productId:'product-only'});
   return reply({error:'image storage unavailable'},503);
  }});
  assert.equal(outcome.status,'completed');assert.equal(outcome.receiptConfirmed,true);
  assert.equal(outcome.productId,'product-only');assert.equal(outcome.completedImages,0);
  assert.deepEqual(calls,['/api/collection-jobs/job/result','/api/collection-jobs/job/product']);
 }
});
test('delivery confirms normalized receipt before product and selected images without paid or submission calls',async()=>{
 const calls=[];const result=await deliver('job','123456789',input,{fetcher:async(url,init)=>{calls.push(url);if(url.endsWith('/result'))return reply({jobId:'job',offerId:'123456789',receipt:{result:receipt(init.body)}});return reply(url.endsWith('/product')?{productId:'p'}:{key:'owner/a'});}});
 assert.equal(result.status,'completed');assert.equal(result.receiptConfirmed,true);assert.equal(result.completedImages,1);
 assert.deepEqual(calls,['/api/collection-jobs/job/result','/api/collection-jobs/job/product','/api/collection-jobs/job/images']);
 assert.equal(input.collectedAt,'2026-01-01T00:00:00Z');
});
test('invalid identity or selections write nothing and uncertain or mismatched receipts never promote',async()=>{
 let calls=0;const unused=async()=>{calls++;};
 await assert.rejects(()=>deliver('job','987654321',input,{fetcher:unused}));
 await assert.rejects(()=>deliver('job','123456789',input,{fetcher:unused,imageIndices:[5]}));assert.equal(calls,0);
 for(const respond of [()=>reply({},503),()=>reply({}),body=>reply({jobId:'job',offerId:'123456789',receipt:{result:{...receipt(body),title:'다른 원문'}}}),()=>{throw Error('connection lost');}]){
  calls=0;const result=await deliver('job','123456789',input,{fetcher:async(_url,init)=>{calls++;return respond(init.body);}});
  assert.equal(result.status,'failed');assert.equal(result.receiptConfirmed,false);assert.equal(calls,1);
 }
});
test('stop after receipt and retry after image failure preserve confirmed progress',async()=>{
 let stop=false;const stopped=await deliver('job','123456789',input,{shouldStop:()=>stop,fetcher:async(_url,init)=>{stop=true;return reply({jobId:'job',offerId:'123456789',receipt:{result:receipt(init.body)}});}});
 assert.equal(stopped.status,'stopped');assert.equal(stopped.receiptConfirmed,true);assert.equal(stopped.productId,null);
 let fail=true;const fetcher=async(url,init)=>url.endsWith('/result')?reply({jobId:'job',offerId:'123456789',receipt:{result:receipt(init.body)}}):url.endsWith('/product')?reply({productId:'same'}):fail?reply({error:'image unavailable'},503):reply({key:'owner/a'});
 const first=await deliver('job','123456789',input,{fetcher});assert.equal(first.status,'failed');assert.equal(first.receiptConfirmed,true);assert.equal(first.productId,'same');
 fail=false;const second=await deliver('job','123456789',input,{fetcher});assert.equal(second.status,'completed');assert.equal(second.productId,'same');
});

test('delivery retains receipt confirmation when capacity rejects the selected images',async()=>{
 const calls=[];const outcome=await actualDeliver('job','123456789',input,{imageIndices:[0],fetcher:async(url,init)=>{calls.push(url);if(url.endsWith('/result'))return reply({jobId:'job',offerId:'123456789',receipt:{result:receipt(init.body)}});return reply({capacity:{usedSlots:50,totalImages:1,reusableIndices:[]}});}});
 assert.equal(outcome.status,'failed');assert.equal(outcome.receiptConfirmed,true);assert.equal(outcome.productId,null);assert.equal(outcome.completedImages,0);
 assert.deepEqual(calls,['/api/collection-jobs/job/result','/api/collection-jobs/job/capacity']);
});

test('receipt retry resends identical normalized bytes after a lost acknowledgement before promotion',async()=>{
 const calls=[],bodies=[],retries=[];let receiptCalls=0;
 const outcome=await deliver('job','123456789',input,{retryAttempts:3,retryWait:async()=>{},onRetry:n=>retries.push(n),fetcher:async(url,init)=>{
  calls.push(url);
  if(url.endsWith('/result')){bodies.push(init.body);if(++receiptCalls===1)throw Error('response lost after storing');if(receiptCalls===2)return reply({error:'temporarily unavailable'},503);return reply({jobId:'job',offerId:'123456789',receipt:{result:receipt(init.body)}});}
  return reply(url.endsWith('/product')?{productId:'same-product'}:{key:'owner/a'});
 }});
 assert.equal(outcome.status,'completed');assert.equal(outcome.receiptConfirmed,true);
 assert.equal(new Set(bodies).size,1);assert.deepEqual(retries,[2,3]);
 assert.deepEqual(calls.slice(0,3),Array(3).fill('/api/collection-jobs/job/result'));
 assert.equal(calls.filter(url=>url.endsWith('/product')).length,1);
});

test('receipt conflicts and authentication failures are not retried or promoted, and retries remain bounded',async()=>{
 for(const status of [400,401,403,409,413,415,429,502,503,504]){
  let calls=0;
  const outcome=await deliver('job','123456789',input,{retryAttempts:3,retryWait:async()=>{},fetcher:async url=>{assert.ok(url.endsWith('/result'));calls++;return reply({error:'rejected'},status);}});
  assert.equal(outcome.status,'failed');assert.equal(outcome.receiptConfirmed,false);
  assert.equal(calls,[502,503,504].includes(status)?3:1);
 }
 let calls=0;
 for(const retryAttempts of [0,4,1.5])await assert.rejects(()=>deliver('job','123456789',input,{retryAttempts,fetcher:async()=>{calls++;}}));
 assert.equal(calls,0);
});

test('stop during receipt retry prevents another write and does not claim a confirmed receipt',async()=>{
 let stop=false,calls=0;
 const outcome=await deliver('job','123456789',input,{retryAttempts:3,shouldStop:()=>stop,retryWait:async()=>{stop=true;},fetcher:async()=>{calls++;throw Error('connection lost');}});
 assert.equal(calls,1);assert.equal(outcome.status,'stopped');assert.equal(outcome.receiptConfirmed,false);assert.equal(outcome.productId,null);
});

test('automatic delivery prioritizes option images, reuses saved originals and preserves excluded images',async()=>{
 const source={...input,options:[{...input.options[0],imageIndex:3}],images:Array.from({length:5},(_,i)=>({url:`https://cbu01.alicdn.com/${i}.png`,role:i===0?'main':'detail'}))};
 const saved=[];let reads=0;
 const outcome=await actualDeliver('job','123456789',source,{fetcher:async(url,init)=>{
  if(url.endsWith('/result'))return reply({jobId:'job',offerId:'123456789',receipt:{result:receipt(init.body)}});
  if(url.endsWith('/capacity')){reads++;return reply({capacity:{usedSlots:49,totalImages:5,reusableIndices:[4],blockedIndices:[0]}});}
  if(url.endsWith('/product'))return reply({productId:'p'});
  saved.push(JSON.parse(init.body).index);return reply({key:'saved'});
 }});
 assert.equal(outcome.status,'completed');assert.deepEqual(saved,[3,4]);assert.equal(reads,2);assert.match(outcome.warnings[0],/나머지 3개/);
});

test('automatic delivery reports no room without dropping the product and stops on invalid capacity or a capacity race',async()=>{
 for(const mode of ['full','invalid','race','stop']){
  let reads=0,stop=false;const writes=[];
  const outcome=await actualDeliver('job','123456789',input,{retryAttempts:1,shouldStop:()=>stop,fetcher:async(url,init)=>{
   if(url.endsWith('/result'))return reply({jobId:'job',offerId:'123456789',receipt:{result:receipt(init.body)}});
   if(url.endsWith('/capacity')){reads++;if(mode==='stop')stop=true;return reply({capacity:{usedSlots:mode==='full'||(mode==='race'&&reads===2)?50:0,totalImages:mode==='invalid'?99:1,reusableIndices:[]}});}
   writes.push(url);return reply({productId:'p',key:'image'});
  }});
  assert.equal(outcome.receiptConfirmed,true);
  if(mode==='full'){assert.equal(outcome.status,'completed');assert.equal(outcome.completedImages,0);assert.match(outcome.warnings[0],/나머지 1개/);assert.deepEqual(writes,['/api/collection-jobs/job/product']);}
  else{assert.equal(outcome.status,mode==='stop'?'stopped':'failed');assert.deepEqual(writes,[]);}
 }
});
