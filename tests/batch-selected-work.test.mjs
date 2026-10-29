import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

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
  '@/app/quotation-known-notice-proposals':providedOptionModule('app/quotation-known-notice-proposals.ts'),
  '@/app/batch-selected-packaging-work':{async runSelectedPackagingWork(id,options){await options.assertCurrent();calls.push({adapter:'packaging',id,revision:options.view.revision,fingerprint:options.view.inputFingerprint});return {view:options.view,status:'unchanged',changed:0,estimated:0,fallback:0,remaining:0,recovered:false,message:'저장한 포장값을 유지했습니다.'};}},
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
   if(url.endsWith('/content'))return Response.json({content:{productId:'product',schemaVersion:1,revision:3,label:{},assets:{size:{value:[]}}}});
   if(url.endsWith('/registration-layout'))return Response.json({productId:'product',productVersion:version,sizeChartRequired:false});
   if(url.endsWith('/quotation-fields'))return Response.json({revision:1,inputFingerprint:hash,contentRevision:3,overrides:{common:{},options:{}},categoryContext:{profileId:null,categoryId:'68183',categoryPath:['합성']},resolved:{rows:[{optionId:'a',included:true,fields:{}}],schema:{fields:[],status:'observed',categoryId:'68183',categoryPath:['합성']}}});
   if(url.endsWith('/quotation-ai')){
    if(call.method==='POST')return Response.json({job:{id:'quote',status:'completed',result:{changes:[]}}});
    return Response.json({configuration:{configured:true},fingerprint:hash,jobs:[]});
   }
   return Response.json({product:{id:'product',title:'검증 상품',updated_at:version}});
  }};
 return{calls,events,keys,options,controller,deps,run:stages=>exports.runSelectedBatchProduct('product',{...options,stages}),
  owner:value=>owner=value,company:value=>company=value,intercept:value=>onFetch=value,prependIntercept:value=>{const previous=onFetch;onFetch=async(...args)=>await value(...args)??await previous?.(...args);},image:value=>imageResult=value,label:value=>labelResult=value};
}

