import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {memoryDatabase, readMigrationFiles, runtimeDDL, schemaSnapshot} from '../scripts/check-db-schema.mjs';
import {collectionNewDraftFixture, forkCompanies} from './helpers/collection-new-draft.mjs';

const at='2026-10-14T03:00:00.000Z';
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture({legacySchema=false}={}) {
  const sqlite=memoryDatabase(),cache=new Map(),state={beforeBatch:null,batches:0};
  if(legacySchema)sqlite.exec(readMigrationFiles().filter(file=>file.name<'0024').map(file=>file.sql).join('\n'));
  else for(const statement of runtimeDDL())sqlite.exec(statement.sql);
  const db={prepare(sql){let args=[];const q={sql,bind(...values){args=values;return q;},execute(){return sqlite.prepare(sql).all(...args);},async first(){return q.execute()[0]??null;},async all(){return{results:q.execute()};},async run(){return sqlite.prepare(sql).run(...args);}};return q;},
    async batch(statements){state.batches++;state.beforeBatch?.(statements);sqlite.exec('BEGIN');try{const results=statements.map(q=>({results:q.execute()}));sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,Date,Error,RangeError,crypto,structuredClone,URL,URLSearchParams,Response,Request,TextEncoder,TextDecoder,Uint8Array,DataView,atob,btoa,process:{env:{NODE_ENV:'development'}},
      require(name){if(name==='cloudflare:workers')return{env:{DB:db}};if(name==='next/server')return{NextResponse:Response};if(name==='@/app/chatgpt-auth')return{getWorkspaceOwnerId:async()=>state.owner??'owner',getChatGPTUser:async()=>null};if(name.startsWith('@/'))return load(name.slice(2)+'.ts');throw Error(name);}});return exports;}
  const queries=load('db/queries.ts'),registration=load('db/product-registration.ts');
  const product=(id,owner='owner',createdAt=at)=>({id,owner_id:owner,source_url:'synthetic://669/'+id,title:'합성 신규 상품 '+id,source_price_cny:5,exchange_rate:350,supply_margin:50,coupang_margin:40,supply_price:4050,sale_price:6750,msrp:8780,options_count:1,seo_status:'대기',image_status:'대기',quote_status:'대기',registration_status:'수동 입력',supplier_hub_status:'미전송',image_keys:'[]',goal_stage:'price',created_at:createdAt,updated_at:createdAt});
  const count=table=>sqlite.prepare('SELECT count(*) n FROM '+table).get().n;
  const counter=(owner='owner',day='2026-10-14')=>sqlite.prepare('SELECT last_sequence FROM product_registration_counters WHERE owner_id=? AND registration_day=?').get(owner,day)?.last_sequence??0;
  return{sqlite,db,load,state,queries,registration,product,count,counter,close(){sqlite.close();}};
}
function seedCollection(h,{owner='owner',id='collection-669',status='awaiting_connector'}={}){
  const settings=h.load('app/workspace-settings.ts').defaultSettings,sourceUrl='https://detail.1688.com/offer/669000000001.html';
  const job={id,offer_id:'669000000001',source_url:sourceUrl,goal:'price',status,created_at:at,updated_at:at,context:{category:{id:'synthetic-cat',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓']},settings,features:'합성 자료',keywords:'',capturedAt:at}};
  const receipt={schemaVersion:1,offerId:job.offer_id,sourceUrl,provider:'synthetic-local-669',collectedAt:at,title:'合成原文商品',description:'合成説明',attributes:[],images:[],options:[{sku:'SYNTHETIC-669',name:'合成選択',unitPriceCny:5,minimumOrder:1,stock:3}]};
  h.sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run(id,owner,job.offer_id,sourceUrl,job.goal,status,at,at);
  h.sqlite.prepare('INSERT INTO collection_context VALUES(?,?)').run(id,JSON.stringify(job.context));
  h.sqlite.prepare('INSERT INTO collection_results VALUES(?,?,?,?)').run(id,owner,JSON.stringify(receipt),at);
  return{owner,job,receipt};
}

async function saveRows(h,productId,ids,owner='owner'){
  const model=h.load('app/product-options.ts'),store=h.load('db/product-options.ts'),current=await store.readProductOptions(owner,productId),product=await h.queries.findProduct(owner,productId);
  const version=new Date(Date.parse(product.updated_at)+1).toISOString(),inputs=ids.map(id=>({...model.emptyOptionInput(id),originalName:'합성 옵션 '+id,supplierSku:'SYNTHETIC-'+id,unitCostCny:5,included:true}));
  const next=model.applyOptionRows(current,inputs,version);return store.saveProductOptions(owner,next,current.revision,product.updated_at);
}

test('option UUID numbers survive reorder, deletion and re-addition; new IDs consume only unused suffixes',async()=>{
  const h=fixture();try{
    const product=await h.queries.insertProduct(h.product('option-parent')),store=h.load('db/product-options.ts');
    const original=await saveRows(h,product.id,['a','b','c']),numbers=plain(await store.readOptionRegistrationNumbers('owner',product,original));
    assert.deepEqual(numbers,{a:'261014001001',b:'261014001002',c:'261014001003'});
    const reordered=await saveRows(h,product.id,['c','a','b']);assert.deepEqual(plain(await store.readOptionRegistrationNumbers('owner',product,reordered)),numbers);
    const deleted=await saveRows(h,product.id,['b']);assert.deepEqual(plain(await store.readOptionRegistrationNumbers('owner',product,deleted)),{b:numbers.b});assert.equal(h.count('product_registration_options'),3);
    const restored=await saveRows(h,product.id,['new-first','c','a','new-second','b']);
    assert.deepEqual(plain(await store.readOptionRegistrationNumbers('owner',product,restored)),{...numbers,'new-first':'261014001004','new-second':'261014001005'});assert.equal(h.count('product_registration_options'),5);assert.equal(h.counter(),1);
    assert.equal(Object.hasOwn(restored.rows[0],'registration_number'),false);assert.equal(Object.hasOwn(restored,'optionRegistrationNumbers'),false);
  }finally{h.close();}
});

test('option CAS failures, foreign ownership and legacy option saves allocate no metadata',async()=>{
  const h=fixture();try{
    const product=await h.queries.insertProduct(h.product('option-guard')),model=h.load('app/product-options.ts'),store=h.load('db/product-options.ts');
    const current=await saveRows(h,product.id,['a']),savedProduct=await h.queries.findProduct('owner',product.id),next=model.applyOptionRows(current,[...model.optionInputs(current),{...model.emptyOptionInput('new'),originalName:'합성 신규',unitCostCny:5}],new Date(Date.parse(savedProduct.updated_at)+1).toISOString());
    const before=plain(h.sqlite.prepare('SELECT * FROM product_registration_options').all());
    assert.equal(await store.saveProductOptions('owner',next,current.revision,product.updated_at),null);
    assert.equal(await store.saveProductOptions('other',next,current.revision,savedProduct.updated_at),null);
    assert.deepEqual(plain(h.sqlite.prepare('SELECT * FROM product_registration_options').all()),before);
    const other=await h.queries.insertProduct(h.product('owner-b','other')),otherOptions=await saveRows(h,other.id,['a'],'other');
    assert.deepEqual(plain(await store.readOptionRegistrationNumbers('other',other,otherOptions)),{a:'261014001001'});assert.deepEqual(plain(await store.readOptionRegistrationNumbers('owner',other,otherOptions)),{});
    const legacy=h.product('legacy-options'),entries=Object.entries(legacy);h.sqlite.prepare('INSERT INTO products('+entries.map(([key])=>key).join(',')+') VALUES('+entries.map(()=>'?').join(',')+')').run(...entries.map(([,value])=>value));
    const legacyOptions=await saveRows(h,legacy.id,['legacy-a']);assert.ok(legacyOptions);assert.equal(await store.readOptionRegistrationNumbers('owner',legacy,legacyOptions),undefined);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM product_registration_options WHERE product_id=?').get(legacy.id).n,0);
  }finally{h.close();}
});

test('option allocator failure and suffix exhaustion roll back options and product version atomically',async()=>{
  for(const failure of ['trigger','exhaustion']){
    const h=fixture();try{
      const product=await h.queries.insertProduct(h.product('option-rollback'));
      if(failure==='trigger')h.sqlite.exec("CREATE TRIGGER fail_option_number BEFORE INSERT ON product_registration_options BEGIN SELECT RAISE(ABORT,'synthetic option allocation failure'); END");
      else h.sqlite.prepare('INSERT INTO product_registration_options VALUES(?,?,?,?)').run(product.id,'owner','retired-999',999);
      const before=plain(h.sqlite.prepare('SELECT * FROM products').get());await assert.rejects(()=>saveRows(h,product.id,['a']),failure==='trigger'?/synthetic option/:/CHECK/);
      assert.equal(h.count('product_options'),0);assert.deepEqual(plain(h.sqlite.prepare('SELECT * FROM products').get()),before);assert.equal(h.count('product_registration_options'),failure==='trigger'?0:1);assert.equal(h.counter(),1);
    }finally{h.close();}
  }
});

test('real options API GET/PATCH exposes current immutable mappings outside the unchanged options payload',async()=>{
  const h=fixture();try{
    const product=await h.queries.insertProduct(h.product('option-api')),route=h.load('app/api/products/[id]/options/route.ts'),context={params:Promise.resolve({id:product.id})},model=h.load('app/product-options.ts');
    const patch=async ids=>{const source=await h.queries.findProduct('owner',product.id),options=await h.load('db/product-options.ts').readProductOptions('owner',product.id),rows=ids.map(id=>({...model.emptyOptionInput(id),originalName:'합성 '+id,unitCostCny:5,included:true}));const response=await route.PATCH(new Request('https://app.test',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:options.revision,expectedProductVersion:source.updated_at,rows})}),context);assert.equal(response.status,200,await response.clone().text());return response.json();};
    const first=await patch(['a','b']);assert.deepEqual(first.optionRegistrationNumbers,{a:'261014001001',b:'261014001002'});assert.equal(Object.hasOwn(first.options,'optionRegistrationNumbers'),false);
    const reordered=await patch(['b','a']);assert.deepEqual(reordered.optionRegistrationNumbers,first.optionRegistrationNumbers);
    const removed=await patch(['b']);assert.deepEqual(removed.optionRegistrationNumbers,{b:'261014001002'});
    const response=await route.GET(new Request('https://app.test'),context);assert.equal(response.status,200);assert.deepEqual((await response.json()).optionRegistrationNumbers,removed.optionRegistrationNumbers);
    h.state.owner='other';assert.equal((await route.GET(new Request('https://app.test'),context)).status,404);
  }finally{h.close();}
});

