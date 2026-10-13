import type {CollectionJob} from '@/app/sourcing';
import type {CategoryProfile} from '@/app/category-profiles';
import type {WorkspaceSettings} from '@/app/workspace-settings';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';
import {collectionKeywords} from '@/app/sourcing';

export class CollectionForkError extends Error{constructor(public readonly status:400|404|409,message:string){super(message);}}
export type CollectionNewDraftTargetRequest={profileId:string;expectedProfileRevision:number;goal:string;features:string;keywords:string};
export type CollectionNewDraftPreview={format:'collection-new-draft-v1';baseFingerprint:string;source:{jobId:string;productId:string;sourceUrl:string;offerId:string;company:SupplierHubCompany;collectedAt:string;receivedAt:string;productVersion:string;contentRevision:number;optionRevision:number;quotationRevision:number;imageCount:number};target:{profileId:string;profileRevision:number;categoryId:string;categoryPath:string[];category:CategoryProfile;goal:string;features:string;keywords:string;settings:WorkspaceSettings};warnings:string[];executionStarted:false};
export type CollectionNewDraftCreated={format:'collection-new-draft-created-v1';requestId:string;baseFingerprint:string;job:CollectionJob;productId:string;source:{jobId:string;productId:string;collectedAt:string};reused:boolean;executionStarted:false};
export const collectionForkId=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
export const collectionForkFingerprint=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
export function parseCollectionNewDraftTarget(input:unknown):CollectionNewDraftTargetRequest{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new CollectionForkError(400,'새 초안의 카테고리와 입력값을 확인해주세요.');
 const value=input as Record<string,unknown>;
 if(!collectionForkId(value.profileId)||!Number.isSafeInteger(value.expectedProfileRevision)||(value.expectedProfileRevision as number)<1||!['collect','price','work','transmit'].includes(String(value.goal)))throw new CollectionForkError(400,'새 초안의 카테고리 버전과 작업 목표를 확인해주세요.');
 for(const key of ['features','keywords'])if(value[key]!==undefined&&(typeof value[key]!=='string'||(value[key] as string).length>2000))throw new CollectionForkError(400,'특징·키워드는 각각 2,000자 이하여야 합니다.');
 const features=String(value.features??''),keywords=String(value.keywords??'');try{collectionKeywords(keywords);}catch(error){throw new CollectionForkError(400,error instanceof Error?error.message:'키워드를 확인해주세요.');}
 return{profileId:value.profileId,expectedProfileRevision:value.expectedProfileRevision as number,goal:String(value.goal),features,keywords};
}
