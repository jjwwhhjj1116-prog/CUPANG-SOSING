import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {stageDOM,repo} from './helpers/cold-price-main-dom.mjs';
const {mobileIntakeHarness}=await import(pathToFileURL(path.join(repo,'tests/helpers/mobile-intake.mjs')).href);
const gate=()=>{let resolve;return{promise:new Promise(done=>resolve=done),resolve:()=>resolve()};};
const props=node=>node[Object.getOwnPropertyNames(node).find(key=>key.startsWith('__reactProps$'))];

test('actual common SEO writer holds before ACK, retains manual blank on lost ACK and confirms only its original fresh recovery',async()=>{
 const api=mobileIntakeHarness(),ack=gate(),calls=[];let h,reads,dispatched=false,heldAtDispatch=false;
 try{
  await api.intake();const product=await api.load('db/queries.ts').findProduct('owner',api.latest.product_id),base='/api/products/'+product.id;
  h=await stageDOM(async(url,init={})=>{url=String(url);const method=init.method??'GET';calls.push({url,method});if(method==='PATCH'){dispatched=true;try{await reads.options();}catch{heldAtDispatch=true;}const response=await api.route(url,init);assert.equal(response.status,200);await ack.promise;throw Error('lost committed ACK');}return api.route(url,init);});
  const {createRegistrationUiReads}=h.load('app/registration-ui-reads.tsx');reads=createRegistrationUiReads({ownerId:'owner',company:{code:'A01464742',name:'와이홉'},productId:product.id,productVersion:product.updated_at,sourceUrl:product.source_url,settingsEpoch:0,profileEpoch:0,profileId:null,refresh:0},new Set(),url=>api.route(url));await reads.options();
  let begins=0,saved=0;await h.render(h.load('app/components/seo-workspace-editor.tsx').SeoWorkspaceEditor,{productId:product.id,version:product.updated_at,workspaceOwnerId:'owner',active:true,onBeginSourceWrite:()=>{begins++;return reads.beginMutation();},onSaved:()=>saved++});
  for(let i=0;i<20&&!h.container.querySelector('[aria-label="1번째 한국어 옵션명"]');i++)await h.settle();
  const input=h.container.querySelector('[aria-label="1번째 한국어 옵션명"]');assert.ok(input);await h.React.act(async()=>props(input).onChange({target:{value:''}}));
  const button=text=>[...h.container.querySelectorAll('button')].find(node=>node.textContent===text);assert.equal(button('SEO 설정 저장').disabled,false);
  await h.React.act(async()=>button('SEO 설정 저장').click());for(let i=0;i<20&&!dispatched;i++)await h.settle();assert.ok(dispatched);assert.equal(input.value,'');
  ack.resolve();for(let i=0;i<20&&!button('SEO 저장 결과 확인');i++)await h.settle();assert.ok(button('SEO 저장 결과 확인'));assert.equal(input.value,'','manual blank survives unknown ACK');
  let stillHeld=false;try{await reads.options();}catch{stillHeld=true;}
  const beforeRecovery=calls.length;await h.React.act(async()=>button('SEO 저장 결과 확인').click());for(let i=0;i<30&&!saved;i++)await h.settle();
  assert.equal(saved,1,'original native GET verifies committed write');assert.deepEqual(calls.slice(beforeRecovery),[{url:base+'/seo-workspace',method:'GET'}]);assert.equal(input.value,'');assert.equal(h.container.querySelector('.seo-workspace-editor').getAttribute('data-workspace-dirty'),'false');
  assert.deepEqual({begins,heldAtDispatch,stillHeld},{begins:1,heldAtDispatch:true,stillHeld:true},'non-reader producer must hold shared UI data before real PATCH, through unknown ACK');
 }finally{ack.resolve();if(h)await h.close();api.close();}
});

