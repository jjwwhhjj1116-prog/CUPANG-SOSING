import test from 'node:test';
import assert from 'node:assert/strict';
import {seoWorkspaceHarness} from './helpers/seo-workspace.mjs';
import {seoWorkspaceEditor,nodes,visibleText,responseJson} from './helpers/seo-workspace-editor.mjs';

function fixture(){
 const api=seoWorkspaceHarness(),generated=api.load('app/seo-generated-draft.ts');
 const content=structuredClone(api.content),options=structuredClone(api.options);
 for(const field of ['title','keywords','description'])content.seo[field].provenance='collected';
 content.seo.title.value='原文商品';content.seo.keywords.value=[];content.seo.description.value='原文说明';
 options.rows[0].translatedName='';options.rows[0].provenance.translatedName='collected';
 options.rows.push({...structuredClone(options.rows[0]),id:'manual-blank',translatedName:'',provenance:{...options.rows[0].provenance,translatedName:'manual'}});
 const job={id:'completed-seo-job',productId:api.id,productVersion:api.version,contentRevision:content.revision,status:'completed',error:null,
  review:{model:'test-source-bound-ai',fingerprint:'a'.repeat(64),source:{title:'原文商品',description:'原文说明',reference:'exact-source',attributes:options.rows.map(row=>({name:'option:'+row.id,value:row.originalName}))}},
  result:{model:'test-source-bound-ai',draft:{title:'검토할 상품',keywords:['검토 태그'],description:'검토할 상품 설명',attributes:options.rows.map((row,index)=>({sourceIndex:index,name:'옵션',value:index?'다른 옵션':'생성한 한국어 옵션'})),warnings:[]}}};
 api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content),api.id);api.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options),api.id);
 const seed=()=>generated.createSeoGeneratedDraft({ownerId:'owner',productVersion:api.version,content,options,job,brand:'와이홉'});
 return{api,module:generated,content,options,job,seed};
}

test('a completed exact-source job seeds editable SEO and names without mutations, then one explicit SEO save adopts the reviewed values',async()=>{
 const f=fixture(),{api}=f,h=seoWorkspaceEditor(api,{props:{workspaceOwnerId:'owner'}});try{
  await h.idle();const before=api.stored(),seed=f.seed();assert.deepEqual(JSON.parse(JSON.stringify(seed.values.optionNames)),{[f.options.rows[0].id]:'생성한 한국어 옵션'});h.patch({generatedDraft:seed});await h.idle();
  assert.equal(h.input('SEO 상품명').props.value,'와이홉 검토할 상품');assert.equal(h.input('SEO 검색태그').props.value,'검토 태그');assert.equal(h.input('1번째 한국어 옵션명').props.value,'생성한 한국어 옵션');assert.equal(h.input('3번째 한국어 옵션명').props.value,'');assert.equal(h.calls.filter(call=>call.method==='PATCH').length,0);assert.deepEqual(api.stored(),before);
  h.edit('SEO 상품명','직접 검토한 상품');h.patch({generatedDraft:seed});await h.idle();assert.equal(h.input('SEO 상품명').props.value,'직접 검토한 상품','the same job cannot overwrite a later manual edit');
  await h.click('SEO 설정 저장');assert.equal(h.calls.filter(call=>call.method==='PATCH').length,1);const saved=await responseJson(await api.request());assert.equal(saved.content.seo.title.value,'직접 검토한 상품');assert.equal(saved.content.seo.title.provenance,'manual');assert.equal(saved.options.rows[0].translatedName,'생성한 한국어 옵션');assert.equal(saved.options.rows[2].translatedName,'');assert.equal(saved.options.rows[2].provenance.translatedName,'manual');assert.equal(api.stored().quotation.payload,before.quotation.payload);
 }finally{h.close();api.close();}
});

test('saved manual values and blanks plus already edited draft fields win over a generated seed',async()=>{
 const f=fixture(),{api}=f;f.content.seo.title={value:'',provenance:'manual',updatedAt:api.version};f.content.seo.keywords={value:['직접 태그'],provenance:'manual',updatedAt:api.version};api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(f.content),api.id);
 const h=seoWorkspaceEditor(api,{props:{workspaceOwnerId:'owner'}});try{
  await h.idle();h.edit('SEO 상품 설명','');h.edit('1번째 한국어 옵션명','직접 옵션');const seed=f.seed();assert.equal(seed.values.seo.title,undefined);assert.equal(seed.values.seo.keywords,undefined);h.patch({generatedDraft:seed});await h.idle();assert.equal(h.input('SEO 상품명').props.value,'');assert.equal(h.input('SEO 검색태그').props.value,'직접 태그');assert.equal(h.input('SEO 상품 설명').props.value,'');assert.equal(h.input('1번째 한국어 옵션명').props.value,'직접 옵션');assert.equal(h.calls.filter(call=>call.method==='PATCH').length,0);
 }finally{h.close();api.close();}
});

