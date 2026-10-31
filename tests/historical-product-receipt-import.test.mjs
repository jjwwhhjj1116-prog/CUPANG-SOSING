import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {nativeReviewFixture,companies,plain,digest,json} from './helpers/native-source-review.mjs';
import {sha} from './helpers/supplier-hub-single-assets.mjs';
import {SINGLE_SENDER} from './helpers/supplier-hub-single-document.mjs';
import {createProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
import {productDocumentIdentity} from '../extensions/supplier-hub/product-document-receiver.mjs';
import * as historical from '../extensions/supplier-hub/preserved-product-receipt.mjs';

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa897',requestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb897';
const origin=new URL(SINGLE_SENDER.url).origin,routeFile='app/api/products/[id]/supplier-hub-product-history-import/route.ts',modelFile='app/historical-product-receipt-import.ts';

async function fixture(company=companies[0]){
 const f=await nativeReviewFixture(company,{productId:id});
 try{
  // Generate a real immutable edited PNG record, select it in the actual
  // saved product, and compile the original review through production logic.
  // Removing only its sidecar below models a formerly saved legacy image.
  const records=f.h.load('app/free-image-edit-record.ts'),view=await f.fields(),bytes=f.h.objects.get(f.keys[0]);
  const source={productId:f.id,productVersion:view.productVersion,contentRevision:view.contentRevision,sourceKey:f.keys[0],sourceSha256:sha(bytes),role:'main',width:1,height:1,
   quotationTarget:{kind:'quotation',profileId:f.profile.id,optionId:'synthetic-one',input:'mainImage',fieldKey:f.byWire(['imagePage','images','mainImage']),slotIndex:0,revision:view.revision,
    inputFingerprint:view.inputFingerprint,optionRevision:view.optionRevision,bindingSha256:'8'.repeat(64),value:f.keys[0]}};
  const document={format:'free-image-edit-v1',width:1,height:1,sourceLanguage:'zh',regions:[]},outputSha=sha(bytes),key=(await records.freeImageEditOutputKey(source,document,outputSha)).key;
  const prepared=await records.prepareFreeImageEditRecord(source,document,view.categoryContext,company,{key,sha256:outputSha,bytes:bytes.length,width:1,height:1});
  await f.h.bindings.FILES.put(key,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{freeImageEditDocumentSha256:prepared.documentSha256,freeImageEditRecordSha256:prepared.recordSha256,
   freeImageOutputSha256:outputSha,freeImageSourceSha256:sha(new TextEncoder().encode(f.h.load('app/free-image-translation.ts').freeImageSourceIdentity(source))),imageWidth:'1',imageHeight:'1'}});
  await f.h.bindings.FILES.put(key+'.edit.json',new Uint8Array(prepared.bytes),{httpMetadata:{contentType:'application/json'}});
  const get=f.h.bindings.FILES.get;f.h.bindings.FILES.get=async key=>{const object=await get(key);return object&&key.endsWith('.edit.json')?{...object,body:new Response(await object.arrayBuffer()).body}:object;};
  f.h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([...view.imageKeys,key]),f.id);
  const contentDB=f.h.load('db/product-content.ts'),content=await contentDB.readProductContent('owner',f.id),updated=f.h.load('app/product-content.ts').applyContentPatch(content,{assets:{main:[key]}},new Date().toISOString());
  await contentDB.saveProductContent('owner',updated,content.revision);
  const plan=await f.source(),quotationView=await f.fields();assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues));
  const review=plain(await f.model.compileNativeSupplierHubProductDocument({...f.input,sourcePlan:plan,quotationView}));
  f.h.objects.delete(key+'.edit.json');
  const blocked=await f.source();assert.equal(blocked.metadataValid,false);assert.equal(blocked.sourcePlanSha256,null);assert.equal(blocked.originalBodySha256,null);assert.ok(blocked.body);
  assert.ok(blocked.issues.some(issue=>issue.code==='FREE_IMAGE_TRANSLATION_UNCONFIRMED'));assert.equal(digest(blocked.body),review.originalBodySha256);

  // Only these two new TS modules need an ESM bridge. All package, snapshot,
  // authentication and DB dependencies use the unchanged actual API harness.
  const cache=new Map();function load(file){
   if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
   vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,Error,Date,URL,Request,Response,Headers,TextEncoder,TextDecoder,Uint8Array,AbortController,crypto:webcrypto,require:name=>{
     if(name==='../extensions/supplier-hub/preserved-product-receipt.mjs')return historical;
     if(name==='next/server')return{NextResponse:Response};if(name==='@/app/chatgpt-auth')return f.h.auth;if(name==='@/app/historical-product-receipt-import')return load(modelFile);
     assert.ok(name.startsWith('@/'),name);return f.h.load(name.slice(2)+'.ts');
    }},{filename:file});return exports;
  }
  const api=load(routeFile),model=load(modelFile),endpoint=f.base+'/supplier-hub-product-history-import';
  const post=(candidate,options={})=>api.POST(new Request(origin+endpoint,{method:'POST',headers:{'content-type':'application/json',origin,...options.headers},body:JSON.stringify(options.body??{action:'import-history',candidate}),signal:options.signal}),f.context);
  const build=async({request=requestId,docId=897001,qvtRequestId='cccccccc-cccc-4ccc-8ccc-ccccccccc897',status='FINISHED',checkedAt=Date.now(),observedAt=checkedAt}={})=>{
   const packet=await createProductDocumentPacket(review,{requestId:request}),context=await productDocumentIdentity(packet,SINGLE_SENDER),target={requestId:request,productId:f.id,docId,company:plain(company),qvtRequestId};
   const ownedTarget={tabId:71,windowId:context.identity.windowId,origin:'https://supplier.coupang.com',requestId:request,packetDigest:context.packetDigest};
   const checkpoint={format:review.format,draftOnly:true,state:'updated',key:context.key,laneKey:context.laneKey,identity:plain(context.identity),identityDigest:context.identityDigest,packetDigest:context.packetDigest,
    originalBodySha256:context.originalBodySha256,bodySha256:context.bodySha256,requestId:request,docId,sequence:12,updatedAt:checkedAt-1,baselineDocIds:[],ownedTarget,tab:{...ownedTarget,authenticated:true,company:plain(company)}};
   const currentSource=await historical.historicalProductReceiptSourceFromNativePlan({plan:blocked,requestedProfileId:review.identity.requestedProfileId,productName:blocked.body.productName,categoryPath:blocked.body.categoryPath});
   const anchor=await historical.historicalProductReceiptAnchor({target,checkpoint,scope:{origin,ownerId:'owner',company},currentSource,checkedAt});
   const readResult={format:'yoofam-historical-product-receipt-read-v1',readOnly:true,remoteWrites:false,row:{docId,status,qvtRequestId,productName:blocked.body.productName,categoryPath:blocked.body.categoryPath,modifiedAt:new Date(checkedAt).toISOString(),remark:''},
    provenance:{method:'GET',url:historical.HISTORICAL_PRODUCT_RECEIPT_URL,status:200,redirected:false,contentType:'application/json',cache:'no-store',company:plain(company),docId,qvtRequestId,
     identityDigest:context.identityDigest,packetDigest:context.packetDigest,requestId:request,tabId:71,windowId:context.identity.windowId,documentId:'dddddddd-dddd-4ddd-8ddd-ddddddddd897',readId:anchor.readId,observedAt,
     observedTab:{tabId:71,windowId:context.identity.windowId,documentId:'dddddddd-dddd-4ddd-8ddd-ddddddddd897',selection:'original-owned-tab',originalTabId:71,originalTabAbsent:false}}};
   return plain(historical.normalizeHistoricalProductReceipt({anchor,readResult,now:checkedAt}));
  };
  const candidate=await build(),rows=()=>f.h.sqlite.prepare('SELECT rowid,* FROM supplier_hub_single_receipts ORDER BY rowid').all();
  return {...f,review,plan:blocked,key,candidate,post,build,rows,model,company,importInput:{origin,ownerId:'owner',productId:f.id,company,plan:blocked}};
 }catch(error){f.close();throw error;}
}