test('actual size information save holds only its PATCH, keeps the three initial proof reads fresh and recovers a lost ACK natively',async()=>{
 const api=mobileIntakeHarness(),ack=gate(),readback=gate(),calls=[];let h,reads,dispatched=false,recovering=false,saved=0,begins=0;
 try{
  await api.intake();const product=await api.load('db/queries.ts').findProduct('owner',api.latest.product_id),base='/api/products/'+product.id;
  h=await stageDOM(async(url,init={})=>{url=String(url);const method=init.method??'GET';calls.push({url,method,cache:init.cache});
   if(method==='PATCH'){await assert.rejects(reads.options(),/저장 상태/);const response=await api.route(url,{method,body:init.body});assert.equal(response.status,200);dispatched=true;await ack.promise;recovering=true;throw Error('lost committed size ACK');}
   const response=url===base?await api.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test'+url),{params:Promise.resolve({id:product.id})}):await api.route(url);
   if(recovering&&url===base+'/content')await readback.promise;return response;
  });
  const {createRegistrationUiReads}=h.load('app/registration-ui-reads.tsx');reads=createRegistrationUiReads({ownerId:'owner',company:{code:'A01464742',name:'와이홉'},productId:product.id,productVersion:product.updated_at,sourceUrl:product.source_url,settingsEpoch:0,profileEpoch:0,profileId:null,refresh:0},new Set(),url=>api.route(url));await reads.options();
  await h.render(h.load('app/components/size-chart-workspace.tsx').SizeChartWorkspace,{productId:product.id,version:product.updated_at,active:true,onBeginSourceWrite:()=>{begins++;return reads.beginMutation();},onSaved:()=>saved++});
  const button=text=>[...h.container.querySelectorAll('button')].find(node=>node.textContent===text);for(let i=0;i<30&&(!button('사이즈표 직접 작성')||button('사이즈표 직접 작성').disabled);i++)await h.settle();
  assert.deepEqual(calls.map(call=>call.url),[base,base+'/content',base]);assert.equal(begins,0,'initial proof activity never becomes a source write');
  await h.React.act(async()=>button('Free Size · 상세페이지 참조로 작성').click());await h.React.act(async()=>button('사이즈표 정보 저장').click());for(let i=0;i<30&&!dispatched;i++)await h.settle();assert.ok(dispatched);assert.equal(begins,1);assert.equal(saved,0);
  ack.resolve();for(let i=0;i<30&&!recovering;i++)await h.settle();assert.ok(recovering);await assert.rejects(reads.options(),/저장 상태/);assert.equal(h.container.querySelector('[data-size-chart-workspace]').getAttribute('data-workspace-dirty'),'true');
  readback.resolve();for(let i=0;i<30&&!saved;i++)await h.settle();assert.equal(saved,1);assert.equal(begins,1);assert.equal(calls.filter(call=>call.method==='PATCH').length,1);assert.deepEqual(calls.slice(4),[{url:base+'/content',method:'GET',cache:'no-store'}]);assert.equal(h.container.querySelector('[data-size-chart-workspace]').getAttribute('data-workspace-dirty'),'false');
 }finally{ack.resolve();readback.resolve();if(h)await h.close();api.close();}
});

