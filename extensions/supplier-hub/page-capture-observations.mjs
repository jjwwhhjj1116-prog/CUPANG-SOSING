import {validatePageDomFacts} from './page-dom-facts.mjs';
import {pageSourceUrl,readPageSourceElementImage} from './page-source.mjs';

/** Merge only bounded, already offer-bound readings from one click. Keep
 * conflicting facts for the existing exact-SKU merger to reject, rather than
 * choosing a value based on viewport or row order. */
export function createPageCaptureObservations(sourceUrl){
 const identity=pageSourceUrl(sourceUrl),attributes=[],packaging=[],images=[],descriptions=[],attributeValues=new Map(),packageKeys=new Set();
 return {
  add(facts,detail){
   if(facts){
    validatePageDomFacts(facts);
    if(facts.sourceUrl!==identity.sourceUrl||facts.offerId!==identity.offerId)throw Error('상품 페이지가 변경되었습니다. 다시 수집해주세요.');
    for(const row of facts.attributes){const key=row.name.toLowerCase(),prior=attributeValues.get(key);if(prior!==undefined&&prior!==row.value)throw Error('상품 속성 원문이 서로 다릅니다. 다시 수집해주세요.');if(prior===undefined){if(attributes.length>=50)throw Error('상품 속성이 수집 크기를 초과했습니다.');attributeValues.set(key,row.value);attributes.push({...row});}}
    for(const row of facts.packaging){const key=JSON.stringify([row.name??null,row.supplierSku??null,Object.entries(row.packaging).sort(([a],[b])=>a.localeCompare(b))]);if(packageKeys.has(key))continue;if(packaging.length>=200)throw Error('포장 정보가 수집 크기를 초과했습니다.');packageKeys.add(key);packaging.push({...row,packaging:{...row.packaging}});}
   }
   if(!detail||typeof detail.description!=='string'||detail.description.length>20000||!Array.isArray(detail.detailImages)||detail.detailImages.length>200)throw Error('상품 상세 원문을 확인하지 못했습니다.');
   // The detail region can grow as the page loads. A later observation often
   // contains an earlier one verbatim; retain the fuller original text once.
   // Do not synthesize text by guessing partial overlaps between observations.
   if(detail.description&&!descriptions.some(text=>text.includes(detail.description))){
    const contained=[];
    descriptions.forEach((text,index)=>{if(detail.description.includes(text))contained.push(index);});
    if(contained.length){const first=contained[0];for(let index=contained.length-1;index>=0;index--)descriptions.splice(contained[index],1);descriptions.splice(first,0,detail.description);}
    else descriptions.push(detail.description);
   }
   for(const value of detail.detailImages){const verified=typeof value==='string'?readPageSourceElementImage({currentSrc:'',getAttribute:key=>key==='data-src'?value:null},{preferDataSource:true}):null;if(!verified||verified!==value)throw Error('상품 상세 이미지 주소를 확인하지 못했습니다.');if(!images.includes(value)){if(images.length>=200)throw Error('상품 상세 이미지가 200개를 초과했습니다.');images.push(value);}}
  },
  result(){return {facts:attributes.length||packaging.length?{format:'yoofam-page-dom-facts-v1',...identity,attributes:attributes.map(row=>({...row})),packaging:packaging.map(row=>({...row,packaging:{...row.packaging}}))}:null,detail:{description:descriptions.join('\n').slice(0,20000),detailImages:[...images]}};}
 };
}
