import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const module={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/batch-board-feedback.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:module,Date,Object,JSON});
const {batchBoardSource,updateBatchBoardFeedback:update,projectBatchBoardFeedback:project}=module;
const ids=['seo','pricing','mainImage','additionalImages','detailImage','sizeChart','koreanLabel','quotation'],plain=value=>JSON.parse(JSON.stringify(value));
const product=()=>({id:'product-a',owner_id:'owner-a',updated_at:'2026-10-30T01:00:00.000Z',title:'中文',source_url:'https://source.test/a',image_keys:'["owner-a/original.png"]',content_summary:{seo:true,seoTitle:'한글 상품',mainImageKey:'owner-a/original.png',main:1,additional:0,detail:0,label:0,missingImages:false,stages:Object.fromEntries(ids.map(id=>[id,{state:id==='seo'?'complete':'pending',detail:'server '+id}]))}});
const run={id:'run-a',ownerId:'owner-a',stages:ids},scope={};
const start=(previous=null,attempt=1)=>update(previous,scope,run,['product-a'],{kind:'start',runId:run.id,attempt});
const event=(p,status='failed',id='mainImage',attempt=1)=>({kind:'stage',runId:run.id,attempt,productId:p.id,result:{id,status,message:'원래 추론 응답 미확정 · 결과 조회 필요',boardSource:batchBoardSource(p)}});

test('a current failed/running stage projects only its display status without mutating server completion or source data',()=>{
 const p=product(),before=plain(p),failed=update(start(),scope,run,[p.id],event(p)),rendered=project([p],'owner-a',scope,failed)[0];
 assert.equal(rendered.content_summary.stages.mainImage.state,'failed');assert.match(rendered.content_summary.stages.mainImage.detail,/미확정/);assert.equal(rendered.content_summary.stages.seo.state,'complete');assert.deepEqual(p,before);
 const running=update(failed,scope,run,[p.id],event(p,'running','detailImage'));assert.equal(project([p],'owner-a',scope,running)[0].content_summary.stages.detailImage.state,'running');
});
test('owner, source scope ABA, product version and source/image/name changes discard old display statuses',()=>{
 const p=product(),feedback=update(start(),scope,run,[p.id],event(p));
 assert.equal(project([p],'other',scope,feedback)[0],p);assert.equal(project([p],'owner-a',{},feedback)[0],p);
 for(const patch of [{owner_id:'other'},{updated_at:'2026-10-30T01:00:00.001Z'},{title:'new source'},{source_url:'https://source.test/b'},{image_keys:'["owner-a/replaced.png"]'},{content_summary:{...p.content_summary,seoTitle:'다른 한글 상품'}}]){
  const changed={...p,...patch};assert.equal(project([changed],'owner-a',scope,feedback)[0],changed);
 }
 const sameOwnerNewScope={};assert.equal(project([p],'owner-a',sameOwnerNewScope,feedback)[0],p);
});
test('completed, skipped and draft results only remove a session overlay and never invent saved completion',()=>{
 for(const status of ['complete','skipped','draft']){
  const p=product(),failed=update(start(),scope,run,[p.id],event(p)),next=update(failed,scope,run,[p.id],event(p,status));
  assert.equal(project([p],'owner-a',scope,next)[0],p);assert.equal(p.content_summary.stages.mainImage.state,'pending');
 }
});
test('retry generation clears previous failures and stale attempts cannot clear or replace the current attempt',()=>{
 const p=product(),first=update(start(),scope,run,[p.id],event(p)),second=start(first,2),running=update(second,scope,run,[p.id],event(p,'running','mainImage',2));
 assert.equal(Object.keys(second.entries).length,0);assert.equal(update(running,scope,run,[p.id],event(p,'complete')),running);
 assert.equal(update(running,scope,run,[p.id],{kind:'finish',runId:run.id,attempt:1}),running);
 assert.equal(update(running,scope,run,[p.id],{kind:'start',runId:run.id,attempt:1}),running);
 assert.equal(update(running,scope,run,[p.id],{...event(p),runId:'old-run'}),running);
});
test('closing a finished modal clears only running markers while preserving errors in its current source scope',()=>{
 const p=product(),failed=update(start(),scope,run,[p.id],event(p)),running=update(failed,scope,run,[p.id],event(p,'running','detailImage'));
 const finished=update(running,scope,run,[p.id],{kind:'finish',runId:run.id,attempt:1}),view=project([p],'owner-a',scope,finished)[0];
 assert.equal(view.content_summary.stages.mainImage.state,'failed');assert.equal(view.content_summary.stages.detailImage.state,'pending');
});
test('unknown product/stage, missing source proof and legacy missing summary cannot leak another job status',()=>{
 const p=product(),initial=start();assert.equal(update(initial,scope,run,[p.id],{...event(p),productId:'other'}),initial);
 assert.equal(update(initial,scope,{...run,stages:['seo']},[p.id],event(p)),initial,'the frozen start stage set is checked by its original feedback');
 const missing=event(p);delete missing.result.boardSource;assert.equal(project([p],'owner-a',scope,update(initial,scope,run,[p.id],missing))[0],p);
 const legacy={...p,content_summary:null},feedback=update(initial,scope,run,[p.id],event(p));assert.equal(project([legacy],'owner-a',scope,feedback)[0],legacy);
});
