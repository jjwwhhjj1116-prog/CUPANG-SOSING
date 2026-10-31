import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {singlePacket,SINGLE_COMPANIES,SINGLE_SENDER} from './helpers/supplier-hub-single-document.mjs';
import {createProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
import {productDocumentIdentity} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {historicalProductReceiptSourceFromNativePlan,historicalProductReceiptAnchor,validateHistoricalProductReceiptCandidate,reconcilePreservedProductReceipt} from '../extensions/supplier-hub/preserved-product-receipt.mjs';
import {dispatchHistoricalProductReceipt} from '../extensions/supplier-hub/preserved-product-receipt-runtime.mjs';

const clone=value=>structuredClone(value),plain=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=async value=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))).toString('hex');
const withUrl=(response,url)=>{Object.defineProperty(response,'url',{value:url});return response;};
async function fixture(company=SINGLE_COMPANIES[0]){
  const single=singlePacket(company),body=clone(single.body),identity={ownerId:single.ownerId,company:clone(company),productId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',profileId:single.profileId,requestedProfileId:single.profileId,
    categoryId:single.categoryId,fingerprint:single.fingerprint,inputFingerprint:'d'.repeat(64),schemaSha256:single.schemaSha256,source:{...single.source,profileId:single.profileId}};
  identity.source.productVersion=new Date(Date.now()-60000).toISOString();
  const deferred=clone(body);for(const row of deferred.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])row.imagePage[key]=false;
  const review={format:'yoofam-supplier-hub-product-document-v1',type:'YOOFAM_PRODUCT_DOCUMENT_REVIEW',identity,members:[{optionId:single.optionId,optionLabel:'합성 옵션',documentIndex:0}],body,registered:false,remoteWrites:false,submissionReady:false,
    originalBodySha256:await digest(body),preparedBodySha256:await digest(deferred)};
  review.reviewDigest=await digest({format:review.format,type:review.type,identity,members:review.members,originalBodySha256:review.originalBodySha256,preparedBodySha256:review.preparedBodySha256});
  const target={requestId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',productId:identity.productId,docId:50123,company:clone(company),qvtRequestId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},packet=await createProductDocumentPacket(review,{requestId:target.requestId}),context=await productDocumentIdentity(packet,SINGLE_SENDER);
  const scope={origin:context.identity.origin,ownerId:identity.ownerId,company:clone(company)},ownedTarget={tabId:71,windowId:context.identity.windowId,origin:'https://supplier.coupang.com',requestId:target.requestId,packetDigest:context.packetDigest};
  const checkpoint={format:review.format,draftOnly:true,state:'updated',key:context.key,laneKey:context.laneKey,identity:clone(context.identity),identityDigest:context.identityDigest,packetDigest:context.packetDigest,
    originalBodySha256:context.originalBodySha256,bodySha256:context.bodySha256,requestId:target.requestId,docId:target.docId,sequence:12,updatedAt:Date.now()-1000,baselineDocIds:[1234],ownedTarget,tab:{...ownedTarget,authenticated:true,company:clone(company)}};
  const nativeIdentity={ownerId:identity.ownerId,productId:identity.productId,company:clone(company),categoryId:identity.categoryId,categoryPath:['스포츠','보호대'],schemaSha256:identity.schemaSha256,sourceFingerprint:'e'.repeat(64),inputFingerprint:identity.inputFingerprint,source:clone(identity.source),members:clone(review.members)};
  const plan={format:'yoofam-native-asset-source-plan-v1',identity:nativeIdentity,identityDigest:null,body:clone(body),metadataValid:false,originalBodySha256:null,preparedBodySha256:null,sourcePlanSha256:null,
    issues:[{code:'FREE_IMAGE_TRANSLATION_UNCONFIRMED',level:'error',message:'새 전송용 선택 이미지 검토 필요'}],registered:false,remoteWrites:false,submissionReady:false,transportReady:false,bytesVerified:false};
  const currentSource=await historicalProductReceiptSourceFromNativePlan({plan,requestedProfileId:identity.requestedProfileId,productName:body.productName,categoryPath:body.categoryPath});
  const sender={...clone(SINGLE_SENDER),id:'extension'},calls=[],listeners=[];let matches=1,hook=()=>{};
  const f={target,context,scope,checkpoint,plan,currentSource,sender,calls,rows:[{docId:target.docId,status:'FINISHED',qvtRequestId:target.qvtRequestId,productName:body.productName,categoryPath:body.categoryPath,modifiedAt:new Date().toISOString(),remark:''}],actor:{ownerId:scope.ownerId,company:clone(company)},appUrl:sender.url,hubUrl:'https://supplier.coupang.com/dashboard/KR',documentId:'11111111-1111-4111-8111-111111111111',bodyText:'Company Code: '+company.code,companyName:company.name,companyVisible:true,
    originalPresent:true,originalGetFailure:false,originalWindowId:context.identity.windowId,otherTabs:[],expectedReadTab:ownedTarget.tabId};
  const appContext=vm.createContext({location:{origin:scope.origin},window:{addEventListener(){}},crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,structuredClone,setTimeout,clearTimeout,Date,Response,
    chrome:{runtime:{id:'extension',onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:()=>assert.fail('No app action was requested')}},fetch:async(path,init)=>{
      calls.push({port:'app-fetch',path,method:init.method??'GET'});assert.equal(init.method??'GET','GET');await hook('app',path);
      const value=path==='/api/supplier-hub/catalog-context'?f.actor:path.includes('/native-assets')?f.plan:assert.fail('Unexpected app request');return withUrl(Response.json(value),scope.origin+path);
    }});
  vm.runInContext(fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),appContext);
  const hubContext=vm.createContext({location:new URL(f.hubUrl),document:{body:{get innerText(){return f.bodyText;}},querySelectorAll:selector=>selector==='button'?[{get innerText(){return f.companyName;},getClientRects:()=>f.companyVisible?[{}]:[],disabled:false}]:[]},AbortController,setTimeout,clearTimeout,Date,Response,fetch:async(url,init)=>{
    calls.push({port:'hub-fetch',url,method:init.method});assert.equal(init.method,'GET');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');await hook('hub',url);return withUrl(Response.json(f.rows),url);
  }});
  const originalTab=()=>({id:ownedTarget.tabId,windowId:f.originalWindowId,url:f.hubUrl});
  const api={runtime:{id:'extension'},tabs:{get:async id=>{calls.push({port:'tab-get',id});if(id===sender.tab.id)return{id,windowId:context.identity.windowId,url:f.appUrl};if(id===ownedTarget.tabId){if(!f.originalPresent||f.originalGetFailure)throw Error('No tab with id: '+id);return originalTab();}const selected=f.otherTabs.find(tab=>tab.id===id);if(!selected)throw Error('No tab with id: '+id);return clone(selected);},
    query:async query=>{calls.push({port:'tab-query',query});return[{id:sender.tab.id,windowId:context.identity.windowId,url:f.appUrl},...(f.originalPresent?[originalTab()]:[]),...clone(f.otherTabs)];},sendMessage:async(id,message)=>{
    assert.equal(id,sender.tab.id);calls.push({port:'app-message',type:message.type});for(const fn of listeners){let pending;const promise=new Promise(resolve=>{pending=fn(message,{id:'extension'},resolve);});if(pending===true)return plain(await promise);}assert.fail('No isolated app reader');
  },create:()=>assert.fail('No new tab'),update:()=>assert.fail('No navigation')},scripting:{executeScript:async request=>{
    calls.push({port:'execute',name:request.func.name,tabId:request.target.tabId});assert.equal(request.target.tabId,f.expectedReadTab);hubContext.args=clone(request.args);const result=await vm.runInContext('('+request.func.toString()+')(...args)',hubContext);return[{frameId:0,documentId:f.documentId,result:plain(result)}];
  }}};
  const store={inspectProductRequest:async()=>({available:true,complete:true,scanned:1,matches:Array.from({length:matches},()=>({key:checkpoint.key,lane:{key:checkpoint.key},checkpoint:clone(f.checkpoint)}))})};
  f.api=api;f.store=store;f.setMatches=value=>{matches=value;};f.setHook=value=>{hook=value;};f.run=()=>dispatchHistoricalProductReceipt({type:'YOOFAM_RECONCILE_PRESERVED_PRODUCT_RECEIPT',action:'reconcile',target:f.target},sender,{api,store});return f;
}

