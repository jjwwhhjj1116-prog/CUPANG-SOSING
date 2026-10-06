import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { attachProductDocument } from '@/db/product-attachments';
import { applyContentPatch, productImageKeys } from '@/app/product-content';
import { inspectImage } from '@/app/automation/image-edit';
import { translateImageRegions } from '@/app/automation/free-image-text';
import { isOwnedImageKey, MAX_IMAGE_BYTES, MAX_IMAGE_MULTIPART_BYTES } from '@/app/image-files';
import { MAX_OCR_PIXELS, validFreeImageRole, validateFreeImageSource, validateImageTextRegions, type FreeImageSource } from '@/app/free-image-translation';
import { readBoundedBytes, readBoundedJson, readBoundedStream, RequestBodyError } from '@/app/request-body';

type Context = { params: Promise<{ id: string }> };
class ImageTextError extends Error {
  constructor(public status: 400 | 404 | 409 | 413 | 415 | 503, message: string) { super(message); }
}
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
const changed = () => new ImageTextError(409, '번역 중 원본 이미지나 저장 내용이 변경되었습니다. 최신 이미지를 다시 불러와주세요.');
async function digest(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), byte => byte.toString(16).padStart(2, '0')).join('');
}
function sourceIdentity(source: FreeImageSource) {
  // Explicit field order gives retries the same key even if JSON key order differs.
  return JSON.stringify({ productId: source.productId, productVersion: source.productVersion, contentRevision: source.contentRevision,
    sourceKey: source.sourceKey, sourceSha256: source.sourceSha256, role: source.role, width: source.width, height: source.height });
}
async function ownerId() {
  const user = await getChatGPTUser();
  if ((process.env.NODE_ENV === 'production' || (env as { YOOFAM_AUTH_ENABLED?: string }).YOOFAM_AUTH_ENABLED === 'true') && !user?.verifiedAccess) throw new ImageTextError(503, '로그인 후 이미지 문구를 번역할 수 있습니다.');
  return user?.userId ?? await getWorkspaceOwnerId();
}
async function state(owner: string, id: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new ImageTextError(400, '상품 번호를 확인해주세요.');
  const product = await findProduct(owner, id);
  if (!product) throw new ImageTextError(404, '상품을 찾을 수 없습니다.');
  return { product, content: await readProductContent(owner, id), keys: productImageKeys(product.image_keys) };
}
async function readImage(key: string) {
  if (!env.FILES) throw new ImageTextError(503, '이미지 저장소가 연결되지 않았습니다.');
  const object = await env.FILES.get(key);
  if (!object) throw new ImageTextError(409, '원본 이미지 파일을 다시 확인해주세요.');
  if (object.size < 1 || object.size > MAX_IMAGE_BYTES) throw new ImageTextError(413, '이미지 한 장은 10MB 이하여야 합니다.');
  const bytes = await readBoundedStream(object.body, MAX_IMAGE_BYTES);
  if (bytes.length !== object.size) throw new ImageTextError(503, '이미지 파일을 끝까지 읽지 못했습니다.');
  let dimensions;
  try { dimensions = inspectImage(bytes); }
  catch { throw new ImageTextError(415, 'PNG·JPEG·WebP 정지 이미지만 번역할 수 있습니다.'); }
  if (dimensions.width * dimensions.height > MAX_OCR_PIXELS) throw new ImageTextError(413, '이미지 번역은 1,200만 픽셀 이하에서 사용할 수 있습니다.');
  return { object, bytes, dimensions };
}
async function original(owner: string, id: string, sourceKey: string, role: FreeImageSource['role'], current: Awaited<ReturnType<typeof state>>, requireRole: boolean) {
  if (!isOwnedImageKey(owner, sourceKey) || !current.keys.includes(sourceKey)) throw new ImageTextError(404, '이 상품에 저장된 본인 소유 이미지를 선택해주세요.');
  if (requireRole && !current.content.assets[role].value.includes(sourceKey)) throw changed();
  const { bytes, dimensions } = await readImage(sourceKey);
  return { productId: id, productVersion: current.product.updated_at, contentRevision: current.content.revision,
    sourceKey, sourceSha256: await digest(bytes), role, width: dimensions.width, height: dimensions.height } satisfies FreeImageSource;
}
async function freshSource(owner: string, id: string, source: FreeImageSource) {
  if (source.productId !== id) throw new ImageTextError(400, '번역한 상품과 저장할 상품이 다릅니다.');
  const current = await state(owner, id);
  if (current.product.updated_at !== source.productVersion || current.content.revision !== source.contentRevision) throw changed();
  const observed = await original(owner, id, source.sourceKey, source.role, current, true);
  if (sourceIdentity(observed) !== sourceIdentity(source)) throw changed();
  return current;
}
async function storedOutput(key: string, source: FreeImageSource, sha256: string, size: number) {
  if (!env.FILES) throw new ImageTextError(503, '이미지 저장소가 연결되지 않았습니다.');
  const object = await env.FILES.get(key);
  if (!object) return false;
  if (object.size !== size || object.size > MAX_IMAGE_BYTES || object.httpMetadata?.contentType !== 'image/png'
    || object.customMetadata?.freeImageSource !== sourceIdentity(source) || object.customMetadata?.freeImageOutputSha256 !== sha256) throw new ImageTextError(409, '같은 이미지 결과 번호에 다른 파일이 저장되어 있습니다.');
  const bytes = await readBoundedStream(object.body, MAX_IMAGE_BYTES);
  if (bytes.length !== size || await digest(bytes) !== sha256) throw new ImageTextError(409, '저장한 이미지 결과의 내용이 다릅니다.');
  return true;
}
async function replay(owner: string, id: string, source: FreeImageSource, key: string, sha256: string, size: number) {
  const current = await state(owner, id);
  const role = current.content.assets[source.role].value;
  if (!current.keys.includes(key) || !role.includes(key) || role.includes(source.sourceKey)) return null;
  const observed = await original(owner, id, source.sourceKey, source.role, current, false);
  if (observed.sourceSha256 !== source.sourceSha256 || observed.width !== source.width || observed.height !== source.height) return null;
  if (!await storedOutput(key, source, sha256, size)) return null;
  return response({ source, key, productVersion: current.product.updated_at, contentRevision: current.content.revision, applied: true, replayed: true });
}
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new ImageTextError(400, '같은 사이트의 이미지 편집 화면에서 요청해주세요.');
}
function fail(error: unknown) {
  if (error instanceof ImageTextError || error instanceof RequestBodyError) return response({ error: error.message }, error.status);
  return response({ error: '이미지 문구 처리 결과를 확인하지 못했습니다. 기존 이미지는 유지됩니다. 저장본을 확인한 뒤 다시 시도해주세요.' }, 503);
}
export async function GET(request: Request, context: Context) {
  try {
    const owner = await ownerId(), { id } = await context.params, params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['sourceKey', 'role'].includes(key)) || params.getAll('sourceKey').length !== 1 || params.getAll('role').length !== 1
      || !validFreeImageRole(params.get('role'))) throw new ImageTextError(400, '원본 이미지와 역할을 선택해주세요.');
    const current = await state(owner, id), source = await original(owner, id, params.get('sourceKey')!, params.get('role') as FreeImageSource['role'], current, true);
    // Never return a snapshot whose source/version changed while R2 was read.
    await freshSource(owner, id, source);
    return response({ source });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const owner = await ownerId(), { id } = await context.params;
    sameOrigin(request);
    const type = request.headers.get('content-type') ?? '';
    if (type.split(';')[0].trim().toLowerCase() === 'application/json') {
      const body = await readBoundedJson(request, 96 * 1024);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ImageTextError(400, '번역할 문구를 확인해주세요.');
      const input = body as Record<string, unknown>;
      if (Object.keys(input).some(key => !['action', 'source', 'sourceLanguage', 'regions'].includes(key)) || input.action !== 'translate' || !['zh', 'en'].includes(String(input.sourceLanguage))) throw new ImageTextError(400, '이미지 문구 번역 요청을 확인해주세요.');
      let source: FreeImageSource, regions;
      try { source = validateFreeImageSource(input.source); regions = validateImageTextRegions(input.regions); }
      catch (error) { throw new ImageTextError(400, error instanceof Error ? error.message : '이미지 문구를 확인해주세요.'); }
      await freshSource(owner, id, source);
      const translated = await translateImageRegions(regions, input.sourceLanguage as 'zh' | 'en', undefined, request.signal);
      await freshSource(owner, id, source);
      return response({ source, ...translated });
    }
    if (!/^multipart\/form-data(?:\s*;|$)/i.test(type)) throw new ImageTextError(400, '이미지 저장은 PNG 파일을 multipart 형식으로 요청해주세요.');
    const body = await readBoundedBytes(request, MAX_IMAGE_MULTIPART_BYTES);
    let form: FormData;
    try { form = await new Response(body.buffer as ArrayBuffer, { headers: { 'content-type': type } }).formData(); }
    catch { throw new ImageTextError(400, '이미지 파일 요청을 읽지 못했습니다.'); }
    if ([...form.keys()].some(key => !['action', 'source', 'file'].includes(key)) || ['action', 'source', 'file'].some(key => form.getAll(key).length !== 1)
      || form.get('action') !== 'apply' || typeof form.get('source') !== 'string') throw new ImageTextError(400, 'PNG 결과 한 개와 원본 정보를 전달해주세요.');
    let source: FreeImageSource;
    try { const value = form.get('source') as string; if (value.length > 4096) throw Error('원본 정보가 너무 큽니다.'); source = validateFreeImageSource(JSON.parse(value)); }
    catch (error) { throw new ImageTextError(400, error instanceof Error ? error.message : '원본 정보를 확인해주세요.'); }
    if (source.productId !== id || !isOwnedImageKey(owner, source.sourceKey)) throw new ImageTextError(400, '상품·이미지 소유자를 확인해주세요.');
    const file = form.get('file');
    if (!(file instanceof File) || file.size < 1) throw new ImageTextError(400, '내용이 있는 PNG 결과 파일이 필요합니다.');
    if (file.size > MAX_IMAGE_BYTES) throw new ImageTextError(413, '이미지 한 장은 10MB 이하여야 합니다.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let dimensions;
    try { dimensions = inspectImage(bytes); } catch { throw new ImageTextError(415, '유효한 PNG 결과가 필요합니다.'); }
    if (dimensions.mime !== 'image/png' || file.type !== 'image/png') throw new ImageTextError(415, 'PNG 결과만 저장할 수 있습니다.');
    if (dimensions.width * dimensions.height > MAX_OCR_PIXELS) throw new ImageTextError(413, '번역 결과는 1,200만 픽셀 이하이어야 합니다.');
    const same = dimensions.width === source.width && dimensions.height === source.height;
    const rotated = dimensions.width === source.height && dimensions.height === source.width;
    if (!same && !rotated) throw new ImageTextError(400, '번역 결과 크기가 원본 이미지와 다릅니다.');
    const sha256 = await digest(bytes), fingerprint = await digest(new TextEncoder().encode(sourceIdentity(source)));
    const key = `${owner}/free-image-${id}-${fingerprint}-${sha256}.png`;
    if (!isOwnedImageKey(owner, key)) throw new ImageTextError(400, '이미지 결과 저장 범위를 확인해주세요.');
    const recovered = await replay(owner, id, source, key, sha256, bytes.length);
    if (recovered) return recovered;
    const current = await freshSource(owner, id, source);
    const imageKeys = [...new Set([...current.keys, key])];
    if (imageKeys.length > 50) throw new ImageTextError(400, '원본을 보존하려면 상품 이미지 50개 한도에 여유가 필요합니다.');
    if (Object.entries(current.content.assets).some(([role, field]) => role !== source.role && field.value.includes(key))) throw changed();
    const now = new Date(Math.max(Date.now(), Date.parse(source.productVersion) + 1)).toISOString();
    let next;
    try { next = applyContentPatch(current.content, { assets: { [source.role]: current.content.assets[source.role].value.map(value => value === source.sourceKey ? key : value) } }, now); }
    catch { throw new ImageTextError(409, '이미지 역할이 중복되어 있습니다. 원본 역할을 확인한 후 다시 적용해주세요.'); }
    if (!await storedOutput(key, source, sha256, bytes.length)) {
      try {
        const saved = await env.FILES.put(key, bytes, { onlyIf: new Headers({ 'if-none-match': '*' }), httpMetadata: { contentType: 'image/png' },
          customMetadata: { freeImageSource: sourceIdentity(source), freeImageOutputSha256: sha256, imageValidation: 'header-v1', imageWidth: String(dimensions.width), imageHeight: String(dimensions.height) } });
        if (!saved && !await storedOutput(key, source, sha256, bytes.length)) throw Error('Image upload was not confirmed.');
      } catch (error) {
        // A failed acknowledgement may follow a committed R2 put. Verify bytes
        // and metadata before continuing; never overwrite or delete that object.
        if (!await storedOutput(key, source, sha256, bytes.length)) throw error;
      }
    }
    await freshSource(owner, id, source);
    // The DB guard checks both original keys and revisions atomically. An R2
    // object can remain unattached after a conflict and be reused safely later.
    try {
      const saved = await attachProductDocument(owner, { productId: id, expectedVersion: source.productVersion, expectedContentRevision: source.contentRevision,
        previousImageKeys: current.product.image_keys, imageKeys, content: next, productVersion: now, contentMutated: true });
      if (saved) return response({ source, key, productVersion: saved.productVersion, contentRevision: saved.content.revision, applied: true });
      const committed = await replay(owner, id, source, key, sha256, bytes.length);
      if (committed) return committed;
      throw changed();
    } catch (error) {
      const committed = await replay(owner, id, source, key, sha256, bytes.length);
      if (committed) return committed;
      throw error;
    }
  } catch (error) { return fail(error); }
}
