import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {savedDraftCurrentReadPage} from '../extensions/supplier-hub/saved-draft-current-read-page.mjs';

const origin='https://supplier.coupang.com',copy=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const sha=value=>createHash('sha256').update(canonical(value)).digest('hex'),byteSha=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>JSON.parse(JSON.stringify(value));
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const clock={now:Date.now()},calls=[],timers=new Map(),dataset={};let records='{}',writes=0,sequence=0;
 Object.defineProperty(dataset,'yoofamSingleDocumentRecords',{get:()=>records,set:value=>{records=value;writes++;},enumerable:true});
 const identity={origin:'https://sourceflow.jjwwhhjj1116.workers.dev',appTabId:4,windowId:7,ownerId:'current-owner',company:{code:'A01526306',name:'유앤채'},productId:'native-product',categoryId:'8091',fingerprint:'f'.repeat(64),members:[0,1,2].map(documentIndex=>({optionId:'option-'+documentIndex,optionLabel:'원래 옵션 '+documentIndex,documentIndex}))};
 const expectedBody={docId:2347603,productName:'원래 저장 상품',categoryPath:'생활용품 > 원래 분류',categoryId:'8091',displayCategoryCode:'68183',jsonDocument:identity.members.map(member=>({startPage:{productName:member.optionLabel},productPage:{commonAttributes:{purchasePrice:'1000'}},legalPage:{adCert:''},imagePage:{msrpAgree:false,labelContactAgreed:false}})),scope:'Retail_Categorized_Single',productNoticeNumber:'12',version:188};
 const prepared={...copy(expectedBody),docId:null},logicalIdentity=Object.fromEntries(Object.entries(identity).filter(([key])=>!['appTabId','windowId'].includes(key))),preparedBodySha256=sha(prepared);
 const binding={identity,identityDigest:sha(identity),packetDigest:sha({identity:logicalIdentity,bodySha256:preparedBodySha256,originalBodySha256:preparedBodySha256}),preparedBodySha256,originalBodySha256:preparedBodySha256,nativeAssetSourcePlanSha256:identity.fingerprint,sessionId:'native-session',requestId:'f294-current-saved-request'};
 const binaries=new Map(),expectedImages=[];for(let index=0;index<9;index++){const transportName='stored-image-'+index+'.png',bytes=new Uint8Array([137,80,78,71,index,7,19,25]);binaries.set(transportName,bytes);expectedImages.push({transportName,contentType:'image/png',byteLength:bytes.byteLength,sha256:byteSha(bytes)});}
 const input={binding,expectedTarget:{tabId:18,windowId:7},docId:2347603,baselineDocIds:[2347000],expectedImages,expectedBody,previousTarget:{tabId:9,windowId:7,origin,requestId:binding.requestId,packetDigest:binding.packetDigest},mode:'read'};
 const body={...copy(expectedBody),displayCategoryCode:68183,remark:null,status:'UNFINISHED',serverExtra:'not part of canonical body'};
 for(const member of body.jsonDocument){member.productPage.commonAttributes.purchasePrice=1000;delete member.legalPage.adCert;}
 const files=expectedImages.map((file,index)=>({imageName:file.transportName,imageUrl:'/sr/api/image/get-by-key?key='+encodeURIComponent('stored/native/'+file.transportName),s3Link:'stored/native/'+file.transportName,host:'supplier.coupang.com',mainImage:index===0,imageData:'server-extra-is-not-retained'}));
 const draft={...copy(body),modifiedAt:'2026-10-29T01:02:03.000Z'},state={company:'Company Code: A01526306',formValues:[],body,files,drafts:[draft],requested:[],legal:[],activeBytes:0,maxActiveBytes:0};
 const root={dataset},document={documentElement:root,body:{get innerText(){return state.company;}},querySelectorAll:()=>state.formValues.map(value=>({value}))};
 Object.defineProperty(document,'cookie',{get(){assert.fail('Cookies must never be read.');}});
 const location={origin,pathname:'/dashboard/KR',search:'',hash:''};
 class ClockDate extends Date{static now(){return clock.now;}}
 const response=(path,value,type='application/json',headers={})=>{const raw=type==='application/json'?new TextEncoder().encode(JSON.stringify(value)):value,result=new Response(raw,{status:200,headers:{'content-type':type,'content-length':String(raw.byteLength),...headers}});Object.defineProperty(result,'url',{value:origin+path});return result;};
 const f={input,state,calls,clock,timers,dataset,document,location,binaries,response,beforeFetch:null,override:null};
 const fetch=async(url,init)=>{
  const parsed=new URL(url),path=parsed.pathname+parsed.search;calls.push({path,method:init.method,credentials:init.credentials,redirect:init.redirect,cache:init.cache,headers:copy(init.headers),...(init.body?{body:init.body}:{})});
  assert.equal(parsed.origin,origin);assert.equal(init.credentials,'include');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
  await f.beforeFetch?.(path,init);const override=await f.override?.(path,init);if(override!==undefined)return override;
  if(path==='/sr/draft/api/drafts'){assert.equal(init.method,'GET');return response(path,state.drafts);}
  if(path==='/sr/draft/api/drafts/register-requested'){assert.equal(init.method,'GET');return response(path,state.requested);}
  if(path==='/sr/draft/api/get-by-id/2347603'){assert.equal(init.method,'GET');return response(path,state.body);}
  if(path==='/sr/draft/api/get-images-by-id/2347603'){assert.equal(init.method,'GET');return response(path,state.files);}
  if(path==='/sr/draft/api/get-files-by-type/2347603'){assert.equal(init.method,'POST');assert.equal(init.body,'{}');return response(path,state.legal);}
  if(parsed.pathname==='/sr/api/image/get-by-key'){
   assert.equal(init.method,'GET');const name=parsed.searchParams.get('key').split('/').at(-1);assert.ok(binaries.has(name));state.activeBytes++;state.maxActiveBytes=Math.max(state.maxActiveBytes,state.activeBytes);await turn();state.activeBytes--;return response(path,binaries.get(name),'image/png');
  }
  assert.fail('Unapproved remote operation '+path);
 };
 const context=vm.createContext({document,location,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,AbortController,URL,Error,Date:ClockDate,fetch,Promise,Set,Map,
  setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 for(const key of ['localStorage','sessionStorage'])Object.defineProperty(context,key,{get(){assert.fail('Storage must never be read.');}});
 f.run=async(value=f.input)=>{context.currentInput=value;return plain(await vm.runInContext('('+savedDraftCurrentReadPage.toString()+')(currentInput)',context));};
 f.record=()=>JSON.parse(records)[binding.packetDigest];f.setRecord=record=>{records=JSON.stringify(record===null?{}:{[binding.packetDigest]:record});};f.snapshot=()=>records;f.writes=()=>writes;
 f.proof=observation=>({format:'yoofam-current-saved-draft-target-v1',requestId:binding.requestId,docId:input.docId,tabId:input.expectedTarget.tabId,windowId:input.expectedTarget.windowId,identityDigest:binding.identityDigest,packetDigest:binding.packetDigest,preparedBodySha256:binding.preparedBodySha256,sourcePlanSha256:binding.nativeAssetSourcePlanSha256,baselineSha256:sha(input.baselineDocIds),bodySha256:binding.preparedBodySha256,fileSetSha256:observation.fileSetSha256,byteSetSha256:observation.byteSetSha256,filesCount:observation.filesCount,duplicateMatches:0,documentState:'UNFINISHED',readOnly:true,remoteWrites:false,historicalAckRecovered:false,observedAt:clock.now});
 f.bindInput=observation=>({...copy(input),mode:'bind',proof:f.proof(observation),expectedObservation:Object.fromEntries(['fileSetSha256','byteSetSha256','rawBodySha256','filesCount'].map(key=>[key,observation[key]]))});
 return f;
}
function expectFailure(result){assert.deepEqual(Object.keys(result),['currentReadFailure']);assert.equal(result.currentReadFailure.format,'yoofam-current-saved-draft-read-failure-v1');assert.match(result.currentReadFailure.phase,/^[a-z-]+$/);assert.match(result.currentReadFailure.code,/^[a-z][a-z0-9-]+$/);assert.doesNotMatch(JSON.stringify(result),/https:|2347603|stored-image|current-owner|원래 저장/);}

test('fresh owned tab reads the exact original body and nine actual image bytes with at most three parallel downloads',async()=>{
 const f=fixture(),before=f.snapshot(),result=await f.run();assert.equal(result.currentReadFailure,undefined);assert.equal(result.filesCount,9);assert.equal(result.duplicateMatches,0);assert.equal(result.documentState,'UNFINISHED');assert.equal(result.readOnly,true);assert.equal(result.remoteWrites,false);assert.equal(result.historicalAckRecovered,false);assert.equal(result.record,undefined);
 const body=Object.fromEntries(['docId','productName','categoryPath','categoryId','displayCategoryCode','jsonDocument','scope','productNoticeNumber','version','remark'].map(key=>[key,f.state.body[key]]));
 const files=f.state.files.map(row=>Object.fromEntries(['imageName','imageUrl','s3Link','host','mainImage'].filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]))).sort((a,b)=>a.imageName.localeCompare(b.imageName));
 assert.deepEqual(result.body,body);assert.deepEqual(result.files,files);assert.equal(result.rawBodySha256,sha(body));assert.equal(result.fileSetSha256,sha(files));assert.equal(result.byteSetSha256,sha(f.input.expectedImages));assert.equal(f.state.maxActiveBytes,3);
 assert.equal(f.snapshot(),before);assert.equal(f.writes(),0);assert.equal(f.calls.length,14);assert.deepEqual(f.calls.filter(call=>call.method==='POST').map(call=>[call.path,call.body]),[['/sr/draft/api/get-files-by-type/2347603','{}']]);assert.equal(f.calls.some(call=>call.path.includes('fileType=')),false);assert.ok(f.calls.every(call=>call.method==='GET'||call.path==='/sr/draft/api/get-files-by-type/2347603'));assert.equal(f.timers.size,0);
 const stringResult=await f.run(JSON.stringify(f.input));assert.equal(typeof stringResult,'string');assert.equal(JSON.parse(stringResult).fileSetSha256,result.fileSetSha256);
});

