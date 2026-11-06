import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {stageDOM,repo} from './helpers/cold-price-main-dom.mjs';
const {mobileIntakeHarness}=await import(pathToFileURL(path.join(repo,'tests/helpers/mobile-intake.mjs')).href);
const {imageBytes}=await import(pathToFileURL(path.join(repo,'tests/helpers/supplier-hub-single-assets.mjs')).href);
const hold=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
async function fixture(){const api=mobileIntakeHarness();await api.intake();const product=await api.load('db/queries.ts').findProduct('owner',api.latest.product_id);return{api,product,base:'/api/products/'+product.id,scope:{ownerId:'owner',company:{code:'A01464742',name:'와이홉'},productId:product.id,productVersion:product.updated_at,sourceUrl:product.source_url,settingsEpoch:0,profileEpoch:0,profileId:null,refresh:0}};}

test('actual response subscribers isolate cancellation and failed reads do not become successful entries',async()=>{
 const f=await fixture(),gate=hold(),calls=[];let fail=false;
 const h=await stageDOM(async()=>{throw Error('factory receives its explicit transport');});
 try{
  const model=h.load('app/registration-ui-reads.tsx'),controllers=new Set(),reads=model.createRegistrationUiReads(f.scope,controllers,async(url,init)=>{calls.push({url,init});if(fail)return Response.json({error:'temporarily unavailable'},{status:503});const reply=await f.api.route(url);await gate.promise;return reply;});
  const a=new AbortController(),b=new AbortController(),one=reads.options(a.signal),two=reads.options(b.signal),cancelled=assert.rejects(one,{name:'AbortError'});a.abort();await cancelled;
  assert.equal(calls.length,1);assert.equal(calls[0].init.signal.aborted,false,'one subscriber does not own shared controller');gate.resolve();const body=await two;
  assert.equal(body.options.productId,f.product.id);assert.equal(controllers.size,0);
  const mutation=reads.beginMutation();await assert.rejects(reads.options(),/저장 상태/);mutation.confirm();fail=true;await assert.rejects(reads.options(),/temporarily/);fail=false;
  const next=await reads.options();assert.deepEqual(next,body);assert.equal(calls.length,3,'failed response was retried, not cached');
 }finally{gate.resolve();await h.close();f.api.close();}
});

for(const dimension of ['owner','company','settings','profile','catalog','version','refresh','source','exit'])test(`actual hook retires ${dimension} A→B→A responses and drawer disposal owns transport abort`,async()=>{
 const f=await fixture(),gates=[],requests=[];let current;
 const h=await stageDOM(async(url,init)=>{const gate=hold();gates.push(gate);requests.push(init);const reply=await f.api.route(url);await gate.promise;return reply;});
 try{
  const {usePriceMainUiReads}=h.load('app/registration-ui-reads.tsx');
  function Probe({scope,catalog}){current=usePriceMainUiReads(scope,catalog);return null;}
  const aCatalog={},bCatalog={},b=dimension==='owner'?{...f.scope,ownerId:'other'}:dimension==='company'?{...f.scope,company:{code:'A01526306',name:'유앤채'}}:dimension==='settings'?{...f.scope,settingsEpoch:1}:dimension==='profile'?{...f.scope,profileId:'different'}:dimension==='catalog'?f.scope:dimension==='version'?{...f.scope,productVersion:'2026-10-01T00:00:00.000Z'}:dimension==='refresh'?{...f.scope,refresh:1}:dimension==='source'?{...f.scope,sourceUrl:'https://detail.1688.com/offer/764000000002.html'}:null;
  await h.render(Probe,{scope:f.scope,catalog:aCatalog});const first=current.options(),old=assert.rejects(first,/저장 상태/);
  await h.render(Probe,{scope:b,catalog:dimension==='catalog'?bCatalog:aCatalog});if(current){const middle=current.options();void middle.catch(()=>{});}
  await h.render(Probe,{scope:f.scope,catalog:aCatalog});const last=current.options();
  assert.ok(requests.every(init=>!init.signal.aborted),'scope retirement does not abort another subscriber transport');
  gates.forEach(gate=>gate.resolve());await old;assert.equal((await last).options.productId,f.product.id);
  const fresh=current.beginMutation();fresh.confirm();const pending=current.options();void pending.catch(()=>{});await h.settle();const lastRequest=requests.at(-1);
  await h.close();assert.equal(lastRequest.signal.aborted,true,'drawer disposal aborts all remaining automatic transports');h.closed=true;
 }finally{gates.forEach(gate=>gate.resolve());if(!h.closed)await h.close();f.api.close();}
});

