import { NextResponse } from 'next/server';
import { collectionBlock, parseCollectionRequest } from '@/app/sourcing';
import { enqueueCollection, listCollectionJobs } from '@/db/collection-jobs';
import { getCategoryProfile } from '@/db/category-profiles';
import { getSettings } from '@/db/queries';
import { validateSettings } from '@/app/workspace-settings';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';

// Production requests require a verified Access assertion; ownership never falls
// back to the local workspace if authentication changes during the request.
function unavailable() {
  return NextResponse.json({ error: '운영 인증이 연결되기 전에는 수집 대기열을 공개할 수 없습니다.' }, { status: 503 });
}
export async function GET() {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return unavailable();
  try {
    const owner=await getWorkspaceOwnerId();
    return NextResponse.json({ jobs: await listCollectionJobs(owner), message: collectionBlock }, { headers: { 'cache-control': 'no-store' } });
  } catch { return NextResponse.json({ error: '수집 대기열을 읽지 못했습니다. 다시 불러와주세요.' }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return unavailable();
  let entries;let profileId:string;let expectedProfileRevision:number;let features:string;let keywords:string;
  try {
    const input:unknown=await request.json();entries = parseCollectionRequest(input);
    const body=input as Record<string,unknown>;
    if(typeof body.profileId!=='string'||!/^[a-f0-9-]{36}$/.test(body.profileId))throw new Error('URL 입력 전에 카테고리·견적서 연결을 선택해주세요.');
    profileId=body.profileId;
    if(!Number.isSafeInteger(body.expectedProfileRevision)||(body.expectedProfileRevision as number)<1)throw new Error('카테고리 설정 버전이 없습니다. 카테고리를 다시 선택해주세요.');
    expectedProfileRevision=body.expectedProfileRevision as number;
    for(const key of ['features','keywords'])if(body[key]!==undefined&&(typeof body[key]!=='string'||String(body[key]).length>2000))throw new Error('특징·키워드는 각각 2,000자 이하여야 합니다.');
    features=String(body.features??'');keywords=String(body.keywords??'');
  }
  catch (error) { return NextResponse.json({ error: error instanceof SyntaxError ? '올바른 JSON이 필요합니다.' : error instanceof Error ? error.message : '입력을 확인해주세요.' }, { status: 400 }); }
  try {
    const owner=await getWorkspaceOwnerId();
    const category=await getCategoryProfile(owner,profileId);
    if(!category)return NextResponse.json({error:'선택한 카테고리 연결을 찾을 수 없습니다.'},{status:404});
    if(category.revision!==expectedProfileRevision)return NextResponse.json({error:'선택한 카테고리·견적서 설정이 변경되었습니다. 입력을 유지하고 최신 카테고리를 다시 선택해주세요.',code:'CATEGORY_PROFILE_CHANGED'},{status:409});
    const savedSettings=await getSettings(owner);
    const settings=validateSettings(savedSettings?JSON.parse(savedSettings.payload):{});
    const jobs = await enqueueCollection(owner, entries, {category,settings,features,keywords,capturedAt:new Date().toISOString()});
    return NextResponse.json({ jobs, message: collectionBlock, executionStarted: false }, { headers: { 'cache-control': 'no-store' } });
  } catch { return NextResponse.json({ error: '대기열 저장을 확인하지 못했습니다. 같은 URL로 다시 시도해도 대기 중인 요청은 중복되지 않습니다.' }, { status: 503 }); }
}
