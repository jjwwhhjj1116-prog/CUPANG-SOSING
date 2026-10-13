import {env} from 'cloudflare:workers';
import {CollectionForkError,type CollectionNewDraftTargetRequest,type CollectionNewDraftPreview,type CollectionNewDraftCreated} from '@/app/collection-fork';
import {ensureCollectionDatabase,findCollectionJob} from '@/db/collection-jobs';
import {ensureDatabase,getSettings} from '@/db/queries';
import {readCollectionResult,effectiveCollectionPayload} from '@/db/collection-results';
import {getCategoryProfile} from '@/db/category-profiles';
import {validateStoredTemplate} from '@/db/category-templates';
import {readProductContent} from '@/db/product-content';
import {readProductOptions} from '@/db/product-options';
import {readQuotationFields} from '@/db/quotation-fields';
import {hasUnsettledTranslation} from '@/db/translation-jobs';
import {listImageJobs} from '@/db/image-jobs';
import {collectionImagesSchema} from '@/db/collection-images';
import {savedRegistrationSettings} from '@/app/workspace-settings';
import {validateCategoryIdentity} from '@/app/category-identity';
import {verifyCapturedCollectionCompany} from '@/app/collection-company';
import {validateCollectionResult,collectionSourceWarnings,type CollectionResult} from '@/app/collection-result';
import {prepareCollectionProduct} from '@/app/collection-product';
import {fingerprint} from '@/app/automation/model';
import {isOwnedImageKey,MAX_IMAGE_BYTES,PRODUCT_IMAGE_POOL_LIMIT} from '@/app/image-files';
import {verifyWorkspaceBannerFiles} from '@/db/workspace-banners';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import type {CollectionContext,CollectionJob} from '@/app/sourcing';

type SourceImage={index:number;key:string;operationId:string;createdAt:string};
type SourceRow={id:string;owner_id:string;offer_id:string;source_url:string;goal:string;status:string;created_at:string;updated_at:string;source_context:string;original_receipt:string;receipt_payload:string;received_at:string;product_id:string;product_version:string;image_keys:string;pricing_policy:string|null;content_revision:number;content_payload:string|null;option_revision:number;option_payload:string|null;quotation_revision:number;quotation_payload:string|null;source_images:string;busy:number};
const sourceImagesSql=`(SELECT json_group_array(json_object('index',image_index,'key',object_key,'operationId',operation_id,'createdAt',created_at)) FROM (SELECT * FROM collection_images WHERE owner_id=j.owner_id AND job_id=j.id AND product_id=cp.product_id ORDER BY image_index))`;
const busySql=`(EXISTS(SELECT 1 FROM translation_jobs t WHERE t.owner_id=j.owner_id AND t.product_id=cp.product_id AND t.status IN ('running','uncertain')) OR EXISTS(SELECT 1 FROM image_jobs t WHERE t.owner_id=j.owner_id AND t.product_id=cp.product_id AND t.status IN ('running','uncertain')))`;
const joins=`FROM collection_jobs j JOIN collection_context c ON c.job_id=j.id JOIN collection_results r ON r.job_id=j.id AND r.owner_id=j.owner_id JOIN collection_products cp ON cp.job_id=j.id AND cp.owner_id=j.owner_id JOIN products p ON p.id=cp.product_id AND p.owner_id=cp.owner_id`;
const select=`SELECT j.*,c.payload AS source_context,r.payload AS original_receipt,${effectiveCollectionPayload} AS receipt_payload,r.received_at,cp.product_id,p.updated_at AS product_version,p.image_keys,(SELECT payload FROM product_price_policy WHERE product_id=p.id) AS pricing_policy,
 COALESCE((SELECT revision FROM product_content WHERE product_id=p.id AND owner_id=p.owner_id),0) AS content_revision,(SELECT payload FROM product_content WHERE product_id=p.id AND owner_id=p.owner_id) AS content_payload,
 COALESCE((SELECT revision FROM product_options WHERE product_id=p.id AND owner_id=p.owner_id),0) AS option_revision,(SELECT payload FROM product_options WHERE product_id=p.id AND owner_id=p.owner_id) AS option_payload,
 COALESCE((SELECT revision FROM product_quotation_fields WHERE product_id=p.id AND owner_id=p.owner_id),0) AS quotation_revision,(SELECT payload FROM product_quotation_fields WHERE product_id=p.id AND owner_id=p.owner_id) AS quotation_payload,${sourceImagesSql} AS source_images,${busySql} AS busy ${joins}`;
