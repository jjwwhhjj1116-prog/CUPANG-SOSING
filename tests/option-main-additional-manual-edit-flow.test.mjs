import test from 'node:test';
import assert from 'node:assert/strict';
import {companies,manualEditFixture,plain,text,json} from './helpers/option-detail-manual-edit.mjs';

for(const company of companies)for(const stage of ['main','additional']){
 test(`${stage} manual card applies/recover exact selected slot and automatically refreshes after the processing lock (${company.code})`,async()=>{
  for(const lostAck of [false,true]){
   const f=await manualEditFixture(company,{stage});try{
    const input=stage==='main'?'mainImage':'additionalImages',slot=stage==='main'?0:1,before=await f.read(),source=f.sourceSnapshot(),files=await f.fileSnapshot(),keys=before.resolved.rows.find(row=>row.optionId===f.selected).fields['exact-'+input].value.split('\n');
    const target=await f.openCard(2);assert.equal(target.role,stage);assert.equal(target.quotationTarget.input,input);assert.equal(target.quotationTarget.fieldKey,'exact-'+input);assert.equal(target.quotationTarget.slotIndex,slot);assert.equal(target.sourceKey,keys[slot]);
    assert.deepEqual(plain(f.panel.calls.map(call=>call.action)),['source']);assert.ok(f.requests.every(call=>call.method==='GET'));assert.equal(f.sourceSnapshot(),source);assert.deepEqual(await f.fileSnapshot(),files);
    if(stage==='main'){assert.notEqual(target.sourceKey,JSON.parse(f.h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id).payload).rows.find(row=>row.id===f.selected).imageKey,'edit final quotation rather than the preserved source option photo');}
    await f.panel.click('문구 영역 직접 추가');await f.panel.change('문구 1 영역 지우기','',true);await f.panel.change('문구 1 배경색','#345678');await f.panel.click('번역 이미지 미리보기');
    if(lostAck)f.panel.setApply((image,signal)=>f.client.applyFreeImageTranslation(image,signal,async(url,init)=>{const response=await f.transport(url,init);await response.clone().json();throw Error('synthetic applied PNG acknowledgement lost');}));
    f.options.disabled(true);await f.options.idle();await f.panel.click('검토한 번역 이미지 적용');await f.settlePanel();
    if(lostAck){assert.equal(f.panel.saved,0);assert.equal(f.panel.render().props['data-workspace-dirty'],'true');await f.panel.click('같은 결과의 저장 상태 다시 확인');await f.settlePanel();}
    assert.equal(f.panel.saved,1,text(f.panel.render()));const latest=await f.read(),image=f.panel.calls.find(call=>call.action==='apply').image,key=await f.client.expectedFreeImageOutputKey(image),expectedKeys=[...keys];expectedKeys[slot]=key;
    const overrides=plain(before.overrides);overrides.options[f.selected][input]=expectedKeys.join('\n');overrides.options[f.selected]['exact-'+input]=expectedKeys.join('\n');
    assert.deepEqual(plain(latest.overrides),overrides);assert.equal(latest.revision,before.revision+1);assert.equal(latest.contentRevision,before.contentRevision);assert.equal(latest.optionRevision,before.optionRevision);assert.equal(f.sourceSnapshot(),source);
    const count=f.requests.filter(call=>call.path.startsWith(f.qurl)).length;f.options.source(latest.productVersion,'manual-saved');await f.options.idle();assert.deepEqual(plain(f.options.ordered()),keys);f.options.disabled(false);await f.options.idle();
    assert.deepEqual(plain(f.options.ordered()),expectedKeys);assert.equal(f.requests.filter(call=>call.path.startsWith(f.qurl)).length,count+1);f.options.disabled(true);await f.options.idle();f.options.disabled(false);await f.options.idle();assert.equal(f.requests.filter(call=>call.path.startsWith(f.qurl)).length,count+1);
    const afterFiles=await f.fileSnapshot();assert.equal(afterFiles.size,files.size+2);for(const[oldKey,old]of files)assert.deepEqual(afterFiles.get(oldKey),old);assert.deepEqual([...f.h.objects.get(key)],Array.from(new Uint8Array(await image.output.arrayBuffer())));
    assert.deepEqual([...afterFiles.keys()].filter(value=>!files.has(value)).sort(),[key,key+'.edit.json'].sort());
    const stored=await f.h.load('app/free-image-edit-record.ts').readFreeImageEditRecord(f.h.bindings.FILES,'owner',f.id,key);
    assert.deepEqual(plain(stored.record.document),plain(image.editDocument));assert.deepEqual(plain(stored.record.source.quotationTarget),plain(image.source.quotationTarget));assert.equal(stored.record.result.bytes,image.output.size);
    assert.deepEqual(plain(f.panel.calls.map(call=>call.action)),lostAck?['source','preview','apply','recover']:['source','preview','apply']);assert.equal(f.requests.filter(call=>call.method==='POST').length,lostAck?2:1);
    assert.equal(f.product().supplier_hub_status,'미전송');assert.deepEqual(f.h.network,f.intakeNetworkBaseline);
   }finally{f.close();}
  }
 });
 test(`${stage} manual preview rejects another option/version or changed exact slot before writing (${company.code})`,async()=>{
  for(const mode of ['slot','other-option','version']){
   const f=await manualEditFixture(company,{stage});try{
    await f.openCard(2);await f.panel.click('문구 영역 직접 추가');await f.panel.change('문구 1 영역 지우기','',true);await f.panel.click('번역 이미지 미리보기');
    if(mode==='version'){const content=await json(await f.h.route(f.base+'/content'));await json(await f.h.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:content.content.revision,patch:{seo:{description:'새 검토 설명'}}}}));}
    else{const view=await f.read(),input=stage==='main'?'mainImage':'additionalImages',value=stage==='main'?f.keys[2]:[f.keys[0],f.keys[2],f.keys[3]].join('\n'),changes=mode==='slot'?[input,'exact-'+input].map(fieldKey=>({optionId:f.selected,fieldKey,value})):[{optionId:f.other,fieldKey:'searchTags',value:'다른 옵션 수동 검토'}];await json(await f.h.route(f.qurl,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));}
    const baseline=f.snapshot(),files=await f.fileSnapshot();await f.panel.click('검토한 번역 이미지 적용');await f.settlePanel();assert.equal(f.panel.saved,0);assert.match(text(f.panel.render()),/변경|저장본|동일|연결|다시/);assert.equal(f.snapshot(),baseline);assert.deepEqual(await f.fileSnapshot(),files);assert.deepEqual(f.h.network,f.intakeNetworkBaseline);
   }finally{f.close();}
  }
 });
}
