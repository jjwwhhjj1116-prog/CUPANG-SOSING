import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import { DetailWorkspaceError, validateDetailWorkspaceExpectedView } from '@/app/detail-workspace';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { QuotationFieldsSnapshotError } from '@/app/quotation-fields-snapshot';
import { attachDetailWorkspaceFiles } from '@/db/detail-workspace-attachment';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
const id = (value: unknown, max = 80): value is string => typeof value === 'string' && new RegExp(`^[A-Za-z0-9_-]{1,${max}}$`, 'u').test(value);
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const url = new URL(request.url), query = url.searchParams;
    if (request.headers.get('origin') && request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site'
      || [...query.keys()].some(key => key !== 'profileId' || query.getAll(key).length !== 1)
      || query.has('profileId') && !id(query.get('profileId'), 100)) throw new DetailWorkspaceError('같은 사이트에서 검토한 상품 연결을 요청해주세요.', 400);
    const user = await getChatGPTUser(), owner = await getWorkspaceOwnerId(), company = approvedSupplierHubCompany(user?.membership), { id: productId } = await context.params;
    if (!user?.verifiedAccess || user.userId !== owner || !user.membership || !company) throw new DetailWorkspaceError('승인된 회사 계정으로 사진을 연결해주세요.', 403);
    if (!id(productId)) throw new DetailWorkspaceError('상품 번호를 확인해주세요.', 400);
    const body = await readBoundedJson(request, 16 * 1024) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 4
      || !['optionId', 'expectedView', 'revision', 'digest'].every(key => Object.hasOwn(body, key))
      || !id(body.optionId) || !Number.isSafeInteger(body.revision) || (body.revision as number) < 1
      || typeof body.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(body.digest)) throw new DetailWorkspaceError('검토한 편집 구성의 버전과 사진 연결을 확인해주세요.', 400);
    return json(await attachDetailWorkspaceFiles(owner, company, { email: user.membership.email, role: user.membership.role }, productId, query.get('profileId'),
      { optionId: body.optionId, expectedView: validateDetailWorkspaceExpectedView(body.expectedView), revision: body.revision as number, digest: body.digest }, request.signal));
  } catch (error) {
    if (error instanceof DetailWorkspaceError || error instanceof RequestBodyError || error instanceof QuotationFieldsSnapshotError) return json({ error: error.message }, error.status);
    return json({ error: '사진 연결 완료 여부를 확인하지 못했습니다. 현재 작업을 유지하고 조회로 먼저 확인해주세요.' }, 503);
  }
}
