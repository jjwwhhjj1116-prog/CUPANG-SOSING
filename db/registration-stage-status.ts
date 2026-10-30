import {env} from 'cloudflare:workers';
import {automationInputFingerprint,type AutomationWorkflow} from '@/app/automation/model';
import {emptyProductContent,withCurrentLabelFields,type ProductContent} from '@/app/product-content';
import {emptyProductOptions,type ProductOptions} from '@/app/product-options';
import type {ProductRecord} from '@/db/queries';
import type {QuotationFieldsState} from '@/db/quotation-fields';
import type {TranslationJob} from '@/app/automation/translation';
import {savedRegistrationSettings} from '@/app/workspace-settings';
import {registrationStagesFromWorkflow,type RegistrationStageSummary} from '@/app/registration-stage-status';
type Row={id:string;updated_at:string;image_keys:string;workflow:string;workflow_revision:number;content:string|null;content_revision:number|null;options:string|null;option_revision:number|null;quotation:string|null;quotation_revision:number|null;settings:string|null};
/** Optional execution proof, owner-scoped and batched. This projection never
 * initializes a table or invokes an executor, provider, or storage write. */
export async function readRegistrationExecutionStages(owner:string,products:{id:string;image_keys:string;updated_at?:string}[]) {
 const result:Record<string,RegistrationStageSummary>={};if(!env.DB||!products.length)return result;
 for(let offset=0;offset<products.length;offset+=80){
  const chunk=products.slice(offset,offset+80);
  try{
   const rows=await env.DB.prepare(`SELECT p.id,p.updated_at,p.image_keys,a.payload AS workflow,a.revision AS workflow_revision,
    c.payload AS content,c.revision AS content_revision,o.payload AS options,o.revision AS option_revision,
    q.payload AS quotation,q.revision AS quotation_revision,s.payload AS settings
    FROM products p JOIN product_automation a ON a.product_id=p.id AND a.owner_id=p.owner_id
    LEFT JOIN product_content c ON c.product_id=p.id AND c.owner_id=p.owner_id
    LEFT JOIN product_options o ON o.product_id=p.id AND o.owner_id=p.owner_id
    LEFT JOIN product_quotation_fields q ON q.product_id=p.id AND q.owner_id=p.owner_id
    LEFT JOIN workspace_settings s ON s.owner_id=p.owner_id
    WHERE p.owner_id=? AND p.id IN (${chunk.map(()=>'?').join(',')})`).bind(owner,...chunk.map(product=>product.id)).all<Row>();
   // Match automation GET's newest twenty translation records per product.
   const translations=await env.DB.prepare(`SELECT * FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY product_id ORDER BY created_at DESC,id DESC) AS row_number
    FROM translation_jobs WHERE owner_id=? AND product_id IN (${chunk.map(()=>'?').join(',')})) WHERE row_number<=20 ORDER BY created_at DESC,id DESC`).bind(owner,...chunk.map(product=>product.id)).all<{id:string;product_id:string;product_version:string;content_revision:number;status:string;review:string;result:string|null}>().catch(()=>({results:[]}));
   for(const row of rows.results){try{
    const product=chunk.find(product=>product.id===row.id);if(!product||product.image_keys!==row.image_keys||product.updated_at!==row.updated_at)continue;
    const workflow=JSON.parse(row.workflow) as AutomationWorkflow,content=row.content?withCurrentLabelFields(JSON.parse(row.content) as ProductContent):emptyProductContent(row.id),options=row.options?JSON.parse(row.options) as ProductOptions:emptyProductOptions(row.id);
    const quotation:QuotationFieldsState=row.quotation?JSON.parse(row.quotation):{schemaVersion:1,productId:row.id,revision:0,updatedAt:null,overrides:{common:{},options:{}}};
    if(workflow.revision!==row.workflow_revision||workflow.productId!==row.id||workflow.productVersion!==row.updated_at||workflow.contentRevision!==content.revision
      ||content.productId!==row.id||content.revision!==(row.content_revision??0)||options.productId!==row.id||options.revision!==(row.option_revision??0)||quotation.productId!==row.id||quotation.revision!==(row.quotation_revision??0))continue;
    const translationRow=translations.results.find(job=>job.product_id===row.id&&job.status==='completed'&&job.product_version===row.updated_at&&job.content_revision===content.revision);
    const translation=translationRow?{id:translationRow.id,productId:row.id,productVersion:translationRow.product_version,contentRevision:translationRow.content_revision,status:translationRow.status,review:JSON.parse(translationRow.review),result:translationRow.result?JSON.parse(translationRow.result):null} as TranslationJob:null;
    const fingerprint=await automationInputFingerprint(product as ProductRecord,savedRegistrationSettings(row.settings?JSON.parse(row.settings):null),content,translation,options,quotation);
    result[row.id]=registrationStagesFromWorkflow(product,workflow,workflow.inputFingerprint===fingerprint,!!content.assets.size.value.length||!!content.manualSizeChart);
   }catch{/* Corrupt or changed execution proof cannot complete a stage. */}}
  }catch{/* Legacy/partial databases have no execution proof. */}
 }
 return result;
}
