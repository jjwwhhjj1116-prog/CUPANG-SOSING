import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {companies,manualEditFixture,plain,nodes,text} from './helpers/option-detail-manual-edit.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const company of companies)for(const stage of ['main','additional','detail'])test(`${stage} cropped PNG review/download, ACK recovery and exact final slot preserve originals (${company.code})`,async()=>{
 for(const lostAck of [false,true]){
  const f=await manualEditFixture(company,{stage});try{
   const input=stage==='main'?'mainImage':stage==='additional'?'additionalImages':'detailImages',slot=stage==='main'?0:1,before=await f.read(),source=f.sourceSnapshot(),files=await f.fileSnapshot(),keys=before.resolved.rows.find(row=>row.optionId===f.selected).fields['exact-'+input].value.split('\n');
   await f.openCard(2);await f.panel.change('이미지 잘라내기','',true);await f.panel.change('잘라내기 x','1');await f.panel.change('잘라내기 width','2');
   assert.equal(f.panel.render().props['data-workspace-dirty'],'true');assert.deepEqual(plain(f.panel.calls.map(call=>call.action)),['source']);
   await f.panel.click('번역 이미지 미리보기');await f.settlePanel();const preview=f.panel.calls.at(-1);assert.deepEqual(plain(preview.crop),{x:1,y:0,width:2,height:2});assert.deepEqual(plain(preview.rows),[]);
   const link=nodes(f.panel.render()).find(node=>node.type==='a'&&node.props['aria-label']==='편집 결과 PNG 다운로드'),event={prevented:false,preventDefault(){this.prevented=true;}};assert.ok(link);link.props.onClick(event);assert.equal(event.prevented,false);assert.match(link.props.download,/2x2\.png$/);assert.equal(f.requests.filter(call=>call.method!=='GET').length,0);
   const blob=f.panel.urls.find(item=>item.url===link.props.href).blob,bytes=Buffer.from(await blob.arrayBuffer());assert.equal(bytes.readUInt32BE(16),2);assert.equal(bytes.readUInt32BE(20),2);assert.equal(f.sourceSnapshot(),source);assert.deepEqual(await f.fileSnapshot(),files);
   if(lostAck)f.panel.setApply((image,signal)=>f.client.applyFreeImageTranslation(image,signal,async(url,init)=>{const response=await f.transport(url,init);await response.clone().json();throw Error('synthetic cropped final-slot ACK lost');}));
   f.options.disabled(true);await f.options.idle();await f.panel.click('검토한 번역 이미지 적용');await f.settlePanel();if(lostAck){assert.equal(f.panel.saved,0);await f.panel.click('같은 결과의 저장 상태 다시 확인');await f.settlePanel();}
   assert.equal(f.panel.saved,1,text(f.panel.render()));const image=f.panel.calls.find(call=>call.action==='apply').image,key=await f.client.expectedFreeImageOutputKey(image),latest=await f.read(),expectedKeys=[...keys];expectedKeys[slot]=key;
   assert.deepEqual(plain(image.crop),{x:1,y:0,width:2,height:2,sourceWidth:3,sourceHeight:2});assert.equal(image.source.width,3);assert.equal(image.source.height,2);assert.equal(image.width,2);assert.equal(image.height,2);
   const expected=plain(before.overrides);expected.options[f.selected][input]=expectedKeys.join('\n');expected.options[f.selected]['exact-'+input]=expectedKeys.join('\n');assert.deepEqual(plain(latest.overrides),expected);
   f.options.source(latest.productVersion,'crop-saved');await f.options.idle();f.options.disabled(false);await f.options.idle();assert.deepEqual(plain(f.options.ordered()),expectedKeys);
   assert.equal(f.sourceSnapshot(),source);const after=await f.fileSnapshot();assert.equal(after.size,files.size+1);for(const[oldKey,value]of files)assert.deepEqual(after.get(oldKey),value);
   const meta=(await f.h.bindings.FILES.head(key)).customMetadata;assert.equal(meta.imageWidth,'2');assert.equal(meta.imageHeight,'2');assert.equal(meta.freeImageCropSha256,sha(JSON.stringify(plain(image.crop))));assert.deepEqual(Buffer.from(f.h.objects.get(key)),bytes);
   assert.deepEqual(plain(f.panel.calls.map(call=>call.action)),lostAck?['source','preview','apply','recover']:['source','preview','apply']);assert.equal(f.requests.filter(call=>call.method==='POST').length,lostAck?2:1);assert.equal(f.product().supplier_hub_status,'미전송');assert.deepEqual(f.h.network,f.intakeNetworkBaseline);
  }finally{f.close();}
 }
});
