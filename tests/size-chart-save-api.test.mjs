import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {sizeChartSaveFixture,companies,json,chart} from './helpers/size-chart-save.mjs';
const traces=[],hash=value=>createHash('sha256').update(value).digest('hex');
test.after(()=>fs.writeFileSync(new URL('../outputs/step763-size-chart-save-api-proof.json',import.meta.url),JSON.stringify({format:'step763-size-chart-save-api-v1',traces,LIVE_VERIFIED:false,boundary:'Actual API/coordinator/temporary SQLite and immutable synthetic PNG objects. No real products, source collection, Chrome or Supplier Hub writes.'},null,2)+'\n'));
for(const company of companies)test(`one size-chart save atomically connects reviewed grid and PNG, preserves individual overrides (${company.code})`,async()=>{
 const f=await sizeChartSaveFixture(company);try{
  const attempt=await f.prepare(),beforeOptions=f.h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id).payload,beforeQuotes=f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id).payload,oldObjects=new Map([...f.h.objects].map(([key,bytes])=>[key,bytes.slice()]));
  const receipt=await json(await f.post(attempt));assert(await f.model.verifySizeChartSaveReceipt(attempt.before,attempt.input,receipt,attempt.blob.size));assert.deepEqual(receipt.content.manualSizeChart,chart);assert.equal(receipt.content.revision,attempt.before.content.revision+1);
  const key=f.model.sizeChartSaveKey('owner',attempt.input.uploadId);assert.deepEqual(receipt.content.assets.size.value,[key]);assert.equal(f.h.sqlite.prepare('SELECT payload FROM product_options WHERE product_id=?').get(f.id).payload,beforeOptions);assert.equal(f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields WHERE product_id=?').get(f.id).payload,beforeQuotes);
  const quote=await json(await f.route(f.base+'/quotation-fields'+f.query));assert.equal(quote.resolved.rows.find(row=>row.optionId==='synthetic-one').fields[f.sizeField].value,key);assert.notEqual(quote.resolved.rows.find(row=>row.optionId==='synthetic-two').fields[f.sizeField].value,key);
  const reloaded=await json(await f.get(attempt.input.uploadId));assert(await f.model.verifySizeChartSaveReceipt(attempt.before,attempt.input,reloaded,attempt.blob.size));for(const[key,bytes]of oldObjects)assert.deepEqual(f.h.objects.get(key),bytes);assert.deepEqual(f.h.network,[]);
  traces.push({company,kind:'one-save',contentRevision:receipt.content.revision,activeSizeImages:1,oneSqlSave:true,individualOverridePreserved:true,optionPayloadSha256:hash(beforeOptions),quotationPayloadSha256:hash(beforeQuotes),remoteRequests:0});
 }finally{f.close();}
});
test('without individual overrides a new common chart is reflected by every included option',async()=>{
 const f=await sizeChartSaveFixture();try{
  const current=await json(await f.route(f.base+'/quotation-fields'+f.query));await json(await f.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes:[{fieldKey:f.sizeField,optionId:'synthetic-two',value:null}]}}));
  const attempt=await f.prepare(),saved=await json(await f.post(attempt)),view=await json(await f.route(f.base+'/quotation-fields'+f.query)),key=saved.content.assets.size.value[0];
  assert(view.resolved.rows.filter(row=>row.included&&row.optionId).every(row=>row.fields[f.sizeField].value===key));traces.push({kind:'common-chart-all-included-options',includedOptions:2,automaticImage:key,remoteRequests:0});
 }finally{f.close();}
});
for(const kind of ['option-raw','source-raw','category-raw','member-company'])test(`${kind} race fences a size-chart save and preserves SQL state`,async()=>{
 const f=await sizeChartSaveFixture();try{
  const attempt=await f.prepare();let injectedState;
  f.before(()=>{if(kind==='option-raw')f.h.sqlite.prepare("UPDATE product_options SET payload=replace(payload,'검정','합성 수정') WHERE product_id=?").run(f.id);if(kind==='source-raw')f.h.sqlite.prepare('UPDATE products SET title=? WHERE id=?').run('동시 사용자 제목',f.id);if(kind==='category-raw')f.h.sqlite.prepare("UPDATE category_profiles SET payload=replace(payload,'SYNTHETIC-SINGLE-DOCUMENT-652','SYNTHETIC-CHANGED') WHERE id=?").run(f.profile.id);if(kind==='member-company')f.h.sqlite.prepare('UPDATE members SET company_code=? WHERE id=?').run('A01464742','owner');injectedState=f.dbState();});
  await json(await f.post(attempt),409);assert.equal(f.dbState(),injectedState);assert.deepEqual(f.h.network,[]);traces.push({kind,responseStatus:409,sqlChangesBySave:0,pngOrphanRetained:true,remoteRequests:0});
 }finally{f.close();}
});
for(const fault of [1,2])test(`SQL companion fault ${fault} rolls back grid, role, pool and product clock`,async()=>{
 const f=await sizeChartSaveFixture();try{const attempt=await f.prepare(),before=f.dbState();f.fault(fault);await json(await f.post(attempt),503);assert.equal(f.dbState(),before);assert.equal(f.h.objects.size>attempt.before.imageKeys.length,true);traces.push({kind:'rollback',fault,sqlUnchanged:true,privateOrphanPossible:true});}finally{f.close();}
});
for(const clock of ['2099-01-01T00:00:00.000Z','old'])test(`product clock trigger ${clock} cannot partially commit chart metadata`,async()=>{
 const f=await sizeChartSaveFixture();try{const attempt=await f.prepare(),before=f.dbState(),value=clock==='old'?attempt.before.productVersion:clock;f.h.sqlite.exec(`CREATE TRIGGER synthetic_size_clock AFTER UPDATE ON products BEGIN UPDATE products SET updated_at='${value}' WHERE id=NEW.id; END;`);await json(await f.post(attempt),503);assert.equal(f.dbState(),before);traces.push({kind:'clock-trigger-rollback',clock,sqlUnchanged:true});}finally{f.close();}
});
for(const mutation of ['options','content','product-title'])test(`first size-chart write SQL trigger changing ${mutation} cannot leave a partial commit`,async()=>{
 const f=await sizeChartSaveFixture();try{
  const attempt=await f.prepare(),before=f.dbState();
  const sql=mutation==='options'?"UPDATE product_options SET payload=replace(payload,'검정','합성 옵션 변경') WHERE product_id=NEW.product_id;":mutation==='content'?"UPDATE product_content SET payload=replace(payload,'사용자가 확인한 규격','합성 표 변경') WHERE product_id=NEW.product_id;":"UPDATE products SET title='합성 동시 제목' WHERE id=NEW.product_id;";
  f.h.sqlite.exec(`CREATE TRIGGER synthetic_size_raw AFTER UPDATE ON product_content BEGIN ${sql} END;`);
  await json(await f.post(attempt),503);assert.equal(f.dbState(),before);traces.push({kind:'first-write-trigger-rollback',mutation,sqlUnchanged:true,pngOrphanRetained:true});
 }finally{f.close();}
});
test('unknown committed ACK is recovered by GET with exactly one explicit POST',async()=>{
 const f=await sizeChartSaveFixture();try{const attempt=await f.prepare();let posts=0;const fetcher=async(path,init={})=>{const response=await f.fetcher(path,init);if(init.method==='POST'){posts++;assert.equal(response.status,200);throw Error('synthetic lost ACK');}return response;};const receipt=await f.client.sendSizeChartSaveAttempt(attempt,{current:()=>true,fetcher});assert.equal(posts,1);assert(await f.model.verifySizeChartSaveReceipt(attempt.before,attempt.input,receipt,attempt.blob.size));assert.equal(f.calls.filter(item=>item.method==='POST').length,1);traces.push({kind:'committed-unknown-ACK',posts,readOnlyRecovery:true});}finally{f.close();}
});
test('unknown uncommitted ACK never auto-posts, explicit retry reuses the retained PNG',async()=>{
 const f=await sizeChartSaveFixture();try{const attempt=await f.prepare();f.fault(1);let posts=0;const controls={current:()=>true,fetcher:async(path,init={})=>{if(init.method==='POST')posts++;return f.fetcher(path,init);}};await assert.rejects(f.client.sendSizeChartSaveAttempt(attempt,controls));assert.equal(posts,1);assert.equal(attempt.uncommitted,true);const objectCount=f.h.objects.size;f.fault(undefined);const receipt=await f.client.sendSizeChartSaveAttempt(attempt,controls,true);assert.equal(posts,2);assert.equal(f.h.objects.size,objectCount);assert(await f.model.verifySizeChartSaveReceipt(attempt.before,attempt.input,receipt,attempt.blob.size));traces.push({kind:'uncommitted-unknown-ACK',automaticReposts:0,explicitRetry:true,reusedSamePng:true});}finally{f.close();}
});
test('malformed receipt or PNG identity cannot acknowledge a different grid',async()=>{
 const f=await sizeChartSaveFixture();try{const attempt=await f.prepare(),receipt=await json(await f.post(attempt));for(const alter of [value=>value.upload.sha256='0'.repeat(64),value=>value.upload.chartSha256='1'.repeat(64),value=>value.content.manualSizeChart.measurements[0].values[0]='999',value=>value.options.revision++,value=>value.quotationRevision++]){const bad=structuredClone(receipt);alter(bad);assert.equal(await f.model.verifySizeChartSaveReceipt(attempt.before,attempt.input,bad,attempt.blob.size),false);}traces.push({kind:'strict-receipt',badReceipts:5,accepted:0});}finally{f.close();}
});
test('same-revision quotation raw change between preview and POST is rejected before storing PNG',async()=>{
 const f=await sizeChartSaveFixture();try{const attempt=await f.prepare();f.h.sqlite.prepare("UPDATE product_quotation_fields SET payload=replace(payload,'25910','25920') WHERE product_id=?").run(f.id);const before=f.dbState(),objects=f.h.objects.size;await json(await f.post(attempt),409);assert.equal(f.dbState(),before);assert.equal(f.h.objects.size,objects);traces.push({kind:'pre-request-same-revision-quotation',status:409,sqlUnchanged:true,pngWrites:0});}finally{f.close();}
});
test('unowned legacy pool entries fail closed instead of being normalized away',async()=>{
 const f=await sizeChartSaveFixture();try{const attempt=await f.prepare(),product=f.h.sqlite.prepare('SELECT image_keys FROM products WHERE id=?').get(f.id);f.h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([...JSON.parse(product.image_keys),'other-owner/legacy.png']),f.id);const before=f.dbState();await json(await f.post(attempt),409);await json(await f.get(),409);assert.equal(f.dbState(),before);traces.push({kind:'legacy-foreign-pool',normalized:false,status:409});}finally{f.close();}
});