test('queryless and explicit-profile requests never alias even for the same effective category',async()=>{
 const f=await fixture(),calls=[];const h=await stageDOM(async()=>{throw Error('explicit factory transport only');});
 try{
  const profile=await f.api.load('db/category-profiles.ts').createCategoryProfile('owner',{...f.api.context.category,template:null},f.api.context.category.id);assert.ok(profile);
  const {createRegistrationUiReads}=h.load('app/registration-ui-reads.tsx'),request=async url=>{calls.push(url);return f.api.route(url);};
  const implicit=createRegistrationUiReads(f.scope,new Set(),request),explicit=createRegistrationUiReads({...f.scope,profileId:profile.id},new Set(),request),plain=f.base+'/quotation-fields',selected=plain+'?profileId='+profile.id;
  const first=await implicit.quotation(plain);await assert.rejects(implicit.quotation(selected),/저장 상태/);const second=await explicit.quotation(selected);
  assert.deepEqual(calls,[plain,selected]);assert.notEqual(first.inputFingerprint,second.inputFingerprint);assert.notEqual(first.categoryContext.source,second.categoryContext.source);
 }finally{await h.close();f.api.close();}
});

test('actual main-image dispatch holds sharing before ACK; unknown ACK recovery uses original fresh GETs',async()=>{
 const f=await fixture(),calls=[],gate=hold();let reads,holdPut=true,loseAck=false,failRecovery=false,saved=0;
 const h=await stageDOM(async(url,init={})=>{
  calls.push({url:String(url),method:init.method??'GET',cache:init.cache});
  if(init.method==='PUT'){
   await assert.rejects(reads.options(),/저장 상태/,'writer retires cache synchronously before dispatch');
   if(holdPut)await gate.promise;
   const response=await f.api.route(String(url),{method:'PUT',body:init.body});
   if(loseAck){failRecovery=true;throw Error('lost acknowledgement after real commit');}return response;
  }
  if(failRecovery&&String(url).endsWith('/quotation-fields'))return Response.json({error:'confirmation unavailable'},{status:503});
  return f.api.route(String(url));
 });
 try{
  const model=h.load('app/registration-ui-reads.tsx');reads=model.createRegistrationUiReads(f.scope,new Set(),async(url,init)=>{calls.push({url:String(url),method:init.method??'GET',cache:init.cache});return f.api.route(String(url));});
  const Main=h.load('app/components/option-main-image-editor.tsx').OptionMainImageEditor;
  function Editor(){return h.React.createElement(Main,{uiReads:reads,productId:f.product.id,version:f.product.updated_at,active:true,saveOnSelect:true,onSaved(){saved++;}});}
  await h.render(Editor,{});for(let i=0;i<5;i++)await h.settle();
  const candidate=[...h.container.querySelectorAll('button[aria-label^="최종 대표이미지 "][aria-label$=" 선택"]')].find(node=>node.getAttribute('aria-pressed')==='false'&&!node.disabled);assert.ok(candidate);
  await h.React.act(async()=>candidate.click());for(let i=0;i<5;i++)await h.settle();assert.equal(calls.filter(call=>call.method==='PUT').length,1,JSON.stringify(calls)+' '+h.container.textContent.slice(0,1000));await assert.rejects(reads.quotation(f.base+'/quotation-fields'),/저장 상태/);assert.equal(saved,0);
  loseAck=true;holdPut=false;await h.React.act(async()=>gate.resolve());for(let i=0;i<7;i++)await h.settle();assert.equal(saved,0);assert.equal(h.container.querySelector('[data-workspace-dirty]').getAttribute('data-workspace-dirty'),'true');await assert.rejects(reads.options(),/저장 상태/);
  const before=calls.length;failRecovery=false;loseAck=false;
  const retry=[...h.container.querySelectorAll('button')].find(node=>node.textContent==='선택 유지·최신 대표이미지 조회');assert.ok(retry&&!retry.disabled);await h.React.act(async()=>retry.click());for(let i=0;i<7;i++)await h.settle();
  assert.equal(calls.slice(before).filter(call=>call.method==='PUT').length,0,'read-first recovery never repeats the PUT');assert.ok(calls.slice(before).some(call=>call.url===f.base+'/quotation-fields'&&call.cache==='no-store'),'original fresh recovery GET bypasses shared entry');assert.equal(saved,1);
 }finally{gate.resolve();await h.close();f.api.close();}
});

