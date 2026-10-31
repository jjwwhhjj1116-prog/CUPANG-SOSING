import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {runSavedDocumentStepValidation,validateSavedDocumentStepValidationReport,validateSavedDocumentStepRetryRequest} from '../extensions/supplier-hub/saved-document-step-validation.mjs';
import {savedDocumentStepValidationPage} from '../extensions/supplier-hub/saved-document-step-validation-page.mjs';

const copy=value=>structuredClone(value),plain=value=>JSON.parse(JSON.stringify(value));
const canon=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canon).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canon(value[key])).join(',')+'}';
const digest=value=>createHash('sha256').update(canon(value)).digest('hex');
const passed=stage=>({stage,state:'passed',responseRows:3,errors:[],errorCount:0,errorsTruncated:false,cached:false,requested:true,failureCode:null});
const rejected=stage=>({...passed(stage),state:'rejected',errors:[{rowIndex:2,columnName:'모델명',category:'required'}],errorCount:1});
function runnerFixture(){
 const now=Date.now(),audit={requestId:'original-request',docId:2347603,identityDigest:'1'.repeat(64),packetDigest:'2'.repeat(64),originalBodySha256:'3'.repeat(64),preparedBodySha256:'4'.repeat(64),sourcePlanSha256:'5'.repeat(64),checkpointSequence:15,target:{tabId:90,windowId:1},rawBodySha256:'6'.repeat(64),fileSetSha256:'7'.repeat(64),legalSetSha256:'8'.repeat(64)},entries=new Map(),calls=[];
 const storage={get:async key=>entries.has(key)?{[key]:copy(entries.get(key))}:{},set:async value=>{for(const [key,row]of Object.entries(value))entries.set(key,copy(row));}};
 const f={now,audit,entries,calls,fences:0};
 f.options={audit,storage,now:()=>f.now,fresh:async()=>{f.fences++;if(f.cancel)throw Error('cancelled');},sendStep:async stage=>{calls.push(stage);const entry=[...entries.values()].find(row=>row.stage===stage);assert.equal(entry?.state,'requested','durable intent precedes POST');return f.reply?f.reply(stage):passed(stage);}};
 f.run=()=>runSavedDocumentStepValidation(f.options);return f;
}
function explicitRetry(f,stage=2){
 const {audit}=f;
 return {format:'yoofam-saved-document-step-retry-v1',...Object.fromEntries(['requestId','docId','identityDigest','packetDigest','originalBodySha256','preparedBodySha256','sourcePlanSha256','checkpointSequence','fileSetSha256','legalSetSha256'].map(key=>[key,audit[key]])),actualRawBodySha256:audit.rawBodySha256,stage,acknowledgeRepeatedValidation:true};
}
async function uncertainFixture(){
 const f=runnerFixture();f.reply=()=>{throw Error('synthetic lost acknowledgement');};await f.run();f.calls.length=0;return f;
}

test('explicit validation-only retry preserves the original uncertain journal, reserves once before POST and never changes normal recovery',async()=>{
 const f=await uncertainFixture(),original=[...f.entries][0],before=copy(original[1]);f.options.retryConfirmation=explicitRetry(f);
 f.options.sendStep=async stage=>{f.calls.push(stage);if(stage===2){assert.deepEqual(f.entries.get(original[0]),before);assert.equal([...f.entries].find(([key])=>key.startsWith('yoofamSavedStepValidationRetryV1:'))[1].state,'requested');}return passed(stage);};
 const report=await f.run();assert.deepEqual(f.calls,[2,3,4,5]);assert.ok(report.stages.every(row=>row.state==='passed'));assert.equal(report.canResume,false);assert.equal(report.submitted,false);assert.deepEqual(f.entries.get(original[0]),before);
 f.calls.length=0;const again=await f.run();assert.deepEqual(f.calls,[]);assert.ok(again.stages.every(row=>row.cached&&!row.requested));
 delete f.options.retryConfirmation;const normal=await f.run();assert.equal(normal.stages[0].failureCode,'prior-uncertain');assert.deepEqual(f.calls,[]);assert.deepEqual(f.entries.get(original[0]),before);
});

