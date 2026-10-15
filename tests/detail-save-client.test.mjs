import test from 'node:test';
import assert from 'node:assert/strict';
import { companies, json } from './helpers/image-download-ui.mjs';
import { makeCompositeFixture, loadComposite } from './helpers/detail-image-composite.mjs';
const signal=()=>new AbortController().signal;
const input=f=>({productId:f.product.id,optionId:f.optionId,profileId:f.view.categoryContext.profileId,view:f.view});
async function fixture(company){
 const f=await makeCompositeFixture(company,{count:4,manualHtml:'<p>보관할 수동 상세 HTML</p>'});
 const previous=f.request;
 f.request=async(url,init={})=>{
  if(!url.includes('/detail-save'))return previous(url,init);
  f.calls.push({url,init});
  return f.api.load('app/api/products/[id]/detail-save/route.ts')[init.method??'GET'](new Request('https://app.test'+url,{...init}),{params:Promise.resolve({id:f.product.id})});
 };
 return f;
}
for(const company of companies)test(`reviewed common/all-option save is one atomic quote commit and backs up manual text (${company.companyCode})`,async()=>{
 const f=await fixture(company);try{
  const runtime=loadComposite(f),helper=runtime.load('app/detail-save-client.ts'),prepared=await runtime.helper.prepareDetailComposite(input(f),signal(),f.request),before=f.retained(),attempt={};
  assert.equal(f.retained(),before);const saved=await helper.applyDetailSave(prepared,attempt,signal(),f.request);
  assert.equal(saved.revision,f.view.revision+1);assert.equal(saved.overrides.common.detailImages,attempt.key);assert.equal(saved.overrides.common.detailHtml,'');
  for(const row of saved.resolved.rows){assert.equal(row.fields.detailImages.value,attempt.key);assert.equal(row.fields.detailHtml.value,'');}
  const state=JSON.parse(f.api.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload);
  assert.ok(JSON.stringify(state).includes('보관할 수동 상세 HTML'));
  assert.equal(f.calls.filter(c=>c.url.endsWith('/attachments')&&c.init.method==='POST').length,0);
  assert.equal(f.calls.filter(c=>c.url.includes('/detail-save')&&c.init.method==='POST').length,1);
  const count=f.calls.filter(c=>c.init.method==='POST').length;assert.equal(await helper.applyDetailSave(prepared,attempt,signal(),f.request),saved);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,count);
 }finally{f.api.close();}
});
for(const stage of ['upload','save'])test(`lost ${stage} ACK is confirmed read-only and cannot duplicate a backup or file`,async()=>{
 const f=await fixture(companies[0]);try{
  const runtime=loadComposite(f),helper=runtime.load('app/detail-save-client.ts'),prepared=await runtime.helper.prepareDetailComposite(input(f),signal(),f.request),attempt={};let lost=true;
  const request=async(url,init={})=>{const response=await f.request(url,init);if(lost&&init.method==='POST'&&(stage==='upload'?url==='/api/files':url.includes('/detail-save'))){lost=false;throw Error('lost ACK');}return response;};
  await assert.rejects(helper.applyDetailSave(prepared,attempt,signal(),request),/lost ACK/);assert.equal(attempt.pending,stage);
  const writes=()=>f.calls.filter(c=>['POST','PUT','PATCH'].includes(c.init.method)).length,count=writes();
  const result=await helper.recoverDetailSave(prepared,attempt,signal(),request);assert.equal(writes(),count);assert.equal(result,stage==='save'?'completed':'ready');
  if(result==='ready')await helper.applyDetailSave(prepared,attempt,signal(),request);
  assert.ok(attempt.completed);assert.equal(f.calls.filter(c=>c.url==='/api/files'&&c.init.method==='POST').length,1);assert.equal(f.calls.filter(c=>c.url.includes('/detail-save')&&c.init.method==='POST').length,1);
 }finally{f.api.close();}
});
test('a later manual edit after an unknown commit stays uncertain and is never overwritten by recovery',async()=>{
 const f=await fixture(companies[1]);try{
  const runtime=loadComposite(f),helper=runtime.load('app/detail-save-client.ts'),prepared=await runtime.helper.prepareDetailComposite(input(f),signal(),f.request),attempt={};
  const request=async(url,init={})=>{const response=await f.request(url,init);if(url.includes('/detail-save')&&init.method==='POST')throw Error('lost save ACK');return response;};
  await assert.rejects(helper.applyDetailSave(prepared,attempt,signal(),request));
  const view=await json(await f.api.route(f.base+'/quotation-fields?profileId=cat'));
  await json(await f.api.route(f.base+'/quotation-fields?profileId=cat',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:f.optionId,fieldKey:'detailHtml',value:'<p>나중에 직접 수정한 내용</p>'}]}}));
  const before=f.retained(),count=f.calls.length;await assert.rejects(helper.recoverDetailSave(prepared,attempt,signal(),f.request));assert.equal(attempt.pending,'save');assert.equal(attempt.completed,undefined);assert.equal(f.retained(),before);assert.ok(f.calls.slice(count).every(c=>(c.init.method??'GET')==='GET'));
 }finally{f.api.close();}
});
for(const corrupt of ['beforeRevision','fingerprint','unrelated','label','provenance','textPolicy','textCommonFilled','textBasis','optionAlt'])test(`an incorrect ${corrupt} ACK is rejected and read-only recovery proves the actual commit`,async()=>{
 const f=await fixture(companies[0]);try{
  const runtime=loadComposite(f),helper=runtime.load('app/detail-save-client.ts'),prepared=await runtime.helper.prepareDetailComposite(input(f),signal(),f.request),attempt={};
  const request=async(url,init={})=>{const response=await f.request(url,init);if(url.includes('/detail-save')&&init.method==='POST'&&response.ok){const body=await response.json();if(corrupt==='beforeRevision')body.receipt.beforeRevision++;if(corrupt==='fingerprint')body.quotation.inputFingerprint='bad';if(corrupt==='unrelated')body.quotation.resolved.rows[0].fields.brand.value='wrong';if(corrupt==='label')body.quotation.resolved.rows[0].optionLabel='wrong';if(corrupt==='provenance')body.quotation.resolved.rows[0].fields.detailHtml.source='content';if(corrupt==='textPolicy')delete body.receipt.textPolicy;if(corrupt==='textCommonFilled')body.receipt.textCommonFilled=!body.receipt.textCommonFilled;if(corrupt==='textBasis')body.quotation.detailSaveTextBasis.metaDescription='wrong';if(corrupt==='optionAlt')body.quotation.resolved.rows.find(r=>r.optionId).fields.altText.value='wrong';return Response.json(body);}return response;};
  await assert.rejects(helper.applyDetailSave(prepared,attempt,signal(),request));assert.equal(attempt.pending,'save');assert.equal(await helper.recoverDetailSave(prepared,attempt,signal(),f.request),'completed');assert.ok(attempt.completed);
 }finally{f.api.close();}
});
test('a completed attempt cannot cross previews and completed-but-unadopted recovery rechecks current data',async()=>{
 const f=await fixture(companies[0]);try{
  const runtime=loadComposite(f),helper=runtime.load('app/detail-save-client.ts'),prepared=await runtime.helper.prepareDetailComposite(input(f),signal(),f.request),attempt={};
  await helper.applyDetailSave(prepared,attempt,signal(),f.request);const count=f.calls.length;
  await assert.rejects(helper.applyDetailSave({...prepared,optionId:'other-option'},attempt,signal(),f.request));
  await assert.rejects(helper.recoverDetailSave({...prepared,uploadId:'a'.repeat(64)},attempt,signal(),f.request));assert.equal(f.calls.length,count);
  const view=attempt.completed;await json(await f.api.route(f.base+'/quotation-fields?profileId=cat',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:f.optionId,fieldKey:'brand',value:'직접 수정한 브랜드'}]}}));
  const before=f.retained();await assert.rejects(helper.recoverDetailSave(prepared,attempt,signal(),f.request));assert.equal(attempt.pending,'save');assert.equal(f.retained(),before);
 }finally{f.api.close();}
});
