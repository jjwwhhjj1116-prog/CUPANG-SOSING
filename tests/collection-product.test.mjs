import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {memoryDatabase,runtimeDDL} from '../scripts/check-db-schema.mjs';
function load(file,deps={},mode='development'){
 const exports={};const code=ts.transpileModule(fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,structuredClone,crypto,URL,Date,Response,TextEncoder,TextDecoder,Uint8Array,DataView,process:{env:{NODE_ENV:mode}},require(name){if(name in deps)return deps[name];if(name==='next/server')return {NextResponse:Response};if(name.startsWith('@/'))return load(`${name.slice(2)}.ts`,deps,mode);throw Error(name);}});return exports;
}
const settings=load('app/workspace-settings.ts').defaultSettings;
const prepare=load('app/collection-product.ts').prepareCollectionProduct;

test('new source attributes populate editable labels and the category quotation without inventing translation',()=>{
 const source={...result,attributes:[{name:'材质',value:'尼龙'},{name:'型号',value:'B-123'},{name:'包装清单',value:'包 × 1'}]};
 const draft=prepare('owner',job,source,'p',now);
 for(const [field,value] of [['material','尼龙'],['model','B-123'],['components','包 × 1']]){
  assert.equal(draft.content.label[field].value,value);
  assert.equal(draft.content.label[field].provenance,'collected');
 }
 const resolved=load('app/quotation-schema.ts').resolveQuotationFields({categoryId:'80719',product:draft.product,content:draft.content,options:draft.options,settings});
 const row=resolved.rows.find(row=>row.optionId);
 assert.equal(row.fields.noticeMaterial.value,'尼龙');
 assert.equal(row.fields.noticeComponents.value,'包 × 1');
 assert.equal(row.fields.model.value,'B-123');
 assert.equal(draft.product.supplier_hub_status,'미전송');
});

test('explicit product dimensions reach quotation notices without becoming package measurements or option sizes',()=>{
 const source={...result,attributes:[{name:'产品尺寸',value:'38 × 31 × 14 cm'},{name:'包装尺寸',value:'50 × 40 × 20 cm'}]};
 const draft=prepare('owner',job,source,'p',now);
 assert.equal(draft.content.label.dimensions.value,'38 × 31 × 14 cm');
 assert.equal(draft.content.label.dimensions.provenance,'collected');
 assert.equal(draft.options.rows[0].size,'');
 const quote=load('app/quotation-schema.ts').resolveQuotationFields({categoryId:'80719',product:draft.product,content:draft.content,options:draft.options,settings});
 assert.equal(quote.rows[0].fields.noticeDimensions.value,'38 × 31 × 14 cm');
 for(const attributes of [
  [{name:'包装尺寸',value:'50 × 40 × 20 cm'},{name:'尺寸',value:'XL'},{name:'净重',value:'200g'}],
  [{name:'产品尺寸',value:'38cm'},{name:'product dimensions',value:'40cm'}],
 ])assert.equal(prepare('owner',job,{...result,attributes},'p',now).content.label.dimensions.value,'');
});

