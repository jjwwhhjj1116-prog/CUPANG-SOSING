import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parse5 from 'parse5';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {fixture as rawWorkspaceFixture,runtime as rawWorkspaceRuntime} from './helpers/detail-workspace.mjs';
import {reviewFixture} from './helpers/selected-image-review.mjs';

const stageIds=['seo','pricing','mainImage','additionalImages','detailImage','sizeChart','koreanLabel','quotation'];
const version='2026-10-23T00:00:00.000Z',hash='a'.repeat(64),plain=value=>JSON.parse(JSON.stringify(value));
const quotationModel='@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const quotationConfiguration={configured:true,provider:'Cloudflare Workers AI',model:quotationModel,executionPolicy:null,freeOnly:true,notice:'검토 후 저장'};
function fixture(){
 const quotationModel='@cf/meta/llama-3.3-70b-instruct-fp8-fast';
 const quotationConfiguration={configured:true,provider:'Cloudflare Workers AI',model:quotationModel,executionPolicy:null,freeOnly:true,notice:'검토 후 저장'};
 const calls=[],events=[],keys=new Map(),controller=new AbortController();let owner='owner',company={code:'A01526306',name:'유앤채'},onFetch=null;
 let imageResult={status:'completed',messages:['번역 초안 저장']},labelResult={status:'draft',message:'표시사항 초안 저장',uncertain:false};
 const exports={},deps={
  '@/app/automation/model':{automationStages:stageIds},
  '@/app/supplier-hub-company':{supplierHubCompany:(code,name)=>['A01526306','A01464742'].includes(code)?{code,name}:null},
  '@/app/collected-translation-attributes':{},'@/app/option-translation':{},'@/app/sourcing':{},'@/app/seo-workspace-draft':{parseSeoGenerationConfiguration:raw=>raw?.freeOnly===true&&raw.destination==='Cloudflare Workers AI'?plain(raw):null},
  '@/app/automation/translation':{GOOGLE_TEXT_MODEL:'google',WORKERS_QWEN_MODEL:'@cf/qwen/qwen3-30b-a3b-fp8'},
  '@/app/quotation-ai-client':{quotationAiViewCurrent:()=>true,quotationAiJobForScope:()=>null,quotationReviewedProposalChanges:()=>[],quotationSavedSourceChanges:()=>[]},
  '@/app/quotation-fields-confirmation':{},
  '@/app/quotation-text-execution':providedOptionModule('app/quotation-text-execution.ts'),
  '@/app/quotation-choice-state':providedOptionModule('app/quotation-choice-state.ts'),
  '@/app/batch-selected-packaging-work':{async runSelectedPackagingWork(id,options){await options.assertCurrent();calls.push({adapter:'packaging',id,revision:options.view.revision,fingerprint:options.view.inputFingerprint});return {view:options.view,status:'unchanged',changed:0,estimated:0,fallback:0,remaining:0,recovered:false,message:'저장한 포장값을 유지했습니다.'};}},
  '@/app/registration-layout':{readRegistrationLayout:(raw,id,clock)=>{assert.equal(raw.productId,id);assert.equal(raw.productVersion,clock);return raw;}},
  '@/app/batch-selected-image-work':{createSelectedImageStageState:(ownerId,productId,stage)=>({ownerId,productId,stage,batches:{}}),async processSelectedImageStage(id,stage,options){calls.push({adapter:'image',id,stage,version:options.expectedProductVersion});return imageResult;}},
  '@/app/batch-selected-detail-work':{createSelectedDetailWorkState:(ownerId,productId)=>({ownerId,productId,photos:{}}),async processSelectedDetailWork(id,options){assert.equal(options.state.productId,id);calls.push({adapter:'image',id,stage:'detail',source:'workspace-body',version:options.expectedProductVersion});return imageResult;}},
  '@/app/batch-selected-pricing-work':{async runSelectedPricingWork(id,options){await options.assertCurrent();const response=await options.fetcher('/api/products/'+id+'/stage-two-pricing');await options.assertCurrent();return await response.json();}},
  '@/app/batch-selected-label-work':{async runSelectedLabelWork(id,options){await options.assertCurrent();calls.push({adapter:'label',id});return labelResult;}},
 };
 const boardFeedback={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/batch-board-feedback.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:boardFeedback,Date,Object,JSON});deps['@/app/batch-board-feedback']=boardFeedback;
 const code=ts.transpileModule(fs.readFileSync(new URL('../app/batch-selected-work.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,Error,Date,AbortSignal,Map,Set,JSON,require:name=>{assert.ok(deps[name],name);return deps[name];}},{filename:'batch-selected-work.ts'});
 const options={stages:['pricing'],expectedOwnerId:'owner',signal:controller.signal,keys,newKey:()=> '11111111-1111-4111-8111-111111111111',onStage:row=>events.push(plain(row)),
  fetcher:async(url,init={})=>{
   const call={url,method:init.method??'GET',body:init.body?JSON.parse(init.body):undefined};calls.push(call);
   const custom=await onFetch?.(call,init);if(custom)return custom;
   if(url==='/api/supplier-hub/catalog-context')return Response.json({ownerId:owner,company});
   assert.ok(url.startsWith('/api/products/product'),url);
   if(url.endsWith('/work-draft'))return Response.json({productId:'product',productVersion:version});
   if(url.endsWith('/stage-two-pricing'))return Response.json({status:'draft',message:'가격 초안 계산',uncertain:false});
   if(url.endsWith('/automation'))return Response.json({workflow:{productId:'product',productVersion:version,stages:[{id:'pricing',status:'complete'}]}});
   if(url.endsWith('/content'))return Response.json({content:{productId:'product',schemaVersion:1,revision:3,label:{},assets:{size:{value:[]}}}});
   if(url.endsWith('/registration-layout'))return Response.json({productId:'product',productVersion:version,sizeChartRequired:false});
   if(url.endsWith('/quotation-fields'))return Response.json({revision:1,inputFingerprint:hash,productVersion:version,contentRevision:3,optionRevision:1,overrides:{common:{},options:{}},categoryContext:{profileId:null,categoryId:'68183',categoryPath:['합성']},resolved:{rows:[{optionId:'a',included:true,fields:{}}],schema:{fields:[],status:'observed',categoryId:'68183',categoryPath:['합성']}}});
   if(url.endsWith('/quotation-ai')){
    if(call.method==='POST')return Response.json({job:{id:'99999999-9999-4999-8999-999999999999',status:'completed',fingerprint:hash,quotationRevision:1,profileId:null,scope:{optionId:null,applyToAllOptions:true},model:quotationModel,result:{changes:[]}}});
    return Response.json({configuration:quotationConfiguration,fingerprint:hash,productId:'product',productVersion:version,contentRevision:3,optionRevision:1,quotationRevision:1,profileId:null,jobs:[]});
   }
   return Response.json({product:{id:'product',title:'검증 상품',updated_at:version}});
  }};
 return{calls,events,keys,options,controller,deps,run:stages=>exports.runSelectedBatchProduct('product',{...options,stages}),
  owner:value=>owner=value,company:value=>company=value,intercept:value=>onFetch=value,prependIntercept:value=>{const previous=onFetch;onFetch=async(...args)=>await value(...args)??await previous?.(...args);},image:value=>imageResult=value,label:value=>labelResult=value};
}

// Reuse the isolated actual raw BODY coordinator fixture without loading its tests.
test('completed image review metadata reaches stage review but never bypasses an unknown inference',async()=>{
 for(const pending of [false,true]){const h=fixture(),review=reviewFixture().review;h.image({status:'partial',messages:['배경 검토'],review,...(pending?{inferencePending:true}:{})});h.options.stages=['additionalImages'];
 const result=await h.run(['additionalImages']);assert.equal(result.stages[0].status,'blocked');if(!pending)assert.ok(result.stages[0].review,JSON.stringify(result));assert.deepEqual(result.stages[0].review?plain(result.stages[0].review):undefined,pending?undefined:plain(review));}
});
test('confirmed image failure targets reach stage review only outside inference and save recovery fences',async()=>{
 for(const guard of ['none','inference','uncertain','recovery','changed']){const h=fixture(),r=reviewFixture(),reviewTarget={ownerId:r.scope.ownerId,company:r.scope.company,source:r.image.source};
 h.image({status:guard==='uncertain'?'uncertain':'partial',messages:['판독 실패'],reviewTarget,...(guard==='inference'?{inferencePending:true}:guard==='recovery'?{recoveryBatch:{}}:guard==='changed'?{sourceChanged:true}:{})});
 const result=await h.run(['mainImage']);assert.deepEqual(result.stages[0].reviewTarget?plain(result.stages[0].reviewTarget):undefined,guard==='none'?plain(reviewTarget):undefined,guard);
 }
});
// OCR/provider/render/upload effects remain local dependency fakes.
async function actualDetailFixture(){
 const sourceUrl=new URL('./batch-selected-detail-work.test.mjs',import.meta.url),source=fs.readFileSync(sourceUrl,'utf8'),ast=ts.createSourceFile(sourceUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const declaration=ast.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==='setup').getText(ast).replaceAll('import.meta.url',JSON.stringify(sourceUrl.href));
 const setup=vm.runInNewContext(declaration+'\nsetup',{assert,fs,vm,ts,fixture:rawWorkspaceFixture,runtime:rawWorkspaceRuntime,plain,crypto,Error,Date,URL,URLSearchParams,TextEncoder,AbortController,AbortSignal,setTimeout,clearTimeout,structuredClone,Blob,Response,Uint8ClampedArray});
 return setup();
}

function actualSelectedImageFixture(stage='additional'){
 const url=new URL('./batch-selected-image-work.test.mjs',import.meta.url),source=fs.readFileSync(url,'utf8'),ast=ts.createSourceFile(url.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const declarations=ast.statements.filter(statement=>ts.isFunctionDeclaration(statement)&&['loadModel','fixture'].includes(statement.name?.text)).map(statement=>statement.getText(ast)).join('\n').replaceAll('import.meta.url',JSON.stringify(url.href));
 return vm.runInNewContext(declarations+'\nfixture',{assert,fs,vm,ts,parse5,plain,Error,Date,URL,TextEncoder,AbortController,AbortSignal,structuredClone,Blob,Response,Uint8ClampedArray})(stage);
}

for(const mode of [undefined,'full','selected'])test(`coordinator ${mode??'default'} mode reworks current manual photos only for selected work`,async()=>{
 const h=fixture(),images=actualSelectedImageFixture(),field='additionalImages';h.company({code:'A01464742',name:'와이홉'});h.options.mode=mode;
 images.view.overrides.options.option={[field]:'owner/source-b.png\nowner/source-a.png'};images.view.resolved.rows[0].fields[field].value='owner/source-b.png\nowner/source-a.png';images.view.resolved.rows[0].fields[field].source='manual-option';
 Object.assign(h.deps['@/app/batch-selected-image-work'],images.model,{processSelectedImageStage:(id,stage,options)=>images.model.processSelectedImageStage(id,stage,{...images.options,...options,fetcher:images.options.fetcher},images.deps)});
 h.intercept(call=>{
  if(call.url==='/api/products/product')return Response.json({product:{id:'product',title:'검증 상품',updated_at:images.view.productVersion}});
  if(call.url.endsWith('/work-draft'))return Response.json({productId:'product',productVersion:images.view.productVersion});
  if(call.url.endsWith('/content'))return Response.json({content:images.content});
  if(call.url.includes('/quotation-fields'))return Response.json(images.view);return null;
 });
 const result=await h.run(['additionalImages']),selected=mode==='selected';assert.equal(result.stages[0].status,selected?'draft':'skipped',JSON.stringify(result));
 assert.deepEqual(plain(images.calls.filter(row=>row[0]==='read').map(row=>row[1])),selected?['owner/source-b.png','owner/source-a.png']:[]);assert.deepEqual(plain(images.calls.filter(row=>row[0]==='apply').map(row=>row[1])),selected?[0,1]:[]);
});

for(const external of [null,'before-stage','inside-helper','after-ack'])test(`a confirmed sibling label save ${external??'alone'} ${external?'cannot adopt an outside edit':'lets the partial image resume only its remaining slot'}`,async()=>{
 const h=fixture(),images=actualSelectedImageFixture(),recognize=images.deps.recognize;h.company({code:'A01464742',name:'와이홉'});
 Object.assign(h.deps['@/app/batch-selected-image-work'],images.model,{processSelectedImageStage:(id,stage,options)=>images.model.processSelectedImageStage(id,stage,{...images.options,...options,fetcher:images.options.fetcher},images.deps)});
 images.deps.recognize=async image=>{if(image.source.sourceKey.endsWith('b.png'))throw Error('confirmed OCR failure');return recognize(image);};
 h.intercept(call=>{
  if(call.url==='/api/products/product')return Response.json({product:{id:'product',title:'검증 상품',updated_at:images.view.productVersion}});
  if(call.url.endsWith('/work-draft'))return Response.json({productId:'product',productVersion:images.view.productVersion});
  if(call.url.endsWith('/content'))return Response.json({content:images.content});
  if(call.url.includes('/quotation-fields')){
   if(call.method==='PUT'){
    assert.equal(call.body.expectedRevision,images.view.revision);images.view.revision++;images.view.productVersion=new Date(Date.parse(images.view.productVersion)+1).toISOString();images.view.updatedAt=images.view.productVersion;
    images.view.resolved.rows[0].fields.brand={value:'정상 후속 저장',source:'manual-option',issues:[],needsReview:false};
   }
   return Response.json(images.view);
  }
  return null;
 });
 let labelCalls=0;h.deps['@/app/batch-selected-label-work'].runSelectedLabelWork=async(id,options)=>{
  labelCalls++;
  if(external==='inside-helper'){images.view.revision++;images.view.productVersion=new Date(Date.parse(images.view.productVersion)+1).toISOString();images.view.resolved.rows[0].fields.external={value:'outside edit'};}
  await options.fetcher('/api/products/'+id+'/quotation-fields');
  await options.fetcher('/api/products/'+id+'/quotation-fields',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:images.view.revision,changes:[{fieldKey:'brand',optionId:'option',value:'정상 후속 저장'}]})});
  if(external==='after-ack'){images.view.revision++;images.view.productVersion=new Date(Date.parse(images.view.productVersion)+1).toISOString();images.view.resolved.rows[0].fields.external={value:'outside edit'};await options.fetcher('/api/products/'+id+'/quotation-fields');}
  return{status:'draft',message:'확인한 표시 저장',uncertain:false};
 };
 assert.equal((await h.run(['additionalImages'])).stages[0].status,'blocked');assert.equal(images.calls.filter(row=>row[0]==='apply').length,1);
 if(external==='before-stage'){images.view.revision++;images.view.resolved.rows[0].fields.external={value:'outside edit'};}
 assert.equal((await h.run(['koreanLabel'])).stages[0].status,'draft');assert.equal(labelCalls,1);
 images.deps.recognize=recognize;const resumed=await h.run(['additionalImages']);
 assert.equal(resumed.stages[0].status,external?'failed':'draft',JSON.stringify(resumed));
 assert.equal(images.calls.filter(row=>row[0]==='apply').length,external?1:2);assert.equal(labelCalls,1);
});

test('a full action retains settled raw BODY work across its acknowledged later label save',async()=>{
 const h=fixture(),detail=await actualDetailFixture(),recognize=detail.deps.recognize;detail.f.view.productVersion=version;h.company(detail.f.company);
 Object.assign(h.deps['@/app/batch-selected-detail-work'],detail.model,{processSelectedDetailWork:(id,options)=>detail.model.processSelectedDetailWork(id,{...detail.options,...options},detail.deps)});
 detail.deps.recognize=async(image,...args)=>{if(image.source.sourceKey==='owner/two.png')throw Error('confirmed BODY OCR failure');return recognize(image,...args);};
 h.intercept(async(call,init)=>{
  if(call.url==='/api/products/product')return Response.json({product:{id:'product',title:'검증 상품',updated_at:detail.f.view.productVersion}});
  if(call.url.endsWith('/work-draft'))return Response.json({productId:'product',productVersion:detail.f.view.productVersion});
  if(call.url.includes('/quotation-fields')&&call.method==='PUT'){
   detail.f.view.revision++;detail.f.view.productVersion=new Date(Date.parse(detail.f.view.productVersion)+1).toISOString();detail.f.view.inputFingerprint='9'.repeat(64);
   detail.f.view.resolved.rows[0].fields.brand={value:'정상 표시 저장',source:'manual-option',issues:[]};return Response.json(detail.f.view);
  }
  if(call.url.startsWith('/api/products/product/')||call.url==='/api/settings')return detail.options.fetcher(call.url,init);
  return null;
 });
 let labels=0;h.deps['@/app/batch-selected-label-work'].runSelectedLabelWork=async(id,options)=>{labels++;
  await options.fetcher('/api/products/'+id+'/quotation-fields',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:detail.f.view.revision,changes:[]})});
  return{status:'draft',message:'정상 표시 저장 확인',uncertain:false};
 };
 const initial=await h.run(['detailImage','koreanLabel']);assert.deepEqual(initial.stages.map(stage=>stage.status),['blocked','draft']);assert.equal(detail.calls.filter(row=>row.operation==='image-apply').length,1);assert.equal(labels,1);
 detail.deps.recognize=recognize;const resumed=await h.run(['detailImage']);assert.equal(resumed.stages[0].status,'draft',JSON.stringify(resumed));assert.equal(detail.calls.filter(row=>row.operation==='image-apply').length,2);assert.equal(labels,1);
});
test('price-only run checks calculated option prices without unrelated writes',async()=>{
 const h=fixture(),result=await h.run(['pricing']);assert.equal(result.stages[0].status,'draft');
 const writes=h.calls.filter(call=>call.method==='POST');assert.equal(writes.length,0);assert.equal(h.calls.filter(call=>call.url?.endsWith('/stage-two-pricing')).length,1);
 assert.equal(h.calls.some(call=>call.adapter||call.url?.endsWith('/work-draft')),false);
 assert.deepEqual(h.events.map(row=>row.status),['running','draft']);
});

test('quotation packaging batches publish progress through the existing Stage7 activity without another AI job',async()=>{
 const h=fixture(),packaging=h.deps['@/app/batch-selected-packaging-work'].runSelectedPackagingWork;
 h.deps['@/app/batch-selected-packaging-work'].runSelectedPackagingWork=async(id,options)=>{
  await options.assertCurrent();options.onProgress?.('포장정보 초안 1/2 묶음 처리 중…');options.onProgress?.('포장정보 초안 2/2 묶음 저장 확인');
  return packaging(id,options);
 };
 const result=await h.run(['quotation']);assert.equal(result.stages[0].status,'draft');
 assert.deepEqual(h.events.filter(row=>row.id==='quotation'&&row.status==='running'&&row.message.startsWith('포장정보 초안')).map(row=>row.message),
  ['포장정보 초안 1/2 묶음 처리 중…','포장정보 초안 2/2 묶음 저장 확인']);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,1);
});

