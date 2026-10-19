import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { assetApiFixture, assetSnapshot, companies, module, plain } from './helpers/supplier-hub-single-assets.mjs';
import { SINGLE_DOCUMENT_LIVE_VERIFIED, dispatchSingleDocument } from '../extensions/supplier-hub/single-dispatch.mjs';
import { SINGLE_SENDER } from './helpers/supplier-hub-single-document.mjs';

const model=module('app/supplier-hub-product-document.ts'),sha=value=>createHash('sha256').update(value).digest('hex');
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=value=>sha(canonical(value)),cases=[];
const sourceFiles=['app/supplier-hub-product-document.ts','tests/supplier-hub-product-document.test.mjs','app/supplier-hub-single-client.ts','app/exports/single-package.ts','extensions/supplier-hub/single-dispatch.mjs'];
const hashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,sha(fs.readFileSync(new URL('../'+file,import.meta.url)))])),frozen=hashes();
after(()=>{assert.deepEqual(hashes(),frozen);fs.writeFileSync(new URL('../outputs/step726-product-document-test-proof.json',import.meta.url),JSON.stringify({sourceHashes:frozen,cases,boundary:'Actual local prepared package/projection/API/SQLite for two synthetic companies; pure compiler and read-helper adversarial cases. No source collection, external provider, browser bridge, native document or receipt claim.',externalRequests:0,realProductWrites:0,hubWrites:0,productionGate:SINGLE_DOCUMENT_LIVE_VERIFIED},null,2)+'\n');});

async function fixture(company=companies[0],captured=false){
 const snapshot=assetSnapshot(company),raw=JSON.parse(snapshot.schemaString);
 raw.properties.productPage.properties.preservedFutureField={type:'string',title:'후속 양식 원문'};snapshot.schemaString=JSON.stringify(raw);
 const f=await assetApiFixture(company,snapshot);
 if(captured){
  const category={name:f.profile.name,categoryId:f.profile.categoryId,categoryPath:f.profile.categoryPath,template:null,mappings:[],hubSchema:snapshot};
  const context={...plain(f.h.context),company:plain(company),category};
  f.h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(context),'job');
  f.h.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run(f.h.sourceUrl,f.id);
  f.h.sqlite.prepare('INSERT INTO collection_products VALUES(?,?,?,?)').run('job','owner',f.id,new Date().toISOString());
 }
 const query=captured?'':f.query,endpoint=f.base+'/supplier-hub-single-package'+query;
 const fields=()=>f.h.route(f.base+'/quotation-fields'+query).then(json);
 let view=await fields();
 const changes=[
  {fieldKey:f.byWire(['startPage','productName']),optionId:'synthetic-one',value:'전체 문서 첫 옵션'},
  {fieldKey:f.byWire(['startPage','productName']),optionId:'synthetic-two',value:'전체 문서 두 옵션'},
  {fieldKey:f.byWire(['productPage','modelNumber']),optionId:'synthetic-two',value:'SECOND-MODEL-726'},
  {fieldKey:f.byWire(['productPage','preservedFutureField']),optionId:null,value:'미래 양식 보존값'},
  ...[['supplyPrice','3333',['productPage','commonAttributes','purchasePrice']],['salePrice','4444',['productPage','commonAttributes','coupangSalePrice']],['msrp','5555',['productPage','commonAttributes','msrp']]]
   .flatMap(([key,value,path])=>[...new Set([key,f.byWire(path)])].map(fieldKey=>({fieldKey,optionId:'synthetic-two',value}))),
 ];
 view=await json(await f.h.route(f.base+'/quotation-fields'+query,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));
 const candidate=await json(await f.h.route(endpoint));assert.equal(candidate.review.canPrepare,true,JSON.stringify(candidate.review.issues));
 const packageView=await json(await f.h.route(endpoint,{method:'POST',body:{action:'prepare',expectedFingerprint:candidate.fingerprint}}));
 const calls=[],request=async(url,init)=>{
  assert.equal(init.method,'GET');assert.equal(init.cache,'no-store');assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');calls.push({url,init});
  return url==='/api/supplier-hub/catalog-context'?f.h.load('app/api/supplier-hub/catalog-context/route.ts').GET():f.h.route(url);
 };
 return {...f,query,endpoint,fields,quotationView:view,packageView,calls,request,profileId:captured?undefined:f.profile.id};
}
let sample;
async function input(){if(!sample){const f=await fixture();try{sample={packageView:plain(f.packageView),quotationView:plain(f.quotationView),productId:f.id,profileId:f.profileId};}finally{f.close();}}return plain(sample);}
const actor=company=>({ownerId:'owner',company:company??companies[0]});
function fakeRequest(value,{packageAt,actorAt,responseAt}={}){
 const calls=[];let packageReads=0,actorReads=0;
 const request=async function(url,init){calls.push({url,init,receiver:this});if(responseAt){const response=await responseAt(url,init,calls.length);if(response)return response;}
  return Response.json(url==='/api/supplier-hub/catalog-context'?(actorAt?await actorAt(++actorReads):actor(value.packageView.company)):(packageAt?await packageAt(++packageReads):value.packageView));};
 return{calls,request};
}
async function read(value,request,signal=new AbortController().signal){return model.reviewCurrentSupplierHubProductDocument({...value,fetcher:request,signal});}