test('one unfiltered all-legal query accepts only literal empty arrays or objects through read, bind and check',async()=>{
 for(const legal of [[],{}]){const f=fixture();f.state.legal=legal;const read=await f.run();assert.equal(read.currentReadFailure,undefined);assert.equal(f.calls.length,14);
  const bound=await f.run(f.bindInput(read));assert.equal(bound.currentReadFailure,undefined);assert.equal(f.calls.length,28);const record=f.snapshot(),writes=f.writes();
  const checked=await f.run({...copy(f.input),mode:'check'});assert.equal(checked.currentReadFailure,undefined);assert.equal(f.calls.length,42);assert.equal(f.snapshot(),record);assert.equal(f.writes(),writes);
  assert.deepEqual(f.calls.filter(call=>call.method==='POST').map(call=>[call.path,call.body]),Array.from({length:3},()=>['/sr/draft/api/get-files-by-type/2347603','{}']));
  assert.ok(f.calls.every(call=>call.method==='GET'||call.path==='/sr/draft/api/get-files-by-type/2347603'));assert.equal(f.calls.some(call=>call.path.includes('fileType=')),false);
 }
});

test('all-legal scalar shapes and every nonempty collection fail with fixed distinct diagnostics without unwrapping or leaking responses',async()=>{
 const responses=[null,false,0,''].map(legal=>({legal,code:'legal-response-shape'})).concat([
  [{fileName:'raw-private-file.pdf',fileType:'unfamiliar-native-type'}],
  {fileName:'raw-private-file.pdf',fileType:'certificate'},
  {error:'raw-private-server-error',url:'https://private.example/legal'},
  {data:[]},
  {format:'native-typed-empty',files:[]},
  {certificate:{}},
 ].map(legal=>({legal,code:Array.isArray(legal)?'legal-array-nonempty':'legal-object-nonempty'})));
 for(const {legal,code} of responses){const f=fixture();f.state.legal=legal;const before=f.snapshot(),result=await f.run();expectFailure(result);assert.equal(result.currentReadFailure.phase,'legal-lists');assert.equal(result.currentReadFailure.code,code);
  assert.doesNotMatch(JSON.stringify(result),/raw-private|private\.example|unfamiliar-native-type|native-typed-empty/);assert.equal(f.snapshot(),before);assert.equal(f.writes(),0);assert.equal(f.calls.some(call=>call.path.startsWith('/sr/api/image/')),false);
  assert.deepEqual(f.calls.filter(call=>call.method==='POST').map(call=>[call.path,call.body]),[['/sr/draft/api/get-files-by-type/2347603','{}']]);assert.equal(f.calls.some(call=>call.path.includes('fileType=')),false);
 }
});

