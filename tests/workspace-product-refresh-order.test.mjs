import test from 'node:test';
import assert from 'node:assert/strict';
import {companies,workspaceRefreshFixture,workspaceRefreshUI,json} from './helpers/workspace-product-refresh.mjs';

const capture=async f=>({raw:f.retained(),files:await f.fileSnapshot()});
async function unchanged(f,before){assert.equal(f.retained(),before.raw);assert.equal(await f.fileSnapshot(),before.files);assert.deepEqual(f.network,[]);}
function sameVersion(actual,expected){assert.ok(actual);assert.equal(actual.updated_at,expected.updated_at);assert.equal(actual.content_summary.mainImageKey,expected.content_summary.mainImageKey);}

for(const company of companies)test(`two stage saves retain the newest product and unsaved editor input after the first success or failure arrives late (${company.code})`,async()=>{
 for(const failed of [false,true]){
  const f=await workspaceRefreshFixture(company);let ui;try{
   ui=await workspaceRefreshUI(f);await ui.settle();await ui.open();
   const firstSaved=await f.savePatch({seo:{title:company.name+' 첫 검토 저장'}});
   const list=ui.deferList(),detail=await ui.holdDetail();ui.notifySaved();await list.arrived;await ui.settle();
   const latest=await f.savePatch({assets:{main:[JSON.parse(firstSaved.image_keys)[1]],additional:[]}});
   ui.notifySaved();await ui.settle();sameVersion(ui.editor(),latest);sameVersion(ui.row(),latest);
   ui.editDraft('다음 단계에 작성 중인 미저장 입력');ui.setWorkspaceEdits({dirty:true});const before=await capture(f);
   if(failed){list.releaseFailure();detail.releaseFailure();}else{list.release();detail.release();}
   await ui.settle();sameVersion(ui.editor(),latest);sameVersion(ui.row(),latest);assert.equal(ui.draft(),'다음 단계에 작성 중인 미저장 입력');assert.deepEqual(ui.errors(),[]);
   await unchanged(f,before);
  }finally{ui?.close();f.close();}
 }
});

for(const company of companies)test(`latest failed refresh keeps its failure and last confirmed display when an earlier saved version arrives afterward (${company.code})`,async()=>{
 const f=await workspaceRefreshFixture(company);let ui;try{
  ui=await workspaceRefreshUI(f);await ui.settle();await ui.open();const confirmed=ui.editor();
  await f.savePatch({seo:{title:company.name+' 첫 저장'}});
  const firstList=ui.deferList(),firstDetail=await ui.holdDetail();ui.notifySaved();await firstList.arrived;await ui.settle();
  await f.savePatch({assets:{main:['owner/synthetic639-additional.png'],additional:[]}});
  const secondList=ui.deferList(),secondDetail=await ui.holdDetail();ui.notifySaved();await secondList.arrived;
  secondList.releaseFailure();secondDetail.releaseFailure();await ui.settle();assert.ok(ui.errors().some(value=>value.includes('합성 목록 조회 실패')));
  const before=await capture(f);firstList.release();firstDetail.release();await ui.settle();sameVersion(ui.editor(),confirmed);sameVersion(ui.row(),confirmed);
  assert.ok(ui.errors().some(value=>value.includes('합성 목록 조회 실패')));await unchanged(f,before);
 }finally{ui?.close();f.close();}
});

for(const company of companies)test(`initial product-list response cannot roll back the later queue refresh (${company.code})`,async()=>{
 const f=await workspaceRefreshFixture(company);let ui;try{
  ui=await workspaceRefreshUI(f,{initialListDeferred:true});await ui.settle();await ui.initial.arrived;
  const latest=await f.savePatch({seo:{title:company.name+' 대기열 작성 완료'}});
  await ui.click('＋ 상품 추가');ui.component('intake-queue-panel').onJobs([{id:'synthetic-640-complete',product_id:f.product.id}]);await ui.settle();sameVersion(ui.row(),latest);
  const before=await capture(f);ui.initial.release();await ui.settle();sameVersion(ui.row(),latest);await unchanged(f,before);
 }finally{ui?.close();f.close();}
});

for(const company of companies)test(`closed or newly navigated product workspaces never adopt the prior detail response (${company.code})`,async()=>{
 for(const navigate of ['closed','other','reopened']){
  const f=await workspaceRefreshFixture(company);let ui;try{
   const sibling=await f.addSibling();ui=await workspaceRefreshUI(f);await ui.settle();await ui.open();
   const list=ui.deferList(),detail=await ui.holdDetail();ui.notifySaved();await list.arrived;await ui.settle();await ui.click('×');
   const target=navigate==='other'?sibling.id:f.product.id;
   let latest;if(navigate!=='closed'){latest=await f.savePatch({seo:{title:'다시 연 상품의 저장값'}},target);await ui.open(target);ui.editDraft('다시 연 상품의 미저장 입력');}
   const before=await capture(f);list.release();detail.release();await ui.settle();
   if(navigate!=='closed'){sameVersion(ui.editor(),latest);assert.equal(ui.editor().id,target);assert.equal(ui.draft(),'다시 연 상품의 미저장 입력');}else assert.equal(ui.editor(),undefined);
   await unchanged(f,before);
  }finally{ui?.close();f.close();}
 }
});

for(const company of companies)test(`a direct reviewed price save remains newer than the already running workspace read (${company.code})`,async()=>{
 const f=await workspaceRefreshFixture(company);let ui;try{
  ui=await workspaceRefreshUI(f);await ui.settle();await ui.open();
  const list=ui.deferList(),detail=await ui.holdDetail();ui.notifySaved();await list.arrived;await ui.settle();
  const policy=f.load('app/pricing.ts').pricePolicy({...f.settings,exchangeRate:f.settings.exchangeRate+10});
  const options=await json(await f.route(f.base+'/options')),quotation=await json(await f.route(f.base+'/quotation-fields'));
  const rows=f.load('app/stage-two-pricing.ts').recalculateStageTwoRows(f.load('app/product-options.ts').optionInputs(options.options),policy);
  await json(await f.route(f.base+'/stage-two-pricing',{method:'POST',body:{expectedProductVersion:options.productVersion,expectedOptionRevision:options.options.revision,
   expectedQuotationRevision:quotation.revision,expectedInputFingerprint:quotation.inputFingerprint,policy,rows,changes:[],recalculate:true}}));
  ui.component('product-options-editor').onSaved();await ui.settle();const latest=await f.current();
  assert.equal(ui.editor().updated_at,latest.updated_at);assert.equal(ui.row().supply_price,latest.supply_price);
  const before=await capture(f);list.release();detail.release();await ui.settle();
  for(const product of [ui.editor(),ui.row()]){assert.equal(product.updated_at,latest.updated_at);assert.equal(product.supply_price,latest.supply_price);assert.equal(product.sale_price,latest.sale_price);}
  await unchanged(f,before);
 }finally{ui?.close();f.close();}
});
