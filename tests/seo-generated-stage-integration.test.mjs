import test from 'node:test';
import assert from 'node:assert/strict';
import {detailStageUI} from './helpers/option-detail-manual-edit.mjs';
import {nextVersion} from './helpers/seo-workspace-editor.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';
import {seoWorkspaceHarness} from './helpers/seo-workspace.mjs';
import {seoWorkspaceEditor} from './helpers/seo-workspace-editor.mjs';
import * as pageSourcePriceBasis from '../extensions/supplier-hub/page-source-price-basis.mjs';

// Reuse the component's existing lifecycle fixture; retain real client/seed modules.
const fixtureUrl=new URL('./seo-workspace-generator.test.mjs',import.meta.url);
const parsed=ts.createSourceFile('generator-fixture.mjs',fs.readFileSync(fixtureUrl,'utf8').split('\ntest(')[0],ts.ScriptTarget.ESNext,true,ts.ScriptKind.JS);
const fixtureCode=parsed.statements.filter(statement=>!ts.isImportDeclaration(statement)).map(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==='compositionModule'?'\nfunction compositionModule(file){return providedOptionModule(file);}\n':statement.getFullText(parsed)).join('').replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href)).replace('{exports,fetch:api,AbortController','{exports,Error,fetch:api,AbortController');
const {ui,plain,text}=vm.runInNewContext(fixtureCode+'\n({ui,plain,text})',{fs,vm,ts,assert,URL,Response,Error,AbortController,structuredClone,TextEncoder,crypto:globalThis.crypto,setImmediate,providedOptionModule,pageSourcePriceBasis});

async function restoredGenerator({title='유앤채',lostUnits=true,status='completed'}={}){
 const api=seoWorkspaceHarness(),client=providedOptionModule('app/seo-workspace-draft.ts'),translation=providedOptionModule('app/automation/translation.ts');
 const content=structuredClone(api.content),options=structuredClone(api.options),memo={brand:'유앤채',features:'',keywords:'곡선커튼레일'};
 options.rows=[1,2,5,3,4].map((length,index)=>({...structuredClone(options.rows[0]),id:'synthetic-rail-'+index,originalName:length+'米套装',translatedName:'',included:true,provenance:{translatedName:'collected',color:'collected',size:'collected'},color:'',size:''}));
 api.sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=?').run(JSON.stringify(options),api.id);
 const raw={productId:api.id,productVersion:api.version,jobId:'synthetic-source',sourceUrl:'https://example.test/synthetic-rail',title:'弯曲窗帘轨道',description:'',attributes:[],requestContext:{categoryId:'synthetic-category',categoryPath:['커튼레일'],features:'',keywords:memo.keywords}};
 const configuration={configured:true,model:translation.WORKERS_QWEN_MODEL,maxOutputTokens:4096,issues:[]},sourceFingerprint='a'.repeat(64);
 const state=client.createSeoWorkspaceDraftState({productId:api.id,productVersion:api.version,contentRevision:content.revision,optionRevision:options.revision,sourceFingerprint,source:{title:raw.title,description:'',attributes:options.rows.map(row=>({name:'option:'+row.id,value:row.originalName})),provenance:'manual',reference:raw.jobId+' '+raw.sourceUrl,category:{id:raw.requestContext.categoryId,path:raw.requestContext.categoryPath},guidance:{features:'',keywords:memo.keywords}},memo,configuration});
 const composition=await providedOptionModule('app/seo-related-keywords-client.ts').acquireSeoComposition(memo,new AbortController().signal,()=>true);
 const context={...providedOptionModule('app/seo-composition-context.ts').seoCompositionContext(options),sourceFingerprint};
 const review=await translation.prepareTranslationReview(state.source,{provider:'workers-ai',model:configuration.model,maxOutputTokens:4096,ai:{run:()=>assert.fail('No provider call')}},new Date(api.version),composition,context);review.expiresAt='2099-01-01T00:00:00.000Z';
 const result={model:configuration.model,appliedToContent:false,provenance:'generated',draft:{title,keywords:[memo.keywords],description:'',attributes:[],warnings:[]},seoOptions:options.rows.map((row,index)=>({optionId:row.id,name:[1,2,5,3,4][index]+(lostUnits?' 세트':'m 세트')}))};
 const old={id:'00000000-0000-4000-8000-000000000091',productId:api.id,productVersion:api.version,contentRevision:content.revision,status,startedAt:api.version,finishedAt:status==='completed'?api.version:null,error:null,review,result:status==='completed'?result:null};
 Object.assign(state,{seoComposition:composition,jobId:old.id,reviewFingerprint:review.fingerprint,prepareSubmitted:true,approvalSubmitted:true,executeSubmitted:true});
 const requests=[],emitted=[];let next=null,held=null;
 const fetcher=async(target,init={})=>{
  const body=init.body?JSON.parse(init.body):null;requests.push({target,method:init.method??'GET',body});
  if(target.endsWith('/translation')){
   if(!body)return Response.json({configuration,jobs:[old,...next?[next]:[]]});
   if(body.action==='prepare'){if(held)await held.promise;next={...plain(old),id:'00000000-0000-4000-8000-000000000092',status:'prepared',startedAt:null,finishedAt:null,result:null,review:{...plain(review),source:body.source,seoComposition:body.seoComposition,fingerprint:'b'.repeat(64)}};}
   else if(body.action==='approve'){assert.equal(body.jobId,next.id);next.status='approved';}
   else if(body.action==='execute'){assert.equal(body.jobId,next.id);next.status='completed';next.result={...plain(result),draft:{...plain(result.draft),title:'곡선 커튼레일'},seoOptions:options.rows.map((row,index)=>({optionId:row.id,name:[1,2,5,3,4][index]+'m 세트'}))};}
   else assert.fail(body.action);return Response.json({job:next});
  }
  if(target.endsWith('/content'))return Response.json({content});
  if(target.endsWith('/options'))return Response.json({productVersion:api.version,options});
  if(target.endsWith('/translation-source'))return Response.json(raw);
  if(target.endsWith('/registration-settings'))return Response.json({productId:api.id,settings:{brand:memo.brand}});
  if(target.endsWith('/seo-generation'))return Response.json({productId:api.id,productVersion:api.version,contentRevision:content.revision,optionRevision:options.revision,sourceFingerprint});
  assert.fail(target);
 };
 const edit=seoWorkspaceEditor(api,{props:{workspaceOwnerId:'owner'}});await edit.idle();edit.edit('SEO 상품명','작성 중 제목');edit.edit('SEO 검색태그','');edit.edit('1번째 한국어 옵션명','직접 옵션');
 const h=ui({productId:api.id,productVersion:api.version,workspaceOwnerId:'owner',storageValue:JSON.stringify(state),draftHelper:client,fetcher,onDraft:seed=>{emitted.push(seed);edit.patch({generatedDraft:seed});}});
 return{api,h,edit,state,old,requests,emitted,holdPrepare(){let resolve;held={promise:new Promise(done=>{resolve=done;})};return resolve;},close(){h.close();edit.close();api.close();}};
}

