import {applyContentPatch,contentDetailImageKeys,type ProductContent} from '@/app/product-content';
import {isOwnedImageKey,PRODUCT_IMAGE_POOL_LIMIT} from '@/app/image-files';
import {optionImageTargets,quotationImageKeys} from '@/app/quotation-image-targets';
import {applyQuotationChanges,validateQuotationChanges,quotationValueIssues,type QuotationFieldsView,type QuotationChange} from '@/app/quotation-schema';

export type ImageUploadTarget={optionId:string|null;profileId?:string};
export type ImageUploadRole='additional'|'detail';
export type ImageUploadLinkBasis={productId:string;ownerId:string;productVersion:string;imageKeys:string[];content:ProductContent;quotation:QuotationFieldsView;target:ImageUploadTarget;stage:ImageUploadRole};
export type ImageUploadLinkRequest={key:string;stage:ImageUploadRole;optionId:string|null;expectedProductVersion:string;expectedContentRevision:number;expectedOptionRevision:number;expectedQuotationRevision:number;expectedInputFingerprint:string};
export type ImageUploadLinkReceipt={productVersion:string;imageKeys:string[];content:ProductContent;quotation:QuotationFieldsView};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const id=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/u.test(value);
export const imageUploadLinkChanged=()=>Error('상품·옵션 또는 이미지 연결 기준이 변경됐습니다. 파일과 현재 편집값은 유지했습니다.');
export function validateImageUploadTarget(target:ImageUploadTarget){
 if(!target||typeof target!=='object'||Array.isArray(target)||Object.keys(target).some(key=>!['optionId','profileId'].includes(key))
  ||target.optionId!==null&&!id(target.optionId)||target.profileId!==undefined&&!id(target.profileId))throw imageUploadLinkChanged();
}
export function validateImageUploadLinkBasis(base:ImageUploadLinkBasis){
 validateImageUploadTarget(base.target);const view=base.quotation;
 if(!id(base.productId)||!base.ownerId||!['additional','detail'].includes(base.stage)||!Number.isFinite(Date.parse(base.productVersion))
  ||base.content?.productId!==base.productId||!Number.isSafeInteger(base.content.revision)||base.content.revision<0
  ||!view||view.productVersion!==base.productVersion||view.contentRevision!==base.content.revision
  ||!Number.isSafeInteger(view.revision)||view.revision<0||!Number.isSafeInteger(view.optionRevision)||view.optionRevision<0||!/^[a-f0-9]{64}$/u.test(view.inputFingerprint)
  ||!same(view.imageKeys,base.imageKeys)||base.imageKeys.length>PRODUCT_IMAGE_POOL_LIMIT||new Set(base.imageKeys).size!==base.imageKeys.length||base.imageKeys.some(key=>!isOwnedImageKey(base.ownerId,key))
  ||!view.overrides?.common||!view.overrides.options||!Array.isArray(view.resolved?.schema?.fields)||!Array.isArray(view.resolved.rows)||!Array.isArray(view.automatic?.rows)
  ||base.target.profileId!==undefined&&view.categoryContext?.profileId!==base.target.profileId
  ||base.target.optionId!==null&&view.resolved.rows.filter(row=>row.optionId===base.target.optionId).length!==1)throw imageUploadLinkChanged();
 const field=optionImageTargets(view.resolved.schema.fields)[base.stage==='additional'?'additionalImages':'detailImages'];
 if(field.fields.some(value=>value.readOnly))throw Error('현재 카테고리의 이미지 연결을 수정할 수 없습니다.');
}
/** Keep existing order and pinned bottom banners; new body photos precede them. */
export function appendUploadRoleKey(keys:readonly string[],key:string,bottom:readonly string[]=[]){
 if(new Set(keys).size!==keys.length||keys.includes(key))throw imageUploadLinkChanged();
 let at=keys.length;while(at>0&&bottom.includes(keys[at-1]))at--;
 return [...keys.slice(0,at),key,...keys.slice(at)];
}
export function imageUploadLinkRequest(base:ImageUploadLinkBasis,key:string):ImageUploadLinkRequest{
 validateImageUploadLinkBasis(base);return{key,stage:base.stage,optionId:base.target.optionId,expectedProductVersion:base.productVersion,expectedContentRevision:base.content.revision,
  expectedOptionRevision:base.quotation.optionRevision,expectedQuotationRevision:base.quotation.revision,expectedInputFingerprint:base.quotation.inputFingerprint};
}
/** Common additional uploads extend inherited content and existing included
 * option lists; common detail imports add body photos only. Optional selected
 * uploads alter only that option's image fields. Saved HTML,
 * other roles, original option facts and excluded-option overrides stay intact. */