for(const company of SINGLE_COMPANIES)test(`${company.code}: live-shaped readiness-false/null-hash native source reconciles private original document to structured FINISHED QVT through actual isolated readers`,async()=>{
  const f=await fixture(company),before=canonical(f.checkpoint),result=await f.run();assert.equal(result.receipt.state,'accepted');assert.equal(result.receipt.sourceStatus,'FINISHED');assert.equal(result.receipt.qvtRequestId,f.target.qvtRequestId);assert.equal(result.anchor.originalBodySha256,f.context.originalBodySha256);
  assert.equal(result.historicalRequestOnly,true);assert.equal(result.currentBodyEqualityVerified,false);assert.equal(result.canResume,false);assert.equal(result.readOnly,true);assert.equal(result.remoteWrites,false);assert.equal(result.checkpointWrites,false);assert.equal(canonical(f.checkpoint),before);
  assert.equal(f.calls.filter(call=>call.port==='hub-fetch').length,1);assert.ok(f.calls.filter(call=>call.port.endsWith('fetch')).every(call=>call.method==='GET'));
  assert.deepEqual(plain(await validateHistoricalProductReceiptCandidate(result,{scope:f.scope,currentSource:f.currentSource})),plain(result));
});

test('nonnull source identity hash remains checked, while missing hash requires explicit metadataValid false',async()=>{
  const f=await fixture(),args={plan:f.plan,requestedProfileId:f.context.identity.requestedProfileId,productName:f.currentSource.productName,categoryPath:f.currentSource.categoryPath};
  await assert.rejects(historicalProductReceiptSourceFromNativePlan({...args,plan:{...f.plan,metadataValid:true}}));
  await assert.rejects(historicalProductReceiptSourceFromNativePlan({...args,plan:{...f.plan,identityDigest:'f'.repeat(64)}}));
  assert.deepEqual(plain(await historicalProductReceiptSourceFromNativePlan({...args,plan:{...f.plan,identityDigest:await digest(f.plan.identity)}})),plain(f.currentSource));
});

