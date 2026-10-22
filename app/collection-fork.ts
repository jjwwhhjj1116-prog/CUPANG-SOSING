import type {CollectionJob} from '@/app/sourcing';
import type {CategoryProfile} from '@/app/category-profiles';
import type {WorkspaceSettings} from '@/app/workspace-settings';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import {collectionKeywords} from '@/app/sourcing';
import {validateSourceCaptureSelection,type SourceCaptureSelection} from '@/app/source-capture-selection';

export class CollectionForkError extends Error{constructor(public readonly status:400|404|409,message:string){super(message);}}
export type CollectionPendingSourceCandidate={format:'pending-source-urls-available-v1';jobId:string;productId:string;productVersion:string;sourceReceiptHash:string};
export class CollectionPendingSourceAvailable extends CollectionForkError{readonly code='PENDING_SOURCE_URLS_AVAILABLE';constructor(readonly candidate:CollectionPendingSourceCandidate){super(409,'수정하지 않은 최초 원문 상품입니다. 저장 안 된 사진은 새 초안에서 가져오는 방식을 직접 선택할 수 있습니다.');}}
export type CollectionNewDraftTargetRequest={profileId:string;expectedProfileRevision:number;goal:string;features:string;keywords:string;sourceMode?:'pending-source-urls-v1';sourceReceiptHash?:string;sourceCapture?:Readonly<SourceCaptureSelection>};
export type CollectionNewDraftPreview={format:'collection-new-draft-v1';baseFingerprint:string;source:{jobId:string;productId:string;sourceUrl:string;offerId:string;company:SupplierHubCompany;collectedAt:string;receivedAt:string;productVersion:string;contentRevision:number;optionRevision:number;quotationRevision:number;imageCount:number};target:{profileId:string;profileRevision:number;categoryId:string;categoryPath:string[];category:CategoryProfile;goal:string;features:string;keywords:string;settings:WorkspaceSettings;sourceMode?:'pending-source-urls-v1';sourceReceiptHash?:string;sourceCapture?:Readonly<SourceCaptureSelection>};warnings:string[];executionStarted:false};
export type CollectionNewDraftCreated={format:'collection-new-draft-created-v1';requestId:string;baseFingerprint:string;job:CollectionJob;productId:string;source:{jobId:string;productId:string;collectedAt:string};reused:boolean;executionStarted:false};
export const collectionForkId=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
export const collectionForkFingerprint=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
export function parseCollectionNewDraftTarget(input:unknown):CollectionNewDraftTargetRequest{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new CollectionForkError(400,'새 초안의 카테고리와 입력값을 확인해주세요.');
 const value=input as Record<string,unknown>;
 if(!collectionForkId(value.profileId)||!Number.isSafeInteger(value.expectedProfileRevision)||(value.expectedProfileRevision as number)<1||!['collect','price','work','transmit'].includes(String(value.goal)))throw new CollectionForkError(400,'새 초안의 카테고리 버전과 작업 목표를 확인해주세요.');
 for(const key of ['features','keywords'])if(value[key]!==undefined&&(typeof value[key]!=='string'||(value[key] as string).length>2000))throw new CollectionForkError(400,'특징·키워드는 각각 2,000자 이하여야 합니다.');
 if(value.sourceMode!==undefined&&value.sourceMode!=='pending-source-urls-v1'||value.sourceMode==='pending-source-urls-v1'&&!collectionForkFingerprint(value.sourceReceiptHash)||value.sourceMode===undefined&&value.sourceReceiptHash!==undefined)throw new CollectionForkError(400,'새 초안의 원문 URL 준비 방식을 확인해주세요.');
 let sourceCapture:Readonly<SourceCaptureSelection>|undefined;
 if(value.sourceCapture!==undefined){try{sourceCapture=validateSourceCaptureSelection(value.sourceCapture);if(sourceCapture.format!=='yoofam-saved-page-capture-v1'||value.sourceMode!==undefined)throw Error();}catch{throw new CollectionForkError(400,'새 초안으로 사용할 저장 수집본의 정확한 버전을 확인해주세요.');}}
 const features=String(value.features??''),keywords=String(value.keywords??'');try{collectionKeywords(keywords);}catch(error){throw new CollectionForkError(400,error instanceof Error?error.message:'키워드를 확인해주세요.');}
 return{profileId:value.profileId,expectedProfileRevision:value.expectedProfileRevision as number,goal:String(value.goal),features,keywords,...(value.sourceMode?{sourceMode:value.sourceMode as 'pending-source-urls-v1',sourceReceiptHash:value.sourceReceiptHash as string}:{}),...(sourceCapture?{sourceCapture}:{})};
}
