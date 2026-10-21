import test from 'node:test';import assert from 'node:assert/strict';
import {productImageUploadFixture,priceTableCompanies,imageFile,png,text,plain} from './helpers/product-image-upload.mjs';
const writes=f=>f.calls.filter(call=>call.method==='POST');
async function fixture(company=priceTableCompanies[0],excluded=false){
 const f=await productImageUploadFixture(company),keys=Object.fromEntries(['add','body','top','bottom','label','own1','own2','common'].map(name=>[name,`${f.owner}/${name}.png`]));
 for(const key of Object.values(keys)){f.objects.set(key,new Uint8Array(png));f.metadata.set(key,{httpMetadata:{contentType:'image/png'}});}
 f.api.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([f.originalKey,...Object.values(keys)]),f.id);
 const model=f.api.load('app/product-content.ts'),now=new Date(Date.parse(f.product().updated_at)+1).toISOString();
 const content=model.applyContentPatch(model.emptyProductContent(f.id),{assets:{main:[f.originalKey],additional:[keys.add],detailTop:[keys.top],detail:[keys.body],detailBottom:[keys.bottom],label:[keys.label]},detail:{description:'확인한 상세 설명'}},now);
 await f.api.load('db/product-content.ts').saveProductContent(f.owner,content,0);
 const row=f.api.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id),options=JSON.parse(row.payload);
 if(excluded){options.rows[1].included=false;f.api.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options),f.id);}
 const [first,second]=options.rows.map(row=>row.id),quote=await(await f.fetcher(`/api/products/${f.id}/quotation-fields`)).json();
 const changes=[{optionId:null,fieldKey:'additionalImages',value:keys.common},{optionId:null,fieldKey:'detailImages',value:[keys.top,keys.body,keys.bottom].join('\n')},{optionId:null,fieldKey:'detailHtml',value:'<p>직접 작성 공통 HTML</p>'},
  ...[[first,keys.own1],[second,keys.own2]].flatMap(([optionId,key])=>[{optionId,fieldKey:'additionalImages',value:key},{optionId,fieldKey:'detailImages',value:[keys.top,key,keys.bottom].join('\n')},{optionId,fieldKey:'detailHtml',value:`<p>원래 ${optionId} HTML</p>`}])];
 const response=await f.api.request(`/api/products/${f.id}/quotation-fields`,{method:'PUT',body:JSON.stringify({expectedRevision:quote.revision,expectedInputFingerprint:quote.inputFingerprint,changes})});assert.equal(response.status,200,await response.clone().text());
 f.calls.length=0;
 const protectedSnapshot=()=>JSON.stringify(['product_options','product_price_policy','workspace_settings','collection_context','collection_products'].map(table=>[table,f.api.sqlite.prepare('SELECT * FROM '+table).all()]));
 const allSnapshot=()=>JSON.stringify(['products','product_content','product_quotation_fields','product_options'].map(table=>[table,f.api.sqlite.prepare('SELECT * FROM '+table).all()]));
 const before={content:plain(await f.api.load('db/product-content.ts').readProductContent(f.owner,f.id)),quote:await(await f.fetcher(`/api/products/${f.id}/quotation-fields`)).json(),pool:JSON.parse(f.product().image_keys),protected:protectedSnapshot()};f.calls.length=0;
 return{...f,keys,first,second,before,protectedSnapshot,allSnapshot,quote:async()=>await(await f.fetcher(`/api/products/${f.id}/quotation-fields`)).json(),content:()=>f.api.load('db/product-content.ts').readProductContent(f.owner,f.id)};
}
for(const company of priceTableCompanies){
 test(`Stage4 common uploads append all included manual lists and inherited content atomically (${company.code})`,async()=>{
  const f=await fixture(company),ui=f.ui({target:{optionId:null}});try{
   await ui.select([imageFile('extra-one.png'),imageFile('extra-two.png')]);assert.equal(f.calls.length,0);await ui.click('업로드 시작 (2)');assert.equal(ui.saved,1);const quote=await f.quote(),content=await f.content(),added=JSON.parse(f.product().image_keys).slice(-2);
   assert.deepEqual(writes(f).map(call=>call.name??call.url.split('/').at(-1)),['extra-one.png','image-upload-link','extra-two.png','image-upload-link']);
   assert.deepEqual(plain(content.assets.additional.value),[f.keys.add,...added]);assert.equal(content.revision,f.before.content.revision+2);assert.equal(quote.revision,f.before.quote.revision+2);
   assert.equal(quote.overrides.common.additionalImages,[f.keys.common,...added].join('\n'));
   for(const[id,key]of[[f.first,f.keys.own1],[f.second,f.keys.own2]])assert.equal(quote.overrides.options[id].additionalImages,[key,...added].join('\n'));
   for(const id of [f.first,f.second]){assert.equal(quote.overrides.options[id].detailImages,f.before.quote.overrides.options[id].detailImages);assert.equal(quote.overrides.options[id].detailHtml,f.before.quote.overrides.options[id].detailHtml);}
   assert.equal(f.protectedSnapshot(),f.before.protected);assert.deepEqual(Buffer.from(f.objects.get(f.originalKey)),png);assert.equal(ui.render().props['data-workspace-dirty'],false);
  }finally{ui.close();f.close();}
 });
 test(`Stage5 common upload immediately adds body before bottom banner and preserves saved option lists and HTML (${company.code})`,async()=>{
  const f=await fixture(company),ui=f.ui({stage:'detail',immediate:true,target:{optionId:null}});try{
   await ui.select([imageFile('body-one.png'),imageFile('body-two.png')]);const added=JSON.parse(f.product().image_keys).slice(-2),content=await f.content(),quote=await f.quote();assert.equal(ui.saved,1);
   assert.deepEqual(plain(content.assets.detail.value),[f.keys.body,...added]);assert.deepEqual(plain(content.assets.detailTop),f.before.content.assets.detailTop);assert.deepEqual(plain(content.assets.detailBottom),f.before.content.assets.detailBottom);
   assert.deepEqual(plain(quote.overrides),f.before.quote.overrides);assert.equal(quote.automatic.rows.find(row=>row.optionId===f.first).fields.detailImages.value,[f.keys.top,f.keys.body,...added,f.keys.bottom].join('\n'));assert.equal(f.protectedSnapshot(),f.before.protected);
  }finally{ui.close();f.close();}
 });
 test(`optional selected-option upload targets that option only and appends detail before bottom banner (${company.code})`,async()=>{
  const f=await fixture(company),ui=f.ui({stage:'detail',immediate:true,target:{optionId:f.first}});try{
   await ui.select([imageFile('selected-body.png')]);const key=JSON.parse(f.product().image_keys).at(-1),quote=await f.quote();assert.equal(ui.saved,1);assert.deepEqual(plain(await f.content()),f.before.content);
   assert.equal(quote.overrides.options[f.first].detailImages,[f.keys.top,f.keys.own1,key,f.keys.bottom].join('\n'));assert.equal(quote.overrides.options[f.first].detailHtml,f.before.quote.overrides.options[f.first].detailHtml);assert.deepEqual(plain(quote.overrides.options[f.second]),f.before.quote.overrides.options[f.second]);assert.deepEqual(plain(quote.overrides.common),f.before.quote.overrides.common);assert.equal(f.protectedSnapshot(),f.before.protected);
  }finally{ui.close();f.close();}
 });
}
test('common additional upload preserves excluded option overrides',async()=>{
 const f=await fixture(undefined,true),ui=f.ui({target:{optionId:null}});try{await ui.select([imageFile('common.png')]);await ui.click('업로드 시작 (1)');assert.equal(ui.saved,1);const quote=await f.quote(),key=JSON.parse(f.product().image_keys).at(-1);assert.equal(quote.overrides.options[f.first].additionalImages,f.keys.own1+'\n'+key);assert.deepEqual(plain(quote.overrides.options[f.second]),f.before.quote.overrides.options[f.second]);}finally{ui.close();f.close();}
});
test('mixed upload failure keeps the unknown file while successful files connect exactly once',async()=>{
 const f=await fixture(),ui=f.ui({target:{optionId:null}});try{let lost=true;f.controls.response=(call,response)=>{if(lost&&call.url==='/api/files'){lost=false;return Response.json({error:'lost file ACK'},{status:503});}return response;};await ui.select([imageFile('unknown.png'),imageFile('connected.png')]);await ui.click('업로드 시작 (2)');assert.equal(ui.saved,1);assert.match(text(ui.render()),/업로드 결과 확인 불가/);assert.equal(writes(f).length,3);const quote=await f.quote(),key=JSON.parse(f.product().image_keys).at(-1);assert.equal(quote.overrides.options[f.first].additionalImages,f.keys.own1+'\n'+key);const count=writes(f).length;await ui.select([imageFile('unknown.png')]);assert.equal(writes(f).length,count);}finally{ui.close();f.close();}
});
test('atomic link committed ACK loss recovers exact pool plus role by GET only before remaining files continue',async()=>{
 const f=await fixture(),ui=f.ui({target:{optionId:null}});try{let lost=true;f.controls.response=(call,response)=>{if(lost&&call.url.endsWith('/image-upload-link')){lost=false;return Response.json({error:'lost link ACK'},{status:503});}return response;};await ui.select([imageFile('held.png'),imageFile('later.png')]);await ui.click('업로드 시작 (2)');assert.equal(ui.saved,0);assert.equal(writes(f).length,2);const count=f.calls.length;await ui.click('held.png 저장 결과 확인');assert.equal(ui.saved,1);assert.ok(f.calls.slice(count).every(call=>call.method==='GET'));assert.equal(writes(f).length,2);await ui.click('업로드 시작 (1)');assert.equal(writes(f).length,4);assert.equal(ui.saved,2);assert.equal((await f.content()).assets.additional.value.length,3);}finally{ui.close();f.close();}
});
test('an uncommitted link can be retried explicitly with its saved key without another file upload',async()=>{
 const f=await fixture(),ui=f.ui({target:{optionId:f.first}});try{let fail=true;f.controls.before=call=>{if(fail&&call.url.endsWith('/image-upload-link')){fail=false;throw Error('before commit');}};await ui.select([imageFile('stored.png')]);await ui.click('업로드 시작 (1)');await ui.click('stored.png 저장 결과 확인');assert.equal(writes(f).length,2);await ui.click('저장된 파일 연결');assert.equal(ui.saved,1);assert.equal(writes(f).filter(call=>call.url==='/api/files').length,1);assert.equal(writes(f).length,3);}finally{ui.close();f.close();}
});
test('dirty editor guard stops an upload before role mutation and retains the original file attempt',async()=>{
 let allowed=true;const f=await fixture(),ui=f.ui({target:{optionId:null},beforeUpload:()=>allowed});try{f.controls.response=(call,response)=>{if(call.url==='/api/files')allowed=false;return response;};await ui.select([imageFile('dirty.png')]);await ui.click('업로드 시작 (1)');assert.equal(writes(f).length,1);assert.equal(ui.saved,0);assert.deepEqual(plain(await f.content()),f.before.content);assert.deepEqual(plain((await f.quote()).overrides),f.before.quote.overrides);assert.match(text(ui.render()),/업로드 결과 확인 불가|업로드 중/);}finally{ui.close();f.close();}
});
test('source/category quotation race and atomic SQL product-write failure preserve all role/content state',async()=>{
 for(const mode of ['race','sql']){const f=await fixture(),ui=f.ui({target:{optionId:null}});try{
  const before=f.allSnapshot();let once=true;f.controls.before=call=>{if(once&&call.url.endsWith('/image-upload-link')){once=false;if(mode==='race')f.api.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z',f.id);else f.api.sqlite.exec("CREATE TRIGGER prevent_image_product_update BEFORE UPDATE ON products BEGIN SELECT RAISE(IGNORE); END;");}};
  await ui.select([imageFile(mode+'.png')]);await ui.click('업로드 시작 (1)');assert.equal(ui.saved,0);assert.equal(writes(f).length,2);assert.deepEqual(plain(await f.content()),f.before.content);assert.deepEqual(plain((await f.quote()).overrides),f.before.quote.overrides);if(mode==='sql')assert.equal(f.allSnapshot(),before);assert.equal(f.protectedSnapshot(),f.before.protected);
 }finally{ui.close();f.close();}}
});
test('new inherited lists with no manual changes accept both common upload stages',async()=>{
 for(const stage of ['additional','detail']){const f=await fixture(),ui=f.ui({stage,immediate:stage==='detail',target:{optionId:null}});try{
  f.api.sqlite.prepare('DELETE FROM product_quotation_fields WHERE product_id=?').run(f.id);ui.render({version:f.product().updated_at});await ui.select([imageFile(stage+'-automatic.png')]);if(stage==='additional')await ui.click('업로드 시작 (1)');assert.equal(ui.saved,1,text(ui.render()));const quote=await f.quote(),key=JSON.parse(f.product().image_keys).at(-1);assert.deepEqual(plain(quote.overrides),{common:{},options:{}});for(const row of quote.resolved.rows)assert.ok(row.fields[stage==='additional'?'additionalImages':'detailImages'].value.split('\n').includes(key));
 }finally{ui.close();f.close();}}
});
test('a full target role rejects before file upload and keeps its existing images',async()=>{
 const f=await fixture(),ui=f.ui({target:{optionId:f.first}});try{
  const row=f.api.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id),state=JSON.parse(row.payload);const keys=Array.from({length:30},(_,i)=>`${f.owner}/full-${i}.png`);for(const key of keys){f.objects.set(key,new Uint8Array(png));f.metadata.set(key,{httpMetadata:{contentType:'image/png'}});}f.api.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([...JSON.parse(f.product().image_keys),...keys]),f.id);state.overrides.options[f.first].additionalImages=keys.join('\n');f.api.sqlite.prepare('UPDATE product_quotation_fields SET payload=? WHERE product_id=?').run(JSON.stringify(state),f.id);
  await ui.select([imageFile('too-many.png')]);await ui.click('업로드 시작 (1)');assert.equal(writes(f).length,0);assert.equal(ui.saved,0);assert.match(text(ui.render()),/30|최대/);
 }finally{ui.close();f.close();}
});
test('ABA option/profile transitions cannot attach an old in-flight file to any new scope',async()=>{
 const f=await fixture(),ui=f.ui({target:{optionId:f.first}});try{
  let release;const held=new Promise(resolve=>{release=resolve;});let arrived;const waiting=new Promise(resolve=>{arrived=resolve;});f.controls.before=async call=>{if(call.url==='/api/files'){arrived();await held;}};
  await ui.select([imageFile('old-scope.png')]);ui.button('업로드 시작 (1)').props.onClick();await waiting;ui.render({target:{optionId:f.second,profileId:'other-profile'}});ui.render({target:{optionId:f.first}});release();await ui.idle();assert.equal(writes(f).length,1);assert.equal(ui.saved,0);assert.deepEqual(plain((await f.quote()).overrides),f.before.quote.overrides);assert.deepEqual(JSON.parse(f.product().image_keys),f.before.pool);
 }finally{ui.close();f.close();}
});
test('forged link ACK cannot acknowledge unrelated manual HTML or an incomplete target role',async()=>{
 const f=await fixture(),ui=f.ui({target:{optionId:f.first}});try{
  let forged=true;f.controls.response=async(call,response)=>{if(forged&&call.url.endsWith('/image-upload-link')&&response.ok){forged=false;const body=await response.json();body.quotation.overrides.options[f.second].detailHtml='forged';return Response.json(body);}return response;};await ui.select([imageFile('strict.png')]);await ui.click('업로드 시작 (1)');assert.equal(ui.saved,0);assert.match(text(ui.render()),/연결 결과 확인 필요/);const count=f.calls.length;await ui.click('strict.png 저장 결과 확인');assert.equal(ui.saved,1);assert.ok(f.calls.slice(count).every(call=>call.method==='GET'));assert.equal(writes(f).length,2);assert.equal((await f.quote()).overrides.options[f.second].detailHtml,f.before.quote.overrides.options[f.second].detailHtml);
 }finally{ui.close();f.close();}
});
test('same-clock raw content or product edits during file verification reject before any link mutation',async()=>{
 for(const mode of ['content','product']){const f=await fixture(),ui=f.ui({target:{optionId:f.first}});try{
  const get=f.storage.get;let once=true;f.storage.get=async(key,options)=>{if(once&&!f.before.pool.includes(key)){once=false;if(mode==='content')f.api.sqlite.prepare("UPDATE product_content SET payload=json_set(payload,'$.label.precautions.value','external same-clock edit') WHERE product_id=?").run(f.id);else f.api.sqlite.prepare("UPDATE products SET title='external same-clock edit' WHERE id=?").run(f.id);}return get(key,options);};await ui.select([imageFile(mode+'-raw.png')]);await ui.click('업로드 시작 (1)');assert.equal(ui.saved,0);assert.equal(writes(f).length,2);assert.deepEqual(JSON.parse(f.product().image_keys),f.before.pool);assert.deepEqual(plain((await f.quote()).overrides),f.before.quote.overrides);
  if(mode==='content')assert.equal((await f.content()).label.precautions.value,'external same-clock edit');else assert.equal(f.product().title,'external same-clock edit');
 }finally{ui.close();f.close();}}
});
test('mid-batch option, raw content and product mutations roll back every link companion',async()=>{
 for(const mode of ['option','content','product']){const f=await fixture(),ui=f.ui({target:{optionId:null}});try{
  const before=f.allSnapshot(),mutation=mode==='option'?"UPDATE product_options SET revision=revision+1,payload=json_set(payload,'$.revision',revision+1)":mode==='content'?"UPDATE product_content SET payload=json_set(payload,'$.label.precautions.value','trigger edit')":"UPDATE products SET title='trigger edit'";
  f.api.sqlite.exec(`CREATE TRIGGER alter_link_source AFTER UPDATE OF revision ON product_quotation_fields WHEN NEW.revision=OLD.revision+1 BEGIN ${mutation} WHERE ${mode==='product'?'id':'product_id'}='${f.id}'; END;`);
  await ui.select([imageFile('trigger-'+mode+'.png')]);await ui.click('업로드 시작 (1)');assert.equal(ui.saved,0);assert.equal(f.allSnapshot(),before);assert.equal(writes(f).length,2);assert.match(text(ui.render()),/연결 결과 확인 필요/);
 }finally{ui.close();f.close();}}
});
