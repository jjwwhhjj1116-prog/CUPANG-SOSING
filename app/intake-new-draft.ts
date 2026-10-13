import {intakeQueueRequests,type IntakeRow} from '@/app/intake-queue';
import {savedRegistrationSettings,type WorkspaceSettings} from '@/app/workspace-settings';
import {supplierHubCompany,type SupplierHubCompany} from '@/app/supplier-hub-company';
import type {CollectionJob} from '@/app/sourcing';
import type {CategoryProfile} from '@/app/category-profiles';

export type IntakeNewDraftInput={profileId:string;expectedProfileRevision:number;goal:string;features:string;keywords:string};
export type IntakeNewDraftPreview={format:'collection-new-draft-v1';baseFingerprint:string;executionStarted:false;
 source:{jobId:string;productId:string;sourceUrl:string;offerId:string;company:SupplierHubCompany;collectedAt:string;receivedAt:string;productVersion:string;contentRevision:number;optionRevision:number;quotationRevision:number;imageCount:number};
 target:{profileId:string;profileRevision:number;categoryId:string;categoryPath:string[];category:CategoryProfile;goal:string;features:string;keywords:string;settings:WorkspaceSettings};warnings:string[]};
export type IntakeNewDraftCreated={format:'collection-new-draft-created-v1';requestId:string;baseFingerprint:string;executionStarted:false;job:CollectionJob;productId:string;source:{jobId:string;productId:string;collectedAt:string};reused:boolean};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const identifier=(value:unknown):value is string=>typeof value==='string'&&!!value&&value.length<=200&&value===value.trim()&&!/[\u0000-\u001f\u007f]/u.test(value);
const timestamp=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const revision=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>=0;
const fail=()=>Error('선택한 원문과 새 초안의 확인값이 다릅니다. 입력을 유지하고 다시 확인해주세요.');
export class IntakeNewDraftSettingsChanged extends Error {}
export function intakeNewDraftInput(row:IntakeRow,goal:string):IntakeNewDraftInput{
 if(!row.forkJobId||goal==='transmit')throw fail();const [{body}]=intakeQueueRequests([{...row,status:'draft'}],goal);
 return{profileId:body.profileId,expectedProfileRevision:body.expectedProfileRevision,goal:body.goal,features:body.features,keywords:body.keywords};
}
export function intakeNewDraftInputKey(row:IntakeRow,goal:string,settings:WorkspaceSettings){return JSON.stringify([row.id,row.forkJobId,row.url,row.profile,row.features,row.keywords,goal,savedRegistrationSettings(settings)]);}
async function responseBody(response:Response,signal:AbortSignal){const body:unknown=await response.json();if(signal.aborted)throw Error('작업을 취소했습니다.');
 if(!response.ok){const message=object(body)&&typeof body.error==='string'?body.error:'새 초안 결과를 확인하지 못했습니다. 입력은 유지됩니다.';if(object(body)&&body.code==='REGISTRATION_SETTINGS_CHANGED')throw new IntakeNewDraftSettingsChanged(message);throw Error(message);}return body;}
