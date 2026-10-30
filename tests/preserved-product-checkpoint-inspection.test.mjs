import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import {inspectPreservedProductDocument,validatePreservedProductInspectionResult as parse,validatePreservedProductInspectionTarget as parseTarget} from '../extensions/supplier-hub/preserved-product-checkpoint.mjs';

const origin='https://sourceflow.jjwwhhjj1116.workers.dev',company={code:'A01526306',name:'유앤채'};
const target={requestId:'f29491bd-1882-456a-8a63-eec8586db6c6',docId:2347603,productId:'e2f8037c-294e-45a8-b06d-58cc5909683c',company};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex'),clone=value=>structuredClone(value);
function fixture(){
 const at=Date.now()-1000,ownerId='inspection-owner',identity={origin,ownerId,company:clone(company),productId:target.productId,appTabId:11,windowId:7,
  accountContext:createHash('sha256').update(JSON.stringify(['sourceflow-managed-product-account-v1',ownerId,company.code,company.name])).digest('hex'),
  profileId:'fixture-profile',requestedProfileId:null,categoryId:'80719',fingerprint:'1'.repeat(64),inputFingerprint:'2'.repeat(64),schemaSha256:'3'.repeat(64),
  source:{productVersion:new Date(at-10000).toISOString(),contentRevision:2,optionRevision:3,quotationRevision:4,profileRevision:1},members:[{optionId:'one',row:1}]};
 const bodySha256='4'.repeat(64),originalBodySha256='5'.repeat(64),logical={...identity};delete logical.appTabId;delete logical.windowId;
 const packetDigest=hash({identity:logical,bodySha256,originalBodySha256}),key='product-document:'+packetDigest,laneKey='product-document-lane:'+hash(Object.fromEntries(['origin','ownerId','accountContext','company','productId'].map(key=>[key,identity[key]])));
 const checkpoint={format:'yoofam-supplier-hub-product-document-v1',key,laneKey,identity,identityDigest:hash(identity),bodySha256,originalBodySha256,packetDigest,
  requestId:target.requestId,docId:target.docId,state:'updated',draftOnly:true,sequence:4,updatedAt:at,tab:{tabId:30,windowId:7},ownedTarget:{tabId:30,windowId:7},
  sessionId:'private-session-never-returned',baselineDocIds:[123],validatedSteps:[],operationId:target.requestId+':update'};
 const match={key,checkpoint,lane:{key}},sender={id:'extension-test',frameId:0,url:origin+'/studio',tab:{id:4,windowId:7}},calls=[];
 let scan={matches:[match],scanned:1,complete:true,available:true},contextCount=0,scopeChanged=false,tabChanged=false;
 const api={runtime:{id:'extension-test'},tabs:{async get(id){calls.push(['tab',id]);assert.equal(id,4);return{id:4,windowId:7,url:origin+'/studio',...(tabChanged?{pendingUrl:origin+'/other'}:{})};},
  async sendMessage(id,message,options){calls.push(['scope',id,message,options]);contextCount++;return{ok:true,scope:{ownerId:scopeChanged&&contextCount>1?'different-owner':ownerId,company:clone(company),target:clone(target)}};},
  create(){throw Error('unexpected tab creation');},update(){throw Error('unexpected tab update');}},scripting:{executeScript(){throw Error('unexpected Hub access');}}};
 const store={async inspectProductRequest(scope){calls.push(['store',scope]);return clone(scan);},claim(){throw Error('unexpected claim');},compareAndSet(){throw Error('unexpected CAS');}};
 const message={type:'YOOFAM_INSPECT_PRESERVED_PRODUCT_DOCUMENT',action:'inspect',target:clone(target)};
 return{at,identity,checkpoint,match,sender,api,store,message,calls,run:()=>inspectPreservedProductDocument(message,sender,{api,store}),setScan(value){scan=value;},scopeRace(){scopeChanged=true;},tabRace(){store.inspectProductRequest=async()=>{tabChanged=true;return clone(scan);};}};
}

