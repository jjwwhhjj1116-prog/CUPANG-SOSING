import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {nativeReceiverReceiptFixture,plain} from './helpers/native-product-receiver-receipt-flow.mjs';
import {createProductDocumentDraftReceiver} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {createNativeDraftDetailAmendmentBrowserAdapter} from '../extensions/supplier-hub/native-draft-detail-amendment-adapter.mjs';
import {createNativeDraftDetailAmendmentReceiver} from '../extensions/supplier-hub/native-draft-detail-amendment-receiver.mjs';
import {createNativeDraftDetailAmendmentStore} from '../extensions/supplier-hub/native-draft-detail-amendment-store.mjs';
import {amendmentIndexedDB} from './helpers/amendment-indexeddb.mjs';
import {amendmentDigest} from '../extensions/supplier-hub/native-draft-detail-amendment.mjs';
for(const recovered of [false,true])test('actual app source/Chrome adapter begins from '+(recovered?'a verified read-target rebind':'exact validated parent')+' without any Hub mutation',async()=>{
 const f=await nativeReceiverReceiptFixture();let adapter;
 try{
  const prepared=await createProductDocumentDraftReceiver({adapter:f.adapter,store:f.storage.store}).prepareDraft(f.packet,f.sender);assert.equal(prepared.state,'validated');
  const checkpoint=await f.storage.store.get(f.context.key);
  if(recovered){
   const target=checkpoint.ownedTarget,proof={format:'yoofam-current-saved-draft-target-v1',requestId:f.packet.requestId,docId:prepared.docId,tabId:target.tabId,windowId:target.windowId,identityDigest:f.context.identityDigest,packetDigest:f.context.packetDigest,preparedBodySha256:f.context.bodySha256,sourcePlanSha256:f.context.identity.fingerprint,baselineSha256:await amendmentDigest(checkpoint.baselineDocIds),bodySha256:f.context.bodySha256,fileSetSha256:'1'.repeat(64),byteSetSha256:'2'.repeat(64),filesCount:f.plan.images.length,duplicateMatches:0,documentState:'UNFINISHED',readOnly:true,remoteWrites:false,historicalAckRecovered:false,observedAt:Date.now()},proofSha256=await amendmentDigest(proof);
   checkpoint.savedDraftTargetRecovery={format:'yoofam-saved-draft-target-recovery-v1',phase:'bound',previousTarget:{...target,tabId:target.tabId+1000},priorState:'validated',priorSequence:checkpoint.sequence,previousSessionId:checkpoint.sessionId,startedAt:proof.observedAt,docId:prepared.docId,target,proof,proofSha256};checkpoint.sequence+=3;checkpoint.updatedAt=Date.now();f.storage.force(f.context.key,checkpoint);
   const records=JSON.parse(f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords),old=records[f.context.packetDigest];records[f.context.packetDigest]={binding:old.binding,docId:old.docId,baselineDocIds:old.baselineDocIds,createOperationId:old.createOperationId,state:'updated',currentReadRecovery:{proof,proofSha256,fileSetSha256:proof.fileSetSha256,byteSetSha256:proof.byteSetSha256,rawBodySha256:'3'.repeat(64),filesCount:proof.filesCount,fileBodyWritesAllowed:false,historicalAckRecovered:false}};f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords=JSON.stringify(records);
  }
  const before=plain(checkpoint),lane={key:f.context.key},idb=amendmentIndexedDB([[f.context.key,checkpoint],[f.context.laneKey,lane]]),store=createNativeDraftDetailAmendmentStore(idb.api),originalMessage=f.api.tabs.sendMessage,originalExecute=f.api.scripting.executeScript,stored=new Map(),requests=[];
  f.api.tabs.sendMessage=async(id,value,...rest)=>value.type==='YOOFAM_READ_PRESERVED_PRODUCT_DOCUMENT_SCOPE'?{ok:true,scope:{ownerId:f.context.identity.ownerId,company:f.context.identity.company,target:value.expected.target}}:originalMessage(id,value,...rest);
  const fetcher=async(url,init)=>{requests.push({url,method:init.method});const path=new URL(url).pathname;let value;
   if(path.endsWith('/drafts'))value=[{docId:prepared.docId,status:'UNFINISHED',scope:'Retail_Categorized_Single'}];
   else if(path.endsWith('/register-requested'))value=[];
   else if(path.includes('/get-by-id/'))value={...plain(f.documents.get(prepared.docId)),status:'UNFINISHED'};
   else if(path.includes('/get-images-by-id/'))value=[...f.state.registry.values()];
   else if(path.includes('/get-files-by-type/'))value=[];
   else assert.fail('amend begin issued a write '+path);
   const response=Response.json(value);Object.defineProperty(response,'url',{value:url});return response;
  };
  const hub=vm.createContext({location:f.hubLocation,document:f.hubDocument,fetch:fetcher,crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,URL,FormData,File,atob,setTimeout,clearTimeout,sessionStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)}});
  f.api.scripting.executeScript=async request=>{if(request.func.name!=='nativeDraftDetailAmendmentPage')return originalExecute(request);hub.args=plain(request.args);const result=await vm.runInContext('('+request.func.toString()+')(...args)',hub);return[{frameId:0,documentId:f.hubDocumentId,result:plain(result)}];};
  adapter=createNativeDraftDetailAmendmentBrowserAdapter({api:f.api,parentStore:f.storage.store});const receiver=createNativeDraftDetailAmendmentReceiver({store,adapter}),amendmentId=webcrypto.randomUUID();
  if(recovered){const raw=f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords,records=JSON.parse(raw);records[f.context.packetDigest].currentReadRecovery.proofSha256='f'.repeat(64);f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords=JSON.stringify(records);await assert.rejects(receiver.run({action:'begin',amendmentId,packet:f.packet,docId:prepared.docId},f.sender),error=>error.code==='DRAFT_DETAIL_AMENDMENT_PARENT_CHANGED');assert.equal([...idb.rows.keys()].some(key=>key.startsWith('product-document-detail-amendment:')),false);f.hubDocument.documentElement.dataset.yoofamSingleDocumentRecords=raw;}
  const result=await receiver.run({action:'begin',amendmentId,packet:f.packet,docId:prepared.docId},f.sender);
  assert.equal(result.state,'editing');assert.equal(result.anchor.parentCheckpointSequence,checkpoint.sequence);assert.deepEqual(result.execution,{create:0,upload:0,update:0,validate:0,submit:0});assert.deepEqual(await f.storage.store.get(f.context.key),before);assert.deepEqual(idb.rows.get(f.context.laneKey),lane);assert.ok(requests.every(row=>row.method==='GET'||row.url.includes('/get-files-by-type/')));
  const child=await store.read(result.anchor,amendmentId);assert.equal(child.parentSource.quotationView.revision,f.review.identity.source.quotationRevision);assert.equal(child.parentSource.nativePlan.sourcePlanSha256,f.plan.sourcePlanSha256);
 }finally{adapter?.dispose();f.close();}
});