test('an uncertain Vision inference stops later image calls while independent labels and quotation still run',async()=>{
 const h=fixture();h.image({status:'partial',inferencePending:true,messages:['원래 Vision 요청 결과 미확정']});
 const result=await h.run(['mainImage','additionalImages','detailImage','koreanLabel','quotation']);
 assert.deepEqual(h.calls.filter(call=>call.adapter==='image').map(call=>call.stage),['main']);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/work-draft')).length,1);
 assert.equal(h.calls.some(call=>call.adapter==='label'),true);assert.equal(h.calls.some(call=>call.adapter==='packaging'),true);
 assert.deepEqual(result.stages.slice(0,3).map(row=>row.status),['blocked','blocked','blocked']);
 assert.match(result.stages[1].message,/독립된 단계는 계속/);
 const before=h.calls.filter(call=>call.adapter==='image').length;
 await h.run(['additionalImages']);assert.equal(h.calls.filter(call=>call.adapter==='image').length,before,'same queue cannot bypass its pending inference through another image role');
});

for(const sourceChanged of[false,true])test(`display metadata across own later label save (${sourceChanged?'changed source discarded':'same source kept'}) is never a completion receipt`,async()=>{
 const h=fixture();let currentVersion=version,imageKeys='["owner/source.png"]';const later='2026-10-30T01:00:00.000Z';
 h.intercept(call=>call.url==='/api/products/product'?Response.json({product:{id:'product',owner_id:'owner',title:'原文',source_url:'https://source.test/product',image_keys:imageKeys,updated_at:currentVersion}}):null);
 h.image({status:'partial',inferencePending:true,messages:['原래 추론 응답 미확정']});
 h.deps['@/app/batch-selected-label-work'].runSelectedLabelWork=async()=>{currentVersion=later;if(sourceChanged)imageKeys='["owner/source.png","owner/new-label.png"]';return{status:'draft',message:'own label save',uncertain:false};};
 const result=await h.run(['mainImage','koreanLabel']);assert.equal(result.stages[0].status,'blocked');assert.equal(result.stages[1].status,'draft');
 if(sourceChanged)assert.equal(result.stages[0].boardSource,undefined);
 else{assert.equal(result.stages[0].boardSource.productVersion,later);assert.match(result.stages[0].boardSource.sourceFingerprint,/owner\/source\.png/);}
 assert.equal(h.calls.filter(call=>call.adapter==='image').length,1);assert.equal(h.calls.some(call=>call.url?.endsWith('/automation')),false);
});

test('an option source change inside the same product image pool cannot rebind a previous failure to the later version',async()=>{
 const h=fixture(),later='2026-10-30T01:00:00.000Z';let currentVersion=version;
 h.intercept(call=>call.url==='/api/products/product'?Response.json({product:{id:'product',owner_id:'owner',title:'原文',source_url:'https://source.test/product',image_keys:'["owner/source-a.png","owner/source-b.png"]',updated_at:currentVersion}}):null);
 h.deps['@/app/batch-selected-image-work'].processSelectedImageStage=async()=>{currentVersion=later;return{status:'partial',sourceChanged:true,messages:['선택 옵션의 대표 이미지가 변경되었습니다.']};};
 const result=await h.run(['mainImage','koreanLabel']);assert.equal(result.stages[0].status,'blocked');assert.equal(result.stages[0].boardSource,undefined);assert.equal(result.stages[1].boardSource,undefined);assert.equal(h.calls.some(call=>call.adapter==='label'),false);
});

const savedSummary=(completed=[])=>({seo:completed.includes('seo'),seoTitle:null,mainImageKey:null,main:0,additional:0,detail:0,label:0,missingImages:false,
 stages:Object.fromEntries(stageIds.map(id=>[id,{state:completed.includes(id)?'complete':'pending',detail:'서버에서 확인한 현재 저장값'}]))});

test('full work skips server-confirmed board completion; explicit partial work and pending stages still enter it',async()=>{
 for(const mode of ['full','selected'])for(const complete of [false,true]){const h=fixture();h.options.mode=mode;
  h.intercept(call=>call.url==='/api/products/product'?Response.json({product:{id:'product',owner_id:'owner',title:'검수 상품',updated_at:version,content_summary:savedSummary(complete?['pricing']:[])}}):null);
  const result=await h.run(['pricing']),skip=mode==='full'&&complete;
  assert.equal(result.stages[0].status,skip?'skipped':'draft');assert.equal(h.calls.some(call=>call.url?.endsWith('/stage-two-pricing')),!skip);
  assert.equal(h.calls.some(call=>call.method==='POST'||call.url?.endsWith('/automation')),false);
 }
});

test('full work resolves a retained pricing save before relying on the current complete badge',async()=>{
 const h=fixture();h.options.mode='full';h.keys.set('owner:product:pricing-save-v1','retained-original-price-attempt');
 h.intercept(call=>call.url==='/api/products/product'?Response.json({product:{id:'product',owner_id:'owner',title:'검수 상품',updated_at:version,content_summary:savedSummary(['pricing'])}}):null);
 h.deps['@/app/batch-selected-pricing-work'].runSelectedPricingWork=async(_id,options)=>{assert.equal(options.keys,h.keys);assert.equal(options.expectedOwnerId,'owner');return{status:'blocked',message:'원래 가격 요청 저장본 확인 필요',uncertain:true};};
 const result=await h.run(['pricing','mainImage']);assert.equal(result.stages[0].status,'blocked');assert.match(result.stages[0].message,/원래 가격 요청/);assert.equal(h.calls.some(call=>call.adapter==='image'),false);
});

test('full work does not reuse another product or owner or invalid source version as completion proof',async()=>{
 for(const wrong of ['product','owner','version']){const h=fixture();h.options.mode='full';
  h.intercept(call=>call.url==='/api/products/product'?Response.json({product:{id:wrong==='product'?'other':'product',owner_id:wrong==='owner'?'other':'owner',updated_at:wrong==='version'?'invalid':version,content_summary:savedSummary(['pricing'])}}):null);
  const result=await h.run(['pricing']);assert.equal(result.stages[0].status,'failed');
  assert.equal(h.calls.some(call=>call.url?.endsWith('/stage-two-pricing')||call.method==='POST'),false);
 }
});

test('full mode preserves current saved SEO and images while ignoring weaker legacy automation completion',async()=>{
 const h=fixture();h.options.mode='full';h.intercept(call=>call.url==='/api/products/product'?Response.json({product:{id:'product',owner_id:'owner',updated_at:version,content_summary:savedSummary(['seo','mainImage','additionalImages','detailImage','koreanLabel'])}}):null);
 const result=await h.run(['seo','mainImage','additionalImages','detailImage','koreanLabel']);assert.ok(result.stages.every(row=>row.status==='skipped'));
 assert.equal(h.calls.some(call=>call.adapter||call.method==='POST'||call.url?.endsWith('/automation')),false);
 for(const summary of [undefined,null,{seo:true}]){
  const f=fixture();f.options.mode='full';f.intercept(call=>call.url==='/api/products/product'?Response.json({product:{id:'product',owner_id:'owner',updated_at:version,...(summary===undefined?{}:{content_summary:summary})}}):null);
  assert.equal((await f.run(['pricing'])).stages[0].status,'draft');assert.equal(f.calls.some(call=>call.url?.endsWith('/automation')),false);
 }
});

test('malformed board completion cannot skip or automatically replace a saved stage',async()=>{
 for(const mutate of [summary=>{summary.stages.pricing.state=true;},summary=>{summary.stages.pricing.detail='';},summary=>{delete summary.stages.seo;},summary=>{summary.stages.extra={state:'complete',detail:'외부'};},summary=>{summary.missingImages='false';},summary=>{summary.main=-1;},summary=>{summary.seo='true';}]){
  const h=fixture(),summary=savedSummary(['pricing']);mutate(summary);h.options.mode='full';h.intercept(call=>call.url==='/api/products/product'?Response.json({product:{id:'product',owner_id:'owner',updated_at:version,content_summary:summary}}):null);
  const result=await h.run(['pricing','mainImage']);assert.equal(result.stages[0].status,'failed');assert.equal(result.stages[1].status,'blocked');assert.equal(h.calls.some(call=>call.adapter||call.method==='POST'||call.url?.endsWith('/stage-two-pricing')),false);
 }
});

test('HTML account and product responses identify the endpoint without exposing body or retrying',async()=>{
 const h=fixture();h.intercept(call=>call.url==='/api/supplier-hub/catalog-context'?new Response('<!DOCTYPE html>private-login',{status:503,headers:{'content-type':'text/html'}}):null);
 await assert.rejects(h.run(['pricing']),error=>/계정·회사.*HTTP 503.*text\/html/.test(error.message)&&!error.message.includes('private-login'));
 assert.equal(h.calls.length,1);
 const p=fixture();p.intercept(call=>call.url==='/api/products/product'?new Response('<!DOCTYPE html>private-error',{status:500,headers:{'content-type':'text/html'}}):null);
 const result=await p.run(['mainImage']);assert.match(result.stages[0].message,/상품 \/ 조회.*HTTP 500/);
 assert.equal(p.calls.some(call=>call.method==='POST'),false);
 assert.doesNotMatch(result.stages[0].message,/private-error|Unexpected token/);
});
test('partial image stages prepare only their selected role and bind the prepared version',async()=>{
 for(const [stage,role] of [['mainImage','main'],['additionalImages','additional'],['detailImage','detail']]){
  const h=fixture(),result=await h.run([stage]);assert.equal(result.stages[0].status,'draft');
  assert.deepEqual(h.calls.find(call=>call.url?.endsWith('/work-draft')).body.roles,[role]);
  assert.deepEqual(h.calls.find(call=>call.adapter==='image'),{adapter:'image',id:'product',stage:role,version,...(role==='detail'?{source:'workspace-body'}:{})});
  assert.equal(h.calls.some(call=>call.url?.endsWith('/automation')),false);
 }
});
test('execution follows canonical stage order, never dropdown click order and never submits',async()=>{
 const h=fixture(),result=await h.run(['quotation','koreanLabel','detailImage','pricing']);
 assert.deepEqual(plain(result.stages.map(row=>row.id)),['pricing','detailImage','koreanLabel','quotation']);
 assert.equal(h.calls.some(call=>/supplier-hub.*receipt|single-package|submission/.test(call.url??'')),false);
 assert.equal(result.stages.at(-1).status,'draft');
});

test('confirmed partial main, additional and detail image stages stay blocked while one action continues to label and quotation',async()=>{
 const h=fixture();h.image({status:'partial',messages:['확인된 일부 번역 초안 · 나머지 문구 확인 필요']});const result=await h.run(['quotation','detailImage','koreanLabel','additionalImages','mainImage']);
 assert.deepEqual(plain(result.stages.map(row=>[row.id,row.status])),[['mainImage','blocked'],['additionalImages','blocked'],['detailImage','blocked'],['koreanLabel','draft'],['quotation','draft']]);
 assert.deepEqual(h.calls.filter(call=>call.adapter==='image').map(call=>call.stage),['main','additional','detail']);assert.equal(h.calls.filter(call=>call.adapter==='label').length,1);assert.equal(h.calls.filter(call=>call.adapter==='packaging').length,1);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,1);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
});

test('pending detail workspace reconciliation holds later label and quotation writes at the acknowledged image version',async()=>{
 for(const pending of [false,true]){
  const h=fixture(),acknowledged='2026-10-23T00:00:01.000Z';let currentVersion=version,state;
  h.intercept(call=>call.url==='/api/products/product'?Response.json({product:{id:'product',title:'검증 상품',updated_at:currentVersion}}):null);
  h.deps['@/app/batch-selected-detail-work'].processSelectedDetailWork=async(productId,options)=>{
   currentVersion=acknowledged;state=options.state;
   // The quotation image save was acknowledged, but its metadata read failed
   // before the exact workspace reconciliation could finish.
   if(pending)state.seed={input:{selection:{productId,optionId:'a',view:{productVersion:acknowledged}}},attempt:{pending:true}};
   return{status:'partial',messages:['저장한 상세 번역의 편집 기록 조회 필요'],productVersion:acknowledged,state};
  };
  const result=await h.run(['detailImage','koreanLabel','quotation']);
  assert.equal(result.stages[0].status,'blocked');
  assert.deepEqual(result.stages.slice(1).map(stage=>stage.status),pending?['blocked','blocked']:['draft','draft']);
  assert.equal(h.calls.some(call=>call.adapter==='label'),!pending);
  assert.equal(h.calls.some(call=>call.adapter==='packaging'||call.url?.endsWith('/quotation-ai')),!pending);
  if(pending){assert.ok(result.stages.slice(1).every(stage=>stage.message.includes('아직 시작하지 않았습니다')));assert.equal(state.seed.input.selection.view.productVersion,acknowledged);}
 }
});

test('confirmed image failure reasons do not leave stale pending fences or hold later selected stages',async()=>{
 for(const message of ['OCR 실패','번역 응답 없음','새 번역 이미지를 저장할 공간이 없습니다.','처리할 저장 이미지 연결이 없습니다.']){const h=fixture();h.image({status:'partial',messages:[message]});
  const result=await h.run(['detailImage','koreanLabel','quotation']);assert.equal(result.stages[0].status,'blocked');assert.match(result.stages[0].message,new RegExp(message.replace(/[.]/g,'\\.')));assert.equal(result.stages[1].status,'draft');assert.equal(result.stages[2].status,'draft');assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
 }
});

test('known label blocks and failures clear their confirmed once fence and continue to quotation',async()=>{
 for(const status of ['blocked','failed']){const h=fixture();h.label({status,message:'미실행 또는 확인된 오류 · 수동 입력 유지',uncertain:false});const result=await h.run(['koreanLabel','quotation']);
  assert.equal(result.stages[0].status,status);assert.equal(result.stages[1].status,'draft');assert.equal(h.calls.filter(call=>call.adapter==='label').length,1);assert.equal(h.calls.filter(call=>call.adapter==='packaging').length,1);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
 }
});

test('typed source changes, saved product version changes and account/company changes hold every later stage',async()=>{
 for(const change of ['typed-source','product-version','owner','company']){const h=fixture();let changed=false;const image=h.deps['@/app/batch-selected-image-work'].processSelectedImageStage;
  h.image({status:'partial',messages:['확인 필요'],...(change==='typed-source'?{sourceChanged:true}:{})});
  h.deps['@/app/batch-selected-image-work'].processSelectedImageStage=async(...args)=>{const result=await image(...args);changed=true;if(change==='owner')h.owner('other');if(change==='company')h.company({code:'A01464742',name:'와이홉'});return result;};
  h.intercept(call=>change==='product-version'&&changed&&call.url==='/api/products/product'?Response.json({product:{id:'product',updated_at:'2026-10-23T00:00:02.000Z'}}):null);
  const result=await h.run(['mainImage','additionalImages','detailImage','koreanLabel','quotation']);assert.ok(['blocked','failed'].includes(result.stages[0].status));assert.ok(result.stages.slice(1).every(row=>row.status==='blocked'&&row.message.includes('아직 시작하지 않았습니다')));
  assert.equal(h.calls.filter(call=>call.adapter==='image').length,1,change);assert.equal(h.calls.some(call=>call.adapter==='label'||call.adapter==='packaging'||call.url?.endsWith('/quotation-ai')),false,change);
 }
});

test('recovering an image save remains read-only and cannot implicitly start later work',async()=>{
 const h=fixture();h.image({status:'partial',recovered:true,messages:['이전 이미지 저장 상태만 확인했습니다.']});const result=await h.run(['detailImage','koreanLabel','quotation']);assert.equal(result.stages[0].status,'blocked');assert.ok(result.stages.slice(1).every(row=>row.message.includes('아직 시작하지 않았습니다')));assert.equal(h.calls.some(call=>call.adapter==='label'||call.url?.endsWith('/quotation-ai')),false);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
});
test('unknown image save stops later stages and retry cannot issue new saves',async()=>{
 const h=fixture();h.image({status:'uncertain',messages:['저장 응답 미확인'],recoveryBatch:{}});
 const first=await h.run(['detailImage','koreanLabel','quotation']);assert.equal(first.stages[0].status,'blocked');
 assert.ok(first.stages.slice(1).every(stage=>stage.status==='blocked'&&stage.message.includes('아직 시작하지 않았습니다')));
 assert.equal(h.calls.some(call=>call.adapter==='label'||call.url?.endsWith('/quotation-ai')),false);
 const writes=h.calls.filter(call=>call.method==='POST').length;
 const second=await h.run(['detailImage','quotation']);assert.equal(second.stages[0].status,'blocked');
 assert.equal(h.calls.filter(call=>call.method==='POST').length,writes);
});
test('unknown label save stops quotation and remains blocked on explicit retry',async()=>{
 const h=fixture();h.label({status:'blocked',message:'PNG 응답 미확인',uncertain:true});
 const first=await h.run(['koreanLabel','quotation']);assert.equal(first.stages[0].status,'blocked');
 await h.run(['koreanLabel','quotation']);assert.equal(h.calls.filter(call=>call.adapter==='label').length,1);
 assert.equal(h.calls.some(call=>call.url?.endsWith('/quotation-ai')),false);
});
test('account or company change prevents provider and mutation calls',async()=>{
 const h=fixture();h.owner('other');await assert.rejects(h.run(['pricing']),/계정/);
 assert.equal(h.calls.filter(call=>call.method==='POST').length,0);
 const p=fixture();let count=0;p.intercept(call=>{if(call.url==='/api/supplier-hub/catalog-context'&&++count===3)p.company({code:'A01464742',name:'와이홉'});});
 const result=await p.run(['pricing','quotation']);assert.equal(result.stages[0].status,'failed');
 assert.equal(p.calls.some(call=>call.method==='POST'),false);
});
for(const failure of ['company-change','account-read-error'])test(`an image preparation ${failure} before dispatch permits a later explicit same-scope action`,async()=>{
 const h=fixture();let accountReads=0;
 h.intercept(call=>{
  if(call.url==='/api/supplier-hub/catalog-context'&&++accountReads===3){
   if(failure==='company-change')h.company({code:'A01464742',name:'와이홉'});
   else return Response.json({error:'temporary account read failure'},{status:503});
  }
 });
 const first=await h.run(['mainImage']);assert.equal(first.stages[0].status,'failed');
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/work-draft')).length,0);
 assert.equal(h.calls.filter(call=>call.adapter==='image').length,0);
 assert.equal(h.keys.has('owner:product:pending:mainImage'),false,'a preflight rejection cannot reserve an unsent preparation');
 h.company({code:'A01526306',name:'유앤채'});
 const second=await h.run(['mainImage']);assert.equal(second.stages[0].status,'draft');
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/work-draft')).length,1);
 assert.equal(h.calls.filter(call=>call.adapter==='image').length,1);
});
for(const failure of ['lost-ack','changed-company-after-dispatch','invalid-ack'])test(`a dispatched image preparation with ${failure} stays fenced on explicit retry`,async()=>{
 const h=fixture();
 h.intercept(call=>{
  if(call.url?.endsWith('/work-draft')){
   if(failure==='lost-ack')throw Error('lost committed preparation response');
   if(failure==='changed-company-after-dispatch')h.company({code:'A01464742',name:'와이홉'});
   else return Response.json({productId:'other',productVersion:version});
  }
 });
 const first=await h.run(['mainImage','additionalImages']);assert.equal(first.stages[0].status,'failed');
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/work-draft')).length,1);
 assert.equal(h.calls.filter(call=>call.adapter==='image').length,0);
 assert.equal(h.keys.has('owner:product:pending:mainImage'),true);
 h.company({code:'A01526306',name:'유앤채'});
 const second=await h.run(['mainImage']);assert.equal(second.stages[0].status,'blocked');
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/work-draft')).length,1,'an uncertain committed preparation is never resent');
 assert.equal(h.calls.filter(call=>call.adapter==='image').length,0);
});
test('abort after product read cannot start a provider or mutation',async()=>{
 const h=fixture();h.intercept(call=>{if(call.url.endsWith('/stage-two-pricing'))h.controller.abort();});
 assert.equal(await h.run(['pricing']),null);assert.equal(h.calls.some(call=>call.method==='POST'),false);
});
test('unknown or duplicate task ids are rejected before any network call',async()=>{
 for(const stages of [[],['pricing','pricing'],['submit'],['mainImages']]){
  const h=fixture();await assert.rejects(h.run(stages),/단계/);assert.equal(h.calls.length,0);
 }
});
test('missing chart is explicitly skipped, not manufactured or reported complete',async()=>{
 const h=fixture(),result=await h.run(['sizeChart']);assert.equal(result.stages[0].status,'skipped');
 assert.match(result.stages[0].message,/원본/);assert.equal(h.calls.some(call=>call.method==='POST'),false);
});
test('a pricing adapter rejection is never shown as complete',async()=>{
 const h=fixture();h.intercept(call=>call.url.endsWith('/stage-two-pricing')?Response.json({status:'failed',message:'다른 상품 응답'}):null);
 const result=await h.run(['pricing']);assert.equal(result.stages[0].status,'failed');
});