test('bind independently rereads current hashes, records no historical ACK and can idempotently refresh only its current-read proof',async()=>{
 const f=fixture(),read=await f.run(),input=f.bindInput(read),bound=await f.run(input);assert.equal(bound.currentReadFailure,undefined);assert.equal(f.writes(),1);assert.deepEqual(bound.record,f.record());
 const record=f.record();assert.equal(record.state,'updated');assert.equal(record.createOperationId,f.input.binding.requestId+':create');assert.deepEqual(record.baselineDocIds,f.input.baselineDocIds);assert.equal(record.updateOperationId,undefined);assert.equal(record.nativeAssets,undefined);assert.equal(record.validation,undefined);
 assert.equal(record.currentReadRecovery.proofSha256,sha(input.proof));assert.equal(record.currentReadRecovery.fileBodyWritesAllowed,false);assert.equal(record.currentReadRecovery.historicalAckRecovered,false);
 const first=f.snapshot();assert.equal((await f.run(input)).currentReadFailure,undefined);assert.equal(f.snapshot(),first);assert.equal(f.writes(),1);
 f.clock.now++;const renewed=f.bindInput(read);assert.equal((await f.run(renewed)).currentReadFailure,undefined);assert.equal(f.writes(),2);assert.equal(f.record().currentReadRecovery.proof.observedAt,f.clock.now);assert.equal((await f.run()).currentReadFailure,undefined);assert.equal(f.writes(),2);
});

