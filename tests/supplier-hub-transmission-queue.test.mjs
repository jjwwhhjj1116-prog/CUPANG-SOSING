import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SINGLE_COMPANIES,SINGLE_SENDER} from './helpers/supplier-hub-single-document.mjs';
import {productDocumentIdentity} from '../extensions/supplier-hub/product-document-receiver.mjs';
import {quotationTitleLoader} from './helpers/quotation-seo-title-ui.mjs';
import {queueCandidate} from './helpers/transmission-queue.mjs';
import {completeQuotationNativeFixture,companies,json} from './helpers/quotation-native-flow.mjs';
const plain=value=>JSON.parse(JSON.stringify(value));
const load=quotationTitleLoader(),file='app/supplier-hub-transmission-queue.ts';
const api=()=>fs.existsSync(new URL('../'+file,import.meta.url))?load(file):{};
for(const company of SINGLE_COMPANIES)test(company.code+': batch marker binds distinct exact reviewed requests and rejects mixed, duplicate or changed scopes',async()=>{
 const q=api();assert.equal(typeof q.transmissionQueueAttributes,'function');const a=await queueCandidate(company),b=await queueCandidate(company,'synthetic-queue-second');
 const attributes=q.transmissionQueueAttributes([a,b]),bindings=JSON.parse(attributes['data-supplier-hub-registration-items']);assert.equal(attributes['data-supplier-hub-registration-batch'],'v1');assert.equal(bindings.length,2);
 assert.deepEqual(bindings.map(row=>row.requestId),[a.session.packet.requestId,b.session.packet.requestId]);assert.ok(bindings.every(row=>row.companyCode===company.code));assert.ok(bindings.every(row=>Object.keys(row).length===8));
 for(const values of [[],[a,a],[a,{...b,session:a.session}],[a,await queueCandidate(SINGLE_COMPANIES.find(other=>other.code!==company.code),'synthetic-other-company')],[{...a,session:{...a.session,preview:{...a.session.preview,packetDigest:'f'.repeat(64)}}}],Array(101).fill(a)])assert.throws(()=>q.transmissionQueueAttributes(values));
});
for(const company of SINGLE_COMPANIES)test(company.code+': only a saved terminal receipt of the exact reviewed request may advance the queue',async()=>{
 const q=api();assert.equal(typeof q.transmissionQueueReceipt,'function');const a=await queueCandidate(company),pending=await a.record('SUBMITTED');assert.equal(q.transmissionQueueReceipt(a,pending),null);
 for(const status of ['FINISHED','REJECTED']){const stored=await a.record(status);assert.equal(q.transmissionQueueReceipt(a,stored)?.receipt.sourceStatus,status);for(const change of [r=>r.requestId='11111111-1111-4111-8111-111111111111',r=>r.productId='other',r=>r.identity.productId='other',r=>r.identity.appTabId++,r=>r.company.name='other',r=>r.members.reverse().push({...r.members[0]}),r=>r.packetDigest='f'.repeat(64),r=>r.originalBodySha256='f'.repeat(64),r=>r.source.quotationRevision++,r=>r.receipt.docId='other']){const changed=plain(stored);change(changed);assert.equal(q.transmissionQueueReceipt(a,changed),null);}}
});

for(const company of companies)test(company.code+': candidate review uses current owned SQLite source and only readonly preview, then excludes history and reservation',async()=>{
 const f=await completeQuotationNativeFixture(company,{productId:'synthetic-new-queue-978'}),calls=[];let pending=null,history=[],afterPreview;
 try{
  const request=async(url,init={})=>{calls.push({url,method:init.method??'GET'});assert.equal(init.method??'GET','GET');
   if(url==='/api/supplier-hub/catalog-context')return f.h.load('app/api/supplier-hub/catalog-context/route.ts').GET();
   if(url===f.base)return f.h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test'+url),f.context);
   return f.h.route(url);
  };
  const loader=quotationTitleLoader({fetch:request,window:{location:{origin:new URL(SINGLE_SENDER.url).origin}},
   '@/app/supplier-hub-product-pending':{readProductDocumentPending:()=>pending,readProductDocumentRejections:()=>[]},
   '@/app/native-draft-detail-amendment-pending':{readNativeDraftDetailAmendmentPending:()=>null},
   '@/app/supplier-hub-handoff':{getSupplierHubProductHistory:async()=>({records:[],blocked:false})},
   '@/app/supplier-hub-product-client':{readNativeReceiptHistory:async()=>history.length?history:(await json(await f.h.route(f.base+'/supplier-hub-product-receipt'))).receipts,
    previewProductDocument:async(packet,signal)=>{signal.throwIfAborted();calls.push({action:'preview'});const review=packet.review,ctx=await productDocumentIdentity(packet,SINGLE_SENDER);afterPreview?.();return{packet,origin:ctx.identity.origin,packetDigest:ctx.packetDigest,preview:{...ctx,format:review.format,requestId:packet.requestId,productId:review.identity.productId,fingerprint:review.identity.fingerprint,members:review.members,reviewDigest:review.reviewDigest,preparedBodySha256:review.preparedBodySha256,originalBodySha256:review.originalBodySha256,draftPreparationAvailable:true,preparedLifecycleAvailable:true,remoteWrites:false,registered:false}};}}});
  const q=loader(file),before=f.state(),objects=f.objectState(),signal=new AbortController().signal,target={id:f.id,title:'합성 큐 상품'};
  const candidate=await q.prepareTransmissionQueueCandidate(target,f.profile.id,signal,request);assert.equal(candidate.productId,f.id);assert.equal(candidate.review.members.length,2);assert.equal(candidate.review.identity.company.code,company.code);assert.equal(calls.filter(row=>row.action==='preview').length,1);assert.equal(f.state(),before);assert.equal(f.objectState(),objects);assert.deepEqual(f.h.network,[]);
  await assert.rejects(q.prepareTransmissionQueueCandidate({...target,expectedCategoryId:'999'},f.profile.id,signal,request),/카테고리/);assert.equal(calls.filter(row=>row.action==='preview').length,1);
  history=[{existing:true}];const previews=calls.filter(row=>row.action==='preview').length;await assert.rejects(q.refreshTransmissionQueueCandidate(candidate,signal,request),/이력/);await assert.rejects(q.prepareTransmissionQueueCandidate(target,f.profile.id,signal,request),/전송 이력/);assert.equal(calls.filter(row=>row.action==='preview').length,previews);
  history=[];pending={requestId:'original-request'};await assert.rejects(q.prepareTransmissionQueueCandidate(target,f.profile.id,signal,request),/원래 문서 요청/);assert.equal(calls.filter(row=>row.action==='preview').length,previews);
  pending=null;afterPreview=()=>{pending={requestId:'another-tab-request'};};await assert.rejects(q.prepareTransmissionQueueCandidate(target,f.profile.id,signal,request),/원래 문서 요청/);assert.equal(f.state(),before);assert.equal(f.objectState(),objects);
 }finally{f.close();}
});