test('a real stage-six local render failure stays failed and retryable while stage seven continues in the same action',async()=>{
 const h=fixture(),model=providedOptionModule('app/product-label.ts'),runLabel=providedOptionModule('app/batch-selected-label-work.ts').runSelectedLabelWork;
 const values=Object.fromEntries(model.productLabelFields.map(field=>[field.key,({productName:'보존할 제품명',netContents:'1개',material:'실리콘',productType:'생활용품'})[field.key]??'']));
 const view={productId:'product',revision:1,inputFingerprint:hash,productVersion:version,contentRevision:3,optionRevision:1,quotationRevision:1,quotationInputFingerprint:hash,
  categoryContext:{source:'collection',profileId:null,categoryId:'80719',categoryPath:['합성 분류']},imageKeys:[],overrides:{common:values,options:{}},updatedAt:version,
  rows:[{optionId:null,optionLabel:'공통',included:false},{optionId:'a',optionLabel:'검정',included:true}].map(row=>({...row,values,automatic:values,sources:Object.fromEntries(model.productLabelFields.map(field=>[field.key,'manual-common']))}))};
 let renders=0;h.intercept(call=>call.url.endsWith('/product-labels')?Response.json(view):null);
 h.deps['@/app/batch-selected-label-work'].runSelectedLabelWork=(id,controls)=>runLabel(id,{...controls,render:async()=>{renders++;throw Error('local canvas unavailable');}});
 const result=await h.run(['koreanLabel','quotation']);assert.equal(result.stages[0].status,'failed');assert.match(result.stages[0].message,/local canvas unavailable/);
 assert.equal(result.stages[1].status,'draft');assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,1);
 assert.equal(h.calls.some(call=>call.url==='/api/files'||call.url?.endsWith('/product-label-draft')),false);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:koreanLabel')||key.includes(':write:label:')),false);
 await h.run(['koreanLabel']);assert.equal(renders,2,'A subsequent explicit action is not permanently blocked by an unsent save');
});

function labelDraftFailureFixture(reply){
 const h=fixture(),model=providedOptionModule('app/product-label.ts'),runLabel=providedOptionModule('app/batch-selected-label-work.ts').runSelectedLabelWork;
 const automatic=Object.fromEntries(model.productLabelFields.map(field=>[field.key,({productName:'보존할 제품명',netContents:'1개',material:'실리콘',productType:'생활용품'})[field.key]??'']));
 const values={...automatic,netContents:''},view={productId:'product',revision:1,inputFingerprint:hash,productVersion:version,contentRevision:3,optionRevision:1,quotationRevision:1,quotationInputFingerprint:hash,
  categoryContext:{source:'collection',profileId:null,categoryId:'80719',categoryPath:['합성 분류']},imageKeys:[],overrides:{common:{netContents:''},options:{}},updatedAt:version,
  rows:[{optionId:null,optionLabel:'공통',included:false},{optionId:'a',optionLabel:'검정',included:true}].map(row=>({...row,values:{...values},automatic:{...automatic},sources:Object.fromEntries(model.productLabelFields.map(field=>[field.key,field.key==='netContents'?'manual-common':automatic[field.key]?'content':'empty']))}))};
 const before=plain(view);let renders=0;
 h.intercept(call=>{
  if(call.url.endsWith('/product-labels'))return Response.json(view);
  if(call.url.endsWith('/product-label-draft'))return reply(call);
  return null;
 });
 h.deps['@/app/batch-selected-label-work'].runSelectedLabelWork=(id,controls)=>runLabel(id,{...controls,render:async()=>{renders++;throw Error('Rejected proposals must not render');}});
 return{h,view,before,renders:()=>renders};
}

test('a real rejected label response releases only its confirmed failure and lets quotation run once without saving or painting',async()=>{
 const f=labelDraftFailureFixture(()=>Response.json({code:'PRODUCT_LABEL_DRAFT_RESPONSE',error:'표시사항 AI의 완전한 JSON 응답을 확인하지 못했습니다. 입력은 유지됩니다.'},{status:503})),{h}=f;
 const result=await h.run(['koreanLabel','quotation']);
 assert.deepEqual(result.stages.map(row=>[row.id,row.status]),[['koreanLabel','failed'],['quotation','draft']]);
 assert.match(result.stages[0].message,/완전한 JSON/);assert.doesNotMatch(result.stages[0].message,/AI 초안 생성 결과가 미확인/);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/product-label-draft')).length,1,'No automatic label retry');
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,1);
 assert.equal(h.calls.filter(call=>call.adapter==='packaging').length,1);assert.equal(f.renders(),0);
 assert.equal(h.calls.some(call=>call.method==='PUT'||call.url==='/api/files'),false);assert.deepEqual(f.view,f.before);
 assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:koreanLabel')||key.includes(':write:label:')),false);
 await h.run(['koreanLabel']);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/product-label-draft')).length,2,'Only another explicit action may request another draft');
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,1);
 assert.equal(f.renders(),0);assert.deepEqual(f.view,f.before);
});

for(const failure of ['timeout','provider','transport'])test('real label '+failure+' remains uncertain and cannot dispatch quotation or replay the draft',async()=>{
 const f=labelDraftFailureFixture(()=>{
  if(failure==='transport')throw Error('Lost provider acknowledgment');
  return Response.json({code:failure==='timeout'?'PRODUCT_LABEL_DRAFT_TIMEOUT':'PRODUCT_LABEL_DRAFT_PROVIDER',error:'원래 제공자 요청 결과를 확인해주세요.'},{status:failure==='timeout'?504:503});
 }),{h}=f;
 const result=await h.run(['koreanLabel','quotation']);
 assert.deepEqual(result.stages.map(row=>row.status),['blocked','blocked']);assert.match(result.stages[0].message,/AI 초안 생성 결과가 미확인/);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/product-label-draft')).length,1);
 assert.equal(h.calls.some(call=>call.url?.endsWith('/quotation-ai')||call.adapter==='packaging'||call.method==='PUT'||call.url==='/api/files'),false);
 await h.run(['koreanLabel','quotation']);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/product-label-draft')).length,1,'An unknown request must not be replayed on another explicit action');
 assert.equal(f.renders(),0);assert.deepEqual(f.view,f.before);
});

test('required chart without an original blocks instead of pretending the category is optional',async()=>{
 const h=fixture();h.intercept(call=>call.url.endsWith('/registration-layout')?Response.json({productId:'product',productVersion:version,sizeChartRequired:true}):null);
 const result=await h.run(['sizeChart']);assert.equal(result.stages[0].status,'blocked');assert.match(result.stages[0].message,/필수/);
});

test('a confirmed skipped image stage can be retried after settings change',async()=>{
 const h=fixture();h.image({status:'skipped',messages:['번역 꺼짐']});assert.equal((await h.run(['mainImage'])).stages[0].status,'skipped');
 h.image({status:'completed',messages:['번역 저장']});assert.equal((await h.run(['mainImage'])).stages[0].status,'draft');
 assert.equal(h.calls.filter(call=>call.adapter==='image').length,2);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
});

test('each requested price calculation reads current policy instead of reusing old run artifacts',async()=>{
 const h=fixture();
 await h.run(['pricing']);await h.run(['pricing']);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/stage-two-pricing')).length,2);
});

test('the original company remains pinned across products and retry in one click',async()=>{
 const h=fixture();await h.run(['pricing']);h.company({code:'A01464742',name:'와이홉'});
 await assert.rejects(h.run(['pricing']),/회사/);assert.equal(h.calls.filter(call=>call.url?.endsWith('/stage-two-pricing')).length,1);
});

test('an unresolved quotation provider call cannot start another provider on retry',async()=>{
 const h=fixture();h.intercept(call=>call.url.endsWith('/quotation-ai')&&call.method==='POST'?Response.json({job:{status:'uncertain'}}):null);
 assert.equal((await h.run(['quotation'])).stages[0].status,'blocked');await h.run(['quotation']);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,1);
});

function knownQuotationFixture({configured=true,generateFirst=false}={}){
 const h=fixture(),nextVersion='2026-10-23T00:00:01.000Z';
 Object.assign(h.deps['@/app/quotation-ai-client'],providedOptionModule('app/quotation-ai-client.ts'));
 Object.assign(h.deps['@/app/quotation-fields-confirmation'],providedOptionModule('app/quotation-fields-confirmation.ts'));
 const fields=['제조자(수입자)','소비자상담 관련 전화번호','제조국(원산지)','재질'].map((label,index)=>({id:'notice'+index,label,section:'legal',visibility:'common',type:'text',required:false,hubWire:{path:['legalPage','notices'],name:label,nameKey:'noticeItemName',valueKey:'noticeItemValue'}}));
 const schema={status:'observed',categoryId:'68183',categoryPath:['합성'],fields},rows=['a','b','excluded'].map(optionId=>({optionId,optionLabel:optionId,included:optionId!=='excluded',fields:Object.fromEntries(fields.map(field=>[field.id,{value:'해당사항없음',source:'couplus-default'}]))}));
 const view={revision:1,inputFingerprint:hash,contentRevision:3,optionRevision:2,productVersion:version,updatedAt:version,imageKeys:[],overrides:{common:{},options:{b:{notice0:''}}},categoryContext:{profileId:null,categoryId:'68183',categoryPath:['합성']},automatic:{schema,rows:plain(rows)},resolved:{schema,rows}};
 view.resolved.rows[1].fields.notice0={value:'',source:'manual-option'};
 const content={schemaVersion:1,productId:'product',revision:3,label:Object.fromEntries(Object.entries({manufacturer:'저장 제조사',importer:'저장 수입사',contact:'02-1234-5678',countryOfOrigin:'중국'}).map(([key,value])=>[key,{value,provenance:key==='countryOfOrigin'?'generated':'manual'}]))};
 const job={id:'99999999-9999-4999-8999-999999999999',status:'completed',fingerprint:hash,quotationRevision:1,profileId:null,scope:{optionId:null,applyToAllOptions:true},model:quotationModel,result:{changes:[{optionId:'a',fieldKey:'notice3',value:'검토 재질'}],warnings:[],model:quotationModel,generatedAt:version}};
 const savedOptions={schemaVersion:1,productId:'product',revision:2,rows:['a','b','excluded'].map((id,index)=>({id,included:id!=='excluded',color:index?'핑크':'베이지',unitsPerPack:1,provenance:{color:'manual',unitsPerPack:'manual'},updatedAt:version}))};
 const savedLabels={schemaVersion:1,productId:'product',revision:1,updatedAt:version,overrides:{common:{},options:{}}};
 let onContent,saveResponse,knownOverride,generated=!generateFirst;const writes=[];
 h.intercept(async call=>{
  if(call.url.endsWith('/quotation-ai')){
   if(call.method==='POST'){generated=true;return Response.json({job,sourceCurrent:true});}
   return Response.json({configuration:{...quotationConfiguration,configured},fingerprint:hash,productId:'product',productVersion:version,contentRevision:3,optionRevision:2,quotationRevision:1,profileId:null,
    knownChanges:knownOverride??providedOptionModule('app/quotation-known-notice-proposals.ts').quotationKnownNoticeProposals('product',view,content,{optionId:null,applyToAllOptions:true},savedOptions,savedLabels),jobs:configured&&generated?[job]:[]});
  }
  if(call.url.endsWith('/content')){onContent?.();return Response.json({content});}
  if(call.url.endsWith('/quotation-fields')){
   if(call.method!=='PUT')return Response.json(view);
   writes.push(plain(call.body));if(saveResponse)return saveResponse(call);
   const saved=plain(view);saved.overrides=providedOptionModule('app/quotation-schema.ts').applyQuotationChanges(saved.overrides,call.body.changes);
   for(const change of call.body.changes)saved.resolved.rows.find(row=>row.optionId===change.optionId).fields[change.fieldKey]={value:change.value,source:'manual-option'};
   Object.assign(saved,{revision:2,inputFingerprint:'b'.repeat(64),productVersion:nextVersion,updatedAt:nextVersion});return Response.json(saved);
  }
 });
 return {...h,view,content,job,writes,fields,savedOptions,savedLabels,onContent:callback=>onContent=callback,saveResponse:callback=>saveResponse=callback,overrideKnownChanges:value=>knownOverride=value};
}

test('an actual raw BODY partial draft continues to label and verified quotation save while preserving manual fields',async()=>{
 const h=knownQuotationFixture(),image=await actualDetailFixture(),contentBefore=plain(h.content),imageContentBefore=plain(image.content),manualBlank=h.view.resolved.rows[1].fields.notice0,manualHtml=image.f.view.resolved.rows[0].fields.detailHtml,documents=[];let labelStarted=false;
 image.f.view.productVersion=version;
 const recognize=image.deps.recognize,render=image.deps.render;image.deps.recognize=async loaded=>{
  const accepted=await recognize(loaded),rejected={...plain(accepted[0]),id:'vision-2',text:'未翻译',translated:'',issue:'번역 검증을 통과하지 못했습니다. 원문과 영역을 확인해주세요.',translationProvenance:'empty',box:{x:8,y:1,width:3,height:3}};
  loaded.visionResult.blocks.push({id:rejected.id,text:rejected.text,translated:null,issue:rejected.issue,box:rejected.box});return[...accepted,rejected];
 };image.deps.render=async(...args)=>{const result=await render(...args);documents.push(result.editDocument);return result;};
 h.company({code:'A01464742',name:'와이홉'});h.prependIntercept(call=>{
  if(call.url==='/api/products/product')return Response.json({product:{id:'product',title:'검증 상품',updated_at:image.f.view.productVersion}});
  if(call.url.endsWith('/work-draft'))return Response.json({productId:'product',productVersion:image.f.view.productVersion});
  if(call.url.endsWith('/content')&&!labelStarted)return Response.json({content:image.content});
 });
 const imageAdapter=h.deps['@/app/batch-selected-detail-work'];imageAdapter.createSelectedDetailWorkState=image.model.createSelectedDetailWorkState;imageAdapter.processSelectedDetailWork=(id,options)=>image.model.processSelectedDetailWork(id,{...image.options,...options,fetcher:image.options.fetcher},image.deps);
 const labelAdapter=h.deps['@/app/batch-selected-label-work'],label=labelAdapter.runSelectedLabelWork;labelAdapter.runSelectedLabelWork=async(...args)=>{labelStarted=true;return label(...args);};
 const result=await h.run(['detailImage','koreanLabel','quotation']);assert.deepEqual(plain(result.stages.map(row=>row.status)),['blocked','draft','draft']);assert.match(result.stages[0].message,/미완료|일부 번역/);
 assert.equal(image.calls.filter(row=>row.operation==='image-apply').length,1);assert.equal(image.calls.filter(row=>row.operation==='vision').length,1);assert.equal(documents[0].regions.find(row=>row.id==='vision-2').selected,false);assert.equal(documents[0].regions.find(row=>row.id==='vision-2').translated,'');assert.match(documents[0].regions.find(row=>row.id==='vision-2').issue,/자동 번역 미완료/);
 assert.equal(h.calls.filter(call=>call.adapter==='label').length,1);assert.equal(h.writes.length,1);assert.ok(h.writes[0].changes.every(change=>change.optionId!=='b'||change.fieldKey!=='notice0'));assert.deepEqual(h.view.resolved.rows[1].fields.notice0,manualBlank);assert.deepEqual(plain(image.f.view.resolved.rows[0].fields.detailHtml),plain(manualHtml));assert.deepEqual(h.content,contentBefore);assert.deepEqual(plain(image.content),imageContentBefore);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
});
test('explicit quotation work saves verified AI plus saved notice sources in one CAS request and confirms their exact receipt',async()=>{
 const h=knownQuotationFixture(),before=JSON.stringify({view:h.view,content:h.content}),result=await h.run(['quotation']);
 assert.equal(result.stages[0].status,'draft',result.stages[0].message);assert.match(result.stages[0].message,/AI 항목 1개 · 저장된 표시·옵션 정보 3개/);
 assert.equal(h.writes.length,1);assert.equal(h.writes[0].expectedRevision,1);assert.equal(h.writes[0].expectedInputFingerprint,hash);
 assert.deepEqual(h.writes[0].changes,[{optionId:'a',fieldKey:'notice3',value:'검토 재질'},{optionId:'a',fieldKey:'notice0',value:'제조자: 저장 제조사 / 수입자: 저장 수입사'},{optionId:'a',fieldKey:'notice1',value:'02-1234-5678'},{optionId:'b',fieldKey:'notice1',value:'02-1234-5678'}]);
 assert.equal(JSON.stringify({view:h.view,content:h.content}),before);assert.equal(h.calls.some(call=>call.method==='POST'),false);
 assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
 assert.deepEqual(h.calls.find(call=>call.adapter==='packaging'),{adapter:'packaging',id:'product',revision:2,fingerprint:'b'.repeat(64)});
});