for(const mode of ['wrong-doc','doc-type','wrong-qvt','duplicate-doc','duplicate-qvt','korean-status','missing-status','foreign-company','wrong-title','wrong-category'])test(`historical ${mode} never becomes a receipt or invokes a write`,async()=>{
  const f=await fixture();if(mode==='wrong-doc')f.rows[0].docId++;if(mode==='doc-type')f.rows[0].docId=String(f.rows[0].docId);if(mode==='wrong-qvt')f.rows[0].qvtRequestId='other';
  if(mode==='duplicate-doc')f.rows.push(clone(f.rows[0]));if(mode==='duplicate-qvt')f.rows.push({...clone(f.rows[0]),docId:67890});if(mode==='korean-status')f.rows[0].status='등록완료';if(mode==='missing-status')delete f.rows[0].status;
  if(mode==='foreign-company')f.bodyText='Company Code: A01464742';if(mode==='wrong-title')f.rows[0].productName+=' changed';if(mode==='wrong-category')f.rows[0].categoryPath+=' changed';
  await assert.rejects(f.run());assert.ok(f.calls.filter(call=>call.port.endsWith('fetch')).every(call=>call.method==='GET'));
});

for(const mode of ['wrong-member','ambiguous-checkpoint','source-clock','source-option','source-category','source-input','baseline-document','wrong-body-hash','owned-target','post-member','post-checkpoint','post-source','browser-document'])test(`historical ${mode} retains original identity/body/company fences`,async()=>{
  const f=await fixture();
  if(mode==='wrong-member')f.actor.ownerId='other';if(mode==='ambiguous-checkpoint')f.setMatches(2);if(mode==='source-clock')f.plan.identity.source.optionRevision++;if(mode==='source-option')f.plan.identity.members[0].optionLabel+=' changed';if(mode==='source-category')f.plan.identity.categoryId='99999';if(mode==='source-input')f.plan.identity.inputFingerprint='9'.repeat(64);
  if(mode==='baseline-document')f.checkpoint.baselineDocIds.push(f.target.docId);if(mode==='wrong-body-hash')f.checkpoint.bodySha256='9'.repeat(64);if(mode==='owned-target')f.checkpoint.ownedTarget.requestId='other';
  f.setHook((port)=>{if(port!=='hub')return;if(mode==='post-member')f.actor.ownerId='other';if(mode==='post-checkpoint')f.checkpoint.sequence++;if(mode==='post-source')f.plan.identity.source.quotationRevision++;if(mode==='browser-document')f.documentId='22222222-2222-4222-8222-222222222222';});
  await assert.rejects(f.run());assert.ok(f.calls.filter(call=>call.port.endsWith('fetch')).every(call=>call.method==='GET'));
});

