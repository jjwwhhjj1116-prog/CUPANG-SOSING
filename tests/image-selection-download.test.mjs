import test from 'node:test';
import assert from 'node:assert/strict';
import {companies,downloadFixture,downloadUI,nodes,json,unzip} from './helpers/image-download-ui.mjs';

for(const company of companies)test(`stage five downloads its current edited sequence, original and translated bytes without saving (${company.companyCode})`,async()=>{
 const f=await downloadFixture(company);let ui;try{
  const translated='owner/reviewed-korean-detail.png',original=f.api.objects.get(f.keys[4]);await f.api.bindings.FILES.put(translated,new Uint8Array([...original,41]),{httpMetadata:{contentType:'image/png'}});
  await json(await f.api.route(f.base+'/attachments',{method:'POST',body:{key:translated,expectedVersion:f.product.updated_at,expectedContentRevision:(await json(await f.api.route(f.base+'/content'))).content.revision,role:null}}));
  const content=(await json(await f.api.route(f.base+'/content'))).content;
  await json(await f.api.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{detail:[f.keys[3],translated,f.keys[5]]}}}}));
  const product={...f.product,image_keys:JSON.stringify([...f.keys,translated]),updated_at:f.api.sqlite.prepare('SELECT updated_at FROM products').get().updated_at};
  ui=downloadUI('app/components/product-content-editor.tsx','ProductContentEditor',{product,section:'이미지',focusedAssetRole:'detail'},f.request);await ui.idle();
  const originalState=f.retained(),originalBytes=f.originals();
  await ui.click(`이미지 ${f.keys.length+1} 아래로`);await ui.click('이미지 4 상세에서 제외');
  await ui.click('상세 이미지 ZIP 다운로드');assert.equal(ui.downloads.length,1);const files=unzip(await ui.downloads[0].blob.arrayBuffer());
  assert.deepEqual([...files.keys()],['image-001.png','image-002.png','image-003.png','image-004.png']);
  for(const [index,key]of [f.keys[2],f.keys[5],translated,f.keys[6]].entries())assert.deepEqual(files.get(`image-${String(index+1).padStart(3,'0')}.png`),Buffer.from(f.api.objects.get(key)));
  assert.equal(f.retained(),originalState);assert.equal(f.originals(),originalBytes);assert.equal(ui.saved.length,0);assert.ok(ui.requests.every(call=>!call.init?.method||call.init.method==='GET'));
  await ui.click('상세 설명·이미지 저장');assert.equal(ui.saved.length,1);const stored=(await json(await f.api.route(f.base+'/content'))).content;
  assert.deepEqual(stored.assets.detail.value,[f.keys[5],translated]);assert.equal(stored.detail.description.value,'검토한 수동 상세 설명');for(const role of ['main','additional','label','size'])assert.deepEqual(stored.assets[role].value,({main:[f.keys[0]],additional:[f.keys[1]],label:[f.keys[7]],size:[f.keys[8]]})[role]);
  const exported=await f.exportQuote(),row=exported.document.rows.findIndex(row=>row.optionId!==null),expected=[f.keys[2],f.keys[5],translated,f.keys[6]];
  assert.equal(exported.cells(row)[exported.fields.indexOf('detailImages')],expected.map(key=>exported.document.uploadFilenames[key]).join('\n'));for(const key of expected)assert.deepEqual(Buffer.from(exported.archive.get('assets/'+exported.document.uploadFilenames[key])),Buffer.from(f.api.objects.get(key)));
  assert.deepEqual(Buffer.from(f.api.objects.get(f.keys[4])),Buffer.from(original));assert.ok(!f.api.network.some(host=>/couplus|supplier\.coupang/.test(host)));
 }finally{ui?.close();f.api.close();}
});

for(const company of companies)test(`legacy top/body shared images download in both visible positions after a normal API save (${company.companyCode})`,async()=>{
 const f=await downloadFixture(company);let ui;try{
  const current=(await json(await f.api.route(f.base+'/content'))).content;current.assets.detailTop.value=[f.keys[3]];
  // Model a previously stored sharing combination. The actual API allows its
  // preservation, while continuing to refuse new shared-role assignments.
  f.api.sqlite.prepare('UPDATE product_content SET payload=?').run(JSON.stringify(current));
  await json(await f.api.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:current.revision,patch:{detail:{description:'기존 공유 배치 수동 설명 저장'},assets:{detail:[f.keys[3],f.keys[5]]}}}}));
  const product={...f.product,updated_at:f.api.sqlite.prepare('SELECT updated_at FROM products').get().updated_at};ui=downloadUI('app/components/product-content-editor.tsx','ProductContentEditor',{product,section:'이미지',focusedAssetRole:'detail'},f.request);await ui.idle();const before=f.retained(),bytes=f.originals();
  await ui.click('상세 이미지 ZIP 다운로드');assert.equal(ui.downloads.length,1);const archive=unzip(await ui.downloads[0].blob.arrayBuffer());assert.equal(archive.size,4);for(const [index,key]of [f.keys[3],f.keys[3],f.keys[5],f.keys[6]].entries())assert.deepEqual(archive.get(`image-${String(index+1).padStart(3,'0')}.png`),Buffer.from(f.api.objects.get(key)));
  assert.equal(f.retained(),before);assert.equal(f.originals(),bytes);assert.equal(ui.saved.length,0);
 }finally{ui?.close();f.api.close();}
});

