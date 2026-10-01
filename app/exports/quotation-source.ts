import { collectionRegistrationSettings } from '@/app/collection-registration-settings';
import { scopedQuotationOverrides, hasLegacyQuotationOverrides } from '@/app/quotation-scopes';
import { findProduct, getSettings } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { readProductOptions } from '@/db/product-options';
import { getCategoryProfile } from '@/db/category-profiles';
import { readQuotationFields, readQuotationCollectionSource, quotationSourcesCurrent, type QuotationSourceGuard } from '@/db/quotation-fields';
import { getQuotationSchema, resolveQuotationFields, type QuotationFieldsView } from '@/app/quotation-schema';
import { savedRegistrationSettings } from '@/app/workspace-settings';
import { validateCategoryProfile } from '@/app/category-profiles';
import { parseCollectionRequest } from '@/app/sourcing';
import { fingerprint } from '@/app/automation/model';
import { validateCategoryIdentity } from '@/app/category-identity';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import { publicDetailVersion, type PublicDetailConfig } from '@/app/quotation-public-detail';
import { optionPriceCalculationRevision } from '@/app/product-options';

export class QuotationExportError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** A saved-source snapshot shared by both downloads. No automatic values are written back. */
export async function readQuotationExportSource(owner: string, productId: string, profileId: string | null) {
  const user = await getChatGPTUser();
  const company = user?.verifiedAccess && user.userId === owner ? approvedSupplierHubCompany(user.membership) : null;
  const product = await findProduct(owner, productId);
  if (!product) throw new QuotationExportError('상품을 찾을 수 없습니다.', 404);
  const [content, options, savedSettings, state, profile] = await Promise.all([
    readProductContent(owner, productId), readProductOptions(owner, productId), getSettings(owner), readQuotationFields(owner, productId),
    profileId ? getCategoryProfile(owner, profileId) : Promise.resolve(null),
  ]);
  if (profileId && !profile) throw new QuotationExportError('카테고리 연결을 찾을 수 없습니다.', 404);
  let settings = savedRegistrationSettings(savedSettings ? JSON.parse(savedSettings.payload) : null);
  let categoryContext: QuotationFieldsView['categoryContext'] = { source: 'unknown', profileId: null, categoryId: null, categoryPath: [] };
  let collection: QuotationSourceGuard['collection'] = null;
  if (profile) categoryContext = { source: 'profile', profileId: profile.id, categoryId: profile.categoryId || null, categoryPath: [...profile.categoryPath] };
  {
    let offerId: string | null = null;
    try { offerId = parseCollectionRequest({ urls: [product.source_url] })[0].offerId; } catch { /* No inferred category for legacy/non-product URLs. */ }
    if (offerId) {
      const captured = await readQuotationCollectionSource(owner, offerId, productId); collection = { offerId, snapshot: captured };
      const payload = captured ? JSON.parse(captured.payload) : null;
      if (captured?.linked) settings = collectionRegistrationSettings(settings, payload?.settings);
      if (captured?.linked && profile) {
        const selected = payload?.category ? validateCategoryProfile(payload.category) : null;
        if (!selected || payload.category.id !== profile.id || selected.categoryId !== profile.categoryId
          || JSON.stringify(selected.categoryPath) !== JSON.stringify(profile.categoryPath)) {
          throw new QuotationExportError('상품 추가 시 선택한 카테고리와 견적서 양식이 다릅니다. 선택한 카테고리 양식을 사용해주세요.', 409);
        }
      }
      if (!profile && payload?.category) {
        const category = validateCategoryProfile(payload.category);
        categoryContext = { source: 'collection', profileId: typeof payload.category.id === 'string' ? payload.category.id : null,
          categoryId: category.categoryId || null, categoryPath: [...category.categoryPath] };
      }
    }
  }
  if (categoryContext.categoryId) {
    try { validateCategoryIdentity({ categoryId: categoryContext.categoryId, categoryPath: categoryContext.categoryPath }); }
    catch (error) { throw new QuotationExportError(error instanceof Error ? error.message : '카테고리 연결을 확인해주세요.', 409); }
  }
  const source: QuotationSourceGuard = { productVersion: product.updated_at, imageKeys: product.image_keys, pricingPolicy: product.pricing_policy ?? null,
    contentRevision: content.revision, optionRevision: options.revision, settingsPayload: savedSettings?.payload ?? null,
    profile: profile ? { id: profile.id, revision: profile.revision } : null, collection };
  // This also detects changes during the independent source reads before any R2 work starts.
  if (!await quotationSourcesCurrent(owner, productId, source)) throw new QuotationExportError('자료를 읽는 동안 변경이 발생했습니다. 저장 완료 후 다시 검토해주세요.', 409);
  return { product, content, options, settings, state: { ...state, overrides: scopedQuotationOverrides(state, categoryContext.categoryId) }, savedScopes: state, profile, categoryContext, source, company };
}
export type QuotationExportSource = Awaited<ReturnType<typeof readQuotationExportSource>>;
/** Resolve only the profile captured when this product was collected; never guess by label. */
export async function readMappedQuotationSource(owner: string, productId: string, profileId: string | null) {
  const captured = await readQuotationExportSource(owner, productId, null);
  const context = captured.categoryContext;
  const linked = Boolean(captured.source.collection?.snapshot?.linked);
  const selectedProfileId = profileId || context.profileId;
  if (!selectedProfileId || (!profileId && !context.categoryId)) throw new QuotationExportError('상품 추가 시 선택한 카테고리 양식이 없습니다. 견적서에서 사용할 양식을 선택해주세요.', 409);
  if (linked && selectedProfileId !== context.profileId) {
    throw new QuotationExportError('상품 추가 시 선택한 카테고리와 견적서 양식이 다릅니다. 선택한 카테고리 양식을 사용해주세요.', 409);
  }
  const saved = await readQuotationExportSource(owner, productId, selectedProfileId);
  if (JSON.stringify(saved.source.collection) !== JSON.stringify(captured.source.collection)
    || (linked && (saved.profile?.id !== context.profileId || saved.profile.categoryId !== context.categoryId
      || JSON.stringify(saved.profile.categoryPath) !== JSON.stringify(context.categoryPath)))) {
    throw new QuotationExportError('수집 당시 카테고리와 현재 양식이 달라졌습니다. 카테고리를 확인하고 다시 검사해주세요.', 409);
  }
  return saved;
}
export function resolveQuotationExport(saved: QuotationExportSource) {
  const resolved = resolveQuotationFields({ categoryId: saved.categoryContext.categoryId, categoryPath: saved.categoryContext.categoryPath,
    product: saved.product, content: saved.content, settings: saved.settings, options: saved.options, overrides: saved.state.overrides });
  if (saved.categoryContext.categoryId && saved.savedScopes && hasLegacyQuotationOverrides(saved.savedScopes)) resolved.issues.push('분류가 기록되지 않은 이전 수정값은 자동 적용하지 않았습니다. 자료 다운로드의 quotation-saved-scopes.json에 보존됩니다.');
  return resolved;
}
export async function quotationExportFingerprint(saved: QuotationExportSource, dataStartRow: number | null, detailConfig: PublicDetailConfig | null = null) {
  // Raw source/state payloads matter: an override reset and an equal-valued manual
  // override have different provenance, even when the visible cell is unchanged.
  return fingerprint({ format: 'sourceflow-quotation-fields-v1', saved, dataStartRow,
    schema: getQuotationSchema(saved.categoryContext.categoryId, saved.categoryContext.categoryPath),
    ...optionPriceCalculationRevision(saved.product, saved.options.rows, saved.settings, saved.state.overrides),
    ...(detailConfig ? { detailHtml: await publicDetailVersion(detailConfig) } : {}) });
}
