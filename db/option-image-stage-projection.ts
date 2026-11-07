import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {stableQuotationFieldsView,QuotationFieldsSnapshotError} from '@/app/quotation-fields-snapshot';
import {quotationSourcesCurrent,readQuotationFields} from '@/db/quotation-fields';
import {readImageNoTextReceipts} from '@/db/image-no-text-receipts';
import {exactPrimaryQuotationTarget} from '@/app/quotation-seo-targets';
import {registrationStagesFromSavedContent,type RegistrationStageStatus} from '@/app/registration-stage-status';
import type {ProductContent} from '@/app/product-content';
import type {ProductRecord} from '@/db/queries';
import type {QuotationFieldsView} from '@/app/quotation-schema';
import {parseWorkspaceSettingsScope,type WorkspaceSettingsScope} from '@/app/workspace-settings-scope';

type ImageStages=Record<'mainImage'|'additionalImages',RegistrationStageStatus>;
export type OptionImageStageProjection={format:'option-image-stages-v1';scope:WorkspaceSettingsScope;productId:string;productVersion:string;
 contentRevision:number;optionRevision:number;quotationRevision:number;inputFingerprint:string;stages:Record<string,ImageStages>};
const changed=()=>new QuotationFieldsSnapshotError('옵션 이미지의 회원·회사 또는 저장 원본이 변경되었습니다. 목록을 다시 불러와주세요.',409,'OPTION_IMAGE_STAGES_CONFLICT');
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
async function actor(owner:string){
 const currentOwner=await getWorkspaceOwnerId(),user=await getChatGPTUser();
 if(process.env.NODE_ENV!=='production'&&!user?.verifiedAccess)return null;
 const member=user?.membership,scope=parseWorkspaceSettingsScope({ownerId:owner,company:approvedSupplierHubCompany(member)});
 if(currentOwner!==owner||!user?.verifiedAccess||user.userId!==owner||member?.id!==owner||member.status!=='approved'||!scope?.company||member.email.trim().toLowerCase()!==user.email.trim().toLowerCase())throw changed();
 return{ownerId:owner,company:scope.company,member:{email:member.email.trim().toLowerCase(),role:member.role,companyCode:scope.company.code,companyName:scope.company.name}};
}
/** Read-only, opt-in metadata for the option board. Never add changing receipt
 * projections to the quotation views used as image-operation checkpoints. */
export async function readOptionImageStageProjection(owner:string,product:ProductRecord,content:ProductContent,includeQuotation=false):Promise<{projection:OptionImageStageProjection;quotation?:QuotationFieldsView}|undefined>{
 const before=await actor(owner);if(!before)return;
 const assertActor=async()=>{if(!same(await actor(owner),before))throw changed();};
 const saved=await stableQuotationFieldsView(owner,product.id,null);await assertActor();
 const view=saved.view;
 if(product.owner_id!==owner||product.updated_at!==view.productVersion||content.productId!==product.id||content.revision!==view.contentRevision||product.image_keys!==saved.source.imageKeys)throw changed();
 const proofs=(await readImageNoTextReceipts(owner,[product]))[product.id]??[];await assertActor();
 const targets={mainImage:exactPrimaryQuotationTarget(view.resolved.schema.fields,'mainImage'),additionalImages:exactPrimaryQuotationTarget(view.resolved.schema.fields,'additionalImages')};
 const stages:Record<string,ImageStages>=Object.create(null);
 for(const option of saved.options.rows){
  const matches=view.resolved.rows.filter(row=>row.optionId===option.id),row=matches[0];if(matches.length!==1)throw changed();
  const final={optionId:option.id,title:'',main:[] as string[],additional:[] as string[],detail:[] as string[],label:[] as string[],imageIssues:{} as Partial<Record<'main'|'additional',boolean>>,manualImages:{} as Partial<Record<'main'|'additional',boolean>>};
  for(const [input,role]of [['mainImage','main'],['additionalImages','additional']]as const){
   const target=targets[input],field=row.fields[target.primary];if(typeof field?.value!=='string')throw changed();
   const keys=field.value.split(/\r?\n/).map(key=>key.trim()).filter(Boolean),linked=target.linked.every(key=>row.fields[key]?.value===field.value);
   final[role]=keys;final.imageIssues[role]=!!(field.validationIssues??field.issues)?.length||!linked||new Set(keys).size!==keys.length||target.primaryField.maxItems!==undefined&&keys.length>target.primaryField.maxItems;
   final.manualImages[role]=linked&&['manual-option','manual-common'].includes(field.source)&&!field.validationIssues?.length;
  }
  const result=registrationStagesFromSavedContent(product,content,saved.options,view.imageKeys,[final],proofs);
  stages[option.id]={mainImage:result.mainImage,additionalImages:result.additionalImages};
 }
 // Includes product/content/options/settings/profile/captured source and the
 // current approved member. A receipt must not bridge an intervening edit.
 const source=includeQuotation?(saved.mappedGenerated?.source??saved.source):saved.source;
 const [current,quotationState]=await Promise.all([
  quotationSourcesCurrent(owner,product.id,{...source,member:before.member}),
  includeQuotation?readQuotationFields(owner,product.id):saved.state,
 ]);
 // The input check can update saved validation without advancing the product or quotation clock.
 if(!current||includeQuotation&&!same(quotationState,saved.state))throw changed();await assertActor();
 const projection:OptionImageStageProjection={format:'option-image-stages-v1',scope:{ownerId:owner,company:before.company},productId:product.id,productVersion:view.productVersion,contentRevision:view.contentRevision,
  optionRevision:view.optionRevision,quotationRevision:view.revision,inputFingerprint:view.inputFingerprint,stages};
 return{projection,...(includeQuotation?{quotation:view}:{})};
}
