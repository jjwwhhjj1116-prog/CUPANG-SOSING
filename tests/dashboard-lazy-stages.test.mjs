import test from 'node:test';
import assert from 'node:assert/strict';
import {detailStageUI,nodes,text} from './helpers/option-detail-manual-edit.mjs';
import {apiFixture} from './helpers/supplier-hub-single-projection.mjs';

test('initial main stage does not run real unvisited image, label, notice or translation GETs',async()=>{
 const f=await apiFixture(),reads=[];let h;
 try{
  const product=await f.h.load('db/queries.ts').findProduct('owner',f.id),view=await(await f.h.route(f.base+'/quotation-fields'+f.query)).json(),option=view.resolved.rows.find(row=>row.optionId&&row.included).optionId,before=f.state();
  h=detailStageUI({tab:'대표 이미지',product,workspaceOwnerId:'owner',preferredProfileId:f.profile.id,focusedOptionId:option},{components:Object.fromEntries(['option-image-editor','option-label-editor','product-label-editor','translation-panel'].map(name=>[name,'app/components/'+name+'.tsx'])),async fetch(url,init={}){reads.push({url,method:init.method??'GET'});return f.h.route(url);}});
  for(let i=0;i<15;i++){await new Promise(resolve=>setImmediate(resolve));h.render();}
  assert.deepEqual(reads,[]);assert.equal(f.state(),before);assert.equal(f.h.aiSources.length,0);assert.deepEqual(f.h.network,[]);
  h.render({tab:'추가 이미지'});for(let i=0;i<15;i++){await new Promise(resolve=>setImmediate(resolve));h.render();}
  assert.deepEqual(reads,[{url:f.base+'/quotation-fields'+f.query,method:'GET'},{url:f.base+'/content',method:'GET'},{url:f.base+'/options',method:'GET'}]);assert.equal(f.state(),before);assert.equal(f.h.aiSources.length,0);
 }finally{h?.close();f.close();}
});

for(const [tab,expected]of [['대표 이미지','product-options-editor'],['추가 이미지','option-image-editor'],['상세 이미지','option-image-editor'],['표시사항','product-label-editor'],['SEO','seo-workspace-editor']])test(`${tab} mounts immediately while unrelated stages stay unvisited`,()=>{
 const h=detailStageUI({tab,workspaceOwnerId:'owner'});try{
  assert.equal(h.all(expected).length,1);assert.equal(h.all('option-label-editor').length,0);assert.equal(h.all('translation-panel').length,tab==='SEO'?1:0);assert.equal(h.all('size-chart-workspace').length,0);
  assert.equal(h.all('image-generation-panel').length,['대표 이미지','추가 이미지','상세 이미지'].includes(tab)?1:0);
 }finally{h.close();}
});

test('visited stage drafts and saving guards remain mounted across tabs, source updates and scope changes',()=>{
 const h=detailStageUI({tab:'대표 이미지',workspaceOwnerId:'owner'});try{
  h.render({tab:'추가 이미지'});const additional=h.record('option-image-editor',props=>props.stage==='additional');h.edit('option-image-editor','pending additional',props=>props.stage==='additional');
  h.render({tab:'상세 이미지'});const detail=h.record('option-image-editor',props=>props.stage==='detail');h.edit('option-image-editor','pending detail',props=>props.stage==='detail');
  h.render({tab:'표시사항'});const label=h.record('product-label-editor');h.edit('product-label-editor','pending label');
  for(const tab of ['SEO','가격','견적서','추가 이미지']){h.render({tab});assert.equal(h.record('option-image-editor',props=>props.stage==='additional').instance,additional.instance);assert.equal(h.record('option-image-editor',props=>props.stage==='detail').instance,detail.instance);assert.equal(h.record('product-label-editor').instance,label.instance);assert.equal(h.closeResult(),'cancel');}
  h.busy('product-label-editor',true);h.render({tab:'가격'});assert.equal(h.closeResult(),'busy');
  h.render({workspaceOwnerId:'other-owner'});assert.equal(h.all('option-image-editor').length,0);assert.equal(h.all('product-label-editor').length,0);assert.equal(additional.instance.mounted,false);
  h.render({tab:'상세 이미지'});assert.notEqual(h.record('option-image-editor',props=>props.stage==='detail').instance,detail.instance);
 }finally{h.close();}
});

test('label translation first opens on demand and an owner transition records both active label and translation visits',()=>{
 const h=detailStageUI({tab:'표시사항',workspaceOwnerId:'owner-a'}),toggle=()=>nodes(h.render()).find(node=>node.type==='button'&&text(node)==='한글 표시사항 번역');try{
  assert.equal(h.all('translation-panel').length,0);toggle().props.onClick();h.render();assert.equal(h.all('translation-panel').length,1);
  h.render({workspaceOwnerId:'owner-b'});const label=h.record('product-label-editor'),translation=h.record('translation-panel');h.edit('product-label-editor','owner-b label');h.edit('translation-panel','owner-b translation');
  toggle().props.onClick();h.render({tab:'대표 이미지'});assert.equal(h.record('product-label-editor').instance,label.instance);assert.equal(h.record('translation-panel').instance,translation.instance);assert.equal(h.closeResult(),'cancel');
 }finally{h.close();}
});

test('retained image apply callbacks still honor live company/source and processing guards after lazy navigation',()=>{
 let company='original';const h=detailStageUI({tab:'추가 이미지',workspaceOwnerId:'owner',onBeforeFreeImageApply:()=>company==='original'});try{
  const apply=h.record('free-image-translation-panel').props.beforeApply;assert.equal(apply(),true);h.render({tab:'표시사항'});company='changed';assert.equal(apply(),false);company='original';h.record('image-generation-panel').props.onBusyChange(true);assert.equal(apply(),false);assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),{saved:0,reads:0,uploads:0,submission:0});
 }finally{h.close();}
});