test('explicit retry loss, restart and cancellation keep their separate one-time reservation and never repeat the validation',async()=>{
 for(const mode of ['lost','cancel']){
  const f=await uncertainFixture(),original=copy([...f.entries]);f.options.retryConfirmation=explicitRetry(f);
  f.options.sendStep=async stage=>{f.calls.push(stage);throw Error('synthetic lost retry ACK');};
  if(mode==='cancel'){const set=f.options.storage.set;f.options.storage.set=async rows=>{await set(rows);if(Object.keys(rows)[0].startsWith('yoofamSavedStepValidationRetryV1:'))f.cancel=true;};await assert.rejects(f.run());f.cancel=false;}
  else{const first=await f.run();assert.equal(first.stages[0].state,'uncertain');assert.deepEqual(f.calls,[2]);}
  f.calls.length=0;f.options.sendStep=()=>assert.fail('A restarted receiver must not repeat the reserved retry');
  const again=await runSavedDocumentStepValidation({...f.options});assert.equal(again.stages[0].failureCode,'prior-uncertain');assert.deepEqual(f.calls,[]);assert.deepEqual(f.entries.get(original[0][0]),original[0][1]);
 }
});

test('a later explicit uncertain-stage recheck can use only an observed passed retry prefix without replaying it or releasing normal recovery',async()=>{
 const f=await uncertainFixture(),original2=copy([...f.entries][0]);f.options.retryConfirmation=explicitRetry(f);
 f.options.sendStep=async stage=>{f.calls.push(stage);if(stage===3)throw Error('synthetic lost next-stage ACK');return passed(stage);};
 const first=await f.run();assert.deepEqual(f.calls,[2,3]);assert.equal(first.stages.at(-1).state,'uncertain');const original3=copy([...f.entries].find(([key])=>key.endsWith(':3')));
 f.calls.length=0;f.options.retryConfirmation=explicitRetry(f,3);f.options.sendStep=async stage=>{f.calls.push(stage);assert.notEqual(stage,2,'The observed retry prefix is not sent again');return passed(stage);};
 const second=await f.run();assert.deepEqual(f.calls,[3,4,5]);assert.equal(second.stages[0].cached,true);assert.equal(second.stages[0].requested,false);assert.ok(second.stages.every(row=>row.state==='passed'));
 assert.deepEqual(f.entries.get(original2[0]),original2[1]);assert.deepEqual(f.entries.get(original3[0]),original3[1]);
 f.calls.length=0;delete f.options.retryConfirmation;assert.equal((await f.run()).stages[0].failureCode,'prior-uncertain');assert.deepEqual(f.calls,[]);
 const invalid=await uncertainFixture();invalid.options.retryConfirmation=explicitRetry(invalid);invalid.options.sendStep=async stage=>stage===3?(()=>{throw Error('synthetic uncertain next');})():passed(stage);await invalid.run();
 [...invalid.entries].find(([key])=>key.startsWith('yoofamSavedStepValidationRetryV1:'))[1].state='uncertain';invalid.options.retryConfirmation=explicitRetry(invalid,3);const prior=copy([...invalid.entries]);invalid.calls.length=0;await assert.rejects(invalid.run());assert.deepEqual([...invalid.entries],prior);assert.deepEqual(invalid.calls,[]);
});

