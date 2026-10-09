import { applyQuotationChanges, validateQuotationChanges, type QuotationChange, type QuotationFieldsView } from '@/app/quotation-schema';
import { quotationLabelPlan } from '@/app/quotation-label-plan';
import { findQuotationLabelUpload, readQuotationLabelReceipt } from '@/app/quotation-label-upload';
import { parseQuotationLabelProofRequest, quotationLabelProofRequest } from '@/app/quotation-label-proof';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import { labelUploadDigest } from '@/app/label-upload-key';

/** One reviewed PNG retained by the form across saved-view panel remounts. */
export type QuotationLabelUploadCache = { signature: string | null; uploadedKey: string | null; rendered: { blob: Blob; width: number; height: number } | null };
type Input = {
  productId: string; endpoint: string; renderedView: QuotationFieldsView; optionId: string | null;
  blob: Blob | null; uploadedKey: string | null; onUploaded: (key: string) => void;
};
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const splitKeys = (value: string) => value.split('\n').map(key => key.trim()).filter(Boolean);
const changed = () => Error('PNG 생성 후 카테고리 또는 표시사항 값이 변경되었습니다. 최신 견적으로 PNG를 다시 만들어주세요.');

/** Explicit regeneration replaces only server-proven PNG references from this
 * exact product, option and category. Manual/legacy files and stored bytes stay. */
