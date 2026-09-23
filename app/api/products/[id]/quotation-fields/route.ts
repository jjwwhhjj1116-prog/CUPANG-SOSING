import { scopedQuotationOverrides, hasLegacyQuotationOverrides } from '@/app/quotation-scopes';
import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct, getSettings } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { readProductOptions } from '@/db/product-options';
import { getCategoryProfile } from '@/db/category-profiles';
import { readQuotationFields, readQuotationCollectionSource, quotationSourcesCurrent, saveQuotationFields, type QuotationSourceGuard } from '@/db/quotation-fields';
import { applyQuotationChanges, resolveQuotationFields, validateQuotationChanges, type QuotationFieldsView } from '@/app/quotation-schema';
import { savedRegistrationSettings } from '@/app/workspace-settings';
import { validateCategoryProfile } from '@/app/category-profiles';
import { productImageKeys } from '@/app/product-content';
import { isOwnedImageKey } from '@/app/image-files';
import { parseCollectionRequest } from '@/app/sourcing';
import { fingerprint } from '@/app/automation/model';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';

type Context = { params: Promise<{ id: string }> };
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'cache-control': 'no-store' } });
class FieldsError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
const changed = () => new FieldsError('상품·옵션·설정·카테고리 또는 다른 편집 내용이 바뀌었습니다. 입력한 수정값을 보존한 채 최신 자료를 다시 불러와 비교해주세요.', 409, 'QUOTATION_FIELDS_CONFLICT');
function profileSelection(request: Request) {
  const value = new URL(request.url).searchParams.get('profileId');
  if (value !== null && !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new FieldsError('카테고리 프로필 선택을 확인해주세요.', 400);
  return value;
}
async function snapshot(owner: string, id: string, profileId: string | null) {
  const product = await findProduct(owner, id);
  if (!product) throw new FieldsError('상품을 찾을 수 없습니다.', 404);
  const [content, options, savedSettings, state, profile] = await Promise.all([
    readProductContent(owner, id), readProductOptions(owner, id), getSettings(owner), readQuotationFields(owner, id),
    profileId ? getCategoryProfile(owner, profileId) : Promise.resolve(null),
  ]);
  if (profileId && !profile) throw new FieldsError('카테고리 프로필을 찾을 수 없습니다.', 404);
  const settings = savedRegistrationSettings(savedSettings ? JSON.parse(savedSettings.payload) : null);
  const imageKeys = productImageKeys(product.image_keys).filter(key => isOwnedImageKey(owner, key));
  let categoryContext: QuotationFieldsView['categoryContext'] = { source: 'unknown', profileId: null, categoryId: null, categoryPath: [] };
  let collection: QuotationSourceGuard['collection'] = null;
  if (profile) categoryContext = { source: 'profile', profileId: profile.id, categoryId: profile.categoryId || null, categoryPath: [...profile.categoryPath] };
  else {
    let offerId: string | null = null;
    try { offerId = parseCollectionRequest({ urls: [product.source_url] })[0].offerId; } catch { /* Legacy non-product URLs have no inferred category. */ }
    if (offerId) {
      const source = await readQuotationCollectionSource(owner, offerId, id); collection = { offerId, snapshot: source };
      const captured = source ? JSON.parse(source.payload) : null;
      if (captured?.category) {
        const category = validateCategoryProfile(captured.category);
        categoryContext = { source: 'collection', profileId: typeof captured.category.id === 'string' ? captured.category.id : null,
          categoryId: category.categoryId || null, categoryPath: [...category.categoryPath] };
      }
    }
  }
  const source: QuotationSourceGuard = { productVersion: product.updated_at, imageKeys: product.image_keys, pricingPolicy: product.pricing_policy ?? null,
    contentRevision: content.revision, optionRevision: options.revision, settingsPayload: savedSettings?.payload ?? null,
    profile: profile ? { id: profile.id, revision: profile.revision } : null, collection };
  const inputs = { categoryId: categoryContext.categoryId, categoryPath: categoryContext.categoryPath, product, content, options, settings };
  const automatic = resolveQuotationFields(inputs);
  const overrides = scopedQuotationOverrides(state, categoryContext.categoryId);
  const resolved = resolveQuotationFields({ ...inputs, overrides });
  if (categoryContext.categoryId && hasLegacyQuotationOverrides(state)) resolved.issues.push('분류가 기록되지 않은 이전 수정값은 자동 적용하지 않았습니다. 자료 다운로드의 quotation-saved-scopes.json에 보존됩니다.');
  const inputFingerprint = await fingerprint({ inputs, schema: automatic.schema, categoryContext, profileRevision: profile?.revision ?? null, settingsPayload: source.settingsPayload, collection });
  const view: QuotationFieldsView = { revision: state.revision, inputFingerprint, overrides, legacyOverrides: categoryContext.categoryId ? state.overrides : undefined, resolved, automatic, categoryContext,
    productVersion: product.updated_at, contentRevision: content.revision, optionRevision: options.revision, imageKeys, updatedAt: state.updatedAt, submissionReady: false };
  return { view, source, options };
}
async function stableView(owner: string, id: string, profileId: string | null) {
  const saved = await snapshot(owner, id, profileId);
  if (!await quotationSourcesCurrent(owner, id, saved.source)) throw changed();
  return saved;
}
function failure(error: unknown) {
  if (error instanceof FieldsError) return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
  if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
  return json({ error: '견적서 자동 입력 자료와 수정값을 읽거나 저장하지 못했습니다.' }, 503);
}
export async function GET(request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결 후 견적서를 편집할 수 있습니다.' }, 503);
  try {
    const owner = await getWorkspaceOwnerId(); const { id } = await context.params;
    return json((await stableView(owner, id, profileSelection(request))).view);
  } catch (error) { return failure(error); }
}
export async function PUT(request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결 후 견적서를 편집할 수 있습니다.' }, 503);
  try {
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) throw new FieldsError('같은 사이트에서 저장해주세요.', 400);
    const body = await readBoundedJson(request, 512 * 1024) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['expectedRevision', 'expectedInputFingerprint', 'changes'].includes(key)) ||
      !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0 || typeof body.expectedInputFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedInputFingerprint)) throw new FieldsError('저장 버전과 변경 내용을 확인해주세요.', 400);
    const owner = await getWorkspaceOwnerId(); const { id } = await context.params; const profileId = profileSelection(request);
    const saved = await stableView(owner, id, profileId);
    if (saved.view.revision !== body.expectedRevision || saved.view.inputFingerprint !== body.expectedInputFingerprint) throw changed();
    let changes;
    try { changes = validateQuotationChanges(body.changes, { schema: saved.view.resolved.schema, optionIds: saved.options.rows.map(option => option.id), ownedImageKeys: saved.view.imageKeys, overrides: saved.view.overrides }); }
    catch (error) { throw new FieldsError(error instanceof Error ? error.message : '변경한 견적서 필드를 확인해주세요.', 400); }
    const overrides = applyQuotationChanges(saved.view.overrides, changes);
    if (new TextEncoder().encode(JSON.stringify(overrides)).length > 500 * 1024) throw new FieldsError('수동 수정 자료가 저장 한도를 초과했습니다. 긴 내용을 줄여주세요.', 413);
    const stored = await saveQuotationFields(owner, id, overrides, saved.view.revision, saved.source, saved.view.categoryContext.categoryId);
    if (!stored) throw changed();
    return json((await stableView(owner, id, profileId)).view);
  } catch (error) { return failure(error); }
}
