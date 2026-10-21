import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash,webcrypto} from 'node:crypto';
import {createProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
import {productDocumentIdentity} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {singleDocumentIdentity} from '../extensions/supplier-hub/single-document.mjs';
import {singlePacket,singleDocumentFixture,SINGLE_COMPANIES,SINGLE_SENDER} from './helpers/supplier-hub-single-document.mjs';
import {productValidationRejectionFixture} from './helpers/product-validation-rejection.mjs';
import {normalizeRejectionDetails} from '../extensions/supplier-hub/rejection-details.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
// Reuse isolated fixture declarations without importing their test registrations
// or rewriting the historical proof emitted by the older suite's after hook.
const clientUrl=new URL('./supplier-hub-product-client.test.mjs',import.meta.url),clientSource=fs.readFileSync(clientUrl,'utf8'),clientAst=ts.createSourceFile(clientUrl.pathname,clientSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
for(const statement of clientAst.statements){if(ts.isVariableStatement(statement)&&statement.pos<clientSource.indexOf('async function fixture(')||ts.isFunctionDeclaration(statement)&&['fixture','draftState'].includes(statement.name?.text))parts.push(statement.getText(clientAst));}
const{fixture:clientFixture,draftState}=vm.runInNewContext(parts.join('\n').replaceAll('import.meta.url',JSON.stringify(clientUrl.href))+'\n({fixture,draftState})',
 {assert,fs,path,vm,ts,createRequire,fileURLToPath,createHash,webcrypto,createProductDocumentPacket,productDocumentIdentity,singleDocumentIdentity,singlePacket,SINGLE_COMPANIES,SINGLE_SENDER,normalizeRejectionDetails,Response,Request,URL,AbortController,Date,TextEncoder,TextDecoder,Uint8Array,structuredClone,setImmediate});
const pendingUrl=new URL('./supplier-hub-product-pending.test.mjs',import.meta.url),pendingSource=fs.readFileSync(pendingUrl,'utf8'),pendingAst=ts.createSourceFile(pendingUrl.pathname,pendingSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),pendingParts=[];
for(const statement of pendingAst.statements){if(ts.isImportDeclaration(statement))continue;if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(pendingAst)==='test')break;pendingParts.push(statement.getText(pendingAst));}
const pending=vm.runInNewContext(pendingParts.join('\n').replaceAll('import.meta.url',JSON.stringify(pendingUrl.href))+'\n({fixture,review,session,validationObservation,now})',{assert,fs,vm,ts,Response,URL,AbortController,Date,JSON,structuredClone});
function rejected(f,errors){return f.state('validation-rejected',{validationRejection:{evidence:'document-validation-rejection',operationId:f.packet.requestId+':validate:3',step:3,validatedSteps:[2],checkpointSequence:10,rejectedAt:f.clock.now,submitted:false,consented:false,...(errors===undefined?{}:{errors})}});}
const diagnostics=[{columnName:'포장 무게(g)',message:'0보다 큰 무게를 입력해주세요.'},{columnName:'imagePage.details.htmlProductDetailContent',message:'<script>원문 그대로 표시할 검증 오류</script>\n두 번째 줄'}];

for(const company of SINGLE_COMPANIES)test(`${company.code}: actual committed checkpoint projects exact errors and client validates immutable current-request diagnostics`,async()=>{
 const f=await clientFixture(company,{verified:true}),session=await f.session();let native;
 try{
  native=await productValidationRejectionFixture(f.packet,{now:f.clock.now});const first=await native.receiver.start(f.packet,SINGLE_SENDER);assert.equal(first.state,'validation-rejected');assert.deepEqual(first.validationRejection.errors,[{columnName:'supplyPrice',message:'합성 단계 검증 반려'}]);
  const checkpoint=native.storage.get(native.context.key),errors=diagnostics.map((entry,index)=>({...entry,rowIndex:index}));native.storage.force(native.context.key,{...checkpoint,validationErrors:errors});
  const frozen=JSON.stringify(native.storage.get(native.context.key)),before=native.calls.filter(call=>call.startsWith('POST '));
  f.bridge=()=>native.receiver.recover(f.packet,SINGLE_SENDER);const result=await f.client.runProductDocument(session,'recover',new AbortController().signal);
  assert.deepEqual(plain(result.validationRejection.errors),diagnostics);assert.equal(result.validationRejection.step,2);assert.equal(result.docId,first.docId);assert.equal(result.requestId,f.packet.requestId);
  assert.equal(Object.isFrozen(result.validationRejection.errors),true);assert.ok(result.validationRejection.errors.every(Object.isFrozen));assert.ok(result.validationRejection.errors.every(row=>Object.keys(row).length===2));
  assert.deepEqual(native.calls.filter(call=>call.startsWith('POST ')),before);assert.equal(JSON.stringify(native.storage.get(native.context.key)),frozen);assert.equal(native.creates,1);assert.equal(native.updates,1);assert.equal(native.validations,1);native.assertPreserved();
 }finally{native?.close();}
});

test('current validation-only response accepts empty/absent diagnostics, preserves maximum bounds and legacy Single wire output',async()=>{
 const f=await clientFixture(SINGLE_COMPANIES[0],{verified:true}),session=await f.session();
 for(const errors of [undefined,[],[{columnName:'x'.repeat(500),message:'오'.repeat(2000)}],Array.from({length:200},(_,i)=>({columnName:String(i),message:'검증 오류'}))]){
  f.bridge=()=>rejected(f,errors);const result=await f.client.runProductDocument(session,'recover',new AbortController().signal);assert.deepEqual(plain(result.validationRejection.errors??null),errors??null);assert.equal(result.registered,false);assert.equal(result.success,false);
 }
 const legacy=await singleDocumentFixture(SINGLE_COMPANIES[0],{validationResponse:()=>({code:200,data:[{success:false,errors:diagnostics}]})});try{
  const result=await legacy.receiver.start(legacy.packet,legacy.sender);assert.equal(result.state,'validation-rejected');assert.equal(Object.hasOwn(result,'validationRejection'),false);assert.equal(Object.hasOwn(result,'errors'),false);assert.equal(legacy.submitted,0);legacy.assertPreserved();
 }finally{legacy.close();}
});

for(const mode of ['full','draft'])test(`${mode} client rejects malformed, extra, caller-forged and stale validation diagnostics without another dispatch`,async()=>{
 const f=await clientFixture(SINGLE_COMPANIES[0],{verified:true});f.bridge=()=>({...f.preview(),draftPreparationAvailable:true});const session=await f.session();
 const changes=[v=>v.validationRejection.errors=null,v=>v.validationRejection.errors={},v=>v.validationRejection.errors=['bad'],v=>v.validationRejection.errors=[{columnName:'x'}],v=>v.validationRejection.errors=[{columnName:4,message:'bad'}],
  v=>v.validationRejection.errors=[{columnName:'x',message:'bad',rowIndex:0}],v=>v.validationRejection.errors=[{columnName:'x'.repeat(501),message:'bad'}],v=>v.validationRejection.errors=[{columnName:'x',message:'x'.repeat(2001)}],
  v=>v.validationRejection.errors=Array.from({length:201},()=>({columnName:'x',message:'bad'})),v=>v.validationRejection.operationId='other-request:validate:3',v=>v.validationRejection.step=2,v=>v.validationRejection.checkpointSequence=0,
  v=>{v.validationRejection.rejectedAt=f.clock.now+5001;if(v.draftProof)v.draftProof.observedAt=v.validationRejection.rejectedAt;},v=>v.validationRejection.extra=true,v=>v.docId=null,v=>v.requestId='different-request',v=>v.identity.members[1].optionId='foreign',
  v=>v.validationRejection.submitted=true,v=>v.validationRejection.consented=true,v=>v.state='validated',v=>{v.errors=v.validationRejection.errors;delete v.validationRejection;}];
 for(const change of changes){f.bridge=()=>{let result=rejected(f,diagnostics);if(mode==='draft')result=draftState(f,'validation-rejected',{validationRejection:result.validationRejection,recovered:true});change(result);return result;};const before=f.sent.length;
  await assert.rejects(mode==='draft'?f.client.runProductDocumentDraft(session,'recoverDraft',new AbortController().signal):f.client.runProductDocument(session,'recover',new AbortController().signal),error=>error.code===(mode==='draft'?'PRODUCT_DOCUMENT_DRAFT_REPLY_IDENTITY':'PRODUCT_DOCUMENT_REPLY_IDENTITY')&&!error.uncertain);assert.equal(f.sent.length,before+1);
 }
 assert.equal(f.calls.length,0);
});

test('same original operation recovers old errors after preview TTL renewal changes only packet createdAt',async()=>{
 for(const mode of ['full','draft']){
  const f=await clientFixture(SINGLE_COMPANIES[0],{verified:true});f.bridge=()=>({...f.preview(),draftPreparationAvailable:true});const original=await f.session(),old=rejected(f,diagnostics);
  const observation=mode==='draft'?draftState(f,'validation-rejected',{validationRejection:old.validationRejection,recovered:true}):old;
  f.advance(10000);const session={...original,packet:{...plain(original.packet),createdAt:f.clock.now}};f.bridge=()=>observation;
  const result=await(mode==='draft'?f.client.runProductDocumentDraft(session,'recoverDraft',new AbortController().signal):f.client.runProductDocument(session,'recover',new AbortController().signal));
  assert.ok(result.validationRejection.rejectedAt<session.packet.createdAt);assert.deepEqual(plain(result.validationRejection.errors),diagnostics);assert.equal(result.requestId,original.packet.requestId);assert.equal(result.packetDigest,original.packetDigest);assert.equal(f.sent.length,2);assert.equal(f.calls.length,0);
 }
});

test('draft preparation and qualified read recovery preserve exact diagnostics without enabling navigation, terms or submission',async()=>{
 const f=await clientFixture();f.bridge=()=>({...f.preview(),draftPreparationAvailable:true,preparedLifecycleAvailable:true});const session=await f.session();
 f.bridge=payload=>draftState(f,'validation-rejected',{validationRejection:rejected(f,diagnostics).validationRejection,...(payload.action==='prepareDraft'?{}:{recovered:true})});
 for(const action of ['prepareDraft','recoverDraft','recoverPreparedDraft']){
  const result=await(action==='recoverPreparedDraft'?f.client.runPreparedProductDocument(session,action,new AbortController().signal):f.client.runProductDocumentDraft(session,action,new AbortController().signal));
  assert.deepEqual(plain(result.validationRejection.errors),diagnostics);assert.equal(result.preparedLifecycle,undefined);assert.equal(result.challenge,undefined);assert.equal(result.receipt,undefined);assert.equal(result.registered,false);
 }
 assert.deepEqual(plain(f.sent.map(row=>row.payload.action)),['preview','prepareDraft','recoverDraft','recoverPreparedDraft']);assert.equal(f.calls.length,0);
});

test('corrupt durable error bounds or wrong native request/document proof never project diagnostics or change the checkpoint',async()=>{
 const f=await clientFixture(SINGLE_COMPANIES[0]),native=await productValidationRejectionFixture(f.packet,{now:f.clock.now});try{
  await native.receiver.start(f.packet,SINGLE_SENDER);const saved=native.storage.get(native.context.key),writes=native.calls.filter(call=>call.startsWith('POST '));
  for(const patch of [{validationErrors:Array.from({length:201},()=>({columnName:'x',message:'x'}))},{validationErrors:[{columnName:'x'.repeat(501),message:'x'}]},
   {validationErrors:[{columnName:'x',message:'x'.repeat(2001)}]},{validationErrors:[{columnName:'x',message:7}]},{requestedStep:3},{operationId:'different-request:validate:2'},
   {docId:'protected-existing'},{identityDigest:'f'.repeat(64)},{identity:{...saved.identity,members:[{...saved.identity.members[0],optionId:'other'},saved.identity.members[1]]}}]){
   native.storage.force(native.context.key,{...saved,...patch});const corrupt=JSON.stringify(native.storage.get(native.context.key));await assert.rejects(native.receiver.recover(f.packet,SINGLE_SENDER),error=>error.code==='CHECKPOINT');
   assert.equal(JSON.stringify(native.storage.get(native.context.key)),corrupt);assert.deepEqual(native.calls.filter(call=>call.startsWith('POST ')),writes);native.assertPreserved();
  }
  native.storage.force(native.context.key,saved);const result=await native.receiver.recover(f.packet,SINGLE_SENDER);assert.deepEqual(result.validationRejection.errors,[{columnName:'supplyPrice',message:'합성 단계 검증 반려'}]);
 }finally{native.close();}
});

test('large but bounded native error details never fill the compact durable rejection ledger and explicit release remains exact',async()=>{
 const h=pending.fixture(),review=pending.review(),session=pending.session();session.packetDigest=session.preview.packetDigest='e'.repeat(64);
 const saved=await h.api.claimProductDocumentPending(review,session,h.signal),observation=pending.validationObservation(saved,session);
 observation.validationRejection.errors=Array.from({length:200},()=>({columnName:'항'.repeat(500),message:'검'.repeat(2000)}));const original=JSON.stringify(observation);
 await h.api.clearValidationRejectedProductDocumentPending(review,saved,session,observation,h.signal,async()=>true);
 assert.equal(JSON.stringify(observation),original);assert.equal(h.api.readProductDocumentPending(review),null);const key=h.api.productDocumentRejectionKey(review),raw=h.data.get(key);
 assert.ok(raw.length<4096);assert.equal(Object.hasOwn(JSON.parse(raw)[0].validationRejection,'errors'),false);assert.equal(h.api.readProductDocumentRejections(review).length,1);assert.throws(()=>h.api.assertProductDocumentNotRejected(review),/수정/);
});

test('pending release and stored-ledger parsing reject extraneous or malformed errors while preserving the reservation',async()=>{
 for(const errors of [null,[{columnName:'x',message:'x',rowIndex:1}],[{columnName:'x'.repeat(501),message:'x'}],[{columnName:'x',message:'x'.repeat(2001)}],Array.from({length:201},()=>({columnName:'x',message:'x'}))]){
  const h=pending.fixture(),review=pending.review(),session=pending.session();session.packetDigest=session.preview.packetDigest='e'.repeat(64);const saved=await h.api.claimProductDocumentPending(review,session,h.signal),observation=pending.validationObservation(saved,session);observation.validationRejection.errors=errors;
  const before=JSON.stringify([...h.data]);await assert.rejects(h.api.clearValidationRejectedProductDocumentPending(review,saved,session,observation,h.signal,async()=>true));assert.equal(JSON.stringify([...h.data]),before);assert.equal(h.api.readProductDocumentPending(review).requestId,saved.requestId);
 }
 const h=pending.fixture(),review=pending.review(),session=pending.session();session.packetDigest=session.preview.packetDigest='e'.repeat(64);const saved=await h.api.claimProductDocumentPending(review,session,h.signal),observation=pending.validationObservation(saved,session);await h.api.clearValidationRejectedProductDocumentPending(review,saved,session,observation,h.signal,async()=>true);
 const key=h.api.productDocumentRejectionKey(review),value=JSON.parse(h.data.get(key));value[0].validationRejection.errors=diagnostics;h.data.set(key,JSON.stringify(value));const rows=h.api.readProductDocumentRejections(review);assert.deepEqual(plain(rows[0].validationRejection.errors),diagnostics);assert.ok(Object.isFrozen(rows[0].validationRejection.errors));assert.ok(rows[0].validationRejection.errors.every(Object.isFrozen));
 value[0].validationRejection.errors[0].extra=true;const corrupt=JSON.stringify(value);h.data.set(key,corrupt);assert.throws(()=>h.api.readProductDocumentRejections(review));assert.equal(h.data.get(key),corrupt);
});
