import {offerDefaultApiHarness,offerDefaultRuntime,json,plain} from './alibaba-offer-default.mjs';
import fs from 'node:fs';

export {offerDefaultRuntime as optionImageRuntime,json,plain};
export const optionImageOfferId='90000000692';
export const optionImageSourceUrl=`https://detail.1688.com/offer/${optionImageOfferId}.html`;
export const optionImageTitle='单层运动收纳保护带';
export const defaultGallery=['https://cbu01.alicdn.com/gallery-main-692.jpg','https://cbu01.alicdn.com/gallery-additional-692.jpg'];
export const firstAttributeImage='https://cbu01.alicdn.com/first-attribute-692.jpg';
export const secondAttributeImage='https://cbu01.alicdn.com/second-attribute-692.jpg';
export const unusedThirdImage='https://not-selected.example/third-attribute-never-fetch.jpg';

export function optionImagePayload({gallery=defaultGallery,detailImage,skus}={}){
 return {result:{success:true,result:{offerId:optionImageOfferId,subject:optionImageTitle,minOrderQuantity:'2',
  productImage:{images:[...gallery]},description:detailImage?`<p>原文商品说明</p><img src="${detailImage}">`:'',
  productSkuInfos:skus??[{skuId:'69210001',price:'4.5',amountOnSale:0,skuAttributes:[{attributeName:'Color',value:'Black'},{attributeName:'Size',value:'M'}]}],
  productAttribute:[{attributeName:'material',value:'PP'},{attributeName:'model',value:'IMAGE-692'}]}}};
}

/** Uses actual app handlers/SQLite and local synthetic PNG/model replies. The
 * old fixture's CDN addresses are inert allowlisted identifiers, never fetched. */
export function optionImageApiHarness(company){
 const h=offerDefaultApiHarness(company);
 const mobile=JSON.parse(fs.readFileSync(new URL('../fixtures/1688-mobile-813724060928.json',import.meta.url),'utf8'));
 const [main,additional,second,unselected]=Object.values(mobile.data).find(value=>value?.data?.offerImgList).data.offerImgList.slice(0,4);
 const payload=optionImagePayload({gallery:[main,additional],detailImage:second,skus:[
  {skuId:'69210001',price:'4.5',amountOnSale:0,skuAttributes:[{attributeName:'Color',value:'Black'},{attributeName:'Size',value:'M'},{attributeName:'Style',value:'Basic',skuImageUrl:unusedThirdImage}]},
  {skuId:'69210002',price:'6',amountOnSale:8,skuAttributes:[{attributeName:'Color',value:'Green',skuImageUrl:additional},{attributeName:'Size',value:'L',skuImageUrl:unselected}]},
  {skuId:'69210003',price:'9.1',amountOnSale:null,skuAttributes:[{attributeName:'Color',value:'Blue'},{attributeName:'Size',value:'S',skuImageUrl:second},{attributeName:'Style',value:'Compact',skuImageUrl:unusedThirdImage}]},
 ]});
 h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=? WHERE id=?').run(optionImageOfferId,optionImageSourceUrl,'job');
 h.bindings.AI.run=async(_model,input)=>{
  const source=JSON.parse(input.messages[1].content);h.aiSources.push(source);
  const colors={Black:'검정',Green:'초록',Blue:'파랑'};
  return {response:{title:'옵션 이미지 보호대',description:'원문에 따른 옵션별 검토 설명',keywords:['보호대'],warnings:[],
   attributes:source.attributes.map((pair,sourceIndex)=>({sourceIndex,name:pair.name.startsWith('option:')?'옵션명':pair.name.replace('상품속성: ',''),
    value:pair.name.startsWith('option:')?`검토 옵션 ${Object.entries(colors).find(([word])=>pair.value.includes(word))?.[1]??sourceIndex}`:pair.name.startsWith('option-color:')?colors[pair.value]??pair.value:pair.value}))}};
 };
 return {...h,payload};
}
