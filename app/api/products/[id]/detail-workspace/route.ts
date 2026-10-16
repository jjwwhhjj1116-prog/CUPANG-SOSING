import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { DETAIL_WORKSPACE_BODY_LIMIT, DetailWorkspaceError, validateDetailWorkspaceExpectedView, type DetailWorkspaceInput } from '@/app/detail-workspace';
import { readDetailWorkspace, saveDetailWorkspace } from '@/db/detail-workspaces';
import { QuotationFieldsSnapshotError } from '@/app/quotation-fields-snapshot';

type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
const id = (value: unknown, max = 80): value is string => typeof value === 'string' && new RegExp(`^[A-Za-z0-9_-]{1,${max}}$`, 'u').test(value);
async function identity(context: Context) {
  const user = await getChatGPTUser(), owner = await getWorkspaceOwnerId(), company = approvedSupplierHubCompany(user?.membership), { id: productId } = await context.params;
  if (!user?.verifiedAccess || user.userId !== owner || !user.membership || !company) throw new DetailWorkspaceError('승인된 회사 계정으로 상세 작업공간을 사용해주세요.', 403);
  if (!id(productId)) throw new DetailWorkspaceError('상품 번호를 확인해주세요.', 400);
  return { owner, company, identity: { email: user.membership.email, role: user.membership.role }, productId };
}
function query(request: Request, read: boolean) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !['profileId', ...(read ? ['optionId'] : [])].includes(key) || params.getAll(key).length !== 1)
    || params.has('profileId') && !id(params.get('profileId'), 100) || read && !id(params.get('optionId'))) throw new DetailWorkspaceError('작업공간의 카테고리·옵션 조회 범위를 확인해주세요.', 400);
  return { profileId: params.get('profileId'), optionId: params.get('optionId') };
}
function fail(error: unknown) {
  if (error instanceof DetailWorkspaceError || error instanceof RequestBodyError || error instanceof QuotationFieldsSnapshotError) return json({ error: error.message }, error.status);
  return json({ error: '작업공간 결과를 확인하지 못했습니다. 현재 편집을 유지하고 조회로 먼저 확인해주세요.' }, 503);
}
export async function GET(request: Request, context: Context) {
  try {
    const selected = query(request, true), auth = await identity(context);
    return json(await readDetailWorkspace(auth.owner, auth.company, auth.identity, auth.productId, selected.profileId, selected.optionId!, request.signal));
  } catch (error) { return fail(error); }
}
export async function PUT(request: Request, context: Context) {
  try {
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new DetailWorkspaceError('같은 사이트에서 작업공간을 저장해주세요.', 400);
    const selected = query(request, false), auth = await identity(context), body = await readBoundedJson(request, DETAIL_WORKSPACE_BODY_LIMIT);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 5
      || Object.keys(body).some(key => !['optionId', 'expectedRevision', 'expectedView', 'requestId', 'document'].includes(key))) throw new DetailWorkspaceError('작업공간 입력 형식을 확인해주세요.', 400);
    const value = body as Record<string, unknown>;
    if (!id(value.optionId) || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0 || typeof value.requestId !== 'string' || !/^[a-f0-9]{64}$/u.test(value.requestId)) throw new DetailWorkspaceError('작업공간 버전과 요청 번호를 확인해주세요.', 400);
    const input: DetailWorkspaceInput = { optionId: value.optionId, expectedRevision: value.expectedRevision as number,
      expectedView: validateDetailWorkspaceExpectedView(value.expectedView), requestId: value.requestId, document: value.document as DetailWorkspaceInput['document'] };
    return json(await saveDetailWorkspace(auth.owner, auth.company, auth.identity, auth.productId, selected.profileId, input, request.signal));
  } catch (error) { return fail(error); }
}