test('explicit retry refuses altered source/document/stage/acknowledgement and missing or unobserved prefixes before any retry write',async()=>{
 const edits=[r=>{r.actualRawBodySha256='f'.repeat(64);},r=>{r.fileSetSha256='f'.repeat(64);},r=>{r.legalSetSha256='f'.repeat(64);},r=>{r.requestId='different';},r=>{r.docId=2347604;},r=>{r.stage=3;},r=>{r.checkpointSequence++;},r=>{r.acknowledgeRepeatedValidation=false;},r=>{r.extra='forbidden';}];
 for(const edit of edits){const f=await uncertainFixture(),before=copy([...f.entries]);f.options.retryConfirmation=explicitRetry(f);edit(f.options.retryConfirmation);await assert.rejects(f.run());assert.deepEqual([...f.entries],before);assert.deepEqual(f.calls,[]);}
 const f=await uncertainFixture();f.options.retryConfirmation=explicitRetry(f);[...f.entries.values()][0].state='requested';const before=copy([...f.entries]);await assert.rejects(f.run());assert.deepEqual([...f.entries],before);assert.deepEqual(f.calls,[]);
 assert.throws(()=>validateSavedDocumentStepRetryRequest({...explicitRetry(f),stage:6}));
});
test('independent durable ledger runs only steps 2..5 once and caches positive evidence for identical actual body and file sets',async()=>{
 const f=runnerFixture(),first=await f.run();assert.deepEqual(f.calls,[2,3,4,5]);assert.equal(first.stages.length,4);assert.equal(first.registered,false);assert.equal(first.canResume,false);assert.equal(Object.hasOwn(first,'readOnly'),false);assert.equal(Object.hasOwn(first,'remoteWrites'),false);
 assert.ok(first.stages.every(row=>row.requested&&!row.cached));f.calls.length=0;f.audit.checkpointSequence++;
 const second=await f.run();assert.deepEqual(f.calls,[]);assert.ok(second.stages.every(row=>row.cached&&!row.requested));assert.equal(second.checkpointSequence,f.audit.checkpointSequence);
 assert.doesNotMatch(JSON.stringify([...f.entries]),/expectedBody|jsonDocument|s3Link|fileName|imageUrl|cookie|password/);assert.ok(f.fences>20);
});
test('later response row rejection stops subsequent stages and is cached without an option count assumption',async()=>{
 const f=runnerFixture();f.reply=stage=>stage===3?rejected(stage):passed(stage);const report=await f.run();assert.deepEqual(f.calls,[2,3]);assert.equal(report.stages[1].responseRows,3);assert.equal(report.stages[1].errors[0].rowIndex,2);
 f.calls.length=0;const repeated=await f.run();assert.deepEqual(f.calls,[]);assert.equal(repeated.stages.at(-1).state,'rejected');
});
test('lost POST acknowledgement, worker restart and malformed replies never automatically repeat an attempted stage',async()=>{
 for(const mode of ['network','malformed','pending']){
  const f=runnerFixture();f.reply=()=>{if(mode==='network')throw Error('PRIVATE_TOKEN');return{...passed(2),responseRows:'bad'};};
  const first=await f.run();assert.equal(first.stages[0].state,'uncertain');assert.deepEqual(f.calls,[2]);
  if(mode==='pending'){const entry=[...f.entries.values()][0];entry.state='requested';}
  f.calls.length=0;f.options.sendStep=()=>assert.fail('Unknown validation is never replayed');
  const again=await f.run();assert.equal(again.stages[0].failureCode,'prior-uncertain');assert.deepEqual(f.calls,[]);
 }
});
test('a verified pre-POST failure is retained and only a later explicit run may recheck it',async()=>{
 const f=runnerFixture();f.reply=()=>({stage:2,state:'uncertain',responseRows:null,errors:[],errorCount:0,errorsTruncated:false,cached:false,requested:false,failureCode:'source-changed'});
 const first=await f.run();assert.equal(first.stages[0].requested,false);assert.deepEqual(f.calls,[2]);
 const saved=[...f.entries.values()][0];assert.equal(saved.state,'observed-not-sent');assert.equal(saved.result.failureCode,'source-changed');
 f.calls.length=0;f.reply=undefined;
 const second=await f.run();assert.deepEqual(f.calls,[2,3,4,5]);assert.equal(second.stages.length,4);
});
test('old uncertain, unconfirmed exceptions and pre-POST timeouts never become retryable',async()=>{
 for(const mode of ['old','throw','malformed','timeout','cancelled','requested']){
  const f=runnerFixture();
  f.reply=()=>{if(mode==='throw')throw Error('failure');
   if(mode==='malformed')return{stage:2,state:'uncertain',requested:false};
   return{stage:2,state:'uncertain',responseRows:null,errors:[],errorCount:0,errorsTruncated:false,cached:false,requested:mode==='requested',failureCode:mode==='timeout'?'timeout':mode==='cancelled'?'cancelled':'source-changed'};};
  await f.run();const saved=[...f.entries.values()][0];
  if(mode==='old'){saved.state='uncertain';delete saved.result;}
  assert.equal(saved.state,'uncertain',mode);f.calls.length=0;f.options.sendStep=()=>assert.fail('Uncertain stage cannot be replayed');
  const report=await f.run();assert.equal(report.stages[0].failureCode,'prior-uncertain');assert.deepEqual(f.calls,[]);
 }
});
test('pre-POST journal cannot be reused with a changed binding or malformed evidence',async()=>{
 for(const mutate of [f=>{f.audit.rawBodySha256='a'.repeat(64);},f=>{[...f.entries.values()][0].result.requested=true;},f=>{[...f.entries.values()][0].result.failureCode='timeout';}]){
  const f=runnerFixture();f.reply=()=>({stage:2,state:'uncertain',responseRows:null,errors:[],errorCount:0,errorsTruncated:false,cached:false,requested:false,failureCode:'source-changed'});
  await f.run();mutate(f);f.calls.length=0;await assert.rejects(f.run());assert.deepEqual(f.calls,[]);
 }
});
test('hash drift or corrupt durable evidence blocks cache reuse and never overwrites the earlier attempt',async()=>{
 for(const key of ['rawBodySha256','fileSetSha256','legalSetSha256']){const f=runnerFixture();await f.run();const prior=copy([...f.entries]);f.calls.length=0;f.audit[key]='a'.repeat(64);await assert.rejects(f.run());assert.deepEqual(f.calls,[]);assert.deepEqual([...f.entries],prior);}
 const f=runnerFixture();await f.run();[...f.entries.values()][0].privateBody='PRIVATE';f.calls.length=0;await assert.rejects(f.run());assert.deepEqual(f.calls,[]);
});
test('cancellation after durable intent but before POST leaves an uncertainty reservation across a new run',async()=>{
 const f=runnerFixture(),set=f.options.storage.set;f.options.storage.set=async value=>{await set(value);f.cancel=true;};await assert.rejects(f.run());assert.deepEqual(f.calls,[]);assert.equal([...f.entries.values()][0].state,'requested');
 f.cancel=false;const result=await f.run();assert.equal(result.stages[0].state,'uncertain');assert.equal(result.stages[0].cached,true);assert.deepEqual(f.calls,[]);
});
test('report rejects success prefixes, wrong stage ordering, option inference, sensitive columns, stale evidence and mutation flags',async()=>{
 const f=runnerFixture(),value=plain(await f.run());
 const edits=[r=>{r.stages.pop();},r=>{r.stages[0].stage=3;},r=>{r.stages[0].optionId='fabricated';},r=>{r.stages[0]={...rejected(2),errors:[{rowIndex:2,columnName:'private.pdf',category:'file'}]};r.stages=r.stages.slice(0,1);},r=>{r.observedAt-=60001;},r=>{r.bodyWrites=true;},r=>{r.remoteWrites=false;},r=>{r.stages[0].requested=false;}];
 for(const edit of edits){const report=copy(value);edit(report);assert.throws(()=>validateSavedDocumentStepValidationReport(report,{},f.now));}
 const report=copy(value);report.stages=[rejected(2)];assert.equal(validateSavedDocumentStepValidationReport(report,{},f.now).stages[0].errors[0].rowIndex,2);
});

