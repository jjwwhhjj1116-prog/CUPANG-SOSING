import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, panel, nodes, plain } from './helpers/detail-workspace.mjs';

const composite=h=>nodes(h.render()).find(node=>node.type?.name==='DetailWorkspaceCompositePanel');
const capability=(events,label='prepare')=>({prepareSave:()=>events.push(label),saveDisabled:false,download:()=>events.push('download'),downloadDisabled:false});

test('primary Save seals a new collected composition then prepares its exact confirmed composite once',async()=>{
 const f=await fixture(),h=panel(f),events=[];let toolbar;
 h.set({primaryDetailTools:true,onCompositeToolbarActionsChange:next=>{toolbar=next;}});
 try{
  await h.idle();assert.ok(toolbar,'a new seed exposes the primary Save');assert.equal(toolbar.saveDisabled,false);assert.equal(f.calls.some(call=>call.method==='PUT'),false);
  toolbar.prepareSave();await h.idle();assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);assert.ok(f.workspace);assert.deepEqual(events,[]);
  const child=composite(h);assert.ok(child);const actions=capability(events);child.props.onToolbarActionsChange(actions);await h.idle();assert.deepEqual(events,['prepare']);
  h.render();await h.idle();assert.deepEqual(events,['prepare']);assert.equal(h.adopted.length,0);assert.deepEqual(plain(f.view),f.selection().view);
 }finally{h.close();}
});

test('dirty photos must be sealed before a new composite capability may consume the Save intent',async()=>{
 const f=await fixture(),h=panel(f),events=[];let toolbar;h.set({primaryDetailTools:true,onCompositeToolbarActionsChange:next=>{toolbar=next;}});
 try{
  await h.idle();await h.click('상세 구성 저장');const oldChild=composite(h),oldActions=capability(events,'old');oldChild.props.onToolbarActionsChange(oldActions);await h.idle();
  await h.click('작업 사진 2 아래로');toolbar.prepareSave();await h.idle();assert.equal(f.calls.filter(call=>call.method==='PUT').length,2);assert.deepEqual(events,[],'retired saved-composition action must not prepare new photos');
  const nextActions=capability(events,'new');composite(h).props.onToolbarActionsChange(nextActions);await h.idle();assert.deepEqual(events,['new']);
  oldChild.props.onToolbarActionsChange(null,oldActions);h.render();assert.ok(toolbar);assert.equal(toolbar.saveDisabled,false);
 }finally{h.close();}
});

test('an unknown composition store ACK keeps recovery and never advances to composite preparation',async()=>{
 const f=await fixture();let lost=true;const h=panel(f,async(url,init={})=>{const reply=await f.request(url,init);if(init.method==='PUT'&&lost){lost=false;throw Error('lost store ACK');}return reply;});let toolbar;
 h.set({primaryDetailTools:true,onCompositeToolbarActionsChange:next=>{toolbar=next;}});
 try{await h.idle();assert.ok(toolbar);toolbar.prepareSave();await h.idle();assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);assert.equal(composite(h),undefined);assert.ok(f.storage.size);assert.equal(toolbar.saveDisabled,true);assert.equal(h.button('보관 결과 확인').props.disabled,false);}
 finally{h.close();}
});

test('a retained toolbar cannot write after a stage/source ABA or unmount',async()=>{
 const f=await fixture(),h=panel(f);let toolbar;h.set({primaryDetailTools:true,onCompositeToolbarActionsChange:next=>{toolbar=next;}});
 try{await h.idle();const retired=toolbar;assert.ok(retired);h.set({stageActive:false});h.set({stageActive:true});await h.idle();retired.prepareSave();await h.idle();assert.equal(f.calls.filter(call=>call.method==='PUT').length,0);const current=toolbar;h.close();current.prepareSave();assert.equal(f.calls.filter(call=>call.method==='PUT').length,0);}
 finally{ /* already closed */ }
});

test('raw BODY Chinese translation seals the exact seed and forwards Chinese once',async()=>{
 const f=await fixture(),h=panel(f),events=[];let toolbar;h.set({primaryDetailTools:true,onImageBatchToolbarActionsChange:next=>{toolbar=next;}});
 try{
  await h.idle();assert.ok(toolbar,'raw BODY action is published for the new seed');assert.equal(toolbar.disabled,false);toolbar.prepare('zh');await h.idle();
  assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);const child=nodes(h.render()).find(node=>node.type?.name==='DetailWorkspaceImageBatchPanel');assert.ok(child);
  child.props.onToolbarActionsChange({prepare:language=>events.push(language),disabled:false});await h.idle();assert.deepEqual(events,['zh']);assert.equal(h.adopted.length,0);
  assert.deepEqual(child.props.saved.workspace.document.photos.map(photo=>photo.role),['top','body','body','bottom']);
 }finally{h.close();}
});

test('reviewable BODY previews fence sibling edits without disabling their own apply guard',async()=>{
 const f=await fixture(),h=panel(f);h.set({primaryDetailTools:true});
 try{await h.idle();await h.click('상세 구성 저장');const body=nodes(h.render()).find(node=>node.type?.name==='DetailWorkspaceImageBatchPanel');assert.ok(body);
  assert.equal(typeof body.props.onPendingChange,'function');body.props.onPendingChange(true);h.render();assert.equal(h.render().props['data-workspace-saving'],true);
  const current=nodes(h.render()).find(node=>node.type?.name==='DetailWorkspaceImageBatchPanel');assert.equal(current.props.disabled,false);assert.equal(current.props.beforeApply(),true);
  assert.equal(h.button('현재 구성 닫기').props.disabled,true);assert.equal(h.button('작업 사진 2 제거').props.disabled,true);
  current.props.onPendingChange(false);h.render();assert.equal(h.render().props['data-workspace-saving'],false);assert.equal(h.button('작업 사진 2 제거').props.disabled,false);
 }finally{h.close();}
});
