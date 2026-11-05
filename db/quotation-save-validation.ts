import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {sourceGuard,type QuotationFieldsState,type QuotationSourceGuard} from '@/db/quotation-fields';
import {createSavedQuotationValidation,parseSavedQuotationValidation,quotationValidationSourceBinding,type QuotationValidationActor,type SavedQuotationValidation} from '@/app/quotation-save-validation';
import {fingerprint} from '@/app/automation/model';
import {getQuotationSchema,type QuotationFieldsView} from '@/app/quotation-schema';
import {validateCategoryProfile} from '@/app/category-profiles';
import {validateCategoryIdentity} from '@/app/category-identity';
import {verifyCapturedCollectionCompany} from '@/app/collection-company';
import {parseCollectionRequest} from '@/app/sourcing';
import {emptyProductContent,withCurrentLabelFields,type ProductContent} from '@/app/product-content';
import {emptyProductOptions,type ProductOptions} from '@/app/product-options';
import {publicDetailConfig,publicDetailVersion} from '@/app/quotation-public-detail';

export async function readQuotationValidationActor(owner:string):Promise<QuotationValidationActor|null>{
 try{const user=await getChatGPTUser(),member=user?.membership,company=user?.verifiedAccess?approvedSupplierHubCompany(member):null;
  return user?.userId===owner&&member?.id===owner&&company&&['admin','member'].includes(member.role)?{ownerId:owner,email:member.email.trim().toLowerCase(),role:member.role,company}:null;
 }catch{return null;}
}
export async function quotationValidationEnvironment(owner:string){const actor=await readQuotationValidationActor(owner),config=publicDetailConfig(env as Parameters<typeof publicDetailConfig>[0]);return{actor,detailVersion:config?await publicDetailVersion(config):null};}
/** Append evidence only: no source clock, revision or input value is written. */
export async function saveQuotationValidation(owner:string,productId:string,view:QuotationFieldsView,expectedState:QuotationFieldsState,source:QuotationSourceGuard,binding:string|null,actor:QuotationValidationActor|null,requestedProfileId:string|null):Promise<boolean>{
 if(!env.DB||!actor||!binding||actor.ownerId!==owner||JSON.stringify(await readQuotationValidationActor(owner))!==JSON.stringify(actor))return false;
 const row=await env.DB.prepare('SELECT payload,revision FROM product_quotation_fields WHERE owner_id=? AND product_id=?').bind(owner,productId).first<{payload:string;revision:number}>();if(!row||row.revision!==view.revision)return false;
 const current=JSON.parse(row.payload) as QuotationFieldsState,left={...current},right={...expectedState};delete left.savedValidation;delete right.savedValidation;
 if(await fingerprint(left)!==await fingerprint(right))return false;
 const proof=createSavedQuotationValidation(view,productId,requestedProfileId,binding),payload=JSON.stringify({...current,savedValidation:proof});if(new TextEncoder().encode(payload).length>512*1024)return false;
 const guarded=(env as {YOOFAM_AUTH_ENABLED?:string}).YOOFAM_AUTH_ENABLED==='true'?{...source,member:{email:actor.email,role:actor.role,companyCode:actor.company.code,companyName:actor.company.name}}:source,guard=sourceGuard(owner,productId,guarded);
 const stored=await env.DB.prepare(`UPDATE product_quotation_fields SET payload=? WHERE owner_id=? AND product_id=? AND revision=? AND payload=?
  AND EXISTS(SELECT 1 FROM products p WHERE ${guard.sql}) RETURNING revision`).bind(payload,owner,productId,view.revision,row.payload,...guard.args).first<{revision:number}>();
 return stored?.revision===view.revision&&JSON.stringify(await readQuotationValidationActor(owner))===JSON.stringify(actor);
}

export type QuotationValidationListingRow={product_id:string;product_version:string;image_keys:string;source_url:string;content_revision:number|null;option_payload:string|null;option_revision:number|null;quotation_payload:string|null;quotation_revision:number|null;
 linked_job:string|null;valid_job:string|null;job_offer:string|null;job_updated_at:string|null;context_payload:string|null;settings_payload:string|null;validation_profile_id:string|null;validation_profile_revision:number|null;validation_profile_payload:string|null};
