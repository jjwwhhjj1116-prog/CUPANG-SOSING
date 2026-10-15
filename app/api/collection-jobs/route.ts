import { usableCategoryCode } from '@/app/category-profiles';
import { validateCategoryIdentity } from '@/app/category-identity';
import { NextResponse } from 'next/server';
import { collectionBlock, collectionKeywords, parseCollectionRequest } from '@/app/sourcing';
import { preservedCollectionRequests } from '@/app/collection-preservation';
import { enqueueCollection, listCollectionJobs, findCollectionJob, CollectionIntakeSourceChangedError } from '@/db/collection-jobs';
import { getCategoryProfileSnapshot } from '@/db/category-profiles';
import { getSettings } from '@/db/queries';
import { savedRegistrationSettings, validateSettings, type WorkspaceSettings } from '@/app/workspace-settings';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {CollectionCompanyError,verifyCapturedCollectionCompany} from '@/app/collection-company';

// Production requests require a verified Access assertion; ownership never falls
// back to the local workspace if authentication changes during the request.
function unavailable() {
  return NextResponse.json({ error: '운영 인증이 연결되기 전에는 수집 대기열을 공개할 수 없습니다.' }, { status: 503 });
}
export async function GET(request?: Request) {
  const targeted=Boolean(request&&new URL(request.url).searchParams.has('id'));
  const user=process.env.NODE_ENV==='production'||targeted?await getChatGPTUser():undefined;
  if (process.env.NODE_ENV === 'production' && !user?.verifiedAccess) return unavailable();
  try {
    const owner=await getWorkspaceOwnerId();
    const query=request?new URL(request.url).searchParams:null;
    if(query?.has('id')){
      if(query.getAll('id').length!==1||[...query.keys()].some(key=>key!=='id')||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(query.get('id')??''))return NextResponse.json({error:'기존 수집 요청 번호를 확인해주세요.'},{status:400});
      if(process.env.NODE_ENV==='production'&&user?.userId!==owner)return unavailable();
      const job=await findCollectionJob(owner,query.get('id')!);
      if(!job)return NextResponse.json({error:'기존 수집 요청을 찾을 수 없습니다.'},{status:404});
      verifyCapturedCollectionCompany(job.context,user?.verifiedAccess&&user.userId===owner?approvedSupplierHubCompany(user.membership):null);
      return NextResponse.json({job},{headers:{'cache-control':'no-store'}});
    }
    return NextResponse.json({ jobs: await listCollectionJobs(owner), message: collectionBlock }, { headers: { 'cache-control': 'no-store' } });
  } catch(error) { if(error instanceof CollectionCompanyError)return NextResponse.json({error:error.message,code:error.code},{status:409});return NextResponse.json({ error: '수집 대기열을 읽지 못했습니다. 다시 불러와주세요.' }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return unavailable();
  let entries;let profileId:string;let expectedProfileRevision:number;let features:string;let keywords:string;let expectedSettings:WorkspaceSettings|undefined;
  try {
    const input:unknown=await request.json();entries = parseCollectionRequest(input);
    const body=input as Record<string,unknown>;
    if(Object.hasOwn(body,'expectedSettings')){validateSettings(body.expectedSettings);expectedSettings=savedRegistrationSettings(body.expectedSettings);}
    if(typeof body.profileId!=='string'||!/^[a-f0-9-]{36}$/.test(body.profileId))throw new Error('URL 입력 전에 카테고리·견적서 연결을 선택해주세요.');
    profileId=body.profileId;
    if(!Number.isSafeInteger(body.expectedProfileRevision)||(body.expectedProfileRevision as number)<1)throw new Error('카테고리 설정 버전이 없습니다. 카테고리를 다시 선택해주세요.');
    expectedProfileRevision=body.expectedProfileRevision as number;
    for(const key of ['features','keywords'])if(body[key]!==undefined&&(typeof body[key]!=='string'||String(body[key]).length>2000))throw new Error('특징·키워드는 각각 2,000자 이하여야 합니다.');
    features=String(body.features??'');keywords=String(body.keywords??'');collectionKeywords(keywords);
  }
  catch (error) { return NextResponse.json({ error: error instanceof SyntaxError ? '올바른 JSON이 필요합니다.' : error instanceof Error ? error.message : '입력을 확인해주세요.' }, { status: 400 }); }
  try {
    const owner=await getWorkspaceOwnerId();
    const selected=await getCategoryProfileSnapshot(owner,profileId);
    if(!selected)return NextResponse.json({error:'선택한 카테고리 연결을 찾을 수 없습니다.'},{status:404});
    const category=selected.category;
    if(category.revision!==expectedProfileRevision)return NextResponse.json({error:'선택한 카테고리·견적서 설정이 변경되었습니다. 입력을 유지하고 최신 카테고리를 다시 선택해주세요.',code:'CATEGORY_PROFILE_CHANGED'},{status:409});
    const user=await getChatGPTUser(),company=user?.verifiedAccess&&user.userId===owner?approvedSupplierHubCompany(user.membership):null;
    if(!company&&(process.env.NODE_ENV==='production'||user?.verifiedAccess))return NextResponse.json({error:'수집 요청에 기록할 승인 회사 코드·이름을 확인해주세요.',code:'COLLECTION_COMPANY_UNCONFIRMED'},{status:409});
    if(category.hubSchema&&(!company||company.code!==category.hubSchema.company.code||company.name!==category.hubSchema.company.name))return NextResponse.json({error:'선택한 상세 양식의 회사가 현재 승인 회사와 다릅니다. 카테고리를 다시 선택해주세요.',code:'CATEGORY_COMPANY_CHANGED'},{status:409});
    if(!usableCategoryCode(category.categoryId))return NextResponse.json({error:'선택한 카테고리 번호가 없거나 형식이 올바르지 않습니다. 설정에서 실제 번호를 수정한 뒤 다시 선택해주세요.',code:'CATEGORY_CODE_INVALID'},{status:400});
    try { validateCategoryIdentity(category); }
    catch (error) { return NextResponse.json({error:error instanceof Error ? error.message : '카테고리 코드와 경로를 확인해주세요.',code:'CATEGORY_IDENTITY_MISMATCH'},{status:400}); }
    const savedSettings=await getSettings(owner);
    const settings=savedRegistrationSettings(savedSettings?JSON.parse(savedSettings.payload):null);
    if(expectedSettings&&JSON.stringify(expectedSettings)!==JSON.stringify(settings))return NextResponse.json({error:'기본설정이 변경되었습니다. 입력한 URL과 카테고리는 유지됩니다. 기본설정을 다시 불러온 뒤 시작해주세요.',code:'REGISTRATION_SETTINGS_CHANGED'},{status:409});
    const context={category,settings,features,keywords,capturedAt:new Date().toISOString(),...(company?{company}:{})};
    const jobs = await enqueueCollection(owner, entries, context, {
      category: { id: category.id, revision: category.revision, payload: selected.payload }, settingsPayload: savedSettings?.payload ?? null,
    });
    return NextResponse.json({ jobs, preservedRequests: preservedCollectionRequests(jobs, entries, context), message: collectionBlock, executionStarted: false }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if(error instanceof CollectionIntakeSourceChangedError)return NextResponse.json({error:error.message,code:error.code},{status:409});
    return NextResponse.json({ error: '대기열 저장을 확인하지 못했습니다. 같은 URL로 다시 시도해도 대기 중인 요청은 중복되지 않습니다.' }, { status: 503 });
  }
}