test('quotation completion accepts sourced empty choices while retaining unknown, manual text blanks and validation errors',async()=>{
 for(const [name,source,type,choices,value,validationIssues,expected] of [
  ['schema default','couplus-default','select',[{value:'',label:'해당사항없음'},{value:'UV',label:'UV'}],'',[],'draft'],
  ['explicit selected N/A','manual-option','select',[{value:'',label:'해당사항없음'}],'',[],'draft'],
  ['unknown selection','empty','select',[{value:'',label:'해당사항없음'}],'',[],'blocked'],
  ['manual text blank','manual-option','text',undefined,'',[],'blocked'],
  ['manual unselected choice','manual-option','select',[{value:'UV',label:'UV'}],'',[],'blocked'],
  ['whitespace','manual-option','select',[{value:'',label:'해당사항없음'}],' ',[],'blocked'],
  ['invalid selected choice','couplus-default','select',[{value:'',label:'해당사항없음'}],'',['저장값 검토 필요'],'blocked'],
 ]){
  const h=knownQuotationFixture(),field={id:'requiredChoice',label:'렌즈 유형',section:'product',visibility:'common',type,required:true,...(choices?{choices}:{})};
  h.fields.push(field);
  for(const row of [...h.view.resolved.rows,...h.view.automatic.rows])row.fields[field.id]={value,source,validationIssues};
  const before=plain(h.view.resolved.rows.map(row=>row.fields[field.id]));
  const result=await h.run(['koreanLabel','quotation']),quotation=result.stages.find(stage=>stage.id==='quotation');
  assert.equal(quotation.status,expected,name+': '+quotation.message);
  if(expected==='draft')assert.doesNotMatch(quotation.message,/필수 입력 확인:.*렌즈 유형/,name);
  else assert.match(quotation.message,/필수 입력 확인:.*렌즈 유형/,name);
  assert.equal(result.stages[0].status,'draft');assert.equal(h.writes.length,1);assert.equal(h.calls.filter(call=>call.adapter==='packaging').length,1);
  assert.ok(h.writes[0].changes.every(change=>change.fieldKey!==field.id),name);
  assert.deepEqual(h.view.resolved.rows.map(row=>row.fields[field.id]),before,name);
 }
});

test('quotation readiness blocks the actual optional empty-wire choice error while retaining valid blanks and excluded edits',async()=>{
 const schema=providedOptionModule('app/quotation-schema.ts'),review=providedOptionModule('app/submission-review.ts');
 const field=plain(schema.getQuotationSchema('77442').fields.find(field=>field.id==='board_magnetic'));
 assert.equal(field.required,false);assert.ok(field.choices.some(choice=>choice.value===''&&choice.label==='해당사항없음'));
 for(const mode of ['invalid saved label','legacy invalid saved label','modern review only','optional empty','selected empty','excluded invalid']){
  const h=knownQuotationFixture(),blocked=mode.endsWith('invalid saved label');h.fields.push(field);
  for(const row of [...h.view.resolved.rows,...h.view.automatic.rows]){
   const invalid=blocked&&row.optionId==='a'||mode==='excluded invalid'&&!row.included;
   const value=invalid?'해당사항없음':'',source=invalid||mode==='selected empty'?'manual-option':'empty';
   const validationIssues=schema.quotationValueIssues(field,value);
   row.fields[field.id]={value,source,validationIssues,issues:mode==='modern review only'?['실제 상품과 대조할 검토 근거입니다.']:validationIssues,needsReview:false};
   if(mode==='legacy invalid saved label')delete row.fields[field.id].validationIssues;
  }
  const before=plain(h.view.resolved.rows.map(row=>row.fields[field.id])),manualBlank=plain(h.view.resolved.rows[1].fields.notice0);
  const result=await h.run(['quotation']),quotation=result.stages[0],report=review.inspectSubmission(h.view.resolved,[]);
  assert.equal(quotation.status,blocked?'blocked':'draft',mode+': '+quotation.message);
  assert.equal(report.issues.some(issue=>issue.code==='FIELD_INVALID'&&issue.fieldId===field.id),blocked,mode);
  if(blocked){assert.match(quotation.message,/입력값 확인:.*자석 부착가능 여부/);assert.doesNotMatch(quotation.message,/최종 검토 후 등록전송/);}
  else assert.doesNotMatch(quotation.message,/입력값 확인|필수 입력 확인/);
  assert.equal(h.writes.length,1);assert.ok(h.writes[0].changes.every(change=>change.fieldKey!==field.id));
  assert.deepEqual(plain(h.view.resolved.rows.map(row=>row.fields[field.id])),before);assert.deepEqual(h.view.resolved.rows[1].fields.notice0,manualBlank);
 }
});

test('quotation readiness blocks current aggregate constraints after confirmed saves without treating review evidence as an error',async()=>{
 for(const mode of ['current error','legacy error','modern review only']){
  const h=knownQuotationFixture(),blocked=mode!=='modern review only',message='현재 카테고리의 옵션 개수 한도를 초과했습니다.';
  h.view.resolved.validationIssues=blocked?[message]:[];h.view.resolved.reviewMessages=['실제 상품과 대조할 검토 근거입니다.'];
  h.view.resolved.issues=blocked?[message]:h.view.resolved.reviewMessages;
  if(mode==='legacy error')delete h.view.resolved.validationIssues;
  const before=plain(h.view.resolved.rows[1].fields.notice0),quotation=(await h.run(['quotation'])).stages[0];
  assert.equal(quotation.status,blocked?'blocked':'draft',quotation.message);
  if(blocked){assert.match(quotation.message,/견적 조건 확인:.*옵션 개수 한도/);assert.doesNotMatch(quotation.message,/최종 검토 후 등록전송/);}
  else assert.match(quotation.message,/최종 검토 후 등록전송/);
  assert.equal(h.writes.length,1);assert.deepEqual(h.view.resolved.rows[1].fields.notice0,before);
 }
});

test('quotation PUT rejected by its final protected account preflight releases only the unsent fence and reuses the confirmed AI job',async()=>{
 const h=knownQuotationFixture({generateFirst:true});let armed=true,rejectAccount=false;
 h.onContent(()=>{if(armed){armed=false;rejectAccount=true;}});
 h.prependIntercept(call=>{if(call.url==='/api/supplier-hub/catalog-context'&&rejectAccount){rejectAccount=false;return Response.json({error:'temporary catalog read failure'},{status:503});}});
 const first=await h.run(['quotation']);assert.equal(first.stages[0].status,'failed');assert.match(first.stages[0].message,/temporary catalog read failure/);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,1);assert.equal(h.writes.length,0);assert.equal(h.calls.some(call=>call.adapter==='packaging'),false);
 assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:quotation')||key.includes(':write:quotation:')),false);
 const priorAiKey=h.keys.get('owner:product:quote:'+hash);assert.ok(priorAiKey);
 const next=await h.run(['quotation']);assert.equal(next.stages[0].status,'draft');assert.equal(h.writes.length,1);assert.equal(h.calls.filter(call=>call.adapter==='packaging').length,1);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,1,'The server-confirmed AI result is reused instead of inferred again');assert.equal(h.keys.get('owner:product:quote:'+hash),priorAiKey);
 assert.equal(h.view.resolved.rows[1].fields.notice0.value,'');assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
});

test('a dispatched quotation PUT with a lost or invalid receipt keeps its fence and confirmed AI result without resending either',async()=>{
 for(const mode of ['lost','invalid']){
  const h=knownQuotationFixture({generateFirst:true});h.saveResponse(()=>{if(mode==='lost')throw Error('quotation PUT ACK lost');return Response.json({...plain(h.view),revision:99});});
  const first=await h.run(['quotation']);assert.equal(first.stages[0].status,'failed',mode);assert.equal(h.writes.length,1);assert.equal(h.calls.some(call=>call.adapter==='packaging'),false);
  const retained=JSON.stringify([...h.keys.entries()]);assert.equal(h.keys.has('owner:product:pending:quotation'),true);assert.equal([...h.keys.keys()].some(key=>key.includes(':write:quotation:')),true);
  assert.ok(h.keys.get('owner:product:quote:'+hash));assert.equal((await h.run(['quotation'])).stages[0].status,'blocked');assert.equal(h.writes.length,1);assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,1);
  assert.equal(JSON.stringify([...h.keys.entries()]),retained);assert.equal(h.view.resolved.rows[1].fields.notice0.value,'');
 }
});

