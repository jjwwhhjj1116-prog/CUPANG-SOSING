import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {companies,labelManualFixture,labelReferenceFixture,labelReferenceUI,plain,nodes,text} from './helpers/label-manual-edit.mjs';

for(const company of companies)test(`stage six manual label card prepares only its saved exact slot before editing (${company.code})`,async()=>{
 const f=await labelManualFixture(company);try{
  await f.references.idle();const before=await f.read(),snapshot=f.snapshot(),files=await f.fileSnapshot(),start=f.requests.length,target=await f.openCard();
  assert.equal(target.intent,'manual');assert.equal(target.sourceKey,f.keys[0]);assert.equal(target.role,'label');assert.equal(target.sourceLanguage,'zh');
  const saved=before.resolved.rows.find(row=>row.optionId===f.selected).fields.labelImages.value;
  assert.deepEqual(plain(target.quotationTarget),{kind:'quotation',profileId:f.profile.id,optionId:f.selected,input:'labelImages',fieldKey:'labelImages',slotIndex:1,revision:before.revision,inputFingerprint:before.inputFingerprint,optionRevision:before.optionRevision,value:saved});
  assert.equal(f.opened[0].length,5);assert.equal(f.opened[0][4],'manual');
  const entryReads=f.requests.slice(start),sourceReads=entryReads.filter(call=>call.path.startsWith(f.base+'/image-text?'));
  assert.equal(sourceReads.length,1);assert.equal(sourceReads[0].method,'GET');assert.equal(entryReads.filter(call=>call.path.startsWith('/api/files/')).length,1);assert.ok(entryReads.every(call=>call.method==='GET'));
  assert.deepEqual(plain(f.panel.calls.map(call=>call.action)),['source']);assert.equal(f.panel.button('문구 영역 직접 추가').props.disabled,false);assert.match(text(f.panel.render()),/이미지 편집/);
  const loaded=f.panel.calls[0];assert.equal(loaded.role,'label');assert.equal(loaded.key,f.keys[0]);assert.deepEqual(plain(loaded.quotationTarget),plain(target.quotationTarget));
  assert.equal(f.snapshot(),snapshot);assert.deepEqual(await f.fileSnapshot(),files);assert.deepEqual(f.h.network,f.networkBaseline);assert.equal(f.product().supplier_hub_status,'미전송');
  assert.equal(f.stageUI.calls.saved,0);assert.equal(f.stageUI.calls.uploads,0);assert.equal(f.stageUI.calls.submission,0);
  await f.settlePanel();assert.equal(f.panel.calls.length,1,'the same selected manual target does not prepare twice');
  const source=(await(await f.source('labelImages')).json()).source;assert.equal(source.sourceSha256,createHash('sha256').update(f.h.objects.get(f.keys[0])).digest('hex'));
 }finally{f.close();}
});

for(const company of companies)test(`manual label edits stay local until reviewed PNG apply replaces exactly one saved slot (${company.code})`,async()=>{
 const f=await labelManualFixture(company);try{
  const before=await f.read(),raw=f.sourceRows(),files=await f.fileSnapshot();await f.openCard();
  await f.panel.click('문구 영역 직접 추가');await f.panel.change('문구 1 영역 지우기','',true);await f.panel.change('문구 1 배경색','#234567');
  await f.panel.click('번역 이미지 미리보기');assert.ok(f.requests.every(call=>call.method==='GET'));assert.equal(f.sourceRows(),raw);assert.deepEqual(await f.fileSnapshot(),files);
  await f.panel.click('검토한 번역 이미지 적용');await f.settlePanel();assert.equal(f.panel.saved,1,text(f.panel.render()));
  const applied=f.panel.calls.find(call=>call.action==='apply'),key=await f.client.expectedFreeImageOutputKey(applied.image),after=await f.read(),expected=plain(before.overrides);
  expected.options[f.selected].labelImages=[f.keys[2],key,f.keys[3]].join('\n');assert.deepEqual(plain(after.overrides),expected);assert.equal(after.revision,before.revision+1);
  assert.equal(after.contentRevision,before.contentRevision);assert.equal(after.optionRevision,before.optionRevision);assert.equal(f.sourceRows(),raw);
  const latestFiles=await f.fileSnapshot();assert.equal(latestFiles.size,files.size+2);for(const[old,value]of files)assert.deepEqual(latestFiles.get(old),value);
  assert.deepEqual([...latestFiles.keys()].filter(value=>!files.has(value)).sort(),[key,key+'.edit.json'].sort());
  const stored=await f.h.load('app/free-image-edit-record.ts').readFreeImageEditRecord(f.h.bindings.FILES,'owner',f.id,key);
  assert.deepEqual(plain(stored.record.document),plain(applied.image.editDocument));assert.deepEqual(plain(stored.record.source.quotationTarget),plain(applied.image.source.quotationTarget));
  assert.equal(stored.documentSha256,createHash('sha256').update(JSON.stringify(plain(applied.image.editDocument))).digest('hex'));
  assert.deepEqual([...f.h.objects.get(key)],[...new Uint8Array(await applied.image.output.arrayBuffer())]);assert.equal(f.requests.filter(call=>call.method==='POST').length,1);
  assert.deepEqual(plain(f.panel.calls.map(call=>call.action)),['source','preview','apply']);assert.deepEqual(f.h.network,f.networkBaseline);assert.equal(f.product().supplier_hub_status,'미전송');
 }finally{f.close();}
});

