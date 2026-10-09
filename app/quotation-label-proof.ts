import { quotationLabelPlan } from '@/app/quotation-label-plan';
import { QUOTATION_LABEL_PNG_RECIPE, quotationLabelUploadId } from '@/app/quotation-label-upload';
import { labelUploadDigest, labelUploadKey } from '@/app/label-upload-key';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import { isOwnedImageKey } from '@/app/image-files';
import type { QuotationFieldsView, ResolvedQuotation } from '@/app/quotation-schema';
import type { SubmissionIssue } from '@/app/submission-review';

type Context = { productId: string; endpoint: string; view: QuotationFieldsView; optionId: string | null };
export type QuotationLabelProofRequest = {
  productId: string; optionId: string | null; endpoint: string;
  expectedProductVersion: string; expectedInputFingerprint: string; expectedRevision: number;
};
export type QuotationLabelReceipt = {
  recipe: typeof QUOTATION_LABEL_PNG_RECIPE; productId: string; optionId: string | null; profileId: string | null;
  planSha256: string; categorySha256: string;
};
const digest = (value: unknown) => labelUploadDigest(new TextEncoder().encode(JSON.stringify(value)));
const identifier = (value: unknown, length: number): value is string => typeof value === 'string' && new RegExp(`^[A-Za-z0-9_-]{1,${length}}$`).test(value);
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const clock = (value: unknown): value is string => typeof value === 'string' && value.length <= 30 && Number.isFinite(Date.parse(value));

export function quotationLabelProofRequest(input: Context): QuotationLabelProofRequest {
  return { productId: input.productId, optionId: input.optionId, endpoint: input.endpoint,
    expectedProductVersion: input.view.productVersion, expectedInputFingerprint: input.view.inputFingerprint, expectedRevision: input.view.revision };
}
export function parseQuotationLabelProofRequest(value: unknown): QuotationLabelProofRequest {
  const proof = value as QuotationLabelProofRequest;
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)
    || Object.keys(proof).some(key => !['productId','optionId','endpoint','expectedProductVersion','expectedInputFingerprint','expectedRevision'].includes(key))
    || !identifier(proof.productId,100) || proof.optionId !== null && !identifier(proof.optionId,80)
    || typeof proof.endpoint !== 'string' || proof.endpoint.length > 300 || !proof.endpoint.startsWith('/api/products/')
    || !clock(proof.expectedProductVersion) || !sha256(proof.expectedInputFingerprint)
    || !Number.isSafeInteger(proof.expectedRevision) || proof.expectedRevision < 0) throw Error('견적 표시사항 PNG의 저장 원천을 확인해주세요.');
  const url = new URL(proof.endpoint, 'https://label.invalid');
  if (url.origin !== 'https://label.invalid' || url.pathname !== `/api/products/${encodeURIComponent(proof.productId)}/quotation-fields` || url.hash
    || [...url.searchParams.keys()].some(key => key !== 'profileId') || url.searchParams.getAll('profileId').length > 1
    || url.searchParams.has('profileId') && !identifier(url.searchParams.get('profileId'),100)) throw Error('견적 표시사항의 상품·카테고리 연결을 확인해주세요.');
  return proof;
}
export async function verifiedQuotationLabelMetadata(proof: QuotationLabelProofRequest, view: QuotationFieldsView, uploadId: string): Promise<Record<string,string>> {
  parseQuotationLabelProofRequest(proof);
  const selectedProfile = new URL(proof.endpoint, 'https://label.invalid').searchParams.get('profileId');
  if (!view || view.productVersion !== proof.expectedProductVersion || view.inputFingerprint !== proof.expectedInputFingerprint
    || view.revision !== proof.expectedRevision || !view.categoryContext?.categoryId
    || view.categoryContext.profileId !== null && !identifier(view.categoryContext.profileId,100)
    || selectedProfile !== null && selectedProfile !== view.categoryContext.profileId
    || view.resolved?.schema.categoryId !== view.categoryContext.categoryId
    || JSON.stringify(view.resolved.schema.categoryPath) !== JSON.stringify(view.categoryContext.categoryPath)
    || await quotationLabelUploadId({ productId: proof.productId, optionId: proof.optionId, endpoint: proof.endpoint, view }) !== uploadId) {
    throw Error('PNG 생성 후 견적 표시사항 저장값이 변경되었습니다. 최신 값으로 다시 만들어주세요.');
  }
  return { quotationLabelRecipe: QUOTATION_LABEL_PNG_RECIPE, quotationLabelProductId: proof.productId, quotationLabelOptionId: proof.optionId ?? '',
    quotationLabelProfileId: view.categoryContext.profileId ?? '', quotationLabelPlanSha256: await digest(quotationLabelPlan(view.resolved,proof.optionId)),
    quotationLabelCategorySha256: await digest([view.categoryContext.categoryId,view.categoryContext.categoryPath]),
    quotationLabelProductVersion: view.productVersion, quotationLabelSourceFingerprint: view.inputFingerprint, quotationLabelRevision: String(view.revision) };
}