for(const company of companies)test(`all included options compile into one immutable current document (${company.code})`,async()=>{
 const f=await fixture(company);try{
  const before=f.state(),objects=f.objectState(),original=canonical(f.packageView),controller=new AbortController();
  const review=await model.reviewCurrentSupplierHubProductDocument({productId:f.id,profileId:f.profileId,packageView:f.packageView,quotationView:f.quotationView,fetcher:f.request,signal:controller.signal});
  assert.equal(review.format,'yoofam-supplier-hub-product-document-v1');assert.equal(review.type,'YOOFAM_PRODUCT_DOCUMENT_REVIEW');assert.equal(review.body.docId,null);
  assert.deepEqual(plain(review.members),[{optionId:'synthetic-one',optionLabel:f.packageView.options[0].optionLabel,documentIndex:0},{optionId:'synthetic-two',optionLabel:f.packageView.options[1].optionLabel,documentIndex:1}]);
  assert.deepEqual(plain(review.body),f.packageView.payload);assert.equal(review.body.jsonDocument.length,2);assert.equal(review.body.productName,'전체 문서 첫 옵션');
  assert.deepEqual(plain(review.body.jsonDocument.map(document=>document.startPage.productName)),['전체 문서 첫 옵션','전체 문서 두 옵션']);
  assert.deepEqual(plain(review.body.jsonDocument.map(document=>document.productPage.modelNumber)),['','SECOND-MODEL-726']);
  assert.deepEqual(plain(review.body.jsonDocument.map(document=>document.productPage.commonAttributes.purchasePrice)),['11960','3333']);
  assert.deepEqual(plain(review.body.jsonDocument.map(document=>document.productPage.commonAttributes.coupangSalePrice)),['19930','4444']);
  assert.deepEqual(plain(review.body.jsonDocument.map(document=>document.productPage.commonAttributes.msrp)),['25910','5555']);
  for(const document of review.body.jsonDocument){assert.equal(document.productPage.preservedFutureField,'미래 양식 보존값');assert.equal(document.imagePage.details.htmlProductDetailContent,'');assert.equal(document.productPage.commonAttributes.count,0);assert.equal(document.productPage.commonAttributes.booleanValue,false);}
  assert.equal(JSON.stringify(review).includes('synthetic-excluded'),false);assert.equal(review.originalBodySha256,digest(f.packageView.payload));assert.equal(review.preparedBodySha256,review.originalBodySha256);
  assert.equal(review.registered,false);assert.equal(review.remoteWrites,false);assert.equal(review.submissionReady,false);assert.equal(Object.hasOwn(review,'requestId'),false);assert.equal(Object.hasOwn(review,'optionId'),false);
  assert.deepEqual(plain(review.identity.company),company);assert.equal(review.identity.ownerId,'owner');assert.equal(review.identity.inputFingerprint,f.quotationView.inputFingerprint);assert.equal(review.identity.requestedProfileId,f.profile.id);
  assert.deepEqual(f.calls.map(call=>call.url),['/api/supplier-hub/catalog-context',f.endpoint,f.endpoint,'/api/supplier-hub/catalog-context']);assert.ok(f.calls.every(call=>call.init.signal===controller.signal));
  assert.ok(Object.isFrozen(review)&&Object.isFrozen(review.body)&&Object.isFrozen(review.body.jsonDocument[1].imagePage)&&Object.isFrozen(review.members[1]));assert.throws(()=>{review.members[0].optionId='changed';},TypeError);
  assert.equal(canonical(f.packageView),original);assert.equal(f.state(),before);assert.equal(f.objectState(),objects);assert.deepEqual(f.h.network,[]);assert.equal(f.h.aiSources.length,0);
  await assert.rejects(dispatchSingleDocument({action:'preview',packet:plain(review)},SINGLE_SENDER));assert.equal(SINGLE_DOCUMENT_LIVE_VERIFIED,false);
  cases.push({name:'actual all-option document '+company.code,included:2,excluded:1,reads:4,remoteWrites:0,manualBlanksPricesAndUnknownFieldPreserved:true});
 }finally{f.close();}
});

