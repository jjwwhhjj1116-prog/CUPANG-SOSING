import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { QuotationFieldsSnapshotError } from '@/app/quotation-fields-snapshot';
import { DetailFamilyError } from '@/app/detail-family-apply';
import { detailFamilyCatalog, previewDetailFamily, commitDetailFamily, recoverDetailFamily } from '@/db/detail-family-apply';
type Context = { params: Promise<{ id: string }> };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'cache-control': 'no-store' } });
function failure(error: unknown) {
  if (error instanceof DetailFamilyError || error instanceof QuotationFieldsSnapshotError) return json({ error: error.message, code: error.code }, error.status);
  if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
  return json({ error: '통합 상세 적용 자료를 확인하지 못했습니다. 기존 자료를 유지한 채 결과를 다시 확인해주세요.' }, 503);
}
async function identity(context: Context) {
  const user = await getChatGPTUser(), owner = await getWorkspaceOwnerId(), { id } = await context.params, company = approvedSupplierHubCompany(user?.membership);
  if (!user?.verifiedAccess || user.userId !== owner || !user.membership || !company) throw new DetailFamilyError('승인된 회사 계정으로 로그인해주세요.', 403);
  if (!/^[A-Za-z0-9_-]{1,80}$/u.test(id)) throw new DetailFamilyError('상품 번호를 확인해주세요.', 400);
  return { owner, id, company, member: { email: user.membership.email, role: user.membership.role } };
}
function selection(request: Request, recover: boolean) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !['profileId', ...(recover ? ['requestId'] : [])].includes(key) || params.getAll(key).length !== 1)) throw new DetailFamilyError('상세 적용 조회 범위를 확인해주세요.', 400);
  const profileId = params.get('profileId'), requestId = params.get('requestId');
  if (profileId !== null && !/^[A-Za-z0-9_-]{1,100}$/u.test(profileId) || requestId !== null && !uuid(requestId)) throw new DetailFamilyError('카테고리·적용 요청 번호를 확인해주세요.', 400);
  return { profileId, requestId };
}
export async function GET(request: Request, context: Context) {
  try {
    const { owner, id, company, member } = await identity(context), { profileId, requestId } = selection(request, true);
    if (!requestId) return json(await detailFamilyCatalog(owner, company, member, id, profileId));
    const result = await recoverDetailFamily(owner, company, member, id, profileId, requestId);
    return result ? json(result) : json({ receipt: null, current: false, code: 'DETAIL_FAMILY_NOT_FOUND', error: '이 요청번호의 저장된 상세 적용 결과가 없습니다. 새 미리보기로 확인해주세요.' }, 404);
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new DetailFamilyError('같은 사이트에서 상세 적용을 진행해주세요.', 400);
    const { owner, id, company, member } = await identity(context), { profileId } = selection(request, false), body = await readBoundedJson(request, 8192);
    if (!object(body) || !['preview', 'commit'].includes(body.action as string) || !uuid(body.requestId) || !hash(body.expectedInputFingerprint)
      || !Array.isArray(body.targetIds) || body.targetIds.length < 1 || body.targetIds.length > 19 || new Set(body.targetIds).size !== body.targetIds.length
      || body.targetIds.some(value => typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(value))
      || Object.keys(body).length !== (body.action === 'commit' ? 5 : 4)
      || Object.keys(body).some(key => !['action', 'requestId', 'expectedInputFingerprint', 'targetIds', ...(body.action === 'commit' ? ['previewFingerprint'] : [])].includes(key))
      || body.action === 'commit' && !hash(body.previewFingerprint)) throw new DetailFamilyError('같은 분할 그룹의 대상1~19개·원본 버전·미리보기 번호를 확인해주세요.', 400, 'DETAIL_FAMILY_INVALID');
    const input = { requestId: body.requestId, expectedInputFingerprint: body.expectedInputFingerprint, targetIds: body.targetIds as string[],
      ...(body.action === 'commit' ? { previewFingerprint: body.previewFingerprint as string } : {}) };
    if (body.action === 'preview') return json((await previewDetailFamily(owner, company, member, id, profileId, input)).preview);
    return json(await commitDetailFamily(owner, company, member, id, profileId, input));
  } catch (error) { return failure(error); }
}