/** Reconstruct the same source selection from the existing owner-scoped batch. */
export async function savedQuotationValidationForListing(owner:string,product:{id:string;image_keys:string;source_url?:string;updated_at?:string;pricing_policy?:string|null},content:ProductContent|null,row:QuotationValidationListingRow,environment:Awaited<ReturnType<typeof quotationValidationEnvironment>>):Promise<SavedQuotationValidation|null>{
 try{
  const actor=environment.actor;if(!actor||actor.ownerId!==owner||row.product_id!==product.id||row.product_version!==product.updated_at||row.image_keys!==product.image_keys||!row.quotation_payload)return null;
  const state=JSON.parse(row.quotation_payload) as QuotationFieldsState,proof=state.savedValidation,value=parseSavedQuotationValidation(proof);
  if(!value||!proof||value.productId!==product.id||state.schemaVersion!==1||state.productId!==product.id||state.revision!==row.quotation_revision||value.revision!==state.revision||value.productVersion!==product.updated_at)return null;
  const normalizedContent=content?withCurrentLabelFields(content):emptyProductContent(product.id),options:ProductOptions=row.option_payload?JSON.parse(row.option_payload):emptyProductOptions(product.id);
  if(normalizedContent.productId!==product.id||normalizedContent.revision!==(row.content_revision??0)||options.schemaVersion!==1||options.productId!==product.id||options.revision!==(row.option_revision??0))return null;
  const selected=value.requestedProfileId,profile=selected&&row.validation_profile_id===selected&&row.validation_profile_payload?{...validateCategoryProfile(JSON.parse(row.validation_profile_payload)),id:selected,revision:row.validation_profile_revision}:null;
  if(selected&&(!profile||!Number.isSafeInteger(profile.revision)||Number(profile.revision)<1))return null;
  let categoryContext:QuotationFieldsView['categoryContext']=profile?{source:'profile',profileId:profile.id,categoryId:profile.categoryId||null,categoryPath:[...profile.categoryPath]}:{source:'unknown',profileId:null,categoryId:null,categoryPath:[]};
  let hubSchema=profile?.hubSchema,template=profile?.template,collection:QuotationSourceGuard['collection']=null,offerId:string|null=null;
  try{offerId=parseCollectionRequest({urls:[product.source_url??row.source_url]})[0].offerId;}catch{/* Non-product legacy URLs have no captured category. */}
  if(offerId){
   if(row.linked_job){if(row.valid_job!==row.linked_job||row.job_offer!==offerId||!row.context_payload||!row.job_updated_at)return null;
    const captured=JSON.parse(row.context_payload);verifyCapturedCollectionCompany(captured,actor.company);collection={offerId,snapshot:{id:row.linked_job,payload:row.context_payload,updatedAt:row.job_updated_at,linked:true}};
    if(profile){const category=captured.category?validateCategoryProfile(captured.category):null;if(!category||captured.category.id!==profile.id||category.categoryId!==profile.categoryId||JSON.stringify(category.categoryPath)!==JSON.stringify(profile.categoryPath))return null;hubSchema=category.hubSchema;}
    else if(captured.category){const category=validateCategoryProfile(captured.category);hubSchema=category.hubSchema;template=category.template;categoryContext={source:'collection',profileId:typeof captured.category.id==='string'?captured.category.id:null,categoryId:category.categoryId||null,categoryPath:[...category.categoryPath]};}
   }else collection={offerId,snapshot:null};
  }
  if([hubSchema,profile?.hubSchema].some(schema=>schema&&(schema.company.code!==actor.company.code||schema.company.name!==actor.company.name)))return null;
  if(categoryContext.categoryId)validateCategoryIdentity({categoryId:categoryContext.categoryId,categoryPath:categoryContext.categoryPath});
  const source:QuotationSourceGuard={productVersion:row.product_version,imageKeys:row.image_keys,pricingPolicy:product.pricing_policy??null,contentRevision:normalizedContent.revision,optionRevision:options.revision,settingsPayload:row.settings_payload,profile:profile?{id:profile.id,revision:profile.revision!}:null,collection};
  const binding=await quotationValidationSourceBinding({actor,product,content:normalizedContent,options,state,source,schema:getQuotationSchema(categoryContext.categoryId,categoryContext.categoryPath,hubSchema,template),categoryContext,detailVersion:environment.detailVersion,validation:value});
  return proof.sourceBinding===binding?value:null;
 }catch{return null;}
}
