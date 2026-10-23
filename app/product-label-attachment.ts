import { PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-pool-limit';
import { productLabelPlan, verifyProductLabelsView, type ProductLabelsView } from '@/app/product-label';
import { applyQuotationChanges, validateQuotationChanges, type QuotationChange, type QuotationFieldsView } from '@/app/quotation-schema';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import { findProductLabelUpload, productLabelPreviewSignature } from '@/app/product-label-upload';
import { productLabelProofRequest, readProductLabelReceipt } from '@/app/product-label-proof';
import { labelUploadDigest } from '@/app/label-upload-key';
import { productLabelResponseJson } from '@/app/product-label-read-response';

type Input = { productId: string; endpoint: string; quotationEndpoint: string; renderedView: ProductLabelsView; optionId: string | null;
  blob: Blob | null; uploadedKey: string | null; onUploaded: (key: string) => void };
export type ProductLabelAttachment = { view: ProductLabelsView; quotation: QuotationFieldsView; key: string };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const keys = (value: string) => value.split('\n').map(key => key.trim()).filter(Boolean);
const changed = () => Error('PNG 생성 후 카테고리 또는 제품 표시사항 값이 변경되었습니다. 최신 저장값으로 다시 만들어주세요.');

/** Explicit regeneration changes final references only in the exact proven
 * product/option/profile/category scope. All original objects remain stored. */
export async function productLabelReferenceSelection(input: { productId: string; view: QuotationFieldsView; optionId: string | null; renderEpoch?: number }, key: string | null, request: typeof fetch = fetch) {
  const { view } = input, target = exactPrimaryQuotationTarget(view.resolved.schema.fields,'labelImages');
  const rows = view.resolved.rows.filter(row => row.optionId === input.optionId), row = rows[0];
  if (rows.length !== 1 || target.fields.some(field => field.readOnly || typeof row.fields[field.id]?.value !== 'string')) throw Error('제품 표시사항의 옵션·이미지 연결을 확인해주세요.');
  const value = row.fields[target.primary].value;
  if (value.trim()) validateQuotationChanges([{optionId:input.optionId,fieldKey:target.primary,value}], {
    schema:view.resolved.schema,optionIds:view.resolved.rows.flatMap(row=>row.optionId?[row.optionId]:[]),ownedImageKeys:view.imageKeys,overrides:view.overrides });
  const previous = keys(value), retained: string[] = [], categorySha256 = await labelUploadDigest(new TextEncoder().encode(JSON.stringify([view.categoryContext.categoryId,view.categoryContext.categoryPath])));
  const own = input.optionId === null ? undefined : view.overrides.options[input.optionId];
  const inheritedCommon = input.optionId !== null && typeof input.renderEpoch === 'number' && Number.isSafeInteger(input.renderEpoch) && input.renderEpoch > 0
    && target.linked.every(id => (!own || !Object.hasOwn(own,id)) && Object.hasOwn(view.overrides.common,id) && view.overrides.common[id] === value && row.fields[id]?.value === value);
  for (const oldKey of previous) {
    const candidate = /^[^/\\\s%?#]+\/quotation-label-([a-f0-9]{64})\.png$/.exec(oldKey);
    if (oldKey === key || !candidate) { retained.push(oldKey); continue; }
    const receipt = await readProductLabelReceipt(candidate[1],request);
    if (receipt.key !== null && receipt.key !== oldKey) throw Error('기존 제품 라벨 파일의 소유자 응답을 확인하지 못했습니다.');
    const proof = receipt.proof;
    const sameScope = proof && proof.productId === input.productId && proof.profileId === view.categoryContext.profileId && proof.categorySha256 === categorySha256;
    // A rewrite may replace an inherited old common PNG in this new option
    // override only. Explicit option selections, common storage and all files
    // remain untouched; unrelated/same-generation references stay protected.
    const priorInheritedCommon = inheritedCommon && proof && sameScope && proof.optionId === null && (proof.renderEpoch ?? 0) !== input.renderEpoch;
    if (!proof || !sameScope || proof.optionId !== input.optionId && !priorInheritedCommon) retained.push(oldKey);
  }
  return { target, previous, retained, next:key&&!retained.includes(key)?[...retained,key]:retained };
}

/** Durable upload lookup and independent pool/reference CAS steps make retries
 * read-first. Neither a source conflict nor a lost response creates a new PNG. */
export async function attachProductLabel(input: Input, request: typeof fetch = fetch): Promise<ProductLabelAttachment> {
  const expectedSignature = productLabelPreviewSignature({ ...input, view: input.renderedView });
  const base = `/api/products/${encodeURIComponent(input.productId)}`;
  const labelUrl = new URL(input.endpoint, 'https://local.invalid'), quoteUrl = new URL(input.quotationEndpoint, 'https://local.invalid');
  if (labelUrl.origin !== 'https://local.invalid' || quoteUrl.origin !== 'https://local.invalid' || labelUrl.pathname !== `${base}/product-labels`
    || quoteUrl.pathname !== `${base}/quotation-fields` || labelUrl.search !== quoteUrl.search || labelUrl.hash || quoteUrl.hash
    || [...labelUrl.searchParams.keys()].some(key => key !== 'profileId') || labelUrl.searchParams.getAll('profileId').length > 1)
    throw Error('제품 표시사항과 견적서의 상품·카테고리 연결을 확인해주세요.');
  const [expectedPlanSha256,expectedCategorySha256]=await Promise.all([
    labelUploadDigest(new TextEncoder().encode(JSON.stringify(productLabelPlan(input.renderedView,input.optionId)))),
    labelUploadDigest(new TextEncoder().encode(JSON.stringify([input.renderedView.categoryContext.categoryId,input.renderedView.categoryContext.categoryPath]))),
  ]);
  async function read<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await request(url, { cache: 'no-store', credentials: 'same-origin', redirect: 'error', ...init });
    return productLabelResponseJson<T>(response, url, init?.method ?? 'GET');
  }
  function validateLabel(view: ProductLabelsView) {
    verifyProductLabelsView(view, input.optionId);
    if (view.productId !== input.productId || view.revision < input.renderedView.revision || Date.parse(view.productVersion) < Date.parse(input.renderedView.productVersion)
      || productLabelPreviewSignature({ ...input, view }) !== expectedSignature) throw changed();
  }
  function validateQuotation(view: QuotationFieldsView, labels: ProductLabelsView) {
    if (!view || !Array.isArray(view.resolved?.schema?.fields) || !Array.isArray(view.resolved.rows) || !Array.isArray(view.automatic?.rows)
      || !view.overrides?.common || !view.overrides.options || !Array.isArray(view.imageKeys)
      || view.productVersion !== labels.productVersion || view.revision !== labels.quotationRevision || view.inputFingerprint !== labels.quotationInputFingerprint
      || view.contentRevision !== labels.contentRevision || view.optionRevision !== labels.optionRevision
      || !same(view.imageKeys, labels.imageKeys) || !same(view.categoryContext, labels.categoryContext)
      || view.resolved.rows.filter(row => row.optionId === input.optionId).length !== 1) throw changed();
    const target = exactPrimaryQuotationTarget(view.resolved.schema.fields, 'labelImages'), row = view.resolved.rows.find(row => row.optionId === input.optionId)!;
    if (target.fields.some(field => field.readOnly || typeof row.fields[field.id]?.value !== 'string')) throw Error('견적서의 제품 표시사항 이미지 연결을 확인해주세요.');
    return { target, row };
  }
  async function pair() {
    const view = await read<ProductLabelsView>(input.endpoint); validateLabel(view);
    const quotation = await read<QuotationFieldsView>(input.quotationEndpoint); validateQuotation(quotation, view);
    const confirmed = await read<ProductLabelsView>(input.endpoint); validateLabel(confirmed); validateQuotation(quotation, confirmed);
    if (view.revision !== confirmed.revision || view.inputFingerprint !== confirmed.inputFingerprint) throw changed();
    return { view: confirmed, quotation };
  }
  function selection(state: Awaited<ReturnType<typeof pair>>, key: string | null) {
    validateQuotation(state.quotation,state.view);
    return productLabelReferenceSelection({productId:input.productId,view:state.quotation,optionId:input.optionId,renderEpoch:state.view.renderEpoch},key,request);
  }
  function verifyWrite(before: QuotationFieldsView, saved: QuotationFieldsView, changes: readonly QuotationChange[]) {
    const expected = applyQuotationChanges(before.overrides, changes), row = saved.resolved.rows.find(row => row.optionId === input.optionId);
    if (saved.revision !== before.revision + 1 || saved.updatedAt !== saved.productVersion || !Number.isFinite(Date.parse(saved.productVersion))
      || Date.parse(saved.productVersion) <= Date.parse(before.productVersion) || saved.contentRevision !== before.contentRevision || saved.optionRevision !== before.optionRevision
      || !same(saved.categoryContext, before.categoryContext) || !same(saved.imageKeys, before.imageKeys)
      || !same(exactPrimaryQuotationTarget(saved.resolved.schema.fields, 'labelImages'), exactPrimaryQuotationTarget(before.resolved.schema.fields, 'labelImages'))
      || !same(saved.overrides, expected) || changes.some(change => row?.fields[change.fieldKey]?.value !== change.value))
      throw Error('선택한 제품 표시사항 PNG 연결 응답을 확인하지 못했습니다. 저장본을 다시 확인해주세요.');
  }
  let state = await pair(), key = input.uploadedKey;
  const stored = await findProductLabelUpload({ ...input, view: input.renderedView }, request);
  async function verifyUpload(nextKey: string) {
    const receipt=await readProductLabelReceipt(stored.uploadId,request),proof=receipt.proof;
    if (receipt.key!==nextKey || !proof || proof.productId!==input.productId || proof.optionId!==input.optionId || proof.renderEpoch!==input.renderedView.renderEpoch
      || proof.profileId!==input.renderedView.categoryContext.profileId || proof.categorySha256!==expectedCategorySha256 || proof.planSha256!==expectedPlanSha256)
      throw Error('저장한 PNG의 제품 표시사항 원천을 확인하지 못했습니다. 상품·옵션·카테고리와 저장한 9행 내용을 다시 확인해주세요.');
  }
  if (key && key !== stored.key) throw Error('이 표시사항의 저장된 PNG 업로드 번호를 확인하지 못했습니다.');
  key = stored.key;
  if (key) await verifyUpload(key);
  let current = await selection(state,key);
  if (key) input.onUploaded(key);
  const limit = Math.min(...current.target.fields.map(field => field.maxItems ?? 30));
  if (current.retained.length + (key&&current.retained.includes(key)?0:1) > limit || state.quotation.imageKeys.length >= PRODUCT_IMAGE_POOL_LIMIT && (!key || !state.quotation.imageKeys.includes(key))) throw Error('표시사항 이미지 또는 상품 이미지 한도에 도달했습니다. 기존 첨부를 확인해주세요.');
  if (!key) {
    if (!input.blob || input.blob.type !== 'image/png' || input.blob.size < 1 || input.blob.size > 10 * 1024 * 1024) throw Error('내용이 있는 표시사항 PNG를 먼저 만들어주세요.');
    const form = new FormData(); form.set('file', new File([input.blob], 'sourceflow-quotation-label.png', { type: 'image/png' })); form.set('labelUploadId', stored.uploadId);
    form.set('productLabelProof',JSON.stringify(productLabelProofRequest({productId:input.productId,optionId:input.optionId,endpoint:input.endpoint,view:state.view})));
    let uploaded: { key?: string; contentType?: string; size?: number } | null = null;
    try { uploaded = await read<{ key?: string; contentType?: string; size?: number }>('/api/files', { method: 'POST', body: form }); }
    catch (cause) {
      // POST can commit before its response is lost. Only the owner-scoped
      // recipe receipt proves the existing object; this lookup is read only.
      const recovered = await findProductLabelUpload({ ...input, view: input.renderedView }, request);
      if (!recovered.key) throw cause; key = recovered.key;
    }
    if (uploaded) {
      if (typeof uploaded.key !== 'string' || !uploaded.key || uploaded.key.length > 512 || uploaded.contentType !== 'image/png' || uploaded.size !== input.blob.size) throw Error('제품 표시사항 PNG 업로드 응답을 확인하지 못했습니다.');
      // A successful POST acknowledgement must name this exact owner's
      // durable recipe object before any pool/reference write is allowed.
      const receipt = await findProductLabelUpload({ ...input, view: input.renderedView }, request);
      if (receipt.key !== uploaded.key) throw Error('제품 표시사항 PNG 업로드 응답과 저장된 파일 번호가 다릅니다. 저장본을 다시 확인해주세요.');
      key = receipt.key;
    }
    if (!key) throw Error('제품 표시사항 PNG 업로드 저장본을 확인하지 못했습니다.');
    await verifyUpload(key);
    input.onUploaded(key);
  }
  // Re-read all nine saved values after the upload and before its pool write.
  state = await pair(); current = await selection(state,key);
  if (!state.quotation.imageKeys.includes(key)) {
    try { await read(`${base}/attachments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, role: null, expectedVersion: state.view.productVersion, expectedContentRevision: state.view.contentRevision }) }); }
    catch (cause) { const recovered = await pair(); if (!recovered.quotation.imageKeys.includes(key)) throw cause; state = recovered; }
  }
  state = await pair(); current = await selection(state,key);
  if (!state.quotation.imageKeys.includes(key)) throw Error('표시사항 PNG가 상품 이미지 목록에 연결됐는지 확인하지 못했습니다.');
  if (current.next.length > limit) throw Error('표시사항 이미지 한도입니다. 업로드한 파일은 보존하고 견적 연결은 추가하지 않았습니다.');
  const value = current.next.join('\n'), row = state.quotation.resolved.rows.find(row=>row.optionId===input.optionId)!;
  if (current.target.linked.every(id=>row.fields[id].value===value)) {
    const confirmed=await pair();
    if (confirmed.view.revision!==state.view.revision || confirmed.view.inputFingerprint!==state.view.inputFingerprint
      || confirmed.quotation.revision!==state.quotation.revision || confirmed.quotation.productVersion!==state.quotation.productVersion || confirmed.quotation.inputFingerprint!==state.quotation.inputFingerprint
      || !same(confirmed.quotation.imageKeys,state.quotation.imageKeys) || !same(confirmed.quotation.overrides,state.quotation.overrides)
      || !same(exactPrimaryQuotationTarget(confirmed.quotation.resolved.schema.fields,'labelImages'),current.target)) throw changed();
    return {...confirmed,key};
  }
  const changes = validateQuotationChanges(current.target.linked.map(fieldKey => ({ fieldKey, optionId: input.optionId, value })), {
    schema: state.quotation.resolved.schema, optionIds: state.quotation.resolved.rows.flatMap(row => row.optionId ? [row.optionId] : []), ownedImageKeys: state.quotation.imageKeys, overrides: state.quotation.overrides });
  const before = state.quotation;
  let acknowledged: QuotationFieldsView;
  try {
    acknowledged = await read<QuotationFieldsView>(input.quotationEndpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: before.revision, expectedInputFingerprint: before.inputFingerprint, changes }) });
    verifyWrite(before, acknowledged, changes);
  } catch (cause) {
    const recovered = await pair();
    try { verifyWrite(before, recovered.quotation, changes); } catch { throw cause; }
    if (!keys(validateQuotation(recovered.quotation,recovered.view).row.fields[current.target.primary].value).includes(key)) throw cause;
    return { ...recovered, key };
  }
  const final = await pair(); verifyWrite(before, final.quotation, changes);
  if (final.quotation.revision !== acknowledged.revision || final.quotation.productVersion !== acknowledged.productVersion
    || final.quotation.inputFingerprint !== acknowledged.inputFingerprint || !keys(validateQuotation(final.quotation,final.view).row.fields[current.target.primary].value).includes(key)) throw changed();
  // The final nine-row GET carries the product clock after the pool + q writes.
  productLabelPlan(final.view, input.optionId);
  return { ...final, key };
}