for(const company of companies)test(`${company.code}: exact historical checkpoint plus official typed row imports and replays one local receipt despite selected legacy image readiness failure`,async()=>{
 const f=await fixture(company);try{
  const source=f.state(),images=f.objectState(),result=await json(await f.post(f.candidate));
  assert.equal(result.format,'yoofam-historical-product-receipt-import-v1');assert.equal(result.remoteWrites,false);assert.equal(result.canResume,false);
  const saved=result.receipt;assert.equal(saved.receipt.sourceStatus,'FINISHED');assert.equal(saved.receipt.state,'accepted');assert.equal(saved.docId,897001);assert.equal(saved.receipt.qvtRequestId,f.candidate.anchor.target.qvtRequestId);
  assert.equal(saved.requestId,requestId);assert.deepEqual(saved.identity,f.candidate.anchor.identity);assert.equal(saved.originalBodySha256,f.review.originalBodySha256);assert.equal(saved.preparedBodySha256,f.review.preparedBodySha256);assert.equal(saved.registered,false);
  const row=f.rows()[0],again=await json(await f.post(f.candidate));assert.deepEqual(again,result);assert.equal(f.rows().length,1);assert.equal(f.rows()[0].rowid,row.rowid);assert.equal(f.rows()[0].created_at,row.created_at);
  assert.equal(f.state(),source);assert.equal(f.objectState(),images);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('initial history import rejects wrong typed document/QVT, actor, source, body and claimed capabilities without any local receipt',async()=>{
 const f=await fixture();try{
  const before=f.state(),images=f.objectState(),mutations=[
   value=>value.anchor.target.docId=String(value.anchor.target.docId),value=>value.officialRow.docId++,value=>value.receipt.docId=String(value.receipt.docId),
   value=>value.provenance.qvtRequestId=897002,value=>value.receipt.qvtRequestId=897002,value=>value.officialRow.productName+=' changed',value=>value.officialRow.categoryPath+=' changed',
   value=>value.anchor.identity.ownerId='other',value=>value.anchor.identity.company=companies[1],value=>value.anchor.identity.source.optionRevision++,
   value=>value.anchor.currentSource.inputFingerprint='f'.repeat(64),value=>value.anchor.identity.schemaSha256='f'.repeat(64),value=>value.anchor.identity.members.reverse(),
   value=>value.anchor.originalBodySha256='f'.repeat(64),value=>value.anchor.preparedBodySha256='f'.repeat(64),value=>value.anchor.ownedTarget.requestId='different',
   value=>value.readOnly=false,value=>value.canResume=true,value=>value.remoteWrites=true,value=>value.checkpointWrites=true,value=>value.receipt.registered=true,
   value=>value.provenance.method='POST',value=>value.provenance.redirected=true,value=>value.provenance.contentType='text/html',value=>value.provenance.url='https://elsewhere.invalid/',
   value=>value.provenance.observedAt=Date.now()-120000,value=>value.anchor.checkedAt=Date.now()-180000,
  ];
  for(const mutate of mutations){const candidate=plain(f.candidate);mutate(candidate);await json(await f.post(candidate),409);assert.equal(f.rows().length,0);}
  f.h.setCompany(companies[1]);await json(await f.post(f.candidate),409);f.h.setCompany(companies[0]);
  f.h.setMembershipStatus('rejected');await json(await f.post(f.candidate),409);f.h.setMembershipStatus('approved');
  assert.equal(f.state(),before);assert.equal(f.objectState(),images);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('the server independently hashes available historical body rather than accepting re-signed candidate claims',async()=>{
 const f=await fixture();try{
  for(const field of ['originalBodySha256','preparedBodySha256']){
   const candidate=plain(f.candidate),a=candidate.anchor;a[field]='f'.repeat(64);
   const logical=Object.fromEntries(Object.entries(a.identity).filter(([key])=>!['appTabId','windowId'].includes(key)));
   a.packetDigest=digest({identity:logical,bodySha256:a.preparedBodySha256,originalBodySha256:a.originalBodySha256});a.ownedTarget.packetDigest=a.packetDigest;candidate.provenance.packetDigest=a.packetDigest;candidate.receipt.preparedBodySha256=a.preparedBodySha256;
   await historical.validateHistoricalProductReceiptCandidate(candidate,{scope:{origin,ownerId:'owner',company:f.company},currentSource:a.currentSource});
   await json(await f.post(candidate),409);assert.equal(f.rows().length,0);
  }
  const missing=plain(f.plan);missing.body=null;await assert.rejects(f.model.historicalProductReceiptImport(f.candidate,{...f.importInput,plan:missing}));assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('import requires same-origin explicit form, bounded exact action and current saved source before insertion',async()=>{
 const f=await fixture();try{
  for(const headers of [{origin:''},{origin:'https://elsewhere.invalid'},{'sec-fetch-site':'cross-site'}])await json(await f.post(f.candidate,{headers}),403);
  for(const body of [{action:'save',candidate:f.candidate},{action:'import-history',candidate:f.candidate,canResume:true},{candidate:f.candidate}])await json(await f.post(f.candidate,{body}),400);
  await json(await f.post(f.candidate,{body:{action:'import-history',candidate:'x'.repeat(256*1024)}}),413);assert.equal(f.rows().length,0);
  f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-20T00:00:00.000Z',f.id);
  const before=f.state();await json(await f.post(f.candidate),409);assert.equal(f.rows().length,0);assert.equal(f.state(),before);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('duplicate document or typed QVT on another request cannot create a second local receipt',async()=>{
 const f=await fixture();try{
  await json(await f.post(f.candidate));const initial=f.rows()[0];
  for(const ids of [{docId:897001,qvtRequestId:'different-qvt'},{docId:897002,qvtRequestId:f.candidate.receipt.qvtRequestId}]){
   const candidate=await f.build({request:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb898',...ids});await json(await f.post(candidate),409);assert.equal(f.rows().length,1);assert.equal(f.rows()[0].payload,initial.payload);
  }
  assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});

test('current source, quotation revision and approved-member changes at receipt SQL insertion fail CAS without a row',async()=>{
 for(const mode of ['source','quotation','member']){const f=await fixture();try{
  const prepare=f.h.db.prepare;let injected=false;f.h.db.prepare=sql=>{const query=prepare(sql),first=query.first;if(/^INSERT INTO supplier_hub_single_receipts/u.test(sql.trim()))query.first=async()=>{
   f.h.db.prepare=prepare;injected=true;
   if(mode==='source')f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-21T00:00:00.000Z',f.id);
   if(mode==='quotation')f.h.sqlite.prepare('UPDATE product_quotation_fields SET revision=revision+1 WHERE product_id=?').run(f.id);
   if(mode==='member')f.h.sqlite.prepare("UPDATE members SET status='rejected' WHERE id='owner'").run();
   return first.call(query);
  };return query;};
  await json(await f.post(f.candidate),409);assert.equal(injected,true,mode);assert.equal(f.rows().length,0);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}}
});

test('a later imported observation cannot regress accepted or rejected receipt evidence',async()=>{
 const f=await fixture();try{
  await json(await f.post(f.candidate));const accepted=f.rows()[0];
  await json(await f.post(await f.build({status:'SUBMITTED',checkedAt:Date.now()+1})),409);assert.equal(f.rows()[0].payload,accepted.payload);
  const rejected=await json(await f.post(await f.build({status:'REJECTED',checkedAt:Date.now()+2})));assert.equal(rejected.receipt.receipt.state,'rejected');const row=f.rows()[0];
  await json(await f.post(await f.build({status:'FINISHED',checkedAt:Date.now()+3})),409);assert.equal(f.rows()[0].payload,row.payload);assert.equal(f.rows().length,1);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