test('unconfigured quotation AI preserves manual values while applying known notices and checking packaging',async()=>{
 const h=knownQuotationFixture({configured:false}),before=JSON.stringify({view:h.view,content:h.content}),result=await h.run(['quotation']);
 assert.equal(result.stages[0].status,'blocked');assert.match(result.stages[0].message,/AI가 설정되지 않아 AI 작성은 실행하지 않았습니다/);
 assert.match(result.stages[0].message,/저장된 표시·옵션 정보 3개/);assert.match(result.stages[0].message,/포장값/);
 assert.equal(h.calls.some(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST'),false);
 assert.equal(h.writes.length,1);assert.equal(h.writes[0].expectedRevision,1);assert.equal(h.writes[0].expectedInputFingerprint,hash);
 assert.deepEqual(h.writes[0].changes,[{optionId:'a',fieldKey:'notice0',value:'제조자: 저장 제조사 / 수입자: 저장 수입사'},{optionId:'a',fieldKey:'notice1',value:'02-1234-5678'},{optionId:'b',fieldKey:'notice1',value:'02-1234-5678'}]);
 assert.equal(JSON.stringify({view:h.view,content:h.content}),before);
 assert.deepEqual(h.calls.find(call=>call.adapter==='packaging'),{adapter:'packaging',id:'product',revision:2,fingerprint:'b'.repeat(64)});
});

function extendedKnownQuotationFixture(){
 const h=knownQuotationFixture();
 for(const [key,value] of Object.entries({countryOfOrigin:'중국',material:'내용의 재질',components:'1쌍',dimensions:'120×40mm',precautions:'화기 주의'}))h.content.label[key]={value,provenance:'manual'};
 h.savedLabels.overrides.common={material:'표시사항에서 저장한 재질',netContents:'1쌍'};
 for(const label of ['제품 구성','치수','취급시 주의사항','색상','수량']){
  const quantity=label==='수량',id='extended'+h.fields.length;
  h.fields.push({id,label,section:quantity?'product':'legal',visibility:quantity?'exposed':'common',type:'text',required:false,
   hubWire:quantity?{path:['productPage','commonAttributes','exposedAttributes'],name:label,nameKey:'attributeName',valueKey:'attributeValue'}
    :{path:['legalPage','notices'],name:label,nameKey:'noticeItemName',valueKey:'noticeItemValue'}});
  for(const row of [...h.view.resolved.rows,...h.view.automatic.rows])row.fields[id]=quantity?{value:'1',source:'option'}:{value:'해당사항없음',source:'couplus-default'};
 }
 const color=h.fields.find(field=>field.label==='색상').id;
 h.view.overrides.options.b[color]='';h.view.resolved.rows[1].fields[color]={value:'',source:'manual-option'};
 return h;
}

test('batch quotation consumes server saved options and label overrides, wins AI duplicate and preserves pair quantity and manual blank',async()=>{
 const h=extendedKnownQuotationFixture(),before=JSON.stringify({view:h.view,content:h.content,options:h.savedOptions,labels:h.savedLabels});
 const result=await h.run(['quotation']);assert.equal(result.stages[0].status,'draft',result.stages[0].message);assert.equal(h.writes.length,1);
 const changes=h.writes[0].changes,value=(id,label)=>changes.find(change=>change.optionId===id&&change.fieldKey===h.fields.find(field=>field.label===label).id)?.value;
 assert.equal(value('a','재질'),'표시사항에서 저장한 재질');assert.equal(value('b','재질'),'표시사항에서 저장한 재질');
 assert.equal(value('a','제조국(원산지)'),'중국');assert.equal(value('a','제품 구성'),'1쌍');assert.equal(value('a','수량'),'1쌍');
 assert.equal(value('a','치수'),'120×40mm');assert.equal(value('a','취급시 주의사항'),'화기 주의');assert.equal(value('a','색상'),'베이지');assert.equal(value('b','색상'),undefined);
 assert.ok(changes.every(change=>change.optionId!=='excluded'));assert.equal(changes.some(change=>change.value==='검토 재질'),false);
 assert.equal(new Set(changes.map(change=>JSON.stringify([change.optionId,change.fieldKey]))).size,changes.length);
 assert.match(result.stages[0].message,/AI 항목 0개/);assert.equal(JSON.stringify({view:h.view,content:h.content,options:h.savedOptions,labels:h.savedLabels}),before);
 assert.equal(h.calls.some(call=>call.method==='POST'),false);assert.equal(h.calls.filter(call=>call.adapter==='packaging').length,1);
});

test('malformed, excluded or manual-blank server source targets cannot enter combined quotation save or packaging',async()=>{
 for(const mutate of [changes=>changes.push(plain(changes[0])),changes=>{changes[0].optionId='excluded';},changes=>{changes[0].optionId='b';changes[0].fieldKey='notice0';},changes=>{changes[0].fieldKey='unknown';},changes=>{changes[0].value='해당사항없음';}]){
  const h=extendedKnownQuotationFixture(),changes=plain(providedOptionModule('app/quotation-known-notice-proposals.ts').quotationKnownNoticeProposals('product',h.view,h.content,{optionId:null,applyToAllOptions:true},h.savedOptions,h.savedLabels));
  mutate(changes);h.overrideKnownChanges(changes);const result=await h.run(['quotation']);assert.equal(result.stages[0].status,'failed');assert.equal(h.writes.length,0);assert.equal(h.calls.some(call=>call.adapter==='packaging'),false);
 }
});

test('confirmed failed quotation AI still copies verified saved sources and checks packaging without rerunning AI or claiming completion',async()=>{
 const h=extendedKnownQuotationFixture();h.job.status='failed';h.job.result=null;h.job.error={code:'PROVIDER_FAILED',message:'확인된 모델 오류',uncertain:false};
 const result=await h.run(['quotation']);assert.equal(result.stages[0].status,'blocked');assert.match(result.stages[0].message,/AI 실패: 확인된 모델 오류/);assert.match(result.stages[0].message,/저장된 표시·옵션 정보/);
 assert.equal(h.writes.length,1);assert.equal(h.calls.filter(call=>call.adapter==='packaging').length,1);assert.equal(h.calls.some(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST'),false);
 assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
});

test('only explicit quotation retry replaces an exact confirmed failure and saves the reviewed draft without losing manual or excluded fields',async()=>{
 const h=knownQuotationFixture(),completed=plain(h.job),before=plain(h.view);h.job.status='failed';h.job.result=null;h.job.error={code:'PROVIDER_FAILED',message:'확인된 모델 오류',uncertain:false};h.overrideKnownChanges([]);
 const originalKey='11111111-1111-4111-8111-111111111111',freshKey='22222222-2222-4222-8222-222222222222';let allocated=0;
 h.keys.set('owner:product:quote:'+hash,originalKey);h.options.newKey=()=>{allocated++;return freshKey;};
 const first=await h.run(['quotation']);assert.equal(first.stages[0].status,'blocked');assert.equal(allocated,0);assert.equal(h.writes.length,0);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,0);
 h.overrideKnownChanges(undefined);h.options.retryFailedQuotation=true;h.prependIntercept(call=>{if(call.url.endsWith('/quotation-ai')&&call.method==='POST'){Object.assign(h.job,completed);return Response.json({job:completed,sourceCurrent:true});}});
 const retry=await h.run(['quotation']);assert.equal(retry.stages[0].status,'draft',retry.stages[0].message);assert.equal(allocated,1);
 const generated=h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST');assert.equal(generated.length,1);assert.equal(generated[0].body.idempotencyKey,freshKey);assert.equal(generated[0].body.expectedFingerprint,hash);assert.equal(generated[0].body.expectedQuotationRevision,1);assert.equal(generated[0].body.optionId,null);assert.equal(generated[0].body.applyToAllOptions,true);
 assert.equal(h.writes.length,1);assert.deepEqual(h.writes[0].changes,[{optionId:'a',fieldKey:'notice3',value:'검토 재질'},{optionId:'a',fieldKey:'notice0',value:'제조자: 저장 제조사 / 수입자: 저장 수입사'},{optionId:'a',fieldKey:'notice1',value:'02-1234-5678'},{optionId:'b',fieldKey:'notice1',value:'02-1234-5678'}]);
 assert.deepEqual(h.view,before);assert.equal(h.writes[0].changes.some(change=>change.optionId==='excluded'||change.optionId==='b'&&change.fieldKey==='notice0'||change.fieldKey==='notice2'),false);
 assert.equal(h.calls.filter(call=>call.adapter==='packaging').length,2);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
});

test('explicit quotation retry never replaces unresolved, completed, foreign-scope or foreign-policy history',async()=>{
 for(const mode of ['prepared','running','uncertain','failed-uncertain','completed','profile','scope','model','policy','revision','fingerprint']){
  const h=knownQuotationFixture();h.options.retryFailedQuotation=true;h.overrideKnownChanges([]);h.job.status='failed';h.job.result=null;h.job.error={code:'FAILED',message:'확인할 실행',uncertain:false};let allocated=0;h.options.newKey=()=>{allocated++;return '22222222-2222-4222-8222-222222222222';};
  if(['prepared','running','uncertain'].includes(mode))h.job.status=mode;
  if(mode==='failed-uncertain')h.job.error.uncertain=true;
  if(mode==='completed'){h.job.status='completed';h.job.result={changes:[],warnings:[],model:quotationModel,generatedAt:version};}
  if(mode==='profile')h.job.profileId='foreign';if(mode==='scope')h.job.scope={optionId:'a',applyToAllOptions:false};if(mode==='model')h.job.model='foreign';if(mode==='policy')h.job.executionPolicy={version:999};if(mode==='revision')h.job.quotationRevision=2;if(mode==='fingerprint')h.job.fingerprint='b'.repeat(64);
  // Invalid history that is outside this scope is not itself a terminal failure
  // proof. Keep it visible here so the retry decision cannot bypass validation.
  if(['profile','scope','revision','fingerprint'].includes(mode))h.deps['@/app/quotation-ai-client'].quotationAiJobForScope=()=>h.job;
  await h.run(['quotation']);assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,0,mode);assert.equal(allocated,0,mode);
 }
});

for(const mode of ['lost ACK','pre-dispatch rejection','another confirmed failure'])test(`one explicit failed quotation retry retains its new request through ${mode}`,async()=>{
 const h=knownQuotationFixture(),completed=plain(h.job),originalKey='11111111-1111-4111-8111-111111111111',freshKey='22222222-2222-4222-8222-222222222222';let allocated=0,rejected=false,posts=0;
 h.job.status='failed';h.job.result=null;h.job.error={code:'PROVIDER_FAILED',message:'확인된 모델 오류',uncertain:false};h.overrideKnownChanges([]);h.keys.set('owner:product:quote:'+hash,originalKey);h.options.newKey=()=>{allocated++;return freshKey;};
 // Also cover an original request whose lost ACK is now proved terminal failed.
 h.keys.set('owner:product:pending:quotation','견적서 AI 실행 결과 확인 필요');h.keys.set('owner:product:quotation-generation-readback-v1',JSON.stringify({format:'selected-quotation-generation-v2',ownerId:'owner',productId:'product',company:{code:'A01526306',name:'유앤채'},requestKey:originalKey,jobId:h.job.id,fingerprint:hash,productVersion:version,contentRevision:3,optionRevision:2,quotationRevision:1,profileId:null,model:quotationModel,executionPolicy:null,scope:{optionId:null,applyToAllOptions:true}}));
 const current=()=>({configuration:plain(quotationConfiguration),fingerprint:hash,productId:'product',productVersion:version,contentRevision:3,optionRevision:2,quotationRevision:1,profileId:null,knownChanges:[],jobs:[h.job]});
 h.prependIntercept(call=>{
  if(mode==='pre-dispatch rejection'&&!rejected&&call.url==='/api/supplier-hub/catalog-context'&&h.keys.get('owner:product:quote:'+hash)===freshKey&&h.keys.has('owner:product:pending:quotation')){rejected=true;return Response.json({error:'isolated retry preflight unavailable'},{status:503});}
  if(call.url.includes('/quotation-ai?jobId='))return Response.json(current());
  if(call.url.includes('/quotation-ai?idempotencyKey='))return Response.json({...current(),idempotencyKey:freshKey});
  if(call.url.endsWith('/quotation-ai')&&call.method==='POST'){
   posts++;h.job.id='88888888-8888-4888-8888-888888888888';if(mode!=='another confirmed failure')Object.assign(h.job,completed,{id:h.job.id});
   if(mode==='lost ACK'){h.job.status='running';h.job.result=null;throw Error('isolated new retry ACK lost');}
   return Response.json({job:h.job,sourceCurrent:true});
  }
 });
 h.options.retryFailedQuotation=true;const first=await h.run(['quotation']);assert.equal(allocated,1);assert.equal(posts,mode==='pre-dispatch rejection'?0:1);assert.equal(first.stages[0].status,mode==='another confirmed failure'?'blocked':'failed');
 const proof=JSON.parse(h.keys.get('owner:product:quotation-generation-readback-v1'));assert.equal(proof.requestKey,freshKey);assert.equal(h.keys.get('owner:product:quote:'+hash),freshKey);
 if(mode==='another confirmed failure'){
  h.options.retryFailedQuotation=false;await h.run(['quotation']);assert.equal(posts,1);assert.equal(allocated,1);assert.equal(h.writes.length,0);return;
 }
 if(mode==='pre-dispatch rejection'){assert.equal(h.keys.has('owner:product:pending:quotation'),false);assert.equal(proof.jobId,null);}
 const before=h.calls.length,next=await h.run(['quotation']);assert.equal(allocated,1);assert.equal(posts,1);
 if(mode==='lost ACK'){
  assert.equal(next.stages[0].status,'blocked');assert.equal(h.writes.length,0);assert.deepEqual(h.calls.slice(before).filter(call=>call.url?.includes('/quotation-ai')).map(call=>call.url),['/api/products/product/quotation-ai?idempotencyKey='+freshKey]);
  Object.assign(h.job,completed,{id:'88888888-8888-4888-8888-888888888888'});const recovered=await h.run(['quotation']);assert.equal(recovered.stages[0].status,'draft',recovered.stages[0].message);
 }else assert.equal(next.stages[0].status,'draft',next.stages[0].message);
 assert.equal(posts,1);assert.equal(allocated,1);assert.equal(h.writes.length,1);assert.ok(h.writes[0].changes.every(change=>change.optionId!=='excluded'&&(change.optionId!=='b'||change.fieldKey!=='notice0')));
 assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
});

test('unresolved quotation AI and uncertain failed proof never copy sources or start packaging',async()=>{
 for(const status of ['prepared','running','uncertain','failed']){
  const h=extendedKnownQuotationFixture();h.job.status=status;h.job.result=null;h.job.error={code:'UNCONFIRMED',message:'현재 결과 미확정',uncertain:true};
  const result=await h.run(['quotation','pricing']);assert.equal(result.stages.find(row=>row.id==='quotation').status,'blocked');assert.equal(h.writes.length,0);assert.equal(h.calls.some(call=>call.adapter==='packaging'),false);
 }
});

test('without quotation AI, an unknown notice save cannot be repeated or start packaging',async()=>{
 const h=knownQuotationFixture({configured:false});h.saveResponse(()=>{throw Error('lost ACK');});
 assert.equal((await h.run(['quotation'])).stages[0].status,'failed');assert.equal(h.writes.length,1);
 assert.equal((await h.run(['quotation'])).stages[0].status,'blocked');assert.equal(h.writes.length,1);
 assert.equal(h.calls.some(call=>call.adapter==='packaging'),false);
});

test('without quotation AI, company change or a different content revision blocks all quotation changes',async()=>{
 const changed=knownQuotationFixture({configured:false});changed.onContent(()=>changed.company({code:'A01464742',name:'와이홉'}));
 assert.equal((await changed.run(['quotation'])).stages[0].status,'failed');assert.equal(changed.writes.length,0);
 assert.equal(changed.calls.some(call=>call.adapter==='packaging'),false);
 const stale=knownQuotationFixture({configured:false});stale.content.revision++;
 assert.equal((await stale.run(['quotation'])).stages[0].status,'failed');assert.equal(stale.writes.length,0);
 assert.equal(stale.calls.some(call=>call.adapter==='packaging'),false);
});

test('quotation work retains an incomplete packaging result instead of reporting a completed draft',async()=>{
 const h=fixture();
 h.deps['@/app/batch-selected-packaging-work'].runSelectedPackagingWork=async(_id,{view})=>({view,status:'incomplete',remaining:3,message:'포장 사이즈 3개는 확인할 자료가 필요합니다.'});
 const result=await h.run(['quotation']);assert.equal(result.stages[0].status,'blocked');assert.match(result.stages[0].message,/포장 사이즈 3개/);
 assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
});

test('uncertain packaging write blocks another request rather than resending the quotation stage',async()=>{
 const h=fixture();let count=0;
 h.deps['@/app/batch-selected-packaging-work'].runSelectedPackagingWork=async(_id,options)=>{count++;await options.fetcher('/api/products/product/quotation-packaging-draft',{method:'POST'});throw Error('포장 저장 확인 실패');};
 const first=await h.run(['quotation']);assert.equal(first.stages[0].status,'failed');
 const retry=await h.run(['quotation']);assert.equal(retry.stages[0].status,'blocked');assert.equal(count,1);
});

function pendingQuotationFixture(){
 const h=fixture(),jobId='99999999-9999-4999-8999-999999999999';
 const view={revision:1,inputFingerprint:hash,productVersion:version,contentRevision:3,optionRevision:1,overrides:{common:{},options:{}},
  categoryContext:{profileId:null,categoryId:'68183',categoryPath:['합성']},resolved:{rows:[{optionId:'a',included:true,fields:{}}],schema:{fields:[],status:'observed',categoryId:'68183',categoryPath:['합성']}}};
 const job={id:jobId,status:'running',fingerprint:hash,quotationRevision:1,profileId:null,scope:{optionId:null,applyToAllOptions:true},model:quotationModel,result:null,error:null};
 const state={configuration:plain(quotationConfiguration),fingerprint:hash,productId:'product',productVersion:version,contentRevision:3,optionRevision:1,quotationRevision:1,profileId:null,jobs:[]};
 let returned=[job],lost=false;
 h.intercept(call=>{
  if(call.url==='/api/products/product/quotation-fields')return Response.json(view);
  if(call.url==='/api/products/product/quotation-ai'){
   if(call.method==='POST'){if(lost)throw Error('synthetic lost original generation ACK');return Response.json({job});}
   return Response.json(state);
  }
  if(call.url==='/api/products/product/quotation-ai?jobId='+jobId)return Response.json({...state,jobs:returned});
  if(call.url==='/api/products/product/quotation-ai?idempotencyKey=11111111-1111-4111-8111-111111111111')return Response.json({...state,idempotencyKey:'11111111-1111-4111-8111-111111111111',jobs:returned});
 });
 return{...h,job,view,state,jobId,returned:value=>returned=value,loseAck:()=>lost=true,
  complete(){job.status='completed';job.result={changes:[],warnings:[],model:quotationModel,generatedAt:version};}};
}

test('quotation generation rejected before dispatch keeps its original UUID and can explicitly resume once with real reviewed save guards',async()=>{
 const h=knownQuotationFixture({generateFirst:true});let rejected=false,allocated=0;
 h.options.newKey=()=>{allocated++;return '11111111-1111-4111-8111-111111111111';};
 h.prependIntercept(call=>{
  if(call.url==='/api/supplier-hub/catalog-context'&&!rejected&&h.keys.get('owner:product:pending:quotation')==='견적서 AI 실행 결과 확인 필요'){
   rejected=true;return Response.json({error:'isolated quotation preflight unavailable'},{status:503});
  }
 });
 const first=await h.run(['quotation']);assert.equal(first.stages[0].status,'failed');assert.equal(rejected,true);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,0);assert.equal(h.writes.length,0);
 const requestKey=h.keys.get('owner:product:quote:'+hash);assert.equal(requestKey,'11111111-1111-4111-8111-111111111111');assert.equal(allocated,1);
 assert.equal(h.keys.has('owner:product:pending:quotation'),false);assert.ok(h.keys.get('owner:product:quotation-generation-readback-v1'),'retain original proof even when preflight sends nothing');assert.equal(JSON.parse(h.keys.get('owner:product:quotation-generation-readback-v1')).jobId,null);
 const result=await h.run(['quotation']);assert.equal(result.stages[0].status,'draft',result.stages[0].message);
 const generated=h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST');assert.equal(generated.length,1);assert.equal(generated[0].body.idempotencyKey,requestKey);assert.equal(allocated,1);
 assert.equal(h.writes.length,1);assert.ok(h.writes[0].changes.some(change=>change.optionId==='a'&&change.fieldKey==='notice3'&&change.value==='검토 재질'));
 assert.equal(h.writes[0].changes.some(change=>change.optionId==='b'&&change.fieldKey==='notice0'),false);assert.equal(h.view.resolved.rows[1].fields.notice0.value,'');
 assert.equal(h.calls.filter(call=>call.adapter==='packaging').length,1);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
});

function lostQuotationAckFixture(mode='lost'){
 const h=knownQuotationFixture({generateFirst:true}),configuration=plain(quotationConfiguration);
 const state={configuration,fingerprint:hash,productId:'product',productVersion:version,contentRevision:3,optionRevision:2,quotationRevision:1,profileId:null,
  knownChanges:providedOptionModule('app/quotation-known-notice-proposals.ts').quotationKnownNoticeProposals('product',h.view,h.content,{optionId:null,applyToAllOptions:true},h.savedOptions,h.savedLabels),jobs:[h.job]};
 let lookup=()=>Response.json({...state,idempotencyKey:'11111111-1111-4111-8111-111111111111'});
 h.prependIntercept(call=>{
  if(call.url.endsWith('/quotation-ai')&&call.method==='GET')return Response.json({...state,jobs:[]});
  if(call.url.endsWith('/quotation-ai')&&call.method==='POST'){
   if(mode==='lost')throw Error('isolated generation ACK lost');
   if(mode==='non2xx')return Response.json({error:'isolated generation service unavailable'},{status:503});
   if(mode==='non-json')return new Response('isolated proxy response',{status:502});
   return Response.json({job:null});
  }
  if(call.url.includes('/quotation-ai?idempotencyKey='))return lookup(call);
 });
 return{...h,state,configuration,lookup:callback=>lookup=callback};
}

test('lost, malformed or non-2xx quotation generation ACK recovers only the original exact-key completed receipt and reviewed CAS save',async()=>{
 for(const mode of ['lost','malformed','non2xx','non-json']){
  const h=lostQuotationAckFixture(mode);await h.run(['quotation']);
  assert.ok(h.keys.get('owner:product:quotation-generation-readback-v1'),'retain request proof before dispatch: '+mode);
  const proof=JSON.parse(h.keys.get('owner:product:quotation-generation-readback-v1')),before=h.calls.length;
  assert.equal(proof.requestKey,'11111111-1111-4111-8111-111111111111',mode);assert.equal(proof.jobId,null,mode);
  assert.equal(proof.model,quotationModel,mode);assert.equal(proof.executionPolicy,null,mode);assert.deepEqual(proof.scope,{optionId:null,applyToAllOptions:true},mode);
  assert.equal(proof.ownerId,'owner');assert.equal(proof.productId,'product');assert.deepEqual(proof.company,{code:'A01526306',name:'유앤채'});
  assert.equal(proof.fingerprint,hash);assert.equal(proof.productVersion,version);assert.equal(proof.contentRevision,3);assert.equal(proof.optionRevision,2);assert.equal(proof.quotationRevision,1);assert.equal(proof.profileId,null);
  const result=await h.run(['quotation']),retry=h.calls.slice(before);assert.equal(result.stages[0].status,'draft',mode+': '+result.stages[0].message);
  assert.deepEqual(retry.filter(call=>call.url?.includes('/quotation-ai')).map(call=>[call.method,call.url]),[['GET','/api/products/product/quotation-ai?idempotencyKey='+proof.requestKey]],mode);
  assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,1,mode);assert.equal(h.writes.length,1,mode);
  assert.deepEqual(h.writes[0],{expectedRevision:1,expectedInputFingerprint:hash,changes:[{optionId:'a',fieldKey:'notice3',value:'검토 재질'},
   {optionId:'a',fieldKey:'notice0',value:'제조자: 저장 제조사 / 수입자: 저장 수입사'},{optionId:'a',fieldKey:'notice1',value:'02-1234-5678'},{optionId:'b',fieldKey:'notice1',value:'02-1234-5678'}]},mode);
  assert.equal(h.view.resolved.rows[1].fields.notice0.value,'',mode);assert.equal(h.calls.filter(call=>call.adapter==='packaging').length,1,mode);
  assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false,mode);
 }
});

test('exact-key quotation recovery retains and checks the configured Qwen execution policy before the generation ACK',async()=>{
 const h=lostQuotationAckFixture(),policy={version:1,model:'@cf/qwen/qwen3-30b-a3b-fp8',protocol:'qwen-chat-json-v1',maxOutputTokens:4096,textMaxOutputTokens:8000,enableGate:'legacy-quotation-free-only-v1',budget:'shared-utc-40-v1'};
 Object.assign(h.configuration,{model:policy.model,executionPolicy:policy});Object.assign(h.job,{model:policy.model,executionPolicy:policy});h.job.result.model=policy.model;
 await h.run(['quotation']);const proof=JSON.parse(h.keys.get('owner:product:quotation-generation-readback-v1'));
 assert.deepEqual(proof.executionPolicy,policy);assert.equal(proof.model,policy.model);assert.equal(proof.jobId,null);
 const result=await h.run(['quotation']);assert.equal(result.stages[0].status,'draft',result.stages[0].message);assert.equal(h.writes.length,1);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,1);
});

test('unconfirmed exact-key quotation readbacks retain the original fence and never generate, save or package',async()=>{
 for(const mode of ['missing','duplicate','extra-job','wrong-key','missing-key','non2xx','malformed','prepared','running','uncertain','fingerprint','revision','profile','scope','model','policy','source','content','options','settings-model','settings-policy','settings-disabled']){
  const h=lostQuotationAckFixture();await h.run(['quotation']);h.options.retryFailedQuotation=true;const retained=h.keys.get('owner:product:quotation-generation-readback-v1');
  const result={...plain(h.state),idempotencyKey:'11111111-1111-4111-8111-111111111111'};
  if(mode==='missing')result.jobs=[];if(mode==='duplicate')result.jobs.push(result.jobs[0]);if(mode==='extra-job')result.jobs.push({...result.jobs[0],id:'88888888-8888-4888-8888-888888888888'});
  if(mode==='wrong-key')result.idempotencyKey='88888888-8888-4888-8888-888888888888';if(mode==='missing-key')delete result.idempotencyKey;
  if(['prepared','running','uncertain'].includes(mode)){result.jobs[0].status=mode;result.jobs[0].result=null;}
  if(mode==='fingerprint')result.jobs[0].fingerprint='b'.repeat(64);if(mode==='revision')result.jobs[0].quotationRevision++;
  if(mode==='profile')result.jobs[0].profileId='other';if(mode==='scope')result.jobs[0].scope={optionId:'a',applyToAllOptions:false};
  if(mode==='model')result.jobs[0].model='other-model';if(mode==='policy')result.jobs[0].executionPolicy={unexpected:true};
  if(mode==='source'){result.productVersion='2026-10-24T00:00:00.000Z';h.view.productVersion=result.productVersion;}
  if(mode==='content'){result.contentRevision++;h.view.contentRevision++;}if(mode==='options'){result.optionRevision++;h.view.optionRevision++;}
  if(mode==='settings-model')result.configuration.model='changed-model';if(mode==='settings-policy')result.configuration.executionPolicy={unexpected:true};
  if(mode==='settings-disabled')result.configuration.configured=false;
  h.lookup(()=>mode==='non2xx'?Response.json({error:'isolated lookup failure'},{status:503}):mode==='malformed'?Response.json({idempotencyKey:result.idempotencyKey,jobs:null}):Response.json(result));
  const before=h.calls.length;await h.run(['quotation']);const retry=h.calls.slice(before);
  assert.equal(retry.filter(call=>call.url?.includes('/quotation-ai')).length,1,mode);assert.equal(retry.some(call=>call.method==='POST'||call.method==='PUT'),false,mode);
  assert.equal(h.keys.get('owner:product:quotation-generation-readback-v1'),retained,mode);assert.equal(h.keys.get('owner:product:pending:quotation'),'견적서 AI 실행 결과 확인 필요',mode);
  assert.equal(h.writes.length,0,mode);assert.equal(h.calls.some(call=>call.adapter==='packaging'),false,mode);
 }
});

test('explicit quotation retry reads only the acknowledged original job and resumes a delayed completed draft without another generation',async()=>{
 const h=pendingQuotationFixture();assert.equal((await h.run(['quotation'])).stages[0].status,'blocked');
 const before=h.calls.length;h.complete();const result=await h.run(['quotation']),retry=h.calls.slice(before);
 assert.equal(result.stages[0].status,'draft',result.stages[0].message);
 assert.deepEqual(retry.filter(call=>call.url?.includes('/quotation-ai')).map(call=>[call.method,call.url]),[['GET','/api/products/product/quotation-ai?jobId='+h.jobId]]);
 assert.equal(retry.some(call=>call.method==='POST'||call.method==='PUT'),false);assert.equal(h.calls.filter(call=>call.adapter==='packaging').length,1);
 assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
});

