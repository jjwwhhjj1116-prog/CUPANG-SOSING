import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {nativeDraftDetailAmendmentPage} from '../extensions/supplier-hub/native-draft-detail-amendment-page.mjs';
const plain=value=>JSON.parse(JSON.stringify(value)),requestId='11111111-1111-4111-8111-111111111111',amendmentId='22222222-2222-4222-8222-222222222222';
function fixture(){
 const parentBinding={requestId,packetDigest:'a'.repeat(64),identity:{company:{code:'A01526306',name:'유앤채'}}},parentRecord={binding:parentBinding,docId:2362997,createOperationId:requestId+':create',state:'validated',baselineDocIds:[]},root={dataset:{yoofamSingleDocumentRecords:JSON.stringify({[parentBinding.packetDigest]:parentRecord})}},stored=new Map(),calls=[],bytes=Buffer.from('new reviewed detail bytes'),part={transportName:'new-detail.png',contentType:'image/png',byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64')};
 const state={body:{docId:2362997,productName:'합성 상품',categoryPath:'합성',categoryId:'1',displayCategoryCode:'1',jsonDocument:[{imagePage:{details:{detailedImage:'old.png'}}}],scope:'Retail_Categorized_Single',productNoticeNumber:'1',version:1},images:[{imageName:'old.png',imageUrl:'/stored/old.png',mainImage:false,s3Link:'old-s3'}],legal:[],replace:false,loseAck:false};
 const fetcher=async(url,init)=>{const path=new URL(url).pathname,entry={path,method:init.method};calls.push(entry);let value;
  if(path.endsWith('/drafts'))value=[{docId:2362997,status:'UNFINISHED',scope:state.body.scope}];
  else if(path.endsWith('/register-requested'))value=[];
  else if(path.includes('/get-by-id/'))value={...plain(state.body),status:'UNFINISHED'};
  else if(path.includes('/get-images-by-id/'))value=plain(state.images);
  else if(path.includes('/get-files-by-type/'))value=plain(state.legal);
  else if(path.includes('/upload-images/')){assert.equal(new URL(url).search,'?imageType=DETAIL');const entries=[...init.body.entries()];assert.deepEqual(entries.map(([name,file])=>[name,file.name]),[['additionalImageFiles','new-detail.png']]);assert.deepEqual(Buffer.from(await entries[0][1].arrayBuffer()),bytes);value=[{imageName:'new-detail.png',imageUrl:'/stored/new-detail.png',mainImage:false,s3Link:'new-s3'}];state.images=state.replace?value:[...state.images,...value];if(state.loseAck)throw Error('ACK lost');}
  else if(path.endsWith('/update')){state.body=JSON.parse(init.body);value={code:200};}
  else if(path.includes('/validate-step/'))value={code:200,data:[{success:true}]};
  else assert.fail('unexpected request '+path);
  const response=Response.json(value);Object.defineProperty(response,'url',{value:url});return response;
 };
 const context=vm.createContext({location:new URL('https://supplier.coupang.com/dashboard/KR'),document:{documentElement:root,body:{innerText:'Company Code: A01526306'}},sessionStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)},fetch:fetcher,crypto:webcrypto,AbortController,TextEncoder,TextDecoder,Uint8Array,URL,FormData,File,atob,setTimeout,clearTimeout});
 const run=extra=>vm.runInContext('('+nativeDraftDetailAmendmentPage.toString()+')('+JSON.stringify({parentBinding,parentRecord,docId:2362997,amendmentId,...extra})+')',context).then(plain);
 const writes=()=>calls.filter(call=>call.method==='POST'&&!call.path.includes('/get-files-by-type/'));
 return{root,parentBinding,parentRecord,state,calls,part,stored,run,writes};
}
test('actual amendment page appends only new DETAIL, preserves old descriptors, updates once and validates ordered',async()=>{
 const f=fixture(),before=await f.run({action:'read'}),old=f.root.dataset.yoofamSingleDocumentRecords;
 const uploaded=await f.run({action:'upload',parts:[f.part],operationId:requestId+':amend:'+amendmentId+':assets:DETAIL',expectedRemote:before.remote});
 assert.equal(uploaded.ledger.state,'files-saved');assert.deepEqual(uploaded.remote.images[0],before.remote.images[0]);
 const body=plain(f.state.body);body.jsonDocument[0].imagePage.details.detailedImage='new-detail.png';
 const updated=await f.run({action:'update',body,operationId:requestId+':amend:'+amendmentId+':update',expectedRemote:uploaded.remote});assert.equal(updated.ledger.state,'updated');
 for(const step of [2,3,4,5])await f.run({action:'validate',step,version:1,operationId:requestId+':amend:'+amendmentId+':validate:'+step,expectedRemote:updated.remote});
 await assert.rejects(f.run({action:'update',body,operationId:requestId+':amend:'+amendmentId+':update',expectedRemote:updated.remote}));
 assert.deepEqual(f.writes().map(row=>row.path),['/sr/draft/api/upload-images/2362997','/sr/draft/api/update',...['2','3','4','5'].map(step=>'/sr/qvt/api/validate-step/'+step)]);assert.equal(f.root.dataset.yoofamSingleDocumentRecords,old);
});
for(const mode of ['replace','loseAck'])test('actual '+mode+' upload cannot advance to body update or replay',async()=>{
 const f=fixture(),before=await f.run({action:'read'});f.state[mode]=true;await assert.rejects(f.run({action:'upload',parts:[f.part],operationId:requestId+':amend:'+amendmentId+':assets:DETAIL',expectedRemote:before.remote}));
 const observed=await f.run({action:'read'});assert.ok(['blocked','upload-requested'].includes(observed.ledger.state));await assert.rejects(f.run({action:'upload',parts:[f.part]}));assert.equal(f.writes().length,1);assert.equal(f.writes()[0].path,'/sr/draft/api/upload-images/2362997');
});
test('changed parent record and same-key remote metadata fail before upload',async()=>{
 for(const mode of ['parent','metadata']){const f=fixture(),before=await f.run({action:'read'});if(mode==='parent'){const records=JSON.parse(f.root.dataset.yoofamSingleDocumentRecords);records[f.parentBinding.packetDigest].state='submit-requested';f.root.dataset.yoofamSingleDocumentRecords=JSON.stringify(records);}else f.state.images[0].s3Link='outside-change';await assert.rejects(f.run({action:'upload',parts:[f.part],expectedRemote:before.remote}));assert.equal(f.writes().length,0);}
});