export async function quotationLabelReferenceSelection(input: { productId: string; view: QuotationFieldsView; optionId: string | null }, key: string | null, request: typeof fetch = fetch) {
  const { view } = input, target = exactPrimaryQuotationTarget(view.resolved.schema.fields, 'labelImages');
  const rows = view.resolved.rows.filter(row => row.optionId === input.optionId), row = rows[0];
  if (rows.length !== 1 || !row.included || target.fields.some(field => field.readOnly || typeof row.fields[field.id]?.value !== 'string')) throw Error('견적 표시사항의 옵션·이미지 연결을 확인해주세요.');
  const value = row.fields[target.primary].value;
  if (value.trim()) validateQuotationChanges([{ fieldKey: target.primary, optionId: input.optionId, value }], {
    schema: view.resolved.schema, optionIds: view.resolved.rows.flatMap(row => row.optionId ? [row.optionId] : []), ownedImageKeys: view.imageKeys, overrides: view.overrides,
  });
  const previous = splitKeys(value), retained: string[] = [];
  const categorySha256 = await labelUploadDigest(new TextEncoder().encode(JSON.stringify([view.categoryContext.categoryId, view.categoryContext.categoryPath])));
  for (const oldKey of previous) {
    const candidate = /^[^/\\\s%?#]+\/quotation-label-([a-f0-9]{64})\.png$/.exec(oldKey);
    if (oldKey === key || !candidate) { retained.push(oldKey); continue; }
    const receipt = await readQuotationLabelReceipt(candidate[1], request);
    if (receipt.key !== null && receipt.key !== oldKey) throw Error('기존 라벨 파일의 소유자 응답을 확인하지 못했습니다.');
    const proof = receipt.proof;
    if (!proof || proof.productId !== input.productId || proof.optionId !== input.optionId || proof.profileId !== view.categoryContext.profileId
      || proof.categorySha256 !== categorySha256) retained.push(oldKey);
  }
  return { target, previous, retained, next: key && !retained.includes(key) ? [...retained, key] : retained };
}

/** Read-first retries retain uploaded objects; only the explicitly regenerated
 * option's proven reference is replaced after fresh source and CAS checks. */
export async function attachQuotationLabel(input: Input, request: typeof fetch = fetch): Promise<QuotationFieldsView> {
  parseQuotationLabelProofRequest(quotationLabelProofRequest({ ...input, view: input.renderedView }));
  const expectedPlan = quotationLabelPlan(input.renderedView.resolved, input.optionId);
  async function read<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await request(url, { cache: 'no-store', ...init }), body = await response.json() as T & { error?: string };
    if (!response.ok) throw Error(body?.error || '표시사항 이미지 연결을 저장하지 못했습니다.'); return body;
  }
  function validate(view: QuotationFieldsView) {
    if (!view?.resolved || !Array.isArray(view.imageKeys) || !Number.isSafeInteger(view.revision) || view.revision < 0 || !/^[a-f0-9]{64}$/.test(view.inputFingerprint)
      || !Number.isSafeInteger(view.contentRevision) || view.contentRevision < 0 || !Number.isSafeInteger(view.optionRevision) || view.optionRevision < 0
      || !view.overrides?.common || !view.overrides.options || !Number.isFinite(Date.parse(view.productVersion))
      || view.revision < input.renderedView.revision || Date.parse(view.productVersion) < Date.parse(input.renderedView.productVersion)
      || view.resolved.schema.categoryId !== input.renderedView.resolved.schema.categoryId
      || !same(view.categoryContext, input.renderedView.categoryContext)
      || !same(quotationLabelPlan(view.resolved, input.optionId), expectedPlan)) throw changed();
    return view;
  }
  const latest = async () => validate(await read<QuotationFieldsView>(input.endpoint));
  const selection = (view: QuotationFieldsView, key: string | null) => quotationLabelReferenceSelection({ productId: input.productId, view, optionId: input.optionId }, key, request);
  function verifyWrite(before: QuotationFieldsView, saved: QuotationFieldsView, changes: readonly QuotationChange[]) {
    validate(saved);
    const row = saved.resolved.rows.find(row => row.optionId === input.optionId);
    if (saved.revision !== before.revision + 1 || saved.updatedAt !== saved.productVersion || Date.parse(saved.productVersion) <= Date.parse(before.productVersion)
      || saved.contentRevision !== before.contentRevision || saved.optionRevision !== before.optionRevision
      || !same(saved.imageKeys, before.imageKeys) || !same(saved.categoryContext, before.categoryContext)
      || !same(exactPrimaryQuotationTarget(saved.resolved.schema.fields, 'labelImages'), exactPrimaryQuotationTarget(before.resolved.schema.fields, 'labelImages'))
      || !same(saved.overrides, applyQuotationChanges(before.overrides, changes)) || changes.some(change => row?.fields[change.fieldKey]?.value !== change.value)) throw Error('최종 라벨 연결 응답을 확인하지 못했습니다. 저장본을 다시 확인해주세요.');
  }
  let view = await latest();
  const stored = await findQuotationLabelUpload({ ...input, view: input.renderedView }, request);
  if (input.uploadedKey && input.uploadedKey !== stored.key) throw Error('이 표시사항의 저장된 PNG 업로드 번호를 확인하지 못했습니다.');
  let key = stored.key, current = await selection(view, key);
  if (key) input.onUploaded(key);
  const limit = Math.min(...current.target.fields.map(field => field.maxItems ?? 30));
  if (current.retained.length + (key && current.retained.includes(key) ? 0 : 1) > limit
    || view.imageKeys.length >= 50 && (!key || !view.imageKeys.includes(key))) throw Error('라벨 또는 상품 이미지 한도입니다. 기존 첨부를 확인해주세요.');
  if (!key) {
    if (!input.blob || input.blob.type !== 'image/png' || input.blob.size < 1 || input.blob.size > 10 * 1024 * 1024) throw Error('내용이 있는 PNG를 먼저 생성해주세요.');
    const form = new FormData(); form.set('file', new File([input.blob], 'sourceflow-quotation-label.png', { type: 'image/png' }));
    form.set('labelUploadId', stored.uploadId);
    form.set('quotationLabelProof', JSON.stringify(quotationLabelProofRequest({ ...input, view })));
    let uploaded: { key?: string; contentType?: string; size?: number } | null = null;
    try { uploaded = await read('/api/files', { method: 'POST', body: form }); }
    catch (cause) { const recovered = await findQuotationLabelUpload({ ...input, view: input.renderedView }, request); if (!recovered.key) throw cause; key = recovered.key; }
    if (uploaded) {
      if (typeof uploaded.key !== 'string' || uploaded.contentType !== 'image/png' || uploaded.size !== input.blob.size) throw Error('PNG 업로드 응답을 확인하지 못했습니다.');
      const receipt = await findQuotationLabelUpload({ ...input, view: input.renderedView }, request);
      if (receipt.key !== uploaded.key) throw Error('PNG 업로드 응답과 저장된 파일 번호가 다릅니다.'); key = receipt.key;
    }
    if (!key) throw Error('PNG 업로드 저장본을 확인하지 못했습니다.'); input.onUploaded(key);
  }
  view = await latest(); current = await selection(view, key);
  if (!view.imageKeys.includes(key)) {
    try { await read('/api/products/' + encodeURIComponent(input.productId) + '/attachments', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, role: null, expectedVersion: view.productVersion, expectedContentRevision: view.contentRevision }) }); }
    catch (cause) { const recovered = await latest(); if (!recovered.imageKeys.includes(key)) throw cause; }
  }
  view = await latest(); current = await selection(view, key);
  if (!view.imageKeys.includes(key)) throw Error('상품 이미지 연결을 확인하지 못했습니다. 다시 시도해주세요.');
  const next = current.next.join('\n');
  const row = view.resolved.rows.find(row => row.optionId === input.optionId)!;
  if (current.target.linked.every(id => row.fields[id].value === next)) {
    const confirmed = await latest();
    if (confirmed.revision !== view.revision || confirmed.productVersion !== view.productVersion || confirmed.inputFingerprint !== view.inputFingerprint
      || !same(confirmed.imageKeys, view.imageKeys) || !same(confirmed.overrides, view.overrides)
      || !same(exactPrimaryQuotationTarget(confirmed.resolved.schema.fields, 'labelImages'), current.target)) throw changed();
    return confirmed;
  }
  const changes = validateQuotationChanges(current.target.linked.map(fieldKey => ({ fieldKey, optionId: input.optionId, value: next })), {
    schema: view.resolved.schema, optionIds: view.resolved.rows.flatMap(row => row.optionId ? [row.optionId] : []), ownedImageKeys: view.imageKeys, overrides: view.overrides,
  });
  let acknowledged: QuotationFieldsView;
  try {
    acknowledged = await read(input.endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes }) }); verifyWrite(view, acknowledged, changes);
  } catch (cause) {
    const recovered = await latest(); try { verifyWrite(view, recovered, changes); } catch { throw cause; } return recovered;
  }
  const final = await latest(); verifyWrite(view, final, changes);
  if (final.productVersion !== acknowledged.productVersion || final.inputFingerprint !== acknowledged.inputFingerprint) throw changed();
  return final;
}
