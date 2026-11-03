import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import {pathToFileURL} from 'node:url';

// Reuse real API/SQLite and the existing focused editor hook fixture. Only
// synthetic source and product rows are used; all external calls are mocked.
const fixturePath='tests/option-main-image-editor.test.mjs',fixtureURL=pathToFileURL(process.cwd()+'/'+fixturePath),fixtureText=fs.readFileSync(fixtureURL,'utf8'),ast=ts.createSourceFile(fixturePath,fixtureText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const nodes=ast.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)&&['fixture','editor'].includes(node.name?.text));
const source=nodes.map(node=>{let text=node.getFullText(ast);if(ts.isImportDeclaration(node)){const name=node.moduleSpecifier.text;if(!name.startsWith('node:'))text=text.replace("'"+name+"'",JSON.stringify(name.startsWith('.')?new URL(name,fixtureURL).href:import.meta.resolve(name)));}return text;}).join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureURL.href))+'\nexport {fixture,editor,visible,text};';
export const mainLibraryFixture=await import('data:text/javascript,'+encodeURIComponent(source));
const {fixture,editor,visible,text}=mainLibraryFixture;
const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const candidateLabel=(view,key)=>`최종 대표이미지 ${view.imageKeys.indexOf(key)+1} 선택`;
const gallery=h=>visible(h.render()).find(node=>node.type==='div'&&typeof node.props['aria-label']==='string'&&node.props['aria-label'].endsWith(' 후보'));
const candidates=h=>visible(gallery(h)).filter(node=>node.type==='button').map(node=>node.props['aria-label']);
const snapshot=f=>JSON.stringify({rows:['products','product_content','product_options','product_price_policy','product_quotation_fields','collection_context','collection_results'].map(table=>f.backend.sqlite.prepare('SELECT * FROM '+table).all()),objects:[...f.backend.objects].map(([key,data])=>[key,Buffer.from(data).toString('base64')])});
const advanceMetadata=(f,table)=>{const row=f.backend.sqlite.prepare(`SELECT payload FROM ${table} WHERE product_id=?`).get(f.product.id),value=JSON.parse(row.payload);value.revision++;f.backend.sqlite.prepare(`UPDATE ${table} SET revision=?,payload=? WHERE product_id=?`).run(value.revision,JSON.stringify(value),f.product.id);};

for(const [company,table]of [[companies[0],'product_content'],[companies[1],'product_options']])test(`a concurrent ${table} revision refreshes the clean quotation and galleries with reads only (${company.code})`,async()=>{
 const f=await fixture(company),request=f.request;let quotations=0,frozen;
 f.request=async(url,init)=>{const response=await request(url,init);if(url.includes('/quotation-fields')&&++quotations===1){advanceMetadata(f,table);frozen=snapshot(f);}return response;};
 const h=editor(f);try{
  await h.idle();for(let pass=0;pass<20&&h.button('메인 이미지 보기').props.disabled;pass++)await h.idle();
  assert.equal(h.button('메인 이미지 보기').props.disabled,false,'the newer saved source classification must recover without reopening the popup');
  await h.click('메인 이미지 보기');assert.ok(candidates(h).length>0);assert.equal(quotations,2,'only one automatic quotation refresh');
  assert.equal(f.calls.filter(call=>call.url.endsWith('/content')).length,2);assert.equal(f.calls.filter(call=>call.url.endsWith('/options')).length,2);
  assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(h.saved.length,0);assert.equal(snapshot(f),frozen);assert.ok(f.calls.every(call=>call.method==='GET'));
 }finally{h.close();f.close();}
});

test('a second metadata race stops after one read-only refresh instead of looping',async()=>{
 const f=await fixture(),request=f.request;let quotations=0,contents=0;
 f.request=async(url,init)=>{if(url.endsWith('/content')&&++contents===2)advanceMetadata(f,'product_content');const response=await request(url,init);if(url.includes('/quotation-fields')&&++quotations===1)advanceMetadata(f,'product_content');return response;};
 const h=editor(f);try{
  await h.idle();for(let pass=0;pass<10;pass++)await h.idle();
  assert.equal(quotations,2);assert.equal(contents,2);assert.equal(h.button('메인 이미지 보기').props.disabled,true);assert.match(text(h.render()),/이미지 종류를 확인하지 못했습니다/);assert.ok(f.calls.every(call=>call.method==='GET'));
 }finally{h.close();f.close();}
});