test('a first main stage launches quote/content/options independently and preserves actual manual blanks, prices and image order',async()=>{
 const f=await fixture(),gates=[],calls=[];let reads;
 const contentDB=f.api.load('db/product-content.ts'),contentModel=f.api.load('app/product-content.ts'),optionDB=f.api.load('db/product-options.ts'),optionModel=f.api.load('app/product-options.ts');
 const beforeContent=await contentDB.readProductContent('owner',f.product.id),keys=JSON.parse(f.product.image_keys);
 const content=contentModel.applyContentPatch(beforeContent,{detail:{description:'',altText:''},assets:{additional:keys.slice(0,3).reverse()}},new Date().toISOString());await contentDB.saveProductContent('owner',content,beforeContent.revision);
 f.product=await f.api.load('db/queries.ts').findProduct('owner',f.product.id);
 const beforeOptions=await optionDB.readProductOptions('owner',f.product.id),rows=optionModel.optionInputs(beforeOptions);rows[0].translatedName='';assert.ok(await optionDB.saveProductOptions('owner',optionModel.applyOptionRows(beforeOptions,rows,new Date().toISOString()),beforeOptions.revision,f.product.updated_at));
 f.product=await f.api.load('db/queries.ts').findProduct('owner',f.product.id);f.scope.productVersion=f.product.updated_at;
 const quote=await(await f.api.route(f.base+'/quotation-fields')).json(),targets=f.api.load('app/quotation-price-targets.ts').quotationPriceTargets(quote.resolved.schema.fields),changes=['supplyPrice','salePrice','msrp'].flatMap((key,index)=>targets[key].linked.map(fieldKey=>({fieldKey,optionId:null,value:String([5775,10500,18900][index])})));
 const write=await f.api.route(f.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:quote.revision,expectedInputFingerprint:quote.inputFingerprint,changes}});assert.equal(write.status,200,await write.clone().text());
 f.product=await f.api.load('db/queries.ts').findProduct('owner',f.product.id);f.scope.productVersion=f.product.updated_at;
 const expectedContent=await(await f.api.route(f.base+'/content')).json(),expectedOptions=await(await f.api.route(f.base+'/options')).json(),expectedQuote=await(await f.api.route(f.base+'/quotation-fields')).json();
 const h=await stageDOM(async(url,init={})=>{calls.push({url:String(url),method:init.method??'GET'});const response=await f.api.route(String(url));const gate=hold();gates.push(gate);await gate.promise;return response;});
 try{
  const model=h.load('app/registration-ui-reads.tsx');reads=model.createRegistrationUiReads(f.scope,new Set(),async(url,init)=>{calls.push({url:String(url),method:init.method??'GET'});const response=await f.api.route(String(url));const gate=hold();gates.push(gate);await gate.promise;return response;});
  const Main=h.load('app/components/option-main-image-editor.tsx').OptionMainImageEditor;
  function View(){return h.React.createElement(Main,{uiReads:reads,productId:f.product.id,version:f.product.updated_at,active:true});}
  await h.render(View,{});assert.deepEqual(new Set(calls.map(call=>call.url)),new Set(['content','options','quotation-fields'].map(resource=>f.base+'/'+resource)),'all three start before any response gate is released');for(let i=0;i<12&&gates.length<3;i++)await h.settle();assert.equal(gates.length,3,'all real API responses reached their deferred gate');
  await h.React.act(async()=>gates.forEach(gate=>gate.resolve()));for(let i=0;i<5;i++)await h.settle();
  assert.deepEqual(await reads.content(),expectedContent);assert.deepEqual(await reads.options(),expectedOptions);assert.deepEqual(await reads.quotation(f.base+'/quotation-fields'),expectedQuote);
  assert.equal(expectedOptions.options.rows[0].translatedName,'');assert.equal(expectedContent.content.detail.altText.value,'');assert.deepEqual(expectedContent.content.assets.additional.value,keys.slice(0,3).reverse());assert.equal(expectedQuote.overrides.common[targets.salePrice.primary],'10500');assert.ok(calls.every(call=>call.method==='GET'));
 }finally{gates.forEach(gate=>gate.resolve());await h.close();f.api.close();}
});

