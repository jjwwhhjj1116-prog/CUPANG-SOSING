import { renderDocument } from '@/app/document-image-render';
import { PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-pool-limit';
import { productLabelPlan } from '@/app/product-label';
import { currentLabelHan } from '@/app/product-label-current-rules';
import { readProductLabelJson } from '@/app/product-label-read-response';
import { readProductLabelReferences } from '@/app/product-label-references';
import { completeProductLabelSave } from '@/app/product-label-save';
import type { ProductLabelUploadCache } from '@/app/product-label-upload';
import type { ProductContent } from '@/app/product-content';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import type { CollectionJob } from '@/app/sourcing';
import { validateSettings } from '@/app/workspace-settings';
import type { ProductRecord } from '@/db/queries';

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const changed = () => Error('표시사항을 준비하는 동안 상품·옵션 또는 저장값이 변경되었습니다. 최신 저장본을 확인해주세요.');

/** Called only for the product confirmed freshly promoted by this SEO+가격 run. */
export async function prepareIntakeProductLabel(productId: string, job: CollectionJob, { fetcher, signal }: { fetcher: typeof fetch; signal: AbortSignal }) {
  const base = '/api/products/' + encodeURIComponent(productId);
  const scope = { productId, endpoint: base + '/product-labels', quotationEndpoint: base + '/quotation-fields', optionId: null };
  const assertCurrent = () => signal.throwIfAborted();
  const request: typeof fetch = async (url, init) => {
    assertCurrent();
    const response = await fetcher(url, { ...init, credentials: 'same-origin', redirect: 'error', signal });
    assertCurrent();
    return response;
  };
  let owner: string | undefined;
  async function verifyDraftProduct(version: string) {
    const { product } = await readProductLabelJson<{ product: ProductRecord & { hub_receipt?: unknown; hub_single_receipt?: unknown } }>(base, request);
    if (!product || product.id !== productId || !product.owner_id || owner && product.owner_id !== owner || product.source_url !== job.source_url
      || product.goal_stage !== 'price' || product.updated_at !== version || product.registration_status !== '수집 원문 반영'
      || product.quote_status !== '대기' || product.supplier_hub_status !== '미전송' || product.hub_receipt || product.hub_single_receipt) throw changed();
    owner = product.owner_id;
    return product;
  }

  let confirmed = 0, total = 0;
  try {
    const initial = await readProductLabelReferences(scope, request);
    const { view, quotation } = initial;
    const context = job.context, category = context?.category;
    if (!category || !context.company || view.categoryContext.source !== 'collection' || view.categoryContext.profileId !== category.id
      || view.categoryContext.categoryId !== category.categoryId || !same(view.categoryContext.categoryPath, category.categoryPath)) throw changed();
    const product = await verifyDraftProduct(view.productVersion);
    const { content } = await readProductLabelJson<{ content: ProductContent }>(base + '/content', request);
    if (content.productId !== productId || content.revision !== view.contentRevision || content.quotationWorkflow !== 'collected-native-v1') throw changed();
    const capturedSettings = validateSettings(context.settings);
    const initialManual = { manufacturer: capturedSettings.manufacturer, importer: capturedSettings.importer, contact: capturedSettings.serviceContact };
    const hasManualLabelEdit = Object.entries(content.label).some(([key, field]) => field.provenance === 'manual' &&
      (field.updatedAt !== product.created_at || !Object.hasOwn(initialManual, key) || field.value !== initialManual[key as keyof typeof initialManual]));
    const target = exactPrimaryQuotationTarget(quotation.resolved.schema.fields, 'labelImages');
    const hasReferences = [quotation.overrides, quotation.legacyOverrides].some(overrides => overrides &&
      [overrides.common, ...Object.values(overrides.options)].some(values => target.linked.some(id => Object.hasOwn(values, id))));
    if (view.revision !== 1 || !view.structure || view.renderEpoch !== undefined || view.automaticSuggestions
      || Object.keys(view.overrides.common).length || Object.keys(view.overrides.options).length
      || content.assets.label.provenance === 'manual' || content.assets.label.value.length || hasManualLabelEdit
      || hasReferences || quotation.resolved.rows.some(row => target.linked.some(id => row.fields[id]?.value !== '')))
      return '기존 표시사항 입력 또는 이미지 선택을 유지했습니다. 6단계에서 저장본을 확인해주세요.';

    const included = view.rows.filter(row => row.optionId !== null && row.included);
    total = included.length;
    if (!total) throw Error('견적에 포함된 옵션을 확인해주세요.');
    for (const row of included) {
      if (!row.values.productName.trim() || !row.values.countryOfOrigin.trim()) throw Error('제품명과 확인된 제조국을 6단계에서 확인해주세요.');
      const plan = productLabelPlan(view, row.optionId);
      if (plan.rows.some(([, value]) => currentLabelHan(value))) throw Error('번역이 필요한 표시사항을 6단계에서 확인해주세요.');
    }
    if (view.imageKeys.length + included.length > PRODUCT_IMAGE_POOL_LIMIT)
      throw Error('표시사항 PNG를 저장할 상품 이미지 공간이 부족합니다. 6단계에서 확인해주세요.');

    const cache = new Map<string, ProductLabelUploadCache>();
    let basis = initial;
    for (const { optionId } of included) {
      const saved = await completeProductLabelSave({
        ...scope, optionId, view: basis.view, cache, render: renderDocument, assertCurrent,
        beforeWrite: async (current, currentQuote, key) => {
          const ownPool = key !== null && same(current.imageKeys, [...basis.view.imageKeys, key]);
          const unchanged = current.productVersion === basis.view.productVersion && same(current.imageKeys, basis.view.imageKeys);
          if ((!unchanged && !ownPool) || current.revision !== basis.view.revision || !same(current.rows, basis.view.rows)
            || current.contentRevision !== basis.view.contentRevision || current.optionRevision !== basis.view.optionRevision
            || currentQuote.revision !== basis.quotation.revision || !same(currentQuote.overrides, basis.quotation.overrides)
            || !same(currentQuote.legacyOverrides, basis.quotation.legacyOverrides) || !same(current.categoryContext, basis.view.categoryContext)
            || !same(exactPrimaryQuotationTarget(currentQuote.resolved.schema.fields, 'labelImages'), target)) throw changed();
          await verifyDraftProduct(current.productVersion);
        },
      }, request);
      const row = saved.quotation.resolved.rows.find(row => row.optionId === optionId);
      if (!target.linked.every(field => row?.fields[field]?.value === saved.key)) throw changed();
      confirmed++;
      basis = { view: saved.view, quotation: saved.quotation, keys: [saved.key] };
    }
    return '표시사항 PNG를 저장하고 ' + confirmed + '개 포함 옵션의 견적에 연결했습니다. 6단계에서 내용을 검토해주세요.';
  } catch (error) {
    if (signal.aborted) return '';
    const count = total ? ' ' + confirmed + '/' + total + '개 옵션 연결 확인.' : '';
    return '표시사항 PNG 연결 미완료.' + count + ' ' + (error instanceof Error ? error.message : '6단계에서 저장 결과를 확인해주세요.');
  }
}
