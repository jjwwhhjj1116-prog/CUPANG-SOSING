import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { stableQuotationFieldsView, QuotationFieldsSnapshotError } from '@/app/quotation-fields-snapshot';
import { PublicDetailError } from '@/app/quotation-public-detail';

type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

function profileSelection(request: Request): string | null {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => key !== 'profileId') || query.getAll('profileId').length > 1)
    throw new QuotationFieldsSnapshotError('카테고리 프로필 선택을 확인해주세요.', 400);
  const value = query.get('profileId');
  if (value !== null && !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new QuotationFieldsSnapshotError('카테고리 프로필 선택을 확인해주세요.', 400);
  return value;
}

export async function GET(request: Request, context: Context) {
  try {
    if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess)
      return json({ error: '운영 인증 연결 후 상품 등록 단계를 확인할 수 있습니다.' }, 503);
    const profileId = profileSelection(request), owner = await getWorkspaceOwnerId(), { id } = await context.params;
    return json((await stableQuotationFieldsView(owner, id, profileId)).registrationLayout);
  } catch (error) {
    if (error instanceof QuotationFieldsSnapshotError) return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
    if (error instanceof PublicDetailError) return json({ error: error.message }, error.status);
    return json({ error: '상품 등록 단계의 저장 자료를 확인하지 못했습니다.' }, 503);
  }
}
