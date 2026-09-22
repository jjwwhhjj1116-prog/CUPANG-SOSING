import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct, getSettings, type ProductRecord } from '@/db/queries';
import { productImageKeys } from '@/app/product-content';
import { readProductOptions, saveProductOptions } from '@/db/product-options';
import { OPTIONS_BODY_LIMIT, applyOptionRows, calculateOptionPrices, resolveOptionPricePolicy, validateOptionsInput, type ProductOptions } from '@/app/product-options';

type Context = { params: Promise<{ id: string }> };
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
const closed = () => response({ error: '운영 인증 연결 후 옵션 편집을 사용할 수 있습니다.' }, 503);
async function pricing(owner: string, product: ProductRecord, options: ProductOptions) {
  const settings = product.pricing_policy ? null : await getSettings(owner);
  const resolved = resolveOptionPricePolicy(product, settings ? JSON.parse(settings.payload) : undefined);
  return { ...resolved, rows: calculateOptionPrices(options.rows, resolved.policy) };
}
export async function GET(_: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return closed();
  const owner = await getWorkspaceOwnerId(); const { id } = await context.params;
  try {
    const product = await findProduct(owner, id);
    if (!product) return response({ error: '상품을 찾을 수 없습니다.' }, 404);
    const options = await readProductOptions(owner, id);
    return response({ options, pricing: await pricing(owner, product, options), productVersion: product.updated_at });
  } catch { return response({ error: '옵션과 가격 설정을 불러오지 못했습니다.' }, 503); }
}
async function input(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('JSON 형식으로 요청해주세요.');
  const reader = request.body?.getReader(); if (!reader) throw new Error('옵션 내용을 입력해주세요.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > OPTIONS_BODY_LIMIT) { await reader.cancel(); throw new RangeError('옵션 편집 내용은 512KB 이하여야 합니다.'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; } catch { throw new Error('올바른 JSON 객체가 필요합니다.'); }
}
export async function PATCH(request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return closed();
  let body: unknown; try { body = await input(request); } catch (error) { return response({ error: error instanceof Error ? error.message : '입력을 확인해주세요.' }, error instanceof RangeError ? 413 : 400); }
  const owner = await getWorkspaceOwnerId(); const { id } = await context.params;
  try {
    const product = await findProduct(owner, id); if (!product) return response({ error: '상품을 찾을 수 없습니다.' }, 404);
    let validated; try { validated = validateOptionsInput(body, owner, productImageKeys(product.image_keys)); }
    catch (error) { return response({ error: error instanceof Error ? error.message : '옵션 내용을 확인해주세요.' }, 400); }
    const current = await readProductOptions(owner, id);
    if (current.revision !== validated.expectedRevision || product.updated_at !== validated.expectedProductVersion) return response({ error: '상품 또는 옵션이 변경되었습니다. 입력을 보관한 뒤 저장본을 다시 불러와주세요.', code: 'OPTIONS_CONFLICT' }, 409);
    const version = new Date(Math.max(Date.now(), Date.parse(product.updated_at) + 1)).toISOString();
    const next = applyOptionRows(current, validated.rows, version);
    const calculations = await pricing(owner, product, next);
    if (calculations.rows.some(row => row.error)) return response({ error: '포함한 옵션 가격을 계산할 수 없습니다. 원가·수량·가격 설정을 확인해주세요.' }, 400);
    const keys = [...new Set(next.rows.flatMap(row => row.imageKey ? [row.imageKey] : []))];
    if (keys.length && !env.FILES) return response({ error: '이미지 저장소가 연결되지 않았습니다.' }, 503);
    const files = await Promise.all(keys.map(key => env.FILES.head(key)));
    if (files.some(file => !file)) return response({ error: '옵션 이미지가 저장소에 없습니다. 이미지 연결을 수정해주세요.' }, 400);
    if (files.some(file => !/^image\/(png|jpeg|webp|gif|avif)$/i.test(file?.httpMetadata?.contentType ?? ''))) return response({ error: '지원하는 이미지 파일만 옵션에 연결할 수 있습니다.' }, 400);
    const saved = await saveProductOptions(owner, next, current.revision, product.updated_at);
    return saved ? response({ options: saved, pricing: calculations, productVersion: version }) : response({ error: '저장 중 상품 또는 옵션이 변경되었습니다. 저장본을 다시 불러와주세요.', code: 'OPTIONS_CONFLICT' }, 409);
  } catch { return response({ error: '옵션을 저장하지 못했습니다. 입력 내용은 유지됩니다. 저장본을 확인한 후 다시 시도해주세요.' }, 503); }
}