test('manual creation allocates display metadata in one transaction with and without a policy; UUID stays unchanged',async()=>{
  const h=fixture();try{
    const first=await h.queries.insertProduct(h.product('uuid-one'));
    const policy=h.load('app/pricing.ts').pricePolicy(h.load('app/workspace-settings.ts').defaultSettings);
    const second=await h.queries.insertProduct(h.product('uuid-two'),policy);
    assert.equal(first.id,'uuid-one');assert.equal(first.registration_number,'261014001001');assert.equal(Object.hasOwn(first,'pricing_policy'),false);
    assert.equal(second.registration_number,'261014002001');assert.equal(second.pricing_policy,JSON.stringify(policy));
    assert.equal(h.count('products'),2);assert.equal(h.count('product_registration_numbers'),2);assert.equal(h.counter(),2);
    assert.equal(Object.hasOwn(h.sqlite.prepare('SELECT * FROM products').get(),'registration_number'),false);
  }finally{h.close();}
});

test('concurrent creation has contiguous member-scoped counters and no duplicate allocation',async()=>{
  const h=fixture();try{
    const saved=await Promise.all(Array.from({length:30},(_,i)=>h.queries.insertProduct(h.product('parallel-'+i))));
    assert.equal(new Set(saved.map(p=>p.registration_number)).size,30);assert.deepEqual(saved.map(p=>p.registration_number).sort(),Array.from({length:30},(_,i)=>'261014'+String(i+1).padStart(3,'0')+'001'));
    assert.equal((await h.queries.insertProduct(h.product('other-company-member','other'))).registration_number,'261014001001');
    assert.equal(h.counter(),30);assert.equal(h.counter('other'),1);assert.equal(await h.queries.findProduct('other',saved[0].id),null);
  }finally{h.close();}
});

