import assert from 'node:assert/strict';
import {selectedWorkflowFixture,companies} from './step920-selected-workflow.mjs';
import {assetSnapshot} from './supplier-hub-single-assets.mjs';
export {companies};
export const stages=['seo','pricing','mainImage','additionalImages','detailImage','sizeChart','koreanLabel','quotation'];
export const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};

/** Explicit synthetic initial category definition. Exact native paths and the
 * supported Korean-label name come from the existing native fixture contract;
 * no claim is made about a real product/category or certification applicability. */
export function completeNativeSnapshot(company){
 const snapshot=assetSnapshot(company),raw=JSON.parse(snapshot.schemaString),product=raw.properties.productPage.properties,legal=raw.properties.legalPage.properties,logistics=raw.properties.logisticsPage.properties;
 delete product.commonAttributes.properties.count;delete product.commonAttributes.properties.booleanValue;
 // The old AI fixture's contrived nullable enums were parser tests, not facts.
 product.unexposedAttributes.allOf=[];
 product.taxationSchema={type:'string',title:'과세여부',enum:['과세','면세','영세']};
 product.searchTags={type:'string',title:'검색어'};
 legal.kcMarkType={type:'string',title:'전기용품 및 생활용품, 어린이 (KC) 인증 마크 타입',enum:['해당사항없음','KC인증마크_생활용품 공급자적합성확인']};
 logistics.daysToExpiration={type:'integer',title:'유통기간',minimum:0};
 logistics.specialHandlingReason={type:'string',title:'취급주의 사유',enum:['해당사항없음','유리']};
 logistics.skuUnitBoxWeight={type:'string',title:'한 개 단품 포장 무게'};
 logistics.skuUnitBoxDimension={type:'string',title:'한 개 단품 포장 사이즈'};
 raw.properties.imagePage.properties.details.properties.altText={type:'string',title:'대체 텍스트'};
 // Explicit deterministic form seeds, as used by the existing opt-in native
 // projection tests; required nodes are not inferred from a provider response.
 function seed(node){
  if(node.properties){node.required=Object.keys(node.properties);for(const child of Object.values(node.properties))seed(child);}
  else if(node.allOf){for(const entry of node.allOf)seed(entry.contains);node.examples=[node.allOf.map(entry=>{const[nameKey,valueKey]=Object.keys(entry.contains.properties);return{[nameKey]:entry.contains.properties[nameKey].enum[0],[valueKey]:''};})];}
  else if(!node.enum)node.examples=[Object.hasOwn(node,'default')?node.default:node.type==='integer'?1:node.type==='boolean'?false:''];
 }
 seed(raw);raw.properties.imagePage.properties.details.required=raw.properties.imagePage.properties.details.required.filter(key=>key!=='htmlProductDetailContent');
 snapshot.schemaString=JSON.stringify(raw);snapshot.nativeSerializationPolicy='supplier-hub-native-required-form-v1';return snapshot;
}

export async function nativeSelectedWorkflowFixture(company=companies[0],{legalApplicability=true}={}){
 const snapshot=completeNativeSnapshot(company),f=await selectedWorkflowFixture(company,{completeInputs:true,foreignTextImages:true,qwenSeo:true,initialSnapshot:snapshot});
 try{
  if(legalApplicability){const legal=await json(await f.request(f.base+'/legal-documents'));
   await json(await f.request(f.base+'/legal-documents',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:legal.revision,applicability:'not-applicable'})}));
   f.initialInputs.push({source:'explicit synthetic legal applicability PATCH '+f.base+'/legal-documents',applicability:'not-applicable'});
  }
  return{...f,snapshot};
 }catch(error){f.close();throw error;}
}