test('conflicting attributes remain in source; partial matches and legal claims are not adopted',()=>{
 const attributes=[{name:'材质',value:'尼龙'},{name:'material',value:'棉'},{name:'型号',value:'A'},{name:'MODEL',value:'A'},{name:'货号',value:'SKU-123'},{name:'包装材质',value:'纸'},{name:'产地',value:'中国'},{name:'KC 인증정보',value:'인증됨'}];
 const draft=prepare('owner',job,{...result,attributes},'p',now);
 assert.equal(draft.content.label.material.value,'');assert.equal(draft.content.label.model.value,'A');
 assert.notEqual(draft.content.label.kcInformation.value,'인증됨');
 assert.equal(attributes[0].value,'尼龙');
});
test('unsaved registration examples never become promoted product label facts',()=>{
 const {savedRegistrationSettings,validateSettings}=load('app/workspace-settings.ts');
 const blank=savedRegistrationSettings(null);
 const promoted=prepare('owner',{...job,context:{...job.context,settings:blank}},result,'p',now);
 for(const key of ['manufacturer','importer','contact'])assert.equal(promoted.content.label[key].value,'');
 assert.equal(promoted.policy.exchangeRate,350);assert.equal(promoted.policy.roundingMode,'nearest');
 assert.equal(validateSettings(blank).tradeType,'');assert.equal(validateSettings(blank).importType,'');
 assert.throws(()=>validateSettings({...blank,tradeType:'invalid'}));assert.throws(()=>validateSettings({...blank,importType:'invalid'}));
 const current={...settings,brand:'later',manufacturer:'later'};
 const resolved=load('app/collection-registration-settings.ts').collectionRegistrationSettings(current,blank);
 assert.equal(resolved.brand,'');assert.equal(resolved.manufacturer,'');
});
const now='2026-01-01T00:00:00.000Z';
const job={id:'job',offer_id:'123',source_url:'https://detail.1688.com/offer/123.html',goal:'transmit',status:'awaiting_connector',created_at:now,updated_at:now,context:{category:{id:'cat',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']},settings,features:'feature',keywords:'',capturedAt:now}};
const result={schemaVersion:1,offerId:'123',sourceUrl:job.source_url,provider:'fixture',collectedAt:now,title:'原文商品',description:'原文説明',images:[],options:[{sku:'a',name:'黑',unitPriceCny:3.25,minimumOrder:2,stock:null},{sku:'b',name:'白',unitPriceCny:5,minimumOrder:1,stock:0}]};

test('new URL description reaches stage five and quotation until explicitly reviewed there',()=>{
 const prepared=prepare('owner',job,result,'p',now),before=JSON.stringify(prepared);
 const {applyContentPatch,currentDetailContent}=load('app/product-content.ts');
 const resolve=load('app/quotation-schema.ts').resolveQuotationFields;
 const html=content=>resolve({categoryId:'80719',product:prepared.product,content,options:prepared.options,settings}).rows[0].fields.detailHtml.value;
 assert.equal(prepared.content.detailDescriptionLinked,true);
 assert.equal(currentDetailContent(prepared.content).description.value,result.description);
 assert.equal(currentDetailContent(prepared.content).description.provenance,'collected');
 assert.equal(html(prepared.content),'<p>原文説明</p>');
 const edited=applyContentPatch(prepared.content,{seo:{description:'검토 설명\n<script>텍스트</script>'}},'seo');
 assert.equal(currentDetailContent(edited).description.value,edited.seo.description.value);
 assert.equal(html(edited),'<p>검토 설명<br>&lt;script&gt;텍스트&lt;/script&gt;</p>');
 for(const value of ['직접 작성한 상세 설명','',edited.seo.description.value]){
  const reviewed=applyContentPatch(edited,{detail:{description:value}},'detail');
  assert.equal(reviewed.detailDescriptionLinked,false);assert.equal(reviewed.detail.description.provenance,'manual');
  const changed=applyContentPatch(reviewed,{seo:{description:'나중 SEO 설명'}},'later');
  assert.equal(currentDetailContent(changed).description.value,value);
  assert.equal(html(changed),value?html(reviewed):'');
 }
 const simultaneous=applyContentPatch(edited,{seo:{description:'새 SEO'},detail:{description:'직접 상세'}},'both');
 assert.equal(html(simultaneous),'<p>직접 상세</p>');
 assert.equal(JSON.stringify(prepared),before);
});

test('new sparse URL keeps generated SEO description linked but confirms an explicit empty detail save',()=>{
 const prepared=prepare('owner',job,{...result,description:''},'p',now);
 const {applyContentPatch,currentDetailContent}=load('app/product-content.ts');
 const generated=structuredClone(prepared.content);
 generated.seo.description={value:'생성 후 검토할 설명',provenance:'generated',updatedAt:'ai'};
 assert.equal(currentDetailContent(generated).description.value,'생성 후 검토할 설명');
 assert.equal(currentDetailContent(generated).description.provenance,'generated');
 const cleared=applyContentPatch(prepared.content,{detail:{description:''}},'confirmed-empty');
 assert.equal(cleared.detailDescriptionLinked,false);assert.equal(cleared.detail.description.provenance,'manual');
 cleared.seo.description=generated.seo.description;
 assert.equal(currentDetailContent(cleared).description.value,'');
});

test('observed pricing survives SQLite promotion, workspace changes and category quotation resolution',async()=>{
 const capturedSettings=load('app/observed-price-preset.ts').applyObservedPricePreset({...settings,brand:'저장 브랜드'});
 const capturedJob={...job,context:{...job.context,settings:capturedSettings}};
 const receipt={...result,options:[{...result.options[0],unitPriceCny:25.6},{...result.options[1],unitPriceCny:0.1},{...result.options[0],sku:'fresh-observed',unitPriceCny:5.23}]};
 const s=storage();
 try{
  s.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(capturedJob.context),job.id);
  s.sqlite.prepare('UPDATE collection_results SET payload=? WHERE job_id=?').run(JSON.stringify(receipt),job.id);
  const saved=await s.promoteCollection('owner',capturedJob,receipt);
  const product=s.sqlite.prepare('SELECT * FROM products WHERE id=?').get(saved.product_id);
  product.pricing_policy=s.sqlite.prepare('SELECT payload FROM product_price_policy WHERE product_id=?').get(saved.product_id).payload;
  const content=JSON.parse(s.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(saved.product_id).payload);
  const options=JSON.parse(s.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(saved.product_id).payload);
  const resolver=load('app/quotation-schema.ts').resolveQuotationFields;
  const changedSettings={...settings,exchangeRate:999,supplyMargin:5,coupangMargin:5,roundingUnit:1000,msrpMultiple:2,minimumMargin:0,minimumMarginEnabled:false};
  for(const categoryId of ['80719','81452','64497','103495']){
   const quote=resolver({categoryId,product,content,options,settings:changedSettings});
   const prices=quote.rows.filter(row=>row.optionId).map(row=>['supplyPrice','salePrice','msrp'].map(key=>row.fields[key].value));
   assert.deepEqual(JSON.parse(JSON.stringify(prices)),[['17920','29870','38830'],['3040','5070','6590'],['4830','8050','10470']],categoryId);
  }
  const bundled={...options,rows:options.rows.map((row,index)=>({...row,unitsPerPack:index===0?2:1}))};
  const quote=resolver({categoryId:'80719',product,content,options:bundled,settings:changedSettings});
  const row=quote.rows.find(row=>row.optionId===options.rows[0].id);
  assert.deepEqual(['supplyPrice','salePrice','msrp'].map(key=>row.fields[key].value),['35840','59730','77650']);
  const manual=resolver({categoryId:'80719',product,content,options:bundled,settings:changedSettings,overrides:{common:{},options:{[row.optionId]:{supplyPrice:'',salePrice:'60000'}}}}).rows.find(item=>item.optionId===row.optionId);
  assert.equal(manual.fields.supplyPrice.value,'');assert.equal(manual.fields.salePrice.value,'60000');assert.equal(manual.fields.msrp.value,'77650');
  assert.equal(product.supplier_hub_status,'미전송');
 }finally{s.sqlite.close();}
});
test('structured collection attributes preserve facts without guessing or claiming translation',()=>{
 const receipt={...result,options:[{...result.options[0],color:'黑色',size:'S'},result.options[1]]};
 const r=prepare('owner',job,receipt,'p',now);
 assert.equal(r.options.rows[0].color,'黑色');assert.equal(r.options.rows[0].size,'S');
 assert.equal(r.options.rows[0].provenance.color,'collected');assert.equal(r.options.rows[0].provenance.size,'collected');
 assert.equal(r.options.rows[1].color,'');assert.equal(r.options.rows[1].size,'');
 assert.equal(r.options.rows[1].provenance.color,'unverified');
 assert.equal(r.options.rows[0].translatedName,'');
 for(const key of ['color','size'])for(const value of [null,123,'x'.repeat(201),'bad\u0000'])assert.throws(()=>prepare('owner',job,{...result,options:[{...result.options[0],[key]:value}]},'p',now));
});
test('promotion preserves original facts, captured policy and unverified fields',()=>{const r=prepare('owner',job,result,'p',now);assert.equal(r.product.source_price_cny,3.25);assert.equal(r.product.options_count,2);assert.equal(r.options.rows[0].translatedName,'');assert.equal(r.options.rows[0].unitsPerPack,1);assert.equal(r.options.rows[0].minimumOrderQuantity,2);assert.equal(r.options.rows[0].provenance.originalName,'collected');assert.equal(r.content.seo.title.provenance,'collected');assert.equal(r.content.label.material.value,'');assert.equal(r.product.image_keys,'[]');assert.equal(r.product.supplier_hub_status,'미전송');assert.equal(r.product.seo_status,'대기');assert.equal(r.policy.exchangeRate,settings.exchangeRate);});
test('promotion rejects missing context or malformed SKU and obeys disabled minimum margin',()=>{assert.throws(()=>prepare('owner',{...job,context:null},result,'p',now));assert.throws(()=>prepare('owner',job,{...result,options:[{...result.options[0],minimumOrder:1e12}]},'p',now));const r=prepare('owner',{...job,context:{...job.context,settings:{...settings,minimumMarginEnabled:false}}},result,'p',now);assert.equal(r.policy.minimumMargin,0);});
function storage(files){const sqlite=memoryDatabase();for(const statement of runtimeDDL())sqlite.exec(statement.sql);
 sqlite.prepare('INSERT INTO collection_jobs VALUES (?,?,?,?,?,?,?,?)').run(job.id,'owner','123',job.source_url,job.goal,job.status,now,now);
 sqlite.prepare('INSERT INTO collection_context VALUES (?,?)').run(job.id,JSON.stringify(job.context));
 sqlite.prepare('INSERT INTO collection_results VALUES (?,?,?,?)').run(job.id,'owner',JSON.stringify(result),now);
 const db={prepare(sql){let args=[];const q={bind(...v){args=v;return q;},execute(){return sqlite.prepare(sql).all(...args);},async first(){return q.execute()[0]??null;},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(s=>({results:s.execute()}));sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const deps={'cloudflare:workers':{env:{DB:db,FILES:files}},'@/db/queries':{ensureDatabase:async()=>{},findProduct:async(owner,id,excludeRemoved=false)=>sqlite.prepare(`SELECT p.*, (SELECT payload FROM product_price_policy WHERE product_id=p.id) AS pricing_policy FROM products p
   WHERE p.owner_id=? AND p.id=?${excludeRemoved?' AND NOT EXISTS(SELECT 1 FROM product_removals r WHERE r.product_id=p.id AND r.owner_id=p.owner_id)':''}`).get(owner,id)??null},'@/db/product-options':{readProductOptions:async()=>{}},'@/db/product-content':{readProductContent:async()=>{}}};return {sqlite,...load('db/collection-products.ts',deps),jobs:load('db/collection-jobs.ts',deps)};}
test('transaction creates all companion rows once and retry preserves manual edits',async()=>{const s=storage();const first=await s.promoteCollection('owner',job,result);s.sqlite.prepare('UPDATE products SET title=? WHERE id=?').run('수동 수정',first.product_id);const second=await s.promoteCollection('owner',job,result);assert.equal(first.product_id,second.product_id);for(const table of ['products','product_options','product_content','product_price_policy','collection_products'])assert.equal(s.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n,1);assert.equal(s.sqlite.prepare('SELECT title FROM products').get().title,'수동 수정');assert.equal(await s.jobs.cancelCollection('owner',job.id),null);assert.equal(s.sqlite.prepare('SELECT status FROM collection_jobs').get().status,'awaiting_connector');s.sqlite.close();});
test('failed companion insert rolls back product and all earlier writes',async()=>{const s=storage();s.sqlite.exec("CREATE TRIGGER fail_content BEFORE INSERT ON product_content BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");await assert.rejects(()=>s.promoteCollection('owner',job,result));for(const table of ['products','product_options','product_price_policy','collection_products'])assert.equal(s.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);s.sqlite.exec('DROP TRIGGER fail_content');assert.ok((await s.promoteCollection('owner',job,result)).product_id);s.sqlite.close();});
test('cancellation, other owner and changed receipt/context create no products',async()=>{for(const mutation of ['cancel','owner','receipt','context']){const s=storage();if(mutation==='cancel')s.sqlite.exec("UPDATE collection_jobs SET status='cancelled'");if(mutation==='receipt')s.sqlite.exec("UPDATE collection_results SET payload='{}'");if(mutation==='context')s.sqlite.exec("UPDATE collection_context SET payload='{}'");await assert.rejects(()=>s.promoteCollection(mutation==='owner'?'other':'owner',job,result));assert.equal(s.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);s.sqlite.close();}});
test('production API rejects unverified requests before any product read or write',async()=>{
 let calls=0;const forbidden=async()=>{calls++;throw Error('unverified request must not read or write');};
 const api=load('app/api/collection-jobs/[id]/product/route.ts',{'@/app/chatgpt-auth':{getChatGPTUser:async()=>null,getWorkspaceOwnerId:forbidden},'@/db/queries':{findProduct:forbidden},'@/db/collection-jobs':{findCollectionJob:forbidden},'@/db/collection-results':{readCollectionResult:forbidden},'@/db/collection-products':{findCollectionProduct:forbidden,promoteCollection:forbidden}},'production');
 const r=await api.POST(new Request('https://example.test',{method:'POST'}),{params:Promise.resolve({id:'job'})});assert.equal(r.status,503);assert.match((await r.json()).error,/운영 인증 연결/);assert.equal(calls,0);
});

test('promotion retries refuse a removed owned product without changing its original source, companion rows or clock',async()=>{
 const s=storage();try{
  const saved=await s.promoteCollection('owner',job,result);
  const product=s.sqlite.prepare('SELECT * FROM products WHERE id=?').get(saved.product_id);
  const tables=['products','product_price_policy','product_content','product_options','collection_jobs','collection_context','collection_results','collection_products'];
  const snapshot=()=>JSON.stringify(Object.fromEntries(tables.map(table=>[table,s.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
  const before=snapshot();
  s.sqlite.prepare('INSERT INTO product_removals(product_id,owner_id,removed_at,product_version) VALUES(?,?,?,?)').run(saved.product_id,'owner',now,product.updated_at);
  await assert.rejects(()=>s.promoteCollection('owner',job,result),/삭제된 상품/);assert.equal(snapshot(),before);
  assert.equal(s.sqlite.prepare('SELECT updated_at FROM products WHERE id=?').get(saved.product_id).updated_at,product.updated_at);
 }finally{s.sqlite.close();}
});

test('promotion persists supplier stock by SKU including zero without changing quotation inclusion',async()=>{
 const s=storage();const saved=await s.promoteCollection('owner',job,result);
 const options=JSON.parse(s.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(saved.product_id).payload);
 assert.equal(options.rows[0].supplierSku,'a');assert.equal(options.rows[0].stock,null);assert.equal(options.rows[0].provenance.stock,'unverified');
 assert.equal(options.rows[1].supplierSku,'b');assert.equal(options.rows[1].stock,0);assert.equal(options.rows[1].provenance.stock,'collected');assert.equal(options.rows[1].included,true);
 const changed={...options,rows:options.rows.map(row=>({...row,stock:17,provenance:{...row.provenance,stock:'manual'}}))};
 s.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(changed),saved.product_id);
 await s.promoteCollection('owner',job,result);
 assert.equal(JSON.parse(s.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(saved.product_id).payload).rows[1].stock,17);
 s.sqlite.close();
});


test('collection captures selected banners without changing originals and ignores disabled banners',()=>{
 const captured={...job,context:{...job.context,settings:{...settings,topImageEnabled:true,topImageKey:'owner/top.png',bottomImageEnabled:true,bottomImageKey:'owner/bottom.png'}}};
 const before=JSON.stringify(captured);const prepared=prepare('owner',captured,result,'p',now);
 assert.equal(prepared.product.image_keys,JSON.stringify(['owner/top.png','owner/bottom.png']));
 assert.equal(prepared.content.assets.detailTop.value[0],'owner/top.png');assert.equal(prepared.content.assets.detailBottom.value[0],'owner/bottom.png');
 assert.equal(prepared.content.assets.detail.value.length,0);assert.equal(JSON.stringify(captured),before);
 captured.context.settings.topImageKey='owner/new.png';assert.equal(prepared.content.assets.detailTop.value[0],'owner/top.png');
 captured.context.settings.topImageEnabled=false;assert.equal(prepare('owner',captured,result,'p',now).content.assets.detailTop.value.length,0);
 captured.context.settings.bottomImageKey='other/private.png';assert.throws(()=>prepare('owner',captured,result,'p',now));
});


test('banner verification precedes atomic promotion and completed retries preserve the captured file',async()=>{
 let available=false,reads=0;
 const s=storage({get:async()=>{reads++;return available?{size:8,body:new Response(new Uint8Array([137,80,78,71,13,10,26,10])).body}:null;}});
 const captured={...job,context:{...job.context,settings:{...settings,topImageEnabled:true,topImageKey:'owner/top.png'}}};
 s.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(captured.context));
 await assert.rejects(()=>s.promoteCollection('owner',captured,result));assert.equal(s.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
 available=true;const saved=await s.promoteCollection('owner',captured,result);
 assert.equal(s.sqlite.prepare('SELECT image_keys FROM products').get().image_keys,'["owner/top.png"]');
 assert.equal(JSON.parse(s.sqlite.prepare('SELECT payload FROM product_content').get().payload).assets.detailTop.value[0],'owner/top.png');
 const checked=reads;available=false;
 assert.equal((await s.promoteCollection('owner',captured,result)).product_id,saved.product_id);assert.equal(reads,checked);s.sqlite.close();
});

test('promotion initializes label business fields from captured settings including explicit blanks',()=>{
 const captured={...job,context:{...job.context,settings:{...settings,manufacturer:'등록 제조사',importer:'등록 수입원',serviceContact:''}}};
 const before=JSON.stringify(captured),prepared=prepare('owner',captured,result,'p',now);
 for(const [key,value] of [['manufacturer','등록 제조사'],['importer','등록 수입원'],['contact','']]){
  assert.equal(prepared.content.label[key].value,value);assert.equal(prepared.content.label[key].provenance,'manual');
  assert.equal(prepared.content.label[key].updatedAt,now);
 }
 for(const key of ['material','certification','kcInformation'])assert.equal(prepared.content.label[key].provenance,'unverified');
 assert.equal(JSON.stringify(captured),before);
 const sparse={...captured,context:{...captured.context,settings:{...captured.context.settings}}};
 for(const key of ['manufacturer','importer','serviceContact'])delete sparse.context.settings[key];
 const legacy=prepare('owner',sparse,result,'p',now);
 for(const key of ['manufacturer','importer','contact']){assert.equal(legacy.content.label[key].value,'');assert.equal(legacy.content.label[key].provenance,'unverified');}
});

test('promotion retry preserves edited label business fields instead of restoring captured settings',async()=>{
 const s=storage();
 try{
  const saved=await s.promoteCollection('owner',job,result);
  const read=()=>JSON.parse(s.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(saved.product_id).payload);
  const content=read();assert.equal(content.label.manufacturer.value,settings.manufacturer);
  content.label.manufacturer={value:'',provenance:'manual',updatedAt:now};content.label.importer.value='수정 수입원';
  s.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content),saved.product_id);
  await s.promoteCollection('owner',job,result);
  assert.equal(read().label.manufacturer.value,'');assert.equal(read().label.importer.value,'수정 수입원');
 }finally{s.sqlite.close();}
});

test('captured company labels feed quotation fields even after workspace defaults change',()=>{
 const captured={...job,context:{...job.context,settings:{...settings,manufacturer:'당시 제조사',importer:'당시 수입원',serviceContact:''}}};
 const p=prepare('owner',captured,result,'p',now);
 const {resolveQuotationFields}=load('app/quotation-schema.ts');
 const resolved=resolveQuotationFields({categoryId:'80719',product:p.product,content:p.content,options:p.options,settings:{...settings,manufacturer:'새 제조사',importer:'새 수입원',serviceContact:'새 연락처'}});
 for(const row of resolved.rows.filter(row=>row.included)){
  assert.equal(row.fields.manufacturer.value,'당시 제조사');
  assert.equal(row.fields.noticeManufacturerImporter.value,'제조자: 당시 제조사 / 수입자: 당시 수입원');
  assert.equal(row.fields.noticeServiceContact.value,'');
  assert.equal(row.fields.noticeServiceContact.source,'content');
 }
});

test('captured target keywords populate SEO and category quotation tags without inventing translated keywords',()=>{
 const captured={...job,context:{...job.context,keywords:' 빨강, 수납 가방\n빨강, 轻便 ',features:'feature must not replace source description'}};
 const r=prepare('owner',captured,result,'p',now);
 assert.deepEqual(Array.from(r.content.seo.keywords.value),['빨강','수납 가방','轻便']);
 assert.equal(r.content.seo.keywords.provenance,'manual');assert.equal(r.content.seo.description.value,result.description);
 const resolve=load('app/quotation-schema.ts').resolveQuotationFields;
 for(const categoryId of ['80719','81452','64497','103495']){
  const quote=resolve({categoryId,product:r.product,content:r.content,options:r.options,settings});
  assert.ok(quote.rows.every(row=>row.fields.searchTags.value==='빨강, 수납 가방, 轻便'));
 }
 assert.deepEqual(Array.from(prepare('owner',job,result,'p',now).content.seo.keywords.value),[]);
});
test('keyword promotion never silently truncates invalid captured input',()=>{
 for(const keywords of ['x'.repeat(101),Array.from({length:51},(_,i)=>'k'+i).join(','),'bad\u0000']){
  assert.throws(()=>prepare('owner',{...job,context:{...job.context,keywords}},result,'p',now),/키워드/);
 }
});

test('stored target keyword draft survives promotion retry after manual SEO editing',async()=>{
 const s=storage();const captured={...job,context:{...job.context,keywords:'원본, 검색어'}};
 try {
 s.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(captured.context),job.id);
 const saved=await s.promoteCollection('owner',captured,result);
 const read=()=>JSON.parse(s.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(saved.product_id).payload);
 const content=read();assert.deepEqual(content.seo.keywords.value,['원본','검색어']);
 content.seo.keywords.value=[];content.seo.keywords.provenance='manual';
 s.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content),saved.product_id);
 await s.promoteCollection('owner',captured,result);assert.deepEqual(read().seo.keywords.value,[]);
 } finally {s.sqlite.close();}
});

test('collection creates category-scoped review defaults before opening stage six and keeps SEO name linked',()=>{
 const captured={...job,context:{...job.context,category:{...job.context.category,categoryId:'80719'}}};
 const prepared=prepare('owner',captured,result,'p',now);
 assert.equal(prepared.content.label.productName.value,result.title);
 assert.equal(prepared.content.labelProductNameLinked,true);
 assert.equal(prepared.content.label.countryOfOrigin.value,'중국');
 assert.equal(prepared.content.label.precautions.value,'용도 외에 사용금지. 파손및화기주의');
 assert.equal(prepared.content.label.usageStandard.value,'14세이상');
 assert.equal(prepared.content.label.countryOfOrigin.provenance,'generated');
 assert.equal(prepared.content.label.material.value,'');
 const resolve=load('app/quotation-schema.ts').resolveQuotationFields;
 const quote=content=>resolve({categoryId:'80719',product:prepared.product,content,options:prepared.options,settings});
 assert.equal(quote(prepared.content).rows[0].fields.noticeCountryOfOrigin.value,'중국');
 const {applyContentPatch}=load('app/product-content.ts');
 const updated=applyContentPatch(prepared.content,{seo:{title:'검토한 상품명'}},'2026-01-02T00:00:00Z');
 assert.equal(updated.label.productName.value,'검토한 상품명');
 assert.equal(quote(updated).rows[0].fields.noticeNameModel.value,'검토한 상품명');
 assert.equal(prepared.product.supplier_hub_status,'미전송');
 for(const categoryId of ['81452','999999']){
  const other=prepare('owner',{...captured,context:{...captured.context,category:{...captured.context.category,categoryId,categoryPath:categoryId==='81452'?load('app/quotation-schema.ts').getQuotationSchema(categoryId).categoryPath:['미확인 카테고리']}}},result,'p',now);
  assert.equal(other.content.label.countryOfOrigin.value,'');assert.equal(other.content.label.precautions.value,'');assert.equal(other.content.label.usageStandard.value,'');
 }
});

test('retrying imported source never restores defaults over reviewed label or explicit blank',async()=>{
 const s=storage();try{
  const captured={...job,context:{...job.context,category:{...job.context.category,categoryId:'80719'}}};
  s.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(captured.context),job.id);
  const saved=await s.promoteCollection('owner',captured,result);
  const content=JSON.parse(s.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(saved.product_id).payload);
  content.label.countryOfOrigin={value:'',provenance:'manual',updatedAt:now};content.label.productName={value:'검토 완료 품명',provenance:'manual',updatedAt:now};content.labelProductNameLinked=false;
  s.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content),saved.product_id);
  await s.promoteCollection('owner',captured,result);
  const current=JSON.parse(s.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(saved.product_id).payload);
  assert.equal(current.label.countryOfOrigin.value,'');assert.equal(current.label.productName.value,'검토 완료 품명');assert.equal(current.labelProductNameLinked,false);
 }finally{s.sqlite.close();}
});

