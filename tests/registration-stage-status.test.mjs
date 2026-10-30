import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,structuredClone,require:name=>load(name.slice(2)+'.ts')});return exports;}
const status=load('app/registration-stage-status.ts'),{emptyProductContent,applyContentPatch}=load('app/product-content.ts');
const now='2026-10-20T01:00:00.000Z',product={id:'p',owner_id:'owner',updated_at:now};
const base=()=>({productId:'p',productVersion:now,contentRevision:0,revision:1,stages:status.registrationStageIds.map(id=>({id,status:'blocked',attempts:0,updatedAt:now,reason:null,evidence:[],artifacts:[]}))});
const pricing=workflow=>Object.assign(workflow.stages.find(stage=>stage.id==='pricing'),{status:'complete',attempts:1,artifacts:[{id:'calculation',kind:'priceCalculation',data:{calculation:{supplyPrice:4000,salePrice:6000}},submissionReady:false}],evidence:[{kind:'storedProduct',reference:'p@'+now,observedAt:now},{kind:'localCalculation',reference:'calculatePrice',observedAt:now}]});
test('a fresh source, unverified SEO and raw photo counts cannot complete any stage',()=>{
 const content=emptyProductContent('p');content.revision=1;content.updatedAt=now;content.seo.title.value='수집한 상품';
 for(const role of ['main','additional','detail','label'])content.assets[role].value=['owner/raw.png'];
 const final=[{optionId:null,title:'수집한 상품',main:['owner/raw.png'],additional:['owner/raw.png'],detail:['owner/raw.png'],label:['owner/raw.png']}];
 const result=status.registrationStagesFromSavedContent(product,content,null,['owner/raw.png'],final);
 for(const id of status.registrationStageIds)assert.equal(result[id].state,id==='sizeChart'?'unused':'pending');
 assert.equal(status.registrationStageLabel(result.sizeChart.state),'미사용');
});
test('explicit current Korean SEO and exact manual role assignments complete their saved stages without touching inputs',()=>{
 const content=applyContentPatch(emptyProductContent('p'),{seo:{title:'직접 저장한 상품',keywords:['상품']},assets:{main:['owner/main.png'],additional:['owner/add.png'],detail:['owner/detail.png'],size:['owner/size.png'],label:['owner/label.png']}},now);
 content.seoTitleDocument={policy:'couplus-seo-save-v1',sourceTitle:content.seo.title.value,sourceUpdatedAt:now,value:content.seo.title.value};
 const options={productId:'p',rows:[{id:'one',translatedName:'빨강',imageKey:null,provenance:{translatedName:'manual'}}]},keys=['main','add','detail','size','label'].map(name=>'owner/'+name+'.png');
 const final=[{optionId:'one',title:content.seo.title.value,main:[keys[0]],additional:[keys[1]],detail:[keys[2]],label:[keys[4]]}],before=JSON.stringify({content,options,keys,final});
 const result=status.registrationStagesFromSavedContent(product,content,options,keys,final);
 for(const id of ['seo','mainImage','additionalImages','detailImage','sizeChart','koreanLabel'])assert.equal(result[id].state,'complete',id);
 for(const id of ['pricing','quotation'])assert.equal(result[id].state,'pending');
 assert.equal(JSON.stringify({content,options,keys,final}),before);
 options.rows[0].translatedName='红色';assert.equal(status.registrationStagesFromSavedContent(product,content,options,keys,final).seo.state,'pending');
 options.rows[0].translatedName='빨강';final[0].main=[];assert.equal(status.registrationStagesFromSavedContent(product,content,options,keys,final).mainImage.state,'pending');
});
test('fresh executed stages show real completion and isolate every failure or running stage',()=>{
 const workflow=base();pricing(workflow);assert.equal(status.registrationStagesFromWorkflow(product,workflow,true).pricing.state,'complete');
 for(const id of status.registrationStageIds){const work=base(),stage=work.stages.find(stage=>stage.id===id);Object.assign(stage,{status:'failed',attempts:1,reason:{message:'정확한 단계 실패'},updatedAt:now});const result=status.registrationStagesFromWorkflow(product,work,true);assert.equal(result[id].state,'failed',id);assert.equal(result[id].detail,'정확한 단계 실패');assert.equal(Object.values(result).filter(value=>value.state==='failed').length,1);stage.status='running';assert.equal(status.registrationStagesFromWorkflow(product,work,true)[id].state,'running');}
});
test('exact saved final overrides work independently of legacy content, while duplicate and missing references stay incomplete',()=>{
 const row={optionId:'one',title:'상품',main:['owner/main.png'],additional:['owner/a.png','owner/b.png'],detail:[],label:[],manualImages:{main:true,additional:true},manualPrices:{supplyPrice:'4000',salePrice:'6000'}},keys=['owner/main.png','owner/a.png','owner/b.png'];
 const read=()=>status.registrationStagesFromSavedContent(product,null,null,keys,[row]);
 assert.equal(read().mainImage.state,'complete');assert.equal(read().additionalImages.state,'complete');assert.equal(read().pricing.state,'complete');
 row.additional=['owner/a.png','owner/a.png'];assert.equal(read().additionalImages.state,'pending');row.main=['owner/missing.png'];assert.equal(read().mainImage.state,'pending');row.main=['owner/main.png'];row.manualImages.main=false;assert.equal(read().mainImage.state,'pending');
 assert.equal(status.registrationStagesFromSavedContent(product,null,null,keys,[]).mainImage.state,'pending');
});
test('adopted generated or translated SEO documents complete independently of quotation legal-notice defaults',()=>{
 for(const provenance of ['generated','translated']){
  const content=applyContentPatch(emptyProductContent('p'),{seo:{title:'저장한 상품',keywords:['상품']}},now);content.seo.title.provenance=provenance;
  const options={productId:'p',rows:[{id:'one',translatedName:'빨강',provenance:{translatedName:'translated'}}]},read=()=>status.registrationStagesFromSavedContent(product,content,options,[],null);
  assert.equal(read().seo.state,'pending','a generated draft without an adoption document stays pending');
  content.seoTitleDocument={policy:'couplus-seo-save-v1',sourceTitle:content.seo.title.value,sourceUpdatedAt:now,value:content.seo.title.value};
  assert.equal(content.initialLegalNotices,undefined);assert.equal(content.explicitSeoQuotationDefaults,undefined);
  const before=JSON.stringify({content,options});assert.equal(read().seo.state,'complete');assert.equal(content.seo.title.provenance,provenance);assert.equal(JSON.stringify({content,options}),before,'completion reads must preserve provider provenance and saved values');
 }
});
test('saved generated SEO still requires the exact current document and complete Korean final values',()=>{
 const content=applyContentPatch(emptyProductContent('p'),{seo:{title:'저장한 상품',keywords:['상품']}},now);content.seo.title.provenance='generated';
 content.seoTitleDocument={policy:'couplus-seo-save-v1',sourceTitle:content.seo.title.value,sourceUpdatedAt:now,value:content.seo.title.value};
 const options={productId:'p',rows:[{id:'one',translatedName:'빨강',included:true,provenance:{translatedName:'translated'}}]},final=[{optionId:'one',title:'저장한 상품',main:[],additional:[],detail:[],label:[]}];
 const read=(c=content,o=options,f=final)=>status.registrationStagesFromSavedContent(product,c,o,[],f).seo.state;
 assert.equal(read(),'complete');
 for(const change of [
  c=>{delete c.seoTitleDocument;},c=>{c.seoTitleDocument.policy='unknown';},c=>{c.seoTitleDocument.sourceTitle='이전 상품';},c=>{c.seoTitleDocument.value='다른 문서';},
  c=>{c.seoTitleDocument.sourceUpdatedAt='2026-10-19T01:00:00.000Z';},c=>{c.seo.title.value='새 상품';},c=>{c.seo.title.updatedAt='2026-10-19T01:00:00.000Z';},
  c=>{c.seo.title.updatedAt=c.seoTitleDocument.sourceUpdatedAt=null;},c=>{c.seo.title.updatedAt=c.seoTitleDocument.sourceUpdatedAt='2026-10-21T01:00:00.000Z';},
  c=>{c.seo.title.provenance='unverified';},c=>{c.seo.title.value=c.seoTitleDocument.value=c.seoTitleDocument.sourceTitle='商品';},
  c=>{c.seo.title.value=c.seoTitleDocument.value=c.seoTitleDocument.sourceTitle='가'.repeat(101);},c=>{c.seo.keywords.value=['商品'];}
 ]){const changed=structuredClone(content);change(changed);assert.equal(read(changed),'pending');}
 for(const change of [o=>{o.productId='other';},o=>{o.rows[0].translatedName='红色';},o=>{o.rows[0].provenance.translatedName='unverified';},o=>{o.rows.push({id:'excluded',included:false,translatedName:'蓝色',provenance:{translatedName:'translated'}});}]){
  const changed=structuredClone(options);change(changed);assert.equal(read(content,changed),'pending');
 }
 assert.equal(read(content,options,[{...final[0],title:'原文商品'}]),'pending');
});
test('stale versions, missing execution evidence and draft artifacts never become green',()=>{
 const workflow=base();pricing(workflow);
 assert.equal(status.registrationStagesFromWorkflow(product,workflow,false).pricing.state,'pending');
 assert.equal(status.registrationStagesFromWorkflow({...product,updated_at:'2026-10-21T00:00:00Z'},workflow,true).pricing.state,'pending');
 workflow.stages.find(stage=>stage.id==='pricing').artifacts[0].data.reviewRequired=true;assert.equal(status.registrationStagesFromWorkflow(product,workflow,true).pricing.state,'pending');
 const stage=workflow.stages.find(stage=>stage.id==='mainImage');Object.assign(stage,{status:'complete',attempts:1,artifacts:[{id:'raw',kind:'image',storageKey:'owner/raw.png',data:{reviewRequired:true}}],evidence:[{kind:'storedAssetReference',reference:'owner/raw.png',observedAt:now}]});assert.equal(status.registrationStagesFromWorkflow(product,workflow,true).mainImage.state,'pending');
});
test('actual saved pricing workflow projects through owner-scoped listing and stale input returns to pending without mutations',async()=>{
 const {mobileIntakeHarness}=await import('./helpers/mobile-intake.mjs'),h=mobileIntakeHarness();
 try{
  await h.intake();const current=h.sqlite.prepare('SELECT * FROM products').get(),response=await h.route('/api/products/'+current.id+'/automation',{method:'POST',body:{action:'run',stages:['pricing'],expectedVersion:current.updated_at,idempotencyKey:'registration-badge-test'}});
  assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).workflow.stages.find(stage=>stage.id==='pricing').status,'complete');
  const read=async()=>h.load('db/product-content.ts').readRegistrationSummaries('owner',[await h.load('db/queries.ts').findProduct('owner',current.id)]);
  const before=h.sqlite.prepare('SELECT * FROM products').get();let summary=(await read())[current.id];assert.equal(summary.stages.pricing.state,'complete');assert.deepEqual(h.sqlite.prepare('SELECT * FROM products').get(),before);
  h.sqlite.prepare('UPDATE products SET title=? WHERE id=?').run('입력 내용 변경',current.id);summary=(await read())[current.id];assert.equal(summary.stages.pricing.state,'pending');
  assert.equal(Object.keys(await h.load('db/registration-stage-status.ts').readRegistrationExecutionStages('different-owner',[before])).length,0);
 }finally{h.close();}
});
