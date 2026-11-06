import assert from 'node:assert/strict';
import React from 'react';
import {mobileIntakeHarness} from './mobile-intake.mjs';
import {stageRefreshDOM} from './stage-refresh-dom.mjs';

export const company={code:'A01526306',name:'유앤채'};
export const plain=value=>JSON.parse(JSON.stringify(value));
export function raw324(sourceUrl){
 const offerId=sourceUrl.match(/\/(\d+)\.html$/u)[1],base='result.global.globalData.model.tradeModel';
 const options=Array.from({length:324},(_,i)=>({key:'key-'+i,name:'합성 옵션 '+i,supplierSku:String(700000000000+i),unitPriceCny:6+i,currency:'CNY',minimumOrder:1,stock:3,imageUrl:null}));
 return {format:'yoofam-page-source-v1',sourceUrl,offerId,collectedAt:new Date().toISOString(),title:'합성 검토 상품',description:'직접 검토할 합성 원문',options,images:[{url:'https://cbu01.alicdn.com/synthetic-review-continuation.png',role:'main'}],attributes:[],
  pagePriceBasis:{format:'1688-page-price-basis-v1',offerId,source:'1688-context-primary-v1',selection:'original-per-sku',rows:options.map(row=>({key:row.key,sku:row.supplierSku,specId:row.key,observedPrice:'5.52',originalPrice:String(row.unitPriceCny)})),flags:[{path:base+'.tradeWithoutPromotion.offerIsSkuTradeSupported',value:true}],tiers:[{path:base+'.offerPriceModel.originalPrices',rows:[{beginAmount:1,price:'6'}]}],originalSkus:[{path:base+'.tradeWithoutPromotion.skuMapOriginal',rows:options.map(row=>({sku:row.supplierSku,specId:row.key,price:String(row.unitPriceCny),discountPrice:String(row.unitPriceCny)}))}]}};
}
export async function urlReviewFixture(){
 const image='https://cbu01.alicdn.com/synthetic-review-continuation.png',h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,fixtureImageUrls:[image],sourceFetcher:()=>assert.fail('primary context must not read a supplier endpoint')});
 h.sqlite.prepare('DELETE FROM collection_context').run();h.sqlite.prepare('DELETE FROM collection_jobs').run();
 await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(h.settings));
 const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 분류',categoryId:h.context.category.categoryId,categoryPath:h.context.category.categoryPath,template:null,mappings:[]});assert.ok(profile);
 const state={h,profile,source:raw324(h.sourceUrl),calls:[],messages:[],captureCount:0,captureId:null,fingerprint:null,draft:null,ownerId:'owner',company,ack:true,inboxStatus:200,changeInbox:body=>body};
 const inbox=h.load('app/api/source-inbox/route.ts');
 const request=(url,init={})=>new Request('https://app.test'+url,{method:init.method??'GET',headers:{'content-type':'application/json',origin:'https://app.test'},...(init.body!==undefined?{body:init.body}:{})});
 async function fetcher(url,init={}){
  url=String(url);state.calls.push({url,method:init.method??'GET',body:init.body?JSON.parse(init.body):undefined});
  if(url==='/api/source-inbox'){
   if((!init.method||init.method==='GET')&&state.inboxStatus!==200)return Response.json({error:'offline read interrupted'},{status:state.inboxStatus});
   const response=await inbox[init.method??'GET'](request(url,init));
   if(init.method==='PUT'&&state.reviewGate)await state.reviewGate;
   return !init.method||init.method==='GET'?Response.json(await state.changeInbox(await response.json()),{status:response.status}):response;
  }
  if(url.startsWith('/api/source-inbox/ready?'))return h.load('app/api/source-inbox/ready/route.ts').GET(request(url,init));
  if(url.startsWith('/api/collection-jobs')&&!/^\/api\/collection-jobs\/[a-f0-9-]+\//u.test(url))return h.load('app/api/collection-jobs/route.ts')[init.method??'GET'](request(url,init));
  if(url==='/api/intake-draft')return h.load('app/api/intake-draft/route.ts')[init.method??'GET'](request(url,init));
  if(url==='/api/settings')return Response.json({settings:h.settings,scope:{ownerId:state.ownerId,company:state.company}});
  if(url==='/api/category-profiles')return Response.json({profiles:[profile]});
  if(url==='/api/products')return Response.json({products:h.sqlite.prepare('SELECT * FROM products').all()});
  if(url==='/api/query-captures')return Response.json({ownerId:state.ownerId,company:state.company,captures:[]});
  if(url==='/api/supplier-hub/catalog-context')return Response.json({ownerId:state.ownerId,company:state.company});
  if(url.startsWith('/api/collection-jobs/')||url.startsWith('/api/products/'))return h.route(url,{method:init.method??'GET',body:init.body});
  return Response.json({error:'offline fixture: no generation'},{status:503});
 }
 const components={'intake-queue-panel':true,'source-inbox-panel':true,'category-picker':{CategoryPicker:props=>React.createElement('button',{onClick:()=>props.onSelected(profile)},'합성 분류 선택')}};
 const ui=await stageRefreshDOM(fetcher,{components,exposeDetail:false});state.ui=ui;state.fetcher=fetcher;
 const realDraft=ui.load('app/components/use-intake-draft.ts');components['use-intake-draft']={useIntakeDraft(owner){const value=realDraft.useIntakeDraft(owner);state.draft=value;return value;}};
 components['use-source-registrations']=ui.load('app/components/use-source-registrations.ts');
 ui.window.HTMLElement.prototype.scrollIntoView=function(){};
 const emit=(channel,requestId,result)=>ui.window.dispatchEvent(new ui.window.MessageEvent('message',{origin:'https://app.test',source:ui.window,data:{channel,requestId,result}}));
 ui.window.postMessage=(value)=>{
  state.messages.push(value);
  if(value.type==='PING')queueMicrotask(()=>emit('YOOFAM_HUB_HANDOFF_RESULT',value.requestId,{ok:true,primaryContextCapture:true}));
  if(value.type==='CAPTURE_CONTEXT'){
   state.captureCount++;state.captureId=value.requestId;
   void(async()=>{state.fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(state.source);const response=await inbox.POST(request('/api/source-inbox',{method:'POST',body:JSON.stringify({expectedOwnerId:'owner',expectedCompany:company,id:value.requestId,fingerprint:state.fingerprint,snapshot:state.source})}));assert.equal(response.status,200,await response.clone().text());const receipt=await response.json();
    ui.window.dispatchEvent(new ui.window.MessageEvent('message',{origin:'https://app.test',source:ui.window,data:{channel:'YOOFAM_SOURCE_INBOX_UPDATED'}}));
    if(state.ack==='error')emit('YOOFAM_1688_CAPTURE_RESULT',value.requestId,{ok:false,error:'offline lost acknowledgement'});
    else if(state.ack)emit('YOOFAM_1688_CAPTURE_RESULT',value.requestId,{ok:true,sourceUrl:h.sourceUrl,format:'yoofam-context-saved-v1',captureId:receipt.storedId,fingerprint:state.ack==='malformed'?'bad':state.fingerprint});})();
  }
 };
 state.click=async(label)=>{const button=[...ui.container.querySelectorAll('button')].find(node=>node.textContent===label||node.textContent.includes(label));assert.ok(button&&!button.disabled,label);await ui.React.act(async()=>button.click());await ui.settle();};
 state.until=async(predicate)=>{for(let i=0;i<50;i++){if(predicate())return;await ui.settle();}assert.ok(predicate(),'UI state did not settle: '+ui.container.textContent.slice(-1200));};
 state.start=async({waitForError=true,recordRefresh=false}={})=>{const Component=ui.load('app/components/dashboard-client.tsx').default;state.Component=Component;await ui.render(Component,{userName:'offline',workspaceOwnerId:'owner'});await state.until(()=>state.draft?.ready);
  if(recordRefresh){await state.click('수집함');state.refreshWorkspace=ui.records.get('collection-batch-panel')?.onSaved;const dialog=[...ui.container.querySelectorAll('[role="dialog"]')].find(node=>node.querySelector('header'));await ui.React.act(async()=>dialog.querySelector('header button').click());await ui.settle();}
  await state.click('＋ 상품 추가');await state.click('합성 분류 선택');
  await ui.React.act(async()=>state.draft.setGoal('collect'));await ui.settle();
  const input=ui.container.querySelector('[aria-label="1번째 1688 링크"]');assert.ok(input);await ui.React.act(async()=>{const setter=Object.getOwnPropertyDescriptor(ui.window.HTMLInputElement.prototype,'value').set;setter.call(input,h.sourceUrl);input.dispatchEvent(new ui.window.Event('input',{bubbles:true}));});await ui.settle();
  await state.click('시작 (1건)');await state.until(()=>state.captureCount===1&&(!waitForError||state.draft.rows[0]?.status==='error'));return state.draft.rows[0];};
 state.close=async()=>{await ui.close();h.close();};
 return state;
}