test('inspection reports only exact owned checkpoint metadata, leaves scope/record immutable and never acquires capabilities',async()=>{
 const f=fixture(),before=canonical(f.checkpoint),result=await f.run();
 assert.equal(result.status,'found');assert.equal(result.checkpoint.packetDigest,f.checkpoint.packetDigest);assert.equal(result.checkpoint.savedHubTabId,30);assert.equal(result.checkpoint.savedAppTabId,11);
 assert.equal(result.canResume,false);assert.equal(result.remoteWrites,false);assert.equal(result.checkpointWrites,false);assert.equal(result.checkpoint.durableBodyAvailable,false);assert.equal(result.checkpoint.durableSourcePlanAvailable,false);
 assert.equal(canonical(f.checkpoint),before);assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.checkpoint.source)&&Object.isFrozen(result.checkpoint.validatedSteps));
 const output=JSON.stringify(result);for(const secret of ['inspection-owner','private-session-never-returned','baselineDocIds','accountContext','members"'])assert.ok(!output.includes(secret),secret);
 const scope=f.calls.find(call=>call[0]==='store')[1];assert.deepEqual(scope,{origin,ownerId:'inspection-owner',company,productId:target.productId,requestId:target.requestId,docId:target.docId});
 assert.equal(f.calls.filter(call=>call[0]==='scope').length,2);assert.deepEqual(parse(result,target),result);
});

test('missing storage, bounded/incomplete search, ambiguous UUIDs and document mismatch remain distinct and never choose a record',async()=>{
 const cases=[['storage-missing',{matches:[],scanned:0,complete:true,available:false}],['not-found',{matches:[],scanned:3,complete:true,available:true}],
  ['scan-limit',{matches:[],scanned:500,complete:false,available:true}],['scan-limit',{matches:[fixture().match],scanned:500,complete:false,available:true}],
  ['ambiguous',{matches:[fixture().match,fixture().match],scanned:2,complete:true,available:true}]];
 for(const [status,scan]of cases){const f=fixture();f.setScan(scan);const result=await f.run();assert.equal(result.status,status);assert.equal(result.checkpoint,null);assert.equal(result.canResume,false);}
 const f=fixture(),wrong=clone(f.match);wrong.checkpoint.docId=123;f.setScan({matches:[wrong],scanned:1,complete:true,available:true});assert.equal((await f.run()).status,'document-mismatch');
});

test('altered seals, lane ownership and malformed operation/validation data cannot become a found checkpoint',async()=>{
 for(const mutate of [x=>x.lane=null,x=>x.lane.key='product-document:'+'0'.repeat(64),x=>x.checkpoint.identityDigest='0'.repeat(64),x=>x.checkpoint.packetDigest='0'.repeat(64),
  x=>x.checkpoint.identity.ownerId='other-owner',x=>x.checkpoint.identity.company.name='다른 회사',x=>x.checkpoint.validatedSteps=[2,4],x=>x.checkpoint.state='validated',
  x=>x.checkpoint.sequence=0,x=>x.checkpoint.operationId='other-request:update',x=>x.checkpoint.tab.windowId=99]){
  const f=fixture(),match=clone(f.match);mutate(match);f.setScan({matches:[match],scanned:1,complete:true,available:true});const result=await f.run();assert.equal(result.status,'checkpoint-invalid');assert.equal(result.checkpoint,null);
 }
});

test('untrusted sender, forged action/body, scope changes and tab changes reject without exposing a checkpoint',async()=>{
 for(const mutate of [f=>f.sender.frameId=1,f=>f.sender.id='foreign-extension',f=>f.sender.url='https://untrusted.example',f=>f.message.action='prepareDraft',f=>f.message.body={},f=>f.message.target.productId='not-a-uuid']){
  const f=fixture();mutate(f);await assert.rejects(f.run());assert.equal(f.calls.length,0);
 }
 for(const prepare of [f=>f.scopeRace(),f=>f.tabRace()]){const f=fixture();prepare(f);await assert.rejects(f.run(),error=>error.code==='PRESERVED_SCOPE_CHANGED');}
 const f=fixture();f.api.tabs.sendMessage=async()=>({ok:true,scope:{ownerId:'inspection-owner',company:{code:'A01464742',name:'와이홉'},target}});await assert.rejects(f.run(),{code:'PRESERVED_SCOPE_UNVERIFIED'});assert.ok(!f.calls.some(call=>call[0]==='store'));
});