test('check verifies an existing validated loaded record without mutation; read and bind cannot rewind advanced state',async()=>{
 const f=fixture(),read=await f.run();await f.run(f.bindInput(read));const record=f.record();record.state='validated';record.validation={2:{operationId:f.input.binding.requestId+':validate:2',state:'observed',response:{data:[{success:true}]}}};record.loadedDocId=f.input.docId;record.watchToken='current-watch';record.watchState='active';record.watchExpiresAt=f.clock.now+60000;f.setRecord(record);
 f.location.pathname='/sr/registration/step/startPage';f.state.formValues=['원래 저장 상품'];const snapshot=f.snapshot();
 const checked=await f.run({...copy(f.input),previousTarget:{...f.input.previousTarget,tabId:f.input.expectedTarget.tabId},mode:'check'});assert.equal(checked.currentReadFailure,undefined);assert.equal(checked.record,undefined);assert.equal(f.snapshot(),snapshot);
 f.location.pathname='/dashboard/KR';f.state.formValues=[];expectFailure(await f.run());expectFailure(await f.run(f.bindInput(read)));assert.equal(f.snapshot(),snapshot);
});

test('check admits only the body flags of observed authorized stages and preserves the initial current-read proof',async()=>{
 for(const mode of ['product','both','unauthorized-flag','nonboolean','operation','other-body','order']){const f=fixture(),read=await f.run();await f.run(f.bindInput(read));const record=f.record(),authorizedStages=mode==='both'?['productPage','imagePage']:mode==='order'?['imagePage']:['productPage'];
  record.state='validated';record.stageConsentOperations=Object.fromEntries(authorizedStages.map(stage=>[stage,{state:'observed',operationId:f.input.binding.requestId+':stage-consent:'+stage}]));if(mode==='operation')record.stageConsentOperations.productPage.operationId='different-operation';f.setRecord(record);
  for(const member of f.state.body.jsonDocument){member.imagePage.msrpAgree=true;if(mode==='both'||mode==='unauthorized-flag')member.imagePage.labelContactAgreed=true;if(mode==='nonboolean')member.imagePage.msrpAgree='true';}
  if(mode==='other-body')f.state.body.jsonDocument[0].productPage.commonAttributes.purchasePrice++;const before=f.snapshot();
  const result=await f.run({...copy(f.input),mode:'check',authorizedStages});
  if(['product','both'].includes(mode)){assert.equal(result.currentReadFailure,undefined);assert.notEqual(result.rawBodySha256,read.rawBodySha256);assert.equal(f.record().currentReadRecovery.rawBodySha256,read.rawBodySha256);}
  else expectFailure(result);assert.equal(f.snapshot(),before,mode);
 }
});

