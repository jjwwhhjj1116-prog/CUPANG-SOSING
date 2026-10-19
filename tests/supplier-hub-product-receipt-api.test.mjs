import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {assetApiFixture,companies,plain} from './helpers/supplier-hub-single-assets.mjs';
import {createProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
import {productDocumentIdentity} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {SINGLE_SENDER} from './helpers/supplier-hub-single-document.mjs';
import {normalizeRejectionDetails} from '../extensions/supplier-hub/rejection-details.mjs';

const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const cases=[];
after(()=>{fs.writeFileSync(new URL('../outputs/step728-product-receipt-test-proof.json',import.meta.url),JSON.stringify({cases,boundary:'Actual handlers + isolated SQLite + local synthetic asset bytes; complete ordered 2-member document plus excluded member. No external calls, real product edits, migration, Hub registration, SKU inference or live receipt claim.',externalRequests:0,realProductWrites:0,hubWrites:0,registered:false},null,2)+'\n');});

function observation(review,{requestId='72800000-0000-4000-8000-000000000001',origin='https://app.test',docId=728001,qvtRequestId=728101,observedAt=Date.now(),status='SUBMITTED'}={}){
 const scope=review.identity,source=Object.fromEntries(['productVersion','contentRevision','optionRevision','quotationRevision','profileRevision'].map(key=>[key,scope.source[key]]));
 const logical={origin,ownerId:scope.ownerId,accountContext:digest(['sourceflow-managed-product-account-v1',scope.ownerId,scope.company.code,scope.company.name]),company:plain(scope.company),productId:scope.productId,
  profileId:scope.profileId,requestedProfileId:scope.requestedProfileId,categoryId:scope.categoryId,fingerprint:scope.fingerprint,inputFingerprint:scope.inputFingerprint,schemaSha256:scope.schemaSha256,source,members:plain(review.members)};
 const identity={...logical,appTabId:71,windowId:5},identityDigest=digest(identity),packetDigest=digest({identity:logical,bodySha256:review.preparedBodySha256,originalBodySha256:review.originalBodySha256});
 const state={SUBMITTED:'pending',FINISHED:'accepted',REJECTED:'rejected'}[status];
 return{format:review.format,requestId,identity,identityDigest,packetDigest,originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256,state,docId,registered:false,success:false,needsRecovery:false,
  receipt:{state,docId,company:plain(scope.company),identityDigest,preparedBodySha256:review.preparedBodySha256,observedAt,receiptId:qvtRequestId,qvtRequestId,sourceStatus:status,evidence:'document-receipt',registered:false}};
}
async function fixture(company=companies[0],captured=false){
 const f=await assetApiFixture(company),now=new Date().toISOString(),email=company.code==='A01526306'?'jwhj1116@kakao.com':'unari8484@gmail.com',role=company.code==='A01526306'?'admin':'member';
 f.h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('owner',email,'synthetic-no-password',role,'approved',company.code,company.name,now,now);
 if(captured){
  const category={name:f.profile.name,categoryId:f.profile.categoryId,categoryPath:f.profile.categoryPath,template:null,mappings:[],hubSchema:f.snapshot};
  f.h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify({...plain(f.h.context),company:plain(company),category}),'job');
  f.h.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run(f.h.sourceUrl,f.id);
  f.h.sqlite.prepare('INSERT INTO collection_products VALUES(?,?,?,?)').run('job','owner',f.id,now);
 }
 const profileId=captured?null:f.profile.id,query=captured?'':f.query,fieldPath=f.base+'/quotation-fields'+query,packagePath=f.base+'/supplier-hub-single-package'+query;
 let fields=await json(await f.h.route(fieldPath));
 const changes=[{fieldKey:f.byWire(['startPage','productName']),optionId:'synthetic-one',value:'전체 상품 첫째'},
  {fieldKey:f.byWire(['startPage','productName']),optionId:'synthetic-two',value:'전체 상품 둘째'},
  {fieldKey:f.byWire(['productPage','modelNumber']),optionId:'synthetic-two',value:'SECOND-MODEL-728'},
  ...[['supplyPrice','3333',['productPage','commonAttributes','purchasePrice']],['salePrice','4444',['productPage','commonAttributes','coupangSalePrice']],['msrp','5555',['productPage','commonAttributes','msrp']]]
   .flatMap(([key,value,path])=>[...new Set([key,f.byWire(path)])].map(fieldKey=>({fieldKey,optionId:'synthetic-two',value})))];
 fields=await json(await f.h.route(fieldPath,{method:'PUT',body:{expectedRevision:fields.revision,expectedInputFingerprint:fields.inputFingerprint,changes}}));
 const unprepared=await json(await f.h.route(packagePath)),prepared=await json(await f.h.route(packagePath,{method:'POST',body:{action:'prepare',expectedFingerprint:unprepared.fingerprint}}));
 const review=plain(await f.h.load('app/supplier-hub-product-document.ts').compileSupplierHubProductDocument({packageView:prepared,quotationView:fields,ownerId:'owner'}));
 const endpoint=f.base+'/supplier-hub-product-receipt',value=observation(review),post=(item=value)=>f.h.route(endpoint,{method:'POST',body:{profileId,observation:item}});
 return {...f,company,member:{id:'owner',email,role,companyCode:company.code,companyName:company.name},profileId,query,fieldPath,packagePath,fields,prepared,review,endpoint,observation:value,post,
  history:()=>f.h.route(endpoint+query).then(json),model:f.h.load('app/supplier-hub-product-receipt.ts'),store:f.h.load('db/supplier-hub-single-receipts.ts')};
}
async function legacy(f,{requestId='legacy-728',docId=728002,qvtRequestId=728102,status='SUBMITTED',observedAt=Date.now()}={}){
 const packet=plain(await f.h.load('app/supplier-hub-single-client.ts').singlePackagePacket(f.prepared,'owner','synthetic-one'));
 const logical={origin:'https://app.test',...Object.fromEntries(['ownerId','accountContext','company','productId','profileId','optionId','categoryId','fingerprint','schemaSha256','source'].map(key=>[key,packet[key]]))};
 const identity={...logical,appTabId:71,windowId:5},deferred=plain(packet.body);
 for(const key of ['msrpAgree','labelContactAgreed'])if(Object.hasOwn(deferred.jsonDocument[0].imagePage,key))deferred.jsonDocument[0].imagePage[key]=false;
 const preparedBodySha256=digest(deferred),originalBodySha256=digest(packet.body),identityDigest=digest(identity),packetDigest=digest({identity:logical,bodySha256:preparedBodySha256,originalBodySha256}),state={SUBMITTED:'pending',FINISHED:'accepted',REJECTED:'rejected'}[status];
 const value={format:packet.format,requestId,identity,identityDigest,packetDigest,preparedBodySha256,originalBodySha256,state,docId,registered:false,success:false,needsRecovery:false,
  receipt:{state,docId,company:f.company,identityDigest,preparedBodySha256,observedAt,receiptId:qvtRequestId,qvtRequestId,sourceStatus:status,evidence:'document-receipt',registered:false}};
 return f.h.route(f.base+'/supplier-hub-single-receipt',{method:'POST',body:{profileId:f.profile.id,optionId:'synthetic-one',observation:value}});
}
const count=f=>f.h.sqlite.prepare('SELECT count(*) AS n FROM supplier_hub_single_receipts').get().n;
function beforeInsert(f,callback){const original=f.h.db.prepare;f.h.db.prepare=sql=>{const query=original(sql),first=query.first;if(/^INSERT INTO supplier_hub_single_receipts/u.test(sql.trim()))query.first=async()=>{f.h.db.prepare=original;callback();return first.call(query);};return query;};}

