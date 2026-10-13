import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadFixture,downloadUI,companies,json} from './helpers/image-download-ui.mjs';
const plain=value=>JSON.parse(JSON.stringify(value));
for(const company of companies)test(`deleting one repeated visible detail position preserves the other position, other SKU HTML and source files (${company.companyCode})`,async()=>{
 const f=await downloadFixture(company);let ui;try{
  const content=(await json(await f.api.route(f.base+'/content'))).content;
  content.assets.detailTop.value=[f.keys[3]];
  f.api.sqlite.prepare('UPDATE product_content SET payload=?').run(JSON.stringify(content));
  await json(await f.api.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{detail:[f.keys[3],f.keys[5]]}}}}));
  let view=await json(await f.api.route(f.base+'/quotation-fields')),rows=view.resolved.rows.filter(row=>row.optionId),selected=rows[0],other=rows[1];
  view=await json(await f.api.route(f.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:other.optionId,fieldKey:'detailHtml',value:'<p>다른 옵션 직접 HTML</p>'},{optionId:other.optionId,fieldKey:'detailImages',value:f.keys[5]}]}}));
  const preserved=plain(view.overrides),source=f.api.sqlite.prepare('SELECT payload FROM product_content').get().payload,objects=new Map([...f.api.objects].map(([key,bytes])=>[key,bytes.slice()]));assert.equal(view.resolved.rows.find(row=>row.optionId===selected.optionId).fields.detailImages.value,[f.keys[3],f.keys[3],f.keys[5],f.keys[6]].join('\n'));
  ui=downloadUI('app/components/option-image-editor.tsx','OptionImageEditor',{productId:f.product.id,optionId:selected.optionId,version:view.productVersion,stage:'detail'},f.request);await ui.idle();await ui.click('상세 이미지 1 선택 제거');await ui.click('선택 옵션 이미지 저장');
  const saved=await json(await f.api.route(f.base+'/quotation-fields')),row=saved.resolved.rows.find(row=>row.optionId===selected.optionId);
  assert.equal(row.fields.detailImages.value,[f.keys[3],f.keys[5],f.keys[6]].join('\n'),'delete one visible position, rather than every occurrence of its file');assert.equal(row.fields.detailHtml.validationIssues.length,0);assert.equal(ui.saved.length,1);assert.deepEqual(plain(saved.overrides.common),preserved.common);assert.deepEqual(plain(saved.overrides.options[other.optionId]),preserved.options[other.optionId]);assert.equal(f.api.sqlite.prepare('SELECT payload FROM product_content').get().payload,source);for(const [key,bytes]of objects)assert.deepEqual(f.api.objects.get(key),bytes);
  const exported=await f.exportQuote(),detail=JSON.parse(new TextDecoder().decode(exported.archive.get('quotation-detail-content.json'))).rows.find(item=>item.optionId===selected.optionId),index=saved.resolved.rows.filter(item=>item.included).findIndex(item=>item.optionId===selected.optionId),images=JSON.parse(new TextDecoder().decode(exported.archive.get('quotation-fields.json'))).rows.find(item=>item.optionId===selected.optionId).fields.detailImages;
  assert.equal(detail.images.length,3);assert.equal(new Set(detail.images).size,3);assert.equal(exported.cells(index)[exported.fields.indexOf('detailImages')].split('\n').length,3);assert.ok(images);
 }finally{ui?.close();f.api.close();}
});