test('a pending explicit image choice prevents an automatic metadata refresh from replacing its quotation base',async()=>{
 const f=await fixture(),request=f.request;let quotations=0,release,held=true;const pending=new Promise(resolve=>{release=resolve;});
 f.request=async(url,init)=>{const response=await request(url,init);if(url.includes('/quotation-fields')&&++quotations===1)advanceMetadata(f,'product_content');if(url.endsWith('/content')&&held)await pending;return response;};
 const h=editor(f);try{
  await h.idle();const view=await f.read(),frozen=snapshot(f);await h.click(candidateLabel(view,f.nextKey));held=false;release();await h.idle();
  assert.equal(quotations,1);assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(h.button('메인 이미지 보기').props.disabled,true);
  assert.ok(visible(h.render()).some(node=>node.type==='img'&&node.props.alt==='최종 견적 대표이미지'&&node.props.src==='/api/files/'+f.nextKey));assert.equal(snapshot(f),frozen);assert.ok(f.calls.every(call=>call.method==='GET'));
 }finally{release();h.close();f.close();}
});

for(const change of ['draft','focus'])test(`an in-flight gallery recovery cannot replace a newer ${change} session`,async()=>{
 const f=await fixture(),request=f.request;let quotations=0,release;const pending=new Promise(resolve=>{release=resolve;});
 f.request=async(url,init)=>{const response=await request(url,init);if(url.includes('/quotation-fields')){quotations++;if(quotations===1)advanceMetadata(f,'product_content');else if(quotations===2)await pending;}return response;};
 const h=editor(f);try{
  await h.idle();assert.equal(quotations,2);const view=await f.read(),frozen=snapshot(f),old=h.button(candidateLabel(view,f.nextKey)).props.onClick;
  if(change==='draft'){assert.equal(h.button(candidateLabel(view,f.nextKey)).props.disabled,false);old();await h.idle();}else{h.props.focusedOptionId=view.resolved.rows.find(row=>row.optionId&&row.optionId!==f.id).optionId;await h.idle();old();}
  release();await h.idle();
  assert.equal(h.render().props['data-workspace-dirty'],change==='draft');assert.equal(h.saved.length,0);assert.equal(snapshot(f),frozen);assert.ok(f.calls.every(call=>call.method==='GET'));
  if(change==='draft'){assert.equal(quotations,2);assert.equal(f.calls.filter(call=>call.url.endsWith('/content')).length,1);assert.ok(visible(h.render()).some(node=>node.type==='img'&&node.props.alt==='최종 견적 대표이미지'&&node.props.src==='/api/files/'+f.nextKey));}
  else{assert.equal(h.input('최종 대표이미지 옵션').props.value,h.props.focusedOptionId);assert.equal(h.button('메인 이미지 보기').props.disabled,false);}
 }finally{release();h.close();f.close();}
});

test('gallery recovery does not adopt a concurrently edited final representative image',async()=>{
 const f=await fixture(),request=f.request;let quotations=0,frozen;
 f.request=async(url,init)=>{const response=await request(url,init);if(url.includes('/quotation-fields')&&++quotations===1){advanceMetadata(f,'product_content');const latest=await f.read();await json(await f.backend.route(f.endpoint,{method:'PUT',body:{expectedRevision:latest.revision,expectedInputFingerprint:latest.inputFingerprint,changes:[{optionId:f.id,fieldKey:'mainImage',value:f.nextKey}]}}));frozen=snapshot(f);}return response;};
 const h=editor(f);try{
  await h.idle();assert.equal(quotations,2);assert.equal(f.calls.filter(call=>call.url.endsWith('/content')).length,1);assert.equal(h.button('메인 이미지 보기').props.disabled,true);
  assert.ok(visible(h.render()).some(node=>node.type==='img'&&node.props.alt==='최종 견적 대표이미지'&&node.props.src==='/api/files/'+f.key));assert.equal(snapshot(f),frozen);assert.ok(f.calls.every(call=>call.method==='GET'));
 }finally{h.close();f.close();}
});

test('untouched gallery preference is proven work, then options, then main without changing candidate metadata',async()=>{
 const f=await fixture();try{
  const helper=f.backend.load('app/main-image-library.ts');
  for(const [work,options,main,expected]of [[['work'],['option'],['main'],'work'],[[],['option'],['main'],'options'],[[],[],['main'],'main'],[[],[],[],'main']]){
   const library={work,options,main,detail:['detail']},before=JSON.stringify(library);
   assert.equal(helper.initialMainImageLibraryTab(library),expected);assert.equal(JSON.stringify(library),before);
  }
 }finally{f.close();}
});