test('restored malformed completed jobs reject at seed acceptance, keep dirty inputs and reset into a fresh unchanged request',async()=>{
 for(const shape of [{},{title:'곡선 커튼레일'}]){
  const f=await restoredGenerator(shape),{h,edit}=f;try{
   const before=JSON.stringify(f.old),stored=f.api.stored();await h.idle();const storageBefore=h.storage.get('yoofam-seo-workspace:'+f.api.id);assert.equal(h.button('새 초안 입력'),undefined);
   h.button('같은 초안 요청 확인').props.onClick();await h.idle();await edit.idle();
   assert.equal(f.emitted.length,0);assert.match(text(h.render()),/브랜드 외의 품목명|원문 단위/);assert.ok(h.button('새 초안 입력'));assert.equal(h.storage.get('yoofam-seo-workspace:'+f.api.id),storageBefore);
   assert.equal(edit.input('SEO 상품명').props.value,'작성 중 제목');assert.equal(edit.input('SEO 검색태그').props.value,'');assert.equal(edit.input('1번째 한국어 옵션명').props.value,'직접 옵션');assert.equal(edit.calls.filter(call=>call.method==='PATCH').length,0);assert.deepEqual(f.api.stored(),stored);
   const release=f.holdPrepare();h.button('새 초안 입력').props.onClick();await h.idle();assert.equal(h.storage.size,0);const click=h.button('AI로 자동 생성').props.onClick;click();click();await h.idle();
   const prepare=f.requests.filter(row=>row.body?.action==='prepare');assert.equal(prepare.length,1);assert.notEqual(prepare[0].body.idempotencyKey,f.state.idempotencyKey);assert.deepEqual(plain(prepare[0].body.source),plain(f.state.source));assert.deepEqual(plain(prepare[0].body.seoComposition),plain(f.state.seoComposition));assert.equal(prepare[0].body.expectedOptionRevision,f.state.optionRevision);assert.equal(prepare[0].body.expectedSourceFingerprint,f.state.sourceFingerprint);
   release();await h.idle();await edit.idle();assert.equal(f.emitted.length,1);assert.equal(f.emitted[0].jobId,'00000000-0000-4000-8000-000000000092');assert.equal(f.old.review.typedSeoPromptRevision,'couplus-typed-seo-v4');assert.equal(JSON.stringify(f.old),before);assert.equal(edit.calls.filter(call=>call.method==='PATCH').length,0);assert.equal(f.requests.filter(row=>row.body?.action==='execute'&&row.body.jobId===f.old.id).length,0);assert.deepEqual(f.api.stored(),stored);
   assert.equal(edit.input('SEO 상품명').props.value,'작성 중 제목');assert.equal(edit.input('SEO 검색태그').props.value,'');assert.equal(edit.input('1번째 한국어 옵션명').props.value,'직접 옵션');assert.equal(edit.input('2번째 한국어 옵션명').props.value,'2m 세트');
  }finally{f.close();}
 }
});

