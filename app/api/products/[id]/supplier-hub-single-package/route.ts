import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import { readQuotationExportSource, resolveQuotationExport, quotationExportFingerprint, QuotationExportError } from '@/app/exports/quotation-source';
import { readQuotationFields, quotationSourcesCurrent } from '@/db/quotation-fields';
import { productImageKeys } from '@/app/product-content';
import { loadAttachments, AttachmentError } from '@/app/exports/attachments';
import { publicDetailConfig, publicDetailVersion, PublicDetailError } from '@/app/quotation-public-detail';
import { projectSupplierHubSingleDocument, SingleProjectionError } from '@/app/supplier-hub-single-projection';
import { buildSingleAssetPlan, singleAssetSelection, singleAssetPackageView, publishSingleAssets, verifySingleAssets, SingleAssetError } from '@/app/supplier-hub-single-assets';
import { collectionSourceReview } from '@/app/collection-source-review';
import { readLegalDocuments, inspectLegalDocumentStorage } from '@/app/legal-documents';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { fingerprint } from '@/app/automation/model';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
function changed(): never { throw new SingleAssetError('준비 중 상품·견적값·이미지·회사 또는 카테고리가 변경되었습니다. 다시 검토해주세요.', 'SINGLE_SOURCE_CHANGED'); }
type Context = { params: Promise<{ id: string }> };

/** GET is a private candidate preview. Only an explicit fingerprint-bound POST
 * creates immutable copies served by our existing media route. Neither method
 * calls Supplier Hub, creates a remote document or acknowledges an agreement. */
