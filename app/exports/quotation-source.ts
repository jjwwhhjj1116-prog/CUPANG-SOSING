import { findProduct, getSettings } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { readProductOptions } from '@/db/product-options';
import { getCategoryProfile } from '@/db/category-profiles';
import { readQuotationFields, readQuotationCollectionSource, quotationSourcesCurrent, type QuotationSourceGuard } from '@/db/quotation-fields';
import { getQuotationSchema, resolveQuotationFields, type QuotationFieldsView } from '@/app/quotation-schema';
import { defaultSettings, validateSettings } from '@/app/workspace-settings';
import { validateCategoryProfile } from '@/app/category-profiles';
import { parseCollectionRequest } from '@/app/sourcing';
import { fingerprint } from '@/app/automation/model';

export class QuotationExportError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** A saved-source snapshot shared by both downloads. No automatic values are written back. */
export async function readQuotationExportSource(owner: string, productId: string, profileId: string | null) {
  const product = await findProduct(owner, productId);
  if (!product) throw new QuotationExportError('상품을 찾을 수 없습니다.', 404);
  const [content, options, savedSettings, state, profile] = await Promise.all([
    readProductContent(owner, productId), readProductOptions(owner, productId), getSettings(owner), readQuotationFields(owner, productId),
    profileId ? getCategoryProfile(owner, profileId) : Promise.resolve(null),
  ]);
  if (profileId && !profile) throw new QuotationExportError('카테고리 연결을 찾을 수 없습니다.', 404);
  const settings = savedSettings ? validateSettings(JSON.parse(savedSettings.payload)) : defaultSettings;
  let categoryContext: QuotationFieldsView['categoryContext'] = { source: 'unknown', profileId: null, categoryId: null, categoryPath: [] };
  let collection: QuotationSourceGuard['collection'] = null;
  if (profile) categoryContext = { source: 'profile', profileId: profile.id, categoryId: profile.categoryId || null, categoryPath: [...profile.categoryPath] };
  else {
    let offerId: string | null = null;
    try { offerId = parseCollectionRequest({ urls: [product.source_url] })[0].offerId; } catch { /* No inferred category for legacy/non-product URLs. */ }
    if (offerId) {
      const captured = await readQuotationCollectionSource(owner, offerId, productId); collection = { offerId, snapshot: captured };
      const payload = captured ? JSON.parse(captured.payload) : null;
      if (payload?.category) {
        const category = validateCategoryProfile(payload.category);
        categoryContext = { source: 'collection', profileId: typeof payload.category.id === 'string' ? payload.category.id : null,
          categoryId: category.categoryId || null, categoryPath: [...category.categoryPath] };
      }
    }
  }
  const source: QuotationSourceGuard = { productVersion: product.updated_at, imageKeys: product.image_keys, pricingPolicy: product.pricing_policy ?? null,
    contentRevision: content.revision, optionRevision: options.revision, settingsPayload: savedSettings?.payload ?? null,
    profile: profile ? { id: profile.id, revision: profile.revision } : null, collection };
  // This also detects changes during the independent source reads before any R2 work starts.
  if (!await quotationSourcesCurrent(owner, productId, source)) throw new QuotationExportError('자료를 읽는 동안 변경이 발생했습니다. 저장 완료 후 다시 검토해주세요.', 409);
  return { product, content, options, settings, state, profile, categoryContext, source };
}
export type QuotationExportSource = Awaited<ReturnType<typeof readQuotationExportSource>>;
export function resolveQuotationExport(saved: QuotationExportSource) {
  return resolveQuotationFields({ categoryId: saved.categoryContext.categoryId, categoryPath: saved.categoryContext.categoryPath,
    product: saved.product, content: saved.content, settings: saved.settings, options: saved.options, overrides: saved.state.overrides });
}
export async function quotationExportFingerprint(saved: QuotationExportSource, dataStartRow: number | null) {
  // Raw source/state payloads matter: an override reset and an equal-valued manual
  // override have different provenance, even when the visible cell is unchanged.
  return fingerprint({ format: 'sourceflow-quotation-fields-v1', saved, dataStartRow,
    schema: getQuotationSchema(saved.categoryContext.categoryId, saved.categoryContext.categoryPath) });
}
