import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct } from '@/db/queries';
import { readQuotationFields } from '@/db/quotation-fields';
import { readOptionRegistrationNumbers } from '@/db/product-options';
import { readOptionSourceImages } from '@/db/collection-images';
import { commitStageTwoPricing, readStageTwoPricingFence } from '@/db/stage-two-pricing';
import { stableQuotationFieldsView as stableView, QuotationFieldsSnapshotError as FieldsError } from '@/app/quotation-fields-snapshot';
import { PublicDetailError } from '@/app/quotation-public-detail';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { calculatePrice, pricePolicy } from '@/app/pricing';
import { calculateOptionPrices, resolveOptionPricePolicy, validateOptionsInput, type ProductOptionsResponse } from '@/app/product-options';
import { applyStageTwoRows, stageTwoQuotationDraft, type StageTwoPricingReceipt, type StageTwoPricingRequest } from '@/app/stage-two-pricing';
import { approvedSupplierHubCompany } from '@/app/supplier-hub-company';
import {createStageTwoPricingReview} from '@/app/stage-two-pricing-review';
import {quotationScope} from '@/app/quotation-scopes';

type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
const changed = () => new FieldsError('상품·가격·옵션·견적서가 변경되었습니다. 입력을 유지하고 최신 저장 결과를 확인해주세요.', 409, 'STAGE_TWO_PRICING_CONFLICT');
function profileSelection(request: Request) {
  const params = new URL(request.url).searchParams, value = params.get('profileId');
  if ([...params.keys()].some(key => key !== 'profileId') || params.getAll('profileId').length > 1
    || value !== null && !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new FieldsError('카테고리 프로필 선택을 확인해주세요.', 400);
  return value;
}
function validateBody(value: unknown): StageTwoPricingRequest {
  const fields = ['expectedProductVersion', 'expectedOptionRevision', 'expectedQuotationRevision', 'expectedInputFingerprint', 'policy', 'rows', 'changes', 'recalculate'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FieldsError('가격 설정 객체가 필요합니다.', 400);
  const body = value as StageTwoPricingRequest;
  if (Object.keys(body).length !== fields.length || Object.keys(body).some(key => !fields.includes(key))
    || typeof body.expectedProductVersion !== 'string' || !Number.isFinite(Date.parse(body.expectedProductVersion))
    || !Number.isSafeInteger(body.expectedOptionRevision) || body.expectedOptionRevision < 0
    || !Number.isSafeInteger(body.expectedQuotationRevision) || body.expectedQuotationRevision < 0
    || typeof body.expectedInputFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedInputFingerprint)
    || typeof body.recalculate !== 'boolean' || !Array.isArray(body.rows) || !Array.isArray(body.changes))
    throw new FieldsError('가격 저장 버전과 옵션·견적서 수정 내용을 확인해주세요.', 400);
  try { return { ...body, policy: pricePolicy(body.policy) }; }
  catch (error) { throw new FieldsError(error instanceof Error ? error.message : '가격 설정을 확인해주세요.', 400); }
}
function failure(error: unknown) {
  if (error instanceof FieldsError) return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
  if (error instanceof RequestBodyError || error instanceof PublicDetailError) return json({ error: error.message }, error.status);
  if (error instanceof RangeError) return json({ error: error.message }, 413);
  return json({ error: '가격을 저장하거나 확인하지 못했습니다. 입력을 유지하고 저장 결과를 조회해주세요.' }, 503);
}
async function currentReceipt(owner: string, id: string, profileId: string | null): Promise<StageTwoPricingReceipt> {
  const saved = await stableView(owner, id, profileId), product = await findProduct(owner, id);
  if (!product || product.updated_at !== saved.view.productVersion) throw changed();
  const pricing = resolveOptionPricePolicy(product, saved.source.settingsPayload ? JSON.parse(saved.source.settingsPayload) : undefined);
  const [sourceImageKeys, optionRegistrationNumbers, state] = await Promise.all([readOptionSourceImages(owner, product, saved.options).catch(() => ({})),
    product.registration_number ? readOptionRegistrationNumbers(owner, product, saved.options) : undefined,readQuotationFields(owner,id)]);
  const checked = await stableView(owner, id, profileId), checkedProduct = await findProduct(owner, id);
  if (!checkedProduct || JSON.stringify(checkedProduct) !== JSON.stringify(product) || checked.view.inputFingerprint !== saved.view.inputFingerprint
    || checked.view.revision !== saved.view.revision || checked.options.revision !== saved.options.revision || state.revision!==saved.view.revision) throw changed();
  const options: ProductOptionsResponse = { options: saved.options, productVersion: product.updated_at, sourceImageKeys,
    pricing: { ...pricing, rows: calculateOptionPrices(saved.options.rows, pricing.policy) },
    ...(optionRegistrationNumbers === undefined ? {} : { optionRegistrationNumbers }) };
  const scope=checked.view.categoryContext.categoryId?quotationScope(checked.view.categoryContext.categoryId):'common';
  return { product, options, quotation: checked.view,pricingReview:state.stageTwoPricingReviews?.[scope]??null };
}
export async function GET(request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결 후 가격을 편집할 수 있습니다.' }, 503);
  try { const owner = await getWorkspaceOwnerId(), { id } = await context.params; return json(await currentReceipt(owner, id, profileSelection(request))); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return json({ error: '운영 인증 연결 후 가격을 편집할 수 있습니다.' }, 503);
  try {
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) throw new FieldsError('같은 사이트에서 저장해주세요.', 400);
    const body = validateBody(await readBoundedJson(request, 512 * 1024)), profileId = profileSelection(request);
    const owner = await getWorkspaceOwnerId(), { id } = await context.params, saved = await stableView(owner, id, profileId);
    if (saved.view.productVersion !== body.expectedProductVersion || saved.options.revision !== body.expectedOptionRevision
      || saved.view.revision !== body.expectedQuotationRevision || saved.view.inputFingerprint !== body.expectedInputFingerprint) throw changed();
    const product = await findProduct(owner, id); if (!product || product.updated_at !== saved.view.productVersion) throw changed();
    const previousQuotation = await readQuotationFields(owner, id), fence = await readStageTwoPricingFence(owner, id, profileId);
    const actor = await getChatGPTUser(), company = approvedSupplierHubCompany(actor?.membership);
    if ((env as { YOOFAM_AUTH_ENABLED?: string }).YOOFAM_AUTH_ENABLED === 'true') {
      if (!actor?.verifiedAccess || actor.userId !== owner || !actor.membership || !company || actor.membership.status !== 'approved') throw changed();
      fence.actor = { email: actor.membership.email, role: actor.membership.role, companyCode: company.code, companyName: company.name };
    }
    const checked = await stableView(owner, id, profileId);
    if (checked.view.inputFingerprint !== saved.view.inputFingerprint || checked.view.revision !== saved.view.revision
      || JSON.stringify(checked.options) !== JSON.stringify(saved.options) || previousQuotation.revision !== saved.view.revision) throw changed();
    const version = new Date(Math.max(Date.now(), Date.parse(saved.view.productVersion) + 1)).toISOString();
    let options, quotation, calculation;
    try {
      const parsed = validateOptionsInput({ expectedRevision: body.expectedOptionRevision, expectedProductVersion: body.expectedProductVersion, rows: body.rows }, owner, saved.view.imageKeys);
      // Final reviewed quantities are authoritative, even after the editor's
      // automatic selector. Recomputing them here would erase a manual review.
      options = applyStageTwoRows(saved.options, parsed.rows, version);
      if (calculateOptionPrices(options.rows, body.policy).some(row => row.error))
        throw Error('포함한 옵션의 원가·구성 수량과 가격 설정을 확인해주세요.');
      quotation = { ...stageTwoQuotationDraft(saved.view, body.policy, body.recalculate, body.changes, previousQuotation).state,
        revision: previousQuotation.revision + 1, updatedAt: version };
      calculation = calculatePrice(product.source_price_cny, body.policy);
      const scope=saved.view.categoryContext.categoryId?quotationScope(saved.view.categoryContext.categoryId):'common';
      if(options.rows.some(row=>row.included)){
        const review=createStageTwoPricingReview({ownerId:owner,product:{...product,updated_at:version},policy:body.policy,options,state:quotation,
          schema:saved.view.resolved.schema,profileId:saved.view.categoryContext.profileId,sourceInputFingerprint:body.expectedInputFingerprint,
          sourceProductVersion:body.expectedProductVersion,savedAt:version,...(fence.actor?{company:{code:fence.actor.companyCode,name:fence.actor.companyName}}:{})});
        quotation.stageTwoPricingReviews={...quotation.stageTwoPricingReviews,[scope]:review};
      }else if(quotation.stageTwoPricingReviews){
        const reviews={...quotation.stageTwoPricingReviews};delete reviews[scope];
        if(Object.keys(reviews).length)quotation.stageTwoPricingReviews=reviews;else delete quotation.stageTwoPricingReviews;
      }
    } catch (error) { throw new FieldsError(error instanceof Error ? error.message : '가격·옵션·견적서 내용을 확인해주세요.', 400); }
    const images = [...new Set(options.rows.flatMap(row => row.imageKey ? [row.imageKey] : []))];
    if (images.length && !env.FILES) throw new FieldsError('이미지 저장소가 연결되지 않았습니다.', 503);
    const files = await Promise.all(images.map(key => env.FILES.head(key)));
    if (files.some(file => !file || !/^image\/(png|jpeg|webp|gif|avif)$/i.test(file.httpMetadata?.contentType ?? '')))
      throw new FieldsError('옵션 이미지의 저장본을 확인해주세요.', 400);
    if (!await commitStageTwoPricing(owner, product, body.policy, calculation, options, saved.options, quotation, previousQuotation, saved.source, fence)) throw changed();
    const receipt = await currentReceipt(owner, id, profileId);
    if (receipt.product.updated_at !== version || receipt.options.options.revision !== options.revision || receipt.quotation.revision !== quotation.revision) throw changed();
    return json(receipt);
  } catch (error) { return failure(error); }
}
