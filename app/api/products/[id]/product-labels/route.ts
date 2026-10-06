import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct, getSettings } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { readProductOptions } from '@/db/product-options';
import { getCategoryProfile } from '@/db/category-profiles';
import { readQuotationCollectionSource } from '@/db/quotation-fields';
import { readProductLabels, productLabelsSourcesCurrent, saveProductLabels, type ProductLabelSourceGuard } from '@/db/product-labels';
import { applyProductLabelChanges, PRODUCT_LABEL_BODY_LIMIT, PRODUCT_LABEL_STORAGE_LIMIT, resolveProductLabels, validateProductLabelChanges, verifyProductLabelsView, type ProductLabelsView } from '@/app/product-label';
import { fingerprint } from '@/app/automation/model';
import { savedRegistrationSettings } from '@/app/workspace-settings';
import { collectionRegistrationSettings } from '@/app/collection-registration-settings';
import { parseCollectionRequest } from '@/app/sourcing';
import { productImageKeys } from '@/app/product-content';
import { isOwnedImageKey } from '@/app/image-files';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { GET as quotationFieldsGET } from '@/app/api/products/[id]/quotation-fields/route';

type Context = { params: Promise<{ id: string }> };
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'cache-control': 'no-store' } });
class LabelError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
const conflict = () => new LabelError('상품·옵션·설정·카테고리·견적 또는 표시사항 저장값이 변경되었습니다. 입력을 유지하고 최신 자료를 다시 확인해주세요.', 409, 'PRODUCT_LABELS_CONFLICT');
async function ownerId() {
  const user = await getChatGPTUser();
  if ((process.env.NODE_ENV === 'production' || (env as { YOOFAM_AUTH_ENABLED?: string }).YOOFAM_AUTH_ENABLED === 'true' || process.env.YOOFAM_AUTH_ENABLED === 'true') && !user?.verifiedAccess)
    throw new LabelError('운영 인증 연결 후 표시사항을 편집할 수 있습니다.', 503, 'AUTH_REQUIRED');
  return user?.verifiedAccess && user.userId ? user.userId : await getWorkspaceOwnerId();
}
function selection(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => key !== 'profileId') || params.getAll('profileId').length > 1) throw new LabelError('카테고리 양식 선택을 확인해주세요.', 400);
  const profileId = params.get('profileId');
  if (profileId !== null && !/^[A-Za-z0-9_-]{1,100}$/.test(profileId)) throw new LabelError('카테고리 양식 선택을 확인해주세요.', 400);
  return profileId;
}
async function snapshot(owner: string, id: string, profileId: string | null, request: Request) {
  if (!/^\w[\w-]{0,99}$/.test(id)) throw new LabelError('상품 식별값을 확인해주세요.', 400);
  const product = await findProduct(owner, id); if (!product) throw new LabelError('상품을 찾을 수 없습니다.', 404);
  const [content, options, savedSettings, state, profile] = await Promise.all([
    readProductContent(owner, id), readProductOptions(owner, id), getSettings(owner), readProductLabels(owner, id),
    profileId ? getCategoryProfile(owner, profileId) : Promise.resolve(null),
  ]);
  if (profileId && !profile) throw new LabelError('카테고리 양식을 찾을 수 없습니다.', 404);
  let settings = savedRegistrationSettings(savedSettings ? JSON.parse(savedSettings.payload) : null);
  let collection: ProductLabelSourceGuard['collection'] = null;
  let offerId: string | null = null;
  try { offerId = parseCollectionRequest({ urls: [product.source_url] })[0].offerId; } catch { /* Legacy sources have no fabricated collection context. */ }
  if (offerId) {
    const source = await readQuotationCollectionSource(owner, offerId, id); collection = { offerId, snapshot: source };
    if (source?.linked) settings = collectionRegistrationSettings(settings, JSON.parse(source.payload)?.settings);
  }
  // Reuse the actual category/company-aware quotation resolver read-only. This
  // gives the selected final SEO value without guessing legal notice identities
  // or maintaining a competing schema/default initialization path.
  const url = new URL(`/api/products/${encodeURIComponent(id)}/quotation-fields`, request.url);
  if (profileId) url.searchParams.set('profileId', profileId);
  const quotationResponse = await quotationFieldsGET(new Request(url, { headers: request.headers }), { params: Promise.resolve({ id }) });
  const quotation = await quotationResponse.json() as QuotationFieldsView & { error?: string; code?: string };
  if (!quotationResponse.ok) throw new LabelError(quotation.error || '선택한 카테고리의 견적 원천을 확인하지 못했습니다.', quotationResponse.status, quotation.code);
  const imageKeys = productImageKeys(product.image_keys).filter(key => isOwnedImageKey(owner, key));
  if (quotation.productVersion !== product.updated_at || quotation.contentRevision !== content.revision || quotation.optionRevision !== options.revision
    || JSON.stringify(quotation.imageKeys) !== JSON.stringify(imageKeys)) throw conflict();
  if (!quotation.categoryContext?.categoryId) throw new LabelError('상품에 맞는 카테고리를 선택한 뒤 표시사항을 작성해주세요.', 409, 'PRODUCT_LABELS_CATEGORY_REQUIRED');
  const source: ProductLabelSourceGuard = { productVersion: product.updated_at, imageKeys: product.image_keys, pricingPolicy: product.pricing_policy ?? null,
    contentRevision: content.revision, optionRevision: options.revision, quotationRevision: quotation.revision,
    settingsPayload: savedSettings?.payload ?? null, profile: profile ? { id: profile.id, revision: profile.revision } : null, collection };
  const rows = resolveProductLabels({ productId: id, state, content, options, quotation, settings });
  const inputFingerprint = await fingerprint({ recipe: 'product-label-source-v1', productId: id, source,
    quotationInputFingerprint: quotation.inputFingerprint, categoryContext: quotation.categoryContext, labelRevision: state.revision, overrides: state.overrides, rows });
  const view: ProductLabelsView = { productId: id, revision: state.revision, inputFingerprint, productVersion: product.updated_at,
    contentRevision: content.revision, optionRevision: options.revision, quotationRevision: quotation.revision,
    quotationInputFingerprint: quotation.inputFingerprint, categoryContext: quotation.categoryContext, imageKeys,
    overrides: state.overrides, rows, updatedAt: state.updatedAt };
  verifyProductLabelsView(view, null, profileId ?? undefined);
  if (!await productLabelsSourcesCurrent(owner, id, source, state.revision)) throw conflict();
  return { view, source, options };
}
function failure(error: unknown) {
  if (error instanceof LabelError) return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
  if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
  return json({ error: '표시사항 저장본을 읽거나 저장하지 못했습니다. 기존 내용과 입력은 유지됩니다.' }, 503);
}
export async function GET(request: Request, context: Context) {
  try { const owner = await ownerId(), { id } = await context.params; return json((await snapshot(owner, id, selection(request), request)).view); }
  catch (error) { return failure(error); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const owner = await ownerId();
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) throw new LabelError('같은 사이트에서 표시사항을 저장해주세요.', 400);
    const body = await readBoundedJson(request, PRODUCT_LABEL_BODY_LIMIT) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['expectedRevision', 'expectedInputFingerprint', 'changes'].includes(key))
      || !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0 || typeof body.expectedInputFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedInputFingerprint)) throw new LabelError('표시사항 저장 버전과 변경 내용을 확인해주세요.', 400);
    const { id } = await context.params, profileId = selection(request), current = await snapshot(owner, id, profileId, request);
    if (body.expectedRevision !== current.view.revision || body.expectedInputFingerprint !== current.view.inputFingerprint) throw conflict();
    let changes;
    try { changes = validateProductLabelChanges(body.changes, current.options.rows.map(option => option.id)); }
    catch (error) { throw new LabelError(error instanceof Error ? error.message : '변경한 표시사항 항목을 확인해주세요.', 400); }
    const overrides = applyProductLabelChanges(current.view.overrides, changes);
    if (new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, productId: id, revision: current.view.revision + 1, overrides, updatedAt: new Date().toISOString() })).length > PRODUCT_LABEL_STORAGE_LIMIT)
      throw new LabelError('표시사항 저장 한도 512KB를 초과했습니다. 긴 입력을 줄여주세요.', 413);
    if (!await saveProductLabels(owner, id, overrides, current.view.revision, current.source)) throw conflict();
    return json((await snapshot(owner, id, profileId, request)).view);
  } catch (error) { return failure(error); }
}
