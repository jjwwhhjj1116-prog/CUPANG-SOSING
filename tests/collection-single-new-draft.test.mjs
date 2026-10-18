import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionSingleNewDraftFixture,forkCompanies,json} from './helpers/collection-single-new-draft.mjs';

for(const company of forkCompanies)test(`verified Single without Excel supports a separate current-input fork (${company.code})`,async()=>{
 const f=await collectionSingleNewDraftFixture(company);try{
  const original=f.originalSnapshot(),bytes=new Map([...f.api.objects].map(([key,value])=>[key,value.slice()]));assert.equal(f.target.template,null);
  const preview=await f.preview(),requestId=crypto.randomUUID(),created=await f.create(preview,f.input,requestId);
  assert.notEqual(created.productId,f.sourceProductId);assert.equal(created.job.context.category.template,null);assert.equal(created.job.context.category.id,f.target.id);
  assert.equal(created.job.context.company.code,company.code);assert.equal(created.job.context.settings.brand,f.settings.brand);assert.equal(created.source.collectedAt,preview.source.collectedAt);
  const repeated=await f.create(preview,f.input,requestId);assert.equal(repeated.productId,created.productId);assert.equal(repeated.reused,true);
  const recovered=await json(await f.request(f.endpoint+'?'+new URLSearchParams({requestId,baseFingerprint:preview.baseFingerprint})));assert.equal(recovered.productId,created.productId);
  assert.equal(f.originalSnapshot(),original);for(const[key,value]of bytes)assert.deepEqual(f.api.objects.get(key),value);assert.equal(f.api.objects.size,bytes.size);
  assert.equal(f.api.sqlite.prepare('SELECT count(*) n FROM products').get().n,2);assert.equal(f.api.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(created.productId).supplier_hub_status,'미전송');
  assert.equal(f.api.sqlite.prepare('SELECT count(*) n FROM supplier_hub_receipts').get().n,0);assert.equal(f.api.sqlite.prepare('SELECT count(*) n FROM supplier_hub_single_receipts').get().n,0);assert.deepEqual(f.api.network,[]);
 }finally{f.close();}
});

for(const company of forkCompanies)test(`Single scope aliases and raw identity agree; unverified or mismatched forms never fork (${company.code})`,async()=>{
 const f=await collectionSingleNewDraftFixture(company);try{
  const db=f.api.sqlite,row=db.prepare('SELECT payload FROM category_profiles WHERE id=?').get(f.target.id),base=JSON.parse(row.payload),before=f.originalSnapshot();
  const check=async(value,label)=>{db.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(value),f.target.id);const response=await f.request(f.endpoint+'?'+f.query(f.input));assert.equal(response.status,409,label+':'+await response.clone().text());assert.equal(f.originalSnapshot(),before);assert.equal(db.prepare('SELECT count(*) n FROM products').get().n,1);};
  for(const change of [
   schema=>{schema.metadata.scopeType='Retail_Categorized_Excel';},schema=>{schema.metadata.scope='Retail_Categorized_Excel';},schema=>{schema.metadata.noticeNumber=18;},schema=>{schema.metadata.categoryId=3001;},schema=>{schema.metadata.version=74;},
   schema=>{const raw=JSON.parse(schema.schemaString);raw.metadata=raw.metadata.replace('Single','Excel');schema.schemaString=JSON.stringify(raw);},
   schema=>{const raw=JSON.parse(schema.schemaString);raw.metadata=raw.metadata.replace('categoryId:3000','categoryId:3001');schema.schemaString=JSON.stringify(raw);},
   schema=>{const raw=JSON.parse(schema.schemaString);raw.metadata=raw.metadata.replace('productNoticeCategoryId:17','productNoticeCategoryId:18');schema.schemaString=JSON.stringify(raw);},
   schema=>{const raw=JSON.parse(schema.schemaString);raw.metadata=raw.metadata.replace('version:73','version:74');schema.schemaString=JSON.stringify(raw);},
   schema=>{const raw=JSON.parse(schema.schemaString);raw.metadata+=';version:73';schema.schemaString=JSON.stringify(raw);},
   schema=>{const raw=JSON.parse(schema.schemaString);delete raw.metadata;schema.schemaString=JSON.stringify(raw);},
   schema=>{const raw=JSON.parse(schema.schemaString);raw.properties.startPage.properties.productName.pattern='^unverified$';schema.schemaString=JSON.stringify(raw);},
   schema=>{schema.company=forkCompanies.find(value=>value.code!==company.code);},
  ]){const target=structuredClone(base);change(target.hubSchema);await check(target,change.toString());}
  const legacy=structuredClone(base);legacy.template=JSON.parse(JSON.stringify(f.excelTarget.template));delete legacy.template.workbookEvidence;delete legacy.template.workbookFields;await check(legacy,'valid unverified template');
  const good=structuredClone(base);good.hubSchema.metadata={scope:'Retail_Categorized_Single',categoryId:'3000',noticeNumber:'17',version:'73'};
  db.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(good),f.target.id);const preview=await f.preview();assert.equal(preview.target.category.template,null);assert.equal(f.originalSnapshot(),before);
  assert.deepEqual(f.api.network,[]);
 }finally{f.close();}
});

for(const company of forkCompanies)test(`Single profile/settings/member/claim CAS and cancellation preserve every source row (${company.code})`,async()=>{
 for(const change of ['profile','settings','member','claim']){
  const f=await collectionSingleNewDraftFixture(company);try{const preview=await f.preview();let observed,triggered=false;
   f.state.beforeBatch=queries=>{if(!queries.some(query=>query.sql.startsWith('INSERT INTO collection_jobs(id,owner_id')))return;f.state.beforeBatch=null;triggered=true;const db=f.api.sqlite;
    if(change==='profile')db.prepare("UPDATE category_profiles SET payload=json_set(payload,'$.name','동일시각 경합 양식') WHERE id=?").run(f.target.id);
    if(change==='settings')db.prepare("UPDATE workspace_settings SET payload=json_set(payload,'$.brand','경합 브랜드') WHERE owner_id='owner'").run();
    if(change==='member')db.prepare("UPDATE members SET status='suspended' WHERE id='owner'").run();
    if(change==='claim')db.prepare('DELETE FROM collection_offer_claims WHERE owner_id=? AND offer_id=?').run('owner','634000000001');observed=f.originalSnapshot();};
   await json(await f.request(f.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...f.input,requestId:crypto.randomUUID(),baseFingerprint:preview.baseFingerprint})}),409);
   assert.equal(triggered,true);assert.equal(f.originalSnapshot(),observed);for(const table of ['products','collection_jobs','collection_products','collection_results'])assert.equal(f.api.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,1,change+':'+table);assert.deepEqual(f.api.network,[]);
  }finally{f.close();}
 }
 const f=await collectionSingleNewDraftFixture(company);try{
  for(const mode of ['owner','company','cancelled']){
   f.state.ownerId=mode==='owner'?'other-owner':'owner';f.state.company=mode==='company'?forkCompanies.find(value=>value.code!==company.code):company;
   if(mode==='cancelled')f.api.sqlite.prepare("UPDATE collection_jobs SET status='cancelled' WHERE id=?").run(f.oldJobId);
   const before=f.originalSnapshot();await json(await f.request(f.endpoint+'?'+f.query(f.input)),mode==='owner'?404:409);assert.equal(f.originalSnapshot(),before);
  }
 }finally{f.close();}
});