async function handle(request: Request, context: Context, prepare: boolean) {
  if (request.method !== (prepare ? 'POST' : 'GET')) return new Response(null, { status: 405, headers: { allow: prepare ? 'POST' : 'GET', 'cache-control': 'no-store' } });
  const user = await getChatGPTUser();
  if (!user?.verifiedAccess) return json({ error: '운영 인증 연결 후 Single 자료를 준비할 수 있습니다.' }, 503);
  const member = { id: user.membership?.id, email: user.membership?.email, role: user.membership?.role };
  try {
    const url = new URL(request.url), profileId = url.searchParams.get('profileId');
    if ([...url.searchParams.keys()].some(key => key !== 'profileId') || url.searchParams.getAll('profileId').length > 1
      || profileId !== null && !/^[a-zA-Z0-9_-]{1,100}$/.test(profileId)) return json({ error: 'Single 자료의 프로필 식별값을 확인해주세요.' }, 400);
    let expectedFingerprint: string | undefined;
    if (prepare) {
      if (request.headers.get('sec-fetch-site') === 'cross-site' || request.headers.has('origin') && request.headers.get('origin') !== url.origin)
        return json({ error: '같은 앱에서 명시적으로 자료 준비를 요청해주세요.' }, 403);
      const body = await readBoundedJson(request, 1024);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2
        || !Object.hasOwn(body, 'action') || !Object.hasOwn(body, 'expectedFingerprint')) return json({ error: '검토한 식별값으로 자료 준비를 요청해주세요.' }, 400);
      const input = body as Record<string, unknown>;
      if (input.action !== 'prepare' || typeof input.expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedFingerprint))
        return json({ error: '검토한 식별값으로 자료 준비를 요청해주세요.' }, 400);
      expectedFingerprint = input.expectedFingerprint;
    }
    const owner = await getWorkspaceOwnerId(), company = approvedSupplierHubCompany(user.membership), { id } = await context.params;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return json({ error: '상품 식별값을 확인해주세요.' }, 400);
    if (user.userId !== owner || member.id !== owner || !['admin', 'member'].includes(member.role ?? '') || !company)
      return json({ error: '승인된 회원 회사의 저장 자료만 준비할 수 있습니다.' }, 409);
    const active = async () => {
      if (request.signal.aborted) throw new SingleAssetError('자료 준비 요청이 취소되었습니다.', 'SINGLE_ABORTED');
      const current = await getChatGPTUser(), currentCompany = approvedSupplierHubCompany(current?.membership);
      if (!current?.verifiedAccess || current.userId !== owner || current.membership?.id !== member.id || current.membership?.email !== member.email
        || current.membership?.role !== member.role || !currentCompany || currentCompany.code !== company.code || currentCompany.name !== company.name) changed();
    };
    await active();
    const saved = await readQuotationExportSource(owner, id, profileId);
    if (!saved.hubSchema || !saved.company || saved.company.code !== company.code || saved.company.name !== company.name || !saved.categoryContext.categoryId)
      throw new SingleAssetError('이 상품 회사·카테고리의 검증된 Single 원문 양식이 필요합니다.', 'SINGLE_SCHEMA');
    const config = publicDetailConfig(env as Parameters<typeof publicDetailConfig>[0]);
    const sourceFingerprint = await quotationExportFingerprint(saved, null), configVersion = await publicDetailVersion(config);
    const projection = await projectSupplierHubSingleDocument({ snapshot: saved.hubSchema, company, categoryId: saved.categoryContext.categoryId,
      categoryPath: saved.categoryContext.categoryPath, resolved: resolveQuotationExport(saved) });
    const ownedKeys = productImageKeys(saved.product.image_keys), selection = singleAssetSelection(projection, owner, ownedKeys);
    // Invalid/unknown refs stay blocking in the plan; they never cause a read of
    // an unowned key. Selected bytes are strictly bounded by loadAttachments.
    const assets = await loadAttachments(owner, saved.product.image_keys, selection.keys);
    const metadata = new Map(await Promise.all(selection.keys.map(async key => [key, await env.FILES.head(key)] as const)));
    const documents = readLegalDocuments(saved.content.legalDocuments, owner, id);
    const sourceIssues = [...collectionSourceReview(saved.sourceGaps), ...(saved.generatedProductLabelIssues ?? []),
      ...await inspectLegalDocumentStorage(documents, id, key => env.FILES.head(key))];
    if (documents.applicability === 'required') sourceIssues.push({ kind: 'error', code: 'SINGLE_LEGAL_DOCUMENT_TRANSPORT_UNVERIFIED', optionId: null,
      optionLabel: '법적 필수서류', fieldId: null, message: '필수 원본 서류의 Single 파일 연결 형식은 별도 확인이 필요합니다. 저장한 서류는 변경하지 않습니다.' });
    if (documents.applicability === 'unconfirmed') sourceIssues.push({ kind: 'review', code: 'SINGLE_LEGAL_APPLICABILITY_UNCONFIRMED', optionId: null,
      optionLabel: '법적 필수서류', fieldId: null, message: '실제 상품의 법적 서류 해당 여부를 확인해주세요. 미확인을 해당없음으로 바꾸지 않았습니다.' });
    const plan = await buildSingleAssetPlan({ projection, owner, productId: id, ownedKeys, assets, metadata, config, sourceIssues });
    const packageFingerprint = await fingerprint({ format: 'yoofam-supplier-hub-single-package-v1', sourceFingerprint, configVersion,
      sourceAssetFingerprint: plan.sourceAssetFingerprint, payload: plan.payload, manifest: plan.manifest, issues: plan.issues });
    if (expectedFingerprint !== undefined && expectedFingerprint !== packageFingerprint) changed();
    const guard = async (file?: (typeof plan.files)[number]) => {
      await active();
      if (!await quotationSourcesCurrent(owner, id, saved.source) || (await readQuotationFields(owner, id)).revision !== saved.state.revision) changed();
      const latest = await readQuotationExportSource(owner, id, profileId);
      if (await quotationExportFingerprint(latest, null) !== sourceFingerprint
        || JSON.stringify(await publicDetailVersion(publicDetailConfig(env as Parameters<typeof publicDetailConfig>[0]))) !== JSON.stringify(configVersion)) changed();
      if (file) {
        const stored = await env.FILES.get(file.key), currentMetadata = await env.FILES.head(file.key);
        if (!stored || !currentMetadata || JSON.stringify(currentMetadata) !== JSON.stringify(metadata.get(file.key))) changed();
        const bytes = new Uint8Array(await stored.arrayBuffer());
        const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        if (bytes.byteLength !== file.byteLength || sha256 !== file.sha256) changed();
      }
      await active();
    };
    await guard();
    if (prepare && plan.canPrepare) {
      await publishSingleAssets(plan, env.FILES, guard);
      // Re-read every selected private file after publication. A source edit
      // never silently turns an older immutable capability into a current one.
      for (const file of plan.files) await guard(file);
    }
    const published = plan.canPrepare && await verifySingleAssets(plan, env.FILES, guard);
    await guard();
    return json({ ...singleAssetPackageView(plan, published), productId: id, requestedProfileId: profileId, fingerprint: packageFingerprint,
      source: { productVersion: saved.product.updated_at, contentRevision: saved.content.revision, optionRevision: saved.options.revision,
        quotationRevision: saved.state.revision, profileId: saved.categoryContext.profileId, profileRevision: saved.profile?.revision ?? null },
      options: resolveQuotationExport(saved).rows.filter(row => row.included).map(row => ({ optionId: row.optionId, optionLabel: row.optionLabel })),
      excludedOptions: saved.options.rows.filter(row => !row.included).map(row => ({ optionId: row.id, translatedName: row.translatedName })) });
  } catch (error) {
    if (error instanceof SingleAssetError || error instanceof SingleProjectionError) return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof QuotationExportError || error instanceof AttachmentError || error instanceof PublicDetailError || error instanceof RequestBodyError)
      return json({ error: error.message }, error.status);
    return json({ error: 'Single 자료의 저장 파일·최종값을 확인하지 못했습니다.' }, 503);
  }
}
export const GET = (request: Request, context: Context) => handle(request, context, false);
export const POST = (request: Request, context: Context) => handle(request, context, true);
