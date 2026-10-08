import { validateQuotationChanges, type QuotationFieldsView } from '@/app/quotation-schema';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import { verifyOptionImageSave, verifyOptionImageRestored } from '@/app/quotation-image-targets';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function verifyMainImageView(view:QuotationFieldsView){
 if(!view||!Number.isSafeInteger(view.revision)||view.revision<0||!/^[a-f0-9]{64}$/.test(view.inputFingerprint)||!Number.isFinite(Date.parse(view.productVersion))
  ||![view.contentRevision,view.optionRevision].every(n=>Number.isSafeInteger(n)&&n>=0)||!Array.isArray(view.imageKeys)||view.imageKeys.length>50||view.imageKeys.some(key=>typeof key!=='string'||!key)||new Set(view.imageKeys).size!==view.imageKeys.length
  ||!view.categoryContext||!Array.isArray(view.resolved?.schema?.fields)||!Array.isArray(view.resolved.rows)||!Array.isArray(view.automatic?.rows)||!view.overrides?.common||!view.overrides.options
  ||view.resolved.rows.filter(row=>row.optionId===null).length!==1||new Set(view.resolved.rows.map(row=>row.optionId)).size!==view.resolved.rows.length)throw Error('최종 견적 대표이미지 저장본을 확인하지 못했습니다.');
 const target=exactPrimaryQuotationTarget(view.resolved.schema.fields,'mainImage');
 if(target.fields.some(field=>field.readOnly)||view.resolved.rows.some(row=>row.optionId!==null&&!/^[A-Za-z0-9_-]{1,80}$/.test(row.optionId)||typeof row.included!=='boolean'||target.linked.some(id=>typeof row.fields?.[id]?.value!=='string')))throw Error('최종 대표이미지의 옵션·항목 연결을 확인해주세요.');
 return target;
}
export function mainImageValue(view:QuotationFieldsView,optionId:string,draft?:string|null){const target=verifyMainImageView(view);if(typeof draft==='string')return draft;if(draft===null)return view.overrides.common[target.primary]??view.automatic.rows.find(row=>row.optionId===optionId)?.fields[target.primary]?.value??'';const rows=view.resolved.rows.filter(row=>row.optionId===optionId);if(rows.length!==1)throw Error('현재 상품의 옵션을 선택해주세요.');return rows[0].fields[target.primary].value;}
export function mainImageChanges(view:QuotationFieldsView,optionId:string,value:string|null){const target=verifyMainImageView(view);return validateQuotationChanges(target.linked.map(fieldKey=>({optionId,fieldKey,value})),{schema:view.resolved.schema,optionIds:view.resolved.rows.flatMap(row=>row.optionId?[row.optionId]:[]),ownedImageKeys:view.imageKeys,overrides:view.overrides});}
export async function readMainImageView(endpoint:string,request:typeof fetch=fetch){const response=await request(endpoint,{cache:'no-store'}),view=await response.json() as QuotationFieldsView & {error?:string};if(!response.ok)throw Error(view.error||'최종 대표이미지를 읽지 못했습니다.');verifyMainImageView(view);return view;}
export function verifyMainImageRefresh(before:QuotationFieldsView,latest:QuotationFieldsView,optionId:string){const target=verifyMainImageView(before),next=verifyMainImageView(latest);
 if(!same(target,next)||!same(before.categoryContext,latest.categoryContext)||latest.revision<before.revision||Date.parse(latest.productVersion)<Date.parse(before.productVersion)||latest.contentRevision<before.contentRevision||latest.optionRevision<before.optionRevision
  ||target.linked.some(id=>before.overrides.options[optionId]?.[id]!==latest.overrides.options[optionId]?.[id]||before.overrides.common[id]!==latest.overrides.common[id]
   ||!same(before.resolved.rows.find(row=>row.optionId===optionId)?.fields[id],latest.resolved.rows.find(row=>row.optionId===optionId)?.fields[id])))throw Error('최종 대표이미지에 다른 저장값이 있습니다. 선택을 유지했습니다. 저장본과 비교해주세요.');
}
export function verifyMainImageSave(before:QuotationFieldsView,saved:QuotationFieldsView,optionId:string,value:string|null){if(!same(verifyMainImageView(before),verifyMainImageView(saved)))throw Error('대표이미지 항목 연결이 변경되었습니다.');verifyOptionImageSave(before,saved,optionId,mainImageChanges(before,optionId,value));}
export class MainImageSaveError extends Error{constructor(message:string,public uncertain:boolean){super(message);}}
/** Final quotation image edits only. Never writes source options, price policy,
 * shared content roles or image bytes; retries prove an existing commit first. */
export async function saveMainImageView(endpoint:string,before:QuotationFieldsView,optionId:string,value:string|null,request:typeof fetch=fetch){
 const changes=mainImageChanges(before,optionId,value),current=await readMainImageView(endpoint,request);
 if(current.revision!==before.revision||current.inputFingerprint!==before.inputFingerprint||current.productVersion!==before.productVersion){verifyMainImageSave(before,current,optionId,value);return current;}
 let response:Response|undefined;
 try{response=await request(endpoint,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:before.revision,expectedInputFingerprint:before.inputFingerprint,changes})});const ack=await response.json() as QuotationFieldsView & {error?:string};if(!response.ok)throw Error(ack.error||'최종 대표이미지를 저장하지 못했습니다.');verifyMainImageSave(before,ack,optionId,value);
  const saved=await readMainImageView(endpoint,request);verifyMainImageSave(before,saved,optionId,value);verifyOptionImageRestored(ack,saved,optionId,changes);if(!same(ack.overrides,saved.overrides)||!same(ack.resolved,saved.resolved))throw Error('대표이미지 응답과 저장본이 다릅니다.');return saved;
 }catch(cause){try{const saved=await readMainImageView(endpoint,request);verifyMainImageSave(before,saved,optionId,value);return saved;}catch{/* Preserve choices for an explicit read-first retry. */}throw new MainImageSaveError(cause instanceof Error?cause.message:'최종 대표이미지 저장 결과 확인 실패',!response||response.ok);}
}
