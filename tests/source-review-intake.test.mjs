import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceReviewModule,reviewSourceFixture,reviewSourceUrl,sourceReviewHookFixture} from './helpers/source-review-intake.mjs';
const model=sourceReviewModule('app/source-review-intake.ts'),capture=sourceReviewModule('app/source-capture-selection.ts');
const plain=value=>JSON.parse(JSON.stringify(value)),turn=()=>new Promise(resolve=>setImmediate(resolve));

for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(company.code+': exact review ACK advances only unchanged explicit targets and preserves the queue inputs',()=>{
 const {before,saved}=reviewSourceFixture('owner',company),selected=capture.sourceCaptureSelection(before),profile={id:'category',revision:4,categoryPath:['기존 카테고리']};
 const row={id:'target',profile,url:reviewSourceUrl+'?spm=retained',features:'직접 특징',keywords:'직접 키워드',status:'error',message:'기존 메시지',sourceCapture:selected};
 const targets=[{rowId:row.id,sourceCapture:selected}],others=[{...row,id:'same-url-unselected'},{...row,id:'different-capture',sourceCapture:{...selected,captureId:'76400000-0000-4000-8000-000000000002'}}];
 const rows=[...others,row],updated=model.applyReviewedSourceToIntakeRows(rows,targets,before,saved);
 assert.equal(model.validateReviewedSourceTransition(before,saved,'owner'),true);assert.equal(model.validateReviewedSourceTransition(before,saved,'foreign'),false);
 assert.deepEqual(updated.map(value=>value.id),rows.map(value=>value.id));assert.equal(updated[0],others[0]);assert.equal(updated[1],others[1]);assert.equal(updated[2].profile,profile);
 assert.deepEqual(plain(updated[2]),{...plain(row),sourceCapture:{...plain(selected),revision:2}});assert.equal(row.sourceCapture.revision,1);assert.ok(Object.isFrozen(updated[2].sourceCapture));
 for(const patch of [{status:'saved'},{productId:'existing'},{forkJobId:'fork'},{pendingJobId:'pending'},{url:'https://detail.1688.com/offer/764000000002.html'},
  {sourceCapture:{...selected,revision:2}},{sourceCapture:{...selected,fingerprint:'b'.repeat(64)}}]){
  const changed=[{...row,...patch}];assert.equal(model.applyReviewedSourceToIntakeRows(changed,targets,before,saved),changed);
 }
 const newerBefore={...before,revision:3},newerSaved={...saved,revision:4};assert.equal(model.applyReviewedSourceToIntakeRows([row],targets,newerBefore,newerSaved)[0].sourceCapture.revision,4);
});

test('review ACK rejects owner, capture, fingerprint, company, revision jumps and immutable source changes',()=>{
 const {before,saved}=reviewSourceFixture();
 for(const patch of [{ownerId:'foreign'},{id:'76400000-0000-4000-8000-000000000002'},{fingerprint:'b'.repeat(64)},{company:{code:'A01526306',name:'유앤채'}},
  {revision:1},{revision:3},{revision:1.5},{archivedAt:'2026-10-20T01:00:00Z'},{receivedAt:'other'},{captureOriginId:'other'},{captureVersion:2},{reviewed:null},{issues:['옵션 원가']},
  {snapshot:{...saved.snapshot,title:'바뀐 최초 원문'}},{reviewed:{...saved.reviewed,description:'바뀐 최초 설명'}},
  {reviewed:{...saved.reviewed,options:[{...saved.reviewed.options[0],stock:2}]}},{reviewed:{...saved.reviewed,options:[{...saved.reviewed.options[0],currency:null}]}}]){
  assert.equal(model.validateReviewedSourceTransition(before,{...saved,...patch}),false,JSON.stringify(patch));
 }
});

test('explicit review ACK invalidates the old GET and immediately keeps the new revision through a stale refresh',async()=>{
 const {before,saved}=reviewSourceFixture(),pending=[];
 const h=sourceReviewHookFixture(()=>new Promise(resolve=>pending.push(resolve)));
 try{
  h.render();const old=h.calls[0];const handler=h.render().acceptReviewed;
  assert.equal(handler(before,saved),true);assert.equal(old.init.signal.aborted,true);assert.equal(h.render().items[0].revision,2);assert.equal(h.render().error,'');
  pending.shift()(Response.json({ownerId:'owner',items:[before]}));await turn();assert.equal(h.render().items[0].revision,2);
  h.render().reload();assert.equal(h.calls.length,2);pending.shift()(Response.json({ownerId:'owner',items:[before]}));await turn();assert.equal(h.render().items[0].revision,2);
  h.render().reload();pending.shift()(Response.json({ownerId:'owner',items:[saved]}));await turn();assert.equal(h.render().items[0].revision,2);
  assert.ok(h.calls.every(call=>call.url==='/api/source-inbox'&&!call.init.method));
  h.owner('other',{passive:false});assert.equal(handler(before,{...saved,revision:2}),false,'stale callback is invalid before owner effect cleanup');
  assert.equal(h.render().items.length,0);
 }finally{h.close();}
});

test('invalid or stale acknowledgements cannot replace a newer in-memory source',async()=>{
 const {before,saved}=reviewSourceFixture();const h=sourceReviewHookFixture(async()=>Response.json({ownerId:'owner',items:[{...saved,revision:3}]}));
 try{h.render();await turn();assert.equal(h.render().acceptReviewed(before,saved),false);assert.equal(h.render().items[0].revision,3);assert.equal(h.calls.length,1);
  assert.equal(h.render().acceptReviewed(before,{...saved,ownerId:'other'}),false);assert.equal(h.render().items[0].revision,3);
 }finally{h.close();}
});
