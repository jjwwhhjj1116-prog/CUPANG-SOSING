import { collectionRegistrationSettings } from '@/app/collection-registration-settings';
import { scopedQuotationOverrides, hasLegacyQuotationOverrides } from '@/app/quotation-scopes';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { findProduct, getSettings } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { readProductOptions } from '@/db/product-options';
import { getCategoryProfile } from '@/db/category-profiles';
import { readQuotationFields, readQuotationCollectionSource, quotationSourcesCurrent, type QuotationSourceGuard } from '@/db/quotation-fields';
import { resolveQuotationFields, type QuotationFieldsView } from '@/app/quotation-schema';
import { savedRegistrationSettings } from '@/app/workspace-settings';
import { validateCategoryProfile } from '@/app/category-profiles';
import { validateCategoryIdentity } from '@/app/category-identity';
import { productImageKeys } from '@/app/product-content';
import { isOwnedImageKey } from '@/app/image-files';
import { parseCollectionRequest } from '@/app/sourcing';
import { fingerprint } from '@/app/automation/model';
import { env } from 'cloudflare:workers';
import { publicDetailConfig, publicDetailVersion, resolvePublicDetail } from '@/app/quotation-public-detail';
import { optionPriceCalculationRevision } from '@/app/product-options';
import { savedProductFingerprintSettings } from '@/app/settings-fingerprint';
import { quotationNoticeBindingFingerprint } from '@/app/quotation-notice-inputs';
import { quotationPackagedWeightBindingFingerprint } from '@/app/quotation-packaged-weight';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';