for(const company of companies)test(company.name+' product API rejection details survive save, history, newer observation and old ACK retry',async()=>{
 const f=await fixture(company);try{
  const before=f.state(),objects=f.objectState(),value=plain(f.observation);value.state=value.receipt.state='rejected';value.receipt.sourceStatus='REJECTED';
  value.receipt.rejectionDetails=normalizeRejectionDetails(JSON.stringify({errors:[{columnName:'포장 무게',message:'양수 필요'}]}));
  const first=await json(await f.post(value));assert.deepEqual(first.receipt.receipt.rejectionDetails,value.receipt.rejectionDetails);
  const later=plain(value);later.receipt.observedAt++;later.receipt.rejectionDetails=normalizeRejectionDetails(JSON.stringify({errors:[{columnName:'포장 크기',message:'세 변 입력'}]}));
  const fresh=await json(await f.post(later)),retry=await json(await f.post(value));assert.deepEqual(retry.receipt,fresh.receipt);
  assert.deepEqual((await f.history()).receipts[0].receipt.rejectionDetails,later.receipt.rejectionDetails);
  const malformed=plain(later);malformed.receipt.rejectionDetails.errors[0].extra='not allowed';await json(await f.post(malformed),409);
  assert.equal(count(f),1);assert.equal(f.state(),before);assert.equal(f.objectState(),objects);assert.equal(f.h.network.length,0);
 }finally{f.close();}
});

