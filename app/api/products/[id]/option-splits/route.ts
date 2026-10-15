import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { ProductOptionSplitError } from '@/app/product-option-split';
import type { ProductOptionSplitGroup } from '@/app/product-option-split';
import { previewProductOptionSplit, commitProductOptionSplit, recoverProductOptionSplit } from '@/db/product-option-splits';

type Context = { params: Promise<{ id: string }> };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'cache-control': 'no-store' } });
function failure(error: unknown) {
  if (error instanceof ProductOptionSplitError) return json({ error: error.message, code: error.code }, error.status);
  if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
  return json({ error: '상품 분할 자료를 확인하지 못했습니다. 기존 자료를 유지한 채 결과를 다시 확인해주세요.' }, 503);
}
async function identity(context: Context) {
  const user = await getChatGPTUser(), owner = await getWorkspaceOwnerId(), { id } = await context.params, company = approvedSupplierHubCompany(user?.membership);
  if (!user?.verifiedAccess || user.userId !== owner || !user.membership || !company) throw new ProductOptionSplitError('승인된 회사 계정으로 로그인해주세요.', 403);
  if (!/^[A-Za-z0-9_-]{1,80}$/u.test(id)) throw new ProductOptionSplitError('상품 번호를 확인해주세요.', 400);
  return { owner, id, company, member: { email: user.membership.email, role: user.membership.role, companyCode: company.code, companyName: company.name } };
}
function selection(request: Request, recover: boolean) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !['profileId', ...(recover ? ['requestId'] : [])].includes(key) || params.getAll(key).length !== 1)) throw new ProductOptionSplitError('조회 범위를 확인해주세요.', 400);
  const profileId = params.get('profileId'), requestId = params.get('requestId');
  if (profileId !== null && !/^[A-Za-z0-9_-]{1,100}$/u.test(profileId) || recover && !uuid(requestId)) throw new ProductOptionSplitError('카테고리·분할 요청 번호를 확인해주세요.', 400);
  return { profileId, requestId };
}
export async function GET(request: Request, context: Context) {
  try {
    const { owner, id, company } = await identity(context), { profileId, requestId } = selection(request, true);
    const result = await recoverProductOptionSplit(owner, company, id, profileId, requestId!);
    return result ? json(result) : json({ receipt: null, current: false, error: '이 요청번호의 저장된 분할 결과가 없습니다. 새 미리보기로 확인해주세요.', code: 'OPTION_SPLIT_NOT_FOUND' }, 404);
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new ProductOptionSplitError('같은 사이트에서 분할을 저장해주세요.', 400);
    const { owner, id, company, member } = await identity(context), { profileId } = selection(request, false), body = await readBoundedJson(request, 512 * 1024);
    if (!object(body) || !['preview', 'commit'].includes(body.action as string) || !uuid(body.requestId) || !hash(body.expectedInputFingerprint)
      || !Array.isArray(body.groups) || body.groups.length < 2 || body.groups.length > 20
      || body.groups.some(group => !object(group) || Object.keys(group).length !== 4 || Object.keys(group).some(key => !['label', 'productId', 'optionIds', 'optionIdMap'].includes(key)))
      || Object.keys(body).length !== (body.action === 'commit' ? 5 : 4)
      || Object.keys(body).some(key => !['action', 'requestId', 'expectedInputFingerprint', 'groups', ...(body.action === 'commit' ? ['previewFingerprint'] : [])].includes(key))
      || body.action === 'commit' && !hash(body.previewFingerprint)) throw new ProductOptionSplitError('분할 그룹·원본 버전·검토 번호를 확인해주세요.', 400, 'OPTION_SPLIT_INVALID');
    const input = { requestId: body.requestId, expectedInputFingerprint: body.expectedInputFingerprint, groups: body.groups as ProductOptionSplitGroup[],
      ...(body.action === 'commit' ? { previewFingerprint: body.previewFingerprint as string } : {}) };
    if (body.action === 'preview') return json((await previewProductOptionSplit(owner, company, member, id, profileId, input)).preview);
    return json(await commitProductOptionSplit(owner, company, member, id, profileId, input));
  } catch (error) { return failure(error); }
}