test('KST midnight rolls the calendar-day sequence even while UTC remains on the same day',async()=>{
  const h=fixture();try{
    const before=await h.queries.insertProduct(h.product('before-midnight','owner','2026-10-14T14:59:59.999Z'));
    const after=await h.queries.insertProduct(h.product('after-midnight','owner','2026-10-14T15:00:00.000Z'));
    assert.equal(before.registration_number,'261014001001');assert.equal(after.registration_number,'261015001001');
    assert.equal(h.registration.registrationDay('2026-12-31T15:00:00.000Z'),'2027-01-01');
    assert.throws(()=>h.registration.registrationDay('invalid'),/Invalid/);
    assert.equal(h.counter('owner','2026-10-14'),1);assert.equal(h.counter('owner','2026-10-15'),1);
  }finally{h.close();}
});

test('a metadata failure rolls back products, policy and counter; retry receives the unused first number',async()=>{
  const h=fixture();try{
    h.sqlite.exec("CREATE TRIGGER fail_number BEFORE INSERT ON product_registration_numbers BEGIN SELECT RAISE(ABORT,'synthetic metadata failure'); END");
    const policy=h.load('app/pricing.ts').pricePolicy(h.load('app/workspace-settings.ts').defaultSettings);
    await assert.rejects(()=>h.queries.insertProduct(h.product('rollback'),policy),/synthetic metadata failure/);
    for(const table of ['products','product_price_policy','product_registration_numbers','product_registration_counters'])assert.equal(h.count(table),0);
    h.sqlite.exec('DROP TRIGGER fail_number');assert.equal((await h.queries.insertProduct(h.product('rollback'),policy)).registration_number,'261014001001');
    await assert.rejects(()=>h.queries.insertProduct(h.product('rollback')),/UNIQUE/);assert.equal(h.counter(),1);
  }finally{h.close();}
});