for(const company of companies)test('full included product receipt persists one document and no SKU claim ('+company.code+')',async()=>{
 const f=await fixture(company);try{
  const before=f.state(),objects=f.objectState(),schema=f.h.sqlite.prepare("SELECT name,sql FROM sqlite_schema WHERE type IN ('table','index') ORDER BY name").all();
  const first=await json(await f.post());assert.equal(count(f),1);assert.equal(first.receipt.format,'yoofam-product-document-receipt-v1');assert.equal(first.receipt.recordType,'product-document');
  assert.equal(first.receipt.members.length,2);assert.deepEqual(first.receipt.members.map(row=>row.optionId),['synthetic-one','synthetic-two']);assert.equal(Object.hasOwn(first.receipt,'optionId'),false);assert.equal(first.receipt.registered,false);
  assert.equal(JSON.stringify(first.receipt).includes('synthetic-excluded'),false);assert.equal(JSON.stringify(first.receipt).includes('skuId'),false);assert.equal(first.receipt.originalBodySha256,digest(f.prepared.payload));
  const accepted=plain(f.observation);accepted.state=accepted.receipt.state='accepted';accepted.receipt.sourceStatus='FINISHED';accepted.receipt.observedAt+=1;
  await json(await f.post(accepted));await json(await f.post(accepted));const history=await f.history();assert.equal(history.format,'yoofam-native-receipt-history-v1');assert.equal(history.receipts.length,1);assert.equal(history.receipts[0].receipt.sourceStatus,'FINISHED');assert.equal(history.receipts[0].registered,false);
  const detail=await json(await f.h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test'+f.base),{params:Promise.resolve({id:f.id})}));
  assert.equal(detail.product.hub_single_receipt.optionCount,2);assert.equal(detail.product.hub_single_receipt.format,'yoofam-product-document-receipt-summary-v1');assert.equal(detail.product.hub_single_receipt.docId,728001);
  assert.equal(Object.hasOwn(detail.product.hub_single_receipt,'optionId'),false);assert.equal(detail.product.hub_single_receipt.registered,false);assert.equal(detail.product.removal_policy.blocked,true);
  assert.equal(f.state(),before);assert.equal(f.objectState(),objects);assert.deepEqual(f.h.sqlite.prepare("SELECT name,sql FROM sqlite_schema WHERE type IN ('table','index') ORDER BY name").all(),schema);assert.deepEqual(f.h.network,[]);
  cases.push({name:'one actual SQLite group '+company.code,included:2,excluded:1,rows:1,registered:false,realSourceOrHubCalls:0});
 }finally{f.close();}
});
test('browser identity and whole-body hashes match the independent extension boundary',async()=>{
 const f=await fixture();try{
  const packet=await createProductDocumentPacket(f.review),context=await productDocumentIdentity(packet,SINGLE_SENDER),origin=new URL(SINGLE_SENDER.url).origin;
  const value=observation(f.review,{origin});value.identity=plain(context.identity);value.identityDigest=context.identityDigest;value.packetDigest=context.packetDigest;value.receipt.identityDigest=context.identityDigest;
  const receipt=await f.model.validateProductReceiptObservation(value,f.review,origin);assert.equal(receipt.identityDigest,context.identityDigest);assert.equal(receipt.packetDigest,context.packetDigest);
  assert.equal(receipt.preparedBodySha256,context.bodySha256);assert.equal(receipt.members.length,2);assert.equal(f.review.body.jsonDocument[0].productPage.modelNumber,'');assert.equal(f.review.body.jsonDocument[1].productPage.commonAttributes.purchasePrice,'3333');
  cases.push({name:'extension/server interoperable full-group identity',independentReceiver:true});
 }finally{f.close();}
});
test('all ordered member, source, company, document and receipt tampering fails before persistence',async()=>{
 const f=await fixture();try{
  const mutations=[v=>v.identity.members.reverse(),v=>v.identity.members[1].optionId='synthetic-one',v=>v.identity.members[1].optionId='synthetic-excluded',v=>v.identity.members[1].documentIndex=0,
   v=>v.identity.members.pop(),v=>v.identity.members[1].optionLabel='다른 이름',v=>v.identity.productId='other-product',v=>v.identity.ownerId='other-owner',v=>v.identity.company=companies[1],
   v=>v.identity.requestedProfileId=null,v=>v.identity.profileId=null,v=>v.identity.source.optionRevision++,v=>v.identity.inputFingerprint='a'.repeat(64),v=>v.identity.categoryId='80719',v=>v.identity.appTabId=-1,
   v=>v.packetDigest='a'.repeat(64),v=>v.preparedBodySha256='a'.repeat(64),v=>v.originalBodySha256='a'.repeat(64),v=>v.identityDigest='a'.repeat(64),v=>v.receipt.preparedBodySha256='a'.repeat(64),
   v=>v.receipt.sourceStatus='UNKNOWN',v=>v.receipt.state='accepted',v=>v.state='accepted',v=>v.receipt.docId='728001',v=>v.receipt.qvtRequestId='728101',v=>v.receipt.observedAt=Date.now()+120000,
   v=>v.receipt.skuId='not-observed',v=>v.receipt.skus=[1,2],v=>v.registered=true,v=>v.receipt.registered=true,v=>v.optionId='synthetic-one',v=>v.success=true,v=>v.needsRecovery=true,v=>v.requestId='legacy-not-group'];
  for(const mutate of mutations){const value=plain(f.observation);mutate(value);await json(await f.post(value),409);}
  assert.equal(count(f),0);assert.deepEqual(f.h.network,[]);cases.push({name:'tamper rejection',mutations:mutations.length});
 }finally{f.close();}
});
test('unsafe JSON never executes getters or stores secrets, prototypes or sparse arrays',async()=>{
 const f=await fixture();try{
  let getters=0;const getter=plain(f.observation);Object.defineProperty(getter.identity,'company',{enumerable:true,get(){getters++;return companies[0];}});
  const unsafe=[getter,Object.assign(Object.create({inherited:true}),plain(f.observation)),{...plain(f.observation),password:'never-stored'},plain(f.observation)];
  unsafe[3].identity.members=[,plain(f.observation.identity.members[1])];
  for(const value of unsafe)await assert.rejects(f.model.validateProductReceiptObservation(value,f.review,'https://app.test'));assert.equal(getters,0);assert.equal(count(f),0);
  cases.push({name:'safe receipt JSON',gettersInvoked:0});
 }finally{f.close();}
});
test('mixed v1/group history keeps one document record and original insertion order',async()=>{
 const f=await fixture();try{
  await json(await f.post());await json(await legacy(f));let history=await f.history();assert.deepEqual(history.receipts.map(row=>row.format),['yoofam-single-receipt-v1','yoofam-product-document-receipt-v1']);
  const accepted=plain(f.observation);accepted.state=accepted.receipt.state='accepted';accepted.receipt.sourceStatus='FINISHED';accepted.receipt.observedAt+=2;await json(await f.post(accepted));
  history=await f.history();assert.equal(history.receipts[0].requestId,'legacy-728');assert.equal(history.receipts[1].receipt.state,'accepted');assert.equal(count(f),2);
  const legacyHistory=await json(await f.h.route(f.base+'/supplier-hub-single-receipt'));assert.equal(legacyHistory.receipts.length,1);assert.equal(legacyHistory.receipts[0].optionId,'synthetic-one');
  const summary=await f.store.readSingleReceiptSummaries('owner',[{id:f.id}]);assert.equal(summary[f.id].format,'yoofam-single-receipt-summary-v1');assert.equal(summary[f.id].optionCount,1);
  const newer=observation(f.review,{requestId:'72800000-0000-4000-8000-000000000002',docId:728003,qvtRequestId:728103});await json(await f.post(newer));
  const latest=await f.store.readSingleReceiptSummaries('owner',[{id:f.id}]);assert.equal(latest[f.id].format,'yoofam-product-document-receipt-summary-v1');assert.equal(latest[f.id].optionCount,2);assert.equal(count(f),3);
  cases.push({name:'mixed immutable insertion ordering',nativeRows:3,groupOptionCount:2});
 }finally{f.close();}
});
test('typed root document and request IDs are unique across group and scalar formats',async()=>{
 const f=await fixture();try{
  await json(await legacy(f,{docId:728001}));await json(await f.post(),409);assert.equal(count(f),1);
  const stringDoc=observation(f.review,{docId:'728001',qvtRequestId:728103});await json(await f.post(stringDoc));assert.equal(count(f),2);
  const collision=observation(f.review,{requestId:'72800000-0000-4000-8000-000000000002',docId:728009,qvtRequestId:728102});await json(await f.post(collision),409);
  await json(await legacy(f,{requestId:'legacy-again',docId:'728001',qvtRequestId:728109}),409);
  const typed=observation(f.review,{requestId:'72800000-0000-4000-8000-000000000003',docId:728010,qvtRequestId:'728102'});await json(await f.post(typed));assert.equal(count(f),3);
  cases.push({name:'cross-format typed uniqueness',clonedPerOptionRecords:0});
 }finally{f.close();}
});
test('accepted cannot regress, rejected cannot become success, immutable members never change',async()=>{
 const f=await fixture();try{
  const accepted=observation(f.review,{status:'FINISHED'});await json(await f.post(accepted));
  const pending=plain(accepted);pending.state=pending.receipt.state='pending';pending.receipt.sourceStatus='SUBMITTED';pending.receipt.observedAt++;await json(await f.post(pending),409);
  const rejected=observation(f.review,{requestId:'72800000-0000-4000-8000-000000000002',docId:728002,qvtRequestId:728102,status:'REJECTED'});await json(await f.post(rejected));
  const falseSuccess=plain(rejected);falseSuccess.state=falseSuccess.receipt.state='accepted';falseSuccess.receipt.sourceStatus='FINISHED';falseSuccess.receipt.observedAt++;await json(await f.post(falseSuccess),409);
  const older=plain(rejected);older.receipt.observedAt--;const retained=await json(await f.post(older));assert.equal(retained.receipt.receipt.observedAt,rejected.receipt.observedAt);
  const altered=plain(accepted);altered.identity.members[1].optionLabel='changed';altered.receipt.observedAt+=2;await json(await f.post(altered),409);assert.equal(count(f),2);
  cases.push({name:'append/replay status monotonicity',rows:2});
 }finally{f.close();}
});
test('root document IDs and request IDs cannot be cloned to another owned product',async()=>{
 const f=await fixture();try{
  const original=f.h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id),other={...original,id:'synthetic-other-728'},columns=Object.keys(other);
  f.h.sqlite.prepare('INSERT INTO products('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(key=>other[key]));
  const review=plain(f.review);review.identity.productId=other.id;review.reviewDigest=digest({format:review.format,type:review.type,identity:review.identity,members:review.members,originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256});
  const value=observation(review),record=plain(await f.model.validateProductReceiptObservation(value,review,'https://app.test'));record.recordedAt=new Date().toISOString();
  f.h.sqlite.prepare('INSERT INTO supplier_hub_single_receipts VALUES(?,?,?,?,?,?)').run('owner',other.id,record.requestId,record.receipt.observedAt,canonical(record),record.recordedAt);
  await json(await f.post(),409);const distinct=observation(f.review,{requestId:'72800000-0000-4000-8000-000000000002',docId:728001,qvtRequestId:728104});await json(await f.post(distinct),409);
  const requestCollision=observation(f.review,{docId:728005,qvtRequestId:728105});await json(await f.post(requestCollision),409);assert.equal(count(f),1);
  cases.push({name:'cross-product root and request uniqueness',clonedDocuments:0});
 }finally{f.close();}
});
test('idempotent replay still checks the atomic current approved member and settings',async()=>{
 for(const change of ['member','settings']){
  const f=await fixture();try{
   await json(await f.post());const payload=f.h.sqlite.prepare('SELECT payload FROM supplier_hub_single_receipts').get().payload;
   beforeInsert(f,()=>{if(change==='member')f.h.sqlite.prepare('UPDATE members SET status=? WHERE id=?').run('suspended','owner');else f.h.sqlite.prepare('UPDATE workspace_settings SET payload=? WHERE owner_id=?').run(JSON.stringify({...f.h.settings,brand:'changed'}),'owner');});
   await json(await f.post(),409);assert.equal(count(f),1);assert.equal(f.h.sqlite.prepare('SELECT payload FROM supplier_hub_single_receipts').get().payload,payload);assert.deepEqual(f.h.network,[]);
  }finally{f.close();}
 }
 cases.push({name:'atomic replay member/settings fence',storedPayloadUnchanged:true});
});
test('changed saved second-row/manual blank blocks old observations but leaves history readable',async()=>{
 const f=await fixture();try{
  await json(await f.post());const fields=await json(await f.h.route(f.fieldPath));
  await json(await f.h.route(f.fieldPath,{method:'PUT',body:{expectedRevision:fields.revision,expectedInputFingerprint:fields.inputFingerprint,changes:[{fieldKey:f.byWire(['productPage','modelNumber']),optionId:'synthetic-two',value:''}]}}));
  await json(await f.post(),409);const history=await f.history();assert.equal(history.receipts.length,1);assert.equal(history.receipts[0].originalBodySha256,f.review.originalBodySha256);assert.deepEqual(f.h.network,[]);
  cases.push({name:'current second member and blank fence',oldHistoryPreserved:true});
 }finally{f.close();}
});
test('queryless captured category remains nullable and does not select the live profile',async()=>{
 const f=await fixture(companies[0],true);try{
  assert.equal(f.review.identity.profileId,null);assert.equal(f.review.identity.requestedProfileId,null);assert.equal(f.review.identity.source.profileRevision,null);
  const saved=await json(await f.post());assert.equal(saved.receipt.profileId,null);assert.equal(saved.receipt.requestedProfileId,null);assert.equal(count(f),1);
  const incorrect=await f.h.route(f.endpoint,{method:'POST',body:{profileId:f.profile.id,observation:f.observation}});await json(incorrect,409);assert.deepEqual(f.h.network,[]);
  cases.push({name:'captured queryless server receipt',implicitLiveProfileSelections:0});
 }finally{f.close();}
});
for(const change of ['member','settings','source','quotation'])test('atomic current '+change+' fence blocks insertion after server validation',async()=>{
 const f=await fixture();try{
  beforeInsert(f,()=>{
   if(change==='member')f.h.sqlite.prepare('UPDATE members SET status=? WHERE id=?').run('suspended','owner');
   if(change==='settings')f.h.sqlite.prepare('UPDATE workspace_settings SET payload=? WHERE owner_id=?').run(JSON.stringify({...f.h.settings,brand:'changed'}),'owner');
   if(change==='source')f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z',f.id);
   if(change==='quotation')f.h.sqlite.prepare('UPDATE product_quotation_fields SET revision=revision+1 WHERE product_id=?').run(f.id);
  });await json(await f.post(),409);assert.equal(count(f),0);assert.deepEqual(f.h.network,[]);
  cases.push({name:'atomic '+change+' insertion fence',rows:0});
 }finally{f.close();}
});
test('unknown native history fails closed and prevents product removal',async()=>{
 const f=await fixture();try{
  await json(await f.post());const row=f.h.sqlite.prepare('SELECT * FROM supplier_hub_single_receipts').get(),unknown=JSON.parse(row.payload);unknown.format='unknown-format';
  f.h.sqlite.prepare('UPDATE supplier_hub_single_receipts SET payload=?').run(JSON.stringify(unknown));await json(await f.h.route(f.endpoint),409);await json(await f.h.route(f.base+'/supplier-hub-single-receipt'),409);
  const policies=await f.h.load('db/product-removals.ts').readProductRemovalPolicies('owner',[{id:f.id}]);assert.equal(policies[f.id].blocked,true);assert.equal(policies[f.id].code,'PRODUCT_HUB_EVIDENCE_UNCONFIRMED');
  const summary=await f.store.readSingleReceiptSummaries('owner',[{id:f.id}]);assert.equal(summary[f.id],null);cases.push({name:'unknown mixed evidence fail closed',removalBlocked:true});
 }finally{f.close();}
});
test('group evidence blocks removal without implying issued SKUs or a fabricated option',async()=>{
 const f=await fixture();try{
  await json(await f.post());const policies=await f.h.load('db/product-removals.ts').readProductRemovalPolicies('owner',[{id:f.id}]);assert.equal(policies[f.id].code,'PRODUCT_HUB_TRANSMITTED');assert.equal(policies[f.id].singleReceipt.optionCount,2);assert.equal(Object.hasOwn(policies[f.id].singleReceipt,'optionId'),false);
  const remove=await f.h.load('app/api/products/[id]/route.ts').DELETE(new Request('https://app.test'+f.base,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({expectedVersion:f.prepared.source.productVersion})}),{params:Promise.resolve({id:f.id})});await json(remove,409);
  assert.equal(f.h.sqlite.prepare('SELECT count(*) AS n FROM product_removals').get().n,0);assert.equal(count(f),1);cases.push({name:'whole-group removal protection',optionCount:2,registered:false});
 }finally{f.close();}
});
test('strict methods, cross-site, aborted request, query and body bounds prevent saves',async()=>{
 const f=await fixture();try{
  const route=f.h.load('app/api/products/[id]/supplier-hub-product-receipt/route.ts'),ctx={params:Promise.resolve({id:f.id})};
  assert.equal((await route.GET(new Request('https://app.test'+f.endpoint,{method:'POST'}),ctx)).status,405);assert.equal((await route.POST(new Request('https://app.test'+f.endpoint),ctx)).status,405);
  for(const query of ['?profileId=','?profileId=x&profileId=y','?submit=true'])await json(await f.h.route(f.endpoint+query),400);
  for(const body of [{},{profileId:f.profileId,optionId:'synthetic-one',observation:f.observation},{profileId:'',observation:f.observation}])await json(await f.h.route(f.endpoint,{method:'POST',body}),400);
  await json(await f.h.route(f.endpoint,{method:'POST',body:' '.repeat(256*1024+1)}),413);
  const body=JSON.stringify({profileId:f.profileId,observation:f.observation});
  const cross=new Request('https://app.test'+f.endpoint,{method:'POST',headers:{origin:'https://foreign.test','content-type':'application/json'},body});await json(await route.POST(cross,ctx),403);
  const controller=new AbortController(),aborted=new Request('https://app.test'+f.endpoint,{method:'POST',headers:{'content-type':'application/json'},body,signal:controller.signal});controller.abort();await json(await route.POST(aborted,ctx),409);
  f.h.setCompany(companies[1]);await json(await f.post(),409);assert.equal(count(f),0);assert.deepEqual(f.h.network,[]);cases.push({name:'request boundary protections',registered:false});
 }finally{f.close();}
});
