import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionNewDraftFixture,forkCompanies} from './helpers/collection-new-draft.mjs';
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const total=f=>['products','collection_jobs','collection_results','collection_products'].map(table=>f.api.sqlite.prepare('SELECT count(*) n FROM '+table).get().n);
async function fixture(company){
 const f=await collectionNewDraftFixture(company),originalResult=(await f.api.load('db/collection-results.ts').readCollectionResult('owner',f.oldJobId)).result;
 const source=(fresh=false)=>({format:'yoofam-page-source-v1',sourceUrl:f.sourceUrl,offerId:originalResult.offerId,collectedAt:new Date(Date.parse(originalResult.collectedAt)+(fresh?1:-1000)).toISOString(),title:fresh?'새 수집 상품명':'원래 수집 상품명',description:fresh?'새 상세 설명':'',attributes:fresh?[{name:'材质',value:'海绵'}]:[],options:[{key:'black',name:'黑色',supplierSku:'FRESH-BLACK',unitPriceCny:0.28,currency:'CNY',minimumOrder:1,stock:100,imageUrl:'https://cbu01.alicdn.com/synthetic-fresh-main.png',...(fresh?{packaging:{source:'package-table',weightG:10}}:{})}],images:[{url:'https://cbu01.alicdn.com/synthetic-fresh-main.png',role:'main'},...(fresh?[{url:'https://cbu01.alicdn.com/synthetic-fresh-detail.png',role:'detail'}]:[])]});
 const save=async snapshot=>{const id=crypto.randomUUID(),fingerprint=await f.api.load('app/source-inbox.ts').pageSourceFingerprint(snapshot),route=f.api.load('app/api/source-inbox/route.ts');const saved=await json(await route.POST(new Request('https://app.test/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:'owner',expectedCompany:company,id,fingerprint,snapshot})})));return f.api.load('db/source-inbox.ts').readSourceInbox('owner',saved.storedId);};
 await save(source());const captured=await save(source(true)),capture=structuredClone(f.api.load('app/source-capture-selection.ts').sourceCaptureSelection(captured)),input={...f.input,sourceCapture:capture};
 const preview=(target=input)=>f.request(f.endpoint+'?'+new URLSearchParams(Object.entries(target).map(([key,value])=>[key,key==='sourceCapture'?JSON.stringify(value):String(value)])));
 const post=(proof,target=input,id=crypto.randomUUID())=>f.request(f.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...target,requestId:id,baseFingerprint:proof.baseFingerprint})});
 return{...f,captured,capture,input,preview,post,save,source};
}
for(const company of forkCompanies)test(company.code+': exact newer capture creates separate draft with fresh packaging/detail and preserves all old edits',async()=>{
 const f=await fixture(company);try{const before=f.originalSnapshot(),sourceHistory=JSON.stringify(f.api.sqlite.prepare('SELECT * FROM source_inbox').all()),capturesHistory=JSON.stringify(f.api.sqlite.prepare('SELECT * FROM source_inbox_captures').all()),files=f.api.objects.size,preview=await json(await f.preview()),id=crypto.randomUUID();
  assert.deepEqual(preview.target.sourceCapture,f.capture);assert.equal(preview.source.collectedAt,f.captured.snapshot.collectedAt);assert.equal(preview.source.imageCount,2);assert.match(preview.warnings[0],/새 수집본/);
  const created=await json(await f.post(preview,f.input,id));assert.notEqual(created.productId,f.sourceProductId);assert.deepEqual(created.job.context.forkedFrom.sourceCapture,f.capture);
  const product=f.api.sqlite.prepare('SELECT * FROM products WHERE id=?').get(created.productId),content=await f.api.load('db/product-content.ts').readProductContent('owner',created.productId),options=await f.api.load('db/product-options.ts').readProductOptions('owner',created.productId),receipt=await f.api.load('db/collection-results.ts').readCollectionResult('owner',id);
  assert.equal(product.title,'새 수집 상품명');assert.equal(product.source_price_cny,0.28);assert.equal(product.supplier_hub_status,'미전송');assert.deepEqual(JSON.parse(product.image_keys),[]);
  assert.equal(content.seo.title.value,'새 수집 상품명');assert.equal(content.seo.description.value,'새 상세 설명');assert.equal(options.rows[0].unitCostCny,0.28);assert.equal(options.rows[0].packagedWeightG,10);assert.equal(options.rows[0].packagingUnitsPerPack,1);assert.equal(options.rows[0].packagedWidthMm,null);assert.equal(options.rows[0].weightKg,null);assert.equal(options.rows[0].translatedName,'');assert.equal(options.rows[0].provenance.packagedWeightG,'collected');
  assert.equal(receipt.result.provider,'chrome-current-page-v1');assert.equal(receipt.result.collectedAt,f.captured.snapshot.collectedAt);assert.deepEqual(structuredClone(receipt.result.attributes),[{name:'材质',value:'海绵'}]);assert.equal(receipt.result.images[1].role,'detail');assert.equal(f.api.sqlite.prepare('SELECT count(*) n FROM collection_images WHERE job_id=?').get(id).n,0);
  const recovered=await json(await f.post(preview,f.input,id));assert.equal(recovered.reused,true);assert.equal(recovered.productId,created.productId);await json(await f.post(preview,{...f.input,sourceCapture:{...f.capture,revision:2}},id),409);await json(await f.post(preview,{...f.input,sourceCapture:undefined},id),409);
  assert.equal(f.originalSnapshot(),before);assert.equal(JSON.stringify(f.api.sqlite.prepare('SELECT * FROM source_inbox').all()),sourceHistory);assert.equal(JSON.stringify(f.api.sqlite.prepare('SELECT * FROM source_inbox_captures').all()),capturesHistory);assert.deepEqual(total(f),[2,2,2,2]);assert.equal(f.api.objects.size,files);assert.equal(f.api.network.length,0);assert.equal(f.events.includes('translation'),false);
 }finally{f.close();}
});
for(const company of forkCompanies)test(company.code+': selected capture CAS changes reject atomically without old product mutation',async()=>{
 for(const change of ['review','payload','archive','company','delete','member','old-product','claim']){const f=await fixture(company);try{const preview=await json(await f.preview());let before;
  f.state.beforeBatch=queries=>{if(!queries.some(query=>query.sql.startsWith('INSERT INTO collection_jobs(id,owner_id')))return;f.state.beforeBatch=null;const db=f.api.sqlite;
   if(change==='review')db.prepare("UPDATE source_inbox_captures SET revision=revision+1,review_payload=json_set(payload,'$.title','수동 검토 변경') WHERE id=?").run(f.capture.captureId);
   if(change==='payload')db.prepare("UPDATE source_inbox_captures SET payload=json_set(payload,'$.description','수집본 경합 변경') WHERE id=?").run(f.capture.captureId);
   if(change==='archive')db.prepare('UPDATE source_inbox_captures SET archived_at=? WHERE id=?').run(new Date().toISOString(),f.capture.captureId);
   if(change==='company')db.prepare("UPDATE source_inbox_captures SET company_code='A00000000' WHERE id=?").run(f.capture.captureId);
   if(change==='delete')db.prepare('DELETE FROM source_inbox_captures WHERE id=?').run(f.capture.captureId);
   if(change==='member')db.prepare("UPDATE members SET status='suspended' WHERE id='owner'").run();
   if(change==='old-product')db.prepare("UPDATE products SET title='수동 경합 편집',updated_at=? WHERE id=?").run(new Date(Date.parse(preview.source.productVersion)+1).toISOString(),f.sourceProductId);
   if(change==='claim')db.prepare('DELETE FROM collection_offer_claims WHERE owner_id=?').run('owner');before=f.originalSnapshot();
  };
  await json(await f.post(preview),409);assert.deepEqual(total(f),[1,1,1,1],change);assert.equal(f.originalSnapshot(),before,change);assert.equal(f.api.network.length,0);
 }finally{f.close();}}
});
test('fresh selection is not silently replaced by latest capture; corrupt, foreign, stale and invalid selectors are rejected',async()=>{
 for(const change of ['unowned','foreign-company','fingerprint','revision','archived','old-time','other-url','query-format','mixed-mode']){const f=await fixture(forkCompanies[0]);try{let input=structuredClone(f.input),expected=409;const db=f.api.sqlite;
  if(change==='unowned'){input.sourceCapture.captureId=crypto.randomUUID();expected=404;}
  if(change==='foreign-company')db.prepare("UPDATE source_inbox_captures SET company_code='A01526306',company_name='유앤채' WHERE id=?").run(f.capture.captureId);
  if(change==='fingerprint')input.sourceCapture.fingerprint='a'.repeat(64);if(change==='revision')input.sourceCapture.revision++;
  if(change==='archived')db.prepare('UPDATE source_inbox_captures SET archived_at=? WHERE id=?').run(new Date().toISOString(),f.capture.captureId);
  if(change==='old-time'){const changed=f.source(true);changed.collectedAt=f.source().collectedAt;const saved=await f.save(changed);input.sourceCapture=f.api.load('app/source-capture-selection.ts').sourceCaptureSelection(saved);}
  if(change==='other-url'){input.sourceCapture.sourceUrl='https://detail.1688.com/offer/634000000002.html';expected=400;}
  if(change==='query-format'){input.sourceCapture.format='yoofam-saved-query-capture-v1';expected=400;}
  if(change==='mixed-mode'){input.sourceMode='pending-source-urls-v1';input.sourceReceiptHash='a'.repeat(64);expected=400;}
  const before=f.originalSnapshot();await json(await f.preview(input),expected);assert.deepEqual(total(f),[1,1,1,1],change);assert.equal(f.originalSnapshot(),before);
 }finally{f.close();}}
 const f=await fixture(forkCompanies[1]);try{const selected=await json(await f.preview()),next=f.source(true);next.collectedAt=new Date(Date.parse(next.collectedAt)+1).toISOString();next.title='더 새 수집본';await f.save(next);const pinned=await json(await f.preview());assert.deepEqual(pinned.target.sourceCapture,f.capture);assert.equal(pinned.baseFingerprint,selected.baseFingerprint);const created=await json(await f.post(pinned));assert.equal(f.api.sqlite.prepare('SELECT title FROM products WHERE id=?').get(created.productId).title,'새 수집 상품명');}finally{f.close();}
});
test('a selected capture changed by a transaction trigger rolls back every new row and claim',async()=>{
 const f=await fixture(forkCompanies[0]);try{const preview=await json(await f.preview()),before=f.originalSnapshot(),captures=JSON.stringify(f.api.sqlite.prepare('SELECT * FROM source_inbox_captures').all()),claim=JSON.stringify(f.api.sqlite.prepare('SELECT * FROM collection_offer_claims').all());
  f.api.sqlite.exec(`CREATE TRIGGER fresh_capture_race AFTER INSERT ON collection_results WHEN NEW.job_id<>'${f.oldJobId}' BEGIN UPDATE source_inbox_captures SET revision=revision+1 WHERE id='${f.capture.captureId}'; END;`);
  await json(await f.post(preview),409);assert.deepEqual(total(f),[1,1,1,1]);assert.equal(f.originalSnapshot(),before);assert.equal(JSON.stringify(f.api.sqlite.prepare('SELECT * FROM source_inbox_captures').all()),captures);assert.equal(JSON.stringify(f.api.sqlite.prepare('SELECT * FROM collection_offer_claims').all()),claim);
 }finally{f.close();}
});
for(const company of forkCompanies)test(company.code+': reviewed fresh capture works when old images are incomplete and never copies old image indices',async()=>{
 const f=await fixture(company);try{const route=f.api.load('app/api/source-inbox/route.ts'),reviewed=(await json(await route.PUT(new Request('https://app.test/api/source-inbox',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:'owner',id:f.capture.captureId,expectedRevision:1,review:{title:'새 수집본 직접 검토 제목',options:[{key:'black',name:'검토한 새 옵션',supplierSku:'FRESH-BLACK',unitPriceCny:0.4,currency:'CNY',minimumOrder:1}]}})})))).item;
  const selected={...f.input,sourceCapture:structuredClone(f.api.load('app/source-capture-selection.ts').sourceCaptureSelection(reviewed))};f.api.sqlite.prepare('DELETE FROM collection_images WHERE job_id=?').run(f.oldJobId);for(const key of f.keys)f.api.objects.delete(key);const before=f.originalSnapshot();
  await json(await f.preview(),409);const preview=await json(await f.preview(selected)),created=await json(await f.post(preview,selected)),options=await f.api.load('db/product-options.ts').readProductOptions('owner',created.productId),receipt=await f.api.load('db/collection-results.ts').readCollectionResult('owner',created.job.id);
  assert.equal(f.api.sqlite.prepare('SELECT title FROM products WHERE id=?').get(created.productId).title,'새 수집본 직접 검토 제목');assert.equal(options.rows[0].originalName,'검토한 새 옵션');assert.equal(options.rows[0].unitCostCny,0.4);assert.equal(options.rows[0].packagedWeightG,10);assert.equal(options.rows[0].packagedWidthMm,null);assert.equal(receipt.result.provider,'chrome-reviewed-page-v1');assert.equal(receipt.result.images[1].role,'detail');assert.equal(f.api.sqlite.prepare('SELECT count(*) n FROM collection_images WHERE job_id=?').get(created.job.id).n,0);assert.equal(f.originalSnapshot(),before);assert.equal(f.api.network.length,0);
 }finally{f.close();}
});
