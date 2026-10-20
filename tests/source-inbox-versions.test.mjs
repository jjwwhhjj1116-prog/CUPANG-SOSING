import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const sourceUrl='https://detail.1688.com/offer/700000000753.html',offerId='700000000753';
const id=index=>'00000000-0000-4000-8000-'+String(index).padStart(12,'0');
const companies=[{companyCode:'A01526306',companyName:'유앤채'},{companyCode:'A01464742',companyName:'와이홉'}];
const captureBase=Date.now()-600000;
const snapshot=(index=1,incomplete=false)=>({format:'yoofam-page-source-v1',sourceUrl,offerId,collectedAt:new Date(captureBase+index*1000).toISOString(),title:'합성 원문 상품 '+index,description:'합성 설명 '+index,
 options:[{key:'black',name:'검정 '+index,supplierSku:incomplete?null:'synthetic-sku-'+index,unitPriceCny:index+5,currency:incomplete?null:'CNY',minimumOrder:incomplete?null:1,stock:3,imageUrl:'https://cbu01.alicdn.com/synthetic-main-'+index+'.jpg'}],
 images:[{url:'https://cbu01.alicdn.com/synthetic-main-'+index+'.jpg',role:'main'},{url:'https://cbu01.alicdn.com/synthetic-detail-'+index+'.jpg',role:'detail'}],attributes:incomplete?[]:[{name:'재질',value:'면 '+index}]});
