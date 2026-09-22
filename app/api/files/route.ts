import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { imageFileType, imageObjectName, isOwnedImageKey, MAX_IMAGE_BYTES, MAX_IMAGE_MULTIPART_BYTES } from '@/app/image-files';
import { readBoundedBytes, RequestBodyError } from '@/app/request-body';

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return NextResponse.json({ error: 'Cloudflare Access 로그인 또는 서버 인증 설정을 확인해주세요.' }, { status: 503 });
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
    if (form.getAll('file').length !== 1 || [...form.keys()].some(key => key !== 'file')) return NextResponse.json({ error: '이미지 한 개만 업로드해주세요.' }, { status: 400 });
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: '내용이 있는 이미지 파일을 선택해주세요.' }, { status: 400 });
    if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: '이미지는 10MB 이하만 업로드할 수 있습니다.' }, { status: 413 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    let actual;
    try { actual = imageFileType(bytes); }
    catch { return NextResponse.json({ error: 'PNG·JPEG·WebP·GIF·AVIF 이미지 파일만 업로드할 수 있습니다. SVG·HTML은 지원하지 않습니다.' }, { status: 415 }); }
    const key = `${ownerId}/${crypto.randomUUID()}-${imageObjectName(file.name, actual.extension)}`;
    if (!isOwnedImageKey(ownerId, key)) return NextResponse.json({ error: '업로드 소유자 정보를 확인해주세요.' }, { status: 400 });
    if (!env.FILES) return NextResponse.json({ error: '이미지 저장소가 연결되지 않았습니다.' }, { status: 503 });
    const object = await env.FILES.put(key, bytes, { httpMetadata: { contentType: actual.contentType }, customMetadata: { imageValidation: 'header-v1' } });
    if (!object) throw new Error('R2 did not confirm the upload.');
    return NextResponse.json({ key, url: `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`, contentType: actual.contentType, size: bytes.byteLength }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof RequestBodyError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: '이미지를 저장하지 못했습니다. 저장소 연결을 확인한 후 다시 시도해주세요.' }, { status: 503 });
  }
}
