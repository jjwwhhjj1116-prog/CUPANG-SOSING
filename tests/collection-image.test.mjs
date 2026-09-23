import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {memoryDatabase,runtimeDDL} from '../scripts/check-db-schema.mjs';
function load(file,deps={},mode='development'){
 const exports={};const code=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,fetch:deps.fetch,crypto,URL,Date,Response,Request,Uint8Array,TextEncoder,TextDecoder,structuredClone,AbortController,setTimeout,clearTimeout,process:{env:{NODE_ENV:mode}},require(name){if(name in deps)return deps[name];if(name==='next/server')return {NextResponse:Response};if(name.startsWith('@/'))return load(name.slice(2)+'.ts',deps,mode);throw Error(name);}});return exports;
}
const model=load('app/collection-image.ts');const empty=load('app/product-content.ts').emptyProductContent;
const optionsModel=load('app/product-options.ts');
function collectedOptions(){
 const current=optionsModel.emptyProductOptions('p');current.revision=1;
 current.rows=['a','b','c','d'].map(id=>({...optionsModel.emptyOptionInput(id),supplierSku:id,updatedAt:'before',provenance:{supplierSku:'collected',imageKey:'unverified'}}));
 return current;
}

test('exact SKU images preserve manual blanks, translated work and edited supplier identities',()=>{
 const current=collectedOptions();current.rows[1].provenance.imageKey='manual';
 current.rows[2].imageKey='owner/translated.png';current.rows[2].provenance.imageKey='translated';
 current.rows[3].provenance.supplierSku='manual';
 const before=JSON.stringify(current);
 const next=model.attachCollectedOptionImage(current,['a','b','c','d'],'owner/raw.png','now');
 assert.equal(next.rows[0].imageKey,'owner/raw.png');assert.equal(next.rows[0].provenance.imageKey,'collected');
 assert.equal(next.rows[1].imageKey,null);assert.equal(next.rows[2].imageKey,'owner/translated.png');assert.equal(next.rows[3].imageKey,null);
 assert.equal(next.revision,2);assert.equal(JSON.stringify(current),before);
 assert.equal(model.attachCollectedOptionImage(next,['a'],'owner/other.png','later').revision,2);
 assert.equal(model.attachCollectedOptionImage(current,['missing'],'owner/raw.png','now').revision,1);
});
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=','base64'));
test('download bounds its trust to receipt CDN and rejects redirects and non-images',async()=>{
 let calls=0;const fetcher=async(url,init)=>{calls++;assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');return new Response(png);};
 for(const url of ['http://cbu01.alicdn.com/a.png','https://alicdn.com.evil.test/a','https://127.0.0.1/a','https://user:pass@alicdn.com/a'])await assert.rejects(()=>model.downloadCollectionImage(url,'owner',fetcher));
 assert.equal(calls,0);const a=await model.downloadCollectionImage('https://cbu01.alicdn.com/a.png','owner',fetcher);const b=await model.downloadCollectionImage('https://cbu01.alicdn.com/a.png','owner',fetcher);
 assert.equal(a.key,b.key);assert.match(a.key,/^owner\/collected-[a-f0-9]{64}\.png$/);
 await assert.rejects(()=>model.downloadCollectionImage('https://alicdn.com/a','owner',async()=>new Response(null,{status:302,headers:{location:'https://evil.test'}})));
 await assert.rejects(()=>model.downloadCollectionImage('https://alicdn.com/a','owner',async()=>new Response('<html>login</html>')));
 await assert.rejects(()=>model.downloadCollectionImage('https://alicdn.com/a','owner',async()=>new Response(png,{headers:{'content-length':String(11*1024*1024)}})));
});
test('stream size limit is enforced without trusting content length',async()=>{
 await assert.rejects(()=>model.downloadCollectionImage('https://alicdn.com/a','owner',async()=>new Response(new Uint8Array(10*1024*1024+1))));
});
test('role import preserves manual blank, existing selections and translated work; no completion is invented',()=>{
 const current=empty('p');current.assets.main={value:[],provenance:'manual',updatedAt:null};current.assets.detail={value:['owner/translated.png'],provenance:'translated',updatedAt:null};
 for(const role of ['main','detail']){const next=model.attachCollectedImage(current,[],'owner/raw.png',role,'now');assert.deepEqual(JSON.parse(JSON.stringify(next.content.assets[role])),current.assets[role]);assert.equal(next.keys.length,1);}
 const added=model.attachCollectedImage(current,[],'owner/raw.png','additional','now');assert.equal(added.content.assets.additional.provenance,'collected');assert.equal(current.assets.additional.value.length,0);
 assert.throws(()=>model.attachCollectedImage(current,Array.from({length:50},(_,i)=>'owner/'+i),'owner/new','detail','now'));
});
function storage(){const sqlite=memoryDatabase();for(const s of runtimeDDL())sqlite.exec(s.sql);
 const now='2026-09-23T00:00:00.000Z';sqlite.prepare(`INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,supply_price,sale_price,msrp,created_at,updated_at) VALUES('p','owner','url','test',1,1,0,0,1,1,1,?,?)`).run(now,now);
 sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run('job','owner','123','url','collect','awaiting_connector',now,now);sqlite.prepare('INSERT INTO collection_products VALUES(?,?,?,?)').run('job','owner','p',now);
 const current=empty('p');current.revision=1;sqlite.prepare('INSERT INTO product_content VALUES(?,?,?,?,?)').run('p','owner',1,JSON.stringify(current),now);
 const db={prepare(sql){let args=[];const q={bind(...values){args=values;return q;},execute(){return sqlite.prepare(sql).all(...args);},async all(){return {results:q.execute()};},async first(){return q.execute()[0]??null;},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(s=>({results:s.execute()}));sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 return {sqlite,db,current,product:sqlite.prepare('SELECT * FROM products').get(),store:load('db/collection-images.ts',{'cloudflare:workers':{env:{DB:db}}})};}
test('atomic image registration retries without duplicates or overwriting later edits',async()=>{
 const h=storage();try{await h.store.saveCollectionImage('owner','job',0,'owner/a.png','detail',h.product,h.current);
 h.sqlite.prepare("UPDATE product_content SET payload=? WHERE product_id='p'").run(JSON.stringify({...h.current,revision:2,seo:{...h.current.seo,title:{value:'manual'}}}));
 await h.store.saveCollectionImage('owner','job',0,'owner/b.png','detail',h.product,h.current);
 assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_images').get().n,1);assert.equal(h.sqlite.prepare('SELECT image_keys FROM products').get().image_keys,'["owner/a.png"]');assert.equal(JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload).seo.title.value,'manual');
 }finally{h.sqlite.close();}
});

test('image and matching SKU linkage commit together and reach option quotation images',async()=>{
 const h=storage();try{
  const options=collectedOptions();
  h.sqlite.prepare('INSERT INTO product_options VALUES(?,?,?,?,?)').run('p','owner',1,JSON.stringify(options),'before');
  await h.store.saveCollectionImage('owner','job',0,'owner/a.png','additional',h.product,h.current,['a','b']);
  const saved=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
  assert.equal(saved.revision,2);assert.equal(saved.rows[0].imageKey,'owner/a.png');assert.equal(saved.rows[1].imageKey,'owner/a.png');assert.equal(saved.rows[2].imageKey,null);
  const resolved=load('app/quotation-schema.ts').resolveQuotationFields({categoryId:'77442',product:h.sqlite.prepare('SELECT * FROM products').get(),content:h.current,options:saved,settings:load('app/workspace-settings.ts').defaultSettings});
  assert.equal(resolved.rows.find(row=>row.optionId==='a').fields.mainImage.value,'owner/a.png');
  assert.equal(resolved.rows.find(row=>row.optionId==='a').fields.mainImage.source,'option');
  await h.store.saveCollectionImage('owner','job',0,'owner/b.png','additional',h.product,h.current,['a']);
  assert.equal(h.sqlite.prepare('SELECT revision FROM product_options').get().revision,2);
 }finally{h.sqlite.close();}
});

test('failure updating SKU images rolls back content and image receipts',async()=>{
 const h=storage();try{
  h.sqlite.prepare('INSERT INTO product_options VALUES(?,?,?,?,?)').run('p','owner',1,JSON.stringify(collectedOptions()),'before');
  h.sqlite.exec("CREATE TRIGGER fail_option BEFORE UPDATE ON product_options BEGIN SELECT RAISE(ABORT,'test'); END");
  await assert.rejects(()=>h.store.saveCollectionImage('owner','job',0,'owner/a.png','main',h.product,h.current,['a']));
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_images').get().n,0);
  assert.equal(h.sqlite.prepare('SELECT revision FROM product_content').get().revision,1);
  assert.equal(h.sqlite.prepare('SELECT image_keys FROM products').get().image_keys,'[]');
 }finally{h.sqlite.close();}
});
test('failed companion update rolls back receipt and product; concurrent edits reject import',async()=>{
 for(const scenario of ['failure','conflict']){const h=storage();try{
 if(scenario==='failure')h.sqlite.exec("CREATE TRIGGER fail BEFORE UPDATE ON products BEGIN SELECT RAISE(ABORT,'test'); END");else h.sqlite.exec("UPDATE product_content SET revision=2");
 await assert.rejects(()=>h.store.saveCollectionImage('owner','job',0,'owner/a.png','main',h.product,h.current));assert.equal(h.sqlite.prepare('SELECT count(*) n FROM collection_images').get().n,0);assert.equal(h.sqlite.prepare('SELECT image_keys FROM products').get().image_keys,'[]');
 }finally{h.sqlite.close();}}
});
test('production route rejects unauthenticated requests before storage or outbound calls',async()=>{
 const api=load('app/api/collection-jobs/[id]/images/route.ts',{'cloudflare:workers':{env:{}},'@/app/chatgpt-auth':{getChatGPTUser:async()=>null}},'production');
 const r=await api.POST(new Request('https://example.test',{method:'POST'}),{params:Promise.resolve({id:'job'})});assert.equal(r.status,503);
});

test('API imports a receipt image once and retry skips download and object writes',async()=>{
 const h=storage();try{
  h.sqlite.prepare('INSERT INTO product_options VALUES(?,?,?,?,?)').run('p','owner',1,JSON.stringify(collectedOptions()),'before');
  h.sqlite.prepare('INSERT INTO collection_results VALUES(?,?,?,?)').run('job','owner',JSON.stringify({options:[{sku:'a',imageIndex:0}],images:[{url:'https://cbu01.alicdn.com/test.png',role:'main'}]}),'now');
  let downloads=0,writes=0;const deps={'cloudflare:workers':{env:{DB:h.db,FILES:{head:async()=>({size:png.length}),put:async()=>{writes++;return {};}}}},'@/app/chatgpt-auth':{getWorkspaceOwnerId:async()=>'owner'},fetch:async()=>{downloads++;return new Response(png);}};
  const api=load('app/api/collection-jobs/[id]/images/route.ts',deps);const context={params:Promise.resolve({id:'job'})};
  const request=()=>new Request('http://localhost/api/collection-jobs/job/images',{method:'POST',headers:{'content-type':'application/json'},body:'{"index":0}'});
  const first=await api.POST(request(),context);assert.equal(first.status,200,await first.clone().text());
  const second=await api.POST(request(),context);assert.equal(second.status,200);assert.equal((await second.json()).reused,true);
  assert.equal(downloads,1);assert.equal(writes,1);
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);assert.equal(content.assets.main.value.length,1);assert.equal(content.assets.main.provenance,'collected');
  const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload);
  assert.equal(options.rows[0].imageKey,content.assets.main.value[0]);assert.equal(options.rows[1].imageKey,null);assert.equal(options.revision,2);
 }finally{h.sqlite.close();}
});


test('identical original never duplicates a file assigned to a banner or another role',()=>{
 for(const role of ['main','additional','detail','detailTop','detailBottom','label','size']){
  const current=empty('p');current.assets[role]={value:['owner/shared.png'],provenance:'manual',updatedAt:'before'};const before=JSON.stringify(current);
  const next=model.attachCollectedImage(current,['owner/shared.png'],'owner/shared.png',role==='detail'?'additional':'detail','after');
  assert.equal(Object.values(next.content.assets).filter(field=>field.value.includes('owner/shared.png')).length,1);
  assert.equal(next.assigned,false);assert.equal(next.keys.length,1);assert.equal(JSON.stringify(current),before);
 }
});
test('capacity separates detached receipts from reusable images within owner and product scope',async()=>{
 const h=storage();try{
  await h.store.saveCollectionImage('owner','job',0,'owner/a.png','detail',h.product,h.current);
  assert.deepEqual(Array.from(await h.store.listCollectionImageIndices('owner','job','p')),[0]);
  h.sqlite.prepare('UPDATE products SET image_keys=?').run('[]');
  assert.deepEqual(Array.from(await h.store.listCollectionImageIndices('owner','job','p')),[]);
  assert.deepEqual(Array.from(await h.store.listDisconnectedCollectionImageIndices('owner','job','p')),[0]);
  assert.deepEqual(Array.from(await h.store.listDisconnectedCollectionImageIndices('other','job','p')),[]);
  assert.deepEqual(Array.from(await h.store.listDisconnectedCollectionImageIndices('owner','job','other')),[]);
 }finally{h.sqlite.close();}
});
test('retry does not restore removed selections or report missing objects as stored',async()=>{
 for(const scenario of ['detached','missing','wrong-product']){
  const h=storage();try{
   await h.store.saveCollectionImage('owner','job',0,'owner/a.png','detail',h.product,h.current);
   h.sqlite.prepare('INSERT INTO collection_results VALUES(?,?,?,?)').run('job','owner',JSON.stringify({options:[],images:[{url:'https://cbu01.alicdn.com/test.png',role:'detail'}]}),'now');
   if(scenario==='detached')h.sqlite.prepare('UPDATE products SET image_keys=?').run('[]');
   let downloads=0,writes=0,heads=0;
   const deps={'cloudflare:workers':{env:{DB:h.db,FILES:{head:async()=>{heads++;return null;},put:async()=>{writes++;}}}},'@/app/chatgpt-auth':{getWorkspaceOwnerId:async()=>'owner'},fetch:async()=>{downloads++;throw Error('unexpected download');}};
   if(scenario==='wrong-product')deps['@/db/collection-images']={readCollectionImage:async()=>({object_key:'owner/a.png',product_id:'different'}),saveCollectionImage:async()=>{writes++;}};
   const api=load('app/api/collection-jobs/[id]/images/route.ts',deps);
   const response=await api.POST(new Request('http://localhost/api/collection-jobs/job/images',{method:'POST',headers:{'content-type':'application/json'},body:'{"index":0}'}),{params:Promise.resolve({id:'job'})});
   assert.equal(response.status,409,await response.clone().text());assert.equal((await response.json()).code,scenario==='missing'?'IMAGE_UNAVAILABLE':'IMAGE_DETACHED');
   assert.equal(downloads,0);assert.equal(writes,0);assert.equal(heads,scenario==='missing'?1:0);
   assert.equal(h.sqlite.prepare('SELECT image_keys FROM products').get().image_keys,scenario==='detached'?'[]':'["owner/a.png"]');
  }finally{h.sqlite.close();}
 }
});
