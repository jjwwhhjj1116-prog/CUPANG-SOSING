import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {companies,manualEditFixture,plain,text,json} from './helpers/option-detail-manual-edit.mjs';

function pngPixels(bytes){
 const value=Buffer.from(bytes),parts=[];let offset=8,width,height;
 while(offset<value.length){const length=value.readUInt32BE(offset),name=value.toString('ascii',offset+4,offset+8),data=value.subarray(offset+8,offset+8+length);if(name==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);}if(name==='IDAT')parts.push(data);offset+=length+12;}
 const rows=inflateSync(Buffer.concat(parts)),stride=width*4;return{width,height,pixels:Array.from({length:height},(_,y)=>[...rows.subarray(y*(stride+1)+1,(y+1)*(stride+1))]).flat()};
}
for(const company of companies){
 test(`detail card manual edit reads bytes only, renders reviewed PNG and changes its exact final slot (${company.code})`,async()=>{
  const f=await manualEditFixture(company);try{
   const before=await f.read(),source=f.sourceSnapshot(),files=await f.fileSnapshot(),version=f.product().updated_at;
   const target=await f.openCard(2);assert.equal(target.sourceKey,f.keys[0]);assert.equal(target.quotationTarget.slotIndex,1);assert.equal(target.quotationTarget.fieldKey,'exact-detailImages');
   assert.deepEqual(plain(f.panel.calls.map(call=>call.action)),['source']);assert.equal(f.requests.filter(call=>call.path.startsWith(f.base+'/image-text')).length,1);
   assert.ok(f.requests.every(call=>call.method==='GET'));assert.equal(f.sourceSnapshot(),source);assert.deepEqual(await f.fileSnapshot(),files);assert.equal(f.product().updated_at,version);
   await f.panel.click('문구 영역 직접 추가');await f.panel.change('문구 1 영역 지우기','',true);await f.panel.change('문구 1 배경색','#234567');
   await f.panel.click('문구 영역 직접 추가');await f.panel.change('문구 2 한국어','수동');await f.panel.change('문구 2 x','1');await f.panel.change('문구 2 width','2');
   await f.panel.click('번역 이미지 미리보기');assert.deepEqual(plain(f.panel.calls.map(call=>call.action)),['source','preview']);
   const reviewed=f.panel.calls.at(-1),png=pngPixels(await(await f.client.renderFreeImageTranslation(reviewed.image,reviewed.rows,new AbortController().signal,reviewed.optionImageIds)).output.arrayBuffer());
   assert.equal(png.width,3);assert.equal(png.height,2);assert.deepEqual(png.pixels.slice(0,4),[35,69,103,255]);assert.ok(f.clientHarness.operations.some(op=>op[0]==='text'&&op[1]==='수동'));
   const staleApply=f.panel.button('검토한 번역 이미지 적용').props.onClick;f.panel.allowApply(false);await f.panel.click('검토한 번역 이미지 적용');assert.equal(f.requests.filter(call=>call.method==='POST').length,0);
   f.panel.allowApply(true);staleApply();await f.settlePanel();assert.equal(f.panel.saved,1,text(f.panel.render()));
   const after=await f.read(),applied=f.panel.calls.find(call=>call.action==='apply'),key=await f.client.expectedFreeImageOutputKey(applied.image),expected=[f.keys[2],key,f.keys[3]].join('\n'),overrides=plain(before.overrides);
   overrides.options[f.selected].detailImages=expected;overrides.options[f.selected]['exact-detailImages']=expected;
   assert.deepEqual(plain(after.overrides),overrides);assert.equal(after.revision,before.revision+1);assert.equal(after.contentRevision,before.contentRevision);assert.equal(after.optionRevision,before.optionRevision);
   assert.equal(after.resolved.rows.find(row=>row.optionId===f.selected).fields['exact-detailImages'].value,expected);assert.equal(f.sourceSnapshot(),source);
   const latestFiles=await f.fileSnapshot();assert.equal(latestFiles.size,files.size+1);for(const[oldKey,old]of files)assert.deepEqual(latestFiles.get(oldKey),old);
   assert.deepEqual([...f.h.objects.get(key)],Array.from(new Uint8Array(await applied.image.output.arrayBuffer())));assert.equal(f.requests.filter(call=>call.method==='POST').length,1);
   assert.equal(f.product().supplier_hub_status,'미전송');assert.deepEqual(f.h.network,f.intakeNetworkBaseline);
  }finally{f.close();}
 });
 test(`manual final-slot preview rejects reordered or concurrently changed source before attaching a file (${company.code})`,async()=>{
  for(const mode of ['order','other-option','source-version']){
   const f=await manualEditFixture(company);try{
    await f.openCard(2);await f.panel.click('문구 영역 직접 추가');await f.panel.change('문구 1 영역 지우기','',true);await f.panel.click('번역 이미지 미리보기');
    if(mode==='source-version'){
     const content=await json(await f.h.route(f.base+'/content'));await json(await f.h.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:content.content.revision,patch:{seo:{description:'동시에 검토한 합성 설명'}}}}));
    }else{
     const view=await f.read(),changes=mode==='order'?['detailImages','exact-detailImages'].map(fieldKey=>({optionId:f.selected,fieldKey,value:[f.keys[0],f.keys[2],f.keys[3]].join('\n')})):[{optionId:f.other,fieldKey:'searchTags',value:'동시 수정'}];
     await json(await f.h.route(f.qurl,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));
    }
    const baseline=f.snapshot(),files=await f.fileSnapshot();await f.panel.click('검토한 번역 이미지 적용');await f.settlePanel();assert.equal(f.panel.saved,0);assert.match(text(f.panel.render()),/변경|저장본|동일|연결|다시/);
    assert.equal(f.snapshot(),baseline);assert.deepEqual(await f.fileSnapshot(),files);assert.deepEqual(plain(f.panel.calls.map(call=>call.action)),['source','preview','apply']);assert.deepEqual(f.h.network,f.intakeNetworkBaseline);
   }finally{f.close();}
  }
 });
 test(`manual apply resumes a locked card refresh once and preserves dirty option drafts (${company.code})`,async()=>{
  const f=await manualEditFixture(company);try{
   await f.openCard(2);await f.panel.click('문구 영역 직접 추가');await f.panel.change('문구 1 영역 지우기','',true);await f.panel.click('번역 이미지 미리보기');
   await f.panel.click('검토한 번역 이미지 적용');await f.settlePanel();const latest=await f.read(),server=latest.resolved.rows.find(row=>row.optionId===f.selected).fields['exact-detailImages'].value.split('\n'),afterSave=f.snapshot(),files=await f.fileSnapshot(),initialReads=f.options.calls.length;
   f.options.disabled(true);f.options.source(latest.productVersion,'manual-result');await f.options.idle();assert.equal(f.options.calls.length,initialReads);assert.notEqual(f.options.ordered()[1],server[1]);
   f.options.disabled(false);await f.options.idle();assert.deepEqual(plain(f.options.ordered()),server);assert.equal(f.options.calls.length,initialReads+1);assert.equal(f.options.render().props['data-workspace-dirty'],false);
   f.options.disabled(true);await f.options.idle();f.options.disabled(false);await f.options.idle();assert.equal(f.options.calls.length,initialReads+1,'the current saved basis is not fetched on unrelated lock cycles');
   f.options.html('<p>편집 중인 직접 HTML</p>');f.options.disabled(true);f.options.source(latest.productVersion,'later-notification');await f.options.idle();f.options.disabled(false);await f.options.idle();
   assert.equal(f.options.calls.length,initialReads+1);assert.equal(f.options.render().props['data-workspace-dirty'],true);assert.equal(f.options.control('선택 옵션 상세 HTML').props.value,'<p>편집 중인 직접 HTML</p>');assert.deepEqual(plain(f.options.ordered()),server);
   assert.equal(f.snapshot(),afterSave);assert.deepEqual(await f.fileSnapshot(),files);assert.deepEqual(f.h.network,f.intakeNetworkBaseline);
  }finally{f.close();}
 });
}
