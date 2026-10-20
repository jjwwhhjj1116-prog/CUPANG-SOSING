import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPageSource} from '../extensions/supplier-hub/page-source.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{companyCode:'A01526306',companyName:'유앤채'},{companyCode:'A01464742',companyName:'와이홉'}];
const captureId=version=>'75400000-0000-4000-8000-'+String(version).padStart(12,'0');
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const products=h=>Object.fromEntries(['products','product_options','product_content','product_price_policy','collection_products','collection_images',
 'product_registration_numbers','product_registration_options','product_registration_counters'].map(table=>[table,h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
async function fixture(h,company,{version=1,newer=false}={}){
 const source=extractPageSource({sourceUrl:h.sourceUrl,title:'合成商品',priceText:'¥5.00',minimumOrderText:'1件起批',
  scripts:[JSON.stringify({subject:'合成商品',skuModel:{offerId:'813724060928',skuInfoMap:{black:{skuId:'synthetic-754-black',specAttrs:'黑色',price:'5.00'}}},offerImgList:['https://cbu01.alicdn.com/synthetic-754.png']})]});
 const db=h.load('db/source-inbox.ts'),model=h.load('app/source-inbox.ts'),approved={code:company.companyCode,name:company.companyName};
 let selected;
 for(let current=1;current<=Math.max(version,newer?version+1:version);current++){
  const snapshot={...source,title:'合成商品 '+current,collectedAt:new Date(Date.parse(source.collectedAt)-10000+current).toISOString()};
  const fingerprint=await model.pageSourceFingerprint(snapshot);
  assert.ok(await db.storeSourceInbox('owner',approved,captureId(current),fingerprint,snapshot));
  if(current===version)selected={format:'yoofam-saved-page-capture-v1',sourceUrl:h.sourceUrl,captureId:captureId(current),fingerprint,revision:1};
 }
 const ack=await json(await h.route('/api/collection-jobs/job/collect',{method:'POST',body:{browserCapture:selected}}));
 return {proof:{capture:selected,receivedAt:ack.receipt.receivedAt},receipt:ack.receipt.result};
}

for(const company of companies)for(const version of [1,2])test(`selected version ${version} promotes exactly and retries preserve reviewed work (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company);try{
  const f=await fixture(h,company,{version,newer:true}),request=()=>h.route('/api/collection-jobs/job/product',{method:'POST',body:{expectedSource:f.proof}});
  const first=await json(await request());assert.equal(first.reused,false);assert.equal(first.executionStarted,false);
  const saved=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(first.productId);
  assert.equal(saved.title,f.receipt.title);assert.equal(saved.source_price_cny,5);assert.equal(saved.options_count,1);
  h.sqlite.prepare('UPDATE products SET title=? WHERE id=?').run('직접 검토한 작업 상품',first.productId);
  const before=products(h),retry=await json(await request());assert.equal(retry.reused,true);assert.equal(retry.productId,first.productId);assert.deepEqual(products(h),before);
  // The source cannot be substituted by the latest URL capture or a later
  // revision even when this job already has an existing product.
  const latest=await h.load('db/source-inbox.ts').findSourceInbox('owner','813724060928');
  const different={...f.proof,capture:{...f.proof.capture,captureId:latest.id,fingerprint:latest.fingerprint}};
  const conflict=await json(await h.route('/api/collection-jobs/job/product',{method:'POST',body:{expectedSource:different}}),409);
  assert.equal(conflict.code,'SOURCE_SELECTION_CONFLICT');assert.deepEqual(products(h),before);assert.deepEqual(h.network,[]);
 }finally{h.close();}
});

test('selected promotion accepts only the strict bounded proof and resolves owner, company, URL, fingerprint, revision and receipt time',async()=>{
 const company=companies[1],h=mobileIntakeHarness(company);try{
  const f=await fixture(h,company),before=products(h);
  const malformed=[{},null,{expectedSource:null},{expectedSource:f.proof,extra:true},{expectedSource:{...f.proof,company:{code:company.companyCode,name:company.companyName}}},
   {expectedSource:{...f.proof,capture:{...f.proof.capture,revision:0}}},{expectedSource:{...f.proof,receivedAt:'not-a-date'}}];
  for(const body of malformed)await json(await h.route('/api/collection-jobs/job/product',{method:'POST',body:JSON.stringify(body)}),400);
  await json(await h.route('/api/collection-jobs/job/product',{method:'POST',body:{expectedSource:f.proof,padding:'x'.repeat(4096)}}),413);
  for(const capture of [{...f.proof.capture,fingerprint:'0'.repeat(64)},{...f.proof.capture,revision:2},{...f.proof.capture,captureId:captureId(99)},
   {...f.proof.capture,sourceUrl:'https://detail.1688.com/offer/754000000001.html'}]){
   const result=await json(await h.route('/api/collection-jobs/job/product',{method:'POST',body:{expectedSource:{...f.proof,capture}}}),409);assert.equal(result.code,'SOURCE_SELECTION_CONFLICT');
  }
  const stale=await json(await h.route('/api/collection-jobs/job/product',{method:'POST',body:{expectedSource:{...f.proof,receivedAt:'2026-01-01T00:00:00.000Z'}}}),409);assert.equal(stale.code,'SOURCE_SELECTION_CONFLICT');
  h.sqlite.prepare('UPDATE source_inbox SET owner_id=? WHERE id=?').run('another-owner',f.proof.capture.captureId);
  assert.equal((await json(await h.route('/api/collection-jobs/job/product',{method:'POST',body:{expectedSource:f.proof}}),409)).code,'SOURCE_SELECTION_CONFLICT');
  h.sqlite.prepare('UPDATE source_inbox SET owner_id=?,company_code=?,company_name=? WHERE id=?').run('owner',companies[0].companyCode,companies[0].companyName,f.proof.capture.captureId);
  assert.equal((await json(await h.route('/api/collection-jobs/job/product',{method:'POST',body:{expectedSource:f.proof}}),409)).code,'SOURCE_SELECTION_CONFLICT');
  assert.deepEqual(products(h),before);assert.deepEqual(h.network,[]);assert.equal(h.aiSources.length,0);
 }finally{h.close();}
});

const races=['supplement','receivedAt','captureRevision','captureFingerprint','captureCompany','captureUrl','jobContext','jobSourceUrl','jobOwner'];
for(const mutation of races)test(`transaction rejects ${mutation} changed after selected proof validation without creating any product rows`,async()=>{
 const company=companies[1],h=mobileIntakeHarness(company);try{
  const f=await fixture(h,company,{version:2}),before=products(h),batch=h.db.batch.bind(h.db),prepare=h.db.prepare.bind(h.db),queries=new WeakMap();
  h.db.prepare=sql=>{const statement=prepare(sql);queries.set(statement,sql);return statement;};
  let interleaved=false;
  h.db.batch=async statements=>{
   if(!interleaved&&statements.some(statement=>/^INSERT INTO products\(/u.test(queries.get(statement)??''))){
    interleaved=true;
    if(mutation==='supplement'){
     const raw=h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get('job').payload;
     const result={...f.receipt,description:'동시에 보관된 별도 보완본'};
     h.sqlite.prepare('INSERT INTO collection_source_supplements VALUES(?,?,?,?,?,?)').run('job','owner',raw,JSON.stringify(result),JSON.stringify(result),new Date().toISOString());
    }else if(mutation==='receivedAt')h.sqlite.prepare('UPDATE collection_results SET received_at=? WHERE job_id=?').run('2026-01-01T00:00:00.000Z','job');
    else if(mutation==='captureRevision')h.sqlite.prepare('UPDATE source_inbox_captures SET revision=revision+1 WHERE id=?').run(f.proof.capture.captureId);
    else if(mutation==='captureFingerprint')h.sqlite.prepare('UPDATE source_inbox_captures SET fingerprint=? WHERE id=?').run('0'.repeat(64),f.proof.capture.captureId);
    else if(mutation==='captureCompany')h.sqlite.prepare('UPDATE source_inbox_captures SET company_code=?,company_name=? WHERE id=?').run(companies[0].companyCode,companies[0].companyName,f.proof.capture.captureId);
    else if(mutation==='captureUrl')h.sqlite.prepare("UPDATE source_inbox_captures SET payload=json_set(payload,'$.sourceUrl',?) WHERE id=?").run('https://detail.1688.com/offer/754000000001.html',f.proof.capture.captureId);
    else if(mutation==='jobContext')h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify({...h.context,keywords:'다른 요청 키워드'}),'job');
    else if(mutation==='jobSourceUrl')h.sqlite.prepare('UPDATE collection_jobs SET source_url=? WHERE id=?').run('https://detail.1688.com/offer/754000000001.html','job');
    else h.sqlite.prepare('UPDATE collection_jobs SET owner_id=? WHERE id=?').run('another-owner','job');
   }
   return batch(statements);
  };
  const response=await json(await h.route('/api/collection-jobs/job/product',{method:'POST',body:{expectedSource:f.proof}}),409);
  assert.equal(response.code,'SOURCE_SELECTION_CONFLICT');assert.equal(interleaved,true);assert.deepEqual(products(h),before);
  assert.deepEqual(h.network,[]);assert.equal(h.aiSources.length,0);assert.equal(h.stats.downloads,0);
 }finally{h.close();}
});