test('optional native remark and source-bound generic member counts remain exact without wrapper or body normalization guesses',async()=>{
 const f=fixture();delete f.state.body.remark;f.input.binding.identity.members=f.input.binding.identity.members.slice(0,1);f.input.expectedBody.jsonDocument=f.input.expectedBody.jsonDocument.slice(0,1);f.state.body.jsonDocument=f.state.body.jsonDocument.slice(0,1);
 const binding=f.input.binding;binding.identityDigest=sha(binding.identity);binding.preparedBodySha256=sha({...copy(f.input.expectedBody),docId:null});binding.originalBodySha256=binding.preparedBodySha256;binding.packetDigest=sha({identity:Object.fromEntries(Object.entries(binding.identity).filter(([key])=>!['appTabId','windowId'].includes(key))),bodySha256:binding.preparedBodySha256,originalBodySha256:binding.originalBodySha256});f.input.previousTarget.packetDigest=binding.packetDigest;
 const result=await f.run();assert.equal(result.currentReadFailure,undefined);assert.equal(result.body.jsonDocument.length,1);assert.equal(Object.hasOwn(result.body,'remark'),false);assert.equal(result.rawBodySha256,sha(result.body));assert.equal(f.writes(),0);
});

test('scope, stale source, legal source plans and conflicting page records fail before remote queries',async()=>{
 for(const mode of ['company','form','page','baseline','identity-hash','packet-hash','source-body','member-order','legal-source','too-large','total-size','foreign-record']){const f=fixture();
  if(mode==='company')f.state.company='Company Code: A01464742';if(mode==='form')f.state.formValues=['user work'];if(mode==='page')f.location.pathname='/sr/registration';if(mode==='baseline')f.input.baselineDocIds.push(f.input.docId);
  if(mode==='identity-hash')f.input.binding.identityDigest='a'.repeat(64);if(mode==='packet-hash')f.input.binding.packetDigest='a'.repeat(64);if(mode==='source-body')f.input.expectedBody.productName='changed';if(mode==='member-order')f.input.binding.identity.members[1].documentIndex=0;
  if(mode==='legal-source')f.input.expectedLegal=[];if(mode==='too-large')f.input.expectedImages[0].byteLength=10*1024*1024+1;if(mode==='total-size')for(const file of f.input.expectedImages)file.byteLength=10*1024*1024;if(mode==='foreign-record')f.dataset.yoofamSingleDocumentRecords=JSON.stringify({other:{docId:999}});
  const before=f.snapshot();expectFailure(await f.run());assert.equal(f.calls.length,0,mode);assert.equal(f.snapshot(),before,mode);
 }
});