test('999 per member/day exhausts atomically and another member/day still creates a product',async()=>{
  const h=fixture();try{
    h.sqlite.prepare('INSERT INTO product_registration_counters VALUES(?,?,?)').run('owner','2026-10-14',998);
    assert.equal((await h.queries.insertProduct(h.product('last'))).registration_number,'261014999001');
    const before=h.sqlite.prepare('SELECT * FROM product_registration_numbers').all();
    await assert.rejects(()=>h.queries.insertProduct(h.product('overflow'),{}),/CHECK/);
    assert.equal(h.count('products'),1);assert.equal(h.count('product_price_policy'),0);assert.equal(h.counter(),999);assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_registration_numbers').all(),before);
    assert.equal((await h.queries.insertProduct(h.product('other','other'))).registration_number,'261014001001');
    assert.equal((await h.queries.insertProduct(h.product('tomorrow','owner','2026-10-14T15:00:00.000Z'))).registration_number,'261015001001');
  }finally{h.close();}
});

test('additive migration and every legacy read/edit leave old products without metadata or a consumed counter',async()=>{
  const h=fixture({legacySchema:true});try{
    const legacy=h.product('legacy'),entries=Object.entries(legacy);
    h.sqlite.prepare('INSERT INTO products('+entries.map(([key])=>key).join(',')+') VALUES('+entries.map(()=>'?').join(',')+')').run(...entries.map(([,value])=>value));
    const before=h.sqlite.prepare('SELECT * FROM products').all(),schema=schemaSnapshot(h.sqlite);
    await h.queries.ensureDatabase();for(const entry of schema)assert.deepEqual(schemaSnapshot(h.sqlite).find(item=>item.name===entry.name),entry);
    assert.deepEqual(h.sqlite.prepare('SELECT * FROM products').all(),before);
    for(const product of [await h.queries.findProduct('owner','legacy'),...(await h.queries.listProducts('owner'))])assert.equal(Object.hasOwn(product,'registration_number'),false);
    const edited=await h.queries.updateProduct('owner','legacy',{title:'기존 상품 편집'},at);assert.equal(Object.hasOwn(edited,'registration_number'),false);
    const policy=h.load('app/pricing.ts').pricePolicy(h.load('app/workspace-settings.ts').defaultSettings);
    const priced=await h.queries.applyProductPrice('owner','legacy',edited.updated_at,{exchangeRate:350,supplyMargin:50,coupangMargin:40,supplyPrice:4050,salePrice:6750,msrp:8780},policy);assert.equal(Object.hasOwn(priced,'registration_number'),false);
    assert.equal(h.count('product_registration_numbers'),0);assert.equal(h.counter(),0);
    assert.equal((await h.queries.insertProduct(h.product('fresh'))).registration_number,'261014001001');
  }finally{h.close();}
});