test('direct regeneration may replace saved reviewed values in the buffer while pending edits and blanks still win',async()=>{
 const f=fixture(),{api}=f;f.content.seo.title={value:'이전 직접 저장 제목',provenance:'manual',updatedAt:api.version};f.content.seo.keywords={value:[],provenance:'manual',updatedAt:api.version};f.options.rows[0].translatedName='이전 직접 저장 옵션';f.options.rows[0].provenance.translatedName='manual';
 api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(f.content),api.id);api.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(f.options),api.id);
 const h=seoWorkspaceEditor(api,{props:{workspaceOwnerId:'owner'}});try{
  await h.idle();h.edit('SEO 검색태그','');const before=api.stored(),batch=f.module.seoRegenerationOptionBatch(f.options,50);assert.ok(batch.attributes.some(pair=>pair.name==='option:'+f.options.rows[0].id));assert.ok(batch.attributes.some(pair=>pair.name==='option:manual-blank'));assert.ok(!batch.attributes.some(pair=>pair.name==='option:second'));assert.equal(f.module.seoRegenerationOptionBatch(f.options,1).remaining,1);
  const seed=f.module.createSeoGeneratedDraft({ownerId:'owner',productVersion:api.version,content:f.content,options:f.options,job:f.job,brand:'와이홉',replaceSaved:true});assert.equal(seed.intent,'explicit-regeneration');h.patch({generatedDraft:seed});await h.idle();assert.equal(h.input('SEO 상품명').props.value,'와이홉 검토할 상품');assert.equal(h.input('1번째 한국어 옵션명').props.value,'생성한 한국어 옵션');assert.equal(h.input('3번째 한국어 옵션명').props.value,'다른 옵션');assert.equal(h.input('SEO 검색태그').props.value,'','the explicit unsaved blank wins');assert.deepEqual(api.stored(),before);assert.equal(h.calls.filter(call=>call.method==='PATCH').length,0);
 }finally{h.close();api.close();}
});

test('owner product clocks and exact option bindings fence late seeds without losing current user edits',async()=>{
 for(const change of [s=>{s.ownerId='other';},s=>{s.productId='other';},s=>{s.productVersion='2026-10-01T00:00:00.000Z';},s=>{s.contentRevision++;},s=>{s.optionRevision++;},s=>{s.source.options[0].originalName='另一原文';}]){
  const f=fixture(),{api}=f,h=seoWorkspaceEditor(api,{props:{workspaceOwnerId:'owner'}});try{
   await h.idle();h.edit('SEO 상품명','작성 중인 상품');const before=api.stored(),seed=f.seed();change(seed);h.patch({generatedDraft:seed});await h.idle();assert.equal(h.input('SEO 상품명').props.value,'작성 중인 상품');assert.equal(h.input('1번째 한국어 옵션명').props.value,'');assert.equal(h.calls.filter(call=>call.method==='PATCH').length,0);assert.deepEqual(api.stored(),before);
  }finally{h.close();api.close();}
 }
});

test('incomplete or wrong-version provider jobs cannot create an editable seed and warning text stays visible',async()=>{
 const f=fixture(),{api}=f;try{
  for(const change of [j=>{j.status='running';},j=>{j.productVersion='2026-10-01T00:00:00.000Z';},j=>{j.contentRevision++;},j=>{j.result.model='other';}]){const job=structuredClone(f.job);change(job);assert.throws(()=>f.module.createSeoGeneratedDraft({ownerId:'owner',productVersion:api.version,content:f.content,options:f.options,job,brand:'와이홉'}),/완료 SEO 초안/);}
  f.job.result.draft.warnings=['일부 원문은 직접 확인해주세요.'];const h=seoWorkspaceEditor(api,{props:{workspaceOwnerId:'owner',generatedDraft:f.seed()}});try{await h.idle();const visible=nodes(h.render()).filter(node=>node.props?.role==='status').map(visibleText).join(' ');assert.match(visible,/일부 원문은 직접 확인/);assert.equal(h.calls.filter(call=>call.method==='PATCH').length,0);}finally{h.close();}
 }finally{api.close();}
});