for(const company of companies)test(`client library separates immutable source roles, actual option/final choices and proven results (${company.code})`,async()=>{
 const f=await fixture(company);try{
  const helper=f.backend.load('app/main-image-library.ts'),view=await f.read(),base='/api/products/'+f.product.id,content=await json(await f.backend.route(base+'/content')),options=await json(await f.backend.route(base+'/options')),before=JSON.stringify({view,content,options}),group=helper.classifyMainImageLibrary(f.product.id,view,content,options);
  assert.deepEqual([...group.main],options.imageLibrary.main);assert.deepEqual([...group.detail],options.imageLibrary.detail);assert.deepEqual([...group.work],[]);assert.ok(group.options.includes(f.source));assert.ok(group.options.includes(f.key),'the actual final quotation image remains an option candidate even when it differs from source B');
  assert.deepEqual([...helper.mainImageLibraryKeys('work',view,group)],[]);assert.deepEqual([...helper.mainImageLibraryKeys('work',view,null)],[]);assert.equal(JSON.stringify({view,content,options}),before);assert.equal(helper.mainImageLibraryCurrent(group,f.product.id,view),true);
  // Manual stage role changes do not reclassify raw galleries or processed work.
  const edited=structuredClone(content);edited.content.assets.main.value=[view.imageKeys.at(-1)];edited.content.assets.detail.value=[view.imageKeys[0]];
  const same=helper.classifyMainImageLibrary(f.product.id,view,edited,options);for(const tab of ['work','main','detail'])assert.deepEqual([...same[tab]],[...group[tab]]);
  for(const wrong of [{...view,productVersion:new Date(Date.parse(view.productVersion)+1).toISOString()},{...view,contentRevision:view.contentRevision+1},{...view,optionRevision:view.optionRevision+1},{...view,imageKeys:view.imageKeys.slice(1)}]){assert.equal(helper.mainImageLibraryCurrent(group,f.product.id,wrong),false);assert.deepEqual([...helper.mainImageLibraryKeys('main',wrong,group)],[]);}
 }finally{f.close();}
});

test('missing, foreign, stale or malformed provenance is not reclassified as raw or work; removed keys never return',async()=>{
 const f=await fixture();try{
  const helper=f.backend.load('app/main-image-library.ts'),view=await f.read(),base='/api/products/'+f.product.id,content=await json(await f.backend.route(base+'/content')),options=await json(await f.backend.route(base+'/options'));
  for(const mutate of [value=>{value.content.content.productId='foreign';},value=>{value.content.content.revision++;},value=>{value.options.options.productId='foreign';},value=>{value.options.options.revision++;},value=>{value.options.productVersion='2020-01-01T00:00:00.000Z';},value=>{value.options.imageLibrary=null;},value=>{delete value.options.imageLibrary;},value=>{value.options.imageLibrary.productId='foreign';},value=>{value.options.imageLibrary.optionRevision++;},value=>{value.options.imageLibrary.company.code='foreign';},value=>{value.options.imageLibrary.source.fingerprint='bad';},value=>{value.options.imageLibrary.source=null;},value=>{value.options.imageLibrary.work=[''];},value=>{value.options.options.rows.push(value.options.options.rows[0]);},value=>{value.options.sourceImageKeys.foreign=view.imageKeys[0];}]){const input=structuredClone({content,options});mutate(input);assert.throws(()=>helper.classifyMainImageLibrary(f.product.id,view,input.content,input.options),/이미지 종류/);}
  const retained=structuredClone(options);retained.imageLibrary.main.push('other/foreign.png','owner/deleted.png');retained.imageLibrary.work=['owner/deleted.png'];const group=helper.classifyMainImageLibrary(f.product.id,view,content,retained);assert.ok(!group.main.includes('other/foreign.png'));assert.ok(!group.main.includes('owner/deleted.png'));assert.deepEqual([...group.work],[]);
 }finally{f.close();}
});

