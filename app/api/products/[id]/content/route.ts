import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct } from '@/db/queries';
import { readProductContent, saveProductContent } from '@/db/product-content';
import { CONTENT_BODY_LIMIT, applyContentPatch, productImageKeys, validateContentInput } from '@/app/product-content';

type Context = { params: Promise<{ id: string }> };
function unavailable() { return NextResponse.json({ error: '운영 인증 연결 후 콘텐츠 편집을 사용할 수 있습니다.' }, { status: 503 }); }
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(_: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return unavailable();
  const owner = await getWorkspaceOwnerId();
  const { id } = await context.params;
  try {
    if (!await findProduct(owner, id)) return response({ error: '상품을 찾을 수 없습니다.' }, 404);
    return response({ content: await readProductContent(owner, id) });
  } catch { return response({ error: '저장한 콘텐츠를 불러오지 못했습니다.' }, 503); }
}

async function readInput(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('JSON 형식으로 요청해주세요.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('저장할 내용이 없습니다.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > CONTENT_BODY_LIMIT) { await reader.cancel(); throw new RangeError('편집 내용은 96KB 이하로 저장해주세요.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new Error('올바른 JSON 객체가 필요합니다.'); }
}

export async function PATCH(request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return unavailable();
  let input: unknown;
  try { input = await readInput(request); }
  catch (error) { return response({ error: error instanceof Error ? error.message : '입력을 확인해주세요.' }, error instanceof RangeError ? 413 : 400); }
  const owner = await getWorkspaceOwnerId();
  const { id } = await context.params;
  try {
    const product = await findProduct(owner, id);
    if (!product) return response({ error: '상품을 찾을 수 없습니다.' }, 404);
    let validated;
    try { validated = validateContentInput(input, productImageKeys(product.image_keys), owner); }
    catch (error) { return response({ error: error instanceof Error ? error.message : '편집 내용을 확인해주세요.' }, 400); }
    const current = await readProductContent(owner, id);
    if (current.revision !== validated.expectedRevision) return response({ error: '다른 편집 내용이 저장되었습니다. 입력 내용을 복사한 후 저장본을 다시 불러와주세요.', code: 'CONTENT_CONFLICT' }, 409);
    let next;
    try { next = applyContentPatch(current, validated.patch, new Date().toISOString()); }
    catch (error) { return response({ error: error instanceof Error ? error.message : '편집 내용을 확인해주세요.' }, 400); }
    const assigned = Object.values(next.assets).flatMap(field => field.value);
    const ownedKeys = productImageKeys(product.image_keys);
    if (assigned.some(key => !ownedKeys.includes(key) || !key.startsWith(`${owner}/`))) return response({ error: '제거된 이미지가 지정되어 있습니다. 이미지 역할을 수정해주세요.' }, 400);
    if (validated.patch.assets) {
      if (assigned.length && !env.FILES) return response({ error: '이미지 저장소가 연결되지 않았습니다.' }, 503);
      const objects = await Promise.all(assigned.map(key => env.FILES.head(key)));
      if (objects.some(value => !value)) return response({ error: '이미지 파일이 저장소에 없습니다. 다시 업로드해주세요.' }, 400);
      if (objects.some(value => !/^image\/(png|jpeg|webp|gif|avif)$/i.test(value?.httpMetadata?.contentType ?? ''))) return response({ error: 'PNG·JPEG·WebP·GIF·AVIF 이미지만 자료에 지정할 수 있습니다.' }, 400);
    }
    const saved = await saveProductContent(owner, next, validated.expectedRevision, validated.patch.assets ? product.image_keys : undefined);
    return saved ? response({ content: saved }) : response({ error: '동시에 변경된 콘텐츠입니다. 저장본을 다시 불러와주세요.', code: 'CONTENT_CONFLICT' }, 409);
  } catch { return response({ error: '콘텐츠를 저장하지 못했습니다. 입력 내용은 유지됩니다. 저장본을 확인한 후 다시 시도해주세요.' }, 503); }
}
