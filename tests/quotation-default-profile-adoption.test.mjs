import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/quotation-receipt-source.mjs';
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
test('default collection editor adopts the exact mapped job without changing its editor basis',async()=>{
 const {f,h}=await fixture();try{
  const state=await json(await f.request(undefined,'GET')),out=await json(await f.request(f.requestBody(state)));
  const view=await json(await h.route(f.base+'/quotation-fields'));
  assert.equal(view.categoryContext.source,'collection');
  const proposal=out.job.result.changes.find(change=>['empty','schema','couplus-default'].includes(view.resolved.rows.find(row=>row.optionId===change.optionId)?.fields[change.fieldKey]?.source));assert.ok(proposal);
  const payload=JSON.parse(JSON.stringify({expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[],generatedAdoption:{jobId:out.job.id,targets:[{optionId:proposal.optionId,fieldKey:proposal.fieldKey}]}}));
  const saved=await json(await h.route(f.base+'/quotation-fields',{method:'PUT',body:payload}));
  assert.equal(saved.revision,view.revision+1);
  assert.equal(saved.resolved.rows.find(row=>row.optionId===proposal.optionId).fields[proposal.fieldKey].value,proposal.value);
  assert.equal(saved.resolved.rows.find(row=>row.optionId===proposal.optionId).fields[proposal.fieldKey].source,'generated');
  const reader=h.load('app/exports/quotation-source.ts');
  for(const source of [await reader.readMappedQuotationSource('owner',f.id,null),await reader.readQuotationExportSource('owner',f.id,null)]){
   const resolved=reader.resolveQuotationExport(source);assert.equal(resolved.rows.find(row=>row.optionId===proposal.optionId).fields[proposal.fieldKey].value,proposal.value);
   const projection=await h.load('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument({snapshot:source.hubSchema,company:source.company,categoryId:source.categoryContext.categoryId,categoryPath:source.categoryContext.categoryPath,resolved});
   const wire=resolved.schema.fields.find(field=>field.id===proposal.fieldKey).hubWire;let native=projection.payload.jsonDocument[0];for(const part of wire.path)native=native[part];
   if(Array.isArray(native))native=native.find(item=>item[wire.nameKey]===wire.name)?.[wire.valueKey];assert.equal(native,proposal.value);
  }
  const blank=await json(await h.route(f.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:saved.revision,expectedInputFingerprint:saved.inputFingerprint,changes:[{optionId:proposal.optionId,fieldKey:proposal.fieldKey,value:''}]}}));
  assert.equal(blank.resolved.rows.find(row=>row.optionId===proposal.optionId).fields[proposal.fieldKey].value,'');
  assert.equal(blank.resolved.rows.find(row=>row.optionId===proposal.optionId).fields[proposal.fieldKey].source,'manual-option');
  const reset=await json(await h.route(f.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:blank.revision,expectedInputFingerprint:blank.inputFingerprint,changes:[{optionId:proposal.optionId,fieldKey:proposal.fieldKey,value:null}]}}));
  assert.equal(reset.resolved.rows.find(row=>row.optionId===proposal.optionId).fields[proposal.fieldKey].source,'generated');
  h.sqlite.prepare('UPDATE category_profiles SET revision=revision+1 WHERE id=?').run(f.profile.id);
  const retired=await json(await h.route(f.base+'/quotation-fields'));assert.notEqual(retired.resolved.rows.find(row=>row.optionId===proposal.optionId).fields[proposal.fieldKey].source,'generated');
  const direct=reader.resolveQuotationExport(await reader.readQuotationExportSource('owner',f.id,null));assert.notEqual(direct.rows.find(row=>row.optionId===proposal.optionId).fields[proposal.fieldKey].source,'generated');
 }finally{f.close();}
});

for(const mode of ['revision','owner','company','schema','category','source'])test(`default adoption rejects changed ${mode} without a quotation write`,async()=>{
 const {f,h}=await fixture();try{
  const state=await json(await f.request(undefined,'GET')),out=await json(await f.request(f.requestBody(state))),view=await json(await h.route(f.base+'/quotation-fields'));
  const proposal=out.job.result.changes[0],before=h.sqlite.prepare('SELECT * FROM product_quotation_fields WHERE product_id=?').get(f.id);
  const profile=h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(f.profile.id),payload=JSON.parse(profile.payload);
  if(mode==='revision')h.sqlite.prepare('UPDATE category_profiles SET revision=revision+1 WHERE id=?').run(f.profile.id);
  if(mode==='owner')h.sqlite.prepare('UPDATE category_profiles SET owner_id=? WHERE id=?').run('foreign',f.profile.id);
  if(mode==='company'){payload.hubSchema.company=payload.hubSchema.company.code==='A01526306'?{code:'A01464742',name:'와이홉'}:{code:'A01526306',name:'유앤채'};h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(payload),f.profile.id);}
  if(mode==='schema'){payload.hubSchema.schemaString+=' ';h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(payload),f.profile.id);}
  if(mode==='category'){payload.categoryPath=[...payload.categoryPath].reverse();h.sqlite.prepare('UPDATE category_profiles SET payload=? WHERE id=?').run(JSON.stringify(payload),f.profile.id);}
  if(mode==='source')h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('changed-source-clock',f.id);
  const response=await h.route(f.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[],generatedAdoption:{jobId:out.job.id,targets:[{optionId:proposal.optionId,fieldKey:proposal.fieldKey}]}}});
  assert.notEqual(response.status,200);assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_quotation_fields WHERE product_id=?').get(f.id),before);
 }finally{f.close();}
});
test('default no-layer view preserves its public hash without reading an unrelated profile',async()=>{
 const {f,h}=await fixture();try{
  const before=await json(await h.route(f.base+'/quotation-fields'));
  h.sqlite.prepare('DELETE FROM category_profiles WHERE id=?').run(f.profile.id);
  const after=await json(await h.route(f.base+'/quotation-fields'));
  assert.deepEqual(after,before);
 }finally{f.close();}
});

test('default adoption fences mapped profile changes immediately before the atomic save',async()=>{
 const {f,h}=await fixture();try{
  const state=await json(await f.request(undefined,'GET')),out=await json(await f.request(f.requestBody(state))),view=await json(await h.route(f.base+'/quotation-fields')),proposal=out.job.result.changes[0];
  const prepare=h.db.prepare,batch=h.db.batch;let armed=false,changed=false;
  h.db.prepare=function(sql){if(sql.includes('INSERT INTO product_quotation_fields(product_id'))armed=true;return prepare.call(this,sql);};
  h.db.batch=async function(statements){if(armed&&!changed){changed=true;h.sqlite.prepare('UPDATE category_profiles SET revision=revision+1 WHERE id=?').run(f.profile.id);}return batch.call(this,statements);};
  const before=h.sqlite.prepare('SELECT * FROM product_quotation_fields WHERE product_id=?').get(f.id);
  const response=await h.route(f.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[],generatedAdoption:{jobId:out.job.id,targets:[{optionId:proposal.optionId,fieldKey:proposal.fieldKey}]}}});
  assert.equal(changed,true);assert.equal(response.status,409);assert.deepEqual(h.sqlite.prepare('SELECT * FROM product_quotation_fields WHERE product_id=?').get(f.id),before);
 }finally{f.close();}
});