for(const company of companies)test(`source galleries can be browsed without writes; exact chosen SKU final image reaches XLSX (${company.code})`,async()=>{
 const f=await fixture(company,true),h=editor(f);try{
  await h.idle();const before=await f.read(),base='/api/products/'+f.product.id,body=await json(await f.backend.route(base+'/options')),frozen=snapshot(f);
  assert.equal(h.button('옵션 이미지 보기').props['aria-pressed'],true);
  await h.click('메인 이미지 보기');assert.deepEqual(candidates(h),body.imageLibrary.main.map(key=>candidateLabel(before,key)));
  await h.click('옵션 이미지 보기');assert.ok(candidates(h).includes(candidateLabel(before,f.source)));
  await h.click('작업 이미지 보기');assert.deepEqual(candidates(h),[]);assert.ok(visible(h.render()).some(node=>node.type==='img'&&node.props.alt==='최종 견적 대표이미지'&&node.props.src==='/api/files/'+f.key));
  await h.click('메인 이미지 보기');assert.deepEqual(candidates(h),body.imageLibrary.main.map(key=>candidateLabel(before,key)));assert.equal(snapshot(f),frozen);
  await h.click(candidateLabel(before,f.source));assert.equal(h.render().props['data-workspace-dirty'],true);
  await h.click('상세 이미지 보기');assert.deepEqual(candidates(h),body.imageLibrary.detail.map(key=>candidateLabel(before,key)));assert.equal(h.render().props['data-workspace-dirty'],true);assert.ok(visible(h.render()).some(node=>node.type==='img'&&node.props.alt==='최종 견적 대표이미지'&&node.props.src==='/api/files/'+f.source));assert.equal(snapshot(f),frozen);
  await h.click('최종 견적 대표이미지 저장');assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);assert.equal(f.calls.filter(call=>call.method==='PATCH').length,0);const saved=await f.read();assert.equal(saved.resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,f.source);assert.equal(saved.resolved.rows.find(row=>row.optionId!==null&&row.optionId!==f.id).fields.mainImage.value,before.resolved.rows.find(row=>row.optionId!==null&&row.optionId!==f.id).fields.mainImage.value);
  const preview=await json(await f.backend.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}})),download=await f.backend.route(base+'/quotation',{method:'POST',body:{action:'download',profileId:f.profile.id,fingerprint:preview.fingerprint}});assert.equal(download.status,200,await download.clone().text());const reader=f.backend.load('app/xlsx-template.ts'),book=reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer()));assert.equal(reader.xlsxHeaders(book,'견적서',2)[f.fields.indexOf('mainImage')],preview.rows[0][f.fields.indexOf('mainImage')]);assert.equal(h.saved.length,1);assert.ok(!f.backend.network.includes('supplier.coupang.com'));
 }finally{h.close();f.close();}
});

for(const company of companies)for(const emptyMain of [false,true])test(`proven work is the initial candidate tab ahead of option and main candidates${emptyMain?' even without original main images':''} (${company.code})`,async()=>{
 const f=await fixture(company),request=f.request;
 // Only the read-only synthetic gallery response differs. No source/product
 // row is changed to create an empty original gallery or processed result.
 f.request=async(url,init)=>{const response=await request(url,init);if(!url.endsWith('/options'))return response;const body=await response.json();body.imageLibrary.work=[f.nextKey];if(emptyMain)body.imageLibrary.main=[];return Response.json(body);};
 const h=editor(f);try{
  const frozen=snapshot(f);await h.idle();const before=await f.read(),expectedMain=emptyMain?[]:(await json(await f.backend.route('/api/products/'+f.product.id+'/options'))).imageLibrary.main;
  assert.equal(h.button('작업 이미지 보기').props['aria-pressed'],true);assert.deepEqual(candidates(h),[candidateLabel(before,f.nextKey)]);
  assert.match(text(h.button('작업 이미지 보기')),/작업이미지/);assert.equal(text(visible(gallery(h)).find(node=>node.type==='span')),'작업됨');
  const preview=()=>visible(h.render()).find(node=>node.type==='img'&&node.props.alt==='최종 견적 대표이미지')?.props.src;
  const savedPreview=preview();assert.equal(savedPreview,'/api/files/'+f.key);
  await h.click('작업 이미지 보기');assert.deepEqual(candidates(h),[candidateLabel(before,f.nextKey)]);
  await h.click('옵션 이미지 보기');assert.ok(candidates(h).includes(candidateLabel(before,f.source)));
  await h.click('상세 이미지 보기');assert.equal(h.button('상세 이미지 보기').props['aria-pressed'],true);
  await h.click('메인 이미지 보기');assert.deepEqual(candidates(h),expectedMain.map(key=>candidateLabel(before,key)));
  assert.ok(visible(gallery(h)).filter(node=>node.type==='span').every(node=>text(node)==='메인'));
  assert.equal(preview(),savedPreview);assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(snapshot(f),frozen);assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);
 }finally{h.close();f.close();}
});