test('public parser rejects added capabilities, data, wrong target, malformed states and oversized reports; copies valid metadata',async()=>{
 const original=clone(await fixture().run()),parsed=parse(original,target);original.checkpoint.source.optionRevision=999;assert.equal(parsed.checkpoint.source.optionRevision,3);
 for(const mutate of [r=>r.canResume=true,r=>r.remoteWrites=true,r=>r.checkpointWrites=true,r=>r.registered=true,r=>r.packet={},r=>r.checkpoint.body={},
  r=>r.checkpoint.durableBodyAvailable=true,r=>r.checkpoint.preparedBodySha256='bad',r=>r.checkpoint.membersCount=201,r=>r.checkpoint.sequence=0,r=>r.checkpoint.validatedSteps=[3],r=>r.checkpoint.validatedSteps=new Array(2),
  r=>r.checkpoint.source.contentRevision=-1,r=>r.checkpoint.state='fabricated',r=>r.checkpoint.docId=2347604,r=>r.target.productId='00000000-0000-4000-8000-000000000001',
  r=>r.diagnostic.message='untrusted raw data',r=>r.diagnostic.message='a'.repeat(70000),r=>r.status='not-found',r=>r.complete=false]){
  const report=clone(await fixture().run());mutate(report);assert.throws(()=>parse(report,target),{code:'PRESERVED_REPORT_INVALID'});
 }
 for(const value of [{...target,ownerId:'spoof'}, {...target,docId:-1},{...target,docId:Number.MAX_SAFE_INTEGER+1},{...target,requestId:'x'}])assert.throws(()=>parseTarget(value));
});

function contentHarness(contexts=[{ownerId:'inspection-owner',company}],version='2.1.59'){
 const runtimeListeners=[],windowListeners=[],messages=[],posts=[],reads=[];let count=0;
 const sandbox={URL,Response,TextEncoder,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,structuredClone,
  location:{origin},window:{addEventListener(type,handler){windowListeners.push([type,handler]);},postMessage(value,destination){posts.push([value,destination]);}},
  chrome:{runtime:{id:'extension-test',onMessage:{addListener(handler){runtimeListeners.push(handler);}},getManifest(){return{version};},async sendMessage(message){messages.push(message);return{ok:true,result:{readOnly:true}};}}},
  fetch:async(url,init)=>{reads.push([url,init]);assert.equal(url,'/api/supplier-hub/catalog-context');return Response.json(contexts[Math.min(count++,contexts.length-1)]);}};
 vm.runInNewContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),sandbox);
 return{...sandbox,runtimeListeners,windowListeners,messages,posts,reads,scope:()=>new Promise(resolve=>runtimeListeners[0]({type:'YOOFAM_READ_PRESERVED_PRODUCT_DOCUMENT_SCOPE',expected:{origin,target}}, {id:'extension-test'},resolve))};
}

test('isolated content verifies existing approved auth context twice with bounded GET only and rejects account changes',async()=>{
 const h=contentHarness(),reply=await h.scope();assert.equal(reply.ok,true);assert.deepEqual(JSON.parse(JSON.stringify(reply.scope)),{ownerId:'inspection-owner',company,target});assert.equal(h.reads.length,2);
 for(const [,init]of h.reads){assert.equal(init.credentials,'include');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'manual');assert.equal(init.method,undefined);}
 const raced=contentHarness([{ownerId:'inspection-owner',company},{ownerId:'other-owner',company}]);assert.equal((await raced.scope()).ok,false);
 const invalid=contentHarness([{ownerId:'inspection-owner',company,body:'forbidden'}]);assert.equal((await invalid.scope()).ok,false);
});

test('public app postMessage forwards only the inspection command and preserves the correlation/response origin',async()=>{
 const h=contentHarness(),handler=h.windowListeners.find(([type])=>type==='message')[1],requestId='00000000-0000-4000-8000-000000000002';
 await handler({source:h.window,origin,data:{channel:'YOOFAM_HUB_HANDOFF',requestId,type:'PRESERVED_PRODUCT_DOCUMENT',payload:{action:'inspect',target}}});
 assert.equal(h.messages.length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.messages[0])),{action:'inspect',target,type:'YOOFAM_INSPECT_PRESERVED_PRODUCT_DOCUMENT'});assert.equal(h.posts[0][0].requestId,requestId);assert.equal(h.posts[0][1],origin);assert.equal(h.reads.length,0);
 await handler({source:{},origin,data:{channel:'YOOFAM_HUB_HANDOFF',requestId,type:'PRESERVED_PRODUCT_DOCUMENT',payload:{action:'inspect',target}}});assert.equal(h.messages.length,1);
});

test('capability is advertised only by the supporting installed manifest, not an updated content script beside an old worker',async()=>{
 for(const [version,available]of [['2.1.59',false],['2.1.60',true]]){
  const h=contentHarness(undefined,version),handler=h.windowListeners.find(([type])=>type==='message')[1];
  await handler({source:h.window,origin,data:{channel:'YOOFAM_HUB_HANDOFF',requestId:'00000000-0000-4000-8000-000000000002',type:'PING'}});
  assert.equal(h.posts[0][0].result.preservedProductCheckpointInspection,available);assert.equal(h.messages.length,0);
 }
});
