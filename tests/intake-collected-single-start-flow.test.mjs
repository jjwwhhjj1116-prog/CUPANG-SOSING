import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {companies,syntheticSnapshot,plain} from './helpers/supplier-hub-single-projection.mjs';

// Reuse only the inert DOM adapter and capture declarations, never its tests.
const fixtureURL=pathToFileURL(process.cwd()+'/tests/page-dom-source-intake-flow.test.mjs');
const fixtureText=fs.readFileSync(fixtureURL,'utf8'),ast=ts.createSourceFile(fixtureURL.href,fixtureText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declarations=ast.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)&&['documentFromHtml','capturedPage','retainedProduct'].includes(node.name?.text));
const fixtureSource=declarations.map(node=>{let value=node.getFullText(ast);if(ts.isImportDeclaration(node)){const name=node.moduleSpecifier.text;if(!name.startsWith('node:'))value=value.replace("'"+name+"'",JSON.stringify(name.startsWith('.')?new URL(name,fixtureURL).href:import.meta.resolve(name)));}return value;}).join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureURL.href))+'\nexport {capturedPage,retainedProduct,images,offerId,sourceUrl};';
const {capturedPage,retainedProduct,images,offerId,sourceUrl}=await import('data:text/javascript,'+encodeURIComponent(fixtureSource));
const native=createRequire(import.meta.url),nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};