for(const focused of [false,true])test(`${focused?'focused':'global'} option changes derive a fresh default without reviving an earlier option tab or changing saved images`,async()=>{
 const f=await fixture(),h=editor(f);try{
  await h.idle();if(!focused){h.props.focusedOptionId=undefined;await h.idle();}
  const view=await f.read(),other=view.resolved.rows.find(row=>row.optionId&&row.optionId!==f.id).optionId,frozen=snapshot(f);
  const select=async id=>{if(focused)h.props.focusedOptionId=id;else h.input('최종 대표이미지 옵션').props.onChange({target:{value:id}});await h.idle();
   // Metadata is deliberately optional and completes after the saved image.
   // Wait for its actual ready control before asserting the reset tab; a
   // temporary work-only fallback is not the final gallery selection.
   for(let pass=0;pass<20&&h.button('메인 이미지 보기').props.disabled;pass++)await h.idle();
   assert.equal(h.button('메인 이미지 보기').props.disabled,false,'current source gallery metadata has completed');};
  await h.click('옵션 이미지 보기');const oldWork=h.button('작업 이미지 보기').props.onClick;
  await select(other);assert.equal(h.button('옵션 이미지 보기').props['aria-pressed'],true);oldWork();await h.idle();assert.equal(h.button('옵션 이미지 보기').props['aria-pressed'],true);
  await h.click('상세 이미지 보기');await select(f.id);assert.equal(h.button('옵션 이미지 보기').props['aria-pressed'],true,'returning to an earlier option starts a new untouched-tab session');
  oldWork();await h.idle();assert.equal(h.button('옵션 이미지 보기').props['aria-pressed'],true,'retained callbacks from the earlier visit cannot restore its tab');
  await h.click('작업 이미지 보기');assert.equal(h.button('작업 이미지 보기').props['aria-pressed'],true,'the current option still allows explicit tab browsing');
  assert.ok(visible(h.render()).some(node=>node.type==='img'&&node.props.alt==='최종 견적 대표이미지'&&node.props.src==='/api/files/'+f.key));
  assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(snapshot(f),frozen);assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);
 }finally{h.close();f.close();}
});

test('an explicit tab chosen before metadata arrives survives its completion and later read-only refresh',async()=>{
 const f=await fixture(),request=f.request;let release,held=true;
 const pending=new Promise(resolve=>{release=resolve;});
 f.request=async(url,init)=>{const response=await request(url,init);if(held&&url.endsWith('/content'))await pending;return response;};
 const h=editor(f);try{
  await h.idle();const before=snapshot(f);await h.click('작업 이미지 보기');held=false;release();await h.idle();
  assert.equal(h.button('작업 이미지 보기').props['aria-pressed'],true);
  h.props.refreshToken='refresh';await h.idle();assert.equal(h.button('작업 이미지 보기').props['aria-pressed'],true);
  assert.equal(snapshot(f),before);assert.equal(f.calls.some(call=>call.method!=='GET'),false);
 }finally{release();h.close();f.close();}
});

for(const failure of ['network','clock'])test(`optional ${failure} metadata leaves images unclassified and preserves explicit final-image edits`,async()=>{
 const f=await fixture(),request=f.request;f.request=async(url,init)=>{if(url.endsWith('/content')){if(failure==='network')throw Error('metadata offline');const response=await request(url,init),body=await response.json();body.content.revision++;return Response.json(body);}return request(url,init);};const h=editor(f);try{
  await h.idle();assert.deepEqual(candidates(h),[]);assert.equal(h.button('옵션 이미지 보기').props.disabled,true);assert.match(text(h.render()),/이미지 종류를 확인하지 못했습니다/);
  const all=visible(h.render()).find(node=>node.type==='details'&&node.props.className==='main-image-all-saved');assert.ok(all);assert.ok(!all.props.open,'unclassified files remain in an explicitly closed all-saved list');
  await h.click('최종 대표이미지 비우기');await h.click('최종 견적 대표이미지 저장');assert.equal(h.saved.length,1);assert.equal((await f.read()).resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,'');assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);
 }finally{h.close();f.close();}
});

test('delayed provenance cannot delay an explicit save or publish its old option scope',async()=>{
 const f=await fixture(),request=f.request,held=[];f.request=async(url,init)=>{const response=await request(url,init);if(url.endsWith('/content'))await new Promise(resolve=>held.push({resolve,signal:init?.signal}));return response;};const h=editor(f);try{
  await h.idle();assert.ok(held.length);assert.equal(h.render().props['data-workspace-saving'],false);await h.click('최종 대표이미지 비우기');await h.click('최종 견적 대표이미지 저장');assert.equal(h.saved.length,1,'optional display provenance does not block the confirmed PUT');assert.equal((await f.read()).resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,'');
  const old=h.button('상세 이미지 보기').props.onClick;h.props.focusedOptionId=(await f.read()).resolved.rows.filter(row=>row.optionId&&row.optionId!==f.id)[0].optionId;await h.idle();old();for(const wait of held)wait.resolve();await h.idle();assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);assert.ok(held.some(value=>value.signal?.aborted));
 }finally{for(const wait of held)wait.resolve();h.close();f.close();}
});
