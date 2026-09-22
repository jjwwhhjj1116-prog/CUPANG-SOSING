import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { createReviewBundle } from '@/app/exports/review-bundle';
import { readQuotationExportSource, resolveQuotationExport, quotationExportFingerprint, QuotationExportError } from '@/app/exports/quotation-source';
import { quotationAttachmentKeys, quotationFieldFiles } from '@/app/exports/quotation-fields';
import { loadAttachments, AttachmentError } from '@/app/exports/attachments';
import { ExportSizeError } from '@/app/exports/zip';

const json = (value: unknown, status: number) => NextResponse.json(value, { status, headers: { 'cache-control': 'no-store' } });
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결 후 다운로드할 수 있습니다.' }, 503);
  try {
    const owner = await getWorkspaceOwnerId(); const { id } = await context.params;
    const profileId = new URL(request.url).searchParams.get('profileId');
    if (profileId !== null && !/^[a-zA-Z0-9_-]{1,100}$/.test(profileId)) return json({ error: '카테고리 프로필 선택을 확인해주세요.' }, 400);
    const saved = await readQuotationExportSource(owner, id, profileId);
    const revision = await quotationExportFingerprint(saved, null);
    const resolved = resolveQuotationExport(saved);
    const assets = await loadAttachments(owner, saved.product.image_keys, quotationAttachmentKeys(saved, resolved));
    const fields = quotationFieldFiles(saved, resolved, assets, revision);
    let latest;
    try { latest = await readQuotationExportSource(owner, id, profileId); }
    catch (error) { if (error instanceof QuotationExportError && error.status === 404) return json({ error: '자료를 묶는 동안 상품 또는 카테고리가 변경되었습니다.' }, 409); throw error; }
    if (await quotationExportFingerprint(latest, null) !== revision) return json({ error: '자료를 묶는 동안 상품·견적 수정값·옵션·설정·카테고리가 변경되었습니다. 저장 완료 후 다시 다운로드해주세요.' }, 409);
    const zip = createReviewBundle(saved.product, saved.content, assets, [
      ...fields.files, { name: 'options.json', data: JSON.stringify(saved.options, null, 2) },
    ]);
    return new Response(zip.buffer as ArrayBuffer, { headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="sourceflow-review.zip"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  } catch (error) {
    if (error instanceof QuotationExportError || error instanceof AttachmentError || error instanceof ExportSizeError) return json({ error: error.message }, error.status);
    return json({ error: '검토 패키지를 생성하지 못했습니다. 첨부 파일과 저장 상태를 확인해주세요.' }, 503);
  }
}