test('retained v1 acknowledged quotation jobs remain recoverable after the request-proof format update',async()=>{
 const h=pendingQuotationFixture();await h.run(['quotation']);
 const key='owner:product:quotation-generation-readback-v1',proof=JSON.parse(h.keys.get(key));
 proof.format='selected-quotation-generation-v1';delete proof.scope;h.keys.set(key,JSON.stringify(proof));h.complete();
 const before=h.calls.length,result=await h.run(['quotation']);assert.equal(result.stages[0].status,'draft',result.stages[0].message);
 assert.deepEqual(h.calls.slice(before).filter(call=>call.url?.includes('/quotation-ai')).map(call=>[call.method,call.url]),[['GET','/api/products/product/quotation-ai?jobId='+h.jobId]]);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,1);
});

test('a delayed original quotation result uses the real proposal guards and saves its reviewed fields once while preserving manual blanks',async()=>{
 const h=knownQuotationFixture({generateFirst:true}),jobId='99999999-9999-4999-8999-999999999999',completed=plain(h.job.result);
 Object.assign(h.job,{id:jobId,status:'running',result:null,error:null});
 h.prependIntercept(call=>{
  if(call.url==='/api/products/product/quotation-ai'&&call.method==='POST')return Response.json({job:h.job,sourceCurrent:true});
  if(call.url==='/api/products/product/quotation-ai?jobId='+jobId)return Response.json({configuration:quotationConfiguration,fingerprint:hash,
   productId:'product',productVersion:version,contentRevision:3,optionRevision:2,quotationRevision:1,profileId:null,jobs:[h.job],
   knownChanges:providedOptionModule('app/quotation-known-notice-proposals.ts').quotationKnownNoticeProposals('product',h.view,h.content,{optionId:null,applyToAllOptions:true},h.savedOptions,h.savedLabels)});
 });
 assert.equal((await h.run(['quotation'])).stages[0].status,'blocked');assert.equal(h.writes.length,0);
 Object.assign(h.job,{status:'completed',result:completed});const before=h.calls.length,result=await h.run(['quotation']),retry=h.calls.slice(before);
 assert.equal(result.stages[0].status,'draft',result.stages[0].message);assert.equal(h.writes.length,1);
 assert.deepEqual(h.writes[0].changes,[{optionId:'a',fieldKey:'notice3',value:'검토 재질'},{optionId:'a',fieldKey:'notice0',value:'제조자: 저장 제조사 / 수입자: 저장 수입사'},
  {optionId:'a',fieldKey:'notice1',value:'02-1234-5678'},{optionId:'b',fieldKey:'notice1',value:'02-1234-5678'}]);
 assert.equal(h.writes[0].expectedRevision,1);assert.equal(h.writes[0].expectedInputFingerprint,hash);assert.equal(h.view.resolved.rows[1].fields.notice0.value,'');
 assert.equal(retry.some(call=>call.method==='POST'),false);assert.equal(retry.filter(call=>call.method==='PUT').length,1);
 assert.equal(retry.filter(call=>call.url?.includes('/quotation-ai')).length,1);assert.equal(h.calls.filter(call=>call.adapter==='packaging').length,1);
 assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
});

test('pending quotation running, missing, uncertain or mismatched job readback preserves its fence and never starts another generation',async()=>{
 for(const mode of ['running','missing','uncertain','wrong-job','duplicate','wrong-fingerprint','wrong-revision','wrong-scope','wrong-model','wrong-policy','changed-source','changed-settings']){
  const h=pendingQuotationFixture();await h.run(['quotation']);h.complete();
  if(mode==='running'){h.job.status='running';h.job.result=null;}if(mode==='uncertain'){h.job.status='uncertain';h.job.result=null;}
  if(mode==='missing')h.returned([]);if(mode==='wrong-job')h.returned([{...h.job,id:'88888888-8888-4888-8888-888888888888'}]);if(mode==='duplicate')h.returned([h.job,h.job]);
  if(mode==='wrong-fingerprint')h.job.fingerprint='b'.repeat(64);if(mode==='wrong-revision')h.job.quotationRevision++;
  if(mode==='wrong-scope')h.job.scope={optionId:'a',applyToAllOptions:false};if(mode==='wrong-model')h.job.model='changed-model';
  if(mode==='wrong-policy')h.job.executionPolicy={unexpected:'changed-policy'};
  if(mode==='changed-source'){h.state.productVersion='2026-10-24T00:00:00.000Z';h.view.productVersion=h.state.productVersion;}
  if(mode==='changed-settings')h.state.fingerprint='b'.repeat(64);
  const before=h.calls.length,result=await h.run(['quotation']),retry=h.calls.slice(before);
  assert.equal(result.stages[0].status,'blocked',mode);assert.equal(retry.some(call=>call.method==='POST'||call.method==='PUT'),false,mode);
  assert.equal(h.calls.some(call=>call.adapter==='packaging'),false,mode);assert.equal(h.keys.get('owner:product:pending:quotation'),'견적서 AI 실행 결과 확인 필요',mode);
 }
});

test('invalid retained quotation identity and unknown field-save fence cannot guess a job or reopen generation',async()=>{
 for(const mode of ['wrong-owner','wrong-company','different-request-key','unknown-save']){
  const h=pendingQuotationFixture();await h.run(['quotation']);h.complete();
  const key='owner:product:quotation-generation-readback-v1';
  if(mode==='wrong-owner'||mode==='wrong-company'){const value=JSON.parse(h.keys.get(key));if(mode==='wrong-owner')value.ownerId='other';else value.company={code:'A01464742',name:'와이홉'};h.keys.set(key,JSON.stringify(value));}
  if(mode==='different-request-key')h.keys.set('owner:product:quote:'+hash,'88888888-8888-4888-8888-888888888888');
  if(mode==='unknown-save')h.keys.set('owner:product:pending:quotation','저장 결과 확인 필요');
  const before=h.calls.length,result=await h.run(['quotation']),retry=h.calls.slice(before);
  assert.equal(result.stages[0].status,'blocked',mode);assert.equal(retry.some(call=>call.url?.includes('/quotation-ai')||call.method==='POST'||call.method==='PUT'),false,mode);
  assert.equal(h.calls.filter(call=>call.url==='/api/products/product/quotation-ai'&&call.method==='POST').length,1,mode);
 }
});

test('a saved board completion cannot bypass pending original quotation readback, while account changes and abort still stop it',async()=>{
 const h=pendingQuotationFixture();await h.run(['quotation']);h.complete();h.options.mode='full';
 h.prependIntercept(call=>call.url==='/api/products/product'?Response.json({product:{id:'product',owner_id:'owner',title:'검증 상품',updated_at:version,content_summary:savedSummary(['quotation'])}}):null);
 const before=h.calls.length;assert.equal((await h.run(['quotation'])).stages[0].status,'draft');assert.ok(h.calls.slice(before).some(call=>call.url?.includes('/quotation-ai?jobId=')));
 const changed=pendingQuotationFixture();await changed.run(['quotation']);const count=changed.calls.length;changed.company({code:'A01464742',name:'와이홉'});
 await assert.rejects(changed.run(['quotation']),/회사/);assert.equal(changed.calls.slice(count).some(call=>call.url?.includes('/quotation-ai')),false);
 const stopped=pendingQuotationFixture();await stopped.run(['quotation']);const calls=stopped.calls.length;stopped.controller.abort();assert.equal(await stopped.run(['quotation']),null);assert.equal(stopped.calls.length,calls);
});

test('packaging preflight rejection releases only confirmed fences so an explicit later retry can run',async()=>{
 const h=fixture();let count=0;
 h.deps['@/app/batch-selected-packaging-work'].runSelectedPackagingWork=async(_id,options)=>{
  count++;await options.assertCurrent();if(count===1)throw Error('포장 초안 입력 검증 실패: 요청 전');
  await options.fetcher('/api/products/product/quotation-packaging-draft',{method:'POST'});
  return{view:options.view,status:'unchanged',remaining:0,message:'포장 초안 확인'};
 };
 const first=await h.run(['quotation']);assert.equal(first.stages[0].status,'failed');assert.match(first.stages[0].message,/요청 전/);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-packaging-draft')).length,0);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
 const next=await h.run(['quotation']);assert.equal(next.stages[0].status,'draft');assert.equal(count,2);assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-packaging-draft')).length,1);
});

test('the final account preflight failing inside packaging fetch does not count as mutation dispatch',async()=>{
 const h=fixture();let count=0;
 h.deps['@/app/batch-selected-packaging-work'].runSelectedPackagingWork=async(_id,options)=>{
  count++;if(count===1)h.owner('changed-owner');
  await options.fetcher('/api/products/product/quotation-packaging-draft',{method:'POST'});
  return{view:options.view,status:'unchanged',remaining:0,message:'포장 확인'};
 };
 const stopped=await h.run(['quotation']);assert.equal(stopped.stages[0].status,'failed');assert.match(stopped.stages[0].message,/계정|회사/);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-packaging-draft')).length,0);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
 h.owner('owner');const next=await h.run(['quotation']);assert.equal(next.stages[0].status,'draft');assert.equal(count,2);assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-packaging-draft')).length,1);
});

test('a completed image recovery clears the cross-role inference fence before continuing selected image work',async()=>{
 const h=fixture();h.image({status:'partial',inferencePending:true,messages:['원래 요청 미확정']});await h.run(['mainImage','additionalImages']);
 h.image({status:'completed',messages:['원래 번역 결과 저장 확인']});const resumed=await h.run(['mainImage','additionalImages','detailImage']);
 assert.deepEqual(resumed.stages.map(row=>row.status),['draft','draft','draft']);assert.equal(h.keys.has('owner:product:vision-inference-pending'),false);
 assert.deepEqual(h.calls.filter(call=>call.adapter==='image').map(call=>call.stage),['main','main','additional','detail']);
});

test('cancelling an unknown raw detail Vision request fences same-queue main and additional calls until exact status recovery',async()=>{
 const h=fixture(),detail=await actualDetailFixture(),ErrorClass=detail.base.load('app/free-image-vision-error.ts').FreeImageVisionError;let inferenceCalls=0,statusReads=0,original;
 h.company({code:'A01464742',name:'와이홉'});detail.f.view.productVersion=version;
 detail.deps.recognize=async image=>{inferenceCalls++;original={requestId:'11111111-1111-4111-8111-111111111111',source:image.source,sourceLanguage:'zh',configuration:detail.configuration,inspectionPolicy:detail.vision.IMAGE_TEXT_INSPECTION_POLICY};h.controller.abort(Error('detail closed after dispatch'));throw new ErrorClass('unknown detail response','IMAGE_VISION_ACK_MISSING',true,original);};
 detail.deps.observe=async attempt=>{statusReads++;assert.deepEqual(plain(attempt),plain(original));return{format:'yoofam-image-vision-status-v1',requestId:original.requestId,source:original.source,configuration:original.configuration,sourceLanguage:'zh',status:'failed',result:null,failure:'HTTP_ERROR',execution:{requests:0},readOnly:true};};
 h.deps['@/app/batch-selected-detail-work'].createSelectedDetailWorkState=detail.model.createSelectedDetailWorkState;
 h.deps['@/app/batch-selected-detail-work'].processSelectedDetailWork=(id,options)=>detail.model.processSelectedDetailWork(id,{...detail.options,...options,fetcher:detail.options.fetcher},detail.deps);
 assert.equal(await h.run(['detailImage']),null);assert.equal(inferenceCalls,1);assert.equal(h.keys.get('owner:product:vision-inference-pending'),'owner:product:detailImage');
 h.options.signal=new AbortController().signal;const before=h.calls.length,blocked=await h.run(['mainImage','additionalImages']);
 assert.deepEqual(blocked.stages.map(row=>row.status),['blocked','blocked']);assert.equal(h.calls.slice(before).some(call=>call.adapter==='image'||call.url?.endsWith('/work-draft')),false);assert.equal(inferenceCalls,1);assert.equal(statusReads,0);
 const recovered=await h.run(['detailImage']);assert.equal(recovered.stages[0].status,'blocked');assert.equal(statusReads,1);assert.equal(inferenceCalls,1);assert.equal(h.keys.has('owner:product:vision-inference-pending'),false);
 await h.run(['mainImage','additionalImages']);assert.deepEqual(h.calls.filter(call=>call.adapter==='image').map(call=>call.stage),['main','additional']);
});

test('a detail exception preserves another original inference fence and pending detail is restored after that fence clears',async()=>{
 const h=fixture(),latch='owner:product:vision-inference-pending';
 h.deps['@/app/batch-selected-detail-work'].processSelectedDetailWork=async(_id,options)=>{options.state.inference={photoId:'retained-photo',attempt:{requestId:'11111111-1111-4111-8111-111111111111'}};h.keys.set(latch,'owner:product:mainImage');throw Error('detail status transport failed');};
 assert.equal((await h.run(['detailImage'])).stages[0].status,'failed');assert.equal(h.keys.get(latch),'owner:product:mainImage');
 h.keys.delete(latch);const before=h.calls.length,result=await h.run(['additionalImages']);assert.equal(result.stages[0].status,'blocked');assert.equal(h.keys.get(latch),'owner:product:detailImage');assert.equal(h.calls.slice(before).some(call=>call.adapter==='image'||call.url?.endsWith('/work-draft')),false);
});

test('non-quotation partial work never invokes packaging generation',async()=>{
 const h=fixture();await h.run(['pricing','koreanLabel']);assert.equal(h.calls.some(call=>call.adapter==='packaging'),false);
});
test('stale or foreign saved label content blocks the combined quotation write',async()=>{
 for(const mutate of [content=>{content.revision=4;},content=>{content.productId='other';}]){
  const h=knownQuotationFixture();mutate(h.content);const result=await h.run(['quotation']);assert.equal(result.stages[0].status,'failed');assert.equal(h.writes.length,0);
 }
});
test('company changes or cancellation after reading known sources prevent their quotation write',async()=>{
 const h=knownQuotationFixture();h.onContent(()=>h.company({code:'A01464742',name:'와이홉'}));
 assert.equal((await h.run(['quotation'])).stages[0].status,'failed');assert.equal(h.writes.length,0);
 const stopped=knownQuotationFixture();stopped.onContent(()=>stopped.controller.abort());assert.equal(await stopped.run(['quotation']),null);assert.equal(stopped.writes.length,0);
});
test('protected manufacturer/contact AI claims still fail before any saved-source copy',async()=>{
 for(const fieldKey of ['notice0','notice1','notice2']){
  const h=knownQuotationFixture();h.job.result.changes=[{optionId:'a',fieldKey,value:'AI 주장'}];
  assert.equal((await h.run(['quotation'])).stages[0].status,'failed');assert.equal(h.writes.length,0);assert.equal(h.calls.some(call=>call.url?.endsWith('/content')),false);
 }
});
test('lost, rejected or false-positive quotation save cannot resend known-source changes on retry',async()=>{
 for(const response of [()=>{throw Error('lost ACK');},()=>Response.json({error:'changed'},{status:409}),()=>Response.json({revision:2})]){
  const h=knownQuotationFixture();h.saveResponse(response);const first=await h.run(['quotation']);assert.equal(first.stages[0].status,'failed');assert.equal(h.writes.length,1);
  const retry=await h.run(['quotation']);assert.equal(retry.stages[0].status,'blocked');assert.equal(h.writes.length,1);
 }
});

function seoFixture(outcome={job:{id:'seo-job',status:'completed',result:{}},closed:true,partial:false,message:'번역됨'}){
 const h=fixture();
 h.deps['@/app/collected-translation-attributes'].collectedTranslationAttributes=()=>[];
 h.deps['@/app/option-translation'].optionTranslationBatch=()=>({total:2,remaining:0,attributes:[]});
 h.deps['@/app/sourcing'].collectionSourceReference=()=> 'saved-source';
 Object.assign(h.deps['@/app/seo-workspace-draft'],{createSeoWorkspaceDraftState:input=>input,parseSeoWorkspaceDraftState:JSON.parse,
  seoWorkspaceDraftMatches:(state,input)=>['productId','productVersion','contentRevision','source','memo','configuration'].every(key=>JSON.stringify(state[key])===JSON.stringify(input[key])),
  runSeoWorkspaceDraft:async()=>outcome});
 const nextVersion='2026-10-23T00:00:01.000Z';
 h.intercept(call=>{
  if(call.url.endsWith('/translation'))return Response.json({configuration:{configured:true,model:'google'},jobs:[]});
  if(call.url.endsWith('/content'))return Response.json({content:{schemaVersion:1,productId:'product',revision:3,label:{},assets:{size:{value:[]}},seo:{title:{value:'原名',provenance:'collected'},keywords:{value:[],provenance:'collected'},description:{value:'原文',provenance:'collected'}}}});
  if(call.url.endsWith('/translation-source'))return Response.json({productId:'product',productVersion:version,jobId:'source',sourceUrl:'https://detail.1688.com/offer/886034098637.html',title:'原名',description:'原文',attributes:[],requestContext:{categoryId:'68183',categoryPath:['깔창','쿠션패드'],features:'',keywords:''}});
  if(call.url.endsWith('/options'))return Response.json({options:{productId:'product',revision:2},productVersion:version});
  if(call.url.endsWith('/registration-settings'))return Response.json({productId:'product',settings:{brand:'유앤채'}});
  if(call.url.endsWith('/translation-apply'))return Response.json(call.body.action==='preview'
   ?{productId:'product',productVersion:version,contentRevision:3,optionRevision:2,fingerprint:hash,preview:[{field:'title'}]}
   :{productId:'product',productVersion:nextVersion,contentRevision:4,optionRevision:3,applied:1});
 });
 return h;
}