test('restored image job and opening Codex controls do not automatically dispatch mutations',async()=>{
 const f=await fixture(),calls=[];const image=f.api.load('app/automation/image-edit.ts'),key=JSON.parse(f.product.image_keys)[0],metadata=await image.imageMetadata(imageBytes(0).slice(0,-1),'image/png'),review=await image.prepareImageReview({sourceKey:key,prompt:'fixture request',purpose:'cleanup',size:'1024x1024',quality:'low'},metadata,'fixture-only-model',image.imageProcessingSettings(f.api.settings));
 const content=await f.api.load('db/product-content.ts').readProductContent('owner',f.product.id),now=new Date().toISOString();
 await f.api.load('db/queries.ts').saveSettings('owner',JSON.stringify(f.api.settings));
 const stored=await f.api.load('db/image-jobs.ts').createImageJob('owner',{id:crypto.randomUUID(),productId:f.product.id,productVersion:f.product.updated_at,contentRevision:content.revision,status:'prepared',review,result:null,error:null,createdAt:now,approvedAt:null,startedAt:null,finishedAt:null},f.product.image_keys,crypto.randomUUID(),'a'.repeat(64));assert.ok(stored);
 const h=await stageDOM(async(url,init={})=>{calls.push({url:String(url),method:init.method??'GET'});assert.equal(init.method??'GET','GET','restoring job/controls never starts a provider/write');return f.api.route(String(url));});
 try{
  const Panel=h.load('app/components/image-generation-panel.tsx').default,Codex=h.load('app/components/codex-main-image-button.tsx').CodexMainImageButton;
  const props={productId:f.product.id,version:f.product.updated_at,imageKeys:JSON.parse(f.product.image_keys),active:true,translationTarget:{sourceKey:key,sequence:1,sourceLanguage:'zh'}};
  await h.render(Panel,props);for(let i=0;i<5;i++)await h.settle();assert.match(h.container.textContent,/fixture request/);await h.render(Panel,{...props,translationTarget:{...props.translationTarget,sequence:2}});await h.render(Panel,{...props,active:false});await h.render(Panel,props);
  const before=calls.length;await h.render(Codex,{productId:f.product.id,optionId:'fixture-option',sourceKey:key,version:f.product.updated_at,disabled:false});const open=[...h.container.querySelectorAll('button')].find(node=>node.textContent==='Codex로 대표이미지 수정');await h.React.act(async()=>open.click());await h.settle();assert.equal(calls.length,before,'Codex open only changes local prompt UI');assert.ok(calls.every(call=>call.method==='GET'));
 }finally{await h.close();f.api.close();}
});