function harness(company=companies[1]){
 const h=mobileIntakeHarness(company),api=h.load('app/api/source-inbox/route.ts'),ready=h.load('app/api/source-inbox/ready/route.ts'),db=h.load('db/source-inbox.ts'),fingerprint=h.load('app/source-inbox.ts').pageSourceFingerprint;
 const request=(method,body)=>new Request('https://app.test/api/source-inbox',{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const post=async(index,source=snapshot(index))=>{const input={expectedOwnerId:'owner',expectedCompany:{code:company.companyCode,name:company.companyName},id:id(index),fingerprint:await fingerprint(source),snapshot:source};const response=await api.POST(request('POST',input));return {input,response,body:await response.json()};};
 const lookup=async(selection={})=>{const response=await ready.GET(new Request('https://app.test/api/source-inbox/ready?'+new URLSearchParams({sourceUrl,...selection})));return {response,body:await response.json()};};
 const review=async(item,title='수동 검토 상품')=>{const source=snapshot(9),response=await api.PUT(request('PUT',{expectedOwnerId:'owner',id:item.id,expectedRevision:item.revision,review:{title,options:source.options.map(row=>({...row,key:item.snapshot.options[0].key})).map(({key,name,supplierSku,unitPriceCny,currency,minimumOrder})=>({key,name,supplierSku,unitPriceCny,currency,minimumOrder}))}}));assert.equal(response.status,200,await response.clone().text());return (await response.json()).item;};
 const archive=async item=>{const response=await api.DELETE(request('DELETE',{expectedOwnerId:'owner',id:item.id,expectedRevision:item.revision}));assert.equal(response.status,200,await response.clone().text());};
 return {h,api,db,post,lookup,review,archive,request};
}
for(const company of companies)test(`explicit recapture preserves the original/manual review and exact selected versions (${company.companyCode})`,async()=>{
 const x=harness(company),{h}=x;try{
  const first=await x.post(1,snapshot(1,true));assert.equal(first.response.status,200);const base=await x.db.readSourceInbox('owner',id(1)),raw=h.sqlite.prepare('SELECT payload FROM source_inbox').get().payload;
  assert.equal((await x.lookup()).response.status,409);const reviewed=await x.review(base),manual=h.sqlite.prepare('SELECT review_payload FROM source_inbox').get().review_payload;
  const second=await x.post(2);assert.equal(second.response.status,200);assert.equal(second.body.duplicate,false);assert.equal(second.body.storedId,id(2));assert.equal(second.body.storedFingerprint,second.input.fingerprint);assert.equal(second.body.captureOriginId,id(1));assert.equal(second.body.captureVersion,2);
  assert.equal(h.sqlite.prepare('SELECT payload FROM source_inbox').get().payload,raw);assert.equal(h.sqlite.prepare('SELECT review_payload FROM source_inbox').get().review_payload,manual);assert.equal((await x.db.readSourceInbox('owner',id(1))).revision,reviewed.revision);
  const list=await (await x.api.GET()).json();assert.deepEqual(list.items.map(item=>[item.id,item.captureVersion]),[[id(2),2],[id(1),1]]);assert.deepEqual(list.limits,{active:40,retained:200});
  const latest=await x.lookup();assert.equal(latest.response.status,200);assert.equal(latest.body.capture.captureId,id(2));
  const old=await x.lookup({captureId:id(1),fingerprint:first.input.fingerprint,revision:String(reviewed.revision)});assert.equal(old.response.status,200);assert.equal(old.body.capture.captureId,id(1));
  const parsed=await h.load('app/owned-page-capture.ts').parseOwnedPageCapture('owner',old.body.capture,sourceUrl);assert.equal(parsed.title,'수동 검토 상품');assert.equal(parsed.options[0].unitPriceCny,14);
  const fresh=await h.load('app/owned-page-capture.ts').parseOwnedPageCapture('owner',latest.body.capture,sourceUrl);assert.equal(fresh.title,snapshot(2).title);assert.equal(fresh.options[0].unitPriceCny,7);assert.equal(fresh.options[0].sku,'synthetic-sku-2');assert.deepEqual(Array.from(fresh.attributes,pair=>({...pair})),[{name:'재질',value:'면 2'}]);assert.equal(fresh.images[0].url,snapshot(2).images[0].url);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);assert.equal(h.network.length,0);
 }finally{h.close();}
});
test('same snapshot retries deduplicate; changed collectedAt alone creates a separately retained immutable version',async()=>{
 const x=harness(),{h}=x;try{
  const original=snapshot(1),first=await x.post(1,original),retry=await x.post(1,original),same=await x.post(2,original);
  assert.equal(retry.response.status,200);assert.equal(retry.body.duplicate,true);assert.equal(same.body.duplicate,true);assert.equal(same.body.storedId,id(1));assert.equal(same.body.storedFingerprint,first.input.fingerprint);assert.equal(await x.db.readSourceInbox('owner',id(2)),null);
  const changed={...original,collectedAt:new Date(Date.parse(original.collectedAt)+1).toISOString()},second=await x.post(3,changed);assert.equal(second.response.status,200);assert.equal(second.body.duplicate,false);assert.equal(second.body.captureVersion,2);assert.equal(second.body.storedId,id(3));assert.equal(h.sqlite.prepare('SELECT count(*) n FROM source_inbox_captures').get().n,1);
  const invalid=await x.post(1,snapshot(4));assert.equal(invalid.response.status,409);assert.equal((await x.db.readSourceInbox('owner',id(1))).fingerprint,first.input.fingerprint);
 }finally{h.close();}
});
test('cross-version UUID collisions cannot rewrite another offer, source or company',async()=>{
 const x=harness(),{h}=x;try{
  await x.post(1);await x.post(2);const before=h.sqlite.prepare('SELECT * FROM source_inbox_captures').get();
  const other={...snapshot(3),sourceUrl:'https://detail.1688.com/offer/700000000754.html',offerId:'700000000754'};
  const reusedCapture=await x.post(2,other);assert.equal(reusedCapture.response.status,409);assert.deepEqual(h.sqlite.prepare('SELECT * FROM source_inbox_captures').get(),before);
  const collision=await x.post(1,other);assert.equal(collision.response.status,409);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM source_inbox').get().n,1);
  h.setCompany({code:'A01526306',name:'유앤채'});const mismatch=await x.api.POST(x.request('POST',{...(await x.post(3)).input,expectedCompany:{code:'A01526306',name:'유앤채'}}));assert.equal(mismatch.status,409);
  assert.equal(await x.db.readSourceInbox('other-owner',id(2)),null);assert.equal(h.network.length,0);
 }finally{h.close();}
});
test('review/archive/restore CAS applies only to the exact immutable capture version',async()=>{
 const x=harness(),{h}=x;try{
  await x.post(1);await x.post(2);const baseBefore=JSON.stringify(await x.db.readSourceInbox('owner',id(1))),capture=await x.db.readSourceInbox('owner',id(2)),edited=await x.review(capture);
  const stale=await x.api.DELETE(x.request('DELETE',{expectedOwnerId:'owner',id:id(2),expectedRevision:1}));assert.equal(stale.status,409);await x.archive(edited);
  assert.equal(await x.db.restoreSourceInbox('owner',id(2),edited.revision),null);const archived=await x.db.readSourceInbox('owner',id(2));assert.ok(archived.archivedAt);
  const restored=await x.post(2,snapshot(2));assert.equal(restored.response.status,200);const active=await x.db.readSourceInbox('owner',id(2));assert.equal(active.archivedAt,null);assert.equal(active.reviewed.title,'수동 검토 상품');assert.equal(active.revision,archived.revision+1);assert.equal(JSON.stringify(await x.db.readSourceInbox('owner',id(1))),baseBefore);
  assert.equal(h.sqlite.prepare('SELECT count(*) n FROM source_inbox_captures').get().n,1);
 }finally{h.close();}
});
test('explicit ready selectors reject missing/partial/stale or cross-offer capture without URL-latest fallback',async()=>{
 const x=harness(),{h}=x;try{
  const first=await x.post(1);await x.post(2);
  const exact={captureId:id(1),fingerprint:first.input.fingerprint,revision:'1'};
  for(const selection of [{captureId:id(1)},{...exact,captureId:id(99)},{...exact,fingerprint:'0'.repeat(64)},{...exact,revision:'2'},{...exact,revision:'01'},{...exact,sourceUrl:'https://detail.1688.com/offer/700000000754.html'}]){const result=await x.lookup(selection);assert.equal(result.response.status,409);assert.equal(result.body.code,'PAGE_SOURCE_LOOKUP_UNCERTAIN');}
  const original=await x.db.readSourceInbox('owner',id(1));await x.archive(original);const allowed=await x.lookup({...exact,revision:'2'});assert.equal(allowed.response.status,200,'archiving only hides the source; it does not destroy an exact selected original');
  assert.equal((await x.lookup()).body.capture.captureId,id(2));assert.equal(h.network.length,0);
 }finally{h.close();}
});
test('active and total-retention bounds apply across original and recapture tables without deleting records',async()=>{
 const x=harness(),{h}=x;try{
  for(let n=1;n<=40;n++)assert.equal((await x.post(n)).response.status,200);
  const full=await x.post(41);assert.equal(full.response.status,409);assert.match(full.body.error,/40.*200/);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM source_inbox_captures').get().n,39);
  for(let n=1;n<=40;n++)await x.archive(await x.db.readSourceInbox('owner',id(n)));
  for(let n=41;n<=200;n++){assert.equal((await x.post(n)).response.status,200);await x.archive(await x.db.readSourceInbox('owner',id(n)));}
  assert.equal((await x.post(201)).response.status,409);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM source_inbox').get().n,1);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM source_inbox_captures').get().n,199);assert.equal((await (await x.api.GET()).json()).items.length,0);
  const restored=await x.post(2,snapshot(2));assert.equal(restored.response.status,200,'exact retry restores one retained version without allocating retention');assert.equal((await (await x.api.GET()).json()).items.length,1);assert.equal(h.network.length,0);
 }finally{h.close();}
});
for(const company of companies)test(`a complete recapture unblocks source→draft→quotation without changing existing products or pinned receipts (${company.companyCode})`,async()=>{
 const x=harness(company),{h}=x;try{
  await h.intake();const existing=h.sqlite.prepare('SELECT * FROM products').get(),oldProduct=JSON.stringify(existing),oldContent=h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(existing.id).payload;
  const first=await x.post(1,snapshot(1,true));assert.equal((await x.lookup()).response.status,409);
  // The existing CDN harness returns synthetic PNG bytes only for its retained
  // fixture URLs. Use two inert URL references; no seller media is requested.
  const inert=await h.load('db/collection-results.ts').readCollectionResult('owner','job'),fresh=snapshot(2);fresh.images=['main','detail'].map(role=>({...inert.result.images.find(image=>image.role===role)}));fresh.options[0].imageUrl=fresh.images[0].url;
  const second=await x.post(2,fresh),ready=await x.lookup();assert.equal(ready.response.status,200);assert.equal(ready.body.capture.captureId,id(2));
  const jobId=id(900),now=new Date().toISOString();h.sqlite.prepare('INSERT INTO collection_jobs VALUES(?,?,?,?,?,?,?,?)').run(jobId,'owner',offerId,sourceUrl,'work','awaiting_connector',now,now);h.sqlite.prepare('INSERT INTO collection_context VALUES(?,?)').run(jobId,JSON.stringify(h.context));
  const job=await h.load('db/collection-jobs.ts').findCollectionJob('owner',jobId),beforeSourceRequests=h.network.filter(host=>host.includes('1688')||host==='itemcdn.tmall.com').length;let imported;
  const message=await h.load('app/intake-collection.ts').collectIntakeProduct(job,{signal:new AbortController().signal,fetcher:(path,init)=>h.route(path,{method:init?.method??'GET',body:init?.body}),probeExistingFromBrowser:async()=>ready.body.capture,captureFromBrowser:async()=>assert.fail('A selected stored recapture must never reopen a source URL'),onJob:value=>{imported=value;},onProgress(){}});
  assert.match(message,/초안/);assert.ok(imported.product_id);assert.notEqual(imported.product_id,existing.id);
  const source=await h.load('db/collection-results.ts').readCollectionResult('owner',jobId);assert.equal(source.result.title,second.input.snapshot.title);assert.equal(source.result.options[0].sku,'synthetic-sku-2');assert.equal(source.result.options[0].unitPriceCny,7);assert.deepEqual(Array.from(source.result.attributes,pair=>({...pair})),[{name:'재질',value:'면 2'}]);assert.equal(source.result.images[0].url,second.input.snapshot.images[0].url);
  const options=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(imported.product_id).payload),content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(imported.product_id).payload);assert.equal(options.rows[0].unitCostCny,7);assert.equal(options.rows[0].supplierSku,'synthetic-sku-2');assert.ok(options.rows[0].imageKey);assert.ok(content.assets.main.value.length);assert.ok(content.assets.detail.value.length);
  const quotation=await (await h.route('/api/products/'+imported.product_id+'/quotation-fields')).json();assert.equal(quotation.categoryContext.categoryId,'80719');assert.equal(quotation.resolved.rows[0].fields.kcMarkType.value,'해당사항없음');assert.equal(quotation.resolved.rows[0].fields.boxSkuQuantity.value,'50');
  const pinned=JSON.stringify(source),savedNewProduct=JSON.stringify(h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(imported.product_id));await x.post(3);assert.equal((await x.lookup()).body.capture.captureId,id(3));
  assert.equal(JSON.stringify(await h.load('db/collection-results.ts').readCollectionResult('owner',jobId)),pinned);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(imported.product_id)),savedNewProduct);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(existing.id)),oldProduct);assert.equal(h.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(existing.id).payload,oldContent);
  const original=await x.db.readSourceInbox('owner',id(1));assert.equal(original.fingerprint,first.input.fingerprint);assert.equal(original.snapshot.options[0].supplierSku,null);assert.equal(original.reviewed,null);assert.equal(h.network.filter(host=>host.includes('1688')||host==='itemcdn.tmall.com').length,beforeSourceRequests);assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(imported.product_id).supplier_hub_status,'미전송');
 }finally{h.close();}
});
