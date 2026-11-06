import {fingerprint} from '@/app/automation/model';
import type {QuotationFieldsView,QuotationSchema} from '@/app/quotation-schema';
import type {QuotationFieldsState,QuotationSourceGuard} from '@/db/quotation-fields';
import type {RegistrationStageStatus} from '@/app/registration-stage-status';

export type QuotationValidationActor={ownerId:string;email:string;role:string;company:{code:string;name:string}};
export type SavedQuotationValidation={format:'saved-quotation-validation-v1';productId:string;categoryId:string|null;requestedProfileId:string|null;
 revision:number;productVersion:string;inputFingerprint:string;checkedAt:string;schemaReady:boolean;fieldCount:number;globalErrorCount:number;
 rows:{optionId:string|null;included:boolean;errorCount:number}[];submissionReady:false;registered:false};
export type SavedQuotationValidationProof=SavedQuotationValidation&{sourceBinding:string};
type SavedQuotationValidationResult=Omit<SavedQuotationValidation,'checkedAt'>;
const hash=/^[a-f0-9]{64}$/,id=/^[A-Za-z0-9_-]{1,100}$/;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const time=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const keys=['format','productId','categoryId','requestedProfileId','revision','productVersion','inputFingerprint','checkedAt','schemaReady','fieldCount','globalErrorCount','rows','submissionReady','registered'];
const productKeys=['id','owner_id','source_url','title','source_price_cny','exchange_rate','supply_margin','coupang_margin','supply_price','sale_price','msrp','options_count','seo_status','image_status','quote_status','registration_status','supplier_hub_status','image_keys','goal_stage','created_at','updated_at','pricing_policy'];

