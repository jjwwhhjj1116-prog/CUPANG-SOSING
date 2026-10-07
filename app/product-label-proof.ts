import { productLabelPlan, type ProductLabelsView } from '@/app/product-label';
import { productLabelUploadId, type ProductLabelUploadContext } from '@/app/product-label-upload';
import { labelUploadDigest, labelUploadKey } from '@/app/label-upload-key';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import { isOwnedImageKey } from '@/app/image-files';
import type { ResolvedQuotation } from '@/app/quotation-schema';
import type { SubmissionIssue } from '@/app/submission-review';

export const PRODUCT_LABEL_PROOF_RECIPE = 'product-label-png-v1';
export type ProductLabelProofRequest = { productId: string; optionId: string | null; endpoint: string; expectedProductVersion: string; expectedInputFingerprint: string; expectedRevision: number };
const digest = (value: unknown) => labelUploadDigest(new TextEncoder().encode(JSON.stringify(value)));
export function productLabelProofRequest(input: ProductLabelUploadContext): ProductLabelProofRequest {
  return { productId: input.productId, optionId: input.optionId, endpoint: input.endpoint,
    expectedProductVersion: input.view.productVersion, expectedInputFingerprint: input.view.inputFingerprint, expectedRevision: input.view.revision };
}
export function parseProductLabelProofRequest(value: unknown): ProductLabelProofRequest {
  const proof = value as ProductLabelProofRequest;
  if (!proof || typeof proof !== 'object' || Array.isArray(proof) || Object.keys(proof).some(key => !['productId','optionId','endpoint','expectedProductVersion','expectedInputFingerprint','expectedRevision'].includes(key))
    || typeof proof.productId !== 'string' || !/^\w[\w-]{0,99}$/.test(proof.productId) || proof.optionId !== null && (typeof proof.optionId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(proof.optionId))
    || typeof proof.endpoint !== 'string' || proof.endpoint.length > 300 || typeof proof.expectedProductVersion !== 'string' || proof.expectedProductVersion.length > 30 || !Number.isFinite(Date.parse(proof.expectedProductVersion))
    || typeof proof.expectedInputFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(proof.expectedInputFingerprint) || !Number.isSafeInteger(proof.expectedRevision) || proof.expectedRevision < 0) throw Error('제품 표시사항 PNG의 저장 원천을 확인해주세요.');
  const url = new URL(proof.endpoint, 'https://label.invalid');
  if (url.origin !== 'https://label.invalid' || url.pathname !== `/api/products/${encodeURIComponent(proof.productId)}/product-labels` || url.hash
    || [...url.searchParams.keys()].some(key => key !== 'profileId') || url.searchParams.getAll('profileId').length > 1
    || url.searchParams.has('profileId') && !/^[A-Za-z0-9_-]{1,100}$/.test(url.searchParams.get('profileId')!)) throw Error('제품 표시사항의 상품·카테고리 연결을 확인해주세요.');
  return proof;
}
export async function verifiedProductLabelMetadata(proof: ProductLabelProofRequest, view: ProductLabelsView, uploadId: string): Promise<Record<string,string>> {
  parseProductLabelProofRequest(proof);
  if (view.productId !== proof.productId || view.productVersion !== proof.expectedProductVersion || view.inputFingerprint !== proof.expectedInputFingerprint
    || view.revision !== proof.expectedRevision || await productLabelUploadId({ productId: proof.productId, optionId: proof.optionId, endpoint: proof.endpoint, view }) !== uploadId) throw Error('PNG 생성 후 제품 표시사항 저장값이 변경되었습니다. 최신 값으로 다시 만들어주세요.');
  return { productLabelRecipe: PRODUCT_LABEL_PROOF_RECIPE, productLabelProductId: proof.productId, productLabelOptionId: proof.optionId ?? '',
    productLabelProfileId: new URL(proof.endpoint, 'https://label.invalid').searchParams.get('profileId') ?? '',
    productLabelPlanSha256: await digest(productLabelPlan(view, proof.optionId)),
    productLabelCategorySha256: await digest([view.categoryContext.categoryId,view.categoryContext.categoryPath]),
    productLabelProductVersion: view.productVersion, productLabelSourceFingerprint: view.inputFingerprint, productLabelRevision: String(view.revision) };
}

