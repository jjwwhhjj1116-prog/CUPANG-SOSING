import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {nativeRecoveryFixture} from './helpers/native-product-recovery.mjs';
import {createVerifiedProductDocumentBrowserAdapter} from '../extensions/supplier-hub/product-document-adapter.mjs';
import {createProductDocumentDraftReceiver} from '../extensions/supplier-hub/product-document-receiver.mjs';
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
 const requests=[],baseExecute=f.api.scripting.executeScript;
 f.api.scripting.executeScript=async request=>{
  if(request.func.name!=='savedDraftCurrentReadPage')return baseExecute(request);
  if(Object.hasOwn(options,'currentReadReply')){const frame=(await baseExecute({target:{tabId:request.target.tabId,frameIds:[0]},func:()=>true,args:[]}))[0];return[{frameId:0,documentId:frame.documentId,result:copy(options.currentReadReply)}];}
  const scope=vm.createContext({document:f.hubDocument,location:f.hubLocation,crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,URL,Response,Date,setTimeout,clearTimeout,structuredClone,
   fetch:async(url,init)=>{requests.push({url,method:init.method,body:init.body});const path=new URL(url).pathname;
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
 return{f,adapter,input,requests,receiver:createProductDocumentDraftReceiver({adapter,store:f.storage.store}),close:()=>{selected.adapter.dispose();f.close();}};
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

test('nonempty legal collection remains blocked while only bounded classification reaches the existing adapter error',async()=>{
 const options={},q=await fixture(options);try{
  const image=q.f.state.source.images[0],descriptor=q.f.state.registry.get(image.transportName),secrets=['unreviewed-private.pdf','private-link-not-in-images','Bearer-credential-value','unknownSecretFieldName','UnknownPrivateType'];
  options.legalResponse=[{fileType:'MAIN',fileName:image.transportName,s3Link:descriptor.s3Link,docId:q.f.createdDocId,message:secrets[2],[secrets[3]]:'hidden'},
    {fileType:'certificate',fileName:secrets[0],s3Link:secrets[1],docId:q.f.createdDocId+1},{fileType:secrets[4],imageName:image.transportName},null];
  const before={uploads:copy(q.f.state.uploads),body:copy([...q.f.documents]),writes:q.f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').length};
  await assert.rejects(q.adapter.qualifySavedDraftTarget(q.input),error=>{
   assert.equal(error.code,'SAVED_DRAFT_TARGET_UNCONFIRMED');assert.match(error.message,/legal-lists \/ legal-array-nonempty/);assert.match(error.message,/진단: 배열 4행·표본 4행/);assert.match(error.message,/행종류 null:1,object:3/);
   assert.match(error.message,/알려진종류 MAIN:1,certificate:1/);assert.match(error.message,/기타식별자 1/);assert.match(error.message,/동일문서 1/);assert.match(error.message,/숨긴키가 있는 행 1/);assert.ok(error.message.length<=2000);
   for(const secret of [...secrets,image.transportName,descriptor.s3Link])assert.equal(error.message.includes(secret),false,secret);return true;
  });
  assert.equal(q.f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords,undefined);assert.deepEqual(q.f.state.uploads,before.uploads);assert.deepEqual([...q.f.documents],before.body);assert.equal(q.f.calls.filter(call=>call.name==='hub-fetch'&&call.init.method==='POST').length,before.writes);
  assert.equal(q.requests.some(call=>new URL(call.url).pathname==='/sr/api/image/get-by-key'),false);
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
