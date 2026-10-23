import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const stageIds=['seo','pricing','mainImage','additionalImages','detailImage','sizeChart','koreanLabel','quotation'];
const version='2026-10-23T00:00:00.000Z',hash='a'.repeat(64),plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const calls=[],events=[],keys=new Map(),controller=new AbortController();let owner='owner',company={code:'A01526306',name:'유앤채'},onFetch=null;
 let imageResult={status:'completed',messages:['번역 초안 저장']},labelResult={status:'draft',message:'표시사항 초안 저장',uncertain:false};
 const exports={},deps={
  '@/app/automation/model':{automationStages:stageIds},
  '@/app/supplier-hub-company':{supplierHubCompany:(code,name)=>['A01526306','A01464742'].includes(code)?{code,name}:null},
  '@/app/collected-translation-attributes':{},'@/app/option-translation':{},'@/app/sourcing':{},'@/app/seo-workspace-draft':{},
  '@/app/automation/translation':{GOOGLE_TEXT_MODEL:'google'},
  '@/app/quotation-ai-client':{quotationAiViewCurrent:()=>true,quotationAiJobForScope:()=>null,quotationAiScopedProposalChanges:()=>[]},
  '@/app/quotation-fields-confirmation':{},
  '@/app/registration-layout':{readRegistrationLayout:(raw,id,clock)=>{assert.equal(raw.productId,id);assert.equal(raw.productVersion,clock);return raw;}},
  '@/app/batch-selected-image-work':{createSelectedImageStageState:(ownerId,productId,stage)=>({ownerId,productId,stage,batches:{}}),async processSelectedImageStage(id,stage,options){calls.push({adapter:'image',id,stage,version:options.expectedProductVersion});return imageResult;}},
  '@/app/batch-selected-pricing-work':{async runSelectedPricingWork(id,options){await options.assertCurrent();const response=await options.fetcher('/api/products/'+id+'/stage-two-pricing');await options.assertCurrent();return await response.json();}},
  '@/app/batch-selected-label-work':{async runSelectedLabelWork(id,options){await options.assertCurrent();calls.push({adapter:'label',id});return labelResult;}},
 };
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
   if(url.endsWith('/content'))return Response.json({content:{productId:'product',assets:{size:{value:[]}}}});
   if(url.endsWith('/registration-layout'))return Response.json({productId:'product',productVersion:version,sizeChartRequired:false});
   if(url.endsWith('/quotation-fields'))return Response.json({revision:1,inputFingerprint:hash,categoryContext:{profileId:null},resolved:{rows:[],schema:{fields:[]}}});
   if(url.endsWith('/quotation-ai')){
    if(call.method==='POST')return Response.json({job:{id:'quote',status:'completed',result:{changes:[]}}});
    return Response.json({configuration:{configured:true},fingerprint:hash,jobs:[]});
   }
   return Response.json({product:{id:'product',title:'검증 상품',updated_at:version}});
  }};
 return{calls,events,keys,options,controller,deps,run:stages=>exports.runSelectedBatchProduct('product',{...options,stages}),
  owner:value=>owner=value,company:value=>company=value,intercept:value=>onFetch=value,image:value=>imageResult=value,label:value=>labelResult=value};
}
test('price-only run checks calculated option prices without unrelated writes',async()=>{
 const h=fixture(),result=await h.run(['pricing']);assert.equal(result.stages[0].status,'draft');
 const writes=h.calls.filter(call=>call.method==='POST');assert.equal(writes.length,0);assert.equal(h.calls.filter(call=>call.url?.endsWith('/stage-two-pricing')).length,1);
 assert.equal(h.calls.some(call=>call.adapter||call.url?.endsWith('/work-draft')),false);
 assert.deepEqual(h.events.map(row=>row.status),['running','draft']);
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
  assert.deepEqual(h.calls.find(call=>call.adapter==='image'),{adapter:'image',id:'product',stage:role,version});
  assert.equal(h.calls.some(call=>call.url?.endsWith('/automation')),false);
 }
});
test('execution follows canonical stage order, never dropdown click order and never submits',async()=>{
 const h=fixture(),result=await h.run(['quotation','koreanLabel','detailImage','pricing']);
 assert.deepEqual(plain(result.stages.map(row=>row.id)),['pricing','detailImage','koreanLabel','quotation']);
 assert.equal(h.calls.some(call=>/supplier-hub.*receipt|single-package|submission/.test(call.url??'')),false);
 assert.equal(result.stages.at(-1).status,'draft');
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

function seoFixture(outcome={job:{id:'seo-job',status:'completed',result:{}},closed:true,partial:false,message:'번역됨'}){
 const h=fixture();
 h.deps['@/app/collected-translation-attributes'].collectedTranslationAttributes=()=>[];
 h.deps['@/app/option-translation'].optionTranslationBatch=()=>({total:2,remaining:0,attributes:[]});
 h.deps['@/app/sourcing'].collectionSourceReference=()=> 'saved-source';
 Object.assign(h.deps['@/app/seo-workspace-draft'],{createSeoWorkspaceDraftState:input=>input,parseSeoWorkspaceDraftState:JSON.parse,
  runSeoWorkspaceDraft:async()=>outcome});
 const nextVersion='2026-10-23T00:00:01.000Z';
 h.intercept(call=>{
  if(call.url.endsWith('/translation'))return Response.json({configuration:{configured:true,model:'google'},jobs:[]});
  if(call.url.endsWith('/content'))return Response.json({content:{productId:'product',revision:3,seo:{title:{value:'原名',provenance:'collected'},keywords:{value:[],provenance:'collected'},description:{value:'原文',provenance:'collected'}}}});
  if(call.url.endsWith('/translation-source'))return Response.json({productId:'product',productVersion:version,jobId:'source',sourceUrl:'https://detail.1688.com/offer/886034098637.html',title:'原名',description:'原文',attributes:[],requestContext:{categoryId:'68183',categoryPath:['깔창','쿠션패드'],features:'',keywords:''}});
  if(call.url.endsWith('/options'))return Response.json({options:{productId:'product',revision:2},productVersion:version});
  if(call.url.endsWith('/registration-settings'))return Response.json({productId:'product',settings:{brand:'유앤채'}});
  if(call.url.endsWith('/translation-apply'))return Response.json(call.body.action==='preview'
   ?{productId:'product',productVersion:version,contentRevision:3,optionRevision:2,fingerprint:hash,preview:[{field:'title'}]}
   :{productId:'product',productVersion:nextVersion,contentRevision:4,optionRevision:3,applied:1});
 });
 return h;
}

test('SEO executes translation then applies the exact preview fingerprint and revisions',async()=>{
 const h=seoFixture(),result=await h.run(['seo']);assert.equal(result.stages[0].status,'draft');
 const writes=h.calls.filter(call=>call.url?.endsWith('/translation-apply'));
 assert.deepEqual(writes.map(call=>call.body.action),['preview','apply']);assert.equal(writes[1].body.fingerprint,hash);
 assert.equal(writes[1].body.linkQuotationSeoDefaults,true);
});

test('unknown SEO provider outcome stops later stages and preserves the same request fence',async()=>{
 const h=seoFixture({job:{status:'uncertain'},closed:false,message:'응답 미확인'});
 const result=await h.run(['seo','pricing']);assert.equal(result.stages[0].status,'blocked');
 const before=h.calls.length;await h.run(['seo','pricing']);
 assert.equal(h.calls.some(call=>call.url?.endsWith('/stage-two-pricing')||call.url?.endsWith('/translation-apply')),false);
 assert.equal(h.calls.length,before+1);
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
