import test from 'node:test';
import assert from 'node:assert/strict';
import {generalMainEntry} from './helpers/main-editor-general-entry.mjs';
const plain=value=>JSON.parse(JSON.stringify(value));

test('general product entry wires actual local main dropdown into manual, translation and processing targets',async()=>{
 const h=await generalMainEntry();try{
  const selected=h.ids[1];await h.select(selected);assert.equal(h.input().value,selected);
  assert.ok(h.button('최종 대표이미지 편집하기'),'manual edit belongs to the selected local option');
  assert.ok(h.button('최종 대표이미지 중국어 한국어 번역'),'translation belongs to the selected local option');
  assert.ok(h.button('최종 대표이미지 AI 처리'),'processing belongs to the selected local option');
  const before=h.calls.filter(call=>call.method!=='GET').length;
  await h.click('최종 대표이미지 편집하기');
  const editor=h.record('free-image-translation-panel'),target=plain(editor.translationTarget.quotationTarget);
  assert.equal(editor.active,true);assert.equal(editor.focusedOptionId,selected);
  assert.deepEqual(plain(editor.quotationContext),{profileId:h.profile.id,optionId:selected,input:'mainImage'});
  assert.equal(editor.translationTarget.intent,'manual');assert.equal(target.kind,'quotation');assert.equal(target.optionId,selected);assert.equal(target.profileId,h.profile.id);
  assert.equal(target.input,'mainImage');assert.equal(target.fieldKey,'mainImage');assert.equal(target.slotIndex,0);
  assert.equal(target.revision,h.view.revision);assert.equal(target.inputFingerprint,h.view.inputFingerprint);assert.equal(target.optionRevision,h.view.optionRevision);
  assert.equal(target.value,editor.translationTarget.sourceKey);assert.equal(h.input().disabled,true,'an open edit pins the local dropdown');
  assert.equal(h.calls.filter(call=>call.method!=='GET').length,before,'opening manual edit cannot start AI or save');
  await h.ui.React.act(async()=>editor.onCloseGuard(()=>true));await h.click('이미지 편집 닫기');
  assert.equal(h.record('free-image-translation-panel').active,false);assert.equal(h.input().disabled,false);
  await h.click('최종 대표이미지 중국어 한국어 번역');
  assert.equal(h.record('free-image-translation-panel').translationTarget.quotationTarget.optionId,selected);
  assert.equal(h.record('free-image-translation-panel').translationTarget.intent,undefined);
  await h.ui.React.act(async()=>h.record('free-image-translation-panel').onCloseGuard(()=>true));await h.click('이미지 편집 닫기');
  await h.configure();await h.click('최종 대표이미지 AI 처리');
  const process=h.record('image-generation-panel');assert.equal(process.processingTargetActive,true);
  assert.deepEqual(plain(process.processingTarget.quotationTarget),target);assert.equal(process.processingTarget.sourceKey,target.value);
  assert.equal(h.input().disabled,true,'a processing target pins the same local dropdown');
  assert.equal(h.calls.filter(call=>call.method!=='GET').length,before,'opening processing is not provider execution');
 }finally{await h.close();}
});

test('general main processing pins its captured target and cannot be replaced by a retained common-image callback',async()=>{
 const h=await generalMainEntry();try{
  const common=h.record('product-content-editor').onTranslateImage;
  await h.select(h.ids[1]);await h.configure();await h.click('최종 대표이미지 AI 처리');
  const first=h.record('image-generation-panel'),source=first.processingTarget.sourceKey;
  await h.ui.React.act(async()=>common(source,'zh','main'));await h.ui.settle();
  assert.equal(h.record('free-image-translation-panel').active,false,'a retained common tool cannot retarget an active selected-option operation');
  assert.equal(h.input().value,h.ids[1]);assert.equal(h.input().disabled,true);
  await h.ui.React.act(async()=>first.onCloseProcessingTarget());await h.ui.settle();assert.equal(h.input().disabled,false);
  await h.select(h.ids[0]);await h.configure();await h.click('최종 대표이미지 AI 처리');
  assert.equal(h.record('image-generation-panel').processingTarget.quotationTarget.optionId,h.ids[0]);
  assert.equal(first.beforeSelectedImageApply(),false,'an earlier selected result cannot apply during a later option operation');
  assert.equal(h.record('image-generation-panel').beforeSelectedImageApply(),true);
  assert.equal(h.calls.some(call=>call.method!=='GET'),false);
 }finally{await h.close();}
});

test('general main entry retains queryless profile identity instead of replacing it with the resolved profile id',async()=>{
 const h=await generalMainEntry();try{
  await h.render({preferredProfileId:undefined});await h.wait(()=>h.button('최종 대표이미지 편집하기')?.disabled===false);
  await h.select(h.ids[1]);await h.click('최종 대표이미지 편집하기');
  const editor=h.record('free-image-translation-panel');assert.equal(editor.active,true);
  assert.equal(editor.quotationContext.profileId,null);assert.equal(editor.translationTarget.quotationTarget.profileId,null);
  assert.equal(editor.focusedOptionId,h.ids[1]);assert.equal(h.calls.some(call=>call.method!=='GET'),false);
 }finally{await h.close();}
});

test('general main callbacks reject mismatched snapshots and retained owner, profile, source, version and stage ABA callbacks',async()=>{
 const h=await generalMainEntry();try{
  const optionId=h.ids[1],source=h.view.resolved.rows.find(row=>row.optionId===optionId).fields.mainImage.value;
  const target={kind:'quotation',profileId:h.profile.id,optionId,input:'mainImage',fieldKey:'mainImage',slotIndex:0,revision:h.view.revision,inputFingerprint:h.view.inputFingerprint,optionRevision:h.view.optionRevision,value:source};
  for(const patch of [{optionId:'missing'},{profileId:'other'},{input:'additionalImages'},{fieldKey:'other'},{slotIndex:1},{value:''},{revision:target.revision+1},{optionRevision:target.optionRevision+1},{inputFingerprint:'f'.repeat(64)}]){
   await h.ui.React.act(async()=>h.card().onEdit(source,'main',{...target,...patch},h.view));await h.ui.settle();
   assert.equal(h.record('free-image-translation-panel').active,false,JSON.stringify(patch));
  }
  for(const patch of [{workspaceOwnerId:'other'},{preferredProfileId:'other'},{product:{...h.product,source_url:h.product.source_url+'?changed=1'}},{product:{...h.product,updated_at:new Date(Date.parse(h.product.updated_at)+1).toISOString()}},{tab:'추가 이미지'}]){
   const old=h.card().onEdit;await h.render(patch);await h.render({workspaceOwnerId:'owner',preferredProfileId:h.profile.id,product:h.product,tab:'대표 이미지'});
   await h.ui.React.act(async()=>old(source,'main',target,h.view));await h.ui.settle();
   assert.equal(h.record('free-image-translation-panel').active,false,'retained main entry rejected after '+Object.keys(patch).join(','));
  }
  const old=h.card().onEdit;await h.ui.React.act(async()=>h.card().onSaved());await h.ui.settle();
  await h.ui.React.act(async()=>old(source,'main',target,h.view));await h.ui.settle();assert.equal(h.record('free-image-translation-panel').active,false,'an old quotation refresh epoch cannot reopen');
  assert.equal(h.calls.some(call=>call.method!=='GET'),false);
 }finally{await h.close();}
});
