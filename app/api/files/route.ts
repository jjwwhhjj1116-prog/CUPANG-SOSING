import { imageDimensionMetadata } from '@/app/image-dimensions';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { imageFileType, imageObjectName, isOwnedImageKey, MAX_IMAGE_BYTES, MAX_IMAGE_MULTIPART_BYTES } from '@/app/image-files';
import { readBoundedBytes, RequestBodyError } from '@/app/request-body';
import { labelUploadDigest, labelUploadKey } from '@/app/label-upload-key';

async function savedLabel(ownerId: string, uploadId: string) {
  const key = labelUploadKey(ownerId, uploadId);
  if (!isOwnedImageKey(ownerId, key)) throw new Error('Invalid label owner');
  const object = await env.FILES.head(key);
  if (!object) return null;
  if (object.size < 1 || object.size > MAX_IMAGE_BYTES || object.httpMetadata?.contentType !== 'image/png'
    || object.customMetadata?.labelUploadId !== uploadId || !/^[a-f0-9]{64}$/.test(object.customMetadata?.labelBlobSha256 ?? '')) throw new Error('Invalid saved label');
  return { key, contentType: 'image/png', size: object.size, sha256: object.customMetadata!.labelBlobSha256 };
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return NextResponse.json({ error: '운영 인증 연결 후 라벨 파일을 확인할 수 있습니다.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  try {
    const params = new URL(request.url).searchParams, uploadId = params.get('labelUploadId');
    if (params.getAll('labelUploadId').length !== 1 || [...params.keys()].some(key => key !== 'labelUploadId') || !/^[a-f0-9]{64}$/.test(uploadId ?? '')) return NextResponse.json({ error: '라벨 업로드 번호를 확인해주세요.' }, { status: 400, headers: { 'cache-control': 'no-store' } });
    const ownerId = await getWorkspaceOwnerId();
    if (!env.FILES) throw new Error('Missing storage');
    return NextResponse.json(await savedLabel(ownerId, uploadId!) ?? { key: null }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: '저장한 라벨 파일을 확인하지 못했습니다. 다시 확인한 뒤 연결해주세요.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return NextResponse.json({ error: 'Cloudflare Access 로그인 또는 서버 인증 설정을 확인해주세요.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  try {
    const ownerId = await getWorkspaceOwnerId();
    const contentType = request.headers.get('content-type') ?? '';
    if (!/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) return NextResponse.json({ error: '이미지 파일을 multipart 형식으로 업로드해주세요.' }, { status: 400 });
    // Buffer at most 10 MB plus bounded multipart headers before parsing. This
    // avoids unbounded request.formData() allocation and distrusts Content-Length.
    const body = await readBoundedBytes(request, MAX_IMAGE_MULTIPART_BYTES);
    let form: FormData;
    try { form = await new Response(body.buffer as ArrayBuffer, { headers: { 'content-type': contentType } }).formData(); }
    catch { return NextResponse.json({ error: '파일 업로드 형식을 읽지 못했습니다.' }, { status: 400 }); }
    if (form.getAll('file').length !== 1 || form.getAll('labelUploadId').length > 1 || [...form.keys()].some(key => !['file', 'labelUploadId'].includes(key))) return NextResponse.json({ error: '이미지 한 개만 업로드해주세요.' }, { status: 400 });
    const uploadId = form.get('labelUploadId');
    if (uploadId !== null && (typeof uploadId !== 'string' || !/^[a-f0-9]{64}$/.test(uploadId))) return NextResponse.json({ error: '라벨 업로드 번호를 확인해주세요.' }, { status: 400 });
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: '내용이 있는 이미지 파일을 선택해주세요.' }, { status: 400 });
    if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: '이미지는 10MB 이하만 업로드할 수 있습니다.' }, { status: 413 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    let actual;
    try { actual = imageFileType(bytes); }
    catch { return NextResponse.json({ error: 'PNG·JPEG·WebP·GIF·AVIF 이미지 파일만 업로드할 수 있습니다. SVG·HTML은 지원하지 않습니다.' }, { status: 415 }); }
    if (uploadId !== null && (actual.contentType !== 'image/png' || file.name !== 'sourceflow-quotation-label.png'
      || (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin))) return NextResponse.json({ error: '같은 사이트에서 생성한 라벨 PNG를 업로드해주세요.' }, { status: 400 });
    const key = uploadId === null ? `${ownerId}/${crypto.randomUUID()}-${imageObjectName(file.name, actual.extension)}` : labelUploadKey(ownerId, uploadId);
    if (!isOwnedImageKey(ownerId, key)) return NextResponse.json({ error: '업로드 소유자 정보를 확인해주세요.' }, { status: 400 });
    if (!env.FILES) return NextResponse.json({ error: '이미지 저장소가 연결되지 않았습니다.' }, { status: 503 });
    const sha256 = uploadId === null ? null : await labelUploadDigest(bytes);
    const reuse = (saved: Awaited<ReturnType<typeof savedLabel>>) => saved && saved.sha256 === sha256 && saved.size === bytes.byteLength
      ? NextResponse.json({ ...saved, reused: true }, { headers: { 'cache-control': 'no-store' } })
      : NextResponse.json({ error: '같은 라벨 번호에 다른 PNG가 저장되어 있습니다. 저장한 라벨을 다시 확인해주세요.' }, { status: 409, headers: { 'cache-control': 'no-store' } });
    if (uploadId !== null) { const existing = await savedLabel(ownerId, uploadId); if (existing) return reuse(existing); }
    const object = await env.FILES.put(key, bytes, { httpMetadata: { contentType: actual.contentType }, customMetadata: { imageValidation: 'header-v1', ...imageDimensionMetadata(bytes),
      ...(uploadId === null ? {} : { labelUploadId: uploadId, labelBlobSha256: sha256! }) },
      ...(uploadId === null ? {} : { onlyIf: new Headers({ 'if-none-match': '*' }) }) });
    if (!object && uploadId !== null) { const existing = await savedLabel(ownerId, uploadId); if (existing) return reuse(existing); }
    if (!object) throw new Error('R2 did not confirm the upload.');
    return NextResponse.json({ key, url: `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`, contentType: actual.contentType, size: bytes.byteLength }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof RequestBodyError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: '이미지를 저장하지 못했습니다. 저장소 연결을 확인한 후 다시 시도해주세요.' }, { status: 503 });
  }
}