test('direct native list and body shapes, original document status and complete duplicate coverage are required',async()=>{
 for(const mode of ['draft-wrapper','draft-duplicate-id','missing-original','submitted-original','wrong-scope','wrong-category','same-draft','same-requested','requested-original','requested-wrapper','body-wrapper','body-status','body-field','body-member-count']){const f=fixture();
  if(mode==='draft-wrapper')f.state.drafts={items:f.state.drafts};if(mode==='draft-duplicate-id')f.state.drafts.push(copy(f.state.drafts[0]));if(mode==='missing-original')f.state.drafts=[];if(mode==='submitted-original')f.state.drafts[0].status='SUBMITTED';if(mode==='wrong-scope')f.state.drafts[0].scope='Retail_Multi';if(mode==='wrong-category')f.state.drafts[0].categoryId='999';
  if(mode==='same-draft')f.state.drafts.push({...copy(f.state.drafts[0]),docId:2347604});if(mode==='same-requested')f.state.requested=[{...copy(f.state.drafts[0]),docId:2347604}];if(mode==='requested-original')f.state.requested=[copy(f.state.drafts[0])];if(mode==='requested-wrapper')f.state.requested={rows:[]};
  if(mode==='body-wrapper')f.state.body={data:f.state.body};if(mode==='body-status')f.state.body.status='SUBMITTED';if(mode==='body-field')delete f.state.body.categoryId;if(mode==='body-member-count')f.state.body.jsonDocument.pop();
  expectFailure(await f.run());assert.equal(f.writes(),0,mode);assert.equal(f.calls.some(call=>call.path.startsWith('/sr/api/image/')),false,mode);
 }
});

test('image metadata cannot nominate foreign downloads, duplicate names, extra files or unexpected legal files',async()=>{
 for(const mode of ['missing','unexpected','duplicate','foreign-host','foreign-url','wrong-key','extra-query','fragment','main-type','legal-present']){const f=fixture();
  if(mode==='missing')f.state.files.pop();if(mode==='unexpected')f.state.files[0].imageName='unexpected.png';if(mode==='duplicate')f.state.files[1]=copy(f.state.files[0]);if(mode==='foreign-host')f.state.files[0].host='external.example';if(mode==='foreign-url')f.state.files[0].imageUrl='https://external.example/sr/api/image/get-by-key?key=one';
  if(mode==='wrong-key')f.state.files[0].imageUrl='/sr/api/image/get-by-key?key=wrong';if(mode==='extra-query')f.state.files[0].imageUrl+='&token=do-not-read';if(mode==='fragment')f.state.files[0].imageUrl+='#fragment';if(mode==='main-type')f.state.files[0].mainImage='true';if(mode==='legal-present')f.state.legal=[{fileName:'already.pdf'}];
  expectFailure(await f.run());assert.equal(f.writes(),0,mode);assert.equal(f.calls.some(call=>call.path.startsWith('/sr/api/image/')),false,mode);
 }
});

test('actual bytes must match immutable SHA, MIME and bounded length with no redirect or error response',async()=>{
 for(const mode of ['sha','mime','length','stream-size','redirect','status','declared-size']){const f=fixture();
  f.override=path=>{if(!path.startsWith('/sr/api/image/'))return;const file=f.input.expectedImages[0],raw=copy([...f.binaries.get(file.transportName)]);let response;
   if(mode==='sha'){raw[0]++;response=f.response(path,new Uint8Array(raw),'image/png');}
   if(mode==='mime')response=f.response(path,new Uint8Array(raw),'image/jpeg');if(mode==='length')response=f.response(path,new Uint8Array(raw.slice(1)),'image/png');
   if(mode==='stream-size')response=f.response(path,new Uint8Array([...raw,1]),'image/png',{'content-length':String(raw.length)});
   if(mode==='redirect'){response=f.response(path,new Uint8Array(raw),'image/png');Object.defineProperty(response,'redirected',{value:true});}
   if(mode==='status'){response=f.response(path,new Uint8Array(raw),'image/png');Object.defineProperty(response,'status',{value:500});}
   if(mode==='declared-size')response=f.response(path,new Uint8Array(raw),'image/png',{'content-length':String(10*1024*1024+1)});return response;
  };
  expectFailure(await f.run());assert.equal(f.writes(),0,mode);assert.ok(f.calls.every(call=>call.method==='GET'||call.path.startsWith('/sr/draft/api/get-files-by-type/')));
 }
});

