import test from 'node:test';
import assert from 'node:assert/strict';
import {companies,downloadFixture,downloadUI,nodes,json} from './helpers/image-download-ui.mjs';
for(const company of companies)test(`stage six downloads the exact already linked label after reopening, preserving nine rows and quotation (${company.companyCode})`,async()=>{
 const f=await downloadFixture(company);let ui;try{const view=await json(await f.api.route(f.base+'/quotation-fields')),option=view.resolved.rows.find(row=>row.optionId!==null),url=f.base+'/quotation-fields';
  await json(await f.api.route(url,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:option.optionId,fieldKey:'labelImages',value:[f.keys[7],f.keys[8]].join('\n')}]}}));
  const current=await json(await f.api.route(url));ui=downloadUI('app/components/product-label-editor.tsx','ProductLabelReferenceEditor',{productId:f.product.id,optionId:option.optionId,version:current.productVersion},f.request);await ui.idle();const before=f.retained(),bytes=f.originals();
  const links=nodes(ui.render()).filter(node=>node.type==='a'&&node.props.download);assert.equal(links.length,2,'stored final-reference images have downloads without generating a replacement');
  for(const [index,link]of links.entries()){assert.equal(link.props['aria-label'],`최종 라벨 ${index+1} 이미지 다운로드`);assert.equal(link.props.href,'/api/files/'+f.keys[7+index]);const response=await f.request(link.props.href);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(f.api.objects.get(f.keys[7+index])));}
  assert.equal(f.retained(),before);assert.equal(f.originals(),bytes);assert.equal(ui.saved.length,0);assert.ok(ui.requests.every(call=>!call.init?.method||call.init.method==='GET'));
 }finally{ui?.close();f.api.close();}
});