test('restored running and unknown requests retain lookup-only recovery without exposing reset or duplicate writes',async()=>{
 for(const status of ['running','uncertain']){const f=await restoredGenerator({status}),{h}=f;try{await h.idle();const before=h.storage.get('yoofam-seo-workspace:'+f.api.id);h.button('같은 초안 요청 확인').props.onClick();await h.idle();assert.equal(h.button('새 초안 입력'),undefined);assert.equal(f.emitted.length,0);assert.equal(f.requests.filter(row=>row.body).length,0);assert.equal(h.storage.get('yoofam-seo-workspace:'+f.api.id),before);assert.equal(f.edit.calls.filter(call=>call.method==='PATCH').length,0);}finally{f.close();}}
});

const generator=h=>h.record('seo-workspace-generator');
const editor=h=>h.record('seo-workspace-editor');
const seedFor=(h,overrides={})=>({format:'yoofam-seo-generated-draft-v1',ownerId:'owner-a',productId:generator(h).props.productId,
  productVersion:generator(h).props.version,jobId:'completed-job',values:{seo:{title:'생성한 검토 초안'},optionNames:{}},...overrides});

test('completed SEO input is handed to the same active editor without persisting or submitting',()=>{
 const h=detailStageUI({tab:'SEO',workspaceOwnerId:'owner-a'});try{
  const seed=seedFor(h);generator(h).props.onDraft(seed);
  assert.equal(editor(h).props.generatedDraft,seed);assert.equal(editor(h).props.workspaceOwnerId,'owner-a');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),{saved:0,reads:0,uploads:0,submission:0});
 }finally{h.close();}
});

test('late generated drafts cannot enter another owner, product or saved source version, including ABA',()=>{
 for(const changed of ['owner','product','source']){
  const h=detailStageUI({tab:'SEO',workspaceOwnerId:'owner-a'});try{
   const first=generator(h).props,callback=first.onDraft,seed=seedFor(h);
   const original={id:first.productId,title:'원래 검수 상품',updated_at:first.version,image_keys:'[]'};
   if(changed==='owner')h.render({workspaceOwnerId:'owner-b'});
   else h.render({product:{...original,...(changed==='product'?{id:'other-product'}:{updated_at:nextVersion(first.version)})}});
   callback(seed);assert.equal(editor(h).props.generatedDraft,null);
   if(changed==='owner')h.render({workspaceOwnerId:'owner-a'});else h.render({product:original});
   callback(seed);assert.equal(editor(h).props.generatedDraft,null,'retired callback stays retired after returning');
   const current=seedFor(h);generator(h).props.onDraft(current);assert.equal(editor(h).props.generatedDraft,current);
  }finally{h.close();}
 }
});

test('stage leave retires the draft publisher and rejects mismatched current job binding',()=>{
 const h=detailStageUI({tab:'SEO',workspaceOwnerId:'owner-a'});try{
  const callback=generator(h).props.onDraft,seed=seedFor(h);h.render({tab:'가격'});callback(seed);assert.equal(editor(h).props.generatedDraft,null);
  h.render({tab:'SEO'});callback(seed);assert.equal(editor(h).props.generatedDraft,null);
  for(const override of [{ownerId:'owner-b'},{productId:'another'},{productVersion:nextVersion(seed.productVersion)}]){
   generator(h).props.onDraft({...seed,...override});assert.equal(editor(h).props.generatedDraft,null);
  }
  generator(h).props.onDraft(seed);assert.equal(editor(h).props.generatedDraft,seed);
 }finally{h.close();}
});
