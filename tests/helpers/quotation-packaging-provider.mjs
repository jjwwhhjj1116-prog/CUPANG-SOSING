// Synthetic provider V2 fixtures. No provider, product or network calls.
export const packagingResponse = packages => ({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({schemaVersion:2,packages})}}]});
export function packagingItem({index,requested},values={},reason='insufficient-product-context'){
 const dimensions=requested.dimensions&&['widthMm','lengthMm','heightMm'].some(key=>values[key]!==undefined),weight=requested.weight&&values.weightG!==undefined;
 return{index,dimensionsStatus:!requested.dimensions?'not-requested':dimensions?'estimated':'abstained',dimensionsReason:requested.dimensions&&!dimensions?reason:null,
  widthMm:dimensions?values.widthMm??null:null,lengthMm:dimensions?values.lengthMm??null:null,heightMm:dimensions?values.heightMm??null:null,
  weightStatus:!requested.weight?'not-requested':weight?'estimated':'abstained',weightReason:requested.weight&&!weight?reason:null,weightG:weight?values.weightG:null};
}
export const answerPackagingPlan=(plan,values=()=>({weightG:30,widthMm:60,lengthMm:80,heightMm:5}))=>packagingResponse(plan.targets.map((target,index)=>packagingItem({index,requested:{weight:!!target.weightField,dimensions:!!target.dimensionsField}},values(index))));
// A previously saved public-result v1 fixture proves backward read/adoption
// compatibility. New requests must never generate these generic defaults.
export function legacyPackagingDraft(helper,plan){
 const result=helper.completeQuotationPackagingDraft(plan);delete result.diagnostics;
 result.proposals=plan.targets.flatMap(target=>[target.weightField,target.dimensionsField].filter(Boolean).map(field=>({optionId:target.optionId,optionLabel:target.optionLabel,
  fieldKey:field.id,label:field.label,value:field===target.weightField?'100':'100*100*100',unitsPerPack:target.unitsPerPack,origin:'couplus-fallback',measured:false,note:'쿠플러스 방식의 기본 초안이며 실측값이 아닙니다. 확인·수정해주세요.'})));
 return result;
}
