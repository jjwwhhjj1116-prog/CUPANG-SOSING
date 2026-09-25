import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct, getSettings } from '@/db/queries';
import { readQuotationCollectionSource } from '@/db/quotation-fields';
import { collectionRegistrationSettings } from '@/app/collection-registration-settings';
import { savedRegistrationSettings } from '@/app/workspace-settings';
import { parseCollectionRequest } from '@/app/sourcing';

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
    let offerId: string | null = null;
    try { offerId = parseCollectionRequest({ urls: [product.source_url] })[0].offerId; } catch { /* Legacy non-1688 source. */ }
    if (offerId) {
      const captured = await readQuotationCollectionSource(owner, offerId, id);
      if (captured?.linked) {
        settings = collectionRegistrationSettings(settings, JSON.parse(captured.payload)?.settings);
        source = 'collection';
      }
    }
    // Only the fields needed by label autofill leave this endpoint.
    return json({ productId: id, source, settings: { manufacturer: settings.manufacturer, importer: settings.importer, serviceContact: settings.serviceContact } });
  } catch { return json({ error: '상품에 연결된 등록 기본설정을 읽지 못했습니다.' }, 503); }
}
