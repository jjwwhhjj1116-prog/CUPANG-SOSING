import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { DatabaseSync } from 'node:sqlite';
function load(file,overrides={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,structuredClone,Error,crypto,TextEncoder,TextDecoder,Response,URL,process:{env:{NODE_ENV:'development'}},require:name=>name in overrides?overrides[name]:name==='next/server'?{NextResponse:{json:(body,init)=>Response.json(body,init)}}:load(name.slice(2)+'.ts',overrides)});return exports;}
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
 CREATE TABLE translation_jobs(id TEXT PRIMARY KEY,owner_id TEXT,product_id TEXT,status TEXT,product_version TEXT,content_revision INTEGER);`);
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

test('option-only API binds scope, preserves SEO and labels and persists verified options',async()=>{
 const h=harness();try{
  let saves=0;
  const route=load('app/api/products/[id]/translation-apply/route.ts',{
   '@/app/chatgpt-auth':{getWorkspaceOwnerId:async()=> 'owner'},
   '@/db/queries':{findProduct:async()=>({id:'p',owner_id:'owner',updated_at:h.sqlite.prepare('SELECT updated_at FROM products').get().updated_at,image_keys:'[]'})},
   '@/db/product-content':{readProductContent:async()=>h.data.content},'@/db/product-options':{readProductOptions:async()=>h.data.options},
   '@/db/translation-jobs':{getTranslationJob:async()=>h.data.job},
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
