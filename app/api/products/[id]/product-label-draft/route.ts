import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { GET as productLabelsGET } from '@/app/api/products/[id]/product-labels/route';
import { GET as translationSourceGET } from '@/app/api/products/[id]/translation-source/route';
import { readQuotationExportSource, resolveQuotationExport, QuotationExportError } from '@/app/exports/quotation-source';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import { productLabelsSourcesCurrent } from '@/db/product-labels';
import { reserveQuotationAiRequest } from '@/db/quotation-ai-jobs';
import { fingerprint } from '@/app/automation/model';
import { verifyProductLabelsView, type ProductLabelsView } from '@/app/product-label';
import { buildProductLabelDraftPlan, executeProductLabelDraft, parseProductLabelDraftRequest, verifyProductLabelDraftResult,
  ProductLabelDraftError, type ProductLabelDraftSource } from '@/app/product-label-draft';

type Context = { params: Promise<{ id: string }> };
type AiEnvironment = { AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  SOURCEFLOW_QUOTATION_AI_PROVIDER?: string; SOURCEFLOW_QUOTATION_AI_FREE_ONLY?: string };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const changed = () => new ProductLabelDraftError('PRODUCT_LABEL_DRAFT_SOURCE_CHANGED', '상품·옵션·회사·카테고리 또는 표시사항 저장값이 변경되었습니다. 현재 입력을 유지하고 새 저장값을 확인해주세요.');
function configuration() {
  const settings = env as AiEnvironment;
  return settings.SOURCEFLOW_QUOTATION_AI_PROVIDER === 'workers-ai' && settings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY === 'true'
    && typeof settings.AI?.run === 'function';
}
async function authorization() {
  const user = await getChatGPTUser(), owner = await getWorkspaceOwnerId(), company = approvedSupplierHubCompany(user?.membership);
  if (!user?.verifiedAccess || user.userId !== owner || user.membership?.id !== owner || !company || !['admin', 'member'].includes(user.membership.role))
    throw new QuotationExportError('승인된 회원으로 로그인해주세요.', 403);
  return { owner, company: { ...company }, member: { id: user.membership.id, email: user.membership.email, role: user.membership.role } };
}
async function currentAuthorization(expected: Awaited<ReturnType<typeof authorization>>) {
  return same(await authorization(), expected);
}
function selection(request: Request) {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => key !== 'profileId') || query.getAll('profileId').length > 1
    || query.has('profileId') && !safeId(query.get('profileId'))) throw new QuotationExportError('카테고리 양식 선택을 확인해주세요.', 400);
  return query.get('profileId');
}
async function snapshot(auth: Awaited<ReturnType<typeof authorization>>, id: string, profileId: string | null, request: Request, optionId: string | null) {
  const url = new URL(`/api/products/${encodeURIComponent(id)}/product-labels`, request.url);
  if (profileId) url.searchParams.set('profileId', profileId);
  const response = await productLabelsGET(new Request(url, { headers: request.headers }), { params: Promise.resolve({ id }) });
  const view = await response.json() as ProductLabelsView & { error?: string; code?: string };
  if (!response.ok) throw new QuotationExportError(view.error || '저장된 표시사항을 확인하지 못했습니다.', response.status);
  try { verifyProductLabelsView(view, optionId, profileId ?? undefined); } catch { throw changed(); }
  const saved = await readQuotationExportSource(auth.owner, id, profileId);
  if (!saved.company || !same(saved.company, auth.company) || view.productVersion !== saved.product.updated_at
    || view.contentRevision !== saved.content.revision || view.optionRevision !== saved.options.revision
    || view.quotationRevision !== saved.state.revision || !same(view.categoryContext, saved.categoryContext)) throw changed();
  let original: { title: string; description: string; attributes: { name: string; value: string }[] };
  if (saved.source.collection?.snapshot?.linked) {
    const sourceUrl = new URL(`/api/products/${encodeURIComponent(id)}/translation-source`, request.url);
    const sourceResponse = await translationSourceGET(new Request(sourceUrl, { headers: request.headers }), { params: Promise.resolve({ id }) });
    const source = await sourceResponse.json() as { productId: string; productVersion: string; title: string; description: string; attributes: { name: string; value: string }[]; error?: string };
    if (!sourceResponse.ok) throw new QuotationExportError(source.error || '연결된 상품 원문을 확인하지 못했습니다.', sourceResponse.status);
    if (source.productId !== id || source.productVersion !== saved.product.updated_at) throw changed();
    original = { title: source.title, description: source.description, attributes: source.attributes };
  } else {
    // Older manually entered products have no fabricated supplier attributes.
    original = { title: saved.product.title, description: saved.content.detail?.description?.value ?? saved.content.seo.description.value, attributes: [] };
  }
  const selected = optionId === null ? null : saved.options.rows.find(row => row.id === optionId);
  if (optionId !== null && !selected) throw changed();
  const resolved = resolveQuotationExport(saved), titleTarget = exactPrimaryQuotationTarget(resolved.schema.fields, 'title');
  const productName = resolved.rows.find(row => row.optionId === optionId)?.fields[titleTarget.primary]?.value;
  if (typeof productName !== 'string') throw changed();
  const manualKeys = (['netContents', 'material', 'productType'] as const).filter(key => saved.content.label[key].provenance === 'manual');
  const facts: ProductLabelDraftSource = { originalTitle: original.title, productName,
    description: original.description, attributes: original.attributes, manualKeys,
    option: selected ? { optionId: selected.id, originalName: selected.originalName, translatedName: selected.translatedName, unitsPerPack: selected.unitsPerPack } : null };
  const source = { ...saved.source, quotationRevision: saved.state.revision };
  const signature = await fingerprint({ view, source, original, facts });
  if (!await productLabelsSourcesCurrent(auth.owner, id, source, view.revision)) throw changed();
  return { view, facts, source, signature };
}
export async function POST(request: Request, context: Context) {
  try {
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin)
      return json({ error: '같은 웹페이지에서 표시사항 초안을 생성해주세요.' }, 403);
    const body = parseProductLabelDraftRequest(await readBoundedJson(request, 4096)), profileId = selection(request);
    const auth = await authorization(), { id } = await context.params;
    if (!safeId(id)) return json({ error: '상품 식별값을 확인해주세요.' }, 400);
    if (!configuration()) return json({ error: '무료 표시사항 AI 설정을 확인해주세요.', code: 'PRODUCT_LABEL_DRAFT_NOT_CONFIGURED' }, 503);
    const before = await snapshot(auth, id, profileId, request, body.optionId);
    if (before.view.revision !== body.expectedRevision || before.view.inputFingerprint !== body.expectedInputFingerprint) throw changed();
    const plan = buildProductLabelDraftPlan(before.view, body.optionId, before.facts);
    if (!configuration() || !await currentAuthorization(auth) || !await productLabelsSourcesCurrent(auth.owner, id, before.source, before.view.revision)) throw changed();
    // This shared account-wide reservation is the only write: no product,
    // proposal, label, image or execution job is persisted by draft generation.
    if (!await reserveQuotationAiRequest()) return json({ error: '오늘의 무료 AI 요청 한도에 도달했습니다. 현재 입력은 유지됩니다.', code: 'PRODUCT_LABEL_DRAFT_LIMIT' }, 429);
    const result = await executeProductLabelDraft(plan, (env as AiEnvironment).AI!);
    const after = await snapshot(auth, id, profileId, request, body.optionId);
    if (after.signature !== before.signature || !await currentAuthorization(auth)) throw changed();
    return json(verifyProductLabelDraftResult(after.view, body.optionId, result));
  } catch (error) {
    if (error instanceof ProductLabelDraftError) return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof RequestBodyError || error instanceof QuotationExportError) return json({ error: error.message }, error.status);
    return json({ error: '표시사항 초안의 응답을 확인하지 못했습니다. 저장값은 유지되며 자동으로 재요청하지 않았습니다.', code: 'PRODUCT_LABEL_DRAFT_FAILED' }, 503);
  }
}