export function prepareImageUploadLink(base:ImageUploadLinkBasis,key:string,now:string){
 validateImageUploadLinkBasis(base);
 if(!isOwnedImageKey(base.ownerId,key)||base.imageKeys.includes(key)||base.imageKeys.length>=PRODUCT_IMAGE_POOL_LIMIT||!Number.isFinite(Date.parse(now))||Date.parse(now)<=Date.parse(base.productVersion))throw imageUploadLinkChanged();
 const view=base.quotation,input=base.stage==='additional'?'additionalImages':'detailImages',target=optionImageTargets(view.resolved.schema.fields)[input],bottom=base.stage==='detail'?base.content.assets.detailBottom.value:[],imageKeys=[...base.imageKeys,key];
 const commonBefore=base.stage==='additional'?base.content.assets.additional.value:contentDetailImageKeys(base.content);
 let content=base.content;const changes:QuotationChange[]=[];
 const append=(value:string)=>{const keys=appendUploadRoleKey(quotationImageKeys(value),key,bottom),limit=Math.min(30,...target.fields.map(field=>field.maxItems??30));if(keys.length>limit)throw Error(`${base.stage==='additional'?'추가':'상세'} 이미지는 최대 ${limit}개까지 연결할 수 있습니다.`);return keys.join('\n');};
 if(base.target.optionId===null){
  const keys=appendUploadRoleKey(base.content.assets[base.stage].value,key);
  if(keys.length>30)throw Error('추가·상세 이미지는 각각 30개 이내로 연결해주세요.');
  content=applyContentPatch(base.content,{assets:{[base.stage]:keys}},now);
  for(const fieldKey of base.stage==='additional'?target.linked:[]){
   if(Object.hasOwn(view.overrides.common,fieldKey))changes.push({optionId:null,fieldKey,value:append(view.overrides.common[fieldKey])});
   for(const row of view.resolved.rows){
    if(!row.included||row.optionId===null)continue;
    const own=view.overrides.options[row.optionId];
    if(own&&Object.hasOwn(own,fieldKey))changes.push({optionId:row.optionId,fieldKey,value:append(own[fieldKey])});
   }
  }
 }else{
  const row=view.resolved.rows.find(value=>value.optionId===base.target.optionId)!;
  for(const fieldKey of target.linked){if(typeof row.fields[fieldKey]?.value!=='string')throw imageUploadLinkChanged();changes.push({optionId:base.target.optionId,fieldKey,value:append(row.fields[fieldKey].value)});}
 }
 const checked=changes.length?validateQuotationChanges(changes,{schema:view.resolved.schema,optionIds:view.resolved.rows.flatMap(row=>row.optionId?[row.optionId]:[]),ownedImageKeys:imageKeys,overrides:view.overrides}):[],overrides=checked.length?applyQuotationChanges(view.overrides,checked):view.overrides;
 // Validate inherited lists too, even when no manual override needs a write.
 const commonAfter=base.stage==='additional'?content.assets.additional.value:contentDetailImageKeys(content);
 for(const field of target.fields)for(const row of view.resolved.rows){
  if(base.target.optionId!==null&&row.optionId!==base.target.optionId)continue;
  const value=row.optionId!==null&&Object.hasOwn(overrides.options[row.optionId]??{},field.id)?overrides.options[row.optionId][field.id]
   :Object.hasOwn(overrides.common,field.id)?overrides.common[field.id]
   :base.target.optionId===null?commonAfter.join('\n'):row.fields[field.id]?.value??commonBefore.join('\n');
  const errors=quotationValueIssues(field,value,imageKeys);if(errors.length)throw Error(errors[0]);
 }
 return{imageKeys,content,overrides,changes:checked};
}
export function verifyImageUploadLinkReceipt(base:ImageUploadLinkBasis,key:string,value:unknown):ImageUploadLinkReceipt{
 const body=value as ImageUploadLinkReceipt;
 if(!body||typeof body.productVersion!=='string')throw imageUploadLinkChanged();
 const expected=prepareImageUploadLink(base,key,body.productVersion),view=body.quotation,before=base.quotation;
 if(!same(body.imageKeys,expected.imageKeys)||!same(body.content,expected.content)||!view||view.productVersion!==body.productVersion||view.updatedAt!==body.productVersion
  ||view.revision!==before.revision+1||view.contentRevision!==expected.content.revision||view.optionRevision!==before.optionRevision
  ||!same(view.imageKeys,expected.imageKeys)||!same(view.overrides,expected.overrides)||!/^[a-f0-9]{64}$/u.test(view.inputFingerprint)||view.inputFingerprint===before.inputFingerprint
  ||!same(view.categoryContext,before.categoryContext)||!same(view.resolved?.schema,before.resolved.schema)||!same(view.automatic?.schema,before.automatic.schema))throw imageUploadLinkChanged();
 const target=optionImageTargets(before.resolved.schema.fields)[base.stage==='additional'?'additionalImages':'detailImages'],roleIds=new Set(target.linked),htmlIds=new Set(optionImageTargets(before.resolved.schema.fields).detailHtml.linked);
 const common=base.stage==='additional'?expected.content.assets.additional.value:contentDetailImageKeys(expected.content);
 for(const layer of ['resolved','automatic'] as const){
  const old=before[layer],next=view[layer];
  if(!same({...old,rows:[]},{...next,rows:[]})||!Array.isArray(next.rows)||next.rows.length!==old.rows.length)throw imageUploadLinkChanged();
  for(let index=0;index<old.rows.length;index++){
   const row=old.rows[index],after=next.rows[index],affected=base.target.optionId===null||row.optionId===base.target.optionId;
   if(!after||!same({...row,fields:{}},{...after,fields:{}})||!same(Object.keys(row.fields),Object.keys(after.fields)))throw imageUploadLinkChanged();
   for(const field of Object.keys(row.fields)){
    const cell=row.fields[field],value=after.fields[field];
    if(roleIds.has(field)){
     if(layer==='automatic'){
      if(base.target.optionId!==null&&!same(cell,value))throw imageUploadLinkChanged();
      if(base.target.optionId===null&&value.value!==common.join('\n'))throw imageUploadLinkChanged();
     }else if(affected){
      const own=row.optionId!==null?expected.overrides.options[row.optionId]:undefined;
      const wanted=own&&Object.hasOwn(own,field)?own[field]:Object.hasOwn(expected.overrides.common,field)?expected.overrides.common[field]:common.join('\n');
      if(value.value!==wanted)throw imageUploadLinkChanged();
     }else if(!same(cell,value))throw imageUploadLinkChanged();
    }else if(base.stage==='detail'&&affected&&htmlIds.has(field)&&!cell.source.startsWith('manual-')){
     if(typeof value.value!=='string'||value.source.startsWith('manual-'))throw imageUploadLinkChanged();
    }else if(!same(cell,value))throw imageUploadLinkChanged();
   }
  }
 }
 // Optional metadata can be enriched independently, but operation bindings and
 // protected banners/option identifiers must remain exact.
 for(const name of ['optionRegistrationNumbers','protectedDetailImageKeys','registrationBrandChoices','optionPackQuantities','packagingBasis','stageTwoMsrp','detailEditorInputs','detailSaveTextBasis','retainedWorkbook'] as const)
  if(!same(before[name],view[name]))throw imageUploadLinkChanged();
 return body;
}