function withSeoGeneration(h){
 const configuration={configured:true,model:'@cf/meta/llama-3.3-70b-instruct-fp8-fast',maxOutputTokens:2048,freeOnly:true,destination:'Cloudflare Workers AI',issues:[],notice:'Cloudflare Workers AI · 기존 견적 AI와 공유하는 일일 무료 한도 · 자동 유료 전환 없음'};
 const generation={view:{purpose:'seo-generation',productId:'product',productVersion:version,contentRevision:3,optionRevision:2,sourceFingerprint:'c'.repeat(64),company:{code:'A01526306',name:'유앤채'},configuration,memo:{brand:'브랜드',features:'특징',keywords:'검색어'},source:{title:'原名',description:'原文',attributes:[],provenance:'manual',reference:'source'},jobs:[]},outcome:{job:{id:'generated-seo-job',status:'completed',result:{draft:{title:'생성 상품명',keywords:['검색어'],description:'생성 설명',attributes:[],warnings:[]}}},closed:true,message:'AI SEO 생성 완료'}};
 h.options.seoGenerationConsent=plain(configuration);
 Object.assign(h.deps['@/app/seo-workspace-draft'],{
  readSeoGenerationContext:async()=>plain(generation.view),createSeoGenerationDraftState:view=>({...plain(view),idempotencyKey:'generation-key',executeSubmitted:false}),parseSeoGenerationDraftState:JSON.parse,
  runSeoGenerationDraft:async(state,controls)=>{h.calls.push({adapter:'seo-generation',confirmAi:controls.confirmAi,productVersion:state.productVersion});state.executeSubmitted=true;controls.onState(state);return generation.outcome;},
 });
 h.prependIntercept(call=>{
  if(!call.url.endsWith('/seo-generation')||call.method!=='POST')return;
  if(call.body.action==='preview')return Response.json({purpose:'seo-generation',scope:'all',productId:'product',productVersion:generation.view.productVersion,contentRevision:3,optionRevision:2,fingerprint:'d'.repeat(64),preview:[{name:'상품명',before:'',after:'생성 상품명'}],skipped:[]});
  if(call.body.action==='apply')return Response.json({purpose:'seo-generation',scope:'all',productId:'product',productVersion:new Date(Date.parse(generation.view.productVersion)+2).toISOString(),contentRevision:4,optionRevision:3,applied:1});
 });
 return generation;
}

function qwenFixture(outcome={job:{id:'qwen-job',status:'completed',result:{draft:{title:'Qwen 상품명',keywords:['검색어'],description:'Qwen 설명',attributes:[],warnings:[]}}},closed:true,partial:false,message:'Qwen 확인 완료'}){
 const h=seoFixture(outcome),generation=withSeoGeneration(h),translationConfig={configured:true,provider:'workers-ai',model:'@cf/qwen/qwen3-30b-a3b-fp8',maxOutputTokens:4096,freeOnly:false,destination:'Cloudflare Workers AI',issues:[],notice:'Qwen 실제 상품·옵션 원문 1회 전송, 사용량에 따른 유료 비용 발생 가능'};
 generation.view.configuration.translationConfig=plain(translationConfig);generation.view.source.attributes=[{name:'상품속성: 材质',value:'棉'}];h.options.seoGenerationConsent=plain(generation.view.configuration);
 const optionAttributes=[{name:'option:sku-a',value:'白色'},{name:'option-color:sku-a',value:'白色'}];
 h.deps['@/app/option-translation'].optionTranslationBatch=(options,capacity)=>{assert.equal(capacity,49);return{total:2,remaining:0,attributes:plain(optionAttributes)};};
 Object.assign(h.deps['@/app/seo-workspace-draft'],{createSeoWorkspaceDraftState:input=>input,runSeoWorkspaceDraft:async(state,controls)=>{h.calls.push({adapter:'qwen-translation',state:plain(state),confirmAi:controls.confirmAi});controls.onState(state);return outcome;}});
 h.prependIntercept(call=>{
  if(call.url.endsWith('/translation'))return Response.json({configuration:{configured:true,model:translationConfig.model,maxOutputTokens:translationConfig.maxOutputTokens,issues:[]},jobs:[]});
  if(call.url.endsWith('/translation-apply'))return Response.json(call.body.action==='preview'?{scope:'all',productId:'product',productVersion:version,contentRevision:3,optionRevision:2,fingerprint:hash,preview:[{field:'title'},{field:'option'}]}:{scope:'all',productId:'product',productVersion:'2026-10-23T00:00:01.000Z',contentRevision:4,optionRevision:3,applied:2});
 });
 return{h,generation,translationConfig,optionAttributes};
}

function qwenRetryFixture(){
 const {h,generation}=qwenFixture();let creates=0,providerCalls=0,status='failed',reads=0;const provider=h.deps['@/app/seo-workspace-draft'];
 provider.createSeoWorkspaceDraftState=input=>({...plain(input),idempotencyKey:'new-key-'+ ++creates,jobId:null});
 provider.runSeoWorkspaceDraft=async(state,controls)=>{if(!state.jobId){providerCalls++;state.jobId='job-'+providerCalls;}controls.onState(state);return{job:{id:state.jobId,status:'failed',result:null},closed:true,partial:false,message:'확인된 실패'};};
 provider.refreshSeoWorkspaceDraft=async(state,controls)=>{reads++;controls.onState(state);return{job:{id:state.jobId,status,result:null},closed:['failed','completed'].includes(status),partial:false,message:'같은 요청 조회'};};
 return{h,generation,status:value=>status=value,get creates(){return creates;},get providerCalls(){return providerCalls;},get reads(){return reads;}};
}

// Use both real SEO state engines, with only the local server transport faked.
// No translation service, supplier product, DB or Hub endpoint is contacted.
function actualSeoFixture(kind='qwen'){
 const base=kind==='qwen'?qwenFixture():{h:seoFixture()},h=base.h,generation=base.generation??withSeoGeneration(h);
 const actual=providedOptionModule('app/seo-workspace-draft.ts'),translation=providedOptionModule('app/automation/translation.ts'),server=providedOptionModule('app/seo-generation.ts');
 const configuration=kind==='qwen'?{configured:true,model:translation.WORKERS_QWEN_MODEL,maxOutputTokens:4096}:{configured:true,model:translation.GOOGLE_TEXT_MODEL,maxOutputTokens:0};
 Object.assign(h.deps['@/app/automation/translation'],{GOOGLE_TEXT_MODEL:translation.GOOGLE_TEXT_MODEL});
 generation.view.source.category={id:'68183',path:['깔창','쿠션패드']};
 if(kind!=='qwen')h.deps['@/app/option-translation'].optionTranslationBatch=()=>({total:kind==='llama'?0:1,remaining:0,attributes:kind==='llama'?[]:[{name:'option:sku-a',value:'白色'}]});
 if(kind==='google')delete h.options.seoGenerationConsent;
 const created=[],states=[];let job=null;
 const isGeneration=kind==='llama',stateFragment=isGeneration?':seo-generation:':kind==='qwen'?':seo-qwen:':':seo-options:';
 Object.assign(h.deps['@/app/seo-workspace-draft'],{
  parseSeoGenerationConfiguration:actual.parseSeoGenerationConfiguration,readSeoGenerationContext:actual.readSeoGenerationContext,
  parseSeoWorkspaceDraftState:actual.parseSeoWorkspaceDraftState,parseSeoGenerationDraftState:actual.parseSeoGenerationDraftState,
  seoWorkspaceDraftMatches:actual.seoWorkspaceDraftMatches,
  createSeoWorkspaceDraftState:input=>{const state=actual.createSeoWorkspaceDraftState(input);created.push(plain(state));return state;},
  createSeoGenerationDraftState:view=>{const state=actual.createSeoGenerationDraftState(view);created.push(plain(state));return state;},
  runSeoWorkspaceDraft:(state,controls)=>actual.runSeoWorkspaceDraft(state,{...controls,onState:value=>{states.push(plain(value));controls.onState(value);}}),
  refreshSeoWorkspaceDraft:(state,controls)=>actual.refreshSeoWorkspaceDraft(state,{...controls,onState:value=>{states.push(plain(value));controls.onState(value);}}),
  runSeoGenerationDraft:(state,controls)=>actual.runSeoGenerationDraft(state,{...controls,onState:value=>{states.push(plain(value));controls.onState(value);}}),
 });
 const stateEntry=()=>[...h.keys.entries()].find(([key])=>key.startsWith('owner:product'+stateFragment));
 h.prependIntercept(async call=>{
  const url=new URL(call.url,'https://local.test'),isTranslation=url.pathname.endsWith('/translation'),isSeo=url.pathname.endsWith('/seo-generation');
  if(!isTranslation&&!isSeo)return null;
  if(call.method==='GET'){
   if(isTranslation)return Response.json({configuration,jobs:job&&!isGeneration?[job]:[]});
   return Response.json({...plain(generation.view),jobs:job&&isGeneration?[job]:[],...(url.searchParams.has('idempotencyKey')?{idempotencyKey:url.searchParams.get('idempotencyKey')}:{})});
  }
  if(!['prepare','approve','execute'].includes(call.body.action))return null;
  if(call.body.action==='prepare'){
   const state=JSON.parse(stateEntry()[1]);
   const review=isGeneration?await server.prepareSeoGenerationReview(state.source,{purpose:'seo-generation',version:1,sourceFingerprint:state.sourceFingerprint,
    optionRevision:state.optionRevision,company:plain(state.company),memo:plain(state.memo)},state.configuration)
    :await translation.prepareTranslationReview(state.source,{...configuration,provider:kind==='qwen'?'workers-ai':'google-free',apiKey:''});
   job={id:'99999999-9999-4999-8999-999999999999',productId:'product',productVersion:version,contentRevision:3,status:'prepared',review,result:null,error:null};
  }else if(call.body.action==='approve')job={...job,status:'approved'};
  else job={...job,status:'completed',result:{model:isGeneration?generation.view.configuration.model:configuration.model,appliedToContent:false,provenance:'generated',
   draft:{title:'검토 상품명',keywords:['상품'],description:'원문 설명',attributes:isGeneration?[]:job.review.source.attributes.map((item,sourceIndex)=>({sourceIndex,
    name:item.name.startsWith('option-color:')?'색상':item.name.startsWith('option:')?'옵션명':'소재',value:item.name.startsWith('option')?(item.value==='白色'?'흰색':'하양'):'면'})),warnings:[]}}};
  return Response.json(isGeneration?{purpose:'seo-generation',productId:'product',productVersion:version,company:generation.view.company,sourceCurrent:true,job}:{job});
 });
 return{h,generation,created,states,stateEntry,actions:()=>h.calls.filter(call=>['prepare','approve','execute'].includes(call.body?.action)),state:()=>JSON.parse(stateEntry()[1])};
}

test('real Qwen, Google and legacy SEO engines restore only a pristine unsent prepare and reuse its exact UUID on an explicit later start',async()=>{
 for(const kind of ['qwen','google','llama']){
  const f=actualSeoFixture(kind),{h}=f;let rejected=false;
  h.prependIntercept(call=>{
   if(call.url==='/api/supplier-hub/catalog-context'&&!rejected&&f.stateEntry()&&f.state().prepareSubmitted){rejected=true;return Response.json({error:'isolated account preflight unavailable'},{status:503});}
  });
  const first=await h.run(['seo','pricing']);assert.equal(rejected,true,kind);assert.equal(f.actions().length,0,kind);
  assert.equal(first.stages[0].status,'blocked',kind);assert.equal(h.calls.some(call=>call.url.endsWith('/stage-two-pricing')),false,kind);
  assert.equal(f.created.length,1,kind);assert.deepEqual(f.state(),f.created[0],kind);assert.equal(h.keys.has('owner:product:pending:seo'),false,kind);
  const second=await h.run(['seo','pricing']);assert.equal(second.stages[0].status,kind==='google'?'blocked':'draft',kind+': '+second.stages[0].message);
  assert.equal(second.stages[1].status,'draft',kind);assert.equal(f.created.length,1,kind);assert.equal(f.state().idempotencyKey,f.created[0].idempotencyKey,kind);
  assert.deepEqual(f.actions().map(call=>call.body.action),['prepare','approve','execute'],kind);assert.equal(f.actions()[0].body.idempotencyKey,f.created[0].idempotencyKey,kind);
  assert.equal(h.keys.has('owner:product:pending:seo'),false,kind);
 }
});

test('real SEO dispatched prepare ACK loss and malformed ACKs remain fenced and cannot resend on a second start',async()=>{
 for(const kind of ['qwen','google','llama'])for(const mode of ['lost','malformed']){
  const f=actualSeoFixture(kind),{h}=f;
  h.prependIntercept(call=>{if(call.body?.action==='prepare'){if(mode==='lost')throw Error('isolated lost prepare ACK');return Response.json({job:{id:'malformed'}});}});
  const first=await h.run(['seo','pricing']);assert.ok(['blocked','failed'].includes(first.stages[0].status),kind+mode);
  assert.equal(f.actions().length,1,kind+mode);assert.equal(f.state().prepareSubmitted,true,kind+mode);assert.equal(h.keys.has('owner:product:pending:seo'),true,kind+mode);
  const before=h.calls.length,state=plain(f.state());assert.equal((await h.run(['seo','pricing'])).stages[0].status,'blocked',kind+mode);
  assert.equal(h.calls.length,before+1,kind+mode);assert.deepEqual(f.state(),state,kind+mode);assert.equal(f.actions().length,1,kind+mode);
 }
});

test('real completed Qwen survives a read-only preview error and explicit retry reuses its exact job without another provider call',async()=>{
 for(const mode of ['http','lost','malformed','preflight']){
  const f=actualSeoFixture('qwen'),{h}=f;let failed=false;
  h.prependIntercept(call=>{
   if(mode==='preflight'&&call.url==='/api/supplier-hub/catalog-context'&&!failed&&f.actions().filter(action=>action.body.action==='execute').length===1&&!h.keys.has('owner:product:pending:seo')){failed=true;return Response.json({error:'isolated preview account unavailable'},{status:503});}
   if(call.url.endsWith('/translation-apply')&&call.body.action==='preview'&&!failed){failed=true;if(mode==='lost')throw Error('isolated lost preview response');return mode==='malformed'?Response.json(null):Response.json({error:'isolated preview unavailable'},{status:503});}
  });
  const first=await h.run(['seo','pricing']),state=plain(f.state());assert.equal(failed,true,mode);assert.equal(first.stages[0].status,'failed',mode);assert.equal(first.stages[1].status,'blocked',mode);
  assert.deepEqual(f.actions().map(call=>call.body.action),['prepare','approve','execute'],mode);assert.equal(state.executeSubmitted,true,mode);assert.equal(f.created.length,1,mode);
  assert.equal(h.keys.has('owner:product:pending:seo'),false,mode);assert.equal(h.calls.some(call=>call.url?.endsWith('/stage-two-pricing')),false,mode);
  assert.equal(h.calls.some(call=>call.url?.endsWith('/translation-apply')&&call.body.action==='apply'),false,mode);
  const before=h.calls.length,second=await h.run(['seo','pricing']);assert.deepEqual(plain(second.stages.map(row=>row.status)),['draft','draft'],mode);
  assert.equal(f.created.length,1,mode);assert.deepEqual(f.state(),state,mode);assert.equal(f.actions().length,3,mode);
  const later=h.calls.slice(before),adoption=later.filter(call=>call.url?.endsWith('/translation-apply'));
  assert.deepEqual(adoption.map(call=>call.body.action),['preview','apply'],mode);assert.ok(adoption.every(call=>call.body.jobId===state.jobId),mode);
  assert.equal(later.some(call=>call.url?.endsWith('/translation')&&call.method==='GET'),true,mode);assert.equal(later.some(call=>call.url?.endsWith('/stage-two-pricing')),true,mode);
 }
});

test('completed Qwen preview recovery cannot release old uncertain writes or another stage pending marker',async()=>{
 for(const marker of ['seo','seo-qwen','seo-generation']){
  const f=actualSeoFixture('qwen'),{h}=f,key='owner:product:write:'+marker+':prior-unknown';h.keys.set(key,'submitted');
  const first=await h.run(['seo','pricing']);assert.equal(first.stages[0].status,'blocked',marker);assert.equal(h.keys.get(key),'submitted',marker);assert.equal(h.keys.has('owner:product:pending:seo'),true,marker);
  assert.equal(h.calls.some(call=>call.url?.endsWith('/translation-apply')||call.url?.endsWith('/stage-two-pricing')),false,marker);
  const before=h.calls.length,state=plain(f.state());await h.run(['seo','pricing']);assert.equal(h.calls.length,before+1,marker);assert.deepEqual(f.state(),state,marker);assert.equal(h.keys.get(key),'submitted',marker);
 }
 const f=actualSeoFixture('qwen'),{h}=f;h.keys.set('owner:product:pending:quotation','prior quotation outcome unknown');
 h.prependIntercept(call=>call.url.endsWith('/translation-apply')&&call.body.action==='preview'?Response.json({error:'isolated preview unavailable'},{status:503}):null);
 await h.run(['seo','pricing']);assert.equal(h.keys.has('owner:product:pending:seo'),false);assert.equal(h.keys.get('owner:product:pending:quotation'),'prior quotation outcome unknown');
});

test('explicit legacy Qwen recovery reads its completed job and removes only the old provider latch before preview and one apply',async()=>{
 const f=actualSeoFixture('qwen'),{h}=f;let fail=true;
 h.prependIntercept(call=>{if(fail&&call.url.endsWith('/translation-apply')&&call.body.action==='preview'){fail=false;return Response.json({error:'isolated old-deployment preview unavailable'},{status:503});}});
 await h.run(['seo','pricing']);const state=plain(f.state()),[stateKey]=f.stateEntry(),pointer=h.keys.get('owner:product:seo-qwen-current');
 // Exact valid state left by the previous deployment: terminal job known,
 // old provider pending still present, no content/apply write ever dispatched.
 h.keys.set('owner:product:pending:seo','Qwen 번역 결과 확인 필요');h.options.retryFailedQwen=true;
 const before=h.calls.length,result=await h.run(['seo','pricing']);assert.deepEqual(plain(result.stages.map(row=>row.status)),['draft','draft']);
 assert.equal(f.created.length,1);assert.deepEqual(f.state(),state);assert.equal(f.stateEntry()[0],stateKey);assert.equal(h.keys.get('owner:product:seo-qwen-current'),pointer);assert.equal(f.actions().length,3);
 const later=h.calls.slice(before);assert.equal(later.filter(call=>call.url?.endsWith('/translation')&&call.method==='GET').length,2,'history and exact read-only refresh');
 assert.equal(later.some(call=>['prepare','approve','execute'].includes(call.body?.action)),false);
 const adoption=later.filter(call=>call.url?.endsWith('/translation-apply'));assert.deepEqual(adoption.map(call=>call.body.action),['preview','apply']);assert.ok(adoption.every(call=>call.body.jobId===state.jobId));
 assert.equal(h.keys.has('owner:product:pending:seo'),false);assert.equal([...h.keys.keys()].some(key=>key.startsWith('owner:product:write:')),false);
});

