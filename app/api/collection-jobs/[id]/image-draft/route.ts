import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { prepareCollectedImageDraft } from '@/db/collection-image-draft';
import { findCollectionJob } from '@/db/collection-jobs';
import { CollectionCompanyError, verifyCapturedCollectionCompany } from '@/app/collection-company';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return reply({ error: '운영 인증이 필요합니다.' }, 503);
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return reply({ error: '같은 사이트에서 요청해주세요.' }, 400);
    const body = await readBoundedJson(request, 1024) as { productId?: unknown; initializeIntake?: unknown };
    if (!body || typeof body !== 'object' || Object.keys(body).some(key => key !== 'productId' && key !== 'initializeIntake') || Object.hasOwn(body,'initializeIntake')&&body.initializeIntake!==true || typeof body.productId !== 'string' || !body.productId || body.productId.length > 100) return reply({ error: '저장된 상품을 확인해주세요.' }, 400);
    const owner=await getWorkspaceOwnerId(),{id}=await context.params;
    if(body.initializeIntake){
      const [job,user]=await Promise.all([findCollectionJob(owner,id),getChatGPTUser()]);
      if(!job)return reply({error:'현재 계정의 수집 요청을 찾을 수 없습니다.'},404);
      const captured=verifyCapturedCollectionCompany(job.context,user?.verifiedAccess&&user.userId===owner?approvedSupplierHubCompany(user.membership):null);
      if(job.goal==='transmit'&&!captured)return reply({error:'등록전송 초안의 승인 회사 정보를 확인해주세요.'},409);
    }
    const saved = await prepareCollectedImageDraft(owner,id,body.productId,undefined,body.initializeIntake===true);
    return saved ? reply({ productId: saved.productId, changedRoles: saved.changedRoles, changedOptions: saved.changedOptions, prepared: true, message: '원본 이미지 초안을 연결했습니다. 번역·가공·검토 완료 여부는 각 단계에서 확인해주세요.' })
      : reply({ error: '상품·원본 또는 편집 상태가 변경되어 이미지 초안 연결을 멈췄습니다. 저장된 수정값은 유지됩니다.' }, 409);
  } catch (error) {
    if(error instanceof CollectionCompanyError)return reply({error:error.message,code:error.code},409);
    return reply({ error: error instanceof RequestBodyError ? error.message : '원본 이미지 초안 연결을 확인하지 못했습니다. 다시 시작하면 저장된 파일과 수정값을 유지합니다.' }, error instanceof RequestBodyError ? error.status : 503);
  }
}
