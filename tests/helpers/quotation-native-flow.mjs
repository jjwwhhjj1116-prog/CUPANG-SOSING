import {nativeReviewFixture,companies,json} from './native-source-review.mjs';
import {assetSnapshot} from './supplier-hub-single-assets.mjs';
import {completeQuotationChanges} from './quotation-save-validation.mjs';
export {companies,json};

/** Synthetic category includes the exact recorded Couplus input paths. A small
 * omitted-wire schema must still reject unbound values; no validator is relaxed. */
export async function completeQuotationNativeFixture(company=companies[0],{productId='synthetic-full-quotation-flow-976'}={}){
 const snapshot=assetSnapshot(company),raw=JSON.parse(snapshot.schemaString),string=(title,extra={})=>({type:'string',title,...extra});
 raw.properties.productPage.properties.taxationSchema=string('과세여부',{enum:['과세','면세','영세']});
 raw.properties.legalPage.properties.kcMarkType=string('KC인증마크 타입',{enum:['해당사항없음']});
 Object.assign(raw.properties.logisticsPage.properties,{daysToExpiration:{type:'integer',title:'유통기간',minimum:0},specialHandlingReason:string('취급주의 사유',{enum:['해당사항없음','유리']}),skuUnitBoxWeight:string('한 개 단품 포장 무게'),skuUnitBoxDimension:string('한 개 단품 포장 사이즈')});
 snapshot.schemaString=JSON.stringify(raw);const source=await nativeReviewFixture(company,{snapshot,productId});
 try{const view=await source.fields(),changes=completeQuotationChanges.flatMap(change=>{const field=view.resolved.schema.fields.find(field=>field.hubInput===change.fieldKey);return field&&field.id!==change.fieldKey?[change,{...change,fieldKey:field.id}]:[change];});
  await json(await source.h.route(source.fieldsPath,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));return source;
 }catch(error){source.close();throw error;}
}
