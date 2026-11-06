import test from 'node:test';
import assert from 'node:assert/strict';
import {stageRefreshDOM} from './helpers/stage-refresh-dom.mjs';

const version='2026-11-06T00:00:00.000Z',nextVersion='2026-11-06T00:00:01.000Z';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const reactProps=node=>node[Object.keys(node).find(key=>key.startsWith('__reactProps'))];
const button=(h,label)=>[...h.container.querySelectorAll('button')].find(node=>node.textContent===label);
async function click(h,label){const node=button(h,label);assert.ok(node&&!node.disabled,label);await h.React.act(async()=>node.click());await h.settle();}
function fixture(h,clock=version){
 const content=h.load('app/product-content.ts').emptyProductContent('p'),model=h.load('app/product-options.ts');
 content.revision=2;content.assets.main.value=['owner/raw.png','owner/other.png'];content.assets.additional.value=['owner/extra.png'];
 const options=model.applyOptionRows(model.emptyProductOptions('p'),[{...model.emptyOptionInput('red'),originalName:'red',translatedName:'red',imageKey:'owner/raw.png',included:true,unitCostCny:3}],clock);
 const product={id:'p',owner_id:'owner',title:'test',updated_at:clock,image_keys:'["owner/raw.png","owner/extra.png","owner/other.png"]',supply_price:2000,sale_price:3000,msrp:4000,exchange_rate:200,supply_margin:0,coupang_margin:0};
 const source={categoryId:'80719',product,content,settings:h.load('app/workspace-settings.ts').defaultSettings,options};
 const resolved=h.load('app/quotation-schema.ts').resolveQuotationFields(source);
 const quote={revision:1,inputFingerprint:'a'.repeat(64),overrides:h.load('app/quotation-schema.ts').emptyQuotationOverrides(),resolved,automatic:resolved,imageKeys:JSON.parse(product.image_keys),protectedDetailImageKeys:[],categoryContext:{source:'collection',profileId:null,categoryId:'80719',categoryPath:[]},productVersion:clock,updatedAt:clock,contentRevision:2,optionRevision:options.revision};
 const optionsBody={productVersion:clock,options,imageLibrary:{format:'main-image-library-evidence-v1',productId:'p',productVersion:clock,optionRevision:options.revision,company:{code:'A01526306',name:'유앤채'},source:{jobId:'source-fixture',receivedAt:clock,fingerprint:'b'.repeat(64)},work:[],main:['owner/raw.png','owner/other.png'],options:['owner/raw.png'],detail:['owner/extra.png']}};
 const image={configuration:{configured:true,issues:[]},settings:{translateImages:true,removeBackground:false,addCopyright:false,translationPrompt:''},settingsFingerprint:'settings',jobs:[],product:{id:'p',version:clock,imageKeys:quote.imageKeys}};
 const translation={configuration:{configured:true,issues:[],model:'qwen',destination:'test'},jobs:[]};
 return {content,product,quote,optionsBody,image,translation,reply(url){url=String(url).split('?')[0];if(url.endsWith('/translation-source'))return Response.json({error:'no collected source'},{status:404});return Response.json(url.endsWith('/translation')?translation:url.endsWith('/image-generation')?image:url.endsWith('/quotation-fields')?quote:url.endsWith('/options')?optionsBody:url.endsWith('/content')?{content}:{product});}};
}

test('actual legacy readers defer hidden initial and changed-version reads without advertising idle work',async()=>{
 const calls=[],busy=[];const h=await stageRefreshDOM(async url=>{calls.push(String(url));return Response.json({error:'hidden reader must not fetch'},{status:503});});
 try{
  const Translation=h.load('app/components/translation-panel.tsx').default,Image=h.load('app/components/image-generation-panel.tsx').default;
  function Readers(props){return h.React.createElement(h.React.Fragment,null,h.React.createElement(Translation,{productId:'p',title:'source',active:false,...props}),h.React.createElement(Image,{productId:'p',imageKeys:['owner/raw.png'],active:false,onBusyChange:value=>busy.push(value),...props}));}
  await h.render(Readers,{version});assert.deepEqual(calls,[]);assert.equal(busy.at(-1),false);assert.equal(h.container.querySelector('[data-workspace-saving]').getAttribute('data-workspace-saving'),'false');
  await h.render(Readers,{version:nextVersion});assert.deepEqual(calls,[]);assert.equal(busy.at(-1),false);
 }finally{await h.close();}
});

