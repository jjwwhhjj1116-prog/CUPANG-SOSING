import { productLabelPlan, verifyProductLabelsView, type ProductLabelsView } from '@/app/product-label';
import { attachProductLabel, type ProductLabelAttachment } from '@/app/product-label-attachment';
import { productLabelPreviewSignature, type ProductLabelUploadCache } from '@/app/product-label-upload';
import type { DocumentImagePlan } from '@/app/document-image';
import { productLabelResponseJson } from '@/app/product-label-read-response';

type Input = { productId: string; endpoint: string; quotationEndpoint: string; optionId: string | null; view: ProductLabelsView;
  cache: Map<string, ProductLabelUploadCache>; assertCurrent: () => void;
  render: (plan: DocumentImagePlan) => Promise<{ blob: Blob; width: number; height: number }> };

/** Complete one explicitly reviewed save. Reuse the exact render/upload recipe
 * and the existing receipt-first attachment path; never generate another AI draft. */
export async function completeProductLabelSave(input: Input, request: typeof fetch = fetch): Promise<ProductLabelAttachment> {
  const signature = productLabelPreviewSignature(input), current = () => input.assertCurrent();
  const scoped: typeof fetch = async (url, init) => { current(); const response = await request(url, init); current(); return response; };
  async function read() {
    const response = await scoped(input.endpoint, { cache: 'no-store' }), view = await productLabelResponseJson<ProductLabelsView>(response, input.endpoint); current();
    verifyProductLabelsView(view, input.optionId);
    if (view.productId !== input.productId || view.revision !== input.view.revision || view.inputFingerprint !== input.view.inputFingerprint
      || view.productVersion !== input.view.productVersion || productLabelPreviewSignature({ ...input, view }) !== signature)
      throw Error('저장한 표시사항이 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장해주세요.');
    return view;
  }
  const before = await read();
  let cache = input.cache.get(signature);
  if (!cache) { cache = { signature, uploadedKey: null, rendered: null }; input.cache.set(signature, cache); while (input.cache.size > 8) input.cache.delete(input.cache.keys().next().value!); }
  const rendered = cache.rendered ?? await input.render(productLabelPlan(before, input.optionId)); current();
  await read(); cache.rendered = rendered;
  const result = await attachProductLabel({ productId: input.productId, endpoint: input.endpoint, quotationEndpoint: input.quotationEndpoint,
    optionId: input.optionId, renderedView: before, blob: rendered.blob, uploadedKey: cache.uploadedKey, onUploaded: key => { current(); cache.uploadedKey = key; } }, scoped);
  current(); verifyProductLabelsView(result.view, input.optionId);
  if (productLabelPreviewSignature({ ...input, view: result.view }) !== signature || !result.key || !result.view.imageKeys.includes(result.key))
    throw Error('저장한 표시사항 PNG와 최종 견적 연결을 확인하지 못했습니다.');
  return result;
}