test('edit, price, removal, restore, list and find keep the original immutable display number',async()=>{
  const h=fixture();try{
    const saved=await h.queries.insertProduct(h.product('permanent'));
    const edited=await h.queries.updateProduct('owner',saved.id,{title:'새 상품명',registration_number:'changed'},saved.updated_at);
    assert.equal(edited.registration_number,saved.registration_number);assert.equal(await h.queries.updateProduct('other',saved.id,{title:'불허'}),null);
    const policy=h.load('app/pricing.ts').pricePolicy(h.load('app/workspace-settings.ts').defaultSettings);
    const priced=await h.queries.applyProductPrice('owner',saved.id,edited.updated_at,{exchangeRate:351,supplyMargin:51,coupangMargin:41,supplyPrice:4051,salePrice:6751,msrp:8781},policy);assert.equal(priced.registration_number,saved.registration_number);
    const removals=h.load('db/product-removals.ts'),removed=await removals.removeProduct('owner',saved.id,priced.updated_at);assert.ok(removed);
    assert.equal(await h.queries.findProduct('owner',saved.id,true),null);assert.equal((await h.queries.listProducts('owner','only'))[0].registration_number,saved.registration_number);
    assert.equal((await h.queries.findProduct('owner',saved.id)).registration_number,saved.registration_number);
    assert.ok(await removals.restoreProduct('owner',saved.id,priced.updated_at,removed.removed_at));assert.equal((await h.queries.listProducts('owner'))[0].registration_number,saved.registration_number);
    assert.equal(h.counter(),1);assert.equal(h.count('product_registration_numbers'),1);
  }finally{h.close();}
});

test('archive enriches products only and indexed number search cannot make a matching request inherit it',async()=>{
  const h=fixture();try{
    const product=await h.queries.insertProduct(h.product('history'));
    h.sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run('history','owner','669000000001',product.source_url,'price','cancelled',at,at);
    const model=h.load('app/product-archive.ts'),store=h.load('db/product-archive.ts'),query=await model.parseArchiveQuery(new URLSearchParams('range=all'));
    const page=await store.listProductArchive('owner',query);assert.equal(page.items.length,2);assert.equal(page.items.find(row=>row.sourceKind==='product').registration_number,product.registration_number);assert.equal(Object.hasOwn(page.items.find(row=>row.sourceKind==='request'),'registration_number'),false);
    const search=await model.parseArchiveQuery(new URLSearchParams({range:'all',q:product.registration_number}));
    const found=await store.listProductArchive('owner',search);assert.deepEqual(found.items.map(row=>row.sourceKind),['product']);assert.equal(found.items[0].id,product.id);assert.equal((await store.listProductArchive('other',search)).items.length,0);
    const plan=h.sqlite.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM product_registration_numbers n WHERE n.owner_id=? AND n.registration_number=? AND n.product_id=?').all('owner',product.registration_number,product.id);assert.ok(plan.some(row=>/SEARCH.*INDEX/.test(row.detail)));
    assert.equal(h.counter(),1);
  }finally{h.close();}
});

test('collection promotion stores one number and retry preserves the original edits and counter',async()=>{
  const h=fixture();try{
    const {owner,job,receipt}=seedCollection(h),store=h.load('db/collection-products.ts');
    const first=await store.promoteCollection(owner,job,receipt),product=await h.queries.findProduct(owner,first.product_id);
    assert.match(product.registration_number,/^\d{6}001001$/);const day=h.registration.registrationDay(product.created_at);
    await h.queries.updateProduct(owner,first.product_id,{title:'편집값 유지'},product.updated_at);
    const second=await store.promoteCollection(owner,job,receipt);assert.equal(second.product_id,first.product_id);assert.equal((await h.queries.findProduct(owner,first.product_id)).registration_number,product.registration_number);assert.equal(h.counter(owner,day),1);
    assert.equal(h.count('product_registration_numbers'),1);assert.equal(Object.hasOwn(h.load('app/collection-product.ts').prepareCollectionProduct(owner,job,receipt,'new-initializer',at).product,'registration_number'),false);
    const optionStore=h.load('db/product-options.ts'),options=await optionStore.readProductOptions(owner,product.id),map=await optionStore.readOptionRegistrationNumbers(owner,product,options);
    assert.deepEqual(plain(map),{[options.rows[0].id]:product.registration_number.slice(0,9)+'001'});assert.equal(h.count('product_registration_options'),1);
  }finally{h.close();}
});