for(const kind of ['translation','image-generation'])test(`actual ${kind} retains a successful current read and entered text on stage reentry`,async()=>{
 const calls=[];let f;const h=await stageRefreshDOM(async url=>{calls.push(String(url));return f.reply(url);});
 try{
  f=fixture(h);const Component=h.load(`app/components/${kind}-panel.tsx`).default,events=[];
  const props={productId:'p',version,title:'source',imageKeys:f.quote.imageKeys,active:true,onAvailabilityChange:value=>events.push(value)};
  await h.render(Component,props);const first=calls.length;assert.equal(first,kind==='translation'?3:1);
  const input=h.container.querySelector(kind==='translation'?'input[maxlength="1000"]':'textarea[maxlength="4000"]');assert.ok(input);await h.React.act(async()=>reactProps(input).onChange({target:{value:'preserved draft'}}));
  await h.render(Component,{...props,active:false});await h.render(Component,props);assert.equal(calls.length,first,'unchanged reentry must reuse the successful read');assert.equal(h.container.querySelector(kind==='translation'?'input[maxlength="1000"]':'textarea[maxlength="4000"]').value,'preserved draft');
  if(kind==='image-generation')assert.equal(events.at(-1)?.configured,true,'current source availability must be republished for the visible image stage');
  f=fixture(h,nextVersion);await h.render(Component,{...props,active:false,version:nextVersion});assert.equal(calls.length,first);await h.render(Component,{...props,version:nextVersion});assert.equal(calls.length,first*2,'a changed source requires a new read');
 }finally{await h.close();}
});

for(const kind of ['translation','image-generation'])test(`actual ${kind} hides only automatic reads and does not cancel an explicit pending action`,async()=>{
 const hold=deferred(),calls=[];let f,actionSignal;const h=await stageRefreshDOM(async(url,init={})=>{calls.push({url:String(url),method:init.method??'GET'});if(init.method==='POST'){actionSignal=init.signal;return hold.promise;}return f.reply(url);});
 try{
  f=fixture(h);const Component=h.load(`app/components/${kind}-panel.tsx`).default,props={productId:'p',version,title:'source',imageKeys:f.quote.imageKeys,active:true};
  await h.render(Component,props);await click(h,kind==='translation'?'번역 요청 검토하기 · 무료':'이미지 요청 검토하기 · 무료');assert.ok(actionSignal&&!actionSignal.aborted);
  await h.render(Component,{...props,active:false});assert.equal(actionSignal.aborted,false,'stage hiding must not cancel an explicit request');
  if(kind==='translation')assert.equal(h.container.querySelector('[data-workspace-saving]').getAttribute('data-workspace-saving'),'true');
  await h.React.act(async()=>hold.resolve(Response.json({error:'explicit action failed'},{status:503})));await h.settle();assert.match(h.container.textContent,/explicit action failed/);assert.equal(calls.filter(row=>row.method==='POST').length,1);
  const count=calls.length;await h.render(Component,props);assert.equal(calls.length,count,'stage reentry cannot replay the explicit action');
 }finally{hold.resolve(Response.json({error:'cleanup'},{status:503}));await h.close();}
});

for(const kind of ['translation','image-generation'])test(`actual ${kind} retires an unfinished hidden read and retries failed history only on activation`,async()=>{
 const hold=deferred(),calls=[],events=[];let f,mode='held';const h=await stageRefreshDOM(async(url,init={})=>{calls.push({url:String(url),signal:init.signal});if(mode==='held')await hold.promise;if(mode==='fail')return Response.json({error:'history unavailable'},{status:503});return f.reply(url);});
 try{
  f=fixture(h);const Component=h.load(`app/components/${kind}-panel.tsx`).default,props={productId:'p',version,title:'source',imageKeys:f.quote.imageKeys,active:true,onAvailabilityChange:value=>events.push(value)};
  await h.render(Component,props);const initial=calls.length;assert.equal(initial,kind==='translation'?2:1);await h.render(Component,{...props,active:false});assert.ok(calls.every(row=>row.signal.aborted));
  const eventCount=events.length;mode='ready';await h.React.act(async()=>hold.resolve());await h.settle();assert.equal(calls.length,initial,'retired translation state cannot start source prefill');assert.equal(events.length,eventCount,'retired image history cannot publish availability');
  mode='fail';await h.render(Component,props);assert.ok(h.container.querySelector('[role=alert]'));const failed=calls.length;await h.settle();await h.settle();assert.equal(calls.length,failed,'no active automatic retry loop');
  mode='ready';await h.render(Component,{...props,active:false});await h.render(Component,props);assert.equal(calls.length,failed+(kind==='translation'?3:1));assert.equal(h.container.querySelector('[role=alert]'),null);
 }finally{hold.resolve();await h.close();}
});