test('legacy Qwen adoption recovery preserves uncertainty and never replaces or reapplies changed, partial or cancelled requests',async()=>{
 for(const mode of ['write','title','guidance','options','memo','config','partial','abort','company']){
  const f=actualSeoFixture('qwen'),{h}=f;let fail=true;
  h.prependIntercept(call=>{if(fail&&call.url.endsWith('/translation-apply')&&call.body.action==='preview'){fail=false;return Response.json({error:'isolated legacy preview unavailable'},{status:503});}});
  await h.run(['seo','pricing']);const state=plain(f.state()),stateKey=f.stateEntry()[0];h.keys.set('owner:product:pending:seo','Qwen 번역 결과 확인 필요');h.options.retryFailedQwen=true;
  const engine=h.deps['@/app/seo-workspace-draft'],refresh=engine.refreshSeoWorkspaceDraft;
  if(mode==='write')h.keys.set('owner:product:write:seo-qwen:old-unknown','submitted');
  if(mode==='title')f.generation.view.source.title+=' 改';if(mode==='guidance')f.generation.view.source.guidance={features:'새 특징',keywords:''};if(mode==='options')f.generation.view.optionRevision++;
  if(mode==='memo')f.generation.view.memo.features+=' 변경';if(mode==='config')h.prependIntercept(call=>call.url.endsWith('/translation')?Response.json({configuration:{configured:true,model:f.state().configuration.model,maxOutputTokens:8000},jobs:[]}):null);
  if(['partial','abort','company'].includes(mode))engine.refreshSeoWorkspaceDraft=async(state,controls)=>{const result=await refresh(state,controls);if(mode==='partial')return{...result,partial:true};if(mode==='abort')h.controller.abort();else h.company({code:'A01464742',name:'와이홉'});return result;};
  const before=h.calls.length;await h.run(['seo','pricing']);assert.equal(f.created.length,1,mode);assert.deepEqual(JSON.parse(h.keys.get(stateKey)),state,mode);assert.equal(f.actions().length,3,mode);
  assert.equal(h.keys.get('owner:product:pending:seo'),'Qwen 번역 결과 확인 필요',mode);assert.equal(h.calls.slice(before).some(call=>call.url?.endsWith('/translation-apply')||call.url?.endsWith('/stage-two-pricing')),false,mode);
  if(mode==='write')assert.equal(h.keys.get('owner:product:write:seo-qwen:old-unknown'),'submitted');
 }
});

test('completed Qwen preview cancellation/company change never applies, and a dispatched apply ACK loss stays fenced',async()=>{
 for(const mode of ['abort','company','apply-lost']){
  const f=actualSeoFixture('qwen'),{h}=f;
  h.prependIntercept(call=>{
   if(!call.url.endsWith('/translation-apply'))return null;
   if(call.body.action==='preview'&&mode==='abort'){h.controller.abort();return Response.json({error:'isolated cancelled preview'},{status:503});}
   if(call.body.action==='preview'&&mode==='company'){h.company({code:'A01464742',name:'와이홉'});return Response.json({error:'isolated changed actor preview'},{status:503});}
   if(call.body.action==='apply'&&mode==='apply-lost')throw Error('isolated apply ACK lost');
  });
  const first=await h.run(['seo','pricing']);if(mode==='abort')assert.equal(first,null);else assert.equal(first.stages[0].status,'failed',mode);
  assert.equal(h.calls.some(call=>call.url?.endsWith('/stage-two-pricing')),false,mode);assert.equal(f.actions().length,3,mode);
  const writes=h.calls.filter(call=>call.url?.endsWith('/translation-apply')&&call.body.action==='apply');assert.equal(writes.length,mode==='apply-lost'?1:0,mode);
  if(mode==='apply-lost'){
   assert.equal(h.keys.get('owner:product:pending:seo'),'저장 결과 확인 필요');const before=h.calls.length,state=plain(f.state());await h.run(['seo','pricing']);assert.equal(h.calls.length,before+1);assert.deepEqual(f.state(),state);assert.equal(writes.length,1);
  }
 }
});

test('preexisting SEO prepare uncertainty, apply write or pending latch cannot be reset by a zero-dispatch run',async()=>{
 for(const kind of ['qwen','google','llama'])for(const mode of ['state','write','pending']){
  const f=actualSeoFixture(kind),{h}=f;let rejected=false;
  h.prependIntercept(call=>{
   if(call.url==='/api/supplier-hub/catalog-context'&&!rejected&&h.events.at(-1)?.status==='running'&&h.keys.has('owner:product:pending:seo')&&f.stateEntry()&&f.state().prepareSubmitted){rejected=true;return Response.json({error:'isolated preflight unavailable'},{status:503});}
  });
  await h.run(['seo']);assert.equal(f.actions().length,0,kind+mode);
  const [key,initial]=f.stateEntry();if(mode==='state')h.keys.set(key,JSON.stringify({...JSON.parse(initial),prepareSubmitted:true}));
  if(mode==='write')h.keys.set('owner:product:write:seo:prior-unknown','submitted');
  if(mode==='pending')h.keys.set('owner:product:pending:seo','SEO 저장 결과 미확정');
  // Force another preflight rejection only after the engine publishes its flag.
  rejected=false;
  await h.run(['seo','pricing']);assert.equal(f.actions().length,0,kind+mode);assert.equal(h.keys.has('owner:product:pending:seo'),true,kind+mode);
  if(mode!=='pending')assert.equal(f.state().prepareSubmitted,true,kind+mode);else assert.equal(h.keys.get('owner:product:pending:seo'),'SEO 저장 결과 미확정',kind+mode);
  const before=h.calls.length;await h.run(['seo','pricing']);assert.equal(h.calls.length,before+1,kind+mode);assert.equal(f.actions().length,0,kind+mode);
 }
});

test('only an explicit retry and fresh failed Qwen proof replace the local request UUID without replaying history',async()=>{
 const f=qwenRetryFixture(),{h}=f;await h.run(['seo']);const old=[...h.keys.entries()].find(([key])=>key.includes(':seo-qwen:'))[1];assert.equal(f.creates,1);assert.equal(f.providerCalls,1);
 await h.run(['seo']);assert.equal(f.creates,1);assert.equal(f.providerCalls,1);assert.equal(f.reads,0);
 h.options.retryFailedQwen=true;h.keys.set('owner:product:pending:seo','Qwen 번역 결과 확인 필요');const result=await h.run(['seo']);assert.equal(result.stages[0].status,'blocked');assert.equal(f.reads,1);assert.equal(f.creates,2);assert.equal(f.providerCalls,2);
 const fresh=[...h.keys.entries()].find(([key])=>key.includes(':seo-qwen:'))[1];assert.notEqual(JSON.parse(fresh).idempotencyKey,JSON.parse(old).idempotencyKey);assert.equal(JSON.parse(old).jobId,'job-1');assert.equal(h.keys.has('owner:product:pending:seo'),false);
});

test('explicit retry never replaces completed, running, uncertain or unconfirmed-write Qwen state',async()=>{
 for(const status of ['completed','running','uncertain','write']){const f=qwenRetryFixture(),{h}=f;await h.run(['seo']);const before=[...h.keys.entries()].find(([key])=>key.includes(':seo-qwen:'))[1];h.options.retryFailedQwen=true;f.status(status==='write'?'failed':status);
  if(status==='write'){h.keys.set('owner:product:pending:seo','저장 결과 확인 필요');h.keys.set('owner:product:write:seo-qwen:unknown','submitted');}
  await h.run(['seo','pricing']);assert.equal(f.creates,1,status);assert.equal(f.providerCalls,1,status);assert.equal([...h.keys.entries()].find(([key])=>key.includes(':seo-qwen:'))[1],before,status);
  if(status==='write'){assert.equal(f.reads,0);assert.equal(h.keys.get('owner:product:write:seo-qwen:unknown'),'submitted');assert.equal(h.keys.get('owner:product:pending:seo'),'저장 결과 확인 필요');}
 }
});

test('failed Qwen retry keeps current original-source scope and manual values instead of allocating on a changed source',async()=>{
 const f=qwenRetryFixture(),{h}=f;await h.run(['seo']);const before=[...h.keys.entries()].find(([key])=>key.includes(':seo-qwen:'))[1];h.options.retryFailedQwen=true;f.generation.view.source.title='변경된 다른 원문';
 const result=await h.run(['seo','pricing']);assert.equal(result.stages[0].status,'failed');assert.match(result.stages[0].message,/원문/);assert.equal(f.creates,1);assert.equal(f.providerCalls,1);assert.equal([...h.keys.entries()].find(([key])=>key.includes(':seo-qwen:'))[1],before);assert.equal(h.calls.some(call=>call.url?.endsWith('/stage-two-pricing')),false);
});

test('one paid-notice-bound Qwen call combines factual attributes and pending option bindings, adopts all once and skips duplicate Llama SEO',async()=>{
 const {h,optionAttributes}=qwenFixture(),result=await h.run(['seo','pricing','koreanLabel','quotation']);
 assert.deepEqual(plain(result.stages.map(row=>row.status)),['draft','draft','draft','draft']);
 const calls=h.calls.filter(call=>call.adapter==='qwen-translation');assert.equal(calls.length,1);assert.equal(calls[0].confirmAi,true);
 assert.deepEqual(calls[0].state.source.attributes,[{name:'상품속성: 材质',value:'棉'},...optionAttributes]);assert.equal(calls[0].state.source.title,'原名');assert.equal(calls[0].state.source.description,'原文');
 assert.equal(h.calls.some(call=>call.adapter==='seo-generation'),false);assert.equal(h.calls.some(call=>call.url?.endsWith('/translation-source')),false);
 const applied=h.calls.filter(call=>call.url?.endsWith('/translation-apply'));assert.deepEqual(applied.map(call=>call.body.action),['preview','apply']);assert.ok(applied.every(call=>call.body.scope==='all'&&call.body.linkQuotationSeoDefaults===true));
 assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
});

test('Qwen refuses changed cost notice, model, output cap, company or missing pre-click consent before any provider or apply mutation',async()=>{
 for(const change of ['notice','model','tokens','company','consent','disabled']){const {h,generation}=qwenFixture();
  if(change==='notice')generation.view.configuration.translationConfig.notice+=' 변경';if(change==='model')h.prependIntercept(call=>call.url.endsWith('/translation')?Response.json({configuration:{configured:true,model:'google',maxOutputTokens:0},jobs:[]}):null);
  if(change==='tokens')h.prependIntercept(call=>call.url.endsWith('/translation')?Response.json({configuration:{configured:true,model:'@cf/qwen/qwen3-30b-a3b-fp8',maxOutputTokens:8000},jobs:[]}):null);
  if(change==='company')generation.view.company={code:'A01464742',name:'와이홉'};if(change==='consent')delete h.options.seoGenerationConsent;if(change==='disabled')h.options.seoGenerationConsent.translationConfig.configured=false;
  const result=await h.run(['seo','pricing']);assert.ok(['blocked','failed'].includes(result.stages[0].status),change);assert.equal(h.calls.some(call=>call.adapter==='qwen-translation'||call.adapter==='seo-generation'||call.url?.endsWith('/translation-apply')),false,change);
  if(change==='company')assert.equal(h.calls.some(call=>call.url?.endsWith('/stage-two-pricing')),false);
 }
});

test('Qwen confirmed partial or failed generation permits later stages, while uncertain execution and unknown apply retain their fences',async()=>{
 for(const mode of ['partial','failed','uncertain','apply']){const outcome=mode==='failed'?{job:{status:'failed'},closed:true,partial:false,message:'확인된 Qwen 실패'}:mode==='uncertain'?{job:{status:'uncertain'},closed:false,partial:false,message:'Qwen 응답 미확인'}:undefined;
  const {h}=qwenFixture(outcome);if(mode==='partial')h.deps['@/app/seo-workspace-draft'].runSeoWorkspaceDraft=async()=>({job:{id:'qwen-partial',status:'completed',result:{}},closed:true,partial:true,message:'일부 번역만 확인'});
  if(mode==='apply')h.prependIntercept(call=>{if(call.url.endsWith('/translation-apply')&&call.body.action==='apply')throw Error('local lost write acknowledgement');});
  const result=await h.run(['seo','pricing']);assert.equal(result.stages[0].status,mode==='apply'?'failed':'blocked',mode);
  const stopped=['uncertain','apply'].includes(mode);assert.equal(h.calls.some(call=>call.url?.endsWith('/stage-two-pricing')),!stopped,mode);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:seo')),stopped,mode);
  if(stopped){const before=h.calls.length;await h.run(['seo','pricing']);assert.equal(h.calls.length,before+1,mode);}
 }
});

test('Google option translation applies its exact preview while missing AI consent cannot masquerade as generated SEO completion',async()=>{
 const h=seoFixture(),result=await h.run(['seo']);assert.equal(result.stages[0].status,'blocked');assert.match(result.stages[0].message,/AI SEO 생성 완료로 표시하지 않았습니다/);
 const writes=h.calls.filter(call=>call.url?.endsWith('/translation-apply'));
 assert.deepEqual(writes.map(call=>call.body.action),['preview','apply']);assert.equal(writes[1].body.fingerprint,hash);
 assert.equal(writes[1].body.scope,'options');assert.equal(writes[1].body.linkQuotationSeoDefaults,undefined);assert.equal(h.calls.some(call=>call.adapter==='seo-generation'),false);
});

test('unknown SEO provider outcome stops later stages and preserves the same request fence',async()=>{
 const h=seoFixture({job:{status:'uncertain'},closed:false,message:'응답 미확인'});
 const result=await h.run(['seo','pricing']);assert.equal(result.stages[0].status,'blocked');
 const before=h.calls.length;await h.run(['seo','pricing']);
 assert.equal(h.calls.some(call=>call.url?.endsWith('/stage-two-pricing')||call.url?.endsWith('/translation-apply')),false);
 assert.equal(h.calls.length,before+1);
});

test('one full action runs Google options then generated SEO, pricing, all image roles, label and quotation despite confirmed image partials',async()=>{
 const h=seoFixture(),generation=withSeoGeneration(h);h.options.mode='full';h.image({status:'partial',messages:['확인된 일부 이미지 초안 · 오류 문구만 수정 필요']});let productVersion=version;
 const content={schemaVersion:1,productId:'product',revision:3,seo:{title:{value:'수동 제목 보존',provenance:'manual'},keywords:{value:[],provenance:'collected'},description:{value:'原文',provenance:'collected'}},label:{contact:{value:'직접 입력',provenance:'manual'}},assets:{size:{value:[]}}},before=plain(content);
 h.prependIntercept(call=>{
  if(call.url==='/api/products/product')return Response.json({product:{id:'product',title:'검증 상품',updated_at:productVersion}});
  if(call.url.endsWith('/content'))return Response.json({content});
  if(call.url.endsWith('/work-draft'))return Response.json({productId:'product',productVersion});
  if(call.url.endsWith('/registration-layout'))return Response.json({productId:'product',productVersion,sizeChartRequired:false});
  if(call.url.endsWith('/translation-apply')&&call.body.action==='apply'){productVersion='2026-10-23T00:00:01.000Z';generation.view.productVersion=productVersion;return Response.json({productId:'product',productVersion,contentRevision:4,optionRevision:3,applied:1});}
  if(call.url.endsWith('/seo-generation')&&call.body.action==='apply'){productVersion=new Date(Date.parse(productVersion)+2).toISOString();return Response.json({purpose:'seo-generation',scope:'all',productId:'product',productVersion,contentRevision:4,optionRevision:3,applied:1});}
 });
 const result=await h.run(stageIds.slice().reverse());assert.deepEqual(plain(result.stages.map(row=>row.id)),stageIds);assert.deepEqual(plain(result.stages.map(row=>row.status)),['draft','draft','blocked','blocked','blocked','skipped','draft','draft']);
 const executed=h.calls.flatMap(call=>call.url?.endsWith('/translation-apply')&&call.body.action==='apply'?['google-options']:call.adapter==='seo-generation'?['generated-seo']:call.url?.endsWith('/stage-two-pricing')?['pricing']:call.adapter==='image'?[call.stage]:call.adapter==='label'?['koreanLabel']:call.url?.endsWith('/quotation-ai')&&call.method==='POST'?['quotation']:[]);
 assert.deepEqual(executed,['google-options','generated-seo','pricing','main','additional','detail','koreanLabel','quotation']);assert.equal(h.calls.find(call=>call.adapter==='seo-generation').confirmAi,true);assert.deepEqual(content,before);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
});

test('changed notice/company, a known unavailable free service and failed generation cannot claim AI SEO completion',async()=>{
 for(const mode of ['notice','company','unavailable','failed','uncertain']){const h=seoFixture(),generation=withSeoGeneration(h);if(mode==='notice')generation.view.configuration.notice+=' 변경';if(mode==='company')generation.view.company={code:'A01464742',name:'와이홉'};if(mode==='unavailable')generation.view.configuration.configured=false;if(mode==='failed')generation.outcome={job:{status:'failed'},closed:true,message:'확인된 AI 생성 실패'};if(mode==='uncertain')generation.outcome={job:{status:'uncertain'},closed:false,message:'AI 생성 응답 미확인'};
  const result=await h.run(['seo','pricing']);assert.ok(['blocked','failed'].includes(result.stages[0].status));assert.equal(h.calls.some(call=>call.url?.endsWith('/seo-generation')&&call.body.action==='apply'),false,mode);assert.equal(h.calls.some(call=>call.url?.endsWith('/stage-two-pricing')),!['company','uncertain'].includes(mode),mode);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:seo')),['company','uncertain'].includes(mode),mode);
 }
});

test('a notice seeded original company blocks a changed account before any option or SEO provider mutation',async()=>{
 const h=seoFixture();withSeoGeneration(h);h.keys.set('batch-owner:owner',JSON.stringify({ownerId:'owner',company:{code:'A01464742',name:'와이홉'}}));await assert.rejects(h.run(['seo','pricing']),/회사/);assert.equal(h.calls.some(call=>call.method==='POST'||call.adapter==='seo-generation'),false);
});

test('a closed failed SEO generation clears only its confirmed pending fence and continues later work',async()=>{
 const h=seoFixture({job:{status:'failed'},closed:true,message:'확인된 SEO 생성 실패'}),result=await h.run(['seo','pricing','koreanLabel','quotation']);assert.equal(result.stages[0].status,'blocked');assert.equal(result.stages[1].status,'draft');assert.equal(result.stages[2].status,'draft');assert.equal(result.stages[3].status,'draft');assert.equal(h.calls.some(call=>call.url?.endsWith('/translation-apply')),false);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
});

for(const role of ['main','additional','detail'])test('partial image preparation only changes selected '+role+' in actual local persistence',async()=>{
 const h=mobileIntakeHarness();try{
  await h.intake();
  const product=()=>h.sqlite.prepare('SELECT * FROM products').get(),content=()=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  const options=()=>JSON.parse(h.sqlite.prepare('SELECT payload FROM product_options').get().payload),before={content:content(),options:options()};
  const response=await h.route('/api/products/'+product().id+'/work-draft',{method:'POST',body:{expectedVersion:product().updated_at,roles:[role]}});
  assert.equal(response.status,200,await response.clone().text());
  assert.ok(content().assets[role].value.length);
  for(const other of ['main','additional','detail'].filter(value=>value!==role))assert.deepEqual(content().assets[other],before.content.assets[other]);
  if(role!=='main')assert.deepEqual(options(),before.options);
  assert.deepEqual(content().seo,before.content.seo);assert.deepEqual(content().label,before.content.label);
 }finally{h.close();}
});