test('historical controller offers only reads and cancels before adoption without altering the old checkpoint',async()=>{
  const f=await fixture(),controller=new AbortController(),before=canonical(f.checkpoint);let hubReads=0;
  await assert.rejects(reconcilePreservedProductReceipt({target:f.target,signal:controller.signal},{readScope:()=>f.scope,readCheckpoint:()=>f.checkpoint,readCurrentSource:()=>f.currentSource,readHubReceipt:()=>{hubReads++;controller.abort();return{};}}),{code:'HISTORICAL_RECEIPT_CANCELLED'});
  assert.equal(hubReads,1);assert.equal(canonical(f.checkpoint),before);
  const anchor=await historicalProductReceiptAnchor({target:f.target,checkpoint:f.checkpoint,scope:f.scope,currentSource:f.currentSource});assert.equal(anchor.canResume,false);assert.equal(anchor.currentBodyEqualityVerified,false);
});

test('worker and window bridge expose the dedicated receipt-only action without changing the ordinary product action list',()=>{
  const worker=fs.readFileSync(new URL('../extensions/supplier-hub/handoff-worker.mjs',import.meta.url),'utf8'),content=fs.readFileSync(new URL('../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8');
  assert.match(worker,/message\?\.type==='YOOFAM_RECONCILE_PRESERVED_PRODUCT_RECEIPT'/);assert.match(content,/PRESERVED_PRODUCT_RECEIPT:'YOOFAM_RECONCILE_PRESERVED_PRODUCT_RECEIPT'/);assert.match(content,/preservedProductReceiptReconciliation/);
});

test('foreign senders, frames, action fields and origins fail before scope or Hub access',async()=>{
  for(const mode of ['sender','frame','origin','confirmation','action']){const f=await fixture(),sender=clone(f.sender),message={type:'YOOFAM_RECONCILE_PRESERVED_PRODUCT_RECEIPT',action:'reconcile',target:f.target};
    if(mode==='sender')sender.id='foreign';if(mode==='frame')sender.frameId=1;if(mode==='origin')sender.url='https://foreign.example.test/';if(mode==='confirmation')message.confirmation={userInitiated:true};if(mode==='action')message.action='submit';
    await assert.rejects(dispatchHistoricalProductReceipt(message,sender,{api:f.api,store:f.store}));assert.equal(f.calls.length,0);
  }
});

test('dedicated server candidate validation rejects widened claims, provenance, clock and retained body seals',async()=>{
  const f=await fixture(),candidate=await f.run();
  for(const mutate of [value=>{value.currentBodyEqualityVerified=true;},value=>{value.canResume=true;},value=>{value.anchor.preparedBodySha256='9'.repeat(64);},value=>{value.provenance.method='POST';},value=>{value.receipt.sourceStatus='SUBMITTED';},value=>{value.provenance.readId='other';},value=>{value.anchor.checkedAt=Date.now()-130000;}]){
    const changed=clone(candidate);mutate(changed);await assert.rejects(validateHistoricalProductReceiptCandidate(changed,{scope:f.scope,currentSource:f.currentSource}));
  }
});

test('an absent original tab reads one already-open same-window HTTPS Hub tab and preserves the original ownership anchor',async()=>{
  const f=await fixture(),before=canonical(f.checkpoint);f.originalPresent=false;f.expectedReadTab=145;
  f.otherTabs=[{id:148,windowId:f.context.identity.windowId,url:f.hubUrl},{id:145,windowId:f.context.identity.windowId,url:f.hubUrl},
    {id:1,windowId:f.context.identity.windowId+1,url:f.hubUrl},{id:2,windowId:f.context.identity.windowId,url:'http://supplier.coupang.com/dashboard/KR'},
    {id:3,windowId:f.context.identity.windowId,url:'https://supplier.coupang.com/login'},{id:4,windowId:f.context.identity.windowId,url:'https://supplier.coupang.com.evil.test/dashboard/KR'}];
  const result=await f.run();assert.equal(result.receipt.state,'accepted');assert.equal(result.anchor.ownedTarget.tabId,71);assert.equal(canonical(f.checkpoint),before);
  assert.equal(result.provenance.tabId,145);assert.deepEqual(result.provenance.observedTab,{tabId:145,windowId:f.context.identity.windowId,documentId:f.documentId,selection:'existing-same-window-tab',originalTabId:71,originalTabAbsent:true});
  assert.equal(f.calls.filter(call=>call.port==='hub-fetch').length,1);assert.ok(f.calls.filter(call=>call.port==='execute').every(call=>call.tabId===145));
  assert.deepEqual(plain(await validateHistoricalProductReceiptCandidate(result,{scope:f.scope,currentSource:f.currentSource})),plain(result));
});

for(const mode of ['original-get-blocked','original-foreign-window','original-wrong-company','no-same-window','fallback-wrong-company','fallback-wrong-name','fallback-hidden-name','original-reappears','fallback-moved','forged-observed-tab'])test(`historical fallback ${mode} cannot replace an existing anchor or authorize a receipt`,async()=>{
  const f=await fixture();f.otherTabs=[{id:145,windowId:f.context.identity.windowId,url:f.hubUrl}];
  if(mode==='original-get-blocked')f.originalGetFailure=true;
  else if(mode==='original-foreign-window')f.originalWindowId++;
  else if(mode==='original-wrong-company')f.bodyText='Company Code: A01464742';
  else{f.originalPresent=false;f.expectedReadTab=145;}
  if(mode==='no-same-window')f.otherTabs[0].windowId++;
  if(mode==='fallback-wrong-company')f.bodyText='Company Code: A01464742';if(mode==='fallback-wrong-name')f.companyName='다른 회사';if(mode==='fallback-hidden-name')f.companyVisible=false;
  if(mode==='original-reappears')f.setHook(port=>{if(port==='hub')f.originalPresent=true;});if(mode==='fallback-moved')f.setHook(port=>{if(port==='hub')f.otherTabs[0].windowId++;});
  if(mode==='forged-observed-tab'){const value=clone(await f.run());value.provenance.observedTab.originalTabAbsent=false;await assert.rejects(validateHistoricalProductReceiptCandidate(value,{scope:f.scope,currentSource:f.currentSource}));}
  else await assert.rejects(f.run());
  assert.equal(f.checkpoint.ownedTarget.tabId,71);assert.ok(f.calls.filter(call=>call.port.endsWith('fetch')).every(call=>call.method==='GET'));
  if(mode.startsWith('original-')&&mode!=='original-reappears')assert.equal(f.calls.filter(call=>call.port==='execute'&&call.tabId===145).length,0);
});