/** Only a server-marked v2 object is a replaceable generated quotation PNG.
 * Opaque old recipes and manual files have no inferred source identity. */
export function quotationLabelReceiptFromMetadata(value: unknown): QuotationLabelReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const metadata = value as Record<string,unknown>;
  if (metadata.quotationLabelRecipe !== QUOTATION_LABEL_PNG_RECIPE) return null;
  if (!identifier(metadata.quotationLabelProductId,100)
    || metadata.quotationLabelOptionId !== '' && !identifier(metadata.quotationLabelOptionId,80)
    || metadata.quotationLabelProfileId !== '' && !identifier(metadata.quotationLabelProfileId,100)
    || !sha256(metadata.quotationLabelPlanSha256) || !sha256(metadata.quotationLabelCategorySha256)
    || !clock(metadata.quotationLabelProductVersion) || !sha256(metadata.quotationLabelSourceFingerprint)
    || typeof metadata.quotationLabelRevision !== 'string' || !/^(?:0|[1-9]\d*)$/.test(metadata.quotationLabelRevision)
    || !Number.isSafeInteger(Number(metadata.quotationLabelRevision))
    || !sha256(metadata.labelUploadId) || !sha256(metadata.labelBlobSha256)) throw Error('견적 표시사항 PNG의 저장 원천을 확인하지 못했습니다.');
  return { recipe: QUOTATION_LABEL_PNG_RECIPE, productId: metadata.quotationLabelProductId,
    optionId: metadata.quotationLabelOptionId === '' ? null : metadata.quotationLabelOptionId as string,
    profileId: metadata.quotationLabelProfileId === '' ? null : metadata.quotationLabelProfileId as string,
    planSha256: metadata.quotationLabelPlanSha256, categorySha256: metadata.quotationLabelCategorySha256 };
}

/** Compare the original plan to the final saved rows without another route read.
 * Source-clock changes alone do not invalidate a PNG whose printed plan agrees. */
export async function inspectGeneratedQuotationLabels(input: {
  ownerId: string; productId: string; profileId: string | null; resolved: ResolvedQuotation;
  head: (key: string) => Promise<{ customMetadata?: Record<string,string> } | null>;
}): Promise<SubmissionIssue[]> {
  const target = exactPrimaryQuotationTarget(input.resolved.schema.fields,'labelImages');
  const objects = new Map<string,Promise<{customMetadata?:Record<string,string>}|null>>();
  const issues: SubmissionIssue[] = [], category = await digest([input.resolved.schema.categoryId,input.resolved.schema.categoryPath]);
  for (const row of input.resolved.rows.filter(row => row.included)) for (const key of [...new Set((row.fields[target.primary]?.value ?? '').split('\n').map(key=>key.trim()).filter(Boolean))]) {
    if (!isOwnedImageKey(input.ownerId,key)) continue;
    if (!objects.has(key)) objects.set(key,input.head(key));
    const metadata = (await objects.get(key)!)?.customMetadata;
    if (metadata?.quotationLabelRecipe !== QUOTATION_LABEL_PNG_RECIPE) continue;
    let code = 'GENERATED_QUOTATION_LABEL_UNCONFIRMED', message = '생성한 견적 표시사항 PNG의 저장 원천을 확인하지 못했습니다. 최신 견적 값으로 다시 생성하거나 직접 확인한 라벨 파일을 연결해주세요.';
    try {
      const receipt = quotationLabelReceiptFromMetadata(metadata);
      if (!receipt || receipt.productId !== input.productId || receipt.optionId !== row.optionId || receipt.profileId !== input.profileId
        || labelUploadKey(input.ownerId,metadata.labelUploadId) !== key) throw Error('Invalid generated quotation label proof');
      if (receipt.categorySha256 === category && receipt.planSha256 === await digest(quotationLabelPlan(input.resolved,row.optionId))) continue;
      code = 'GENERATED_QUOTATION_LABEL_STALE'; message = '생성한 견적 표시사항 PNG가 현재 저장된 표시사항과 다릅니다. 수정한 견적 값으로 다시 생성·연결하거나 직접 확인한 라벨 파일을 연결해주세요.';
    } catch { /* Preserve the original PNG and expose the unconfirmed source. */ }
    issues.push({kind:'error',code,message,optionId:row.optionId,optionLabel:row.optionLabel,fieldId:target.primary});
  }
  return issues;
}
