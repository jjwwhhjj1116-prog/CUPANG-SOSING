import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const read=name=>fs.readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
async function seed(h){
 const capture={format:'1688-public-mobile-capture-v1',sourceUrl:h.sourceUrl,
  mobileHtml:'<script>window.__INIT_DATA='+read('1688-mobile-813724060928.json')+';</script>',
  skuPayload:JSON.parse(read('1688-skus-813724060928.json')),detailSource:read('1688-description-813724060928.txt')};
 const receipt=h.load('app/browser-product-capture.ts').parseBrowserProductCapture(capture,h.sourceUrl);
 await h.load('db/collection-results.ts').storeCollectionResult('owner','job',receipt);
 return receipt;
}
const snapshot=h=>JSON.stringify(Object.fromEntries(['products','product_options','product_content','product_price_policy','collection_products',
 'collection_jobs','collection_context','collection_results','collection_images'].map(table=>[table,h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`interleaved promotion ACK identifies the winner and preserves its reviewed values (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company);
 let release;
 try{
  const receipt=await seed(h),original=JSON.stringify(h.sqlite.prepare('SELECT * FROM collection_results').get());
  const batch=h.db.batch.bind(h.db),gate=new Promise(resolve=>{release=resolve;});
  let reach;
  const reached=new Promise(resolve=>{reach=resolve;});
  let pause=true;
  h.db.batch=async statements=>{
   if(pause){pause=false;reach();await gate;}
   return batch(statements);
  };
  // Pause request A only after both of its previous-product checks returned
  // null. Request B then commits through the same real SQLite transaction.
  const first=h.route('/api/collection-jobs/job/product',{method:'POST'});
  await reached;
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
  const winner=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'}));
  assert.equal(winner.reused,false);assert.equal(winner.executionStarted,false);
  const id=winner.productId,key='owner/reviewed-main.png';
  h.objects.set(key,new Uint8Array([1,2,3]));
  h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([key]),id);
  let content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(id).payload);
  await json(await h.route(`/api/products/${id}/content`,{method:'PATCH',body:{expectedRevision:content.revision,
   patch:{seo:{title:'직접 검토한 제목',description:'',keywords:[]},label:{material:''},assets:{main:[key],detail:[]}}}}));
  const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(id).payload);
  const rows=h.load('app/product-options.ts').optionInputs(options);
  rows[0].included=false;rows[1].unitsPerPack=3;rows[1].unitCostCny=9.25;rows[1].translatedName='직접 검토한 옵션';rows[1].imageKey=key;
  const product=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(id);
  await json(await h.route(`/api/products/${id}/options`,{method:'PATCH',body:{expectedRevision:options.revision,expectedProductVersion:product.updated_at,rows}}));
  const reviewed=snapshot(h),bytes=Buffer.from(h.objects.get(key)).toString('hex');
  release();
  const loser=await json(await first);
  assert.equal(loser.productId,id);assert.equal(loser.reused,true);assert.equal(loser.executionStarted,false);
  assert.equal(snapshot(h),reviewed,'losing candidate cannot replace any saved row, manual blank, price, image or clock');
  for(const table of ['products','product_options','product_content','product_price_policy','collection_products'])assert.equal(h.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n,1,table);
  content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(id).payload);
  const savedOptions=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(id).payload);
  assert.equal(content.seo.title.value,'직접 검토한 제목');assert.equal(content.seo.description.value,'');assert.deepEqual(content.seo.keywords.value,[]);
  assert.equal(content.label.material.value,'');assert.deepEqual(content.assets.main.value,[key]);assert.deepEqual(content.assets.detail.value,[]);
  assert.equal(savedOptions.rows.length,receipt.options.length);assert.equal(savedOptions.rows[0].included,false);assert.equal(savedOptions.rows[1].unitCostCny,9.25);
  assert.equal(savedOptions.rows[1].unitsPerPack,3);assert.equal(savedOptions.rows[1].translatedName,'직접 검토한 옵션');assert.equal(savedOptions.rows[1].imageKey,key);
  assert.equal(Buffer.from(h.objects.get(key)).toString('hex'),bytes);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM collection_results').get()),original);
  // Both early-return paths must describe a reuse too, rather than asking
  // callers to infer it from a preflight read that can race.
  const job=await h.load('db/collection-jobs.ts').findCollectionJob('owner','job');
  const direct=await h.load('db/collection-products.ts').promoteCollection('owner',job,receipt);
  assert.equal(direct.product_id,id);assert.equal(direct.reused,true);
  const retry=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'}));
  assert.equal(retry.productId,id);assert.equal(retry.reused,true);assert.equal(snapshot(h),reviewed);
  assert.deepEqual(h.network,[],'all data and images are local fixtures; no source, AI or Hub request runs');
  assert.equal(h.aiSources.length,0);assert.equal(h.stats.downloads,0);
 }finally{release?.();h.close();}
});
