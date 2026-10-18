import { verifyProductLabelsView, type ProductLabelsView } from '@/app/product-label';

export type ProductLabelRewriteInput = { productId: string; optionId: string | null; endpoint: string; before: ProductLabelsView };
export class ProductLabelRewriteError extends Error { constructor(message: string, public uncertain: boolean) { super(message); } }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function scope(input: ProductLabelRewriteInput) {
  const url = new URL(input.endpoint, 'https://label.invalid');
  if (url.origin !== 'https://label.invalid' || url.pathname !== `/api/products/${encodeURIComponent(input.productId)}/product-labels` || url.hash
    || [...url.searchParams.keys()].some(key => key !== 'profileId') || url.searchParams.getAll('profileId').length > 1
    || url.searchParams.has('profileId') && !/^[A-Za-z0-9_-]{1,100}$/.test(url.searchParams.get('profileId')!)) throw Error('재작성할 상품·카테고리 연결을 확인해주세요.');
  const profileId = url.searchParams.get('profileId') ?? undefined;
  verifyProductLabelsView(input.before, input.optionId, profileId);
  if (input.before.productId !== input.productId) throw Error('재작성할 표시사항의 상품이 다릅니다.');
  return profileId;
}
export function verifyProductLabelRewrite(input: ProductLabelRewriteInput, next: ProductLabelsView) {
  verifyProductLabelsView(next, input.optionId, scope(input));
  const before = input.before;
  if (next.productId !== before.productId || next.revision !== before.revision + 1 || next.renderEpoch !== (before.renderEpoch ?? 0) + 1
    || next.updatedAt !== next.productVersion || Date.parse(next.productVersion) <= Date.parse(before.productVersion)
    || next.contentRevision !== before.contentRevision || next.optionRevision !== before.optionRevision || next.quotationRevision !== before.quotationRevision
    || !same(next.categoryContext, before.categoryContext) || !same(next.imageKeys, before.imageKeys) || !same(next.overrides, before.overrides)
    || !same(next.rows, before.rows) || !same(next.structure, before.structure))
    throw Error('표시사항 재작성 결과가 요청한 범위와 다릅니다. 저장본을 다시 확인해주세요.');
}
async function read(input: ProductLabelRewriteInput, request: typeof fetch) {
  const response = await request(input.endpoint, { cache: 'no-store' }), body = await response.json() as ProductLabelsView & { error?: string };
  if (!response.ok) throw Error(body.error || '표시사항 재작성 결과를 조회하지 못했습니다.');
  verifyProductLabelsView(body, input.optionId, scope(input));
  if (body.productId !== input.productId) throw Error('재작성 결과의 상품을 확인해주세요.');
  return body;
}
/** Explicit result lookup is read only, including a request that never committed. */
export async function readProductLabelRewrite(input: ProductLabelRewriteInput, request: typeof fetch = fetch) {
  scope(input);
  const view = await read(input, request);
  if (same(view, input.before)) return { status: 'unchanged' as const, view };
  verifyProductLabelRewrite(input, view);
  return { status: 'rewritten' as const, view };
}
/** Reset generation eligibility only; contents, structure and final references
 * remain stored. A lost response is inspected before another explicit action. */
export async function rewriteProductLabels(input: ProductLabelRewriteInput, request: typeof fetch = fetch): Promise<ProductLabelsView> {
  const initial = await readProductLabelRewrite(input, request);
  if (initial.status === 'rewritten') return initial.view;
  let response: Response | undefined;
  try {
    response = await request(input.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: input.before.revision, expectedInputFingerprint: input.before.inputFingerprint }) });
    const body = await response.json() as ProductLabelsView & { error?: string };
    if (!response.ok) throw Error(body.error || '제품 표시사항을 재작성 상태로 바꾸지 못했습니다.');
    verifyProductLabelRewrite(input, body);
    const confirmed = await readProductLabelRewrite(input, request);
    if (confirmed.status !== 'rewritten' || !same(body, confirmed.view)) throw Error('표시사항 재작성 응답과 실제 저장본이 다릅니다.');
    return confirmed.view;
  } catch (cause) {
    // Even a non-success response can follow a committed write when the
    // server's final snapshot fails. Only an exact unchanged GET clears this.
    let uncertain = true;
    try {
      const recovered = await readProductLabelRewrite(input, request);
      if (recovered.status === 'rewritten') return recovered.view;
      uncertain = false;
    } catch { /* Never repeat the POST to resolve an ambiguous result. */ }
    throw new ProductLabelRewriteError(cause instanceof Error ? cause.message : '표시사항 재작성 결과를 확인하지 못했습니다.', uncertain);
  }
}
