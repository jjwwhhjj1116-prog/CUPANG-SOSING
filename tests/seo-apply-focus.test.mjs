import test from 'node:test';
import assert from 'node:assert/strict';
import {seoWorkspaceHarness} from './helpers/seo-workspace.mjs';
import {seoWorkspaceEditor, responseJson, deferred, nextVersion} from './helpers/seo-workspace-editor.mjs';
import {detailStageUI} from './helpers/option-detail-manual-edit.mjs';

async function savedResult(api){
 const before=await responseJson(await api.request());
 const view=await responseJson(await api.request('PATCH',{expectedProductVersion:before.productVersion,expectedContentRevision:before.content.revision,expectedOptionRevision:before.options.revision,
  seo:{title:'새로 저장된 초안'},optionNames:[{optionId:before.options.rows[0].id,value:'검토할 한국어 옵션'}]}));
 return {view,receipt:{scope:'all',productId:api.id,jobId:'synthetic-job',previousVersion:before.productVersion,productVersion:view.productVersion,contentRevision:view.content.revision,optionRevision:view.options.revision}};
}

for(const companyCode of ['A01464742','A01526306'])test(`SEO handoff waits for the exact fresh saved view, focuses once, and does not save (${companyCode})`,async()=>{
 const api=seoWorkspaceHarness({companyCode}),events=[],gate=deferred();let hold=false;
 const h=seoWorkspaceEditor(api,{dom:{'SEO 상품명':{scrollIntoView:value=>events.push(['scroll',value]),focus:value=>events.push(['focus',value])}},fetcher:async(url,init,route)=>{if(hold)await gate.promise;return route(url,init);}});
 try{
  await h.idle();const {view,receipt}=await savedResult(api),stored=api.stored(),writes=api.mutations.length;
  h.patch({focusAfterApply:receipt});await h.idle();assert.equal(events.length,0,'old saved inputs cannot receive the handoff');
  hold=true;h.patch({version:view.productVersion});await new Promise(resolve=>setImmediate(resolve));h.render();assert.equal(events.length,0,'await the saved GET rather than focus old values');
  gate.resolve();await h.idle();assert.deepEqual(JSON.parse(JSON.stringify(events)),[['scroll',{block:'center'}],['focus',{preventScroll:true}]]);
  assert.equal(h.input('SEO 상품명').props.value,'새로 저장된 초안');assert.equal(h.input('1번째 한국어 옵션명').props.value,'검토할 한국어 옵션');
  h.patch({focusAfterApply:structuredClone(receipt)});await h.idle();assert.equal(events.length,2,'duplicate render must not move focus again');
  assert.equal(h.calls.some(call=>call.method!=='GET'),false);assert.equal(api.mutations.length,writes);assert.deepEqual(api.stored(),stored);
 }finally{h.close();api.close();}
});

for(const mode of ['dirty','inactive','wrong-product','wrong-revision','future-clock'])test(`SEO handoff preserves editing and rejects ${mode}`,async()=>{
 const api=seoWorkspaceHarness(),events=[],h=seoWorkspaceEditor(api,{dom:{'SEO 상품명':{scrollIntoView:()=>events.push('scroll'),focus:()=>events.push('focus')}}});
 try{
  await h.idle();if(mode==='dirty')h.edit('SEO 상품명','사용자 미저장 입력');
  const {view,receipt}=await savedResult(api);
  if(mode==='wrong-product')receipt.productId='other';if(mode==='wrong-revision')receipt.optionRevision++;
  h.patch({version:mode==='future-clock'?nextVersion(view.productVersion):view.productVersion,focusAfterApply:receipt,...(mode==='inactive'?{active:false}:{})});await h.idle();
  assert.deepEqual(events,[]);if(mode==='dirty')assert.equal(h.input('SEO 상품명').props.value,'사용자 미저장 입력');
  if(mode==='inactive'){h.patch({active:true});await h.idle();assert.deepEqual(events,[],'leaving the stage cancels the handoff permanently');}
  if(mode==='dirty'){await h.click('입력 취소·저장본 다시 조회');assert.deepEqual(events,[],'discarding a later manual draft cannot revive an old focus request');}
  assert.equal(h.calls.some(call=>call.method!=='GET'),false);
 }finally{h.close();api.close();}
});

test('dashboard handoff is bound to owner, product, stage and source-clock incarnation',()=>{
 const h=detailStageUI({tab:'SEO',workspaceOwnerId:'owner-a'});
 try{
  const first=h.record('seo-workspace-generator'),productId=first.props.productId,previousVersion=first.props.version;
  const receipt={scope:'all',productId,jobId:'job',previousVersion,productVersion:nextVersion(previousVersion),contentRevision:1,optionRevision:2};
  first.props.onApplied(receipt);assert.deepEqual(JSON.parse(JSON.stringify(h.record('seo-workspace-editor').props.focusAfterApply)),receipt);
  const initialEditor=h.record('seo-workspace-editor').instance;
  h.render({product:{id:productId,updated_at:receipt.productVersion,image_keys:'[]'}});
  assert.deepEqual(JSON.parse(JSON.stringify(h.record('seo-workspace-editor').props.focusAfterApply)),receipt,'verified event survives only the expected saved clock refresh');
  assert.equal(h.record('seo-workspace-editor').instance,initialEditor);
  for(const patch of [{workspaceOwnerId:'owner-b'},{workspaceOwnerId:'owner-a'},{tab:'가격'},{tab:'SEO'},{product:{id:'other',updated_at:previousVersion,image_keys:'[]'}},{product:{id:productId,updated_at:previousVersion,image_keys:'[]'}}]){
   h.render(patch);h.record('seo-workspace-generator');first.props.onApplied(receipt);assert.equal(h.record('seo-workspace-editor').props.focusAfterApply,undefined,'stale owner/product/stage/clock callback stays rejected');
  }
  const current=h.record('seo-workspace-generator');current.props.onApplied({...receipt,scope:'options'});assert.equal(h.record('seo-workspace-editor').props.focusAfterApply,undefined);
  const clockOld=current.props.onApplied;h.render({product:{id:productId,updated_at:receipt.productVersion,image_keys:'[]'}});h.record('seo-workspace-generator');
  h.render({product:{id:productId,updated_at:previousVersion,image_keys:'[]'}});h.record('seo-workspace-generator');clockOld(receipt);assert.equal(h.record('seo-workspace-editor').props.focusAfterApply,undefined,'A-B-A clock does not revive an old callback');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),{saved:0,reads:0,uploads:0,submission:0});
 }finally{h.close();}
});
