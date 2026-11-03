import test from 'node:test';
import assert from 'node:assert/strict';
import {detailStageUI,text} from './helpers/option-detail-manual-edit.mjs';
import {apiFixture} from './helpers/supplier-hub-single-projection.mjs';

test('real quotation panel performs no profile or quotation API read until Stage7 is opened',async()=>{
 const f=await apiFixture(),reads=[];
 const product=await f.h.load('db/queries.ts').findProduct('owner',f.id),unchanged=f.state();
 const h=detailStageUI({tab:'SEO',product,workspaceOwnerId:'owner',preferredProfileId:f.profile.id,focusedOptionId:undefined},{
  components:{'quotation-panel':'app/components/quotation-panel.tsx'},
  async fetch(url,init){reads.push({url,method:init?.method??'GET'});const response=url.startsWith('/api/category-profiles')
   ?await f.h.load('app/api/category-profiles/route.ts').GET(new Request('https://app.test'+url))
   :await f.h.route(url);assert.equal(response.status,200,await response.clone().text());return response;},
 });
 const settle=async()=>{for(let index=0;index<12;index++){await new Promise(resolve=>setImmediate(resolve));h.render();}};
 try{
  await settle();assert.deepEqual(reads,[],'SEO must not execute a hidden quotation resolver or read all profiles');
  h.render({tab:'견적서'});assert.equal(reads.length,2,'the first click starts the existing quotation panel immediately');
  await settle();assert.deepEqual(reads,[{url:'/api/category-profiles',method:'GET'},{url:f.base+'/quotation-fields',method:'GET'}]);
  assert.equal(h.all('quotation-fields-editor').length,1,text(h.render()));
  const editor=h.record('quotation-fields-editor');assert.equal(editor.props.profileId,f.profile.id);h.edit('quotation-fields-editor','pending quotation draft');
  for(const tab of ['SEO','추가 이미지','견적서']){h.render({tab});await settle();assert.equal(h.record('quotation-fields-editor').instance,editor.instance);assert.equal(h.record('quotation-fields-editor').draft,'pending quotation draft');}
  h.render({product:{...product,updated_at:'2026-11-03T03:00:00.000Z'}});await settle();const refreshed=h.record('quotation-fields-editor');
  assert.equal(refreshed.instance,editor.instance);assert.match(refreshed.props.refreshToken,/2026-11-03T03:00:00.000Z/);assert.equal(reads.length,2);
  assert.equal(f.state(),unchanged);assert.deepEqual(f.h.network,[]);assert.equal(f.h.objects.size,0);assert.equal(f.h.aiSources.length,0);
 }finally{h.close();f.close();}
});

test('opening SEO and other initial stages does not mount the hidden quotation workspace',()=>{
 const h=detailStageUI({tab:'SEO',workspaceOwnerId:'owner',preferredProfileId:undefined});try{
  for(const tab of ['SEO','가격','대표 이미지','추가 이미지','상세 이미지','표시사항']){
   h.render({tab});assert.equal(h.all('quotation-panel').length,0,tab+' must not start the quotation workspace');
  }
  assert.equal(h.record('option-image-editor',props=>props.stage==='additional').props.profileId,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),{saved:0,reads:0,uploads:0,submission:0});
 }finally{h.close();}
});

test('the first quotation click mounts immediately and keeps drafts and pending work across tabs and source refreshes',()=>{
 const target={optionId:'red',fieldId:'title'},h=detailStageUI({tab:'SEO',workspaceOwnerId:'owner',quotationTarget:target,quotationNavigationSequence:4});try{
  h.render({tab:'견적서'});const first=h.record('quotation-panel');
  assert.equal(h.visible(first),true);assert.equal(first.props.submissionActive,true);
  assert.deepEqual(first.props.navigationTarget,target);assert.equal(first.props.navigationSequence,4);
  h.edit('quotation-panel','unsaved quotation');
  for(const tab of ['SEO','가격','추가 이미지','표시사항','견적서']){
   h.render({tab});const retained=h.record('quotation-panel');
   assert.equal(retained.instance,first.instance);assert.equal(retained.draft,'unsaved quotation');
   assert.equal(retained.props.submissionActive,tab==='견적서');assert.equal(h.visible(retained),tab==='견적서');
   assert.equal(h.closeResult(),'cancel');
  }
  const product={...first.props.product,id:first.props.productId,updated_at:'2026-11-03T02:00:00.000Z',image_keys:'[]'};
  h.render({product,tab:'SEO'});const refreshed=h.record('quotation-panel');
  assert.equal(refreshed.instance,first.instance);assert.equal(refreshed.draft,'unsaved quotation');assert.match(refreshed.props.refreshToken,/2026-11-03T02:00:00.000Z/);
  h.busy('quotation-panel',true);h.render({tab:'견적서'});assert.equal(h.record('quotation-panel').instance,first.instance);assert.equal(h.closeResult(),'busy');
 }finally{h.close();}
});

test('quotation visits belong to the exact owner and product while an initial quotation target opens immediately',()=>{
 const h=detailStageUI({tab:'견적서',workspaceOwnerId:'owner-a'});try{
  const original=h.record('quotation-panel');h.edit('quotation-panel','owner-a draft');
  h.render({tab:'SEO',workspaceOwnerId:'owner-b'});assert.equal(h.all('quotation-panel').length,0);assert.equal(original.instance.mounted,false);
  h.render({tab:'견적서'});const otherOwner=h.record('quotation-panel');assert.notEqual(otherOwner.instance,original.instance);assert.equal(otherOwner.draft,'');
  h.render({tab:'SEO',product:{id:'other-product',title:'other',updated_at:'2026-11-03T02:00:00.000Z',image_keys:'[]'}});assert.equal(h.all('quotation-panel').length,0);assert.equal(otherOwner.instance.mounted,false);
  h.render({tab:'견적서'});const otherProduct=h.record('quotation-panel');assert.equal(otherProduct.props.productId,'other-product');assert.notEqual(otherProduct.instance,otherOwner.instance);
 }finally{h.close();}
});

for(const preferredProfileId of [undefined,'profile-a'])test(`initial and selected profile scopes survive lazy quotation entry (${preferredProfileId??'captured default'})`,()=>{
 const selected=[],h=detailStageUI({tab:'추가 이미지',workspaceOwnerId:'owner',preferredProfileId,onProfileSelected:id=>selected.push(id)});try{
  const image=()=>h.record('option-image-editor',props=>props.stage==='additional');
  assert.equal(image().props.profileId,preferredProfileId);assert.equal(h.all('quotation-panel').length,0);assert.deepEqual(selected,[]);
  h.render({tab:'견적서'});const panel=h.record('quotation-panel');assert.equal(panel.props.preferredProfileId,preferredProfileId);
  panel.props.onProfileChange('profile-b');h.render({tab:'추가 이미지'});assert.equal(image().props.profileId,'profile-b');assert.deepEqual(selected,['profile-b']);
  assert.equal(h.record('quotation-panel').instance,panel.instance);
 }finally{h.close();}
});