for(const kind of ['translation','image-generation'])test(`actual ${kind} activation cannot replace an explicit history refresh in flight`,async()=>{
 const hold=deferred(),calls=[];let f,holdRefresh=false;const h=await stageRefreshDOM(async(url,init={})=>{calls.push({url:String(url),signal:init.signal});if(holdRefresh)await hold.promise;return f.reply(url);});
 try{
  f=fixture(h);const Component=h.load(`app/components/${kind}-panel.tsx`).default,props={productId:'p',version,title:'source',imageKeys:f.quote.imageKeys,active:true};
  await h.render(Component,props);holdRefresh=true;await click(h,kind==='translation'?'작업 상태 다시 조회 · 무료':'저장된 설정·실행 이력 새로고침 · 무료');const count=calls.length,refreshSignals=calls.slice(kind==='translation'?3:1).map(row=>row.signal);assert.equal(refreshSignals.length,kind==='translation'?2:1);
  await h.render(Component,{...props,active:false});await h.render(Component,props);assert.equal(calls.length,count,'automatic activation must not replace the explicit refresh request');assert.ok(refreshSignals.every(signal=>!signal.aborted));
  await h.React.act(async()=>hold.resolve());await h.settle();assert.equal(button(h,kind==='translation'?'작업 상태 다시 조회 · 무료':'저장된 설정·실행 이력 새로고침 · 무료').disabled,false);
 }finally{hold.resolve();await h.close();}
});

test('actual additional image library reuses only the verified current view and retries unverified evidence',async()=>{
 const calls=[];let f,failLibrary=false;const h=await stageRefreshDOM(async url=>{calls.push(String(url));return failLibrary&&String(url).endsWith('/options')?Response.json({error:'library unavailable'},{status:503}):f.reply(url);});
 try{
  f=fixture(h);const Editor=h.load('app/components/option-image-editor.tsx').OptionImageEditor,props={productId:'p',optionId:'red',version,stage:'additional',saveOnChange:true,active:true};
  await h.render(Editor,props);assert.equal(calls.length,3);assert.match(h.container.textContent,/메인 이미지/);
  await h.render(Editor,{...props,active:false,saveOnChange:false});await h.render(Editor,props);assert.equal(calls.length,3,'valid current library has no repeat content/options GET');
  failLibrary=true;await h.render(Editor,{...props,refreshToken:'changed'});assert.equal(calls.length,6);assert.doesNotMatch(h.container.textContent,/메인 이미지/);
  failLibrary=false;await h.render(Editor,{...props,active:false,saveOnChange:false,refreshToken:'changed'});await h.render(Editor,{...props,refreshToken:'changed'});assert.equal(calls.length,8,'failed library is retried; current quotation itself is reused');assert.match(h.container.textContent,/메인 이미지/);
  f=fixture(h,nextVersion);await h.render(Editor,{...props,active:false,version:nextVersion,refreshToken:'changed'});assert.equal(calls.length,8);await h.render(Editor,{...props,version:nextVersion,refreshToken:'changed'});assert.equal(calls.length,11,'changed source revalidates all three reads');
  await h.render(Editor,{...props,version:nextVersion,refreshToken:'changed',optionId:'blue',active:false});await h.render(Editor,{...props,version:nextVersion,refreshToken:'changed',active:false});await h.render(Editor,{...props,version:nextVersion,refreshToken:'changed'});assert.equal(calls.length,13,'a hidden A-B-A scope change cannot reuse old library evidence');
 }finally{await h.close();}
});

