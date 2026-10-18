import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {sizeChartApiFixture,companies,json,plain,sizeKeys} from './helpers/supplier-hub-single-size-chart.mjs';
const chart={sizeType:'직접 확인한 규격',sizeUnits:'mm',sizes:['소','대'],measurements:[{name:'폭',values:['120','180']},{name:'둘레',values:['','  ']}]},traces=[];
const hash=value=>createHash('sha256').update(value).digest('hex');
test.after(()=>fs.writeFileSync(new URL('../outputs/step707-backend-size-api-proof.json',import.meta.url),JSON.stringify({format:'step707-backend-size-api-proof-v1',traces,boundary:'Actual local content/attachment/quotation handlers and SQLite/R2 fixtures. Synthetic chart/images/schema. No live browser, product, network, provider or Hub writes.'},null,2)+'\n'));
for(const company of companies)test(`saved arbitrary size grid survives reload and image regeneration replaces only active size (${company.code})`,async()=>{
 const f=await sizeChartApiFixture(company),{h}=f;try{
  const content=async()=> (await json(await f.route(f.base+'/content'))).content,product=()=>h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id),pool=product().image_keys;
  const before=await content(),optionRaw=h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id).payload,settings=h.sqlite.prepare('SELECT * FROM workspace_settings WHERE owner_id=?').get('owner'),files=new Map([...h.objects].map(([key,value])=>[key,value.slice()]));
  let saved=(await json(await f.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:before.revision,patch:{manualSizeChart:chart}}}))).content;
  assert.deepEqual(plain(saved.manualSizeChart),chart);assert.deepEqual(plain(saved.assets.size.value),[]);assert.deepEqual(plain(saved.assets.label),plain(before.assets.label));assert.equal(product().image_keys,pool);
  const options=(await json(await f.route(f.base+'/options'))).options,plan=h.load('app/document-image.ts').documentImagePlan('size',saved,options);assert.deepEqual(plain(plan.rows),[['폭','120','180'],['둘레','-','  ']]);
  for(const key of [sizeKeys[3],sizeKeys[4]]){
   const version=product().updated_at,response=await json(await f.route(f.base+'/attachments',{method:'POST',body:{key,role:'size',expectedVersion:version,expectedContentRevision:saved.revision,expectedOptionRevision:options.revision}}));
   saved=response.content;assert.deepEqual(plain(saved.assets.size.value),[key]);assert.deepEqual(plain(saved.assets.label),plain(before.assets.label));assert.deepEqual(plain(saved.manualSizeChart),chart);
   await json(await f.route(f.base+'/attachments',{method:'POST',body:{key,role:'size',expectedVersion:version,expectedContentRevision:saved.revision-1,expectedOptionRevision:options.revision}}),409);
  }
  const active=saved.assets.size.value[0],quote=await json(await f.route(f.base+'/quotation-fields'+f.query));assert.equal(quote.resolved.rows.find(row=>row.optionId==='synthetic-one').fields[f.sizeField].value,active);assert.equal(quote.resolved.rows.find(row=>row.optionId==='synthetic-two').fields[f.sizeField].value,sizeKeys[1]);
  saved=(await json(await f.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:saved.revision,patch:{manualSizeChart:chart}}}))).content;assert.deepEqual(plain(saved.assets.size.value),[active]);
  const raw=h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(f.id);
  for(const malformed of [{...chart,sizeUnits:'kg'},{...chart,measurements:[{name:'폭',values:['1']}]},{...chart,guessed:true}]){await json(await f.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:saved.revision,patch:{manualSizeChart:malformed}}}),400);assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(f.id),raw);}
  await json(await f.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:saved.revision-1,patch:{manualSizeChart:null}}}),409);
  const changed=structuredClone(chart);changed.measurements[0].values[0]='125';saved=(await json(await f.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:saved.revision,patch:{manualSizeChart:changed}}}))).content;assert.deepEqual(plain(saved.assets.size.value),[]);
  saved=(await json(await f.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:saved.revision,patch:{manualSizeChart:null}}}))).content;assert.equal(Object.hasOwn(saved,'manualSizeChart'),false);assert.deepEqual(plain(saved.assets.label),plain(before.assets.label));
  assert.equal(h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id).payload,optionRaw);assert.deepEqual(h.sqlite.prepare('SELECT * FROM workspace_settings WHERE owner_id=?').get('owner'),settings);assert.equal(product().image_keys,pool);
  assert.equal(h.objects.size,files.size);for(const[key,bytes]of files)assert.deepEqual(h.objects.get(key),bytes);assert.deepEqual(h.network,[]);for(const table of ['supplier_hub_receipts','supplier_hub_single_receipts'])assert.equal(h.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0);
  traces.push({company,requests:f.requests,manualGridPreservedBeforeReset:true,generatedActiveSizeCount:1,oldSizeFilesRetained:true,labelAndPackagingAndSettingsPreserved:true,sourceOptionsSha256:hash(optionRaw),externalRequests:0,remoteReceipts:0});
 }finally{h.close();}
});
for(const company of companies)test(`grid edits cannot overwrite an image-pool change occurring after the content snapshot (${company.code})`,async()=>{
 const f=await sizeChartApiFixture(company),{h}=f;try{
  const current=(await json(await f.route(f.base+'/content'))).content,before=h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(f.id),product=h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id),db=h.bindings.DB;
  const prepare=db.prepare.bind(db),batch=db.batch.bind(db);db.prepare=sql=>Object.assign(prepare(sql),{sql});let injected=false;
  const changedPool=JSON.stringify([...JSON.parse(product.image_keys),'owner/concurrent-pool-change.png']);
  db.batch=async statements=>{if(!injected&&statements.some(statement=>statement.sql?.startsWith('INSERT INTO product_content('))){injected=true;h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(changedPool,f.id);}return batch(statements);};
  await json(await f.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:current.revision,patch:{manualSizeChart:chart}}}),409);
  assert.equal(injected,true);assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_content WHERE product_id=?').get(f.id),before);assert.equal(h.sqlite.prepare('SELECT image_keys FROM products WHERE id=?').get(f.id).image_keys,changedPool);assert.deepEqual(h.network,[]);
  traces.push({company,kind:'same-clock-image-pool-CAS',requests:f.requests,responseStatus:409,gridNotSaved:true,existingSizeRoleUnchanged:true,externalActorPoolPreserved:true,externalRequests:0});
 }finally{h.close();}
});