test('an optional tool without a source acknowledgement never reauthorizes memory on close; the next actual view still loads through native reads',async()=>{
 const api=mobileIntakeHarness(),calls=[];let h,reads;
 try{
  await api.intake();const product=await api.load('db/queries.ts').findProduct('owner',api.latest.product_id),base='/api/products/'+product.id;
  h=await stageDOM(async(url,init={})=>{url=String(url);const parsed=new URL(url,'https://app.test');calls.push({url,method:init.method??'GET'});assert.equal(init.method??'GET','GET');return parsed.pathname.startsWith(base+'/')?api.route(url):api.load('app'+parsed.pathname+'/route.ts').GET(new Request(parsed));},{components:Object.fromEntries(['product-options-editor','option-main-image-editor','option-quotation-prices','option-price-table','quotation-panel','quotation-fields-editor'].map(name=>[name,true]))});
  const Detail=h.load('app/components/dashboard-client.tsx').DetailPanel,props={product,workspaceOwnerId:'owner',settings:api.settings,uiReadScope:{company:{code:'A01464742',name:'와이홉'},settingsEpoch:0,profileEpoch:0,profileCatalog:{}},onUiReadsChange:value=>{if(value)reads=value;},onSaved:()=>assert.fail('no source ACK'),onUpload(){},onSavePrice:async()=>assert.fail('no save'),onManageCategories(){},onProfileSelected(){},onBeforeFreeImageApply:()=>true,onBeforeSeoGenerate:()=>true,onPrepareSubmission(){},onReviewPackaging(){},onReceiptSaved(){}};
  await h.render(Detail,{...props,tab:'대표 이미지'});for(let i=0;i<12;i++)await h.settle();assert.ok(reads);await reads.options();
  const tools=[...h.container.querySelectorAll('details')].find(node=>node.querySelector(':scope > summary')?.textContent==='추가 AI 이미지 가공');assert.ok(tools);
  await h.React.act(async()=>{propsFor(tools).onToggle({currentTarget:{open:true}});});await assert.rejects(reads.options(),/저장 상태/);
  await h.React.act(async()=>{propsFor(tools).onToggle({currentTarget:{open:false}});});await assert.rejects(reads.options(),/저장 상태/,'close is not a positive source acknowledgement');
  const before=calls.length;await h.render(Detail,{...props,tab:'견적서'});for(let i=0;i<25&&!h.container.querySelector('.quotation-fields');i++)await h.settle();for(let i=0;i<10;i++)await h.settle();
  assert.ok(h.container.querySelector('.quotation-fields'));assert.equal(h.container.querySelector('.quotation-fields').getAttribute('aria-busy'),'false');assert.ok(calls.slice(before).some(call=>call.url===base+'/quotation-fields'));assert.doesNotMatch(h.container.textContent,/화면이 변경되었습니다|저장 상태 또는 편집 화면/);assert.ok(calls.every(call=>call.method==='GET'));
 }finally{if(h)await h.close();api.close();}
});

const propsFor=node=>node[Object.getOwnPropertyNames(node).find(key=>key.startsWith('__reactProps$'))];

test('an option-name ACK that fails the original exact-save proof cannot release shared authority or the manual draft',async()=>{
 const api=mobileIntakeHarness();let h,reads,saved=0;
 try{
  await api.intake();const product=await api.load('db/queries.ts').findProduct('owner',api.latest.product_id);
  h=await stageDOM(async(url,init={})=>{const response=await api.route(String(url),init);if(init.method==='PATCH'){assert.equal(response.status,200);const body=await response.json();body.options.rows[0].translatedName='forged acknowledgement';return Response.json(body);}return response;});
  const {createRegistrationUiReads}=h.load('app/registration-ui-reads.tsx');reads=createRegistrationUiReads({ownerId:'owner',company:{code:'A01464742',name:'와이홉'},productId:product.id,productVersion:product.updated_at,sourceUrl:product.source_url,settingsEpoch:0,profileEpoch:0,profileId:null,refresh:0},new Set(),url=>api.route(url));
  await h.render(h.load('app/components/product-options-editor.tsx').ProductOptionsEditor,{product,active:true,seoView:true,uiReads:reads,onBeginSourceWrite:()=>reads.beginMutation(),onSaved:()=>saved++});
  for(let i=0;i<20&&!h.container.querySelector('[aria-label="1번째 한국어 옵션명"]');i++)await h.settle();const input=h.container.querySelector('[aria-label="1번째 한국어 옵션명"]');assert.ok(input);await h.React.act(async()=>propsFor(input).onChange({target:{value:'검토한 이름'}}));
  await h.React.act(async()=>[...h.container.querySelectorAll('button')].find(node=>node.textContent==='옵션명 저장').click());for(let i=0;i<20&&!h.container.querySelector('[role="alert"]');i++)await h.settle();assert.ok(h.container.querySelector('[role="alert"]'));assert.equal(saved,0);assert.equal(input.value,'검토한 이름');assert.equal(h.container.querySelector('.seo-option-names').getAttribute('data-workspace-dirty'),'true');
  assert.equal(reads.canRead(),false,'only the complete original exact-save proof may confirm its UI mutation lease');
 }finally{if(h)await h.close();api.close();}
});