for(const company of companies)test(`label Chinese and English actions keep translation selection without automatic manual preparation (${company.code})`,async()=>{
 const f=await labelManualFixture(company);try{await f.references.idle();const before=f.snapshot(),start=f.requests.length;
  for(const language of ['zh','en']){const target=await f.openCard(language==='zh'?2:1,language);assert.equal(target.intent,undefined);assert.equal(target.sourceLanguage,language);assert.equal(target.role,'label');assert.equal(f.opened.at(-1).length,4);}
  assert.equal(f.panel.calls.length,0);assert.equal(f.requests.slice(start).filter(call=>call.path.startsWith(f.base+'/image-text')).length,0);assert.equal(f.snapshot(),before);assert.deepEqual(f.h.network,f.networkBaseline);
 }finally{f.close();}
});

test('retained manual label actions preserve current dirty, pending, disabled, source, option and unmount guards',async()=>{
 const f=labelReferenceFixture(),opened=[],ui=labelReferenceUI(f,{profileId:'profile',onTranslate:(...args)=>opened.push(args)});try{
  await ui.idle();const old=ui.button('최종 라벨 2 문구 영역 편집').props.onClick;
  ui.patch({disabled:true});old();assert.equal(opened.length,0);ui.patch({disabled:false,beforeSave:()=>false});old();assert.equal(opened.length,0);
  ui.patch({beforeSave:()=>true});const exclude=ui.button('최종 라벨 1 견적에서 제외').props.onClick;exclude();old();assert.equal(opened.length,0,'same-tick draft choices cannot bypass the exact saved binding');
  await ui.click('선택 취소·저장 라벨 조회');const reload=ui.button('최종 라벨 저장본 조회').props.onClick;reload();old();assert.equal(opened.length,0,'in-flight reference read blocks the old manual callback');await ui.idle();
  ui.source(f.touch());old();await ui.idle();assert.equal(opened.length,0);ui.option('blue');old();assert.equal(opened.length,0);assert.equal(f.writes.length,0);ui.close();old();assert.equal(opened.length,0);assert.equal(ui.lateWrites,0);
 }finally{ui.close();}
 const common=labelReferenceFixture(),shared=labelReferenceUI(common,{optionId:null,onTranslate:()=>assert.fail('no unscoped manual target')});try{await shared.idle();assert.equal(nodes(shared.render()).filter(node=>/문구 영역 편집/.test(node.props?.['aria-label']??'')).length,0);}finally{shared.close();}
});

test('manual label source preparation cannot be redirected by retained parent callback after scope or dirty changes',async()=>{
 const f=await labelManualFixture(companies[0]);try{await f.references.idle();await f.openCard();const callback=f.stageUI.record('product-label-editor').props.onTranslate,args=f.opened[0],old=f.stageUI.record('free-image-translation-panel').props.translationTarget;
  f.stageUI.render({focusedOptionId:f.other});callback(...args);const hidden=f.stageUI.record('free-image-translation-panel');assert.equal(f.stageUI.visible(hidden),false,'a retained old selection never exposes a manual editor for the new option');
  f.stageUI.render({focusedOptionId:f.selected});const valid=f.stageUI.record('product-label-editor').props.onTranslate;
  const current=f.stageUI.record('free-image-translation-panel').props.translationTarget;
  valid(args[0],args[1],args[2],{...args[3],optionId:f.other},'manual');assert.deepEqual(plain(f.stageUI.record('free-image-translation-panel').props.translationTarget),plain(current));
  valid(args[0],args[1],args[2],{...args[3],profileId:'other-profile'},'manual');assert.deepEqual(plain(f.stageUI.record('free-image-translation-panel').props.translationTarget),plain(current));
  assert.equal(old.intent,'manual');assert.ok(f.requests.every(call=>call.method==='GET'));assert.equal(f.stageUI.calls.uploads,0);assert.equal(f.stageUI.calls.submission,0);
 }finally{f.close();}
});