function queueUI(h,{rows:initialRows,settings,profile,sourceItems,fetcher}){
 const slots=[],layouts=[],effects=[],busy=[],opened=[],collectionCalls=[];let cursor=0,rows=initialRows,jobs=[],closed=false;
 const effect=(queue,fn,deps)=>{const index=cursor++,old=slots[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps[i]))){slots[index]={deps,cleanup:old?.cleanup};queue.push(()=>{slots[index].cleanup?.();slots[index].cleanup=fn();});}};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{assert.equal(closed,false,'no late state update');slots[i]=typeof value==='function'?value(slots[i]):value;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useLayoutEffect(fn,deps){effect(layouts,fn,deps);},useEffect(fn,deps){effect(effects,fn,deps);}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/intake-queue-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,Error,URL,URLSearchParams,AbortController,AbortSignal,crypto,fetch:fetcher,require(name){
   if(name==='react')return hooks;if(name==='@/app/components/category-picker')return{CategoryPicker:()=>null};if(name==='@/app/components/intake-quotation-preview')return{IntakeQuotationPreview:()=>null};
   if(name==='@/app/browser-product-bridge')return{capture1688FromChrome:()=>assert.fail('No real browser source'),probe1688FromChrome:()=>assert.fail('No real source probe')};
   if(name==='@/app/intake-collection')return{collectIntakeProduct(job,options){collectionCalls.push({job:plain(job),capture:plain(options.selectedCapture)});return h.load('app/intake-collection.ts').collectIntakeProduct(job,options);}};
   return name.startsWith('@/')?h.load(name.slice(2)+'.ts'):native(name);
  },
 });
 const render=()=>{if(closed)return null;cursor=0;const tree=exports.IntakeQueuePanel({workspaceOwnerId:'owner',rows,settings,profiles:[profile],sourceItems,jobs,goal:'work',onGoal(){},onRows(update){rows=update(rows);},onProfile(){},onAdvanced(){},onJobs(values){jobs=[...values,...jobs.filter(job=>!values.some(value=>value.id===job.id))];},onBusy(value){busy.push(value);},onSettingsReloaded(){},onOpenProduct:async(id,signal)=>{assert.equal(signal.aborted,false);const seo=await json(await fetcher('/api/products/'+id+'/seo-workspace',{signal}));opened.push({id,stage:'SEO',seo});}});layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;};
 render();return{render,busy,opened,collectionCalls,get rows(){return rows;},button(label){return nodes(render()).find(node=>node.type==='button'&&text(node)===label);},async finish(){for(let count=0;count<3000;count++){render();if(busy.length&&busy.at(-1)===false)return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Isolated collection did not settle: '+text(render()));},close(){if(closed)return;closed=true;for(const slot of slots)slot?.cleanup?.();}};
}

for(const company of companies)for(const outcome of ['created','late-reused'])test(`${company.code}: actual item button ${outcome==='created'?'creates and opens only its new SEO workspace':'preserves concurrent existing work and never auto-opens it'} through API/SQLite`,async()=>{
 let sourceRequests=0,aiCalls=0,competitorId=null,reusedBefore=null,objectsBefore=null,reusedAcks=0;const apiCalls=[];
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,fixtureImageUrls:images,sourceFetcher:()=>{sourceRequests++;assert.fail('No supplier URL fetch is authorized by this synthetic test');}});let ui;
 try{
  const settings={...h.settings,brand:company.name};await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(settings));
  const translations=new Map([['黑色 / 均码','검정 / 프리'],['灰色 / 均码','회색 / 프리']]);
  h.bindings.AI.run=async(_model,input)=>{aiCalls++;const source=JSON.parse(input.messages[1].content);return{response:{title:'합성 단일 초안',description:'합성 검수 설명',keywords:['검수 상품'],warnings:[],attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name,value:translations.get(pair.value)??pair.value}))}};};
  const oldId='synthetic-protected-single-start-770',oldKey='owner/protected-single-start-770.png',policy=h.load('app/pricing.ts').pricePolicy(settings),birth=new Date().toISOString();
  h.objects.set(oldKey,Uint8Array.of(1,7,7,0));
  await h.load('db/queries.ts').insertProduct({id:oldId,owner_id:'owner',source_url:'synthetic://protected-work-770',title:'기존 합성 작업 유지',source_price_cny:8,exchange_rate:policy.exchangeRate,supply_margin:policy.supplyMargin,coupang_margin:policy.coupangMargin,supply_price:5600,sale_price:9340,msrp:12150,options_count:1,seo_status:'완료',image_status:'완료',quote_status:'대기',registration_status:'대기',supplier_hub_status:'미전송',image_keys:JSON.stringify([oldKey]),goal_stage:'work',created_at:birth,updated_at:birth},policy);
  const oldContent=h.load('app/product-content.ts').emptyProductContent(oldId);oldContent.revision=1;oldContent.updatedAt=birth;
  h.sqlite.prepare('INSERT INTO product_content(product_id,owner_id,revision,payload,updated_at) VALUES(?,?,?,?,?)').run(oldId,'owner',1,JSON.stringify(oldContent),birth);
  const oldBefore=retainedProduct(h,oldId),oldBytes=Buffer.from(h.objects.get(oldKey)).toString('hex'),oldJob=JSON.stringify(h.sqlite.prepare("SELECT * FROM collection_jobs WHERE id='job'").get()),oldContext=JSON.stringify(h.sqlite.prepare("SELECT * FROM collection_context WHERE job_id='job'").get());
  const snapshot=syntheticSnapshot(company),profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'SYNTHETIC-SINGLE-START-770',categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,template:null,mappings:[],hubSchema:snapshot});
  const source=capturedPage(),fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(source),captureId='00000000-0000-4000-8000-000000000770';
  await json(await h.load('app/api/source-inbox/route.ts').POST(new Request('https://app.test/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:'owner',expectedCompany:company,id:captureId,fingerprint,snapshot:source})})));
  const ready=await json(await h.load('app/api/source-inbox/ready/route.ts').GET(new Request('https://app.test/api/source-inbox/ready?'+new URLSearchParams({sourceUrl,captureId,fingerprint,revision:'1'}))));
  const item=await h.load('db/source-inbox.ts').readSourceInbox('owner',captureId),sourceBefore=JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox WHERE id=?').get(captureId));
  const queue=h.load('app/intake-queue.ts'),previous={...queue.intakeRow(profile,'previous-invalid-row'),url:'이전 미완성 URL',features:'기존 입력 보관',message:'작업 중 입력 유지'},selected={...queue.intakeRow(profile,'selected-source-row'),url:sourceUrl,sourceCapture:ready.capture};
  const fetcher=async(path,init={})=>{assert.ok(path.startsWith('/api/'),'Only local app APIs are available');apiCalls.push({path,method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});
   if(path==='/api/collection-jobs'||path.startsWith('/api/collection-jobs?'))return h.load('app/api/collection-jobs/route.ts')[init.method??'GET'](new Request('https://app.test'+path,{...init,headers:{'content-type':'application/json'}}));
   const request={method:init.method??'GET',body:init.body};
   if(outcome==='late-reused'&&path.endsWith('/product')&&request.method==='POST'&&!competitorId){
    const ack=await json(await h.route(path,request));assert.equal(ack.reused,false);competitorId=ack.productId;
    const jobPath=path.slice(0,-'/product'.length);
    for(let index=0;index<images.length;index++)await json(await h.route(jobPath+'/images',{method:'POST',body:{index,assignToStage:false}}));
    const content=(await json(await h.route('/api/products/'+competitorId+'/content'))).content;
    await json(await h.route('/api/products/'+competitorId+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'다른 화면에서 검토한 상품',keywords:['기존 검토 유지']}}}}));
    reusedBefore=retainedProduct(h,competitorId);objectsBefore=JSON.stringify([...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('hex')]));
   }
   const response=await h.route(path,request);
   if(outcome==='late-reused'&&path.endsWith('/product')&&request.method==='POST'){const ack=await response.clone().json();assert.equal(ack.reused,true);assert.equal(ack.productId,competitorId);reusedAcks++;}
   return response;};
  ui=queueUI(h,{rows:[previous,selected],settings,profile,sourceItems:[item],fetcher});const previousBefore=JSON.stringify(previous),button=ui.button('이 상품 초안 작성');assert.ok(button);assert.equal(apiCalls.length,0);
  button.props.onClick();button.props.onClick();await ui.finish();
  assert.equal(ui.rows[1].status,'saved',text(ui.render()));assert.equal(ui.rows[0],previous);assert.equal(JSON.stringify(ui.rows[0]),previousBefore);
  const productId=ui.rows[1].productId;assert.ok(productId);assert.notEqual(productId,oldId);
  if(outcome==='created'){
   assert.deepEqual(ui.opened.map(open=>[open.id,open.stage]),[[productId,'SEO']]);assert.equal(ui.opened[0].seo.content.seo.title.value,company.name+' 합성 단일 초안');assert.equal(ui.opened[0].seo.options.rows.length,2);
  }else{
   assert.equal(ui.opened.length,0);assert.equal(productId,competitorId);assert.equal(reusedAcks,1);assert.equal(ui.collectionCalls[0].job.product_id,null,'initial job has no product before the actual concurrent import');
   assert.equal(retainedProduct(h,competitorId),reusedBefore);assert.equal(JSON.stringify([...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('hex')])),objectsBefore);assert.equal(aiCalls,0);
   assert.ok(ui.button('초안 확인·수정'),'existing work remains available through its explicit open action');
  }
  const posts=apiCalls.filter(call=>call.path==='/api/collection-jobs'&&call.method==='POST');assert.equal(posts.length,1);assert.deepEqual(posts[0].body.urls,[sourceUrl]);assert.equal(posts[0].body.profileId,profile.id);assert.equal(posts[0].body.expectedProfileRevision,profile.revision);
  assert.equal(ui.collectionCalls.length,1);assert.deepEqual(ui.collectionCalls[0].capture,ready.capture);const jobId=ui.collectionCalls[0].job.id;
  const finished=await json(await fetcher('/api/collection-jobs?id='+jobId));assert.equal(finished.job.product_id,productId);assert.ok(finished.job.received_at);assert.equal(finished.job.context.company.code,company.code);assert.equal(finished.job.context.category.id,profile.id);
  const receipt=await h.load('db/collection-results.ts').readCollectionResult('owner',jobId);assert.equal(receipt.result.offerId,offerId);assert.equal(receipt.result.sourceUrl,sourceUrl);assert.equal(receipt.result.provider,'chrome-current-page-v1');
  const generated=h.sqlite.prepare("SELECT status FROM translation_jobs WHERE product_id=? AND idempotency_key='intake-auto-v1'").get(productId);if(outcome==='created')assert.equal(generated.status,'completed');else assert.equal(generated,undefined);
  assert.equal(retainedProduct(h,oldId),oldBefore);assert.equal(Buffer.from(h.objects.get(oldKey)).toString('hex'),oldBytes);assert.equal(JSON.stringify(h.sqlite.prepare("SELECT * FROM collection_jobs WHERE id='job'").get()),oldJob);assert.equal(JSON.stringify(h.sqlite.prepare("SELECT * FROM collection_context WHERE job_id='job'").get()),oldContext);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox WHERE id=?').get(captureId)),sourceBefore);
  assert.deepEqual(ui.busy,[true,false]);assert.equal(sourceRequests,0);assert.ok(h.network.every(host=>host==='cbu01.alicdn.com'));assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM supplier_hub_receipts').get().n,0);assert.ok(apiCalls.every(call=>!call.path.includes('dispatch')&&!call.path.includes('submit')));
 }finally{ui?.close();h.close();}
});