test('queryless captured schema with no saved profile ID stays queryless and never selects the live profile',async()=>{
 const f=await fixture(companies[0],true);try{
  assert.equal(f.quotationView.categoryContext.source,'collection');assert.equal(f.quotationView.categoryContext.profileId,null);assert.equal(f.packageView.source.profileId,null);assert.equal(f.packageView.requestedProfileId,null);
  const review=await model.reviewCurrentSupplierHubProductDocument({productId:f.id,packageView:f.packageView,quotationView:f.quotationView,fetcher:f.request,signal:new AbortController().signal});
  assert.equal(review.identity.profileId,null);assert.equal(review.identity.requestedProfileId,null);assert.ok(f.calls.filter(call=>call.url!== '/api/supplier-hub/catalog-context').every(call=>!call.url.includes('?')));
  await assert.rejects(model.reviewCurrentSupplierHubProductDocument({productId:f.id,profileId:f.profile.id,packageView:f.packageView,quotationView:f.quotationView,fetcher:f.request,signal:new AbortController().signal}));
  cases.push({name:'captured queryless',nullableProfile:true,implicitLiveProfileSelections:0});
 }finally{f.close();}
});

test('deferred agreement hashes cover every document while original values and unknown JSON remain exact',async()=>{
 const value=await input();value.packageView.payload.jsonDocument[0].imagePage.msrpAgree=true;value.packageView.payload.jsonDocument[1].imagePage.labelContactAgreed=true;
 value.packageView.payload.jsonDocument[1].productPage.unknownSavedShape={blank:'',nullable:null,zero:0,flag:false,rows:['literal',null,{future:'원문'}]};const before=canonical(value);
 const review=await model.compileSupplierHubProductDocument({...value,ownerId:'owner'}),deferred=plain(value.packageView.payload);
 for(const document of deferred.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])if(Object.hasOwn(document.imagePage,key))document.imagePage[key]=false;
 assert.equal(review.originalBodySha256,digest(value.packageView.payload));assert.equal(review.preparedBodySha256,digest(deferred));assert.notEqual(review.originalBodySha256,review.preparedBodySha256);assert.equal(canonical(value),before);assert.deepEqual(plain(review.body),value.packageView.payload);
 const changed=plain(value);changed.packageView.payload.jsonDocument[1].imagePage.labelContactAgreed=false;const other=await model.compileSupplierHubProductDocument({...changed,ownerId:'owner'});assert.notEqual(review.originalBodySha256,other.originalBodySha256);assert.equal(review.preparedBodySha256,other.preparedBodySha256);assert.notEqual(review.reviewDigest,other.reviewDigest);
 const reordered=plain(value);reordered.packageView.options.reverse();reordered.packageView.payload.jsonDocument.reverse();reordered.packageView.payload.productName=reordered.packageView.payload.jsonDocument[0].startPage.productName;const included=reordered.quotationView.resolved.rows.filter(row=>row.included).reverse();reordered.quotationView.resolved.rows=[...included,...reordered.quotationView.resolved.rows.filter(row=>!row.included)];
 const order=await model.compileSupplierHubProductDocument({...reordered,ownerId:'owner'});assert.notEqual(order.reviewDigest,review.reviewDigest);assert.equal(order.members[0].optionId,'synthetic-two');assert.equal(order.body.productName,'전체 문서 두 옵션');
 cases.push({name:'all-row hash and membership',documents:2,unknownValuesPreserved:true,orderedIdentityBound:true});
});

