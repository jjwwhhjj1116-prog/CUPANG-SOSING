import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct } from '@/db/queries';
import { readOptionRegistrationNumbers } from '@/db/product-options';
import { readOptionSourceImages } from '@/db/collection-images';
import { readQuotationFields, type QuotationFieldsState } from '@/db/quotation-fields';
import { commitOptionBundles } from '@/db/option-bundles';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { applyBundleAddRows, bundleQuotationChanges, bundleQuotationPackagingBasis } from '@/app/option-bundles';
import { calculateOptionPrices, optionInputs, resolveOptionPricePolicy, validateOptionsInput, type ProductOptionsResponse } from '@/app/product-options';
import { applyQuotationChanges } from '@/app/quotation-schema';
import { quotationScope, scopedQuotationOverrides } from '@/app/quotation-scopes';
import { stableQuotationFieldsView as stableView, QuotationFieldsSnapshotError as FieldsError } from '@/app/quotation-fields-snapshot';
import { PublicDetailError } from '@/app/quotation-public-detail';

type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
const changed = () => new FieldsError('상품·옵션·견적서 또는 가격 설정이 바뀌었습니다. 최신 저장본을 확인한 뒤 번들을 추가해주세요.', 409, 'OPTION_BUNDLES_CONFLICT');
function profileSelection(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => key !== 'profileId') || params.getAll('profileId').length > 1) throw new FieldsError('카테고리 프로필 선택을 확인해주세요.', 400);
  const value = params.get('profileId');
  if (value !== null && !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new FieldsError('카테고리 프로필 선택을 확인해주세요.', 400);
  return value;
}
function validateBody(value: unknown) {
  const fields = ['expectedProductVersion', 'expectedOptionRevision', 'expectedQuotationRevision', 'expectedInputFingerprint', 'quantity', 'additions'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FieldsError('번들 요청을 확인해주세요.', 400);
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== fields.length || Object.keys(body).some(key => !fields.includes(key))
    || typeof body.expectedProductVersion !== 'string' || !Number.isFinite(Date.parse(body.expectedProductVersion))
    || !Number.isSafeInteger(body.expectedOptionRevision) || (body.expectedOptionRevision as number) < 0
    || !Number.isSafeInteger(body.expectedQuotationRevision) || (body.expectedQuotationRevision as number) < 0
    || typeof body.expectedInputFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedInputFingerprint)
    || !Number.isSafeInteger(body.quantity) || (body.quantity as number) < 2 || (body.quantity as number) > 1e6
    || !Array.isArray(body.additions) || body.additions.length < 1 || body.additions.length > 200)
    throw new FieldsError('저장 버전·번들 수량·선택 옵션을 확인해주세요.', 400);
  const targets = new Set<string>(), sources = new Set<string>();
  const additions = body.additions.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FieldsError('번들 옵션을 확인해주세요.', 400);
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length !== 2 || Object.keys(row).some(key => !['sourceOptionId', 'optionId'].includes(key))
      || typeof row.sourceOptionId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(row.sourceOptionId)
      || typeof row.optionId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(row.optionId)
      || targets.has(row.optionId) || sources.has(row.sourceOptionId)) throw new FieldsError('번들 옵션 ID가 잘못되었거나 중복되었습니다.', 400);
    targets.add(row.optionId); sources.add(row.sourceOptionId);
    return { sourceOptionId: row.sourceOptionId, optionId: row.optionId };
  });
  return { expectedProductVersion: body.expectedProductVersion, expectedOptionRevision: body.expectedOptionRevision as number,
    expectedQuotationRevision: body.expectedQuotationRevision as number, expectedInputFingerprint: body.expectedInputFingerprint,
    quantity: body.quantity as number, additions };
}
function failure(error: unknown) {
  if (error instanceof FieldsError) return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
  if (error instanceof RequestBodyError || error instanceof PublicDetailError) return json({ error: error.message }, error.status);
  if (error instanceof RangeError) return json({ error: error.message }, 413);
  return json({ error: '번들을 저장하지 못했습니다. 입력을 유지한 채 저장 결과를 확인해주세요.' }, 503);
}
export async function POST(request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess)
    return json({ error: '운영 인증 연결 후 번들을 추가할 수 있습니다.' }, 503);
  try {
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) throw new FieldsError('같은 사이트에서 저장해주세요.', 400);
    const body = validateBody(await readBoundedJson(request, 512 * 1024)), profileId = profileSelection(request);
    const owner = await getWorkspaceOwnerId(), { id } = await context.params;
    const saved = await stableView(owner, id, profileId);
    if (saved.view.productVersion !== body.expectedProductVersion || saved.options.revision !== body.expectedOptionRevision
      || saved.view.revision !== body.expectedQuotationRevision || saved.view.inputFingerprint !== body.expectedInputFingerprint) throw changed();
    const product = await findProduct(owner, id);
    if (!product || product.updated_at !== saved.view.productVersion) throw changed();
    const pricing = resolveOptionPricePolicy(product, saved.source.settingsPayload ? JSON.parse(saved.source.settingsPayload) : undefined);
    const version = new Date(Math.max(Date.now(), Date.parse(saved.view.productVersion) + 1)).toISOString();
    let next, overrides;
    try {
      next = applyBundleAddRows(saved.options, body.additions, body.quantity, version);
      // Validate saved/cloned facts against the normal option constraints, but
      // do not replace untouched source rows with the parser's trimmed values.
      validateOptionsInput({ expectedRevision: saved.options.revision, expectedProductVersion: saved.view.productVersion,
        rows: optionInputs(next) }, owner, saved.view.imageKeys);
      overrides = applyQuotationChanges(saved.view.overrides, bundleQuotationChanges(saved.view, body.additions, next.rows, pricing.policy));
    } catch (error) { throw new FieldsError(error instanceof Error ? error.message : '번들 구성을 확인해주세요.', 400); }
    if (calculateOptionPrices(next.rows, pricing.policy).some(row => row.error)) throw new FieldsError('포함한 옵션 가격을 계산할 수 없습니다.', 400);
    const images = [...new Set(next.rows.flatMap(row => row.imageKey ? [row.imageKey] : []))];
    if (images.length && !env.FILES) throw new FieldsError('이미지 저장소가 연결되지 않았습니다.', 503);
    const files = await Promise.all(images.map(key => env.FILES.head(key)));
    if (files.some(file => !file || !/^image\/(png|jpeg|webp|gif|avif)$/i.test(file.httpMetadata?.contentType ?? '')))
      throw new FieldsError('번들 옵션에 연결한 이미지 저장본을 확인해주세요.', 400);
    const previousQuotation = await readQuotationFields(owner, id);
    if (previousQuotation.revision !== saved.view.revision
      || JSON.stringify(scopedQuotationOverrides(previousQuotation, saved.view.categoryContext.categoryId)) !== JSON.stringify(saved.view.overrides)) throw changed();
    const categoryId = saved.view.categoryContext.categoryId;
    const quotation: QuotationFieldsState = { ...previousQuotation, revision: previousQuotation.revision + 1, updatedAt: version,
      overrides: categoryId ? previousQuotation.overrides : overrides,
      ...(categoryId ? { categoryOverrides: { ...previousQuotation.categoryOverrides, [quotationScope(categoryId)]: overrides } } : {}) };
    const packagingBasis = bundleQuotationPackagingBasis(saved.view, body.additions);
    if (packagingBasis) {
      if (categoryId) quotation.categoryPackagingBasis = { ...previousQuotation.categoryPackagingBasis, [quotationScope(categoryId)]: packagingBasis };
      else quotation.packagingBasis = packagingBasis;
    }
    if (!await commitOptionBundles(owner, next, saved.options, quotation, previousQuotation, saved.source)) throw changed();
    const fresh = await stableView(owner, id, profileId), freshProduct = await findProduct(owner, id);
    if (!freshProduct || freshProduct.updated_at !== version || fresh.view.productVersion !== version
      || fresh.options.revision !== next.revision || fresh.view.revision !== quotation.revision) throw changed();
    const resolved = resolveOptionPricePolicy(freshProduct, fresh.source.settingsPayload ? JSON.parse(fresh.source.settingsPayload) : undefined);
    const [sourceImageKeys, optionRegistrationNumbers] = await Promise.all([
      readOptionSourceImages(owner, freshProduct, fresh.options).catch(() => ({})),
      freshProduct.registration_number ? readOptionRegistrationNumbers(owner, freshProduct, fresh.options) : undefined,
    ]);
    // Enrichment reads cannot acknowledge a newer source as this commit.
    const checked = await stableView(owner, id, profileId);
    if (checked.view.inputFingerprint !== fresh.view.inputFingerprint || checked.view.productVersion !== version
      || checked.options.revision !== next.revision || checked.view.revision !== quotation.revision) throw changed();
    const options: ProductOptionsResponse = { options: fresh.options, pricing: { ...resolved, rows: calculateOptionPrices(fresh.options.rows, resolved.policy) },
      productVersion: version, sourceImageKeys, ...(optionRegistrationNumbers === undefined ? {} : { optionRegistrationNumbers }) };
    return json({ options, quotation: checked.view });
  } catch (error) { return failure(error); }
}