test('sparse captured business settings never inherit later registration facts in quotation',()=>{
 const current={...settings,brand:'나중 브랜드',manufacturer:'나중 제조사',importer:'나중 수입원',serviceContact:'나중 연락처',tradeType:'공식대리점',importType:'병행수입상품',taxType:'면세',boxSkuQuantity:999,exchangeRate:777};
 const resolveSettings=load('app/collection-registration-settings.ts').collectionRegistrationSettings;
 const resolved=resolveSettings(current,{manufacturer:'당시 제조사'});
 for(const key of ['brand','importer','serviceContact','tradeType','importType','taxType'])assert.equal(resolved[key],'',key);
 assert.equal(resolved.manufacturer,'당시 제조사');assert.equal(resolved.boxSkuQuantity,1);assert.equal(resolved.exchangeRate,777);
 const prepared=prepare('owner',job,result,'p',now);
 const quote=load('app/quotation-schema.ts').resolveQuotationFields({categoryId:'80719',product:prepared.product,content:load('app/product-content.ts').emptyProductContent('p'),options:prepared.options,settings:resolved});
 assert.equal(quote.rows[0].fields.brand.value,'');assert.equal(quote.rows[0].fields.manufacturer.value,'당시 제조사');
 assert.equal(resolveSettings(current,null).brand,'나중 브랜드','products without any captured context keep workspace behavior');
 assert.equal(current.brand,'나중 브랜드');
});

