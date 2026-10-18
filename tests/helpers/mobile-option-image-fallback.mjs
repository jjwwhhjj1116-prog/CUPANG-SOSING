import fs from 'node:fs';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './mobile-intake.mjs';
import {offerDefaultRuntime,json,plain} from './alibaba-offer-default.mjs';

export {offerDefaultRuntime as mobileImageRuntime,json,plain};
export const mobileImageOfferId='90000000693';
export const mobileImageSourceUrl=`https://detail.1688.com/offer/${mobileImageOfferId}.html`;
export const mobileImageTitle='三轴运动保护带';
export const thirdAxisImage='https://outside.example/third-axis-not-a-source-image.jpg';
export const mixedRet=['SUCCESS::调用成功','FAIL_SYS_USER_VALIDATE::verification fixture'];

export function mobileImageFixture({images=['https://cbu01.alicdn.com/mobile-main-693.jpg','https://cbu01.alicdn.com/mobile-additional-693.jpg','https://cbu01.alicdn.com/mobile-second-axis-693.jpg','https://cbu01.alicdn.com/mobile-nonselected-second-693.jpg']}={}){
 const [main,additional,second,unselected]=images,offerId=mobileImageOfferId;
 const detailUrl='https://itemcdn.tmall.com/1688offer/Synthetic693';
 const init={globalData:{offerBaseInfo:{offerId},tempModel:{offerId,offerTitle:mobileImageTitle},offerSigns:{},detailModel:{offerId,detailUrl:'https://air.1688.com/app/detail?'+new URLSearchParams({offerId,url:detailUrl})}},
  data:{gallery:{data:{offerId,offerImgList:[main,additional]}},attributes:{data:{offerId,propsList:[{name:'material',value:'PP'},{name:'model',value:'MOBILE-693'}]}}}};
 const skuPayload={ret:['SUCCESS::调用成功'],data:{result:{data:{offerBaseInfo:{offerId,title:mobileImageTitle,picUrl:main},
  skuModel:{skuProps:[
   {prop:'Color',value:[{name:'Black'},{name:'Green',imageUrl:additional},{name:'Blue'}]},
   {prop:'Size',value:[{name:'M'},{name:'L',imageUrl:unselected},{name:'S',imageUrl:second}]},
   {prop:'Style',value:[{name:'Basic',imageUrl:thirdAxisImage},{name:'Compact',imageUrl:thirdAxisImage}]},
  ],skuInfoMap:{
   // Deliberately non-display insertion order exercises sorting while keeping
   // exact selected image references bound to their own supplier SKUs.
   'Blue>S>Compact':{skuId:'69310003',specAttrs:'Blue>S>Compact',price:'9.1',canBookCount:null},
   'Green>L>Basic':{skuId:'69310002',specAttrs:'Green>L>Basic',price:'6',canBookCount:8},
   'Black>M>Basic':{skuId:'69310001',specAttrs:'Black>M>Basic',price:'4.5',canBookCount:0},
  }},orderParamModel:{orderParam:{beginNum:2,skuParam:{skuPriceType:'skuPrice'}}}}}}};
 const mobileHtml='<script>window.__INIT_DATA='+JSON.stringify(init)+';</script>';
 const detailSource='var offer_details = '+JSON.stringify({content:`<p>原文三轴说明</p><img src="${second}">`})+';';
 return {init,mobileHtml,skuPayload,detailUrl,detailSource,images,
  capture:{format:'1688-public-mobile-capture-v1',sourceUrl:mobileImageSourceUrl,mobileHtml,skuPayload,detailSource}};
}

/** Actual route handlers and SQLite/R2. Every source/media/model response is
 * provided locally; this helper never contacts an external supplier or Hub. */
export function mobileImageApiHarness(company,{mixed=false}={}){
 const recorded=JSON.parse(fs.readFileSync(new URL('../fixtures/1688-mobile-813724060928.json',import.meta.url),'utf8'));
 const images=Object.values(recorded.data).find(value=>value?.data?.offerImgList).data.offerImgList.slice(0,4);
 const fixture=mobileImageFixture({images}),sources=[];
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,sourceFetcher:async target=>{
  const url=new URL(target);sources.push({host:url.hostname,path:url.pathname});
  if(url.hostname==='detail.1688.com'){assert.equal(url.href,mobileImageSourceUrl);return new Response('<html>synthetic desktop without product JSON-LD</html>',{headers:{'content-type':'text/html'}});}
  if(url.hostname==='m.1688.com'){assert.equal(url.pathname,`/offer/${mobileImageOfferId}.html`);return new Response(fixture.mobileHtml,{headers:{'content-type':'text/html'}});}
  if(url.hostname==='h5api.m.1688.com'){
   assert.equal(JSON.parse(JSON.parse(url.searchParams.get('data')).params).offerId,mobileImageOfferId);
   const payload=structuredClone(fixture.skuPayload);if(mixed)payload.ret=[...mixedRet];return Response.json(payload);
  }
  assert.equal(url.href,fixture.detailUrl);return new Response(fixture.detailSource,{headers:{'content-type':'text/plain'}});
 }});
 h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=?,goal=? WHERE id=?').run(mobileImageOfferId,mobileImageSourceUrl,'work','job');
 h.context.keywords='보호대';h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
 h.bindings.AI.run=async(_model,input)=>{
  const source=JSON.parse(input.messages[1].content);h.aiSources.push(source);assert.equal(source.title,mobileImageTitle);
  const colors={Black:'검정',Green:'초록',Blue:'파랑'};
  return {response:{title:'모바일 옵션 보호대',description:'원문에 따른 모바일 옵션 검토 설명',keywords:['보호대'],warnings:[],
   attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name.startsWith('option:')?'옵션명':pair.name.replace('상품속성: ',''),
    value:pair.name.startsWith('option:')?`검토 옵션 ${Object.entries(colors).find(([word])=>pair.value.includes(word))?.[1]??sourceIndex}`:pair.name.startsWith('option-color:')?colors[pair.value]??pair.value:pair.value}))}};
 };
 const requests=[];let latest;
 const route=async(path,options={})=>{const response=await h.route(path,options);requests.push({path,method:options.method??'GET',status:response.status});return response;};
 async function intake(){return h.load('app/intake-collection.ts').collectIntakeProduct(await h.load('db/collection-jobs.ts').findCollectionJob('owner','job'),{
  signal:new AbortController().signal,fetcher:(path,init)=>route(path,{method:init?.method??'GET',body:init?.body}),onJob:job=>{latest=job;},onProgress(){},
 });}
 return {...h,fixture,sources,requests,route,intake,get latest(){return latest;}};
}