export async function previewIntakeNewDraft(row:IntakeRow,goal:string,settings:WorkspaceSettings,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<IntakeNewDraftPreview>{
 const input=intakeNewDraftInput(row,goal),[{body:request}]=intakeQueueRequests([{...row,status:'draft'}],goal),params=new URLSearchParams(Object.entries(input).map(([key,value])=>[key,String(value)]));
 const body=await responseBody(await fetcher(`/api/collection-jobs/${encodeURIComponent(row.forkJobId!)}/new-draft?${params}`,{signal,cache:'no-store'}),signal),value=body as IntakeNewDraftPreview;
 if(!object(body)||value.format!=='collection-new-draft-v1'||value.executionStarted!==false||!/^[a-f0-9]{64}$/.test(value.baseFingerprint)||!object(value.source)||!object(value.target)
  ||value.source.jobId!==row.forkJobId||!identifier(value.source.productId)||value.source.sourceUrl!==request.urls[0]||value.source.offerId!==request.urls[0].match(/offer\/(\d+)\.html$/)?.[1]
  ||!supplierHubCompany(value.source.company?.code,value.source.company?.name)||!timestamp(value.source.collectedAt)||!timestamp(value.source.receivedAt)||!timestamp(value.source.productVersion)
  ||![value.source.contentRevision,value.source.optionRevision,value.source.quotationRevision,value.source.imageCount].every(revision)||!object(value.target.settings)
  ||value.target.profileId!==input.profileId||value.target.profileRevision!==input.expectedProfileRevision||value.target.categoryId!==row.profile.categoryId||JSON.stringify(value.target.categoryPath)!==JSON.stringify(row.profile.categoryPath)||JSON.stringify(value.target.category)!==JSON.stringify(row.profile)
  ||value.target.goal!==input.goal||value.target.features!==input.features||value.target.keywords!==input.keywords||!Array.isArray(value.warnings)||value.warnings.some(item=>typeof item!=='string'||item.length>2000))throw fail();
 if(JSON.stringify(savedRegistrationSettings(value.target.settings))!==JSON.stringify(savedRegistrationSettings(settings)))throw new IntakeNewDraftSettingsChanged('기본설정이 변경되었습니다. 최신 기본설정을 불러온 뒤 새 초안을 확인해주세요.');
 const company=row.profile.hubSchema?.company;if(company&&(company.code!==value.source.company.code||company.name!==value.source.company.name))throw fail();
 return value;
}
export function validateIntakeNewDraftCreated(value:unknown,preview:IntakeNewDraftPreview,requestId:string):IntakeNewDraftCreated{
 const body=value as IntakeNewDraftCreated,job=body?.job,context=job?.context,origin=context?.forkedFrom;
 if(!object(value)||body.format!=='collection-new-draft-created-v1'||body.executionStarted!==false||body.requestId!==requestId||body.baseFingerprint!==preview.baseFingerprint||typeof body.reused!=='boolean'
  ||!identifier(body.productId)||body.productId===preview.source.productId||!job||job.id!==requestId||job.product_id!==body.productId||job.source_url!==preview.source.sourceUrl||job.offer_id!==preview.source.offerId||job.status!=='awaiting_connector'||job.goal!==preview.target.goal
  ||body.source?.jobId!==preview.source.jobId||body.source.productId!==preview.source.productId||body.source.collectedAt!==preview.source.collectedAt
  ||context?.category.id!==preview.target.profileId||context.category.revision!==preview.target.profileRevision||context.category.categoryId!==preview.target.categoryId||JSON.stringify(context.category)!==JSON.stringify(preview.target.category)
  ||context.features!==preview.target.features||context.keywords!==preview.target.keywords||JSON.stringify(savedRegistrationSettings(context.settings))!==JSON.stringify(savedRegistrationSettings(preview.target.settings))
  ||context.company?.code!==preview.source.company.code||context.company?.name!==preview.source.company.name
  ||origin?.kind!=='stored-source-new-draft-v1'||origin.sourceJobId!==preview.source.jobId||origin.sourceProductId!==preview.source.productId||origin.requestId!==requestId||origin.baseFingerprint!==preview.baseFingerprint||origin.collectedAt!==preview.source.collectedAt)throw fail();
 return body;
}
export async function createIntakeNewDraft(preview:IntakeNewDraftPreview,requestId:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<IntakeNewDraftCreated>{
 if(!/^[a-f0-9-]{36}$/.test(requestId))throw fail();const target=preview.target;
 return validateIntakeNewDraftCreated(await responseBody(await fetcher(`/api/collection-jobs/${encodeURIComponent(preview.source.jobId)}/new-draft`,{method:'POST',signal,headers:{'content-type':'application/json'},body:JSON.stringify({requestId,baseFingerprint:preview.baseFingerprint,profileId:target.profileId,expectedProfileRevision:target.profileRevision,goal:target.goal,features:target.features,keywords:target.keywords})}),signal),preview,requestId);
}
/** Uncertain creation responses are recovered by the same ID; never send another POST. */
export async function recoverIntakeNewDraft(preview:IntakeNewDraftPreview,requestId:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<IntakeNewDraftCreated>{
 const params=new URLSearchParams({requestId,baseFingerprint:preview.baseFingerprint});return validateIntakeNewDraftCreated(await responseBody(await fetcher(`/api/collection-jobs/${encodeURIComponent(preview.source.jobId)}/new-draft?${params}`,{signal,cache:'no-store'}),signal),preview,requestId);
}