test('real 409 keeps the main-image choice and an original fresh read cannot revive an obsolete product scope',async()=>{
 const f=await fixture(),calls=[];let reads,race=true;
 const h=await stageDOM(async(url,init={})=>{
  calls.push({url:String(url),method:init.method??'GET'});
  if(init.method==='PUT'&&race){race=false;const current=await(await f.api.route(String(url))).json(),response=await f.api.route(String(url),{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes:[{fieldKey:'model',optionId:null,value:'외부에서 저장한 모델'}]}});assert.equal(response.status,200,await response.clone().text());}
  return f.api.route(String(url),{method:init.method??'GET',body:init.body});
 });
 try{
  const model=h.load('app/registration-ui-reads.tsx');reads=model.createRegistrationUiReads(f.scope,new Set(),async url=>f.api.route(String(url)));const Main=h.load('app/components/option-main-image-editor.tsx').OptionMainImageEditor;
  function View(){return h.React.createElement(Main,{uiReads:reads,productId:f.product.id,version:f.product.updated_at,active:true,saveOnSelect:true});}
  await h.render(View,{});for(let i=0;i<5;i++)await h.settle();const candidate=[...h.container.querySelectorAll('button[aria-label^="최종 대표이미지 "][aria-label$=" 선택"]')].find(node=>node.getAttribute('aria-pressed')==='false'&&!node.disabled),label=candidate?.getAttribute('aria-label');assert.ok(candidate);
  await h.React.act(async()=>candidate.click());for(let i=0;i<6;i++)await h.settle();assert.equal(calls.filter(call=>call.method==='PUT').length,1);assert.equal(h.container.querySelector('[data-workspace-dirty]').getAttribute('data-workspace-dirty'),'true');assert.equal(h.container.querySelector(`[aria-label="${label}"]`).getAttribute('aria-pressed'),'true');await assert.rejects(reads.options(),/저장 상태/);
  const before=calls.length,refresh=[...h.container.querySelectorAll('button')].find(node=>node.textContent==='선택 유지·최신 대표이미지 조회');await h.React.act(async()=>refresh.click());for(let i=0;i<5;i++)await h.settle();assert.ok(calls.slice(before).some(call=>call.method==='GET'&&call.url===f.base+'/quotation-fields'));assert.equal(calls.slice(before).filter(call=>call.method==='PUT').length,0);assert.equal(h.container.querySelector('[data-workspace-dirty]').getAttribute('data-workspace-dirty'),'true','uncommitted manual image choice survives fresh 409 reload');await assert.rejects(reads.options(),/저장 상태/,'the original product scope remains held when the server clock moved');
  const latest=await f.api.load('db/queries.ts').findProduct('owner',f.product.id),next=model.createRegistrationUiReads({...f.scope,productVersion:latest.updated_at},new Set(),async url=>f.api.route(String(url)));assert.equal((await next.options()).productVersion,latest.updated_at);
 }finally{await h.close();f.api.close();}
});

test('actual Codex start holds UI reuse before its first CLI read and never resumes an unknown upload from open',async()=>{
 const f=await fixture(),calls=[];let reads;
 const h=await stageDOM(async(url,init={})=>{calls.push({url:String(url),method:init.method??'GET'});await assert.rejects(reads.options(),/저장 상태/);return Response.json({error:'offline fixture has no CLI session'},{status:503});});
 try{
  const model=h.load('app/registration-ui-reads.tsx');reads=model.createRegistrationUiReads(f.scope,new Set(),async url=>f.api.route(String(url)));await reads.options();const Codex=h.load('app/components/codex-main-image-button.tsx').CodexMainImageButton;
  function View(){return h.React.createElement(Codex,{uiReads:reads,productId:f.product.id,optionId:'fixture-option',sourceKey:JSON.parse(f.product.image_keys)[0],version:f.product.updated_at,disabled:false});}
  await h.render(View,{});assert.equal(calls.length,0);const open=[...h.container.querySelectorAll('button')].find(node=>node.textContent==='Codex로 대표이미지 수정');await h.React.act(async()=>open.click());assert.equal(calls.length,0);const start=[...h.container.querySelectorAll('button')].find(node=>node.textContent==='수정 요청');await h.React.act(async()=>start.click());for(let i=0;i<4;i++)await h.settle();assert.ok(calls.length>0);assert.ok(calls.every(call=>call.method==='GET'),'no image/CLI/provider write without an available session');
 }finally{await h.close();f.api.close();}
});

test('retiring a pending first-main library on stage exit cannot start hidden fallback GETs',async()=>{
 const f=await fixture(),gate=hold(),native=[];const h=await stageDOM(async url=>{native.push(String(url));return f.api.route(String(url));});
 try{
  const model=h.load('app/registration-ui-reads.tsx'),reads=model.createRegistrationUiReads(f.scope,new Set(),async url=>{const response=await f.api.route(String(url));if(!String(url).endsWith('/quotation-fields'))await gate.promise;return response;}),Main=h.load('app/components/option-main-image-editor.tsx').OptionMainImageEditor,props={uiReads:reads,productId:f.product.id,version:f.product.updated_at,active:true};
  await h.render(Main,props);for(let i=0;i<4;i++)await h.settle();reads.retire();await h.render(Main,{...props,active:false});await h.React.act(async()=>gate.resolve());for(let i=0;i<7;i++)await h.settle();assert.deepEqual(native,[],'retired automatic UI data must not launch new hidden display fallback reads');
 }finally{gate.resolve();await h.close();f.api.close();}
});
