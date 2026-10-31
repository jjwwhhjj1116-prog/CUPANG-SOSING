import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {nativeRecoveryFixture} from './helpers/native-product-recovery.mjs';
import {createVerifiedProductDocumentBrowserAdapter} from '../extensions/supplier-hub/product-document-adapter.mjs';
import {createProductDocumentDraftReceiver} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {unexpectedLegalAuditSchemaPage} from '../extensions/supplier-hub/unexpected-legal-audit.mjs';
const copy=value=>JSON.parse(JSON.stringify(value));
const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
const digest=value=>createHash('sha256').update(canon(value)).digest('hex');
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64');
const response=(url,value,type='application/json')=>{const reply=new Response(type==='application/json'?JSON.stringify(value):value,{headers:{'content-type':type}});Object.defineProperty(reply,'url',{value:url});return reply;};
async function fixture(options={}){
 let loseRead=options.receiver===true;
 const f=await nativeRecoveryFixture(undefined,{browser:{documentRead:row=>loseRead?null:row}});let previousTarget;
 if(options.receiver){const receiver=createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store}),started=await receiver.prepareDraft(f.packet,f.sender);assert.equal(started.state,'update-requested');assert.equal(started.docId,f.createdDocId);previousTarget=(await f.storage.store.get(f.context.key)).ownedTarget;loseRead=false;}
 else{const common=await f.start();await f.update(common);previousTarget=common.tab;}
 const baselineDocIds=[...f.documents.keys()].filter(id=>id!==f.createdDocId);
 f.closeOwnedTab();
 for(const [key,row]of f.state.registry){const s3Link=row.s3Link;f.state.registry.set(key,{...row,imageUrl:'/sr/api/image/get-by-key?key='+encodeURIComponent(s3Link),host:'supplier.coupang.com'});}
 const requests=[],appScriptRequests=[],baseExecute=f.api.scripting.executeScript,baseMessage=f.api.tabs.sendMessage;
 f.api.tabs.sendMessage=async(tabId,message,optionsForFrame)=>{
  if(message.type==='YOOFAM_READ_UNEXPECTED_LEGAL_AUDIT_SCHEMA'){
   assert.equal(tabId,f.context.identity.appTabId);assert.deepEqual(optionsForFrame,{frameId:0});
   if(options.schemaExecutionError)throw Error('PRIVATE_SCHEMA_EXECUTION_TOKEN');
   if(Object.hasOwn(options,'schemaReply'))return{ok:true,result:copy(options.schemaReply)};
   const identity=message.expected.identity,appOrigin=identity.origin,scope=vm.createContext({location:new URL(appOrigin),AbortController,TextEncoder,URL,Date,setTimeout,clearTimeout,
    fetch:async(url,init)=>{assert.equal(init.method,'GET');requests.push({url,method:init.method});const path=new URL(url).pathname;
     if(path==='/api/supplier-hub/catalog-context')return response(url,{ownerId:identity.ownerId,company:copy(f.state.company)});
     assert.equal(path,'/api/products/'+identity.productId+'/legal-documents');return response(url,{revision:identity.source.contentRevision,documents:{applicability:'not-applicable',files:[]},native:{schemaSha256:identity.schemaSha256,categoryId:identity.categoryId,company:copy(identity.company),targets:[],issues:[],files:[]}});
    }});
   scope.args=[copy(message.expected)];return{ok:true,result:copy(await vm.runInContext('('+unexpectedLegalAuditSchemaPage.toString()+')(...args)',scope))};
  }
  return baseMessage(tabId,message,optionsForFrame);
 };
 f.api.scripting.executeScript=async request=>{
  if(request.target.tabId===f.context.identity.appTabId){appScriptRequests.push(request);throw Error('Cannot access app origin: no scripting host permission');}
  if(request.func.name!=='savedDraftCurrentReadPage')return baseExecute(request);
  if(options.auditExecutionError&&(typeof request.args[0]==='string'?JSON.parse(request.args[0]):request.args[0]).mode==='audit')throw Error('PRIVATE_HUB_EXECUTION_BODY');
  if(Object.hasOwn(options,'currentReadReply')){const frame=(await baseExecute({target:{tabId:request.target.tabId,frameIds:[0]},func:()=>true,args:[]}))[0];return[{frameId:0,documentId:frame.documentId,result:copy(options.currentReadReply)}];}
  const scope=vm.createContext({document:f.hubDocument,location:f.hubLocation,crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,URL,Response,Date,setTimeout,clearTimeout,structuredClone,
   fetch:async(url,init)=>{requests.push({url,method:init.method,body:init.body});if(options.beforeCurrentReadFetch)await options.beforeCurrentReadFetch(url,init,f);const path=new URL(url).pathname;
    if(path==='/sr/draft/api/drafts')return response(url,[...f.documents.values()].map(row=>({...copy(row),status:'UNFINISHED'})));
    if(path==='/sr/draft/api/drafts/register-requested')return response(url,options.submitted?[{docId:f.createdDocId,productName:f.documents.get(f.createdDocId).productName}]:[]);
    if(path==='/sr/draft/api/get-by-id/'+f.createdDocId){const row={...copy(f.documents.get(f.createdDocId)),status:'UNFINISHED'};if(options.changedBody)row.productName+='changed';return response(url,row);}
    if(path==='/sr/draft/api/get-images-by-id/'+f.createdDocId){const files=[...f.state.registry.values()].map(copy);if(options.missingFile)files.pop();return response(url,files);}
    if(path==='/sr/draft/api/get-files-by-type/'+f.createdDocId){assert.equal(init.method,'POST');assert.equal(init.body,'{}');return response(url,Object.hasOwn(options,'legalResponse')?options.legalResponse:[]);}
    assert.equal(path,'/sr/api/image/get-by-key');assert.equal(init.method,'GET');return response(url,options.changedBytes?bytes.subarray(1):bytes,'image/png');
   }});
  const frame=(await baseExecute({target:{tabId:request.target.tabId,frameIds:[0]},func:()=>true,args:[]}))[0];
  scope.args=copy(request.args);const result=await vm.runInContext('('+request.func.toString()+')(...args)',scope);return[{frameId:0,documentId:frame.documentId,result:copy(result)}];
 };
 const selected=await createVerifiedProductDocumentBrowserAdapter(f.context,{api:f.api}),adapter=selected.adapter;
 const source=await adapter.readSource({identity:f.context.identity,bodySha256:f.context.originalBodySha256,preparedBodySha256:f.context.bodySha256,packetDigest:f.context.packetDigest,requestId:f.packet.requestId,docId:f.createdDocId});
 const target=options.receiver?null:await adapter.createTarget({identity:f.context.identity,requestId:f.packet.requestId,packetDigest:f.context.packetDigest}),tab=target?await adapter.readTab({identity:f.context.identity,tab:target}):null;
 const input={tab,identity:f.context.identity,requestId:f.packet.requestId,docId:f.createdDocId,sessionId:source.sessionId,baselineDocIds,previousTarget,expectedBody:{...copy(f.context.packet.body),docId:f.createdDocId}};
 return{f,adapter,input,requests,appScriptRequests,receiver:createProductDocumentDraftReceiver({adapter,store:f.storage.store}),close:()=>{selected.adapter.dispose();f.close();}};
}
test('known document can bind current complete server proof in one new tab without replaying files/body',async()=>{
 const q=await fixture();try{
  const before={uploads:copy(q.f.state.uploads),body:copy([...q.f.documents]),writes:q.f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').length};
  const proof=await q.adapter.qualifySavedDraftTarget(q.input);
  assert.equal(proof.format,'yoofam-current-saved-draft-target-v1');assert.equal(proof.historicalAckRecovered,false);assert.equal(proof.readOnly,true);assert.equal(proof.remoteWrites,false);assert.equal(proof.filesCount,4);
  assert.equal(proof.identityDigest,q.f.context.identityDigest);assert.equal(proof.packetDigest,q.f.context.packetDigest);assert.equal(proof.bodySha256,q.f.context.bodySha256);assert.equal(proof.baselineSha256,digest(q.input.baselineDocIds));
  const record=JSON.parse(q.f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords)[q.f.context.packetDigest];
  assert.equal(record.updateOperationId,undefined);assert.equal(record.nativeAssets,undefined);assert.equal(record.validation,undefined);assert.equal(record.currentReadRecovery.fileBodyWritesAllowed,false);assert.equal(record.currentReadRecovery.proofSha256,digest(proof));
  const qualified=await q.adapter.qualifyPreparedDraft(q.input);assert.equal(qualified.metadataObserved,true);assert.equal(qualified.readOnly,true);
  const write={...q.input,method:'POST',path:'/sr/draft/api/update',operationId:q.input.requestId+':update',body:q.input.expectedBody};
  await assert.rejects(()=>q.adapter.hubRequest(write),error=>error.code==='SAVED_DRAFT_TARGET_READ_ONLY');
  assert.deepEqual(q.f.state.uploads,before.uploads);assert.deepEqual([...q.f.documents],before.body);
  assert.equal(q.f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').length,before.writes);
  assert.ok(q.requests.every(call=>call.method==='GET'||new URL(call.url).pathname.startsWith('/sr/draft/api/get-files-by-type/')&&call.body==='{}'));
 }finally{q.close();}
});
for(const [name,options]of Object.entries({missingFile:{missingFile:true},changedBody:{changedBody:true},changedBytes:{changedBytes:true},alreadySubmitted:{submitted:true}}))test('current server recovery rejects '+name+' without stored acknowledgment fabrication',async()=>{
 const q=await fixture(options);try{await assert.rejects(()=>q.adapter.qualifySavedDraftTarget(q.input),error=>error.code==='SAVED_DRAFT_TARGET_UNCONFIRMED');assert.equal(q.f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords,undefined);}
 finally{q.close();}
});
test('current proof remains fixed while only a previously observed and durably authorized stage flag can advance',async()=>{
 const q=await fixture();try{
  const proof=await q.adapter.qualifySavedDraftTarget(q.input),data=q.f.hubDocument.documentElement.dataset,records=JSON.parse(data.yoofamSingleDocumentRecords),record=records[q.f.context.packetDigest];
  record.state='validated';record.stageConsentOperations={productPage:{state:'observed',operationId:q.input.requestId+':stage-consent:productPage'}};data.yoofamSingleDocumentRecords=JSON.stringify(records);
  q.f.documents.get(q.f.createdDocId).jsonDocument[0].imagePage.msrpAgree=true;
  await assert.rejects(()=>q.adapter.qualifyPreparedDraft(q.input),error=>error.code==='SAVED_DRAFT_TARGET_UNCONFIRMED');
  const input={...q.input,stageConsents:[{stage:'productPage',confirmedAt:Date.now()}]};
  const qualified=await q.adapter.qualifyPreparedDraft(input);assert.equal(qualified.readOnly,true);
  const after=JSON.parse(data.yoofamSingleDocumentRecords)[q.f.context.packetDigest];assert.deepEqual(after.currentReadRecovery.proof,proof);assert.equal(after.updateOperationId,undefined);
  q.f.documents.get(q.f.createdDocId).jsonDocument[0].imagePage.labelContactAgreed=true;
  await assert.rejects(()=>q.adapter.qualifyPreparedDraft(input),error=>error.code==='SAVED_DRAFT_TARGET_UNCONFIRMED');
 }finally{q.close();}
});
test('real native receiver preserves original requested update and completes only validations after closed saved-target recovery',async()=>{
 const q=await fixture({receiver:true});try{
  const before={uploads:copy(q.f.state.uploads),body:copy([...q.f.documents]),writes:q.f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').map(call=>call.url)};
  const checkpointBefore=await q.f.storage.store.get(q.f.context.key);
  const read=await q.receiver.recoverPreparedDraft(q.f.packet,q.f.sender);assert.equal(read.error.code,'SAVED_DRAFT_TARGET_CLOSED');assert.equal(read.draftOnly,true);assert.equal(read.docId,q.f.createdDocId);
  const recovered=await q.receiver.recoverSavedDraftTarget(q.f.packet,q.f.sender);assert.equal(recovered.error,undefined);assert.equal(recovered.state,'updated');assert.equal(recovered.docId,q.f.createdDocId);assert.deepEqual(recovered.draftProof.validatedSteps,[]);
  const validated=await q.receiver.prepareDraft(q.f.packet,q.f.sender);assert.equal(validated.error,undefined);assert.equal(validated.state,'validated');assert.deepEqual(validated.draftProof.validatedSteps,[2,3,4,5]);
  const checkpoint=await q.f.storage.store.get(q.f.context.key);assert.equal(checkpoint.requestId,checkpointBefore.requestId);assert.equal(checkpoint.operationId,checkpointBefore.requestId+':validate:5');assert.deepEqual(checkpoint.baselineDocIds,checkpointBefore.baselineDocIds);assert.deepEqual(checkpoint.savedDraftTargetRecovery.previousTarget,checkpointBefore.ownedTarget);
  const writes=q.f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').map(call=>call.url);assert.deepEqual(writes.slice(before.writes.length),[2,3,4,5].map(step=>'https://supplier.coupang.com/sr/qvt/api/validate-step/'+step));
  assert.deepEqual(q.f.state.uploads,before.uploads);assert.deepEqual([...q.f.documents],before.body);assert.equal(q.f.submitted,0);
 }finally{q.close();}
});

test('a reserved-target recovery retains full start/final source checks with seven native plan GETs including fresh adapter selection',async()=>{
 const options={receiver:true,missingFile:true},q=await fixture(options);let selected;
 try{
  const failed=await q.receiver.recoverSavedDraftTarget(q.f.packet,q.f.sender);assert.equal(failed.error.code,'SAVED_DRAFT_TARGET_UNCONFIRMED');
  const reserved=await q.f.storage.store.get(q.f.context.key),target=copy(reserved.savedDraftTargetRecovery.target);assert.equal(reserved.savedDraftTargetRecovery.phase,'created');options.missingFile=false;
  const start=q.f.state.appReads.length,requests=q.requests.length,created=q.f.calls.filter(call=>call.name==='tabs-create').length,before=JSON.stringify({uploads:q.f.state.uploads,documents:[...q.f.documents]});
  selected=await createVerifiedProductDocumentBrowserAdapter(q.f.context,{api:q.f.api});
  const receiver=createProductDocumentDraftReceiver({adapter:selected.adapter,store:q.f.storage.store}),result=await receiver.recoverSavedDraftTarget(q.f.packet,q.f.sender);
  assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.state,'updated');
  const reads=q.f.state.appReads.slice(start).filter(url=>new URL(url).pathname.endsWith('/native-assets'));assert.equal(reads.length,7,'selection 1 + full start 3 + full final 3; no nested qualifier source GETs');
  const current=q.requests.slice(requests),metadata=current.filter(call=>new URL(call.url).pathname.startsWith('/sr/draft/api/')),binary=current.filter(call=>new URL(call.url).pathname==='/sr/api/image/get-by-key');
  assert.equal(metadata.length,10,'both complete read/bind observations keep all five server metadata reads');assert.equal(binary.length,q.f.state.source.images.length*2,'both observations independently verify every file byte');
  assert.equal(q.f.calls.filter(call=>call.name==='tabs-create').length,created);assert.equal(JSON.stringify({uploads:q.f.state.uploads,documents:[...q.f.documents]}),before);
  const saved=await q.f.storage.store.get(q.f.context.key);assert.deepEqual(saved.savedDraftTargetRecovery.target,target);assert.deepEqual(saved.ownedTarget,target);assert.equal(saved.savedDraftTargetRecovery.proof.historicalAckRecovered,false);
 }finally{selected?.adapter.dispose();q.close();}
});

test('saved-target source receipts are opaque, latest-only, consumed on failure, and invalid after disposal',async()=>{
 for(const scenario of ['clone','superseded','scope-failure','read-failure','disposed']){
  const options={},q=await fixture(options);
  try{
   const input={identity:q.input.identity,bodySha256:q.f.context.originalBodySha256,preparedBodySha256:q.f.context.bodySha256,packetDigest:q.f.context.packetDigest,requestId:q.input.requestId,docId:q.input.docId};
   const proof=await q.adapter.readSource(input);let lease={sourceProof:proof};
   if(scenario==='clone')lease={sourceProof:copy(proof)};
   if(scenario==='superseded')await q.adapter.readSource(input);
   if(scenario==='scope-failure'){await assert.rejects(q.adapter.qualifySavedDraftTarget({...q.input,docId:null},lease),error=>error.code==='SAVED_DRAFT_TARGET_SCOPE');}
   if(scenario==='read-failure'){options.missingFile=true;await assert.rejects(q.adapter.qualifySavedDraftTarget(q.input,lease),error=>error.code==='SAVED_DRAFT_TARGET_UNCONFIRMED');options.missingFile=false;}
   if(scenario==='disposed')q.adapter.dispose();
   const before=q.requests.length;await assert.rejects(q.adapter.qualifySavedDraftTarget(q.input,lease),error=>error.code==='SOURCE_CHANGED');assert.equal(q.requests.length,before,'an invalid receipt cannot reach the Hub reader');
   assert.equal(q.f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords,undefined);
  }finally{q.close();}
 }
});

test('a saved-target read receipt cannot bypass the independent source and ownership guards of a body write',async()=>{
 const q=await fixture();try{
  const input={identity:q.input.identity,bodySha256:q.f.context.originalBodySha256,preparedBodySha256:q.f.context.bodySha256,packetDigest:q.f.context.packetDigest,requestId:q.input.requestId,docId:q.input.docId},proof=await q.adapter.readSource(input),start=q.f.state.appReads.length,writes=q.f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').length;
  await assert.rejects(q.adapter.hubRequest({...q.input,method:'POST',path:'/sr/draft/api/update',operationId:q.input.requestId+':update',body:q.input.expectedBody},{sourceProof:proof}),error=>error.code==='OWNED_RECORD_MISSING');
  assert.equal(q.f.state.appReads.slice(start).filter(url=>new URL(url).pathname.endsWith('/native-assets')).length,3,'body-write guards always perform their own complete source verification');
  assert.equal(q.f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').length,writes);await assert.rejects(q.adapter.qualifySavedDraftTarget(q.input,{sourceProof:proof}),error=>error.code==='SOURCE_CHANGED');
 }finally{q.close();}
});

for(const drift of ['company','source','session'])test('reserved-target final source verification rejects '+drift+' drift after read-only observations',async()=>{
 const options={receiver:true,missingFile:true},q=await fixture(options);
 try{
  assert.equal((await q.receiver.recoverSavedDraftTarget(q.f.packet,q.f.sender)).error.code,'SAVED_DRAFT_TARGET_UNCONFIRMED');options.missingFile=false;
  const before=JSON.stringify({uploads:q.f.state.uploads,documents:[...q.f.documents]}),reserved=await q.f.storage.store.get(q.f.context.key);let changed=false;
  options.beforeCurrentReadFetch=async(url,_init,f)=>{if(changed||new URL(url).pathname!=='/sr/api/image/get-by-key')return;changed=true;
   if(drift==='company')f.state.company={code:'A01464742',name:'와이홉'};else if(drift==='source')f.state.source.body.productName+='changed';else await f.reloadSourceSession();};
  const reply=await q.receiver.recoverSavedDraftTarget(q.f.packet,q.f.sender);assert.equal(reply.error.code,'SOURCE_CHANGED',JSON.stringify(reply));assert.equal(changed,true);
  const saved=await q.f.storage.store.get(q.f.context.key);assert.equal(saved.savedDraftTargetRecovery.phase,'created');assert.deepEqual(saved.savedDraftTargetRecovery.target,reserved.savedDraftTargetRecovery.target);assert.equal(JSON.stringify({uploads:q.f.state.uploads,documents:[...q.f.documents]}),before);
 }finally{q.close();}
});

test('nonempty legal collection remains blocked while only bounded classification reaches the existing adapter error',async()=>{
 const options={},q=await fixture(options);try{
  const image=q.f.state.source.images[0],descriptor=q.f.state.registry.get(image.transportName),secrets=['unreviewed-private.pdf','private-link-not-in-images','Bearer-credential-value','unknownSecretFieldName','UnknownPrivateType'];
  options.legalResponse=[{fileType:'MAIN',fileName:image.transportName,s3Link:descriptor.s3Link,docId:q.f.createdDocId,message:secrets[2],[secrets[3]]:'hidden'},
    {fileType:'certificate',fileName:secrets[0],s3Link:secrets[1],docId:q.f.createdDocId+1},{fileType:secrets[4],imageName:image.transportName},null];
  const before={uploads:copy(q.f.state.uploads),body:copy([...q.f.documents]),writes:q.f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').length};
  await assert.rejects(q.adapter.qualifySavedDraftTarget(q.input),error=>{
   assert.equal(error.code,'SAVED_DRAFT_TARGET_UNCONFIRMED');assert.match(error.message,/legal-lists \/ legal-array-nonempty/);assert.match(error.message,/진단: 배열 4행·표본 4행/);assert.match(error.message,/행종류 null:1,object:3/);
   assert.match(error.message,/알려진종류 MAIN:1,certificate:1/);assert.match(error.message,/기타식별자 1/);assert.match(error.message,/동일문서 1/);assert.match(error.message,/숨긴키가 있는 행 1/);assert.ok(error.message.length<=2000);
   assert.match(error.message,/동일 이미지명·S3 1/);assert.match(error.message,/인증 접두 행 없음/);assert.match(error.message,/법적 본문 원래값 일치/);
   for(const secret of [...secrets,image.transportName,descriptor.s3Link])assert.equal(error.message.includes(secret),false,secret);return true;
  });
  assert.equal(q.f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords,undefined);assert.deepEqual(q.f.state.uploads,before.uploads);assert.deepEqual([...q.f.documents],before.body);assert.equal(q.f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').length,before.writes);
  assert.equal(q.requests.some(call=>new URL(call.url).pathname==='/sr/api/image/get-by-key'),false);
 }finally{q.close();}
});

test('v2 association diagnostics remain failure-only and reject malformed relations without reflecting unknown values',async()=>{
 const missing={type:'missing',expectedImageMatch:false},row={index:0,type:'object',keys:['docId','fileName','fileType','s3Link'],keyCount:4,keysTruncated:false,
  fileType:{type:'string',knownType:'certificate',identifier:true},fileName:{type:'string',expectedImageMatch:true},imageName:missing,s3Link:{type:'string',expectedImageMatch:true},docId:{type:'number',same:true},
  certificateNamePrefix:{type:'string',matchedIndex:0,ambiguous:false,scanComplete:true,memberRowMatches:1},pairedImageDescriptorMatch:true,expectedLabelReferences:1};
 const certificate={index:0,type:'object',fieldCount:2,fieldKinds:{null:0,array:0,object:0,'string-empty':0,string:2,number:0,boolean:0},expectedRowMatch:true};
 const member={index:0,remoteLegalType:'object',expectedLegalType:'object',remoteCertificatesType:'array',expectedCertificatesType:'array',remoteCount:1,expectedCount:1,matchesExpected:true,truncated:false,rows:[certificate]};
 const relation={format:'yoofam-saved-draft-legal-body-relations-v1',memberCount:1,truncated:false,remoteLegalMatchesExpected:true,members:[member]};
 const reply={currentReadFailure:{format:'yoofam-current-saved-draft-read-failure-v1',phase:'legal-lists',code:'legal-array-nonempty',diagnostics:{format:'yoofam-saved-draft-legal-diagnostics-v2',collection:'array',count:1,truncated:false,rows:[row],bodyRelations:relation}}};
 const secret='PRIVATE_RELATION_CREDENTIAL_876',options={currentReadReply:reply},q=await fixture(options);try{
  await assert.rejects(q.adapter.qualifySavedDraftTarget(q.input),error=>{assert.equal(error.code,'SAVED_DRAFT_TARGET_UNCONFIRMED');assert.match(error.message,/동일 이미지명·S3 1/);assert.match(error.message,/LABEL 원래 본문 참조 1/);assert.match(error.message,/인증 접두 행 0 \/ 모호 0/);assert.match(error.message,/본문 연결행 1/);assert.match(error.message,/법적 본문 원래값 일치/);assert.ok(error.message.length<=2000);return true;});
  const mutate=[
   d=>{d.extra=secret;},d=>{delete d.bodyRelations;},d=>{d.bodyRelations.extra=secret;},d=>{d.bodyRelations.format=secret;},d=>{d.bodyRelations.memberCount=201;},d=>{d.bodyRelations.memberCount=0;},d=>{d.bodyRelations.memberCount=1.5;},d=>{d.bodyRelations.truncated=true;},d=>{d.bodyRelations.remoteLegalMatchesExpected=secret;},
   d=>{d.bodyRelations.members[0].extra=secret;},d=>{d.bodyRelations.members[0].index=1;},d=>{d.bodyRelations.members[0].remoteLegalType=secret;},d=>{d.bodyRelations.members[0].remoteCount=null;},d=>{d.bodyRelations.members[0].remoteCount=0;},d=>{d.bodyRelations.members[0].expectedCount=-1;},d=>{d.bodyRelations.members[0].expectedCount=2;},d=>{d.bodyRelations.members[0].matchesExpected=secret;},d=>{d.bodyRelations.members[0].matchesExpected=false;},d=>{d.bodyRelations.members[0].expectedCertificatesType='object';d.bodyRelations.members[0].expectedCount=null;},d=>{d.bodyRelations.members[0].truncated=true;},
   d=>{d.bodyRelations.members[0].rows[0].extra=secret;},d=>{d.bodyRelations.members[0].rows[0].fieldKinds.extra=secret;},d=>{d.bodyRelations.members[0].rows[0].fieldKinds.string=3;},d=>{d.bodyRelations.members[0].rows[0].fieldKinds.string=-1;},d=>{d.bodyRelations.members[0].rows[0].type='string';},d=>{d.bodyRelations.members[0].rows[0].type=secret;},d=>{d.bodyRelations.members[0].rows[0].expectedRowMatch=secret;},d=>{d.bodyRelations.members[0].rows[0].expectedRowMatch=false;},
   d=>{d.rows[0].certificateNamePrefix.extra=secret;},d=>{d.rows[0].certificateNamePrefix.type='missing';},d=>{d.rows[0].certificateNamePrefix.matchedIndex=200;},d=>{d.rows[0].certificateNamePrefix.matchedIndex=-1;},d=>{d.rows[0].certificateNamePrefix.matchedIndex=null;},d=>{d.rows[0].certificateNamePrefix.ambiguous=true;},d=>{d.rows[0].certificateNamePrefix.scanComplete=false;},d=>{d.rows[0].certificateNamePrefix.memberRowMatches=2;},
   d=>{d.rows[0].pairedImageDescriptorMatch=secret;},d=>{d.rows[0].fileName.expectedImageMatch=false;},d=>{d.rows[0].expectedLabelReferences=40001;},d=>{d.rows[0].expectedLabelReferences=secret;},
   d=>{d.bodyRelations.members[0].remoteCount=13;d.bodyRelations.members[0].rows=Array.from({length:13},(_,index)=>({...copy(certificate),index}));},
  ];
  for(const change of mutate){const invalid=copy(reply);change(invalid.currentReadFailure.diagnostics);options.currentReadReply=invalid;await assert.rejects(q.adapter.qualifySavedDraftTarget(q.input),error=>{assert.equal(error.code,'SAVED_DRAFT_TARGET_UNCONFIRMED');assert.equal(error.message.includes('진단:'),false);assert.equal(error.message.includes(secret),false);return true;});}
  assert.equal(q.f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords,undefined);assert.equal(q.requests.length,0);
 }finally{q.close();}
});

test('adapter ignores malformed or unbounded legal diagnostics wholesale and never reflects unknown values',async()=>{
 const missing={type:'missing',expectedImageMatch:false},row={index:0,type:'object',keys:['docId','fileName','fileType','s3Link'],keyCount:4,keysTruncated:false,
  fileType:{type:'string',knownType:'MAIN',identifier:true},fileName:{type:'string',expectedImageMatch:true},imageName:missing,s3Link:{type:'string',expectedImageMatch:true},docId:{type:'number',same:true}};
 const reply={currentReadFailure:{format:'yoofam-current-saved-draft-read-failure-v1',phase:'legal-lists',code:'legal-array-nonempty',diagnostics:{format:'yoofam-saved-draft-legal-diagnostics-v1',collection:'array',count:1,truncated:false,rows:[row]}}};
 const secret='untrusted-private-diagnostic-value',options={currentReadReply:reply},q=await fixture(options);try{
  await assert.rejects(q.adapter.qualifySavedDraftTarget(q.input),error=>error.code==='SAVED_DRAFT_TARGET_UNCONFIRMED'&&error.message.includes('진단: 배열 1행'));
  const mutate=[
   value=>{value.extra=secret;},value=>{value.currentReadFailure.format=secret;},value=>{value.currentReadFailure.phase='body';},value=>{value.currentReadFailure.code='legal-object-nonempty';},
   value=>{value.currentReadFailure.extra=secret;},value=>{value.currentReadFailure.diagnostics.extra=secret;},value=>{value.currentReadFailure.diagnostics.format=secret;},value=>{value.currentReadFailure.diagnostics.collection='object';},
   value=>{value.currentReadFailure.diagnostics.count=0;},value=>{value.currentReadFailure.diagnostics.count=3145729;},value=>{value.currentReadFailure.diagnostics.count=1.5;},value=>{value.currentReadFailure.diagnostics.count=13;},value=>{value.currentReadFailure.diagnostics.truncated=true;},
   value=>{value.currentReadFailure.diagnostics.rows=[];},value=>{value.currentReadFailure.diagnostics.rows=Array.from({length:13},(_,index)=>({...copy(row),index}));value.currentReadFailure.diagnostics.count=13;},
   value=>{value.currentReadFailure.diagnostics.rows[0].index=1;},value=>{value.currentReadFailure.diagnostics.rows[0].type=secret;},value=>{value.currentReadFailure.diagnostics.rows[0].extra=secret;},
   value=>{value.currentReadFailure.diagnostics.rows[0].keys.push(secret);},value=>{value.currentReadFailure.diagnostics.rows[0].keys.reverse();},value=>{value.currentReadFailure.diagnostics.rows[0].keys=['docId','docId'];},
   value=>{value.currentReadFailure.diagnostics.rows[0].keyCount=-1;},value=>{value.currentReadFailure.diagnostics.rows[0].keyCount=3145729;},value=>{value.currentReadFailure.diagnostics.rows[0].keysTruncated=true;},
   value=>{value.currentReadFailure.diagnostics.rows[0].fileType.knownType=secret;},value=>{value.currentReadFailure.diagnostics.rows[0].fileType.type=secret;},value=>{value.currentReadFailure.diagnostics.rows[0].fileType.identifier='true';},
   value=>{value.currentReadFailure.diagnostics.rows[0].fileType.type='number';},value=>{value.currentReadFailure.diagnostics.rows[0].fileType.identifier=false;},value=>{value.currentReadFailure.diagnostics.rows[0].fileType.extra=secret;},
   value=>{value.currentReadFailure.diagnostics.rows[0].fileName.type='null';},value=>{value.currentReadFailure.diagnostics.rows[0].imageName.expectedImageMatch=true;},value=>{value.currentReadFailure.diagnostics.rows[0].s3Link.type='string-empty';},
   value=>{value.currentReadFailure.diagnostics.rows[0].docId.type='object';},value=>{value.currentReadFailure.diagnostics.rows[0].docId.same='true';},value=>{value.currentReadFailure.diagnostics.rows[0].keys=['docId','fileType','s3Link'];value.currentReadFailure.diagnostics.rows[0].keyCount=3;},
   value=>{value.currentReadFailure.diagnostics.rows[0].type='array';},value=>{delete value.currentReadFailure.diagnostics;},
  ];
  for(const change of mutate){const invalid=copy(reply);change(invalid);options.currentReadReply=invalid;await assert.rejects(q.adapter.qualifySavedDraftTarget(q.input),error=>{
    assert.equal(error.code,'SAVED_DRAFT_TARGET_UNCONFIRMED');assert.equal(error.message.includes('진단:'),false);assert.equal(error.message.includes(secret),false);assert.ok(error.message.length<=2000);return true;
   });}
  assert.equal(q.f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords,undefined);assert.equal(q.requests.length,0);
 }finally{q.close();}
});

test('sampled legal diagnostic summaries stay bounded and report only fixed key names',async()=>{
 const options={},q=await fixture(options);try{
  const secret='private-row-key-and-value',known=['attachmentType','byteLength','categoryId','certificateType','code','contentType','createdAt','data','disabled','docId','documentId','errorCode','fileId','fileName','fileSize','fileType','host','id','imageData','imageName','imageUrl','mainImage','message','mimeType','modifiedAt','name','productId','s3Link','sha256','size','status','type','version'];
  options.legalResponse=Array.from({length:100},()=>({...Object.fromEntries(known.map(key=>[key,secret])),[secret]:secret}));
  await assert.rejects(q.adapter.qualifySavedDraftTarget(q.input),error=>{assert.equal(error.code,'SAVED_DRAFT_TARGET_UNCONFIRMED');assert.match(error.message,/진단: 배열 100행·표본 12행\(일부\)/);assert.match(error.message,/숨긴키가 있는 행 12/);assert.equal(error.message.includes(secret),false);assert.ok(error.message.length<=2000);return true;});
  assert.equal(q.f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords,undefined);
 }finally{q.close();}
});

for(const code of ['http-redirect','http-401','http-403','http-type-other'])test('saved read '+code+' provides registration login advice without replay',async()=>{
 const q=await fixture({currentReadReply:{currentReadFailure:{format:'yoofam-current-saved-draft-read-failure-v1',phase:'draft-list',code}}});try{
  const before={uploads:copy(q.f.state.uploads),body:copy([...q.f.documents]),writes:q.f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').length};
  await assert.rejects(q.adapter.qualifySavedDraftTarget(q.input),error=>error.code==='SAVED_DRAFT_TARGET_UNCONFIRMED'&&error.message.includes('로그인')&&error.message.includes('파일·본문은 다시 보내지 않았습니다.'));
  assert.equal(q.f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords,undefined);
  assert.deepEqual(q.f.state.uploads,before.uploads);assert.deepEqual([...q.f.documents],before.body);
  assert.equal(q.f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').length,before.writes);
 }finally{q.close();}
});


test('real native reserved-target audit keeps the original checkpoint, DOM, files and body byte-for-byte while still verifying bytes and duplicate lists',async()=>{
 const options={receiver:true,legalResponse:[{fileType:'certificate',fileName:'PRIVATE_UNEXPECTED_FILE.pdf',s3Link:'PRIVATE_UNEXPECTED_S3'}]},q=await fixture(options);
 try{
  assert.equal((await q.receiver.recoverSavedDraftTarget(q.f.packet,q.f.sender)).error.code,'SAVED_DRAFT_TARGET_UNCONFIRMED');
  const before=JSON.stringify({checkpoint:await q.f.storage.store.get(q.f.context.key),dataset:q.f.hubDocument.documentElement.dataset,uploads:q.f.state.uploads,body:[...q.f.documents]}),created=q.f.calls.filter(call=>call.name==='tabs-create').length,start=q.requests.length;
  const result=await q.receiver.auditUnexpectedLegal(q.f.packet,q.f.sender);
  assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.format,'yoofam-unexpected-legal-audit-v1');assert.equal(result.docId,q.f.createdDocId);assert.equal(result.legalCount,1);assert.equal(result.imageCount,4);assert.equal(result.bodyMatchesExpected,true);assert.equal(result.canResume,false);assert.equal(result.canDelete,false);assert.equal(result.remoteWrites,false);assert.equal(result.checkpointWrites,false);assert.equal(result.legalEntries[0].association,'unknown');
  assert.equal(JSON.stringify({checkpoint:await q.f.storage.store.get(q.f.context.key),dataset:q.f.hubDocument.documentElement.dataset,uploads:q.f.state.uploads,body:[...q.f.documents]}),before);
  assert.equal(q.f.calls.filter(call=>call.name==='tabs-create').length,created);assert.equal(q.f.submitted,0);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|s3Link|fileName/);
  assert.deepEqual(q.appScriptRequests,[],'a host-denied app executeScript must never be attempted; the manifest content reader owns these same three GETs');
  const current=q.requests.slice(start);assert.equal(current.filter(call=>new URL(call.url).pathname==='/sr/api/image/get-by-key').length,4);assert.equal(current.filter(call=>new URL(call.url).pathname==='/api/products/'+q.f.context.identity.productId+'/legal-documents').length,1);assert.equal(current.filter(call=>new URL(call.url).pathname.includes('/get-files-by-type/')).length,1);
  assert.ok(current.every(call=>call.method==='GET'||new URL(call.url).pathname.includes('/get-files-by-type/')&&call.body==='{}'));
  assert.equal((await q.receiver.recoverSavedDraftTarget(q.f.packet,q.f.sender)).error.code,'SAVED_DRAFT_TARGET_UNCONFIRMED','normal qualification is not weakened by the audit');
 }finally{q.close();}
});

for(const scenario of ['schema-execution','schema-http','malformed-schema-failure','hub-execution','malformed-report','hub-http'])test('reserved audit classifies '+scenario+' without uncertain-write advice or leaking exceptions',async()=>{
 const options={receiver:true,legalResponse:[{fileType:'certificate',fileName:'PRIVATE_UNEXPECTED_FILE.pdf',s3Link:'PRIVATE_UNEXPECTED_S3'}]},q=await fixture(options);
 try{
  assert.equal((await q.receiver.recoverSavedDraftTarget(q.f.packet,q.f.sender)).error.code,'SAVED_DRAFT_TARGET_UNCONFIRMED');
  const before=JSON.stringify({checkpoint:await q.f.storage.store.get(q.f.context.key),dataset:q.f.hubDocument.documentElement.dataset,uploads:q.f.state.uploads,body:[...q.f.documents]}),created=q.f.calls.filter(call=>call.name==='tabs-create').length;
  let code;
  if(scenario==='schema-execution'){options.schemaExecutionError=true;code='UNEXPECTED_LEGAL_AUDIT_SCHEMA_EXECUTION';}
  if(scenario==='schema-http'){options.schemaReply={schemaReadFailure:{format:'yoofam-unexpected-legal-schema-read-failure-v1',phase:'legal-documents',code:'http-503'}};code='UNEXPECTED_LEGAL_AUDIT_SCHEMA_READ';}
  if(scenario==='malformed-schema-failure'){options.schemaReply={schemaReadFailure:{format:'yoofam-unexpected-legal-schema-read-failure-v1',phase:'PRIVATE_SECRET',code:'PRIVATE_ERROR'}};code='UNEXPECTED_LEGAL_AUDIT_SCHEMA';}
  if(scenario==='hub-execution'){options.auditExecutionError=true;code='UNEXPECTED_LEGAL_AUDIT_EXECUTION';}
  if(scenario==='malformed-report'){options.currentReadReply={untrusted:'PRIVATE_REPORT'};code='UNEXPECTED_LEGAL_AUDIT_REPORT';}
  if(scenario==='hub-http'){options.currentReadReply={currentReadFailure:{format:'yoofam-current-saved-draft-read-failure-v1',phase:'image-bytes',code:'http-timeout'}};code='UNEXPECTED_LEGAL_AUDIT_READ';}
  await assert.rejects(q.receiver.auditUnexpectedLegal(q.f.packet,q.f.sender),error=>{
   assert.equal(error.code,code);assert.doesNotMatch(error.message,/PRIVATE|현재 전송 기록을 조회|요청 결과를 확정/);if(scenario==='schema-http')assert.match(error.message,/legal-documents \/ http-503/);return true;
  });
  assert.equal(JSON.stringify({checkpoint:await q.f.storage.store.get(q.f.context.key),dataset:q.f.hubDocument.documentElement.dataset,uploads:q.f.state.uploads,body:[...q.f.documents]}),before);
  assert.equal(q.f.calls.filter(call=>call.name==='tabs-create').length,created);assert.equal(q.f.submitted,0);
 }finally{q.close();}
});