test('actual size chart stage reuses a successful snapshot but not a changed source or profile episode',async()=>{
 const calls=[];let f;const h=await stageRefreshDOM(async url=>{calls.push(String(url));return f.reply(url);});
 try{
  f=fixture(h);const Editor=h.load('app/components/size-chart-workspace.tsx').SizeChartWorkspace,props={productId:'p',version,profileId:'profile-a',active:true};
  await h.render(Editor,props);assert.equal(calls.length,3);assert.equal(h.container.querySelector('[data-size-chart-workspace]').getAttribute('aria-busy'),'false');
  await h.render(Editor,{...props,active:false});await h.render(Editor,props);await h.render(Editor,{...props,disabled:true});await h.render(Editor,props);assert.equal(calls.length,3,'same verified source must not repeat the product/content/product proof');
  await h.render(Editor,{...props,active:false,profileId:'profile-b'});await h.render(Editor,{...props,active:false});await h.render(Editor,props);assert.equal(calls.length,6,'A-B-A profile episode cannot reuse the old A proof');
  f=fixture(h,nextVersion);await h.render(Editor,{...props,active:false,version:nextVersion});assert.equal(calls.length,6);await h.render(Editor,{...props,version:nextVersion});assert.equal(calls.length,9,'changed source still uses all three proof reads');
 }finally{await h.close();}
});

test('actual size chart read errors retry on activation and old hidden results never become reusable proof',async()=>{
 const calls=[],hold=deferred();let f,mode='fail';const h=await stageRefreshDOM(async url=>{calls.push(String(url));if(mode==='fail'){mode='ready';return Response.json({error:'read failed'},{status:503});}if(mode==='held'){mode='ready';return hold.promise;}return f.reply(url);});
 try{
  f=fixture(h);const Editor=h.load('app/components/size-chart-workspace.tsx').SizeChartWorkspace,props={productId:'p',version,active:true};
  await h.render(Editor,props);assert.equal(calls.length,1);assert.ok(h.container.querySelector('[role=alert]'));
  await h.render(Editor,{...props,active:false});await h.render(Editor,props);assert.equal(calls.length,4,'failed read is not a successful cache');
  mode='held';f=fixture(h,nextVersion);await h.render(Editor,{...props,version:nextVersion});assert.equal(calls.length,5);await h.render(Editor,{...props,version:nextVersion,active:false});
  await h.React.act(async()=>hold.resolve(Response.json({product:f.product})));await h.settle();const before=calls.length;await h.render(Editor,{...props,version:nextVersion});assert.equal(calls.length,before+3,'a retired response cannot suppress a new complete proof');
 }finally{hold.resolve(Response.json({product:f?.product}));await h.close();}
});

test('actual DetailPanel expands legacy translation explicitly and keeps image availability within image stages',async()=>{
 const calls=[];let f;const h=await stageRefreshDOM(async url=>{calls.push(String(url));return f.reply(url);},{components:{'translation-panel':true,'image-generation-panel':true}});
 try{
  f=fixture(h);const Detail=h.load('app/components/dashboard-client.tsx').DetailPanel,props={product:f.product,settings:h.load('app/workspace-settings.ts').defaultSettings,onSaved(){},onUpload(){},onSavePrice:async()=>{},onManageCategories(){},onBeforeFreeImageApply:()=>true,onBeforeSeoGenerate:()=>true,onPrepareSubmission(){},onReviewPackaging(){}};
  await h.render(Detail,{...props,tab:'SEO'});assert.deepEqual(calls,[],'collapsed SEO history has no legacy automatic reads');
  const details=[...h.container.querySelectorAll('details')].find(node=>node.querySelector('summary')?.textContent==='SEO 생성 이력 · 원문 확인 · 미번역 옵션');assert.ok(details);await h.React.act(async()=>reactProps(details).onToggle({currentTarget:{open:true}}));await h.settle();assert.equal(calls.length,3);
  await h.render(Detail,{...props,tab:'대표 이미지'});assert.equal(calls.filter(url=>url.endsWith('/image-generation')).length,1,'collapsed image details still supply visible main-image availability');
  await h.render(Detail,{...props,tab:'SEO'});const before=calls.length;f=fixture(h,nextVersion);await h.render(Detail,{...props,product:f.product,tab:'SEO'});assert.equal(calls.slice(before).some(url=>url.endsWith('/image-generation')),false,'SEO source save cannot wake the hidden image panel');
 }finally{await h.close();}
});