/** This binding excludes only the validation sidecar itself and display numbering. */
export async function quotationValidationSourceBinding(input:{actor:QuotationValidationActor;product:object;content:unknown;options:unknown;state:QuotationFieldsState;source:QuotationSourceGuard;schema:QuotationSchema;categoryContext:QuotationFieldsView['categoryContext'];detailVersion:{format:string;origin:string;keyId:string}|null;validation:SavedQuotationValidationResult}):Promise<string>{
 const product=input.product as Record<string,unknown>;
 if(productKeys.some(key=>key!=='pricing_policy'&&!Object.hasOwn(product,key)))throw Error('견적 입력 검사의 상품 원본을 확인하지 못했습니다.');
 const state={...input.state};delete state.savedValidation;
 return fingerprint({policy:'couplus-quotation-schema-save-v1',actor:input.actor,product:Object.fromEntries(productKeys.map(key=>[key,product[key]??null])),content:input.content,options:input.options,state,
  source:{productVersion:input.source.productVersion,imageKeys:input.source.imageKeys,pricingPolicy:input.source.pricingPolicy,contentRevision:input.source.contentRevision,optionRevision:input.source.optionRevision,...(!input.source.labelRevision?{}:{labelRevision:input.source.labelRevision}),settingsPayload:input.source.settingsPayload,profile:input.source.profile,collection:input.source.collection},schema:input.schema,categoryContext:input.categoryContext,detailVersion:input.detailVersion,
  validation:Object.fromEntries(keys.filter(key=>key!=='checkedAt').map(key=>[key,(input.validation as Record<string,unknown>)[key]]))});
}
function validationRows(view:QuotationFieldsView){
 const fields=view.resolved.schema.fields;if(!fields.length||new Set(fields.map(field=>field.id)).size!==fields.length||!Array.isArray(view.resolved.validationIssues))throw Error('견적 양식의 검사 항목을 확인하지 못했습니다.');
 const options=view.resolved.rows.filter(row=>row.optionId!==null),rows=options.length?options:view.resolved.rows.filter(row=>row.optionId===null);
 if(!rows.length||rows.length>200||new Set(rows.map(row=>row.optionId)).size!==rows.length)throw Error('견적 입력 검사의 옵션 범위를 확인하지 못했습니다.');
 return rows.map(row=>({optionId:row.optionId,included:row.included,errorCount:fields.reduce((count,field)=>{const cell=row.fields[field.id];if(!cell||typeof cell.value!=='string'||!Array.isArray(cell.validationIssues))throw Error('견적 입력 검사 결과를 확인하지 못했습니다.');return count+cell.validationIssues.length;},0)}));
}
const schemaReady=(view:QuotationFieldsView)=>view.resolved.schema.status==='observed'&&!view.resolved.schema.unsupportedFields?.length&&view.categoryContext.source!=='unknown'&&!!view.categoryContext.categoryId&&view.resolved.schema.categoryId===view.categoryContext.categoryId;
export function savedQuotationValidationResult(view:QuotationFieldsView,productId:string,requestedProfileId:string|null):SavedQuotationValidationResult{
 if(view.revision<1||!hash.test(view.inputFingerprint))throw Error('저장된 견적 입력 검사 기준이 필요합니다.');
 return{format:'saved-quotation-validation-v1',productId,categoryId:view.categoryContext.categoryId,requestedProfileId,revision:view.revision,productVersion:view.productVersion,inputFingerprint:view.inputFingerprint,
  schemaReady:schemaReady(view),fieldCount:view.resolved.schema.fields.length,globalErrorCount:view.resolved.validationIssues!.length,rows:validationRows(view),submissionReady:false,registered:false};
}
export function createSavedQuotationValidation(view:QuotationFieldsView,productId:string,requestedProfileId:string|null,sourceBinding:string,checkedAt=new Date().toISOString()):SavedQuotationValidationProof{
 if(!hash.test(sourceBinding))throw Error('저장된 견적 입력 검사 기준이 필요합니다.');
 return{...savedQuotationValidationResult(view,productId,requestedProfileId),checkedAt,sourceBinding};
}
export function parseSavedQuotationValidation(value:unknown):SavedQuotationValidation|null{
 if(!object(value)||Object.keys(value).some(key=>!keys.includes(key)&&key!=='sourceBinding')||keys.some(key=>!Object.hasOwn(value,key))||value.format!=='saved-quotation-validation-v1'
  ||typeof value.productId!=='string'||!id.test(value.productId)||value.categoryId!==null&&(typeof value.categoryId!=='string'||!id.test(value.categoryId))
  ||value.requestedProfileId!==null&&(typeof value.requestedProfileId!=='string'||!id.test(value.requestedProfileId))||!Number.isSafeInteger(value.revision)||Number(value.revision)<1
  ||!time(value.productVersion)||!time(value.checkedAt)||typeof value.inputFingerprint!=='string'||!hash.test(value.inputFingerprint)||typeof value.schemaReady!=='boolean'
  ||!Number.isSafeInteger(value.fieldCount)||Number(value.fieldCount)<1||Number(value.fieldCount)>100000||!Number.isSafeInteger(value.globalErrorCount)||Number(value.globalErrorCount)<0||Number(value.globalErrorCount)>1000000
  ||value.submissionReady!==false||value.registered!==false||value.sourceBinding!==undefined&&(typeof value.sourceBinding!=='string'||!hash.test(value.sourceBinding))||!Array.isArray(value.rows)||!value.rows.length||value.rows.length>200)return null;
 const seen=new Set<string|null>();for(const row of value.rows){if(!object(row)||Object.keys(row).length!==3||!['optionId','included','errorCount'].every(key=>Object.hasOwn(row,key))
  ||row.optionId!==null&&(typeof row.optionId!=='string'||!id.test(row.optionId))||typeof row.included!=='boolean'||!Number.isSafeInteger(row.errorCount)||Number(row.errorCount)<0||Number(row.errorCount)>1000000||seen.has(row.optionId as string|null))return null;seen.add(row.optionId as string|null);}
 if(seen.has(null)&&seen.size!==1)return null;
 const result=Object.fromEntries(keys.map(key=>[key,value[key]]));return JSON.parse(JSON.stringify(result)) as SavedQuotationValidation;
}
export function currentSavedQuotationValidation(view:QuotationFieldsView,productId:string):SavedQuotationValidation|null{
 try{const value=parseSavedQuotationValidation(view.savedValidation);if(!value||value.productId!==productId||value.revision!==view.revision||value.productVersion!==view.productVersion||value.inputFingerprint!==view.inputFingerprint||value.categoryId!==view.categoryContext.categoryId
   ||value.fieldCount!==view.resolved.schema.fields.length||value.schemaReady!==schemaReady(view)||value.globalErrorCount!==view.resolved.validationIssues?.length||JSON.stringify(value.rows)!==JSON.stringify(validationRows(view)))return null;return value;
 }catch{return null;}
}
export function savedQuotationValidationStage(value:SavedQuotationValidation,optionId?:string|null):RegistrationStageStatus{
 const rows=optionId===undefined?value.rows.filter(row=>row.included&&row.optionId!==null):value.rows.filter(row=>row.optionId===optionId),valid=rows.filter(row=>value.schemaReady&&!value.globalErrorCount&&row.errorCount===0).length;
 return rows.length>0&&valid===rows.length?{state:'complete',detail:`저장한 공식 양식 · ${optionId===undefined?`포함 옵션 ${valid}개`:'현재 옵션'} 입력 검사 통과 · 전송·접수 별도`,updatedAt:value.checkedAt}
  :{state:'pending',detail:`저장본 입력 검사 ${valid}/${rows.length}개 통과 · 필수값·형식 오류를 확인해주세요.`,updatedAt:value.checkedAt};
}