test('HTTP failures expose only the bounded status enum without reading or returning raw server errors',async()=>{
 for(const status of [401,403,404,429,500,502,503,504,418]){const f=fixture();f.override=path=>{if(path!=='/sr/draft/api/drafts')return;const response=f.response(path,{error:'private-raw-server-error',url:'https://private.example/session'});Object.defineProperty(response,'status',{value:status});return response;};
  const result=await f.run();expectFailure(result);assert.equal(result.currentReadFailure.code,status===418?'http-response':'http-'+status);assert.doesNotMatch(JSON.stringify(result),/private-raw|private\.example/);assert.equal(f.calls.length,1);assert.equal(f.writes(),0);
 }
});

test('MIME diagnostics use fixed buckets while unchanged image bytes still require their exact source MIME',async()=>{
 for(const mime of ['application/octet-stream','image/jpeg']){const f=fixture();f.override=path=>path.startsWith('/sr/api/image/')?f.response(path,f.binaries.get(f.input.expectedImages[0].transportName),mime):undefined;
  const result=await f.run();expectFailure(result);assert.equal(result.currentReadFailure.code,mime==='application/octet-stream'?'http-type-octet-stream':'http-type-other');assert.equal(f.writes(),0);
 }
});

test('company and exact DOM record snapshots are fenced during every read, including concurrent byte reads',async()=>{
 for(const mode of ['company','record-list','record-bytes']){const f=fixture();f.beforeFetch=path=>{if(mode==='company'&&path.endsWith('/drafts'))f.state.company='Company Code: A01464742';if(mode==='record-list'&&path.endsWith('/drafts')||mode==='record-bytes'&&path.startsWith('/sr/api/image/'))f.dataset.yoofamSingleDocumentRecords=JSON.stringify({changed:{docId:42}});};
  expectFailure(await f.run());assert.equal(f.record(),undefined);assert.equal(f.writes(),mode==='company'?0:1);
 }
});

test('bind rejects stale or mismatched proof, changed current bytes/body/metadata and advanced records without rewriting anything',async()=>{
 for(const mode of ['stale','proof-target','proof-source','proof-body','proof-hash','observation-hash','extra-observation','changed-body','changed-metadata']){const f=fixture(),read=await f.run(),input=f.bindInput(read);
  if(mode==='stale')input.proof.observedAt-=60001;if(mode==='proof-target')input.proof.tabId++;if(mode==='proof-source')input.proof.sourcePlanSha256='a'.repeat(64);if(mode==='proof-body')input.proof.bodySha256='a'.repeat(64);if(mode==='proof-hash')input.proof.fileSetSha256='a'.repeat(64);if(mode==='observation-hash')input.expectedObservation.rawBodySha256='a'.repeat(64);if(mode==='extra-observation')input.expectedObservation.extra=true;
  if(mode==='changed-body')f.state.body.jsonDocument[0].productPage.commonAttributes.purchasePrice++;if(mode==='changed-metadata')f.state.files[1].mainImage=true;
  const before=f.snapshot();expectFailure(await f.run(input));assert.equal(f.snapshot(),before,mode);assert.equal(f.writes(),0,mode);
 }
});

test('per-request timeout produces only fixed diagnostics and never binds after a missing response',async()=>{
 const f=fixture();let notifyStarted;const started=new Promise(resolve=>{notifyStarted=resolve;});f.override=path=>{if(!path.endsWith('/drafts'))return;notifyStarted();return new Promise(()=>{});};const pending=f.run();
 // WebCrypto may wait for a busy worker pool. Advance the synthetic timer only
 // after the actual fetch starts, rather than counting arbitrary event turns.
 await Promise.race([started,pending.then(()=>{throw Error('Expected one pending read');})]);assert.equal(f.calls.length,1);assert.equal(f.timers.size,1);const timer=[...f.timers.values()][0];assert.equal(timer.ms,30000);timer.fn();const failed=await pending;expectFailure(failed);assert.equal(failed.currentReadFailure.code,'http-timeout');assert.equal(f.writes(),0);assert.equal(f.timers.size,0);
});