test('promotion revalidates captured category identity before building any product draft',()=>{
 const before=JSON.stringify(job);
 for(const category of [
  {id:'cat'}, {...job.context.category,categoryId:'bad/code'},
  {...job.context.category,categoryPath:[]}, {...job.context.category,categoryPath:['바스켓']},
  {...job.context.category,categoryId:'81467'}, {...job.context.category,categoryPath:[null]},
 ])assert.throws(()=>prepare('owner',{...job,context:{...job.context,category}},result,'p',now),/카테고리/);
 assert.equal(JSON.stringify(job),before);
 assert.equal(prepare('owner',job,result,'p',now).product.supplier_hub_status,'미전송');
});

test('invalid captured category cannot create storage rows and never alters an already linked product',async()=>{
 const s=storage();try{
  const invalid={...job,context:{...job.context,category:{...job.context.category,categoryPath:['다른 카테고리']}}};
  await assert.rejects(()=>s.promoteCollection('owner',invalid,result),/카테고리/);
  assert.equal(s.sqlite.prepare('SELECT count(*) AS n FROM products').get().n,0);
  assert.equal(s.sqlite.prepare('SELECT count(*) AS n FROM collection_products').get().n,0);
  const saved=await s.promoteCollection('owner',job,result);
  const before=s.sqlite.prepare('SELECT * FROM products').all();
  const reused=await s.promoteCollection('owner',invalid,result);
  assert.equal(reused.product_id,saved.product_id);
  assert.deepEqual(s.sqlite.prepare('SELECT * FROM products').all(),before);
 }finally{s.sqlite.close();}
});