test('invalid membership, source, flags, form and identity fail closed without a scalar fallback',async()=>{
 const value=await input(),mutations=[
  v=>v.packageView.options[1].optionId=null,v=>v.packageView.options[1].optionId=v.packageView.options[0].optionId,v=>v.packageView.options.reverse(),v=>v.packageView.options[1].optionLabel='다른 옵션 이름',v=>v.packageView.payload.jsonDocument.pop(),
  v=>v.packageView.prepared=false,v=>v.packageView.registered=true,v=>v.packageView.remoteWrites=true,v=>v.packageView.submissionReady=true,v=>v.packageView.humanAgreementsConfirmed=true,
  v=>v.packageView.review.canPrepare=false,v=>v.packageView.review.issues.push({code:'BLOCKED',level:'error',message:'실제 차단'}),v=>v.packageView.payload.docId=726,
  v=>v.packageView.payload.scope='other',v=>v.packageView.payload.jsonDocument[1].startPage.categoryPath='다른 경로',v=>v.packageView.payload.jsonDocument[1].startPage.productName='',
  v=>v.packageView.payload.jsonDocument[1].imagePage.msrpAgree='false',v=>v.packageView.schemaSha256='bad',v=>v.packageView.inputFingerprint='f'.repeat(64),
  v=>v.packageView.source.contentRevision++,v=>v.packageView.source.profileId='other-profile',v=>v.packageView.source.profileRevision=-1,v=>v.packageView.company={code:'A01526306',name:'다른 회사'},
  v=>delete v.packageView.requestedProfileId,v=>v.quotationView.resolved.rows.find(row=>row.optionId==='synthetic-two').included=false,
 ];
 for(const mutate of mutations){const changed=plain(value);mutate(changed);await assert.rejects(model.compileSupplierHubProductDocument({...changed,ownerId:'owner'}));}
 const over=plain(value),first=over.packageView.options[0],document=over.packageView.payload.jsonDocument[0],row=over.quotationView.resolved.rows.find(row=>row.included);
 over.packageView.options=Array.from({length:201},(_,index)=>({...first,optionId:'many-'+index}));over.packageView.payload.jsonDocument=Array.from({length:201},()=>plain(document));over.quotationView.resolved.rows=over.packageView.options.map(option=>({...plain(row),optionId:option.optionId}));
 await assert.rejects(model.compileSupplierHubProductDocument({...over,ownerId:'owner'}));await assert.rejects(model.compileSupplierHubProductDocument({...value,ownerId:'invalid owner'}));
 cases.push({name:'strict product contract',rejectedMutations:mutations.length,maxMembers:200,noScalarFallback:true});
});

test('unsafe objects, accessors, secrets, sparse arrays and bounded JSON limits are rejected without invoking getters',async()=>{
 const value=await input();let getterCalls=0;
 const unsafe=[()=>{const field={};Object.defineProperty(field,'value',{enumerable:true,get(){getterCalls++;return 'secret';}});return field;},()=>new Date(),()=>new Map(),()=>Object.create({inherited:true}),()=>Object.create(Object.assign(Object.create(null),{constructor:function Object(){}})),()=>JSON.parse('{"__proto__":{"polluted":true}}'),()=>({Authorization:'credential'}),()=>({access_token:'credential'}),()=>({secret:'credential'}),()=>({cookie:'credential'}),()=>[,'sparse'],()=>{const array=['x'];array.extra='hidden';return array;},()=>{const array=['x'];Object.setPrototypeOf(array,{});return array;},()=>({symbol:Symbol('unsafe')}),()=>({number:NaN}),()=>({value:undefined}),()=>{const cycle={};cycle.self=cycle;return cycle;}];
 for(const make of unsafe){const changed=plain(value);changed.packageView.payload.jsonDocument[1].unknown=make();await assert.rejects(model.compileSupplierHubProductDocument({...changed,ownerId:'owner'}));}
 const depth=plain(value);let nested={value:'deep'};for(let index=0;index<31;index++)nested={nested};depth.packageView.payload.jsonDocument[0].unknown=nested;await assert.rejects(model.compileSupplierHubProductDocument({...depth,ownerId:'owner'}));
 const nodes=plain(value);nodes.packageView.payload.jsonDocument[0].unknown=Array.from({length:100001},()=>0);await assert.rejects(model.compileSupplierHubProductDocument({...nodes,ownerId:'owner'}));
 const large=plain(value);large.packageView.payload.jsonDocument[0].unknown='가'.repeat(3*1024*1024);await assert.rejects(model.compileSupplierHubProductDocument({...large,ownerId:'owner'}));assert.equal(getterCalls,0);assert.equal({}.polluted,undefined);
 cases.push({name:'safe bounded JSON',accessorsInvoked:0,unsafeCases:unsafe.length,depthLimit:30,nodeLimit:100000,byteLimit:6*1024*1024});
});

