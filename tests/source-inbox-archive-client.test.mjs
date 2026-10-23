import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceReviewModule,reviewSourceFixture,sourceReviewHookFixture} from './helpers/source-review-intake.mjs';

const {sourceArchiveReference,readSourceArchiveReceipt,archiveSourceInboxItem}=sourceReviewModule('app/source-inbox-archive-client.ts');
const {before}=reviewSourceFixture(),plain=value=>JSON.parse(JSON.stringify(value)),turn=()=>new Promise(resolve=>setImmediate(resolve));
const receipt=(item=before)=>({ownerId:item.ownerId,company:plain(item.company),id:item.id,fingerprint:item.fingerprint,sourceUrl:item.snapshot.sourceUrl,
 previousRevision:item.revision,revision:item.revision+1,archived:true,archivedAt:'2026-10-23T01:00:00.000Z'});

test('one archive request sends only the exact selected capture tuple and accepts its complete durable acknowledgement',async()=>{
 const calls=[],checks=[],reference=sourceArchiveReference(before,before.ownerId,before.company),original=JSON.stringify(before);
 const result=await archiveSourceInboxItem(before,{ownerId:before.ownerId,company:before.company,signal:new AbortController().signal,assertCurrent:()=>checks.push('current'),fetcher:async(url,init)=>{calls.push({url,init});return Response.json(receipt());}});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/source-inbox');assert.equal(calls[0].init.method,'DELETE');assert.equal(calls[0].init.redirect,'error');
 assert.deepEqual(JSON.parse(calls[0].init.body),{expectedOwnerId:before.ownerId,id:before.id,expectedRevision:before.revision,expectedCompany:before.company,expectedFingerprint:before.fingerprint,expectedSourceUrl:before.snapshot.sourceUrl});
 assert.deepEqual(plain(result),receipt());assert.equal(checks.length,2);assert.equal(JSON.stringify(before),original);assert.equal(reference.revision,before.revision);
});

test('archive rejects changed identity, unsupported company, noncanonical URLs, old/extra ACK fields and revision jumps',()=>{
 const reference=sourceArchiveReference(before,before.ownerId,before.company);
 for(const patch of [{ownerId:'other'},{company:{code:'A01526306',name:'유앤채'}},{id:'invalid'},{fingerprint:'bad'},{revision:0},{archivedAt:'2026-10-22'},
  {snapshot:{...before.snapshot,sourceUrl:before.snapshot.sourceUrl+'?other=1'}}])assert.equal(sourceArchiveReference({...before,...patch},before.ownerId,before.company),null);
 for(const patch of [{ownerId:'other'},{id:'other'},{fingerprint:'b'.repeat(64)},{sourceUrl:before.snapshot.sourceUrl+'?other=1'},
  {company:{code:'A01526306',name:'유앤채'}},{previousRevision:0},{revision:3},{archived:false},{archivedAt:'bad'},{extra:true}])assert.throws(()=>readSourceArchiveReceipt({...receipt(),...patch},reference));
 assert.throws(()=>readSourceArchiveReceipt({ownerId:'owner',id:before.id,archived:true},reference),'a legacy/partial ACK cannot report a new strict archive as confirmed');
});

test('uncertain requests never retry and changed account or abort cannot publish a successful archive',async()=>{
 for(const mode of ['network','server','scope','abort']){
  let calls=0,current=true;const controller=new AbortController();
  await assert.rejects(()=>archiveSourceInboxItem(before,{ownerId:before.ownerId,company:before.company,signal:controller.signal,
   assertCurrent:()=>{if(!current)throw Error('scope changed');},fetcher:async()=>{calls++;if(mode==='network')throw Error('lost acknowledgement');if(mode==='server')return Response.json({error:'stale capture'},{status:409});if(mode==='scope')current=false;if(mode==='abort')controller.abort();return Response.json(receipt());}}));
  assert.equal(calls,1,mode);
 }
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(()=>archiveSourceInboxItem(before,{ownerId:before.ownerId,company:before.company,signal:controller.signal,assertCurrent(){},fetcher:async()=>{calls++;return Response.json(receipt());}}));assert.equal(calls,0);
});

test('verified archive removes only its own capture immediately and stale reads cannot resurrect it; an explicit newer restore may return',async()=>{
 const other={...structuredClone(before),id:'76400000-0000-4000-8000-000000000002',fingerprint:'b'.repeat(64),captureVersion:2},restored={...structuredClone(before),revision:3};
 let rows=[before,other],hold=false,release;
 const h=sourceReviewHookFixture(async()=>hold?new Promise(resolve=>{release=resolve;}):Response.json({ownerId:'owner',company:before.company,items:rows}));
 try{
  h.render();await turn();assert.equal(h.render().items.length,2);
  hold=true;h.event();const pending=h.calls.at(-1),old=h.render();assert.equal(old.acceptArchived(before,receipt()),true);
  assert.equal(pending.init.signal.aborted,true);assert.deepEqual(h.render().items.map(item=>item.id),[other.id]);
  release(Response.json({ownerId:'owner',company:before.company,items:[before,other]}));await turn();assert.deepEqual(h.render().items.map(item=>item.id),[other.id]);
  hold=false;h.render().reload();await turn();assert.deepEqual(h.render().items.map(item=>item.id),[other.id],'a subsequent stale server list also stays hidden');
  rows=[restored,other];h.render().reload();await turn();assert.deepEqual(h.render().items.map(item=>item.id),[before.id,other.id]);assert.equal(h.render().items[0].revision,3);
 }finally{h.close();}
});

test('forged archive acknowledgements and old account callbacks cannot remove a source or publish into the new owner',async()=>{
 const h=sourceReviewHookFixture(async()=>Response.json({ownerId:'owner',company:before.company,items:[before]}));
 try{
  h.render();await turn();const old=h.render();
  for(const patch of [{fingerprint:'b'.repeat(64)},{revision:3},{company:{code:'A01526306',name:'유앤채'}}])assert.equal(old.acceptArchived(before,{...receipt(),...patch}),false);
  assert.equal(h.render().items.length,1);h.owner('other',{passive:false});assert.equal(old.acceptArchived(before,receipt()),false);assert.equal(h.render(false).items.length,0);
 }finally{h.close();}
});

test('late review acknowledgements cannot undo a verified archive or enter the accepted-review append path',async()=>{
 const {before,saved}=reviewSourceFixture();let rows=[saved];
 const h=sourceReviewHookFixture(async()=>Response.json({ownerId:'owner',company:before.company,items:rows}));
 try{
  h.render();await turn();assert.equal(h.render().acceptArchived(saved,receipt(saved)),true);
  assert.equal(h.render().acceptReviewed(before,saved),false);assert.equal(h.render().items.length,0);
  h.render().reload();await turn();assert.equal(h.render().items.length,0,'stale GET cannot append the delayed review');
  const restored={...structuredClone(saved),revision:4},reviewed={...structuredClone(restored),revision:5};
  assert.equal(h.render().acceptReviewed(restored,reviewed),false,'a review ACK is not evidence of an explicit restore');
  rows=[restored];h.render().reload();await turn();assert.equal(h.render().items[0].revision,4);
  assert.equal(h.render().acceptReviewed(restored,reviewed),true,'after a fresh restored source is observed, normal review acknowledgement resumes');
 }finally{h.close();}
});
