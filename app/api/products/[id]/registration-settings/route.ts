import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct, getSettings } from '@/db/queries';
import { readQuotationCollectionSource } from '@/db/quotation-fields';
import { collectionRegistrationSettings } from '@/app/collection-registration-settings';
import { savedRegistrationSettings } from '@/app/workspace-settings';
import { parseCollectionRequest } from '@/app/sourcing';
import { labelDateNotice } from '@/app/label-autofill';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import { CollectionCompanyError, verifyCapturedCollectionCompany } from '@/app/collection-company';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
/** Read the same captured registration inputs as the quotation resolver. */
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결을 확인해주세요.' }, 503);
  try {
    const owner = await getWorkspaceOwnerId();
    const { id } = await context.params;
    const product = await findProduct(owner, id);
    if (!product) return json({ error: '상품을 찾을 수 없습니다.' }, 404);
    const stored = await getSettings(owner);
    let settings = savedRegistrationSettings(stored ? JSON.parse(stored.payload) : null);
    let source: 'collection' | 'workspace' = 'workspace';
    let categoryId: string | null = null;
    let dateNotice: boolean | undefined;
    let referenceTime = product.created_at;
    let offerId: string | null = null;
    try { offerId = parseCollectionRequest({ urls: [product.source_url] })[0].offerId; } catch { /* Legacy non-1688 source. */ }
    if (offerId) {
      const captured = await readQuotationCollectionSource(owner, offerId, id);
      if (captured?.linked) {
        const context = JSON.parse(captured.payload);
        const user = await getChatGPTUser();
        verifyCapturedCollectionCompany(context, user?.verifiedAccess && user.userId === owner ? approvedSupplierHubCompany(user.membership) : null);
        settings = collectionRegistrationSettings(settings, context?.settings);
        categoryId = typeof context?.category?.categoryId === 'string' ? context.category.categoryId : null;
        if (context?.category?.hubSchema !== undefined) dateNotice = labelDateNotice(categoryId, context.category.categoryPath, context.category.hubSchema);
        if (typeof context?.capturedAt === 'string') referenceTime = context.capturedAt;
        source = 'collection';
      }
    }
    // Only the fields needed by SEO, label autofill and option logistics leave this endpoint.
    return json({ productId: id, source, categoryId, referenceTime, ...(dateNotice !== undefined ? { dateNotice } : {}), settings: { brand: settings.brand, manufacturer: settings.manufacturer, importer: settings.importer, serviceContact: settings.serviceContact, boxSkuQuantity: settings.boxSkuQuantity,
      washingMethod: settings.washingMethod, handlingPrecautions: settings.handlingPrecautions, manufactureDatePreviousMonth: settings.manufactureDatePreviousMonth,
      shelfLifeDays: settings.shelfLifeDays, handlingReason: settings.handlingReason } });
  } catch (error) {
    if (error instanceof CollectionCompanyError) return json({ error: error.message, code: error.code }, 409);
    return json({ error: '상품에 연결된 등록 기본설정을 읽지 못했습니다.' }, 503);
  }
}
