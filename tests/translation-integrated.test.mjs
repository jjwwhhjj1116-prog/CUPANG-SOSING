import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
function load(file,overrides={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,structuredClone,Error,crypto,TextEncoder,TextDecoder,Response,URL,process:{env:{NODE_ENV:'development'}},require:name=>name in overrides?overrides[name]:name==='@/db/quotation-attribute-rules'?{getAttributeRules:async()=>null}:name==='next/server'?{NextResponse:{json:(body,init)=>Response.json(body,init)}}:load(name.slice(2)+'.ts',overrides)});return exports;}
const cm=load('app/product-content.ts'),om=load('app/product-options.ts');
const model=load('app/translation-integrated-adoption.ts');
const version='2026-09-25T00:00:00.000Z',nextVersion='2026-09-25T00:00:01.000Z',jobId='11111111-1111-4111-8111-111111111111';
function fixture(){
 const content=cm.emptyProductContent('p');
 const options=om.applyOptionRows(om.emptyProductOptions('p'),[{...om.emptyOptionInput('red'),originalName:'红色',unitCostCny:3,included:true,color:'红色'}],version);
 options.rows[0].provenance.color='collected';
 const job={id:jobId,productId:'p',productVersion:version,contentRevision:0,status:'completed',review:{source:{attributes:[{name:'상품속성: 材质',value:'棉'},{name:'option:red',value:'红色'},{name:'option-color:red',value:'红色'}]}},result:{draft:{title:'한국어 상품',description:'한국어 설명',keywords:['검색어'],attributes:[{sourceIndex:0,name:'재질',value:'면'},{sourceIndex:1,name:'옵션',value:'빨강 옵션'},{sourceIndex:2,name:'색상',value:'빨강'}]}}};
 return {content,options,job};
}
function harness(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`CREATE TABLE products(id TEXT PRIMARY KEY,owner_id TEXT,updated_at TEXT,image_keys TEXT,quote_status TEXT,options_count INTEGER);
 CREATE TABLE product_content(product_id TEXT PRIMARY KEY,owner_id TEXT,revision INTEGER,payload TEXT,updated_at TEXT);
 CREATE TABLE product_options(product_id TEXT PRIMARY KEY,owner_id TEXT,revision INTEGER,payload TEXT,updated_at TEXT);
 CREATE TABLE quotation_attribute_rules(owner_id TEXT,category_id TEXT,payload TEXT); CREATE TABLE translation_jobs(id TEXT PRIMARY KEY,owner_id TEXT,product_id TEXT,status TEXT,product_version TEXT,content_revision INTEGER);`);
 sqlite.prepare('INSERT INTO products VALUES (?,?,?,?,?,?)').run('p','owner',version,'[]','대기',1);
 sqlite.prepare('INSERT INTO translation_jobs VALUES (?,?,?,?,?,?)').run(jobId,'owner','p','completed',version,0);
 const data=fixture();sqlite.prepare('INSERT INTO product_options VALUES (?,?,?,?,?)').run('p','owner',1,JSON.stringify(data.options),version);
 const db={prepare(sql){let args=[];return {bind(...a){args=a;return this;},execute(){return sqlite.prepare(sql).all(...args);}};},async batch(queries){sqlite.exec('BEGIN');try{const result=queries.map(q=>({results:q.execute()}));sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 return {sqlite,data,store:load('db/translation-adoption.ts',{'cloudflare:workers':{env:{DB:db}}})};
}
test('one plan binds SEO labels and options, preserves manual blanks and rejects incompatible originals',()=>{
 const data=fixture(),before=JSON.stringify(data);
 const plan=model.integratedTranslationPlan(data.content,data.options,data.job,version);
 assert.equal(plan.patch.seo.title,'한국어 상품');assert.equal(plan.patch.label.material,'면');assert.equal(plan.rows[0].translatedName,'빨강 옵션');assert.equal(plan.rows[0].color,'빨강');assert.equal(plan.rows[0].unitCostCny,3);assert.equal(JSON.stringify(data),before);
 data.content.seo.title={value:'',provenance:'manual',updatedAt:version};data.options.rows[0].provenance.translatedName='manual';
 const manual=model.integratedTranslationPlan(data.content,data.options,data.job,version);assert.equal(manual.patch.seo.title,undefined);assert.equal(manual.rows[0].translatedName,'');
 data.options.rows[0].color='改变';assert.throws(()=>model.integratedTranslationPlan(data.content,data.options,data.job,version));
 data.options.rows[0].color='红色';data.job.contentRevision=2;assert.throws(()=>model.integratedTranslationPlan(data.content,data.options,data.job,version));
});
test('SQLite commits both documents once and rolls back a failure in the second document',async()=>{
 for(const mode of ['success','failure','stale-content','stale-options','wrong-owner','stale-job']){
  const h=harness();try{
   const {content,options,job}=h.data,plan=model.integratedTranslationPlan(content,options,job,version);
   const nextContent=cm.applyContentPatch(content,plan.patch,nextVersion),nextOptions=om.applyOptionRows(options,plan.rows,nextVersion);
   if(mode==='failure')h.sqlite.exec("CREATE TRIGGER fail_options BEFORE UPDATE ON product_options BEGIN SELECT RAISE(ABORT,'disk failure'); END;");
   if(mode==='stale-content')h.sqlite.prepare('INSERT INTO product_content VALUES (?,?,?,?,?)').run('p','owner',1,'{}',version);
   if(mode==='stale-options')h.sqlite.exec('UPDATE product_options SET revision=2');
   if(mode==='stale-job')h.sqlite.exec("UPDATE translation_jobs SET status='running'");
   const source={productVersion:version,imageKeys:'[]',contentRevision:0,optionRevision:1,jobId};
   const run=()=>h.store.saveIntegratedTranslation(mode==='wrong-owner'?'other':'owner',nextContent,nextOptions,source);
   if(mode==='failure')await assert.rejects(run);else assert.equal(await run(),mode==='success');
   assert.equal(h.sqlite.prepare('SELECT updated_at FROM products').get().updated_at,mode==='success'?nextVersion:version);
   if(mode==='success'){
    assert.equal(JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload).label.material.value,'면');
    assert.equal(JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload).rows[0].translatedName,'빨강 옵션');
    assert.equal(await run(),false);
   }else if(mode!=='stale-content')assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM product_content').get().n,0);
  }finally{h.sqlite.close();}
 }
});
test('API previews without writes, verifies reviewed fingerprint, and applies one free transaction',async()=>{
 const h=harness();try{
  let saves=0;
  const route=load('app/api/products/[id]/translation-apply/route.ts',{
   '@/app/chatgpt-auth':{getWorkspaceOwnerId:async()=> 'owner'},
   '@/db/queries':{findProduct:async()=>({id:'p',owner_id:'owner',updated_at:h.sqlite.prepare('SELECT updated_at FROM products').get().updated_at,image_keys:'[]'})},
   '@/db/product-content':{readProductContent:async()=>h.data.content},'@/db/product-options':{readProductOptions:async()=>h.data.options},
   '@/db/translation-jobs':{getTranslationJob:async()=>h.data.job},
   '@/db/translation-category-source':{readTranslationCategorySource:async()=>{throw Error('legacy job must not read category');}},
   '@/db/translation-adoption':{saveIntegratedTranslation:async(...args)=>{saves++;return h.store.saveIntegratedTranslation(...args);}},
  });
  const context={params:Promise.resolve({id:'p'})};
  const call=body=>route.POST(new Request('https://local/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId,expectedVersion:version,...body})}),context);
  const preview=await call({action:'preview'});assert.equal(preview.status,200);const plan=await preview.json();assert.equal(saves,0);assert.ok(plan.preview.length>4);
  assert.equal((await call({action:'apply',fingerprint:'0'.repeat(64)})).status,409);assert.equal(saves,0);
  const saved=await call({action:'apply',fingerprint:plan.fingerprint});assert.equal(saved.status,200);assert.equal(saves,1);
  const receipt=await saved.json();assert.equal(receipt.contentRevision,1);assert.equal(receipt.optionRevision,2);assert.equal(receipt.applied,plan.preview.length);
  assert.equal((await call({action:'apply',fingerprint:plan.fingerprint})).status,409);assert.equal(saves,1);
 }finally{h.sqlite.close();}
});

test('integrated save records same-value translations and skips them in the next option batch',async()=>{
 const h=harness();try{
  const {content,options,job}=h.data;
  job.result.draft.attributes.find(a=>a.sourceIndex===2).value='红色';
  const before=JSON.stringify(options),plan=model.integratedTranslationPlan(content,options,job,version);
  assert.ok(plan.preview.some(row=>row.name.includes('값 유지')&&row.before==='红色'&&row.after==='红色'));
  const next=model.applyIntegratedOptions(options,plan,nextVersion);
  assert.equal(JSON.stringify(options),before);assert.equal(next.rows[0].color,'红色');assert.equal(next.rows[0].provenance.color,'translated');
  const saved=await h.store.saveIntegratedTranslation('owner',cm.applyContentPatch(content,plan.patch,nextVersion),next,{productVersion:version,imageKeys:'[]',contentRevision:0,optionRevision:1,jobId});
  assert.equal(saved,true);
  const persisted=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
  assert.equal(load('app/option-translation.ts').optionTranslationBatch(persisted).total,0);
  assert.equal(persisted.rows[0].unitCostCny,3);assert.equal(persisted.rows[0].updatedAt,nextVersion);
 }finally{h.sqlite.close();}
});

test('integrated completion never marks manual fields or fields absent from the reviewed result',()=>{
 const {content,options,job}=fixture();
 options.rows[0].color='';options.rows[0].provenance.color='manual';options.rows[0].size='大';options.rows[0].provenance.size='collected';
 const plan=model.integratedTranslationPlan(content,options,job,version),next=model.applyIntegratedOptions(options,plan,nextVersion);
 assert.equal(next.rows[0].color,'');assert.equal(next.rows[0].provenance.color,'manual');assert.equal(next.rows[0].provenance.size,'collected');
 const pending=load('app/option-translation.ts').optionTranslationBatch(next);
 assert.equal(pending.total,1);assert.equal(pending.attributes[0].name,'option-size:red');
});

test('a partial v6 refresh preserves an existing category snapshot when an original product attribute was omitted',()=>{
 const {content,options,job}=fixture();job.review.instructionsVersion='sourceflow-translation-v6';job.review.source.category={id:'80719',path:['주방용품','바스켓']};
 job.review.source.attributes.push({name:'상품속성: shape',value:'方形'});
 content.categoryAttributes={categoryId:'80719',jobId:'previous-review',values:[{sourceName:'상품속성: shape',name:'형태',value:'기존에 검토한 사각형'}],reservedFields:['shape'],bindings:[{fieldId:'shape',fieldSignature:'saved-signature',value:'기존값'}]};
 const before=JSON.stringify(content.categoryAttributes),plan=model.integratedTranslationPlan(content,options,job,version);
 assert.equal(plan.categoryAttributes,undefined);assert.equal(JSON.stringify(content.categoryAttributes),before);assert.ok(plan.skipped.some(message=>message.includes('기존 카테고리 속성')));
 assert.equal(plan.patch.seo.title,'한국어 상품');assert.equal(plan.rows[0].translatedName,'빨강 옵션');
});

test('stored v6 Chinese copies stay pending without replacing labels, category bindings or manual option blanks',()=>{
 const {content,options,job}=fixture();job.review.instructionsVersion='sourceflow-translation-v6';job.review.source.category={id:'80719',path:['주방용품','바스켓']};
 job.review.source.attributes[0].value='棉 검토';job.result.draft.attributes[0].value='棉 검토';
 job.result.draft.attributes[1].value='红色';job.result.draft.attributes[2].value='红色';
 content.label.material={value:'기존 검토 재질',provenance:'translated',updatedAt:version};
 content.categoryAttributes={categoryId:'80719',jobId:'previous',values:[{name:'재질',value:'기존 검토 재질'}],reservedFields:['material'],bindings:[{fieldId:'material',fieldSignature:'saved-signature',value:'기존 검토 재질'}]};
 const before=JSON.stringify({content,options,job}),plan=model.integratedTranslationPlan(content,options,job,version),next=model.applyIntegratedOptions(options,plan,nextVersion);
 assert.equal(plan.patch?.label?.material,undefined);assert.equal(plan.categoryAttributes,undefined);assert.equal(plan.reviewedOptions.length,0);
 assert.equal(next.rows[0].translatedName,'');assert.equal(next.rows[0].color,'红色');assert.equal(next.rows[0].provenance.color,'collected');
 assert.match(plan.skipped.join(' '),/3개.*기존 값/);assert.equal(load('app/option-translation.ts').optionTranslationBatch(next).total,2);
 assert.equal(JSON.stringify({content,options,job}),before);
 options.rows[0].provenance.translatedName='manual';options.rows[0].color='';options.rows[0].provenance.color='manual';
 const manual=model.integratedTranslationPlan(content,options,job,version);assert.equal(manual.rows[0].translatedName,'');assert.equal(manual.rows[0].color,'');
 options.rows[0].included=false;
 const excluded=model.integratedTranslationPlan(content,options,job,version);assert.equal(excluded.reviewedOptions.length,0);assert.equal(excluded.rows[0].included,false);assert.equal(excluded.rows[0].id,'red');
});

test('stored v6 measurement swaps cannot mark an option completed or replace a reviewed category binding',()=>{
 const {content,options,job}=fixture();job.review.instructionsVersion='sourceflow-translation-v6';job.review.source.category={id:'80719',path:['주방용품','바스켓']};
 options.rows[0].size='10 cm';options.rows[0].provenance.size='collected';
 job.review.source.attributes.push({name:'option-size:red',value:'10 cm'},{name:'상품속성: 长度',value:'20 cm'});
 job.result.draft.attributes.push({sourceIndex:3,name:'option-size:red',value:'20 cm'},{sourceIndex:4,name:'길이',value:'10 cm'});
 content.categoryAttributes={categoryId:'80719',jobId:'previous',values:[{name:'길이',value:'검토한 20 cm'}],reservedFields:['length'],bindings:[{fieldId:'length',fieldSignature:'saved-signature',value:'20 cm'}]};
 const before=JSON.stringify({content,options,job}),plan=model.integratedTranslationPlan(content,options,job,version),next=model.applyIntegratedOptions(options,plan,nextVersion);
 assert.equal(plan.categoryAttributes,undefined);assert.equal(next.rows[0].size,'10 cm');assert.equal(next.rows[0].provenance.size,'collected');
 assert.ok(plan.reviewedOptions.every(item=>item.field!=='size'));assert.match(plan.skipped.join(' '),/2개.*기존 값/);
 assert.equal(load('app/option-translation.ts').adoptOptionTranslations(options,job,version).rows[0].size,'10 cm');
 assert.equal(JSON.stringify({content,options,job}),before);
});

test('option-only API binds scope, preserves SEO and labels and persists verified options',async()=>{
 const h=harness();try{
  let saves=0;
  const route=load('app/api/products/[id]/translation-apply/route.ts',{
   '@/app/chatgpt-auth':{getWorkspaceOwnerId:async()=> 'owner'},
   '@/db/queries':{findProduct:async()=>({id:'p',owner_id:'owner',updated_at:h.sqlite.prepare('SELECT updated_at FROM products').get().updated_at,image_keys:'[]'})},
   '@/db/product-content':{readProductContent:async()=>h.data.content},'@/db/product-options':{readProductOptions:async()=>h.data.options},
   '@/db/translation-jobs':{getTranslationJob:async()=>h.data.job},
   '@/db/translation-category-source':{readTranslationCategorySource:async()=>{throw Error('legacy job must not read category');}},
   '@/db/translation-adoption':{saveIntegratedTranslation:async(...args)=>{saves++;return h.store.saveIntegratedTranslation(...args);}},
  });
  const context={params:Promise.resolve({id:'p'})};
  const call=body=>route.POST(new Request('https://local/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId,expectedVersion:version,scope:'options',...body})}),context);
  const preview=await call({action:'preview'});assert.equal(preview.status,200);const plan=await preview.json();assert.equal(saves,0);assert.equal(plan.preview.length,2);assert.equal(plan.scope,'options');
  assert.equal((await call({action:'preview',scope:'invalid'})).status,400);
  assert.equal((await call({action:'apply',scope:'all',fingerprint:plan.fingerprint})).status,409);assert.equal(saves,0);
  assert.equal((await call({action:'apply',fingerprint:'0'.repeat(64)})).status,409);assert.equal(saves,0);
  const saved=await call({action:'apply',fingerprint:plan.fingerprint});assert.equal(saved.status,200);assert.equal(saves,1);
  const receipt=await saved.json();assert.equal(receipt.contentRevision,1);assert.equal(receipt.optionRevision,2);assert.equal(receipt.applied,plan.preview.length);assert.equal(receipt.scope,'options');
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  assert.deepEqual(content.seo,JSON.parse(JSON.stringify(h.data.content.seo)));assert.deepEqual(content.label,JSON.parse(JSON.stringify(h.data.content.label)));
  const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
  assert.equal(options.rows[0].color,'빨강');assert.equal(options.rows[0].provenance.color,'translated');
  assert.equal((await call({action:'apply',fingerprint:plan.fingerprint})).status,409);assert.equal(saves,1);
 }finally{h.sqlite.close();}
});

function collectionTables(h){
 h.sqlite.exec('CREATE TABLE collection_products(product_id TEXT,owner_id TEXT,job_id TEXT); CREATE TABLE collection_jobs(id TEXT,owner_id TEXT,offer_id TEXT,status TEXT,updated_at TEXT); CREATE TABLE collection_context(job_id TEXT,payload TEXT);');
 const snapshot={id:'intake',linked:true,updatedAt:version,payload:JSON.stringify({category:{name:'바구니',categoryId:'80719',categoryPath:['주방용품','바구니'],template:null,mappings:[]}})};
 h.sqlite.prepare('INSERT INTO collection_products VALUES (?,?,?)').run('p','owner','intake');
 h.sqlite.prepare('INSERT INTO collection_jobs VALUES (?,?,?,?,?)').run('intake','owner','813724060928','awaiting_connector',version);
 h.sqlite.prepare('INSERT INTO collection_context VALUES (?,?)').run('intake',snapshot.payload);
 return {offerId:'813724060928',snapshot};
}

test('integrated category guard commits atomically and rejects a changed link, owner, source or cancellation',async()=>{
 for(const mode of ['success','payload','link','owner','cancel','time','new-link','still-unlinked']){
  const h=harness();try{
   let categorySource=collectionTables(h);
   const plan=model.integratedTranslationPlan(h.data.content,h.data.options,h.data.job,version);
   const content=cm.applyContentPatch(h.data.content,plan.patch,nextVersion),options=model.applyIntegratedOptions(h.data.options,plan,nextVersion);
   if(mode==='payload')h.sqlite.exec("UPDATE collection_context SET payload='{}'");
   if(mode==='link')h.sqlite.exec("UPDATE collection_products SET job_id='different'");
   if(mode==='owner')h.sqlite.exec("UPDATE collection_jobs SET owner_id='other'");
   if(mode==='cancel')h.sqlite.exec("UPDATE collection_jobs SET status='cancelled'");
   if(mode==='time')h.sqlite.exec("UPDATE collection_jobs SET updated_at='changed'");
   if(mode==='new-link'||mode==='still-unlinked')categorySource={offerId:categorySource.offerId,snapshot:null};
   if(mode==='still-unlinked')h.sqlite.exec('DELETE FROM collection_products');
   const expected=mode==='success'||mode==='still-unlinked';
   const saved=await h.store.saveIntegratedTranslation('owner',content,options,{productVersion:version,imageKeys:'[]',contentRevision:0,optionRevision:1,jobId,categorySource});
   assert.equal(saved,expected,mode);
   assert.equal(h.sqlite.prepare('SELECT updated_at FROM products').get().updated_at,expected?nextVersion:version,mode);
   assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM product_content').get().n,expected?1:0,mode);
   assert.equal(h.sqlite.prepare('SELECT revision FROM product_options').get().revision,expected?2:1,mode);
  }finally{h.sqlite.close();}
 }
});

test('category source uses exact product intake and refuses mismatched or malformed captured categories',async()=>{
 const h=harness();try{
  const source=collectionTables(h);let snapshot=source.snapshot;const calls=[];
  const reader=load('db/translation-category-source.ts',{'@/db/quotation-fields':{readQuotationCollectionSource:async(...args)=>{calls.push(args);return snapshot;}}}).readTranslationCategorySource;
  const result=await reader('owner','p','https://detail.1688.com/offer/813724060928.html','80719');
  assert.equal(result.snapshot.payload,snapshot.payload);assert.deepEqual(calls[0],['owner','813724060928','p']);
  await assert.rejects(()=>reader('owner','p','https://detail.1688.com/offer/813724060928.html','81452'),/카테고리/);
  snapshot={...snapshot,payload:'{}'};await assert.rejects(()=>reader('owner','p','https://detail.1688.com/offer/813724060928.html','80719'));
  snapshot=null;assert.equal((await reader('owner','p','https://detail.1688.com/offer/813724060928.html','80719')).snapshot,null);
 }finally{h.sqlite.close();}
});

test('category-aware integrated preview rejects wrong category and invalidates changed intake before saving',async()=>{
 const h=harness();try{
  const source=collectionTables(h);let snapshot=source.snapshot,saves=0;
  h.data.job.review.source.category={id:'81452',path:['다른 분류']};
  const reader=load('db/translation-category-source.ts',{'@/db/quotation-fields':{readQuotationCollectionSource:async()=>snapshot}});
  const route=load('app/api/products/[id]/translation-apply/route.ts',{
   '@/app/chatgpt-auth':{getWorkspaceOwnerId:async()=> 'owner'},
   '@/db/queries':{findProduct:async()=>({id:'p',updated_at:version,image_keys:'[]',source_url:'https://detail.1688.com/offer/813724060928.html'})},
   '@/db/product-content':{readProductContent:async()=>h.data.content},'@/db/product-options':{readProductOptions:async()=>h.data.options},
   '@/db/translation-jobs':{getTranslationJob:async()=>h.data.job},'@/db/translation-category-source':reader,
   '@/db/translation-adoption':{saveIntegratedTranslation:async(...args)=>{saves++;return h.store.saveIntegratedTranslation(...args);}},
  });
  const call=body=>route.POST(new Request('https://local/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId,expectedVersion:version,...body})}),{params:Promise.resolve({id:'p'})});
  for(const scope of ['all','options'])assert.equal((await call({action:'preview',scope})).status,409);
  assert.equal(saves,0);h.data.job.review.source.category.id='80719';
  const preview=await call({action:'preview'});assert.equal(preview.status,200);const plan=await preview.json();
  snapshot={...snapshot,updatedAt:'changed'};
  assert.equal((await call({action:'apply',fingerprint:plan.fingerprint})).status,409);assert.equal(saves,0);
  snapshot=source.snapshot;
  assert.equal((await call({action:'apply',fingerprint:plan.fingerprint})).status,200);assert.equal(saves,1);
 }finally{h.sqlite.close();}
});

test('integrated source attributes are category scoped and option batches cannot replace them',()=>{
 const {content,options,job}=fixture();job.review.source.category={id:'80719',path:['주방용품']};
 const plan=model.integratedTranslationPlan(content,options,job,version);
 assert.equal(plan.categoryAttributes.categoryId,'80719');assert.equal(plan.categoryAttributes.jobId,job.id);
 assert.equal(plan.categoryAttributes.values.length,1);assert.equal(plan.categoryAttributes.values[0].name,'재질');
 content.categoryAttributes=plan.categoryAttributes;
 assert.equal(model.integratedTranslationPlan(content,options,job,version,'options').categoryAttributes,undefined);
 delete job.review.source.category;assert.equal(model.integratedTranslationPlan(content,options,job,version).categoryAttributes,undefined);
});

test('saved rules reserve sources and destinations, preserve empty choices and reject stale signatures',()=>{
 const schema=load('app/quotation-schema.ts').getQuotationSchema('80719');
 const field=schema.fields.find(f=>f.id==='basketShape');
 const rule={format:'sourceflow-attribute-rules-v1',categoryId:'80719',rules:[{sourceName:'상품속성: 形状',fieldId:field.id,fieldSignature:JSON.stringify(field)}]};
 const snapshot={categoryId:'80719',jobId:'j',values:[{sourceName:'상품속성: 形状',name:'상품 모양',value:'사각형'},{sourceName:'상품속성: other',name:'바구니 형태',value:'원형'}]};
 const helper=load('app/intake-attribute-rules.ts').applyIntakeAttributeRules;
 const applied=helper(snapshot,JSON.stringify(rule));assert.equal(applied.snapshot.bindings[0].value,'사각형');assert.equal(applied.snapshot.values.length,1);assert.equal(applied.snapshot.reservedFields[0],'basketShape');
 snapshot.values[0].value='해당사항없음';assert.equal(helper(snapshot,JSON.stringify(rule)).snapshot.bindings[0].value,'');
 snapshot.values[0].value='invalid';assert.equal(helper(snapshot,JSON.stringify(rule)).snapshot.bindings.length,0);assert.equal(helper(snapshot,JSON.stringify(rule)).snapshot.reservedFields[0],'basketShape');
 rule.rules[0].fieldSignature='stale';assert.throws(()=>helper(snapshot,JSON.stringify(rule)),/양식이 변경/);
});

test('atomic adoption rejects newly added or changed attribute rules during save',async()=>{
 for(const mode of ['absent','added','same','changed']){
  const h=harness();try{
   const {content,options,job}=h.data,plan=model.integratedTranslationPlan(content,options,job,version);
   const payload=mode==='same'||mode==='changed'?'saved':null;
   if(mode!=='absent')h.sqlite.prepare('INSERT INTO quotation_attribute_rules VALUES(?,?,?)').run('owner','80719',mode==='same'?'saved':'changed');
   const saved=await h.store.saveIntegratedTranslation('owner',cm.applyContentPatch(content,plan.patch,nextVersion),model.applyIntegratedOptions(options,plan,nextVersion),{productVersion:version,imageKeys:'[]',contentRevision:0,optionRevision:1,jobId,attributeRules:{categoryId:'80719',payload}});
   assert.equal(saved,mode==='absent'||mode==='same');
   if(!saved)assert.equal(h.sqlite.prepare('SELECT count(*) n FROM product_content').get().n,0);
  }finally{h.sqlite.close();}
 }
});

test('saved rule preview rejects values that the quotation field cannot retain',()=>{
 const schema=load('app/quotation-schema.ts').getQuotationSchema('80719');
 const field=schema.fields.find(f=>f.section==='product'&&f.visibility!=='common'&&f.type==='text'&&f.maxLength);
 assert.ok(field);
 const rules={format:'sourceflow-attribute-rules-v1',categoryId:'80719',rules:[{sourceName:'상품속성: test',fieldId:field.id,fieldSignature:JSON.stringify(field)}]};
 const snapshot={categoryId:'80719',jobId:'j',values:[{sourceName:'상품속성: test',name:'번역된 원문',value:'가'.repeat(field.maxLength+1)}]};
 const result=load('app/intake-attribute-rules.ts').applyIntakeAttributeRules(snapshot,JSON.stringify(rules));
 assert.equal(result.snapshot.bindings.length,0);assert.equal(result.preview.length,0);assert.equal(result.skipped.length,1);
 assert.equal(result.snapshot.reservedFields[0],field.id);
});

test('completed initial result resumes after price-only changes but rejects content/source races',async()=>{
 for(const variant of ['resume','content','other-job','original','race']){
  const h=harness();try{
   h.sqlite.prepare('UPDATE products SET updated_at=?').run(nextVersion);
   h.data.options.rows[0].unitCostCny=8;
   const originalJob=JSON.stringify(h.data.job);
   if(variant==='content')h.data.content.revision++;
   if(variant==='original')h.data.options.rows[0].originalName='不同';
   const route=load('app/api/products/[id]/translation-apply/route.ts',{
    '@/app/chatgpt-auth':{getWorkspaceOwnerId:async()=> 'owner'},
    '@/db/queries':{findProduct:async()=>({id:'p',owner_id:'owner',updated_at:nextVersion,image_keys:'[]'})},
    '@/db/product-content':{readProductContent:async()=>h.data.content},'@/db/product-options':{readProductOptions:async()=>h.data.options},
    '@/db/translation-jobs':{getTranslationJob:async()=>h.data.job,findIntakeTranslation:async()=>variant==='other-job'?null:h.data.job},
    '@/db/translation-category-source':{readTranslationCategorySource:async()=>{throw Error('unexpected category lookup');}},
    '@/db/translation-adoption':{saveIntegratedTranslation:async(...args)=>{if(variant==='race')h.sqlite.exec("UPDATE products SET updated_at='newer'");return h.store.saveIntegratedTranslation(...args);}},
   });
   const call=body=>route.POST(new Request('https://local/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId,expectedVersion:nextVersion,...body})}),{params:Promise.resolve({id:'p'})});
   const preview=await call({action:'preview'});
   if(['content','other-job','original'].includes(variant)){assert.equal(preview.status,409,variant);continue;}
   assert.equal(preview.status,200);const plan=await preview.json();
   const saved=await call({action:'apply',fingerprint:plan.fingerprint});assert.equal(saved.status,variant==='race'?409:200);
   assert.equal(JSON.stringify(h.data.job),originalJob);
   if(variant==='resume'){
    const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
    const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
    assert.equal(content.seo.title.value,'한국어 상품');assert.equal(options.rows[0].unitCostCny,8);assert.equal(options.rows[0].translatedName,'빨강 옵션');
    assert.equal(h.sqlite.prepare('SELECT product_version FROM translation_jobs').get().product_version,version);
   }else assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM product_content').get().n,0);
  }finally{h.sqlite.close();}
 }
});

test('completed option batches retain edited content and manual blanks with atomic race protection',async()=>{
 for(const variant of ['resume','all','other-job','original','race']){
  const h=harness();try{
   h.sqlite.prepare('UPDATE products SET updated_at=?').run(nextVersion);
   h.data.content=cm.applyContentPatch(h.data.content,{seo:{title:'직접 고친 상품명'},label:{material:'직접 확인한 재질'}},nextVersion);
   h.sqlite.prepare('INSERT INTO product_content VALUES (?,?,?,?,?)').run('p','owner',1,JSON.stringify(h.data.content),nextVersion);
   h.data.options.rows[0].translatedName='';h.data.options.rows[0].provenance.translatedName='manual';
   if(variant==='original')h.data.options.rows[0].originalName='不同';
   const originalJob=JSON.stringify(h.data.job);
   const route=load('app/api/products/[id]/translation-apply/route.ts',{
    '@/app/chatgpt-auth':{getWorkspaceOwnerId:async()=> 'owner'},
    '@/db/queries':{findProduct:async()=>({id:'p',owner_id:'owner',updated_at:nextVersion,image_keys:'[]'})},
    '@/db/product-content':{readProductContent:async()=>h.data.content},'@/db/product-options':{readProductOptions:async()=>h.data.options},
    '@/db/translation-jobs':{getTranslationJob:async()=>h.data.job,findIntakeTranslation:async()=>null,findIntakeOptionsTranslation:async()=>variant==='other-job'?null:h.data.job},
    '@/db/translation-category-source':{readTranslationCategorySource:async()=>{throw Error('unexpected category lookup');}},
    '@/db/translation-adoption':{saveIntegratedTranslation:async(...args)=>{if(variant==='race')h.sqlite.exec("UPDATE product_content SET revision=2");return h.store.saveIntegratedTranslation(...args);}},
   });
   const call=body=>route.POST(new Request('https://local/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jobId,expectedVersion:nextVersion,scope:variant==='all'?'all':'options',...body})}),{params:Promise.resolve({id:'p'})});
   const preview=await call({action:'preview'});
   if(['all','other-job','original'].includes(variant)){assert.equal(preview.status,409,variant);continue;}
   assert.equal(preview.status,200);const plan=await preview.json();
   const saved=await call({action:'apply',fingerprint:plan.fingerprint});assert.equal(saved.status,variant==='race'?409:200);
   assert.equal(JSON.stringify(h.data.job),originalJob);
   const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
   assert.equal(content.seo.title.value,'직접 고친 상품명');assert.equal(content.label.material.value,'직접 확인한 재질');
   if(variant==='resume'){
    const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
    assert.equal(options.rows[0].translatedName,'');assert.equal(options.rows[0].color,'빨강');
   }
   assert.equal(h.sqlite.prepare('SELECT content_revision FROM translation_jobs').get().content_revision,0);
  }finally{h.sqlite.close();}
 }
});


test('hidden auto-fill setting persists in source snapshots and suppresses hidden rules only',()=>{
 const {content,options,job}=fixture();job.review.source.category={id:'80719',path:['주방용품']};
 const plan=model.integratedTranslationPlan(content,options,job,version,'all',false);
 assert.equal(plan.categoryAttributes.hiddenAttributes,false);assert.equal(plan.patch.seo.title,'한국어 상품');assert.equal(plan.rows[0].color,'빨강');
 const schema=load('app/quotation-schema.ts').getQuotationSchema('80719');
 const rules=['basketShape','color'].map(id=>{const field=schema.fields.find(f=>f.id===id);return {fieldId:id,sourceName:'상품속성: '+id,fieldSignature:JSON.stringify(field)};});
 const snapshot={...plan.categoryAttributes,values:[{sourceName:'상품속성: basketShape',name:'모양',value:'사각형'},{sourceName:'상품속성: color',name:'색상',value:'파랑'}]};
 const payload=JSON.stringify({format:'sourceflow-attribute-rules-v1',categoryId:'80719',rules});
 const apply=load('app/intake-attribute-rules.ts').applyIntakeAttributeRules;
 const off=apply(snapshot,payload);assert.deepEqual(Array.from(off.snapshot.bindings,b=>b.fieldId),['color']);assert.equal(off.skipped.length,1);
 assert.ok(off.snapshot.reservedFields.includes('basketShape'));assert.equal(off.snapshot.hiddenAttributes,false);
 assert.equal(apply({...snapshot,hiddenAttributes:true},payload).snapshot.bindings.length,2);
});
