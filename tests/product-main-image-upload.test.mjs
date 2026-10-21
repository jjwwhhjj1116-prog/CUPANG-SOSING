import test from 'node:test';
import assert from 'node:assert/strict';
import {productImageUploadFixture,priceTableCompanies,imageFile,png,text,nodes,plain} from './helpers/product-image-upload.mjs';

const writes=f=>f.calls.filter(call=>call.method==='POST');
const pool=f=>JSON.parse(f.product().image_keys);
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};

/** Real private file/API handlers and SQLite; only transport interruptions are
 * injected. No external collection or Supplier Hub requests are allowed. */
async function fixture(company=priceTableCompanies[0]){
 const f=await productImageUploadFixture(company);
 const keys=Object.fromEntries(['main-old','main-other','main-common','additional','detail','label'].map(name=>[name,`${f.owner}/${name}.png`]));
 for(const key of Object.values(keys)){f.objects.set(key,new Uint8Array(png));f.metadata.set(key,{httpMetadata:{contentType:'image/png'}});}
 f.api.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([f.originalKey,...Object.values(keys)]),f.id);
 const contentModel=f.api.load('app/product-content.ts'),now=new Date(Date.parse(f.product().updated_at)+1).toISOString();
 await f.api.load('db/product-content.ts').saveProductContent(f.owner,contentModel.applyContentPatch(contentModel.emptyProductContent(f.id),
  {assets:{main:[f.originalKey],additional:[keys.additional],detail:[keys.detail],label:[keys.label]},detail:{description:'원문 상세 유지'}},now),0);
 const snapshot={format:'supplier-hub-schema-v1',categoryId:'991234',categoryPath:['합성 대표이미지','선택 SKU'],company,observedAt:Date.now(),inputBindings:'couplus-paths-v1',
  metadata:{displayCategoryCode:'991234',kanCategoryId:3000,version:190},schemaString:JSON.stringify({type:'object',properties:{productPage:{type:'object',properties:{}},legalPage:{type:'object',properties:{}},imagePage:{type:'object',properties:{images:{type:'object',properties:{mainImage:{type:'string',title:'대표 이미지'}}}}}}})};
 const profile=await f.api.load('db/category-profiles.ts').createCategoryProfile(f.owner,{name:'선택 대표이미지 업로드 합성',categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,hubSchema:snapshot,template:null,mappings:[]},'main-upload-profile');
 const endpoint=`/api/products/${f.id}/quotation-fields?profileId=${profile.id}`;
 const quote=async()=>json(await f.fetcher(endpoint)),initial=await quote(),[first,second]=initial.resolved.rows.flatMap(row=>row.optionId?[row.optionId]:[]);
 const target=f.api.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(initial.resolved.schema.fields,'mainImage');
 assert.deepEqual(plain(target.primaryField.hubWire.path),['imagePage','images','mainImage']);
 const changes=[...target.linked.flatMap(fieldKey=>[{optionId:null,fieldKey,value:keys['main-common']},{optionId:first,fieldKey,value:keys['main-old']},{optionId:second,fieldKey,value:keys['main-other']}]),
  {optionId:first,fieldKey:'detailHtml',value:'<p>선택 옵션 수동 HTML</p>'},{optionId:second,fieldKey:'additionalImages',value:keys.additional}];
 await json(await f.api.request(endpoint,{method:'PUT',body:JSON.stringify({expectedRevision:initial.revision,expectedInputFingerprint:initial.inputFingerprint,changes})}));
 const content=()=>f.api.load('db/product-content.ts').readProductContent(f.owner,f.id);
 const protectedTables=['product_options','product_content','product_price_policy','workspace_settings','collection_context','collection_products','collection_jobs','collection_results','category_profiles'];
 const protectedSnapshot=()=>JSON.stringify(protectedTables.map(table=>[table,f.api.sqlite.prepare('SELECT * FROM '+table).all()]));
 const allSnapshot=()=>JSON.stringify(['products','product_content','product_quotation_fields','product_options'].map(table=>[table,f.api.sqlite.prepare('SELECT * FROM '+table).all()]));
 const before={quote:await quote(),content:plain(await content()),pool:pool(f),protected:protectedSnapshot(),files:[...f.objects].map(([key,value])=>[key,Buffer.from(value).toString('base64')])};
 f.calls.length=0;
 return{...f,keys,profile,first,second,target,endpoint,quote,content,protectedSnapshot,allSnapshot,before,
  mainUi:extra=>f.ui({stage:'main',immediate:true,target:{optionId:first,profileId:profile.id},...extra})};
}
function assertPreserved(f,after){
 assert.equal(f.protectedSnapshot(),f.before.protected);
 assert.deepEqual(plain(after.overrides.common),f.before.quote.overrides.common);
 for(const row of f.before.quote.resolved.rows.filter(row=>row.optionId!==f.first))assert.deepEqual(plain(after.resolved.rows.find(value=>value.optionId===row.optionId)),row);
 const selected=after.resolved.rows.find(row=>row.optionId===f.first),before=f.before.quote.resolved.rows.find(row=>row.optionId===f.first);
 for(const [id,value]of Object.entries(before.fields))if(!f.target.linked.includes(id))assert.deepEqual(plain(selected.fields[id]),value,id);
 assert.deepEqual(plain(after.automatic),f.before.quote.automatic);
 for(const[key,value]of f.before.files)assert.equal(Buffer.from(f.objects.get(key)).toString('base64'),value,key);
}
for(const company of priceTableCompanies){
 test(`Stage3 single upload replaces exact selected canonical/wire main reference once (${company.code})`,async()=>{
  const f=await fixture(company),ui=f.mainUi();try{
   const input=nodes(ui.render()).find(node=>node.type==='input'&&node.props.type==='file');assert.equal(input.props.multiple,false);
   assert.ok(!nodes(ui.render()).some(node=>node.type==='button'&&text(node).startsWith('업로드 시작')));
   await ui.select([imageFile('selected-main.png')]);const after=await f.quote(),key=pool(f).at(-1);
   assert.equal(ui.saved,1,text(ui.render()));assert.deepEqual(writes(f).map(call=>call.name??call.url.split('?')[0].split('/').at(-1)),['selected-main.png','image-upload-link']);
   const link=writes(f)[1];assert.equal(link.body.stage,'main');assert.equal(link.body.optionId,f.first);assert.match(link.url,/profileId=main-upload-profile/);
   for(const id of f.target.linked){assert.equal(after.overrides.options[f.first][id],key);assert.equal(after.resolved.rows.find(row=>row.optionId===f.first).fields[id].value,key);}
   assert.equal(after.revision,f.before.quote.revision+1);assert.deepEqual(pool(f),[...f.before.pool,key]);assert.equal(ui.render().props['data-workspace-dirty'],false);assertPreserved(f,after);
  }finally{ui.close();f.close();}
 });
 test(`Stage3 committed link ACK loss confirms exact SKU by GET only (${company.code})`,async()=>{
  const f=await fixture(company),ui=f.mainUi();try{
   let lose=true;f.controls.response=(call,response)=>{if(lose&&call.url.includes('/image-upload-link')){lose=false;return Response.json({error:'lost main ACK'},{status:503});}return response;};
   await ui.select([imageFile('lost-main.png')]);assert.equal(ui.saved,0);assert.equal(writes(f).length,2);assert.match(text(ui.render()),/연결 결과 확인 필요/);
   const before=f.calls.length;await ui.click('lost-main.png 저장 결과 확인');assert.equal(ui.saved,1);assert.ok(f.calls.slice(before).every(call=>call.method==='GET'));assert.equal(writes(f).length,2);assertPreserved(f,await f.quote());
   await ui.idle();assert.equal(ui.saved,1,'rendering does not publish another completion');
  }finally{ui.close();f.close();}
 });
}
test('Stage3 uncommitted main link retries the stored file key without a second upload',async()=>{
 const f=await fixture(),ui=f.mainUi();try{
  let reject=true;f.controls.before=call=>{if(reject&&call.url.includes('/image-upload-link')){reject=false;throw Error('before main commit');}};
  await ui.select([imageFile('retry-main.png')]);assert.equal(ui.saved,0);assert.deepEqual(pool(f),f.before.pool);
  const count=f.calls.length;await ui.click('retry-main.png 저장 결과 확인');assert.ok(f.calls.slice(count).every(call=>call.method==='GET'));assert.equal(writes(f).length,2);
  await ui.click('저장된 파일 연결');assert.equal(ui.saved,1);assert.equal(writes(f).filter(call=>call.url==='/api/files').length,1);assert.equal(writes(f).length,3);assertPreserved(f,await f.quote());
 }finally{ui.close();f.close();}
});
test('Stage3 null target and multiple file selection reject before reads or writes',async()=>{
 const f=await fixture();try{
  for(const target of [undefined,{optionId:null},{optionId:null,profileId:f.profile.id}]){
   const ui=f.mainUi({target});try{const input=nodes(ui.render()).find(node=>node.type==='input'&&node.props.type==='file');assert.equal(input.props.disabled,true);await ui.select([imageFile('no-sku.png')]);assert.equal(f.calls.length,0);assert.equal(ui.saved,0);}finally{ui.close();}
  }
  const ui=f.mainUi();try{await ui.select([imageFile('one.png'),imageFile('two.png')]);assert.equal(f.calls.length,0);assert.equal(ui.saved,0);assert.match(text(ui.render()),/한 번에 한 장/);assert.deepEqual(pool(f),f.before.pool);}finally{ui.close();}
 }finally{f.close();}
});
for(const mode of ['option-aba','owner','product','stage','inactive'])test(`Stage3 held upload cannot connect after ${mode} UI transition`,async()=>{
 const f=await fixture(),ui=f.mainUi();let release;try{
  let arrived;const waiting=new Promise(resolve=>{arrived=resolve;}),held=new Promise(resolve=>{release=resolve;});
  f.controls.before=async call=>{if(call.url==='/api/files'){arrived();await held;}};
  const input=nodes(ui.render()).find(node=>node.type==='input'&&node.props.type==='file');input.props.onChange({target:{files:[imageFile(mode+'.png')],value:'chosen'}});await waiting;
  if(mode==='option-aba'){ui.render({target:{optionId:f.second,profileId:f.profile.id}});ui.render({target:{optionId:f.first,profileId:f.profile.id}});}
  else if(mode==='owner')ui.render({ownerId:'another-owner'});
  else if(mode==='product')ui.render({productId:'another-product'});
  else if(mode==='stage')ui.render({stage:'detail'});
  else ui.render({active:false});
  release();await ui.idle();assert.equal(writes(f).filter(call=>call.url==='/api/files').length,1);assert.equal(writes(f).filter(call=>call.url.includes('/image-upload-link')).length,0);assert.equal(ui.saved,0);assert.deepEqual(pool(f),f.before.pool);assert.deepEqual(plain((await f.quote()).overrides),f.before.quote.overrides);assert.equal(f.protectedSnapshot(),f.before.protected);
 }finally{release?.();ui.close();f.close();}
});
for(const mode of ['product-clock','category'])test(`Stage3 ${mode} source race retains uploaded bytes without selecting any SKU`,async()=>{
 const f=await fixture(),ui=f.mainUi();try{
  let once=true;f.controls.response=(call,response)=>{if(once&&call.url==='/api/files'){once=false;if(mode==='product-clock')f.api.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z',f.id);else f.api.sqlite.prepare("UPDATE category_profiles SET revision=revision+1,payload=json_set(payload,'$.name','changed category') WHERE id=?").run(f.profile.id);}return response;};
  await ui.select([imageFile(mode+'.png')]);assert.equal(ui.saved,0);assert.equal(writes(f).length,1);assert.equal(f.objects.size,f.before.files.length+1);assert.deepEqual(pool(f),f.before.pool);assert.deepEqual(plain((await f.quote()).overrides),f.before.quote.overrides);
 }finally{ui.close();f.close();}
});
test('Stage3 forged committed ACK cannot acknowledge another SKU or wrong main reference; real GET recovery does',async()=>{
 for(const mode of ['other-sku','main-ref']){const f=await fixture(),ui=f.mainUi();try{
  let forge=true;f.controls.response=async(call,response)=>{if(forge&&call.url.includes('/image-upload-link')&&response.ok){forge=false;const body=await response.json();if(mode==='other-sku')body.quotation.overrides.options[f.second][f.target.primary]='forged';else body.quotation.resolved.rows.find(row=>row.optionId===f.first).fields[f.target.primary].value=f.keys['main-old'];return Response.json(body);}return response;};
  await ui.select([imageFile(mode+'.png')]);assert.equal(ui.saved,0);assert.match(text(ui.render()),/연결 결과 확인 필요/);const count=f.calls.length;await ui.click(mode+'.png 저장 결과 확인');assert.equal(ui.saved,1);assert.ok(f.calls.slice(count).every(call=>call.method==='GET'));assert.equal(writes(f).length,2);assertPreserved(f,await f.quote());
 }finally{ui.close();f.close();}}
});
test('Stage3 atomic product companion rejection rolls back quote/pool and preserves all source rows',async()=>{
 const f=await fixture(),ui=f.mainUi();try{
  const before=f.allSnapshot();f.api.sqlite.exec('CREATE TRIGGER reject_main_product BEFORE UPDATE ON products BEGIN SELECT RAISE(IGNORE); END;');
  await ui.select([imageFile('rollback-main.png')]);assert.equal(ui.saved,0);assert.equal(writes(f).length,2);assert.equal(f.allSnapshot(),before);assert.equal(f.protectedSnapshot(),f.before.protected);assert.equal(f.objects.size,f.before.files.length+1,'uploaded file retained for explicit recovery');assert.match(text(ui.render()),/연결 결과 확인 필요/);
 }finally{ui.close();f.close();}
});
test('Stage3 mid-transaction option mutation rolls back all canonical/wire main companions',async()=>{
 const f=await fixture(),ui=f.mainUi();try{
  const before=f.allSnapshot();f.api.sqlite.exec(`CREATE TRIGGER alter_main_option AFTER UPDATE OF revision ON product_quotation_fields WHEN NEW.revision=OLD.revision+1 BEGIN UPDATE product_options SET revision=revision+1,payload=json_set(payload,'$.revision',revision+1) WHERE product_id='${f.id}'; END;`);
  await ui.select([imageFile('rollback-option.png')]);assert.equal(ui.saved,0);assert.equal(writes(f).length,2);assert.equal(f.allSnapshot(),before);assert.equal(f.protectedSnapshot(),f.before.protected);
 }finally{ui.close();f.close();}
});
test('Stage3 direct API rejects a forged null-option main request without touching metadata or files',async()=>{
 const f=await fixture();try{
  const before=f.allSnapshot(),objects=JSON.stringify([...f.objects].map(([key,value])=>[key,[...value]]));
  const response=await f.fetcher(`/api/products/${f.id}/image-upload-link?profileId=${f.profile.id}`,{method:'POST',body:JSON.stringify({key:f.originalKey,stage:'main',optionId:null,
   expectedProductVersion:f.product().updated_at,expectedContentRevision:f.before.quote.contentRevision,expectedOptionRevision:f.before.quote.optionRevision,expectedQuotationRevision:f.before.quote.revision,expectedInputFingerprint:f.before.quote.inputFingerprint})});
  assert.equal(response.status,400);assert.equal(f.allSnapshot(),before);assert.equal(f.protectedSnapshot(),f.before.protected);assert.equal(JSON.stringify([...f.objects].map(([key,value])=>[key,[...value]])),objects);
 }finally{f.close();}
});
test('Stage3 plan replaces both distinct canonical and exact wire bindings while preserving other SKUs',async()=>{
 const f=await fixture();try{
  // The real compiler canonicalizes this fixture's exact path to mainImage.
  // A separate static model contract exercises legacy views with distinct IDs;
  // it is not claimed as a second live API/schema profile.
  const view=structuredClone(f.before.quote),wireId='hub_fixture_main',canonical='mainImage';
  for(const layer of ['resolved','automatic']){
   const fields=view[layer].schema.fields,main=fields.find(field=>field.id===canonical),wire={...main,id:wireId,hubInput:'mainImage',hubWire:{path:['imagePage','images','mainImage']}};
   delete main.hubWire;delete main.hubInput;fields.push(wire);
   for(const row of view[layer].rows)row.fields[wireId]=structuredClone(row.fields[canonical]);
  }
  for(const values of [view.overrides.common,...Object.values(view.overrides.options)])if(Object.hasOwn(values,canonical))values[wireId]=values[canonical];
  const before=structuredClone(view),key=`${f.owner}/distinct-binding.png`,model=f.api.load('app/image-upload-link.ts'),next=model.prepareImageUploadLink({productId:f.id,ownerId:f.owner,productVersion:view.productVersion,imageKeys:view.imageKeys,content:f.before.content,quotation:view,target:{optionId:f.first,profileId:f.profile.id},stage:'main'},key,new Date(Date.parse(view.productVersion)+1).toISOString());
  assert.deepEqual(plain(next.changes),[canonical,wireId].map(fieldKey=>({optionId:f.first,fieldKey,value:key})));
  assert.equal(next.overrides.options[f.first][canonical],key);assert.equal(next.overrides.options[f.first][wireId],key);
  assert.deepEqual(plain(next.overrides.options[f.second]),before.overrides.options[f.second]);assert.deepEqual(plain(next.overrides.common),before.overrides.common);assert.equal(next.content,f.before.content);assert.deepEqual(view,before);assert.equal(writes(f).length,0);
 }finally{f.close();}
});