function pageFixture(){
 const now=Date.now(),clock={value:now},body={docId:2347603,productName:'원래 상품',categoryPath:'합성 (12)',categoryId:12,displayCategoryCode:'12',scope:'Retail_Categorized_Single',productNoticeNumber:'1',version:2,remark:null,jsonDocument:[{productPage:{model:'원래'},imagePage:{msrpAgree:false}},{productPage:{model:'원래2'}}]},prepared={...copy(body),docId:null};
 const identity={appTabId:11,windowId:1,company:{code:'A01526306',name:'유앤채'},fingerprint:'a'.repeat(64),members:[{optionId:'one',documentIndex:0},{optionId:'two',documentIndex:1}]};
 const binding={identity,identityDigest:digest(identity),packetDigest:null,preparedBodySha256:digest(prepared),originalBodySha256:'b'.repeat(64),nativeAssetSourcePlanSha256:identity.fingerprint,sessionId:'session',requestId:'original-request'};
 const logicalIdentity=Object.fromEntries(Object.entries(identity).filter(([key])=>!['appTabId','windowId'].includes(key)));binding.packetDigest=digest({identity:logicalIdentity,bodySha256:binding.preparedBodySha256,originalBodySha256:binding.originalBodySha256});
 const files=[{imageName:'PRIVATE_IMAGE.png',imageUrl:'/sr/api/image/get-by-key?key=PRIVATE',s3Link:'PRIVATE_S3',host:'supplier.coupang.com',mainImage:false}],legal=[{fileName:'PRIVATE_CERT.pdf',s3Link:'PRIVATE_OTHER',fileType:'certificate'}];
 const audit={rawBodySha256:digest(body),fileSetSha256:digest(files),legalSetSha256:digest(legal),observedAt:now},input={binding,target:{tabId:90,windowId:1},docId:body.docId,expectedBody:copy(body),audit,stage:2};
 let records='{}',domWrites=0;const dataset={};Object.defineProperty(dataset,'yoofamSingleDocumentRecords',{get:()=>records,set:value=>{domWrites++;records=value;}});
 const root={dataset},document={documentElement:root,body:{innerText:'Company Code: A01526306'},querySelectorAll:()=>[]},location=new URL('https://supplier.coupang.com/dashboard/KR'),calls=[],timers=new Map();let serial=0;
 class ClockDate extends Date{static now(){return clock.value;}}
 const f={input,body,files,legal,document,location,calls,timers,clock,reply:{code:200,data:[{success:true},{success:true},{success:false,errors:[{columnName:'모델명',message:'PRIVATE_ERROR required'}]}]}};
 const fetch=async(url,init)=>{
  const path=new URL(url).pathname;calls.push({path,method:init.method,body:init.body});assert.equal(init.credentials,'include');assert.equal(init.redirect,'manual');assert.equal(init.cache,'no-store');
  await f.beforeFetch?.(path,init);
  let value;if(path==='/sr/draft/api/get-by-id/2347603')value={...body,status:'UNFINISHED'};
  else if(path==='/sr/draft/api/get-images-by-id/2347603')value=files;
  else if(path==='/sr/draft/api/get-files-by-type/2347603'){assert.equal(init.method,'POST');assert.equal(init.body,'{}');value=legal;}
  else{assert.equal(path,'/sr/qvt/api/validate-step/'+input.stage);assert.equal(init.method,'POST');assert.deepEqual(JSON.parse(init.body),{docId:2347603,version:2});f.onValidation?.();if(f.networkFailure)throw Error('PRIVATE_NETWORK');value=f.reply;}
  const response=Response.json(value);Object.defineProperty(response,'url',{value:url});return response;
 };
 const context=vm.createContext({document,location,fetch,crypto:webcrypto,TextEncoder,Uint8Array,AbortController,Date:ClockDate,URL,
  setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 for(const name of ['localStorage','sessionStorage'])Object.defineProperty(context,name,{get(){assert.fail('Page does not read arbitrary storage');}});
 f.run=async(value=JSON.stringify(input))=>{context.input=value;return plain(await vm.runInContext('('+savedDocumentStepValidationPage.toString()+')(input)',context));};f.records=()=>records;f.domWrites=()=>domWrites;return f;
}
test('actual serialized page validates every response row with exact doc/version POST and leaves body/files/record intact',async()=>{
 const f=pageFixture(),before=JSON.stringify({body:f.body,files:f.files,legal:f.legal,records:f.records()}),report=await f.run();
 assert.equal(report.state,'rejected');assert.equal(report.responseRows,3);assert.equal(report.errorCount,1);assert.deepEqual(report.errors,[{rowIndex:2,columnName:'모델명',category:'required'}]);assert.equal(report.requested,true);
 assert.equal(JSON.stringify({body:f.body,files:f.files,legal:f.legal,records:f.records()}),before);assert.equal(f.domWrites(),0);assert.equal(f.timers.size,0);
 assert.deepEqual(f.calls.map(row=>row.path),['/sr/draft/api/get-by-id/2347603','/sr/draft/api/get-images-by-id/2347603','/sr/draft/api/get-files-by-type/2347603','/sr/qvt/api/validate-step/2','/sr/draft/api/get-by-id/2347603','/sr/draft/api/get-images-by-id/2347603','/sr/draft/api/get-files-by-type/2347603']);
 assert.doesNotMatch(JSON.stringify(report),/PRIVATE|filename|s3Link|imageUrl|optionId/);
});
test('serialized page sanitizes sensitive column values and bounds all errors without dropping total count',async()=>{
 const f=pageFixture();f.reply={code:200,data:[{success:false,errors:Array.from({length:80},(_,index)=>({columnName:index%2?'private.pdf':'password token',message:'PRIVATE message required'}))}]};
 const report=await f.run();assert.equal(report.state,'rejected');assert.equal(report.errorCount,80);assert.equal(report.errors.length,40);assert.equal(report.errorsTruncated,true);assert.ok(report.errors.every(error=>error.columnName==='확인할 항목'));assert.doesNotMatch(JSON.stringify(report),/PRIVATE|password|private.pdf/);
});
test('malformed later rows never become success; network uncertainty is never retried in the page',async()=>{
 for(const reply of [{code:200,data:[{success:true},{success:'true'}]},{code:200,data:[{success:true,errors:[{columnName:'one',message:'bad'}]}]},{code:200,data:{success:true}},null]){const f=pageFixture();f.reply=reply;const result=await f.run();assert.equal(result.state,'uncertain');assert.equal(result.failureCode,'response');assert.equal(f.calls.filter(row=>row.path.includes('validate-step')).length,1);assert.equal(f.timers.size,0);}
 const f=pageFixture();f.networkFailure=true;const report=await f.run();assert.equal(report.state,'uncertain');assert.equal(report.failureCode,'network');assert.equal(report.requested,true);assert.equal(f.calls.filter(row=>row.path.includes('validate-step')).length,1);
});
test('body, file, legal, company, header and source drift stop before POST; postvalidation drift is uncertain',async()=>{
 const edits=[f=>{f.body.jsonDocument[1].productPage.model='changed';},f=>{f.files[0].s3Link+='changed';},f=>{f.legal[0].s3Link+='changed';},f=>{f.document.body.innerText='Company Code: A01464742';},f=>{f.body.version=3;},f=>{f.location.pathname='/sr/registration/step/startPage';},f=>{f.input.binding.packetDigest='f'.repeat(64);}];
 for(const edit of edits){const f=pageFixture();edit(f);const result=await f.run();assert.equal(result.state,'uncertain');assert.equal(result.requested,false);assert.equal(f.calls.some(row=>row.path.includes('validate-step')),false);}
 const f=pageFixture();f.onValidation=()=>{f.files[0].s3Link+='changed';};const result=await f.run();assert.equal(result.state,'uncertain');assert.equal(result.failureCode,'source-changed');assert.equal(result.requested,true);
});
test('category numeric header is compared losslessly while the raw body remains hash-bound',async()=>{
 const f=pageFixture();f.body.displayCategoryCode=12;f.input.audit.rawBodySha256=digest(f.body);
 const result=await f.run();assert.equal(result.state,'rejected');assert.equal(result.requested,true);
 for(const mutate of [x=>{x.body.displayCategoryCode=13;x.input.audit.rawBodySha256=digest(x.body);},x=>{x.body.jsonDocument[0].productPage.model='changed';}]){
  const g=pageFixture();g.body.displayCategoryCode=12;g.input.audit.rawBodySha256=digest(g.body);mutate(g);
  const value=await g.run();assert.equal(value.failureCode,'source-changed');assert.equal(value.requested,false);assert.equal(g.calls.some(row=>row.path.includes('validate-step')),false);
 }
});
test('serialized page rejects final/sibling stages and times out the single validation POST without a retry',async()=>{
 for(const stage of [1,6,'2']){const f=pageFixture();f.input.stage=stage;const result=await f.run();assert.equal(result.state,'uncertain');assert.deepEqual(f.calls,[]);}
 const f=pageFixture();let resolveEntered;const entered=new Promise(resolve=>{resolveEntered=resolve;});f.beforeFetch=async path=>{if(path.includes('validate-step')){resolveEntered();await new Promise(()=>{});}};
 const result=f.run();await entered;assert.equal(f.timers.size,1);[...f.timers.values()][0].fn();const report=await result;assert.equal(report.state,'uncertain');assert.equal(report.failureCode,'timeout');assert.equal(report.requested,true);assert.equal(f.calls.filter(row=>row.path.includes('validate-step')).length,1);assert.equal(f.timers.size,0);
});