// Reuse the isolated actual image runner fixtures without loading their tests.
// OCR/provider/render/upload effects remain local dependency fakes.
function actualImageFixture(stage='detail',keys=['owner/source-a.png','owner/source-b.png']){
 const sourceUrl=new URL('./batch-selected-image-work.test.mjs',import.meta.url),source=fs.readFileSync(sourceUrl,'utf8'),ast=ts.createSourceFile(sourceUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const declarations=ast.statements.filter(statement=>ts.isFunctionDeclaration(statement)&&['loadModel','fixture','partialFixture'].includes(statement.name?.text)).map(statement=>statement.getText(ast)).join('\n').replaceAll('import.meta.url',JSON.stringify(sourceUrl.href));
 const factory=vm.runInNewContext(declarations+'\n({fixture,partialFixture})',{assert,fs,vm,ts,plain,Error,Date,URL,AbortController,AbortSignal,structuredClone,Blob,Response});
 return factory.partialFixture(stage,keys);
}
test('price-only run checks calculated option prices without unrelated writes',async()=>{
 const h=fixture(),result=await h.run(['pricing']);assert.equal(result.stages[0].status,'draft');
 const writes=h.calls.filter(call=>call.method==='POST');assert.equal(writes.length,0);assert.equal(h.calls.filter(call=>call.url?.endsWith('/stage-two-pricing')).length,1);
 assert.equal(h.calls.some(call=>call.adapter||call.url?.endsWith('/work-draft')),false);
 assert.deepEqual(h.events.map(row=>row.status),['running','draft']);
});

test('full work skips only a fresh completed stage; explicit partial work and stale evidence still enter it',async()=>{
 for(const mode of ['full','selected'])for(const stale of [false,true]){const h=fixture();h.options.mode=mode;
  h.intercept(call=>call.url.endsWith('/automation')?Response.json({stale,workflow:{productId:'product',productVersion:version,stages:[{id:'pricing',status:'complete'}]}}):null);
  const result=await h.run(['pricing']),skip=mode==='full'&&!stale;
  assert.equal(result.stages[0].status,skip?'skipped':'draft');assert.equal(h.calls.some(call=>call.url?.endsWith('/stage-two-pricing')),!skip);
  assert.equal(h.calls.some(call=>call.method==='POST'),false);
 }
});

test('full work does not reuse another product or an older version as completion proof',async()=>{
 for(const wrong of ['product','version']){const h=fixture();h.options.mode='full';
  h.intercept(call=>call.url.endsWith('/automation')?Response.json({stale:false,workflow:{productId:wrong==='product'?'other':'product',productVersion:wrong==='version'?'2026-10-22T00:00:00.000Z':version,stages:[{id:'pricing',status:'complete'}]}}):null);
  const result=await h.run(['pricing']);assert.equal(result.stages[0].status,wrong==='product'?'failed':'draft');
  assert.equal(h.calls.some(call=>call.url?.endsWith('/stage-two-pricing')),wrong!=='product');
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

test('confirmed partial main, additional and detail image stages stay blocked while one action continues to label and quotation',async()=>{
 const h=fixture();h.image({status:'partial',messages:['확인된 일부 번역 초안 · 나머지 문구 확인 필요']});const result=await h.run(['quotation','detailImage','koreanLabel','additionalImages','mainImage']);
 assert.deepEqual(plain(result.stages.map(row=>[row.id,row.status])),[['mainImage','blocked'],['additionalImages','blocked'],['detailImage','blocked'],['koreanLabel','draft'],['quotation','draft']]);
 assert.deepEqual(h.calls.filter(call=>call.adapter==='image').map(call=>call.stage),['main','additional','detail']);assert.equal(h.calls.filter(call=>call.adapter==='label').length,1);assert.equal(h.calls.filter(call=>call.adapter==='packaging').length,1);
 assert.equal(h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,1);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
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

function knownQuotationFixture({configured=true}={}){
 const h=fixture(),nextVersion='2026-10-23T00:00:01.000Z';
 Object.assign(h.deps['@/app/quotation-ai-client'],providedOptionModule('app/quotation-ai-client.ts'));
 Object.assign(h.deps['@/app/quotation-fields-confirmation'],providedOptionModule('app/quotation-fields-confirmation.ts'));
 const fields=['제조자(수입자)','소비자상담 관련 전화번호','제조국(원산지)','재질'].map((label,index)=>({id:'notice'+index,label,section:'legal',visibility:'common',type:'text',required:false,hubWire:{path:['legalPage','notices'],name:label,nameKey:'noticeItemName',valueKey:'noticeItemValue'}}));
 const schema={status:'observed',categoryId:'68183',categoryPath:['합성'],fields},rows=['a','b','excluded'].map(optionId=>({optionId,optionLabel:optionId,included:optionId!=='excluded',fields:Object.fromEntries(fields.map(field=>[field.id,{value:'해당사항없음',source:'couplus-default'}]))}));
 const view={revision:1,inputFingerprint:hash,contentRevision:3,optionRevision:2,productVersion:version,updatedAt:version,imageKeys:[],overrides:{common:{},options:{b:{notice0:''}}},categoryContext:{profileId:null,categoryId:'68183',categoryPath:['합성']},automatic:{schema,rows:plain(rows)},resolved:{schema,rows}};
 view.resolved.rows[1].fields.notice0={value:'',source:'manual-option'};
 const content={schemaVersion:1,productId:'product',revision:3,label:Object.fromEntries(Object.entries({manufacturer:'저장 제조사',importer:'저장 수입사',contact:'02-1234-5678',countryOfOrigin:'중국'}).map(([key,value])=>[key,{value,provenance:key==='countryOfOrigin'?'generated':'manual'}]))};
 const job={id:'quote-known',status:'completed',fingerprint:hash,quotationRevision:1,profileId:null,scope:{optionId:null,applyToAllOptions:true},result:{changes:[{optionId:'a',fieldKey:'notice3',value:'검토 재질'}],warnings:[],model:'mock',generatedAt:version}};
 let onContent,saveResponse;const writes=[];
 h.intercept(async call=>{
  if(call.url.endsWith('/quotation-ai'))return Response.json({configuration:{configured},fingerprint:hash,productId:'product',productVersion:version,contentRevision:3,optionRevision:2,quotationRevision:1,profileId:null,jobs:configured?[job]:[]});
  if(call.url.endsWith('/content')){onContent?.();return Response.json({content});}
  if(call.url.endsWith('/quotation-fields')){
   if(call.method!=='PUT')return Response.json(view);
   writes.push(plain(call.body));if(saveResponse)return saveResponse(call);
   const saved=plain(view);saved.overrides=providedOptionModule('app/quotation-schema.ts').applyQuotationChanges(saved.overrides,call.body.changes);
   for(const change of call.body.changes)saved.resolved.rows.find(row=>row.optionId===change.optionId).fields[change.fieldKey]={value:change.value,source:'manual-option'};
   Object.assign(saved,{revision:2,inputFingerprint:'b'.repeat(64),productVersion:nextVersion,updatedAt:nextVersion});return Response.json(saved);
  }
 });
 return {...h,view,content,job,writes,onContent:callback=>onContent=callback,saveResponse:callback=>saveResponse=callback};
}

test('an actual editable partial image draft continues to label and verified quotation save while preserving manual fields',async()=>{
 const h=knownQuotationFixture(),image=actualImageFixture(),contentBefore=plain(h.content),imageContentBefore=plain(image.content),manualBlank=h.view.resolved.rows[1].fields.notice0,manualHtml=image.view.resolved.rows[0].fields.detailHtml;let labelStarted=false;
 h.company({code:'A01464742',name:'와이홉'});h.prependIntercept(call=>{
  if(call.url==='/api/products/product')return Response.json({product:{id:'product',title:'검증 상품',updated_at:image.view.productVersion}});
  if(call.url.endsWith('/work-draft'))return Response.json({productId:'product',productVersion:image.view.productVersion});
  if(call.url.endsWith('/content')&&!labelStarted)return Response.json({content:image.content});
 });
 const imageAdapter=h.deps['@/app/batch-selected-image-work'];imageAdapter.createSelectedImageStageState=image.model.createSelectedImageStageState;imageAdapter.processSelectedImageStage=(id,role,options)=>image.model.processSelectedImageStage(id,role,options,image.deps);
 const labelAdapter=h.deps['@/app/batch-selected-label-work'],label=labelAdapter.runSelectedLabelWork;labelAdapter.runSelectedLabelWork=async(...args)=>{labelStarted=true;return label(...args);};
 const result=await h.run(['detailImage','koreanLabel','quotation']);assert.deepEqual(plain(result.stages.map(row=>row.status)),['blocked','draft','draft']);assert.match(result.stages[0].message,/미완료|일부 번역/);
 assert.equal(image.calls.filter(row=>row[0]==='apply').length,1);assert.equal(image.calls.filter(row=>row[0]==='translate').length,1);assert.equal(image.documents[0].regions.find(row=>row.id==='rejected').selected,false);assert.equal(image.documents[0].regions.find(row=>row.id==='rejected').translated,'');assert.match(image.documents[0].regions.find(row=>row.id==='rejected').issue,/원문에 없는/);
 assert.equal(h.calls.filter(call=>call.adapter==='label').length,1);assert.equal(h.writes.length,1);assert.ok(h.writes[0].changes.every(change=>change.optionId!=='b'||change.fieldKey!=='notice0'));assert.deepEqual(h.view.resolved.rows[1].fields.notice0,manualBlank);assert.deepEqual(plain(image.view.resolved.rows[0].fields.detailHtml),plain(manualHtml));assert.deepEqual(h.content,contentBefore);assert.deepEqual(plain(image.content),imageContentBefore);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
});
test('explicit quotation work saves verified AI plus saved notice sources in one CAS request and confirms their exact receipt',async()=>{
 const h=knownQuotationFixture(),before=JSON.stringify({view:h.view,content:h.content}),result=await h.run(['quotation']);
 assert.equal(result.stages[0].status,'draft',result.stages[0].message);assert.match(result.stages[0].message,/AI 항목 1개 · 저장된 제조·상담 정보 3개/);
 assert.equal(h.writes.length,1);assert.equal(h.writes[0].expectedRevision,1);assert.equal(h.writes[0].expectedInputFingerprint,hash);
 assert.deepEqual(h.writes[0].changes,[{optionId:'a',fieldKey:'notice3',value:'검토 재질'},{optionId:'a',fieldKey:'notice0',value:'제조자: 저장 제조사 / 수입자: 저장 수입사'},{optionId:'a',fieldKey:'notice1',value:'02-1234-5678'},{optionId:'b',fieldKey:'notice1',value:'02-1234-5678'}]);
 assert.equal(JSON.stringify({view:h.view,content:h.content}),before);assert.equal(h.calls.some(call=>call.method==='POST'),false);
 assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
 assert.deepEqual(h.calls.find(call=>call.adapter==='packaging'),{adapter:'packaging',id:'product',revision:2,fingerprint:'b'.repeat(64)});
});

test('unconfigured quotation AI preserves manual values while applying known notices and checking packaging',async()=>{
 const h=knownQuotationFixture({configured:false}),before=JSON.stringify({view:h.view,content:h.content}),result=await h.run(['quotation']);
 assert.equal(result.stages[0].status,'blocked');assert.match(result.stages[0].message,/AI가 설정되지 않아 AI 작성은 실행하지 않았습니다/);
 assert.match(result.stages[0].message,/저장된 제조·상담 정보 3개/);assert.match(result.stages[0].message,/포장값/);
 assert.equal(h.calls.some(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST'),false);
 assert.equal(h.writes.length,1);assert.equal(h.writes[0].expectedRevision,1);assert.equal(h.writes[0].expectedInputFingerprint,hash);
 assert.deepEqual(h.writes[0].changes,[{optionId:'a',fieldKey:'notice0',value:'제조자: 저장 제조사 / 수입자: 저장 수입사'},{optionId:'a',fieldKey:'notice1',value:'02-1234-5678'},{optionId:'b',fieldKey:'notice1',value:'02-1234-5678'}]);
 assert.equal(JSON.stringify({view:h.view,content:h.content}),before);
 assert.deepEqual(h.calls.find(call=>call.adapter==='packaging'),{adapter:'packaging',id:'product',revision:2,fingerprint:'b'.repeat(64)});
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
 h.deps['@/app/batch-selected-packaging-work'].runSelectedPackagingWork=async()=>{count++;throw Error('포장 저장 확인 실패');};
 const first=await h.run(['quotation']);assert.equal(first.stages[0].status,'failed');
 const retry=await h.run(['quotation']);assert.equal(retry.stages[0].status,'blocked');assert.equal(count,1);
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

test('one full action runs SEO, pricing, all selected image roles, label and quotation despite confirmed image partials',async()=>{
 const h=seoFixture();h.options.mode='full';h.image({status:'partial',messages:['확인된 일부 이미지 초안 · 오류 문구만 수정 필요']});let productVersion=version;
 const content={schemaVersion:1,productId:'product',revision:3,seo:{title:{value:'수동 제목 보존',provenance:'manual'},keywords:{value:[],provenance:'collected'},description:{value:'原文',provenance:'collected'}},label:{contact:{value:'직접 입력',provenance:'manual'}},assets:{size:{value:[]}}},before=plain(content);
 h.prependIntercept(call=>{
  if(call.url==='/api/products/product')return Response.json({product:{id:'product',title:'검증 상품',updated_at:productVersion}});
  if(call.url.endsWith('/content'))return Response.json({content});
  if(call.url.endsWith('/work-draft'))return Response.json({productId:'product',productVersion});
  if(call.url.endsWith('/registration-layout'))return Response.json({productId:'product',productVersion,sizeChartRequired:false});
  if(call.url.endsWith('/translation-apply')&&call.body.action==='apply'){productVersion='2026-10-23T00:00:01.000Z';return Response.json({productId:'product',productVersion,contentRevision:4,optionRevision:3,applied:1});}
 });
 const result=await h.run(stageIds.slice().reverse());assert.deepEqual(plain(result.stages.map(row=>row.id)),stageIds);assert.deepEqual(plain(result.stages.map(row=>row.status)),['draft','draft','blocked','blocked','blocked','skipped','draft','draft']);
 const executed=h.calls.flatMap(call=>call.url?.endsWith('/translation-apply')&&call.body.action==='apply'?['seo']:call.url?.endsWith('/stage-two-pricing')?['pricing']:call.adapter==='image'?[call.stage]:call.adapter==='label'?['koreanLabel']:call.url?.endsWith('/quotation-ai')&&call.method==='POST'?['quotation']:[]);
 assert.deepEqual(executed,['seo','pricing','main','additional','detail','koreanLabel','quotation']);assert.deepEqual(content,before);assert.equal([...h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')),false);
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