for(const company of companies)test(`an interrupted image download never produces a partial ZIP or changes the current selection (${company.companyCode})`,async()=>{
 const f=await downloadFixture(company);let ui;try{let failed=true;ui=downloadUI('app/components/product-content-editor.tsx','ProductContentEditor',{product:f.product,section:'이미지',focusedAssetRole:'detail'},(url,init)=>url.startsWith('/api/files/')&&url.endsWith(f.keys[4].split('/').at(-1))&&failed?Response.json({error:'synthetic file read interrupted'},{status:503}):f.request(url,init));await ui.idle();const before=f.retained(),bytes=f.originals();
  await ui.click('상세 이미지 ZIP 다운로드');assert.equal(ui.downloads.length,0);assert.equal(ui.blobs.size,0);assert.ok(nodes(ui.render()).some(node=>node.props?.role==='alert'));assert.equal(f.retained(),before);assert.equal(f.originals(),bytes);
  failed=false;await ui.click('상세 이미지 ZIP 다운로드');assert.equal(ui.downloads.length,1);assert.equal(unzip(await ui.downloads[0].blob.arrayBuffer()).size,5);assert.equal(f.retained(),before);assert.equal(f.originals(),bytes);
 }finally{ui?.close();f.api.close();}
});

test('selection archives preserve all 150 indexed entries and reject missing, foreign, unsupported or oversized reads',async()=>{
 const f=await downloadFixture(companies[0]);let ui;try{ui=downloadUI('app/components/product-content-editor.tsx','ProductContentEditor',{product:f.product,section:'이미지',focusedAssetRole:'detail'},f.request);await ui.idle();const archive=ui.load('app/image-selection-download.ts').imageSelectionArchive,signal=new AbortController().signal,before=f.retained(),bytes=f.originals();
  const maximum=Array(150).fill(f.keys[3]);assert.equal(unzip(await archive(maximum,f.keys,signal,f.request)).size,150);let reads=0;await assert.rejects(archive([...maximum,f.keys[3]],f.keys,signal,async()=>{reads++;throw Error('must not fetch');}));assert.equal(reads,0);
  await assert.rejects(archive([f.keys[3],'owner/absent.png'],f.keys,signal,async()=>{reads++;throw Error('must not fetch');}));assert.equal(reads,0);
  await assert.rejects(archive(['other/image.png'],['other/image.png'],signal,f.request),/내려받지/);assert.equal(f.calls.at(-1).url,'/api/files/other/image.png');
  await assert.rejects(archive([f.keys[3]],f.keys,signal,async()=>new Response('<html>login screen</html>',{headers:{'content-type':'text/html'}})),/이미지/);
  await assert.rejects(archive([f.keys[3]],f.keys,signal,async()=>new Response('small body',{headers:{'content-type':'image/png','content-length':String(10*1024*1024+1)}})),/10MB/);
  assert.equal(f.retained(),before);assert.equal(f.originals(),bytes);assert.equal(ui.downloads.length,0);
 }finally{ui?.close();f.api.close();}
});

test('the actual content API maximum of top plus thirty body plus bottom remains downloadable for both companies',async()=>{
 for(const company of companies){const f=await downloadFixture(company);let ui;try{const body=f.keys.slice(3,6),source=f.api.objects.get(f.keys[3]);for(let index=0;index<27;index++){const key=`owner/download-limit-${index}.png`;await f.api.bindings.FILES.put(key,new Uint8Array([...source,index]),{httpMetadata:{contentType:'image/png'}});body.push(key);}
  const pool=[...f.keys,...body.filter(key=>!f.keys.includes(key))];f.api.sqlite.prepare('UPDATE products SET image_keys=?').run(JSON.stringify(pool));const content=(await json(await f.api.route(f.base+'/content'))).content;
  await json(await f.api.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{detail:body}}}}));
  ui=downloadUI('app/components/product-content-editor.tsx','ProductContentEditor',{product:{...f.product,image_keys:JSON.stringify(pool),updated_at:f.api.sqlite.prepare('SELECT updated_at FROM products').get().updated_at},section:'이미지',focusedAssetRole:'detail'},f.request);await ui.idle();const before=f.retained(),bytes=f.originals();await ui.click('상세 이미지 ZIP 다운로드');const archive=unzip(await ui.downloads[0].blob.arrayBuffer());assert.equal(archive.size,32);for(const [index,key]of [f.keys[2],...body,f.keys[6]].entries())assert.deepEqual(archive.get(`image-${String(index+1).padStart(3,'0')}.png`),Buffer.from(f.api.objects.get(key)));assert.equal(f.retained(),before);assert.equal(f.originals(),bytes);
 }finally{ui?.close();f.api.close();}}
});