export class QuotationFieldsSnapshotError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
const FieldsError = QuotationFieldsSnapshotError;
const changed = () => new FieldsError('상품·옵션·설정·카테고리 또는 다른 편집 내용이 바뀌었습니다. 입력한 수정값을 보존한 채 최신 자료를 다시 불러와 비교해주세요.', 409, 'QUOTATION_FIELDS_CONFLICT');
async function snapshot(owner: string, id: string, profileId: string | null) {
  const product = await findProduct(owner, id);
  if (!product) throw new FieldsError('상품을 찾을 수 없습니다.', 404);
  const [content, options, savedSettings, state, profile] = await Promise.all([
    readProductContent(owner, id), readProductOptions(owner, id), getSettings(owner), readQuotationFields(owner, id),
    profileId ? getCategoryProfile(owner, profileId) : Promise.resolve(null),
  ]);
  if (profileId && !profile) throw new FieldsError('카테고리 프로필을 찾을 수 없습니다.', 404);
  let settings = savedRegistrationSettings(savedSettings ? JSON.parse(savedSettings.payload) : null);
  const imageKeys = productImageKeys(product.image_keys).filter(key => isOwnedImageKey(owner, key));
  let categoryContext: QuotationFieldsView['categoryContext'] = { source: 'unknown', profileId: null, categoryId: null, categoryPath: [] };
  let collection: QuotationSourceGuard['collection'] = null;
  let hubSchema=profile?.hubSchema;
  if (profile) categoryContext = { source: 'profile', profileId: profile.id, categoryId: profile.categoryId || null, categoryPath: [...profile.categoryPath] };
  {
    let offerId: string | null = null;
    try { offerId = parseCollectionRequest({ urls: [product.source_url] })[0].offerId; } catch { /* Legacy non-product URLs have no inferred category. */ }
    if (offerId) {
      const source = await readQuotationCollectionSource(owner, offerId, id); collection = { offerId, snapshot: source };
      const captured = source ? JSON.parse(source.payload) : null;
      if (source?.linked) settings = collectionRegistrationSettings(settings, captured?.settings);
      if (source?.linked && profile) {
        const selected = captured?.category ? validateCategoryProfile(captured.category) : null;
        hubSchema=selected?.hubSchema;
        if (!selected || captured.category.id !== profile.id || selected.categoryId !== profile.categoryId
          || JSON.stringify(selected.categoryPath) !== JSON.stringify(profile.categoryPath)) {
          throw new FieldsError('상품 추가 시 선택한 카테고리와 견적서 양식이 다릅니다. 선택한 카테고리 양식을 사용해주세요.', 409, 'QUOTATION_CATEGORY_MISMATCH');
        }
      }
      if (!profile && captured?.category) {
        const category = validateCategoryProfile(captured.category);
        hubSchema=category.hubSchema;
        categoryContext = { source: 'collection', profileId: typeof captured.category.id === 'string' ? captured.category.id : null,
          categoryId: category.categoryId || null, categoryPath: [...category.categoryPath] };
      }
    }
  }
  // Editing and exporting must resolve the same approved company. Membership
  // reassignment cannot turn an older captured form into the new company's form.
  const user = await getChatGPTUser();
  const company = user?.verifiedAccess && user.userId === owner ? approvedSupplierHubCompany(user.membership) : null;
  if (company && [hubSchema, profile?.hubSchema].some(schema => schema && (schema.company.code !== company.code || schema.company.name !== company.name))) {
    throw new FieldsError('이 상품의 저장된 상세 양식 회사가 현재 로그인 회사와 다릅니다. 원래 회사의 상품과 양식을 사용해주세요.', 409, 'QUOTATION_COMPANY_MISMATCH');
  }
  if (categoryContext.categoryId) {
    try { validateCategoryIdentity({ categoryId: categoryContext.categoryId, categoryPath: categoryContext.categoryPath }); }
    catch (error) { throw new FieldsError(error instanceof Error ? error.message : '카테고리를 다시 선택해주세요.', 409, 'QUOTATION_CATEGORY_MISMATCH'); }
  }
  const source: QuotationSourceGuard = { productVersion: product.updated_at, imageKeys: product.image_keys, pricingPolicy: product.pricing_policy ?? null,
    contentRevision: content.revision, optionRevision: options.revision, settingsPayload: savedSettings?.payload ?? null,
    profile: profile ? { id: profile.id, revision: profile.revision } : null, collection };
  const inputs = { categoryId: categoryContext.categoryId, categoryPath: categoryContext.categoryPath, product, content, options, settings,...(hubSchema?{hubSchema}:{}) };
  const detailConfig = publicDetailConfig(env as Parameters<typeof publicDetailConfig>[0]);
  const automatic = (await resolvePublicDetail(resolveQuotationFields(inputs),content,owner,imageKeys,detailConfig)).resolved;
  const overrides = scopedQuotationOverrides(state, categoryContext.categoryId);
  const resolved = (await resolvePublicDetail(resolveQuotationFields({ ...inputs, overrides }),content,owner,imageKeys,detailConfig)).resolved;
  if (categoryContext.categoryId && hasLegacyQuotationOverrides(state)) resolved.issues.push('분류가 기록되지 않은 이전 수정값은 자동 적용하지 않았습니다. 자료 다운로드의 quotation-saved-scopes.json에 보존됩니다.');
  const inputFingerprint = await fingerprint({ inputs: { ...inputs, settings: savedProductFingerprintSettings(inputs.settings) }, schema: automatic.schema, categoryContext, profileRevision: profile?.revision ?? null, settingsPayload: source.settingsPayload, collection,
    ...quotationNoticeBindingFingerprint(inputs, resolved),
    ...quotationPackagedWeightBindingFingerprint(overrides, resolved, () => automatic),
    ...optionPriceCalculationRevision(product, options.rows, settings),
    ...(detailConfig ? { detailHtml: await publicDetailVersion(detailConfig) } : {}) });
  const view: QuotationFieldsView = { revision: state.revision, inputFingerprint, overrides, legacyOverrides: categoryContext.categoryId ? state.overrides : undefined, resolved, automatic, categoryContext,
    productVersion: product.updated_at, contentRevision: content.revision, optionRevision: options.revision, imageKeys, updatedAt: state.updatedAt, submissionReady: false };
  return { view, source, options };
}
export async function stableQuotationFieldsView(owner: string, id: string, profileId: string | null) {
  const saved = await snapshot(owner, id, profileId);
  if (!await quotationSourcesCurrent(owner, id, saved.source)) throw changed();
  return saved;
}
