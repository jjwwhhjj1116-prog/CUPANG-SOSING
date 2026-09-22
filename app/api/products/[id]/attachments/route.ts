import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { readProductOptions } from '@/db/product-options';
import { attachProductDocument } from '@/db/product-attachments';
import { applyContentPatch, productImageKeys } from '@/app/product-content';
import { imageFileType, isOwnedImageKey, MAX_IMAGE_BYTES } from '@/app/image-files';
import { readBoundedJson, readBoundedStream, RequestBodyError } from '@/app/request-body';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결 후 이미지를 첨부할 수 있습니다.' }, 503);
  try {
    const owner = await getWorkspaceOwnerId(); const { id } = await context.params;
    const value = await readBoundedJson(request, 4096);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return json({ error: '첨부 정보를 확인해주세요.' }, 400);
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some(key => !['key', 'expectedVersion', 'role', 'expectedContentRevision', 'expectedOptionRevision'].includes(key))
      || !isOwnedImageKey(owner, input.key) || (input.role !== null && !['label', 'size'].includes(String(input.role)))
      || typeof input.expectedVersion !== 'string' || !Number.isFinite(Date.parse(input.expectedVersion))
      || !Number.isSafeInteger(input.expectedContentRevision) || (input.expectedContentRevision as number) < 0) return json({ error: '이미지 소유자·역할·저장 버전을 확인해주세요.' }, 400);
    const role = input.role as 'label' | 'size' | null; const key = input.key;
    if ((role === 'size' || input.expectedOptionRevision !== undefined) && (!Number.isSafeInteger(input.expectedOptionRevision) || (input.expectedOptionRevision as number) < 0)) return json({ error: '사이즈표 생성에 사용한 옵션 저장 버전을 확인해주세요.' }, 400);
    const product = await findProduct(owner, id); if (!product) return json({ error: '상품을 찾을 수 없습니다.' }, 404);
    const content = await readProductContent(owner, id);
    if (product.updated_at !== input.expectedVersion || content.revision !== input.expectedContentRevision) return json({ error: '이미지를 만드는 동안 상품 자료가 변경되었습니다. 최신 저장값으로 다시 만들어주세요.' }, 409);
    // Reading options also ensures its table exists before the atomic DB guard.
    if (role === 'size' && (await readProductOptions(owner, id)).revision !== input.expectedOptionRevision) return json({ error: '사이즈표를 만든 뒤 옵션이 변경되었습니다. 최신 저장값으로 다시 만들어주세요.' }, 409);
    const previousKeys = productImageKeys(product.image_keys);
    const imageKeys = [...new Set([...previousKeys, key])];
    const roleKeys = role === null ? [] : [...new Set([...content.assets[role].value, key])];
    if (imageKeys.length > 50 || roleKeys.length > 30) return json({ error: '상품 이미지는 최대 50개, 표시사항·사이즈표는 역할마다 최대 30개입니다.' }, 400);
    if (role !== null && Object.entries(content.assets).some(([name, field]) => name !== role && field.value.includes(key))) return json({ error: '이미 다른 역할에 연결한 파일입니다.' }, 400);
    if (!env.FILES) return json({ error: '이미지 저장소가 연결되지 않았습니다.' }, 503);
    const object = await env.FILES.get(key, { range: { offset: 0, length: 1024 } });
    if (!object || object.size < 1 || object.size > MAX_IMAGE_BYTES) return json({ error: '업로드한 이미지가 없거나 크기가 올바르지 않습니다.' }, 400);
    try { imageFileType(await readBoundedStream(object.body, 1024)); } catch { return json({ error: '지원하는 이미지 파일만 문서 자료에 연결할 수 있습니다.' }, 400); }
    const now = new Date(Math.max(Date.now(), Date.parse(product.updated_at) + 1)).toISOString();
    const next = role === null ? content : applyContentPatch(content, { assets: { [role]: roleKeys } }, now);
    const saved = await attachProductDocument(owner, { productId: id, expectedVersion: product.updated_at, expectedContentRevision: content.revision,
      previousImageKeys: product.image_keys, imageKeys, content: next, productVersion: now, contentMutated: role !== null,
      ...(role === 'size' ? { expectedOptionRevision: input.expectedOptionRevision as number } : {}) });
    return saved ? json(saved) : json({ error: '저장 중 상품 자료가 변경되었습니다. 최신 저장값으로 다시 만들어주세요.' }, 409);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
    return json({ error: '이미지 첨부 연결을 저장하지 못했습니다. 기존 자료는 유지됩니다.' }, 503);
  }
}