test('collection companion failure and guarded cancellation consume no number or counter',async()=>{
  for(const mutation of ['companion','cancel']){
    const h=fixture();try{
      const {owner,job,receipt}=seedCollection(h),store=h.load('db/collection-products.ts');
      if(mutation==='companion')h.sqlite.exec("CREATE TRIGGER fail_content BEFORE INSERT ON product_content BEGIN SELECT RAISE(ABORT,'synthetic companion failure'); END");
      else h.state.beforeBatch=statements=>{if(statements.some(q=>/^INSERT INTO products/.test(q.sql.trim()))){h.state.beforeBatch=null;h.sqlite.exec("UPDATE collection_jobs SET status='cancelled'");}};
      await assert.rejects(()=>store.promoteCollection(owner,job,receipt));
      for(const table of ['products','product_options','product_content','product_price_policy','product_registration_numbers','product_registration_counters','product_registration_options','collection_products'])assert.equal(h.count(table),0,table);
    }finally{h.close();}
  }
});

test('explicit new fork gets a fresh number while UUID recovery keeps the original product and allocation unchanged',async()=>{
  const f=await collectionNewDraftFixture(forkCompanies[0],{images:false});try{
    const queries=f.api.load('db/queries.ts'),original=await queries.findProduct('owner',f.sourceProductId),before=f.originalSnapshot();assert.ok(original.registration_number);
    const preview=await f.preview(),requestId=crypto.randomUUID(),created=await f.create(preview,f.input,requestId),fresh=await queries.findProduct('owner',created.productId);
    assert.notEqual(fresh.id,original.id);assert.notEqual(fresh.registration_number,original.registration_number);assert.equal(fresh.registration_number.slice(-6),'002001');
    const optionStore=f.api.load('db/product-options.ts'),freshOptions=await optionStore.readProductOptions('owner',fresh.id);
    assert.deepEqual(plain(await optionStore.readOptionRegistrationNumbers('owner',fresh,freshOptions)),{[freshOptions.rows[0].id]:fresh.registration_number.slice(0,9)+'001'});
    const allocation=plain(f.api.sqlite.prepare('SELECT * FROM product_registration_numbers ORDER BY product_id').all()),counters=plain(f.api.sqlite.prepare('SELECT * FROM product_registration_counters').all());
    const optionAllocation=plain(f.api.sqlite.prepare('SELECT * FROM product_registration_options ORDER BY product_id,option_id').all());
    const retried=await f.create(preview,f.input,requestId);assert.equal(retried.productId,created.productId);assert.equal(f.originalSnapshot(),before);assert.equal((await queries.findProduct('owner',original.id)).registration_number,original.registration_number);
    assert.deepEqual(plain(f.api.sqlite.prepare('SELECT * FROM product_registration_numbers ORDER BY product_id').all()),allocation);assert.deepEqual(plain(f.api.sqlite.prepare('SELECT * FROM product_registration_counters').all()),counters);assert.deepEqual(plain(f.api.sqlite.prepare('SELECT * FROM product_registration_options ORDER BY product_id,option_id').all()),optionAllocation);assert.deepEqual(f.api.network,[]);
  }finally{f.close();}
});

test('explicit fork CAS failure leaves the original number and counter unchanged',async()=>{
  const f=await collectionNewDraftFixture(forkCompanies[0],{images:false});try{
    const preview=await f.preview(),allocation=plain(f.api.sqlite.prepare('SELECT * FROM product_registration_numbers').all()),counters=plain(f.api.sqlite.prepare('SELECT * FROM product_registration_counters').all());
    f.state.beforeBatch=statements=>{if(statements.some(q=>/^INSERT INTO collection_jobs/.test(q.sql.trim()))){f.state.beforeBatch=null;f.api.sqlite.prepare('UPDATE products SET title=?,updated_at=? WHERE id=?').run('합성 동시 변경','2099-01-01T00:00:00.000Z',f.sourceProductId);}};
    const response=await f.request(f.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...f.input,requestId:crypto.randomUUID(),baseFingerprint:preview.baseFingerprint})});assert.equal(response.status,409);
    assert.equal(f.api.sqlite.prepare('SELECT count(*) n FROM products').get().n,1);assert.deepEqual(plain(f.api.sqlite.prepare('SELECT * FROM product_registration_numbers').all()),allocation);assert.deepEqual(plain(f.api.sqlite.prepare('SELECT * FROM product_registration_counters').all()),counters);assert.deepEqual(f.api.network,[]);
  }finally{f.close();}
});