const conflict=(message='자료·기본설정·카테고리가 변경되었습니다. 기존 상품은 유지되며 새 초안 내용을 다시 확인해주세요.')=>new CollectionForkError(409,message);
async function database(owner:string,jobId:string){
 const db=await ensureCollectionDatabase();await ensureDatabase();await readCollectionResult(owner,jobId);
 const link=await db.prepare('SELECT product_id FROM collection_products WHERE owner_id=? AND job_id=?').bind(owner,jobId).first<{product_id:string}>();
 if(link){await readProductContent(owner,link.product_id);await readProductOptions(owner,link.product_id);await readQuotationFields(owner,link.product_id);await hasUnsettledTranslation(owner,link.product_id);await listImageJobs(owner,link.product_id);}
 await db.prepare(collectionImagesSchema).run();return db;
}
export async function prepareCollectionNewDraft(owner:string,company:SupplierHubCompany,jobId:string,input:CollectionNewDraftTargetRequest){
 const db=await database(owner,jobId),job=await findCollectionJob(owner,jobId);
 if(!job)throw new CollectionForkError(404,'수집 요청을 찾을 수 없습니다.');
 if(!job.product_id||job.status!=='awaiting_connector')throw conflict('진행 중이거나 취소된 수집 요청입니다. 기존 상품 반영을 완료한 뒤 새 초안을 만들어주세요.');
 const source=await db.prepare(`${select} WHERE j.owner_id=? AND j.id=? AND p.source_url=j.source_url AND NOT EXISTS(SELECT 1 FROM product_removals x WHERE x.owner_id=p.owner_id AND x.product_id=p.id)`).bind(owner,jobId).first<SourceRow>();
 if(!source)throw conflict('원문·현재 상품 연결을 확인하지 못했습니다. 기존 작업을 완료한 뒤 다시 확인해주세요.');
 if(source.busy)throw conflict('기존 상품의 번역·이미지 작업이 아직 진행 중입니다. 결과를 확인한 뒤 새 초안을 만들어주세요.');
 const claim=await db.prepare('SELECT job_id FROM collection_offer_claims WHERE owner_id=? AND offer_id=?').bind(owner,source.offer_id).first<{job_id:string}>();
 if(claim?.job_id!==jobId)throw conflict('이 URL의 현재 수집 요청이 변경되었습니다. 새로 불러온 요청에서 새 초안을 만들어주세요.');
 let recordedCompany;try{recordedCompany=verifyCapturedCollectionCompany(JSON.parse(source.source_context),company);}catch(error){throw conflict(error instanceof Error?error.message:'수집 당시 회사를 확인해주세요.');}if(!recordedCompany)throw conflict('수집 당시 승인 회사가 기록되지 않았습니다. 기존 원문을 확인해주세요.');
 const payload=JSON.parse(source.receipt_payload) as CollectionResult,{offerId,...raw}=payload,result=validateCollectionResult(raw,source.offer_id);
 if(offerId!==source.offer_id||result.sourceUrl!==source.source_url||JSON.stringify(result)!==JSON.stringify(payload))throw conflict('저장된 원문의 상품번호·주소·내용을 확인하지 못했습니다.');
 const profile=await getCategoryProfile(owner,input.profileId);if(!profile)throw new CollectionForkError(404,'선택한 새 카테고리를 찾을 수 없습니다.');
 if(profile.revision!==input.expectedProfileRevision)throw conflict('새 카테고리의 양식이 변경되었습니다. 다시 선택해주세요.');validateCategoryIdentity(profile);
 if(!profile.hubSchema||profile.hubSchema.company.code!==company.code||profile.hubSchema.company.name!==company.name||!profile.template?.workbookEvidence)throw conflict('현재 승인 회사의 공식 견적서가 연결된 카테고리를 선택해주세요.');
 await validateStoredTemplate(owner,profile.template,profile.hubSchema);
 const profileRow=await db.prepare('SELECT payload,revision FROM category_profiles WHERE owner_id=? AND id=?').bind(owner,input.profileId).first<{payload:string;revision:number}>();if(!profileRow||profileRow.revision!==profile.revision)throw conflict();
 const saved=await getSettings(owner),settings=savedRegistrationSettings(saved?JSON.parse(saved.payload):null);
 const images=JSON.parse(source.source_images) as SourceImage[];
 if(images.length!==result.images.length||images.some((image,index)=>image.index!==index||!isOwnedImageKey(owner,image.key)))throw conflict('기존 원본 이미지의 저장이 아직 완료되지 않았습니다. 기존 이미지 반영을 완료한 뒤 새 초안을 만들어주세요.');
 const imageObjects=[];for(const image of images){const object=await env.FILES?.head(image.key);if(!object||object.size<1||object.size>MAX_IMAGE_BYTES)throw conflict('저장된 원본 이미지 파일을 확인하지 못했습니다. 기존 원본 파일을 확인해주세요.');imageObjects.push({key:image.key,size:object.size,etag:object.etag??null});}
 const proof={owner,company,source,profile:profileRow,settings:saved?.payload??null,imageObjects},baseFingerprint=await fingerprint(proof);
 const preview:CollectionNewDraftPreview={format:'collection-new-draft-v1',baseFingerprint,source:{jobId,productId:source.product_id,sourceUrl:source.source_url,offerId:source.offer_id,company,collectedAt:result.collectedAt,receivedAt:source.received_at,productVersion:source.product_version,contentRevision:source.content_revision,optionRevision:source.option_revision,quotationRevision:source.quotation_revision,imageCount:images.length},target:{profileId:profile.id,profileRevision:profile.revision,categoryId:profile.categoryId,categoryPath:profile.categoryPath,category:profile,goal:input.goal,features:input.features,keywords:input.keywords,settings},warnings:['저장된 수집 원문을 재사용합니다. 기존 상품의 수정값과 전송 이력은 새 초안에 복사하지 않습니다.',...collectionSourceWarnings(result)],executionStarted:false};
 // Target input and defaults participate in the reviewed proof as well.
 preview.baseFingerprint=await fingerprint({proof,target:preview.target});
 return{preview,source,result,images,profileRow,settingsPayload:saved?.payload??null};
}
export async function recoverCollectionNewDraft(owner:string,company:SupplierHubCompany,sourceJobId:string,requestId:string,baseFingerprint:string):Promise<CollectionNewDraftCreated|null>{
 const db=await ensureCollectionDatabase(),job=await findCollectionJob(owner,requestId);if(!job)return null;const origin=job.context?.forkedFrom;
 if(!origin||origin.kind!=='stored-source-new-draft-v1'||origin.sourceJobId!==sourceJobId||origin.requestId!==requestId||origin.baseFingerprint!==baseFingerprint||job.status!=='awaiting_connector'||!job.product_id)throw conflict('동일 요청번호의 새 초안 내용을 확인하지 못했습니다. 요청 결과를 다시 확인해주세요.');
 try{if(!verifyCapturedCollectionCompany(job.context,company))throw conflict();}catch{throw conflict('새 초안의 회사가 현재 승인 회사와 다릅니다.');}
 const product=await db.prepare('SELECT source_url FROM products p WHERE p.id=? AND p.owner_id=? AND NOT EXISTS(SELECT 1 FROM product_removals r WHERE r.product_id=p.id AND r.owner_id=p.owner_id)').bind(job.product_id,owner).first<{source_url:string}>();if(!product||product.source_url!==job.source_url)throw conflict('새 초안 상품이 변경되었거나 삭제되었습니다. 결과를 다시 확인해주세요.');
 return{format:'collection-new-draft-created-v1',requestId,baseFingerprint,job,productId:job.product_id,source:{jobId:sourceJobId,productId:origin.sourceProductId,collectedAt:origin.collectedAt},reused:true,executionStarted:false};
}
export async function createCollectionNewDraft(owner:string,company:SupplierHubCompany,jobId:string,input:CollectionNewDraftTargetRequest,requestId:string,baseFingerprint:string):Promise<CollectionNewDraftCreated>{
 const previous=await recoverCollectionNewDraft(owner,company,jobId,requestId,baseFingerprint);if(previous){const category=previous.job.context?.category;if(category?.id!==input.profileId||category.revision!==input.expectedProfileRevision||previous.job.goal!==input.goal||previous.job.context?.features!==input.features||previous.job.context.keywords!==input.keywords)throw conflict('같은 요청번호에 다른 새 초안 입력값을 적용하지 않았습니다.');return previous;}
 if(requestId===jobId)throw new CollectionForkError(400,'새 초안에는 새로운 요청번호가 필요합니다.');
 const prepared=await prepareCollectionNewDraft(owner,company,jobId,input);if(prepared.preview.baseFingerprint!==baseFingerprint)throw conflict();
 const {source,result,images,profileRow,settingsPayload,preview}=prepared,db=env.DB!;
 const now=new Date(Math.max(Date.now(),Date.parse(source.created_at)+1)).toISOString(),productId=crypto.randomUUID(),context:CollectionContext={category:preview.target.category,settings:preview.target.settings,features:input.features,keywords:input.keywords,capturedAt:now,company,forkedFrom:{kind:'stored-source-new-draft-v1',sourceJobId:jobId,sourceProductId:source.product_id,baseFingerprint,requestId,collectedAt:result.collectedAt}},contextPayload=JSON.stringify(context);
 const job:CollectionJob={id:requestId,offer_id:source.offer_id,source_url:source.source_url,goal:input.goal,status:'awaiting_connector',created_at:now,updated_at:now,context},draft=prepareCollectionProduct(owner,job,result,productId,now);
 await verifyWorkspaceBannerFiles(owner,context.settings,true);draft.product.image_keys=JSON.stringify([...new Set([...JSON.parse(draft.product.image_keys) as string[],...images.map(image=>image.key)])]);if(JSON.parse(draft.product.image_keys).length>PRODUCT_IMAGE_POOL_LIMIT)throw conflict('공통 이미지와 원본 이미지가 새 초안의 이미지 수 제한을 초과합니다. 새 기본설정의 이미지를 확인해주세요.');
 const guard=`${joins} WHERE j.owner_id=? AND j.id=? AND j.status='awaiting_connector' AND j.updated_at=? AND c.payload=? AND r.payload=? AND ${effectiveCollectionPayload}=? AND r.received_at=? AND cp.product_id=? AND p.updated_at=? AND p.image_keys=? AND (SELECT payload FROM product_price_policy WHERE product_id=p.id) IS ?
 AND COALESCE((SELECT revision FROM product_content WHERE product_id=p.id AND owner_id=p.owner_id),0)=? AND (SELECT payload FROM product_content WHERE product_id=p.id AND owner_id=p.owner_id) IS ?
 AND COALESCE((SELECT revision FROM product_options WHERE product_id=p.id AND owner_id=p.owner_id),0)=? AND (SELECT payload FROM product_options WHERE product_id=p.id AND owner_id=p.owner_id) IS ?
 AND COALESCE((SELECT revision FROM product_quotation_fields WHERE product_id=p.id AND owner_id=p.owner_id),0)=? AND (SELECT payload FROM product_quotation_fields WHERE product_id=p.id AND owner_id=p.owner_id) IS ? AND ${sourceImagesSql}=? AND NOT ${busySql}
 AND NOT EXISTS(SELECT 1 FROM product_removals x WHERE x.product_id=p.id AND x.owner_id=p.owner_id) AND EXISTS(SELECT 1 FROM collection_offer_claims k WHERE k.owner_id=j.owner_id AND k.offer_id=j.offer_id AND k.job_id=j.id)
 AND EXISTS(SELECT 1 FROM category_profiles q WHERE q.owner_id=j.owner_id AND q.id=? AND q.revision=? AND q.payload=?) AND (SELECT payload FROM workspace_settings WHERE owner_id=j.owner_id) IS ? AND EXISTS(SELECT 1 FROM members m WHERE m.id=j.owner_id AND m.status='approved' AND m.company_code=? AND m.company_name=?)`;
 const guardArgs=[owner,jobId,source.updated_at,source.source_context,source.original_receipt,source.receipt_payload,source.received_at,source.product_id,source.product_version,source.image_keys,source.pricing_policy,source.content_revision,source.content_payload,source.option_revision,source.option_payload,source.quotation_revision,source.quotation_payload,source.source_images,input.profileId,input.expectedProfileRevision,profileRow.payload,settingsPayload,company.code,company.name];
 const created=`EXISTS(SELECT 1 FROM collection_jobs n JOIN collection_context nc ON nc.job_id=n.id JOIN collection_offer_claims k ON k.job_id=n.id AND k.owner_id=n.owner_id AND k.offer_id=n.offer_id WHERE n.id=? AND n.owner_id=? AND n.created_at=? AND nc.payload=?)`,createdArgs=[requestId,owner,now,contextPayload],entries=Object.entries(draft.product);
 const statements=[
 db.prepare(`INSERT INTO collection_jobs(id,owner_id,offer_id,source_url,goal,status,created_at,updated_at) SELECT ?,?,?,?,?, 'awaiting_connector',?,? WHERE EXISTS(SELECT 1 ${guard}) ON CONFLICT(id) DO NOTHING`).bind(requestId,owner,source.offer_id,source.source_url,input.goal,now,now,...guardArgs),
 db.prepare('INSERT INTO collection_context(job_id,payload) SELECT id,? FROM collection_jobs WHERE id=? AND owner_id=? AND created_at=? ON CONFLICT(job_id) DO NOTHING').bind(contextPayload,requestId,owner,now),
 db.prepare(`UPDATE collection_offer_claims SET job_id=? WHERE owner_id=? AND offer_id=? AND job_id=? AND EXISTS(SELECT 1 ${guard}) AND EXISTS(SELECT 1 FROM collection_context WHERE job_id=? AND payload=?)`).bind(requestId,owner,source.offer_id,jobId,...guardArgs,requestId,contextPayload),
 db.prepare(`INSERT INTO collection_results(job_id,owner_id,payload,received_at) SELECT ?,?,?,? WHERE ${created} ON CONFLICT(job_id) DO NOTHING`).bind(requestId,owner,source.receipt_payload,now,...createdArgs),
 db.prepare(`INSERT INTO products(${entries.map(([key])=>key).join(',')}) SELECT ${entries.map(()=>'?').join(',')} WHERE ${created} AND EXISTS(SELECT 1 FROM collection_results WHERE job_id=? AND owner_id=? AND payload=?)`).bind(...entries.map(([,value])=>value),...createdArgs,requestId,owner,source.receipt_payload),
 db.prepare('INSERT INTO product_price_policy(product_id,payload) SELECT id,? FROM products WHERE id=? AND owner_id=?').bind(JSON.stringify(draft.policy),productId,owner),
 db.prepare('INSERT INTO product_options(product_id,owner_id,revision,payload,updated_at) SELECT id,owner_id,1,?,? FROM products WHERE id=? AND owner_id=?').bind(JSON.stringify(draft.options),now,productId,owner),
 db.prepare('INSERT INTO product_content(product_id,owner_id,revision,payload,updated_at) SELECT id,owner_id,1,?,? FROM products WHERE id=? AND owner_id=?').bind(JSON.stringify(draft.content),now,productId,owner),
 db.prepare('INSERT INTO collection_products(job_id,owner_id,product_id,created_at) SELECT ?,owner_id,id,? FROM products WHERE id=? AND owner_id=?').bind(requestId,now,productId,owner),
 db.prepare(`INSERT INTO collection_images(job_id,image_index,owner_id,product_id,object_key,operation_id,created_at) SELECT ?,json_extract(i.value,'$.index'),p.owner_id,p.id,json_extract(i.value,'$.key'),json_extract(i.value,'$.operationId'),? FROM json_each(?) i CROSS JOIN products p WHERE p.id=? AND p.owner_id=?`).bind(requestId,now,JSON.stringify(images.map(image=>({index:image.index,key:image.key,operationId:crypto.randomUUID()}))),productId,owner),
 ];
 await db.batch(statements);const saved=await recoverCollectionNewDraft(owner,company,jobId,requestId,baseFingerprint);if(!saved)throw conflict();return{...saved,reused:false};
}