for(const company of companies)test(`option detail download follows original, translated and manually removed slots only (${company.companyCode})`,async()=>{
 const f=await downloadFixture(company);let ui;try{
  const translated='owner/reviewed-option-korean-detail.png',original=f.api.objects.get(f.keys[4]);await f.api.bindings.FILES.put(translated,new Uint8Array([...original,42]),{httpMetadata:{contentType:'image/png'}});
  const content=(await json(await f.api.route(f.base+'/content'))).content;
  await json(await f.api.route(f.base+'/attachments',{method:'POST',body:{key:translated,expectedVersion:f.product.updated_at,expectedContentRevision:content.revision,role:null}}));
  const qurl=f.base+'/quotation-fields',view=await json(await f.api.route(qurl)),option=view.resolved.rows.find(row=>row.optionId!==null);
  await json(await f.api.route(qurl,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:option.optionId,fieldKey:'detailImages',value:[f.keys[3],translated,f.keys[5]].join('\n')},{optionId:option.optionId,fieldKey:'detailHtml',value:'<p>수동 상세 HTML 보존</p>'}]}}));
  let approved=false;const confirmations=[];
  const current=await json(await f.api.route(qurl));ui=downloadUI('app/components/option-image-editor.tsx','OptionImageEditor',{productId:f.product.id,optionId:option.optionId,version:current.productVersion,stage:'detail'},f.request,{confirm:message=>{confirmations.push(message);return approved;}});await ui.idle();
  const before=f.retained(),bytes=f.originals();await ui.click('상세 이미지 1 아래로 이동');await ui.click('상세 이미지 2 선택 제거');await ui.click('상세 이미지 ZIP 다운로드');
  const cancelled=unzip(await ui.downloads[0].blob.arrayBuffer());assert.deepEqual([...cancelled.keys()],['image-001.png','image-002.png','image-003.png']);
  for(const [index,key]of [translated,f.keys[3],f.keys[5]].entries())assert.deepEqual(cancelled.get(`image-${String(index+1).padStart(3,'0')}.png`),Buffer.from(f.api.objects.get(key)));
  assert.equal(f.retained(),before);assert.equal(f.originals(),bytes);assert.ok(ui.requests.every(call=>!call.init?.method||call.init.method==='GET'));
  approved=true;await ui.click('상세 이미지 2 선택 제거');await ui.click('상세 이미지 ZIP 다운로드');
  const files=unzip(await ui.downloads[1].blob.arrayBuffer());assert.deepEqual([...files.keys()],['image-001.png','image-002.png']);assert.deepEqual(files.get('image-001.png'),Buffer.from(f.api.objects.get(translated)));assert.deepEqual(files.get('image-002.png'),Buffer.from(f.api.objects.get(f.keys[5])));assert.deepEqual(confirmations,['이 이미지를 삭제하시겠습니까?','이 이미지를 삭제하시겠습니까?']);
  assert.equal(f.retained(),before);assert.equal(f.originals(),bytes);assert.equal(nodes(ui.render()).find(node=>node.props['aria-label']==='선택 옵션 상세 HTML').props.value,'<p>수동 상세 HTML 보존</p>');
  await ui.click('선택 옵션 이미지 저장');const saved=await json(await f.api.route(qurl));assert.equal(saved.resolved.rows.find(row=>row.optionId===option.optionId).fields.detailImages.value,[translated,f.keys[5]].join('\n'));assert.deepEqual(saved.overrides.common,current.overrides.common);for(const row of current.resolved.rows)if(row.optionId!==option.optionId)assert.deepEqual(saved.resolved.rows.find(item=>item.optionId===row.optionId).fields,row.fields);
  const exported=await f.exportQuote(),index=exported.document.rows.findIndex(row=>row.optionId===option.optionId),cells=exported.cells(index);assert.equal(cells[exported.fields.indexOf('detailImages')],[translated,f.keys[5]].map(key=>exported.document.uploadFilenames[key]).join('\n'));assert.equal(cells[exported.fields.indexOf('detailHtml')],'<p>수동 상세 HTML 보존</p>');
 }finally{ui?.close();f.api.close();}
});
