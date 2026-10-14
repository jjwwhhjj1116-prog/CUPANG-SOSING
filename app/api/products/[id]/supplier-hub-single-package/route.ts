import { loadSinglePackage } from '@/app/exports/single-package';
import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import { QuotationExportError } from '@/app/exports/quotation-source';
import { AttachmentError } from '@/app/exports/attachments';
import { PublicDetailError } from '@/app/quotation-public-detail';
import { SingleProjectionError } from '@/app/supplier-hub-single-projection';
import { SingleAssetError } from '@/app/supplier-hub-single-assets';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
function changed(): never { throw new SingleAssetError('준비 중 상품·견적값·이미지·회사 또는 카테고리가 변경되었습니다. 다시 검토해주세요.', 'SINGLE_SOURCE_CHANGED'); }
type Context = { params: Promise<{ id: string }> };
/** GET is a private candidate preview. Only an explicit fingerprint-bound POST
 * creates immutable copies served by our existing media route. Neither method
 * calls Supplier Hub, creates a remote document or acknowledges an agreement. */
async function handle(request: Request, context: Context, prepare: boolean) {
  if (request.method !== (prepare ? 'POST' : 'GET')) return new Response(null, { status: 405, headers: { allow: prepare ? 'POST' : 'GET', 'cache-control': 'no-store' } });
  const user = await getChatGPTUser();
  if (!user?.verifiedAccess) return json({ error: '운영 인증 연결 후 Single 자료를 준비할 수 있습니다.' }, 503);
  const member = { id: user.membership?.id, email: user.membership?.email, role: user.membership?.role };
  try {
    const url = new URL(request.url), profileId = url.searchParams.get('profileId');
    if ([...url.searchParams.keys()].some(key => key !== 'profileId') || url.searchParams.getAll('profileId').length > 1
      || profileId !== null && !/^[a-zA-Z0-9_-]{1,100}$/.test(profileId)) return json({ error: 'Single 자료의 프로필 식별값을 확인해주세요.' }, 400);
    let expectedFingerprint: string | undefined;
    if (prepare) {
      if (request.headers.get('sec-fetch-site') === 'cross-site' || request.headers.has('origin') && request.headers.get('origin') !== url.origin)
        return json({ error: '같은 앱에서 명시적으로 자료 준비를 요청해주세요.' }, 403);
      const body = await readBoundedJson(request, 1024);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2
        || !Object.hasOwn(body, 'action') || !Object.hasOwn(body, 'expectedFingerprint')) return json({ error: '검토한 식별값으로 자료 준비를 요청해주세요.' }, 400);
      const input = body as Record<string, unknown>;
      if (input.action !== 'prepare' || typeof input.expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedFingerprint))
        return json({ error: '검토한 식별값으로 자료 준비를 요청해주세요.' }, 400);
      expectedFingerprint = input.expectedFingerprint;
    }
    const owner = await getWorkspaceOwnerId(), company = approvedSupplierHubCompany(user.membership), { id } = await context.params;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return json({ error: '상품 식별값을 확인해주세요.' }, 400);
    if (user.userId !== owner || member.id !== owner || !['admin', 'member'].includes(member.role ?? '') || !company)
      return json({ error: '승인된 회원 회사의 저장 자료만 준비할 수 있습니다.' }, 409);
    const active = async () => {
      if (request.signal.aborted) throw new SingleAssetError('자료 준비 요청이 취소되었습니다.', 'SINGLE_ABORTED');
      const current = await getChatGPTUser(), currentCompany = approvedSupplierHubCompany(current?.membership);
      if (!current?.verifiedAccess || current.userId !== owner || current.membership?.id !== member.id || current.membership?.email !== member.email
        || current.membership?.role !== member.role || !currentCompany || currentCompany.code !== company.code || currentCompany.name !== company.name) changed();
    };
    await active();
    const {view} = await loadSinglePackage(owner,id,profileId,company,active,prepare,expectedFingerprint);
    return json(view);
  } catch (error) {
    if (error instanceof SingleAssetError || error instanceof SingleProjectionError) return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof QuotationExportError || error instanceof AttachmentError || error instanceof PublicDetailError || error instanceof RequestBodyError)
      return json({ error: error.message }, error.status);
    return json({ error: 'Single 자료의 저장 파일·최종값을 확인하지 못했습니다.' }, 503);
  }
}
export const GET = (request: Request, context: Context) => handle(request, context, false);
export const POST = (request: Request, context: Context) => handle(request, context, true);
