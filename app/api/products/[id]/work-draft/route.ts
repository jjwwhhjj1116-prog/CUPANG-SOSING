import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { prepareProductWorkDraft } from '@/db/collection-image-draft';

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return reply({ error: '운영 인증이 필요합니다.' }, 503);
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return reply({ error: '같은 사이트에서 요청해주세요.' }, 400);
    const body = await readBoundedJson(request, 1024) as { expectedVersion?: unknown };
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'expectedVersion')
      || typeof body.expectedVersion !== 'string' || body.expectedVersion.length > 30 || !Number.isFinite(Date.parse(body.expectedVersion))) return reply({ error: '최신 상품 버전을 확인해주세요.' }, 400);
    const result = await prepareProductWorkDraft(await getWorkspaceOwnerId(), (await context.params).id, body.expectedVersion);
    return result ? reply(result) : reply({ error: '상품·수집 원문 또는 편집 상태가 변경되었습니다. 저장된 수정값은 유지됩니다. 최신 상품을 다시 확인해주세요.' }, 409);
  } catch (error) {
    return reply({ error: error instanceof RequestBodyError ? error.message : '이미지 초안 준비를 확인하지 못했습니다. 다시 실행하면 저장된 초안과 수동 수정값을 유지합니다.' }, error instanceof RequestBodyError ? error.status : 503);
  }
}