test('both current package reads reject price/body/source changes and local view mutation during hashing',async()=>{
 const value=await input();
 for(const when of [1,2])for(const field of ['price','source','members','fingerprint']){const changed=plain(value.packageView);if(field==='price')changed.payload.jsonDocument[1].productPage.commonAttributes.coupangSalePrice='999999';if(field==='source')changed.source.quotationRevision++;if(field==='members')changed.options.reverse();if(field==='fingerprint')changed.fingerprint='e'.repeat(64);
  const fake=fakeRequest(value,{packageAt:index=>index===when?changed:value.packageView});await assert.rejects(read(value,fake.request));assert.ok(fake.calls.every(call=>call.init.method==='GET'));
 }
 const local=await input(),fake=fakeRequest(local,{packageAt:index=>{if(index===2)local.quotationView.inputFingerprint='d'.repeat(64);return value.packageView;}});await assert.rejects(read(local,fake.request));
 const changedExpected=await input(),mutate=fakeRequest(changedExpected,{actorAt:index=>{if(index===2)changedExpected.packageView.payload.jsonDocument[1].productPage.modelNumber='changed during read';return actor();}});await assert.rejects(read(changedExpected,mutate.request));
 cases.push({name:'two-read current source',priceAndBodyChangesRejected:true,sourceAndMembershipChangesRejected:true,lateLocalMutationRejected:true});
});

test('account/company changes, malformed responses, aborts and receiver-sensitive fetch never send writes or retry',async()=>{
 const value=await input();for(const change of ['owner','company']){const fake=fakeRequest(value,{actorAt:index=>index===2?change==='owner'?{...actor(),ownerId:'other-owner'}:actor(companies[1]):actor()});await assert.rejects(read(value,fake.request));assert.equal(fake.calls.length,4);}
 for(const response of [Response.json({ownerId:'owner',company:companies[1]}),new Response('<html>private response</html>',{headers:{'content-type':'text/html'}}),new Response('{broken',{headers:{'content-type':'application/json'}}),Response.json({error:'no'},{status:403}),Response.json({ownerId:'owner',company:companies[0],extra:'unknown'})]){
  const fake=fakeRequest(value,{responseAt:()=>response});await assert.rejects(read(value,fake.request));assert.equal(fake.calls.length,1);
 }
 const controller=new AbortController();controller.abort();const none=fakeRequest(value);await assert.rejects(read(value,none.request,controller.signal));assert.equal(none.calls.length,0);
 const mid=new AbortController(),abort=fakeRequest(value,{packageAt:index=>{if(index===2)mid.abort();return value.packageView;}});await assert.rejects(read(value,abort.request,mid.signal));assert.equal(abort.calls.length,3);
 const receiver=fakeRequest(value),review=await read(value,receiver.request);assert.equal(review.body.jsonDocument.length,2);assert.equal(receiver.calls.length,4);assert.ok(receiver.calls.every(call=>call.receiver&&call.init.method==='GET'&&call.init.signal&&!call.init.body));
 const mismatch=await input();mismatch.profileId=undefined;const query=fakeRequest(mismatch);await assert.rejects(read(mismatch,query.request));assert.equal(query.calls.length,0);
 cases.push({name:'read-only account and lifecycle',getOnly:true,abortBeforeFetch:true,abortAfterPackage:true,malformedAndChangedAccountRejected:true,automaticRetries:0});
});
