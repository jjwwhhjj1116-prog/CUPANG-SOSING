import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {reviewFixture} from './helpers/selected-image-review.mjs';
const fixtureUrl=new URL('./dashboard-account-actions.test.mjs',import.meta.url),source=fs.readFileSync(fixtureUrl,'utf8'),ast=ts.createSourceFile(fixtureUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declarations=ast.statements.filter(statement=>ts.isVariableStatement(statement)||ts.isFunctionDeclaration(statement)).map(statement=>statement.getText(ast)).join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href));
const {harness}=vm.runInNewContext(declarations+'\n({harness})',{assert,fs,vm,ts,createRequire,URL,Response,Request,File,Blob,FormData,URLSearchParams,TextEncoder,TextDecoder,AbortController,AbortSignal,crypto,structuredClone,setImmediate,setTimeout,clearTimeout});
const feedback={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/batch-board-feedback.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:feedback,Date,Object,JSON});
const ids=['seo','pricing','mainImage','additionalImages','detailImage','sizeChart','koreanLabel','quotation'];
function fixture(){const h=harness();for(const p of h.products)p.content_summary={seo:false,seoTitle:null,mainImageKey:null,main:0,additional:0,detail:0,label:0,missingImages:false,stages:Object.fromEntries(ids.map(id=>[id,{state:'pending',detail:'server pending'}]))};return h;}
async function begin(h){h.component('registration-board').onSelected(new Set([h.products[0].id]));await h.click('작업 개시');const panel=h.component('batch-work-panel');panel.onActivity({kind:'start',runId:panel.runRequest.id,attempt:1});return panel;}
function emit(h,panel,status='failed',attempt=1,metadata=feedback.batchBoardSource(h.products[0])){panel.onActivity({kind:'stage',runId:panel.runRequest.id,attempt,productId:h.products[0].id,result:{id:'mainImage',status,message:'원래 이미지 Vision 응답 미확정',boardSource:metadata}});}
const current=h=>h.component('registration-board').products[0].content_summary.stages.mainImage;
test('real batch review opens exact second option and nonzero image slot in the existing manual editor without mutations',async()=>{
 const h=fixture();try{await h.settle();const r=reviewFixture(),product=h.products[0];r.scope.ownerId='test-owner';r.image.source.productId=product.id;r.image.source.sourceKey='test-owner/original.png';r.image.source.quotationTarget.value='test-owner/second.png\ntest-owner/original.png';r.view.imageKeys=['test-owner/second.png','test-owner/original.png'];for(const row of r.view.resolved.rows)row.fields.additionalImages.value=r.image.source.quotationTarget.value;
 const review=r.model.createSelectedImageReview(r.scope,r.view,r.image,'zh','배경 검토');assert.ok(review);product.image_keys=JSON.stringify(r.view.imageKeys);
 const panel=await begin(h);panel.onBusyChange(false);await h.settle();h.component('registration-board').onOpen(product,'추가 이미지');await h.settle();const oldMount=h.componentMount('free-image-translation-panel');
 h.setWorkspaceEdits({freeDirty:true});panel.onOpen(product.id,'추가 이미지',review);await h.settle();assert.equal(h.component('free-image-translation-panel').translationTarget,undefined);assert.ok(h.component('batch-work-panel'));
 h.setWorkspaceEdits({freeDirty:false});panel.onOpen(product.id,'추가 이미지',review);await h.settle();assert.equal(h.componentMount('free-image-translation-panel'),oldMount,'the same mounted product accepts the new explicit review');
 const editor=h.component('free-image-translation-panel');assert.ok(editor);assert.equal(editor.focusedOptionId,'second');assert.equal(editor.translationTarget.intent,'manual');assert.equal(editor.translationTarget.quotationTarget.slotIndex,1);assert.equal(editor.translationTarget.review.requestId,review.requestId);assert.equal(h.component('detail-image-edit-dialog').open,true);assert.ok(h.requests.every(call=>call.method==='GET'));
 }finally{h.close();}
});

test('real Dashboard shows current selected-stage errors after modal close and rejects retained late-success callbacks',async()=>{
 const h=fixture();try{await h.settle();const panel=await begin(h);emit(h,panel);assert.equal(current(h).state,'failed');assert.match(current(h).detail,/미확정/);
  panel.onActivity({kind:'finish',runId:panel.runRequest.id,attempt:1});panel.onBusyChange(false);await h.settle();assert.equal(current(h).state,'failed');await h.click('×');assert.equal(h.component('batch-work-panel'),undefined);assert.equal(current(h).state,'failed');
  emit(h,panel,'complete');assert.equal(current(h).state,'failed');assert.equal(h.products[0].content_summary.stages.mainImage.state,'pending');
 }finally{h.close();}
});
test('selection ABA and old owner callbacks cannot revive earlier board errors',async()=>{
 const h=fixture();try{await h.settle();const panel=await begin(h);emit(h,panel);assert.equal(current(h).state,'failed');panel.onBusyChange(false);await h.settle();
  h.component('registration-board').onSelected(new Set([h.products[1].id]));h.render();h.component('registration-board').onSelected(new Set([h.products[0].id]));h.render();assert.equal(current(h).state,'pending');emit(h,panel);assert.equal(current(h).state,'pending');
  for(const ownerId of ['other-owner','test-owner']){for(const p of h.products)p.owner_id=ownerId;h.setSettingsBody({settings:{brand:'계정의 저장 브랜드',exchangeRate:350},scope:{ownerId,company:{code:'A01526306',name:'유앤채'}}});h.switchOwner(ownerId);await h.settle();}
  emit(h,panel);assert.equal(current(h).state,'pending');assert.ok(h.requests.every(call=>call.method==='GET'));
 }finally{h.close();}
});
test('fresh verified own-save version can display the error after reload but changed source pixels discard it',async()=>{
 const h=fixture();try{await h.settle();const panel=await begin(h);const changedVersion='2026-10-30T02:00:00.000Z';h.products[0].updated_at=changedVersion;emit(h,panel);assert.equal(current(h).state,'pending','new metadata is not applied to stale board DTO');
  panel.onActivity({kind:'finish',runId:panel.runRequest.id,attempt:1});panel.onBusyChange(false);await h.settle();assert.equal(current(h).state,'failed','a fresh server DTO matches exact current source and version');
  h.products[0].updated_at='2026-10-30T02:00:00.001Z';h.products[0].image_keys='["test-owner/replaced.png"]';panel.onBusyChange(true);panel.onBusyChange(false);await h.settle();assert.equal(current(h).state,'pending');
 }finally{h.close();}
});
test('a settings save revokes an earlier board error even when the saved setting values are unchanged',async()=>{
 const h=fixture();try{await h.settle();const panel=await begin(h);emit(h,panel);panel.onActivity({kind:'finish',runId:panel.runRequest.id,attempt:1});panel.onBusyChange(false);await h.settle();await h.click('×');assert.equal(current(h).state,'failed');
  await h.click('⚙ 기본설정');await h.settle();const editor=h.component('workspace-settings-editor');assert.ok(editor);
  h.setSettingsPutReply(async()=>Response.json({settings:editor.value,scope:{ownerId:'test-owner',company:{code:'A01526306',name:'유앤채'}}}));await editor.onSave(editor.value);await h.settle();
  assert.equal(current(h).state,'pending');emit(h,panel);assert.equal(current(h).state,'pending');assert.equal(h.requests.filter(call=>call.method==='PUT').length,1);
 }finally{h.close();}
});
