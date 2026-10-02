import { documentImagePlan, type DocumentImagePlan, type DocumentImageSection } from '@/app/document-image';
import { productImageKeys, type ProductContent } from '@/app/product-content';
import { emptyProductOptions, type ProductOptions } from '@/app/product-options';

/** A read-only acknowledgement of this exact PNG already assigned to this
 * product. Changed document inputs never authorize a stale PNG or another write. */
export async function recoverDocumentImageAttachment(input: {
  productId: string; section: DocumentImageSection; key: string; plan: DocumentImagePlan;
  productVersion: string; contentRevision: number; optionRevision: number;
}, request: typeof fetch = fetch): Promise<string | null> {
  const path = `/api/products/${encodeURIComponent(input.productId)}`;
  async function read<T>(url: string): Promise<T> {
    const response = await request(url, { cache: 'no-store' });
    const body = await response.json() as T & { error?: string };
    if (!response.ok) throw Error(body.error || '첨부 저장 상태를 확인하지 못했습니다. 다시 확인해주세요.');
    return body;
  }
  type Product = { id: string; updated_at: string; image_keys: string };
  const first = (await read<{ product: Product }>(path)).product;
  if (first?.id !== input.productId || !Number.isFinite(Date.parse(first.updated_at))) throw Error('첨부 대상 상품을 확인하지 못했습니다.');
  const missing = () => {
    if (first.updated_at !== input.productVersion) throw Error('상품 자료가 변경되었습니다. 최신 저장값으로 다시 만들어주세요.');
    return null;
  };
  if (!productImageKeys(first.image_keys).includes(input.key)) return missing();
  const content = (await read<{ content: ProductContent }>(path + '/content')).content;
  if (content?.productId !== input.productId || !Number.isSafeInteger(content.revision)) throw Error('첨부 대상 콘텐츠를 확인하지 못했습니다.');
  if (!content.assets[input.section].value.includes(input.key)) return missing();
  if (content.revision <= input.contentRevision) throw Error('PNG 첨부의 저장 버전을 확인하지 못했습니다.');
  let options = emptyProductOptions(input.productId);
  if (input.section === 'size') {
    const state = await read<{ options: ProductOptions; productVersion: string }>(path + '/options');
    if (state.options?.productId !== input.productId || state.options.revision !== input.optionRevision || state.productVersion !== first.updated_at) throw Error('사이즈표 확인 중 옵션이 변경되었습니다. 최신 저장값으로 다시 만들어주세요.');
    options = state.options;
  }
  if (JSON.stringify(documentImagePlan(input.section, content, options)) !== JSON.stringify(input.plan)) throw Error('PNG를 만든 뒤 표시사항 또는 옵션이 변경되었습니다. 최신 저장값으로 다시 만들어주세요.');
  const last = (await read<{ product: Product }>(path)).product;
  if (last?.id !== input.productId || last.updated_at !== first.updated_at || last.image_keys !== first.image_keys) throw Error('첨부 확인 중 상품이 변경되었습니다. 저장 상태를 다시 확인해주세요.');
  // Content and option revisions can advance without a different product
  // timestamp. Compare them independently before acknowledging the saved PNG.
  const finalContent = (await read<{ content: ProductContent }>(path + '/content')).content;
  if (finalContent?.productId !== input.productId || finalContent.revision !== content.revision) throw Error('첨부 확인 중 콘텐츠가 변경되었습니다. 저장 상태를 다시 확인해주세요.');
  if (input.section === 'size') {
    const finalOptions = await read<{ options: ProductOptions; productVersion: string }>(path + '/options');
    if (finalOptions.options?.productId !== input.productId || finalOptions.options.revision !== options.revision || finalOptions.productVersion !== first.updated_at) throw Error('첨부 확인 중 옵션이 변경되었습니다. 저장 상태를 다시 확인해주세요.');
  }
  return last.updated_at;
}
