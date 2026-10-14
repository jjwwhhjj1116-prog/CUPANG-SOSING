import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import { readQuotationExportSource, resolveQuotationExport, quotationExportFingerprint, QuotationExportError } from '@/app/exports/quotation-source';
import { readQuotationFields, quotationSourcesCurrent } from '@/db/quotation-fields';
import { projectSupplierHubSingleDocument, SingleProjectionError } from '@/app/supplier-hub-single-projection';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const changed = () => json({ error: '검토 중 상품·옵션·회사·카테고리 또는 견적 수정값이 변경되었습니다. 저장 후 다시 검토해주세요.', code: 'SINGLE_SOURCE_CHANGED' }, 409);

/** Internal read-only projection. No Hub request, image publication or write API. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET', 'cache-control': 'no-store' } });
  const user = await getChatGPTUser();
  if (!user?.verifiedAccess) return json({ error: '운영 인증 연결 후 Single 문서를 검토할 수 있습니다.' }, 503);
  const member = { id: user.membership?.id, email: user.membership?.email, role: user.membership?.role };
  try {
    const url = new URL(request.url), profileId = url.searchParams.get('profileId'), expectedFingerprint = url.searchParams.get('expectedFingerprint');
    if ([...url.searchParams.keys()].some(key => !['profileId', 'expectedFingerprint'].includes(key)) || url.searchParams.getAll('profileId').length > 1
      || url.searchParams.getAll('expectedFingerprint').length > 1 || profileId !== null && !/^[a-zA-Z0-9_-]{1,100}$/.test(profileId)
      || expectedFingerprint !== null && !/^[a-f0-9]{64}$/.test(expectedFingerprint)) return json({ error: 'Single 문서의 프로필·검토 식별값을 확인해주세요.' }, 400);
    const owner = await getWorkspaceOwnerId(), company = approvedSupplierHubCompany(user.membership), { id } = await context.params;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return json({ error: '상품 식별값을 확인해주세요.' }, 400);
    if (user.userId !== owner || member.id !== owner || !['admin', 'member'].includes(member.role ?? '') || !company)
      return json({ error: '승인된 회원 회사의 저장 자료만 검토할 수 있습니다.' }, 409);
    const saved = await readQuotationExportSource(owner, id, profileId);
    if (!saved.hubSchema || !saved.company || saved.company.code !== company.code || saved.company.name !== company.name || !saved.categoryContext.categoryId)
      return json({ error: '이 상품의 회사·카테고리에 연결된 Single 원문 양식이 필요합니다.', code: 'SINGLE_SCHEMA' }, 409);
    const fingerprint = await quotationExportFingerprint(saved, null);
    if (expectedFingerprint !== null && expectedFingerprint !== fingerprint) return changed();
    const document = await projectSupplierHubSingleDocument({ snapshot: saved.hubSchema, company, categoryId: saved.categoryContext.categoryId,
      categoryPath: saved.categoryContext.categoryPath, resolved: resolveQuotationExport(saved) });
    const latest = await readQuotationExportSource(owner, id, profileId);
    if (!await quotationSourcesCurrent(owner, id, saved.source) || (await readQuotationFields(owner, id)).revision !== saved.state.revision
      || await quotationExportFingerprint(latest, null) !== fingerprint) return changed();
    const current = await getChatGPTUser(), currentCompany = approvedSupplierHubCompany(current?.membership);
    if (!current?.verifiedAccess || current.userId !== owner || current.membership?.id !== member.id || current.membership?.email !== member.email
      || current.membership?.role !== member.role || !currentCompany || currentCompany.code !== company.code || currentCompany.name !== company.name) return changed();
    return json({ ...document, productId: id, requestedProfileId: profileId, fingerprint, source: { productVersion: saved.product.updated_at,
      contentRevision: saved.content.revision, optionRevision: saved.options.revision, quotationRevision: saved.state.revision,
      profileId: saved.categoryContext.profileId, profileRevision: saved.profile?.revision ?? null } });
  } catch (error) {
    if (error instanceof SingleProjectionError) return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof QuotationExportError) return json({ error: error.message }, error.status);
    return json({ error: '저장된 Single 문서를 읽지 못했습니다.' }, 503);
  }
}
