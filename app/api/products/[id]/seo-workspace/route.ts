import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { productImageKeys } from '@/app/product-content';
import { applySeoWorkspaceChanges, SEO_WORKSPACE_BODY_LIMIT, SeoWorkspaceConflict, validateSeoWorkspaceInput, type SeoWorkspaceView } from '@/app/seo-workspace';
import { findProduct } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { readProductOptions } from '@/db/product-options';
import { readOptionSourceImages } from '@/db/collection-images';
import { saveSeoWorkspace } from '@/db/seo-workspace';

type Context = { params: Promise<{ id: string }> };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
async function snapshot(owner: string, id: string) {
  const product = await findProduct(owner, id, true);
  if (!product) return null;
  const [content, options] = await Promise.all([readProductContent(owner, id), readProductOptions(owner, id)]);
  const sourceImageKeys = await readOptionSourceImages(owner, product, options).catch(() => ({}));
  const current = await findProduct(owner, id, true);
  if (!current || current.updated_at !== product.updated_at || current.image_keys !== product.image_keys)
    throw new SeoWorkspaceConflict('조회 중 상품이 변경되었습니다. 수정한 입력은 유지하고 다시 확인해주세요.');
  const view: SeoWorkspaceView = { productId: id, productVersion: product.updated_at, content, options, imageKeys: productImageKeys(product.image_keys), sourceImageKeys };
  return { view, product };
}
async function authorized() { return process.env.NODE_ENV !== 'production' || (await getChatGPTUser())?.verifiedAccess; }
export async function GET(_request: Request, context: Context) {
  if (!await authorized()) return reply({ error: '운영 인증 연결을 확인해주세요.' }, 503);
  try {
    const value = await snapshot(await getWorkspaceOwnerId(), (await context.params).id);
    return value ? reply(value.view) : reply({ error: '상품을 찾을 수 없습니다.' }, 404);
  } catch (cause) { return reply({ error: cause instanceof SeoWorkspaceConflict ? cause.message : 'SEO 저장본을 불러오지 못했습니다.' }, cause instanceof SeoWorkspaceConflict ? 409 : 503); }
}
export async function PATCH(request: Request, context: Context) {
  if (!await authorized()) return reply({ error: '운영 인증 연결을 확인해주세요.' }, 503);
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return reply({ error: '같은 사이트에서 요청해주세요.' }, 400);
  let input;
  try { input = validateSeoWorkspaceInput(await readBoundedJson(request, SEO_WORKSPACE_BODY_LIMIT)); }
  catch (cause) { return reply({ error: cause instanceof Error ? cause.message : 'SEO 입력을 확인해주세요.' }, cause instanceof RequestBodyError ? cause.status : 400); }
  try {
    const owner = await getWorkspaceOwnerId(), value = await snapshot(owner, (await context.params).id);
    if (!value) return reply({ error: '상품을 찾을 수 없습니다.' }, 404);
    const now = new Date(Math.max(Date.now(), Date.parse(value.view.productVersion) + 1)).toISOString();
    let next;
    try { next = applySeoWorkspaceChanges(value.view, input, now); }
    catch (cause) { if (cause instanceof SeoWorkspaceConflict) throw cause; return reply({ error: cause instanceof Error ? cause.message : 'SEO 입력 연결을 확인해주세요.' }, 400); }
    return await saveSeoWorkspace(owner, value.view, next, input, value.product.image_keys) ? reply(next)
      : reply({ error: '저장 중 상품·SEO·옵션이 변경되었습니다. 입력을 유지하고 저장본을 확인해주세요.' }, 409);
  } catch (cause) { return reply({ error: cause instanceof SeoWorkspaceConflict ? cause.message : 'SEO 저장을 확인하지 못했습니다. 입력을 유지하고 저장본을 확인해주세요.' }, cause instanceof SeoWorkspaceConflict ? 409 : 503); }
}
