import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import { DetailWorkspaceError } from '@/app/detail-workspace';
import { readWorkspaceImageSource, applyWorkspaceImage, recoverWorkspaceImage, confirmWorkspaceImageSource, workspaceImageDocument, type WorkspaceImageIdentity } from '@/db/detail-workspace-image-edits';
import { validateFreeImageSource, validateImageTextRegions } from '@/app/free-image-translation';
import { MAX_FREE_IMAGE_EDIT_BYTES } from '@/app/free-image-edit-document';
import { MAX_IMAGE_BYTES } from '@/app/image-files';
import { readBoundedBytes, readBoundedJson, RequestBodyError } from '@/app/request-body';
import { translateImageRegions } from '@/app/automation/free-image-text';
import { FreeImageEditRecordError } from '@/app/free-image-edit-record';
import { QuotationFieldsSnapshotError } from '@/app/quotation-fields-snapshot';
type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
const id = (value: unknown, max = 80): value is string => typeof value === 'string' && new RegExp(`^[A-Za-z0-9_-]{1,${max}}$`, 'u').test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function exact(value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> {
  return object(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
}
async function auth(context: Context): Promise<WorkspaceImageIdentity> {
  const user = await getChatGPTUser(), owner = await getWorkspaceOwnerId(), company = approvedSupplierHubCompany(user?.membership), { id: productId } = await context.params;
  if (!user?.verifiedAccess || user.userId !== owner || !user.membership || !company) throw new DetailWorkspaceError('승인된 회사 계정으로 편집해주세요.', 403);
  if (!id(productId)) throw new DetailWorkspaceError('상품 번호를 확인해주세요.', 400);
  return { owner, company, identity: { email: user.membership.email, role: user.membership.role }, id: productId };
}
function fail(error: unknown) {
  if (error instanceof DetailWorkspaceError || error instanceof FreeImageEditRecordError || error instanceof RequestBodyError || error instanceof QuotationFieldsSnapshotError) return json({ error: error.message }, error.status);
  return json({ error: '편집 결과를 확인하지 못했습니다. 현재 미리보기를 보존하고 조회로 먼저 확인해주세요.' }, 503);
}
export async function GET(request: Request, context: Context) {
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['profileId', 'optionId', 'photoId'].includes(key) || params.getAll(key).length !== 1)
      || params.has('profileId') && !id(params.get('profileId'), 100) || !id(params.get('optionId')) || !id(params.get('photoId'), 100)) throw new DetailWorkspaceError('보관한 본문 사진의 범위를 확인해주세요.', 400);
    const result = await readWorkspaceImageSource(await auth(context), params.get('profileId'), params.get('optionId')!, params.get('photoId')!, request.signal), { seal: omitted, ...reply } = result;
    void omitted; return json(reply);
  } catch (error) { return fail(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    if (new URL(request.url).search || request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new DetailWorkspaceError('같은 사이트의 편집 화면에서 적용해주세요.', 400);
    const identity = await auth(context), type = request.headers.get('content-type') ?? '';
    if (/^application\/json(?:\s*;|$)/iu.test(type)) {
      const value = await readBoundedJson(request, MAX_FREE_IMAGE_EDIT_BYTES + 96 * 1024);
      if (!object(value)) throw new DetailWorkspaceError('편집 요청을 확인해주세요.', 400);
      let source; try { source = validateFreeImageSource(value.source); } catch { throw new DetailWorkspaceError('작업공간 원본을 확인해주세요.', 400); }
      if (value.action === 'recover' && exact(value, ['action', 'source', 'outputSha256', 'outputBytes', 'editDocument'], ['crop'])) {
        const { document } = workspaceImageDocument(source, value.editDocument, value.crop);
        return json(await recoverWorkspaceImage(identity, source, document, value.outputSha256 as string, value.outputBytes as number, request.signal));
      }
      if (value.action !== 'translate' || !exact(value, ['action', 'source', 'sourceLanguage', 'regions']) || !['zh', 'en'].includes(String(value.sourceLanguage))) throw new DetailWorkspaceError('작업공간 번역 요청을 확인해주세요.', 400);
      let regions; try { regions = validateImageTextRegions(value.regions); } catch { throw new DetailWorkspaceError('번역할 원문 영역을 확인해주세요.', 400); }
      await confirmWorkspaceImageSource(identity, source, request.signal);
      const result = await translateImageRegions(regions, value.sourceLanguage as 'zh' | 'en', undefined, request.signal);
      await confirmWorkspaceImageSource(identity, source, request.signal); return json({ source, ...result });
    }
    if (!/^multipart\/form-data(?:\s*;|$)/iu.test(type)) throw new DetailWorkspaceError('PNG 미리보기를 multipart 형식으로 전달해주세요.', 400);
    const bytes = await readBoundedBytes(request, MAX_IMAGE_BYTES + MAX_FREE_IMAGE_EDIT_BYTES + 128 * 1024);
    let form; try { form = await new Response(bytes.buffer as ArrayBuffer, { headers: { 'content-type': type } }).formData(); } catch { throw new DetailWorkspaceError('PNG 입력 형식을 확인해주세요.', 400); }
    if ([...form.keys()].some(key => !['action', 'source', 'file', 'editDocument', 'crop'].includes(key) || form.getAll(key).length !== 1)
      || ['action', 'source', 'file', 'editDocument'].some(key => !form.has(key)) || form.get('action') !== 'apply') throw new DetailWorkspaceError('PNG와 같은 편집 문서 한 개를 전달해주세요.', 400);
    let source, document;
    try {
      const rawSource = form.get('source'), rawDocument = form.get('editDocument'), rawCrop = form.get('crop');
      if (typeof rawSource !== 'string' || rawSource.length > 32768 || typeof rawDocument !== 'string' || new TextEncoder().encode(rawDocument).length > MAX_FREE_IMAGE_EDIT_BYTES || rawCrop !== null && (typeof rawCrop !== 'string' || rawCrop.length > 1024)) throw Error();
      source = validateFreeImageSource(JSON.parse(rawSource)); document = workspaceImageDocument(source, JSON.parse(rawDocument), rawCrop === null ? undefined : JSON.parse(rawCrop)).document;
    } catch { throw new DetailWorkspaceError('원본과 편집 문서·자르기 영역을 확인해주세요.', 400); }
    const file = form.get('file'); if (!(file instanceof File) || file.type !== 'image/png') throw new DetailWorkspaceError('PNG 결과 파일을 전달해주세요.', 400);
    return json(await applyWorkspaceImage(identity, source, document, new Uint8Array(await file.arrayBuffer()), request.signal));
  } catch (error) { return fail(error); }
}
