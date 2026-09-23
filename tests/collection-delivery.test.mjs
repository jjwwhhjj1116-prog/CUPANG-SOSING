import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,TextEncoder,require:name=>load(name.slice(2)+'.ts')});return exports;}
const {deliverCollectionResult:actualDeliver}=load('app/collection-delivery.ts');
const deliver=(job,offer,input,options={})=>actualDeliver(job,offer,input,{...options,fetcher:async(url,init)=>url.endsWith('/capacity')?reply({capacity:{usedSlots:0,totalImages:input.images.length,reusableIndices:[]}}):options.fetcher(url,init)});
const input={schemaVersion:1,sourceUrl:'https://detail.1688.com/offer/123456789.html',provider:'synthetic-test',collectedAt:'2026-01-01T00:00:00Z',title:'합성 검증',description:'',options:[{sku:'a',name:'옵션',unitPriceCny:2,minimumOrder:1,stock:null}],images:[{url:'https://cbu01.alicdn.com/a.png',role:'main'}]};
const reply=(body,status=200)=>({ok:status===200,json:async()=>body});
const receipt=body=>({...JSON.parse(body),offerId:'123456789'});
test('delivery confirms normalized receipt before product and selected images without paid or submission calls',async()=>{
 const calls=[];const result=await deliver('job','123456789',input,{fetcher:async(url,init)=>{calls.push(url);if(url.endsWith('/result'))return reply({receipt:{result:receipt(init.body)}});return reply(url.endsWith('/product')?{productId:'p'}:{key:'owner/a'});}});
 assert.equal(result.status,'completed');assert.equal(result.receiptConfirmed,true);assert.equal(result.completedImages,1);
 assert.deepEqual(calls,['/api/collection-jobs/job/result','/api/collection-jobs/job/product','/api/collection-jobs/job/images']);
 assert.equal(input.collectedAt,'2026-01-01T00:00:00Z');
});
test('invalid identity or selections write nothing and uncertain or mismatched receipts never promote',async()=>{
 let calls=0;const unused=async()=>{calls++;};
 await assert.rejects(()=>deliver('job','987654321',input,{fetcher:unused}));
 await assert.rejects(()=>deliver('job','123456789',input,{fetcher:unused,imageIndices:[5]}));assert.equal(calls,0);
 for(const respond of [()=>reply({},503),()=>reply({}),body=>reply({receipt:{result:{...receipt(body),title:'다른 원문'}}}),()=>{throw Error('connection lost');}]){
  calls=0;const result=await deliver('job','123456789',input,{fetcher:async(_url,init)=>{calls++;return respond(init.body);}});
  assert.equal(result.status,'failed');assert.equal(result.receiptConfirmed,false);assert.equal(calls,1);
 }
});
test('stop after receipt and retry after image failure preserve confirmed progress',async()=>{
 let stop=false;const stopped=await deliver('job','123456789',input,{shouldStop:()=>stop,fetcher:async(_url,init)=>{stop=true;return reply({receipt:{result:receipt(init.body)}});}});
 assert.equal(stopped.status,'stopped');assert.equal(stopped.receiptConfirmed,true);assert.equal(stopped.productId,null);
 let fail=true;const fetcher=async(url,init)=>url.endsWith('/result')?reply({receipt:{result:receipt(init.body)}}):url.endsWith('/product')?reply({productId:'same'}):fail?reply({error:'image unavailable'},503):reply({key:'owner/a'});
 const first=await deliver('job','123456789',input,{fetcher});assert.equal(first.status,'failed');assert.equal(first.receiptConfirmed,true);assert.equal(first.productId,'same');
 fail=false;const second=await deliver('job','123456789',input,{fetcher});assert.equal(second.status,'completed');assert.equal(second.productId,'same');
});

test('delivery retains receipt confirmation when capacity rejects the selected images',async()=>{
 const calls=[];const outcome=await actualDeliver('job','123456789',input,{fetcher:async(url,init)=>{calls.push(url);if(url.endsWith('/result'))return reply({receipt:{result:receipt(init.body)}});return reply({capacity:{usedSlots:50,totalImages:1,reusableIndices:[]}});}});
 assert.equal(outcome.status,'failed');assert.equal(outcome.receiptConfirmed,true);assert.equal(outcome.productId,null);assert.equal(outcome.completedImages,0);
 assert.deepEqual(calls,['/api/collection-jobs/job/result','/api/collection-jobs/job/capacity']);
});
