import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const plain=value=>JSON.parse(JSON.stringify(value)),version='2026-10-23T00:00:00.000Z',hash='a'.repeat(64);
const stageIds=['seo','pricing','mainImage','additionalImages','detailImage','sizeChart','koreanLabel','quotation'];
function functions(file,names,globals={}){
 const url=new URL(file,import.meta.url),source=fs.readFileSync(url,'utf8'),ast=ts.createSourceFile(url.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const declarations=ast.statements.filter(row=>ts.isFunctionDeclaration(row)&&names.includes(row.name?.text)).map(row=>row.getText(ast)).join('\n').replaceAll('import.meta.url',JSON.stringify(url.href));
 return vm.runInNewContext(declarations+'\n({'+names.join(',')+'})',{assert,fs,vm,ts,plain,version,hash,stageIds,Error,Date,URL,TextEncoder,AbortController,AbortSignal,structuredClone,Blob,Response,...globals});
}
const orchestrator=functions('./batch-selected-work.test.mjs',['fixture']);
const image=functions('./batch-selected-image-work.test.mjs',['loadModel','fixture']);

/** Real toolbar orchestration and image-stage source/proof checks execute
 * together. Server/proposed SEO, pricing, label and quotation boundaries are
 * local fixtures. This is neither a provider-quality test nor a Hub receipt. */
function fixture(company,decision='verified'){
 const h=orchestrator.fixture(),runners=new Map(),imageResults=[],trace=[];let productVersion=version,contentRevision=3,optionRevision=1;
 h.company(company);h.options.mode='full';
 const configuration={freeOnly:true,destination:'Cloudflare Workers AI',configured:true,issues:[],translationConfig:{configured:true,model:'@cf/qwen/qwen3-30b-a3b-fp8',maxOutputTokens:4096,freeOnly:false,issues:[]}};
 h.options.seoGenerationConsent=configuration;
 Object.assign(h.deps['@/app/seo-workspace-draft'],{
  readSeoGenerationContext:async()=>({productVersion,company:plain(company),contentRevision,optionRevision,source:{title:'合成商品',description:'',attributes:[]},memo:{brand:company.name},configuration:plain(configuration)}),
  createSeoWorkspaceDraftState:value=>plain(value),
  runSeoWorkspaceDraft:async()=>{trace.push('seo-provider');return{closed:true,partial:false,job:{id:'local-seo',status:'completed',result:{title:'합성 상품'}}};},
 });
 h.deps['@/app/option-translation'].optionTranslationBatch=()=>({attributes:[],remaining:0,total:1});
 h.intercept(call=>{
  if(call.url==='/api/products/product')return Response.json({product:{id:'product',owner_id:'owner',title:'합성 상품',updated_at:productVersion,image_keys:'["owner/source-a.png"]'}});
  if(call.url.endsWith('/translation'))return Response.json({configuration:plain(configuration.translationConfig),jobs:[]});
  if(call.url.endsWith('/options'))return Response.json({productVersion,options:{productId:'product',revision:optionRevision,rows:[]}});
  if(call.url.endsWith('/content'))return Response.json({content:{productId:'product',schemaVersion:1,revision:contentRevision,assets:{size:{value:[]}}}});
  if(call.url.endsWith('/work-draft'))return Response.json({productId:'product',productVersion});
  if(call.url.endsWith('/registration-layout'))return Response.json({productId:'product',productVersion,sizeChartRequired:false});
  if(call.url.endsWith('/translation-apply')){
   if(call.body.action==='preview')return Response.json({scope:'all',productId:'product',productVersion,contentRevision,optionRevision,fingerprint:hash,preview:[{source:'local-SEO-response'}]});
   assert.equal(call.body.action,'apply');trace.push('seo-save');productVersion=new Date(Date.parse(productVersion)+1).toISOString();contentRevision++;optionRevision++;
   return Response.json({scope:'all',productId:'product',productVersion,contentRevision,optionRevision,applied:1});
  }
  if(call.url.endsWith('/quotation-fields'))return Response.json({revision:1,inputFingerprint:hash,contentRevision,overrides:{common:{},options:{}},categoryContext:{profileId:null,categoryId:'68183',categoryPath:['합성']},resolved:{rows:[{optionId:'option',included:true,fields:{}}],schema:{fields:[],status:'observed',categoryId:'68183',categoryPath:['합성']}}});
  return null;
 });
 h.deps['@/app/batch-selected-image-work'].processSelectedImageStage=async(id,stage,options)=>{
  trace.push(stage);const keys=stage==='main'?['owner/main-source.png']:[`owner/${stage}-a.png`,`owner/${stage}-b.png`];
  let r=runners.get(stage);if(!r){
   r=image.fixture(stage,keys);r.plan.scope.company=plain(company);
   const source=r.deps.readSource;
   r.deps.readSource=async(...args)=>{
    const loaded=await source(...args),contract=r.visionContract;
    const currentConfiguration={provider:'workers-ai-vision',model:contract.IMAGE_TEXT_VISION_MODEL,configured:true,paidAllowed:true,notice:contract.IMAGE_TEXT_VISION_NOTICE};
    assert.ok(contract.parseImageTextVisionConfiguration(currentConfiguration));loaded.visionConfiguration=currentConfiguration;
    if(decision!=='legacy-empty'&&decision!=='unreadable')loaded.noTextProof={policy:contract.IMAGE_TEXT_INSPECTION_POLICY,productId:id,sourceKey:loaded.source.sourceKey,
     sourceSha256:decision==='wrong-sha'?'c'.repeat(64):loaded.source.sourceSha256,width:loaded.width,height:loaded.height,requestId:'11111111-1111-4111-8111-111111111111',sourceLanguage:'zh',configuration:plain(currentConfiguration),verifiedAt:'2026-10-30T00:00:00.000Z'};
    return loaded;
   };
   r.deps.recognize=async loaded=>{r.calls.push(['recognize']);if(decision==='unreadable')loaded.visionResult={provider:'workers-ai-vision',model:r.visionContract.IMAGE_TEXT_VISION_MODEL,requests:1,blocks:[],notice:r.visionContract.IMAGE_TEXT_VISION_NOTICE,inspection:{policy:r.visionContract.IMAGE_TEXT_INSPECTION_POLICY,decision:'unreadable'}};else assert.equal(decision,'legacy-empty','a server-confirmed original must not call OCR again');return[];};
   r.deps.translate=r.deps.render=r.deps.apply=async()=>assert.fail('A no-op must not translate, render or save an image');runners.set(stage,r);
  }
  r.view.productVersion=productVersion;r.view.updatedAt=productVersion;r.plan.tasks[0].productVersion=productVersion;
  const result=await r.model.processSelectedImageStage(id,stage,{...r.options,...options,fetcher:r.options.fetcher},r.deps);
  imageResults.push({stage,result:plain(result)});return result;
 };
 const run=()=>h.run([...stageIds].reverse());
 return{h,runners,imageResults,trace,run};
}

for(const company of [{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}])test(company.name+' fresh whole-work request completes verified unchanged image stages and reaches label/quotation',async()=>{
 const f=fixture(company),result=await f.run();
 assert.deepEqual(plain(result.stages.map(row=>row.id)),stageIds);
 assert.deepEqual(plain(result.stages.map(row=>[row.id,row.status])),stageIds.map(id=>[id,id==='sizeChart'?'skipped':'draft']));
 assert.deepEqual(f.trace,['seo-provider','seo-save','main','additional','detail']);
 assert.deepEqual(f.imageResults.map(({stage,result})=>[stage,result.status,result.applied,result.verifiedUnchanged]),[['main','completed',0,1],['additional','completed',0,2],['detail','completed',0,2]]);
 assert.equal(f.h.calls.filter(call=>call.adapter==='label').length,1);assert.equal(f.h.calls.filter(call=>call.adapter==='packaging').length,1);
 assert.equal(f.h.calls.filter(call=>call.url?.endsWith('/quotation-ai')&&call.method==='POST').length,1);
 assert.ok(!f.h.calls.some(call=>/supplier\.coupang|supplier-hub.*receipt|single-package|submission/.test(call.url??'')));
 for(const r of f.runners.values()){assert.equal(r.calls.filter(call=>['recognize','translate','render','apply'].includes(call[0])).length,0);assert.ok(r.canvases.every(canvas=>canvas.width===0));}
 assert.equal([...f.h.keys.keys()].some(key=>key.includes(':pending:')||key.includes(':write:')||key.endsWith(':vision-inference-pending')),false);
 // A fresh toolbar request has no retained image-stage completion map. The
 // server proof must be verified again, not a client skipped->complete flag.
 f.h.options.keys=new Map();const second=await f.run();assert.equal(second.stages.filter(row=>['mainImage','additionalImages','detailImage'].includes(row.id)).every(row=>row.status==='draft'),true);
 assert.equal(f.imageResults.length,6);assert.equal(f.imageResults.slice(3).every(row=>row.result.status==='completed'&&row.result.verifiedUnchanged>0),true);
});

for(const decision of ['legacy-empty','unreadable'])test('fresh toolbar does not promote '+decision+' OCR into completed translation without server no-text proof',async()=>{
 const f=fixture({code:'A01526306',name:'유앤채'},decision),result=await f.run();
 assert.deepEqual(plain(result.stages.filter(row=>['mainImage','additionalImages','detailImage'].includes(row.id)).map(row=>row.status)),['blocked','blocked','blocked']);
 assert.ok(f.imageResults.every(row=>row.result.status==='partial'&&!row.result.verifiedUnchanged&&row.result.applied===0));
 assert.equal(result.stages.find(row=>row.id==='koreanLabel').status,'draft');assert.equal(result.stages.find(row=>row.id==='quotation').status,'draft');
 for(const r of f.runners.values())assert.equal(r.calls.some(call=>['translate','render','apply'].includes(call[0])),false);
});

test('a server proof bound to different image bytes cannot complete a stage or run later stages',async()=>{
 const f=fixture({code:'A01526306',name:'유앤채'},'wrong-sha'),result=await f.run();
 assert.equal(result.stages.find(row=>row.id==='mainImage').status,'blocked');assert.equal(f.imageResults[0].result.sourceChanged,true);
 assert.ok(result.stages.filter(row=>['additionalImages','detailImage','koreanLabel','quotation'].includes(row.id)).every(row=>row.status==='blocked'));
 assert.equal(f.h.calls.some(call=>call.adapter==='label'||call.adapter==='packaging'||call.url?.endsWith('/quotation-ai')),false);
 assert.equal(f.imageResults[0].result.verifiedUnchanged,undefined);assert.equal(f.imageResults[0].result.applied,0);
});
