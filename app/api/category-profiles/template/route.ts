import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { ownsTemplateKey, templateKey } from '@/db/category-templates';
import { CATEGORY_TEMPLATE_FILE_LIMIT, parseTemplateText } from '@/app/category-profiles';
import { inspectXlsx } from '@/app/xlsx-template';
import { readBoundedBytes, RequestBodyError } from '@/app/request-body';

const owner = async () => await getWorkspaceOwnerId();
const noStore = { 'cache-control': 'no-store' };
const unavailable = () => NextResponse.json({ error: '운영 인증이 연결되기 전에는 견적서 원본 저장을 공개할 수 없습니다.' }, { status: 503, headers: noStore });
const mime = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv;charset=utf-8', tsv: 'text/tab-separated-values;charset=utf-8' };
// The single file may use 5 MB; allow a bounded 64 KiB for multipart headers/boundaries.
const multipartLimit = CATEGORY_TEMPLATE_FILE_LIMIT + 64 * 1024;

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return unavailable();
  let file: File; let format: keyof typeof mime; let bytes: ArrayBuffer;
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.split(';')[0].trim().toLowerCase() !== 'multipart/form-data') throw new Error('견적서는 파일 업로드 형식으로 보내주세요.');
    const bounded = await readBoundedBytes(request, multipartLimit);
    const form = await new Response(bounded.buffer as ArrayBuffer, { headers: { 'content-type': contentType } }).formData();
    if (form.getAll('file').length !== 1 || Array.from(form.keys()).some(key => key !== 'file')) throw new Error('견적서 파일 한 개만 보내주세요. 추가 파일이나 입력 항목은 지원하지 않습니다.');
    const candidate = form.get('file');
    if (!(candidate instanceof File)) throw new Error('견적서 파일을 선택해주세요.');
    file = candidate; const extension = file.name.split('.').at(-1)?.toLowerCase();
    if (!extension || !Object.hasOwn(mime, extension) || !file.name.trim() || file.name.length > 240) throw new Error('XLSX·UTF-8 CSV·TSV 견적서만 지원합니다.');
    if (file.size < 1) throw new Error('빈 견적서 파일은 저장할 수 없습니다.');
    if (file.size > CATEGORY_TEMPLATE_FILE_LIMIT) throw new RequestBodyError(413, '견적서는 5MB 이하만 저장할 수 있습니다.');
    format = extension as keyof typeof mime; bytes = await file.arrayBuffer();
    if (format === 'xlsx') await inspectXlsx(bytes);
    else parseTemplateText(new TextDecoder('utf-8', { fatal: true }).decode(bytes), format === 'tsv' ? '\t' : ',');
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '견적서 파일을 확인해주세요.' }, { status: error instanceof RequestBodyError ? error.status : 400, headers: noStore }); }
  try {
    if (!env.FILES) return unavailable();
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('');
    const storageKey = templateKey(await owner(), sha256, format);
    // Content-addressed objects retain the exact original workbook, without rewriting its cells or validation.
    await env.FILES.put(storageKey, bytes, { httpMetadata: { contentType: mime[format] }, customMetadata: { sha256, format, name: file.name } });
    return NextResponse.json({ template: { name: file.name, format, sha256, storageKey } }, { status: 201, headers: noStore });
  } catch { return NextResponse.json({ error: '견적서 원본 저장을 확인하지 못했습니다.' }, { status: 503, headers: noStore }); }
}
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return unavailable();
  try {
    const key = new URL(request.url).searchParams.get('key') ?? '';
    if (!ownsTemplateKey(await owner(), key)) return NextResponse.json({ error: '견적서 파일을 찾을 수 없습니다.' }, { status: 404, headers: noStore });
    if (!env.FILES) return NextResponse.json({ error: '견적서 저장소를 사용할 수 없습니다.' }, { status: 503, headers: noStore });
    const object = await env.FILES.get(key);
    if (!object) return NextResponse.json({ error: '견적서 파일을 찾을 수 없습니다.' }, { status: 404, headers: noStore });
    return new Response(object.body, { headers: { ...noStore, 'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream', 'x-content-type-options': 'nosniff', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(object.customMetadata?.name ?? 'quotation.xlsx')}` } });
  } catch { return NextResponse.json({ error: '견적서 원본을 읽지 못했습니다.' }, { status: 503, headers: noStore }); }
}
