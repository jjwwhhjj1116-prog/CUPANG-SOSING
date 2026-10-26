import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {singleExistingDocumentRepairPage} from '../extensions/supplier-hub/single-existing-document-repair.mjs';
const canon=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canon).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';
const sha=v=>createHash('sha256').update(canon(v)).digest('hex');
function fixture(options={}){
 const docId=834001,requestId='83400000-0000-4000-8000-000000000001',body={docId,productName:'합성 복구 상품',categoryPath:'합성 (12)',categoryId:12,displayCategoryCode:13,scope:'Retail_Categorized_Single',productNoticeNumber:14,version:1,remark:null,jsonDocument:[{startPage:{productName:'합성 복구 상품'}}]};
 const binding={requestId,identity:{company:{code:'A01526306',name:'유앤채'}},identityDigest:'a'.repeat(64),packetDigest:'b'.repeat(64),preparedBodySha256:sha({...body,docId:null}),nativeAssetSourcePlanSha256:'c'.repeat(64)};
 const input={mode:'inspect',binding,docId,operationId:requestId+':update',expectedBody:body,baselineDocIds:[834000]},calls=[],dataset={},document={documentElement:{dataset},body:{innerText:'Company Code: A01526306'}};
 const row={...body,status:'UNFINISHED',jsonDocument:null,modifiedAt:'2026-10-26T00:00:00Z',...options.row};
 const fetch=async(url,init)=>{calls.push({url,method:init.method,body:init.body});const path=new URL(url).pathname;let json,status=200;
  if(path.endsWith('/register-requested'))json=options.requested??[];
  else if(path.endsWith('/drafts'))json=[row,...options.duplicates??[]];
  else if(path.includes('/get-by-id/')){if(options.bodyFailure){json={errorCode:'INTERNAL_SERVER_ERROR'};status=500;}else json={...body,status:'UNFINISHED',...options.body};}
  else if(path.includes('/get-images-by-id/'))json=options.images??[];
  else if(path.includes('/get-files-by-type/'))json=options.legal??[];
  else throw Error('Unexpected network path');
  const response=Response.json(json,{status});Object.defineProperty(response,'url',{value:url});return response;
 };
 const context=vm.createContext({input:JSON.stringify(input),location:new URL('https://supplier.coupang.com/dashboard/KR'),document,fetch,crypto:webcrypto,AbortController,TextEncoder,Uint8Array,setTimeout,clearTimeout,Date,URL});
 return{calls,dataset,input,run:async()=>JSON.parse(await vm.runInContext('('+singleExistingDocumentRepairPage.toString()+')(input)',context))};
}
test('checkpoint-owned inspection reads only the exact document and all file buckets without writing a marker',async()=>{
 const f=fixture(),result=await f.run();assert.equal(result.proof.docId,f.input.docId);assert.equal(result.proof.bodyState,'original-exact');assert.equal(result.proof.priorUpdateOutcome,'unknown');assert.equal(result.proof.remoteWrites,false);assert.equal(result.record,null);assert.deepEqual(f.dataset,{});
 assert.equal(f.calls.length,10);assert.equal(result.proof.duplicateMatches,0);assert.ok(f.calls.every(call=>call.method==='GET'||call.method==='POST'&&call.url.includes('/get-files-by-type/834001?fileType=')&&call.body==='{}'));
 assert.ok(f.calls.every(call=>!call.url.includes('/create')&&!call.url.includes('/update')&&!call.url.includes('/upload')));
});
test('native body HTTP 500 remains unreadable evidence and never becomes an update acknowledgement',async()=>{
 const f=fixture({bodyFailure:true}),result=await f.run();assert.equal(result.proof.bodyState,'server-unreadable');assert.equal(result.proof.priorUpdateOutcome,'unknown');assert.equal(result.record,null);assert.deepEqual(f.dataset,{});
});
test('changed metadata or body and existing files block inspection without mutation',async()=>{
 for(const options of [{row:{status:'SUBMITTED'}},{row:{productName:'다른 상품'}},{body:{jsonDocument:[]}},{images:[{imageName:'already.png'}]},{legal:[{fileName:'already.pdf'}]},
   {duplicates:[{docId:834002,productName:'합성 복구 상품'}]},{requested:[{docId:834002,productName:'합성 복구 상품'}]}]){
  const f=fixture(options);await assert.rejects(f.run());assert.deepEqual(f.dataset,{});assert.ok(f.calls.every(call=>!call.url.includes('/update')&&!call.url.includes('/upload')));
 }
});
test('a current page record prevents overwrite and a baseline ID cannot select another document',async()=>{
 const f=fixture();f.dataset.yoofamSingleDocumentRecords=JSON.stringify({[f.input.binding.packetDigest]:{docId:f.input.docId}});await assert.rejects(f.run());assert.equal(f.calls.length,0);
 const g=fixture();g.input.baselineDocIds.push(g.input.docId);
 const code='('+singleExistingDocumentRepairPage.toString()+')('+JSON.stringify(JSON.stringify(g.input))+')';
 await assert.rejects(vm.runInNewContext(code,{crypto:webcrypto,TextEncoder,Uint8Array,document:{documentElement:{}},location:{}}));
});
