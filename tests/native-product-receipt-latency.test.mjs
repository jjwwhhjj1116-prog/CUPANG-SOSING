import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
import {createProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
import {nativeReviewFixture,companies,syntheticObservation} from './helpers/native-source-review.mjs';

const native=createRequire(import.meta.url),origin='https://app.test',delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function client(){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {exports,Error,Date,URL,TextEncoder,TextDecoder,Uint8Array,AbortController,structuredClone,crypto:webcrypto,window:{location:{origin}},setTimeout,clearTimeout,
    require:name=>name.startsWith('@/')?load(name.slice(2)+'.ts'):name.endsWith('.mjs')?native(fileURLToPath(new URL('../'+path.posix.join(path.posix.dirname(file),name),import.meta.url))):native(name)});
  return exports;
 }
 return load('app/supplier-hub-product-client.ts');
}
async function fixture(company){
 const f=await nativeReviewFixture(company),review=await f.model.compileNativeSupplierHubProductDocument(f.input),packet=await createProductDocumentPacket(review),
  observation=syntheticObservation(review,{requestId:packet.requestId,origin}),route=f.h.load('app/api/products/[id]/supplier-hub-product-receipt/route.ts');
 const request=async(url,init={})=>{
  if(url==='/api/supplier-hub/catalog-context')return f.h.load('app/api/supplier-hub/catalog-context/route.ts').GET();
  assert.equal(url,f.base+'/supplier-hub-product-receipt');
  return route[init.method??'GET'](new Request(origin+url,init),f.context);
 };
 return{...f,review,packet,observation,route,request};
}

test('both companies save a valid native receipt within the unchanged client15s deadline under bounded storage latency',async t=>{
 const outcomes=await Promise.allSettled(companies.map(async company=>{
  const f=await fixture(company);try{
   const before=f.state(),counts={prepares:0,db:0,get:0,head:0},prepare=f.h.db.prepare,get=f.h.bindings.FILES.get,head=f.h.bindings.FILES.head;
   f.h.db.prepare=sql=>{counts.prepares++;const statement=prepare(sql);for(const method of ['all','first','run']){const original=statement[method];if(original)statement[method]=async(...args)=>{counts.db++;await delay(70);return original(...args);};}return statement;};
   f.h.bindings.FILES.get=async(...args)=>{counts.get++;await delay(150);return get(...args);};
   f.h.bindings.FILES.head=async(...args)=>{counts.head++;await delay(150);return head(...args);};
   const started=performance.now(),saved=await client().saveProductReceiptObservation({packet:f.packet,observation:f.observation},new AbortController().signal,f.request),elapsedMs=Math.round(performance.now()-started);
   assert.equal(saved.receipt.sourceStatus,'SUBMITTED');assert.equal(saved.requestId,f.packet.requestId);assert.ok(elapsedMs<15000);
   assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_single_receipts').get().n,1);assert.equal(f.state(),before);assert.deepEqual(f.h.network,[]);
   t.diagnostic(JSON.stringify({company:company.code,images:f.sourcePlan.images.length,elapsedMs,...counts}));
  }finally{f.close();}
 }));
 for(const outcome of outcomes)if(outcome.status==='rejected')throw outcome.reason;
});

test('delayed final native guards and receipt CAS reject source, member, same-key bytes and metadata drift without a receipt row',async()=>{
 for(const company of companies)for(const kind of ['source','member','bytes','metadata']){
  const f=await fixture(company);try{
   const loader=f.h.load('app/exports/single-package.ts'),load=loader.loadSinglePackage;let checked=false;
   loader.loadSinglePackage=async(...args)=>{
    const loaded=await load(...args),guard=loaded.nativeAssetSourceGuard;
    loaded.nativeAssetSourceGuard=async()=>{
     checked=true;await delay(5);
     if(kind==='source')f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run(new Date(Date.now()+1).toISOString(),f.id);
     else if(kind==='member')f.h.sqlite.prepare("UPDATE members SET status='rejected' WHERE id='owner'").run();
     else{
      const key=f.sourcePlan.images[0].key,bytes=new Uint8Array(f.h.objects.get(key)),metadata=await f.h.bindings.FILES.head(key);
      if(kind==='bytes')bytes[bytes.length-1]^=1;
      await f.h.bindings.FILES.put(key,bytes,{httpMetadata:metadata.httpMetadata,customMetadata:{...metadata.customMetadata,...(kind==='metadata'?{changedAfterReview:'true'}:{})}});
     }
     await guard();
    };
    return loaded;
   };
   await assert.rejects(client().saveProductReceiptObservation({packet:f.packet,observation:f.observation},new AbortController().signal,f.request));
   assert.equal(checked,true,kind);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_single_receipts').get().n,0,kind);assert.deepEqual(f.h.network,[]);
  }finally{f.close();}
 }
});

test('unknown native fingerprints and malformed native body proofs cannot enter the legacy verifier or store a receipt',async()=>{
 for(const kind of ['fingerprint','body']){
  const f=await fixture(companies[0]);try{
   const loader=f.h.load('app/exports/single-package.ts'),load=loader.loadSinglePackage,calls=[];
   loader.loadSinglePackage=async(...args)=>{calls.push(args[8]?.nativeReadOnly===true);return load(...args);};
   if(kind==='fingerprint')f.observation.identity.fingerprint='f'.repeat(64);else f.observation.preparedBodySha256='f'.repeat(64);
   const response=await f.request(f.base+'/supplier-hub-product-receipt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profileId:f.profile.id,observation:f.observation})});
   assert.equal(response.status,409);assert.deepEqual(calls,[true]);assert.equal(f.h.sqlite.prepare('SELECT count(*) n FROM supplier_hub_single_receipts').get().n,0);assert.deepEqual(f.h.network,[]);
  }finally{f.close();}
 }
});