/** Compare only server-marked NEW nine-row label plans. Unmarked legacy images,
 * manually uploaded files and stage-seven notice PNGs are never classified by
 * their filename or opaque upload hash. This proves plan freshness, not pixels.
 */
export async function inspectGeneratedProductLabels(input: {
  ownerId: string; productId: string; profileId: string | null; resolved: ResolvedQuotation;
  head: (key: string) => Promise<{ customMetadata?: Record<string,string> } | null>;
  readView: (profileId: string | null) => Promise<ProductLabelsView>;
}): Promise<SubmissionIssue[]> {
  const target = exactPrimaryQuotationTarget(input.resolved.schema.fields,'labelImages'), objects = new Map<string,Promise<{customMetadata?:Record<string,string>}|null>>(), views = new Map<string,Promise<ProductLabelsView>>();
  const issues: SubmissionIssue[] = [];
  for (const row of input.resolved.rows.filter(row => row.included)) for (const key of [...new Set((row.fields[target.primary]?.value ?? '').split('\n').map(key=>key.trim()).filter(Boolean))]) {
    if (!isOwnedImageKey(input.ownerId,key)) continue;
    if (!objects.has(key)) objects.set(key,input.head(key));
    const object = await objects.get(key)!, metadata = object?.customMetadata;
    if (metadata?.productLabelRecipe !== PRODUCT_LABEL_PROOF_RECIPE) continue;
    let code = 'GENERATED_PRODUCT_LABEL_UNCONFIRMED', message = '생성한 제품 표시사항 PNG의 저장 원천을 확인하지 못했습니다. 최신 표시사항으로 다시 생성하거나 직접 확인한 라벨 파일을 연결해주세요.';
    try {
      const profileId = metadata.productLabelProfileId || null;
      if (metadata.productLabelProductId !== input.productId || typeof metadata.productLabelProfileId !== 'string'
        || metadata.productLabelProfileId !== '' && !/^[A-Za-z0-9_-]{1,100}$/.test(metadata.productLabelProfileId)
        || profileId !== null && profileId !== input.profileId
        || !/^[a-f0-9]{64}$/.test(metadata.productLabelPlanSha256 ?? '') || !/^[a-f0-9]{64}$/.test(metadata.productLabelCategorySha256 ?? '')
        || !Number.isFinite(Date.parse(metadata.productLabelProductVersion)) || !/^[a-f0-9]{64}$/.test(metadata.productLabelSourceFingerprint ?? '')
        || !/^\d+$/.test(metadata.productLabelRevision ?? '') || !Number.isSafeInteger(Number(metadata.productLabelRevision))
        || typeof metadata.productLabelOptionId !== 'string' || metadata.productLabelOptionId !== '' && !/^[A-Za-z0-9_-]{1,80}$/.test(metadata.productLabelOptionId)
        || labelUploadKey(input.ownerId,metadata.labelUploadId) !== key || !/^[a-f0-9]{64}$/.test(metadata.labelBlobSha256 ?? '')) throw Error('Invalid generated label proof');
      if (!views.has(profileId ?? '')) views.set(profileId ?? '',input.readView(profileId));
      const view = await views.get(profileId ?? '')!;
      const category = await digest([view.categoryContext.categoryId,view.categoryContext.categoryPath]);
      const current = await digest(productLabelPlan(view,row.optionId));
      if (category === metadata.productLabelCategorySha256 && current === metadata.productLabelPlanSha256) continue;
      code = 'GENERATED_PRODUCT_LABEL_STALE'; message = '생성한 제품 표시사항 PNG가 현재 저장된 9행 표시사항과 다릅니다. 수정한 내용으로 다시 생성·연결하거나 직접 확인한 라벨 파일을 연결해주세요.';
    } catch { /* Preserve the image and surface the unconfirmed proof. */ }
    issues.push({kind:'error',code,message,optionId:row.optionId,optionLabel:row.optionLabel,fieldId:target.primary});
  }
  return issues;
}
