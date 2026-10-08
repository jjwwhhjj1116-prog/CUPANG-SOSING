import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { findProduct } from '@/db/queries';
import { readProductContent } from '@/db/product-content';
import { readProductOptions } from '@/db/product-options';
import { attachProductDocument } from '@/db/product-attachments';
import { applyProductImageTranslation } from '@/db/product-image-translation';
import { attachQuotationImageTranslation } from '@/db/quotation-fields';
import { stableQuotationFieldsView, QuotationFieldsSnapshotError } from '@/app/quotation-fields-snapshot';
import { exactPrimaryQuotationTarget } from '@/app/quotation-seo-targets';
import { quotationImageKeys } from '@/app/quotation-image-targets';
import { applyQuotationChanges, validateQuotationChanges } from '@/app/quotation-schema';
import { PublicDetailError } from '@/app/quotation-public-detail';
import { applyContentPatch, productImageKeys } from '@/app/product-content';
import { inspectImage } from '@/app/automation/image-edit';
import { translateImageRegions } from '@/app/automation/free-image-text';
import { isOwnedImageKey, MAX_IMAGE_BYTES, MAX_IMAGE_MULTIPART_BYTES } from '@/app/image-files';
import { MAX_OCR_PIXELS, validFreeImageRole, validateFreeImageSource, validateImageTextRegions,
  freeImageSourceIdentity, freeImageApplyIdentity, validateFreeImageOptionIds, type FreeImageSource, type FreeImageQuotationTarget } from '@/app/free-image-translation';
import { readBoundedBytes, readBoundedJson, readBoundedStream, RequestBodyError } from '@/app/request-body';

type Context = { params: Promise<{ id: string }> };
class ImageTextError extends Error {
  constructor(public status: 400 | 404 | 409 | 413 | 415 | 503, message: string) { super(message); }
}
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
const changed = () => new ImageTextError(409, '번역 중 원본 이미지나 저장 내용이 변경되었습니다. 최신 이미지를 다시 불러와주세요.');
async function digest(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function ownerId() {
  const user = await getChatGPTUser();
  if ((process.env.NODE_ENV === 'production' || (env as { YOOFAM_AUTH_ENABLED?: string }).YOOFAM_AUTH_ENABLED === 'true') && !user?.verifiedAccess) throw new ImageTextError(503, '로그인 후 이미지 문구를 번역할 수 있습니다.');
  return user?.userId ?? await getWorkspaceOwnerId();
}
async function state(owner: string, id: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new ImageTextError(400, '상품 번호를 확인해주세요.');
  const product = await findProduct(owner, id);
  if (!product) throw new ImageTextError(404, '상품을 찾을 수 없습니다.');
  return { product, content: await readProductContent(owner, id), keys: productImageKeys(product.image_keys) };
}
async function readImage(key: string) {
  if (!env.FILES) throw new ImageTextError(503, '이미지 저장소가 연결되지 않았습니다.');
  const object = await env.FILES.get(key);
  if (!object) throw new ImageTextError(409, '원본 이미지 파일을 다시 확인해주세요.');
  if (object.size < 1 || object.size > MAX_IMAGE_BYTES) throw new ImageTextError(413, '이미지 한 장은 10MB 이하여야 합니다.');
  const bytes = await readBoundedStream(object.body, MAX_IMAGE_BYTES);
  if (bytes.length !== object.size) throw new ImageTextError(503, '이미지 파일을 끝까지 읽지 못했습니다.');
  let dimensions;
  try { dimensions = inspectImage(bytes); }
  catch { throw new ImageTextError(415, 'PNG·JPEG·WebP 정지 이미지만 번역할 수 있습니다.'); }
  if (dimensions.width * dimensions.height > MAX_OCR_PIXELS) throw new ImageTextError(413, '이미지 번역은 1,200만 픽셀 이하에서 사용할 수 있습니다.');
  return { object, bytes, dimensions };
}
async function original(owner: string, id: string, sourceKey: string, role: FreeImageSource['role'], current: Awaited<ReturnType<typeof state>>, requireRole: boolean, includeOptions = false) {
  if (!isOwnedImageKey(owner, sourceKey) || !current.keys.includes(sourceKey)) throw new ImageTextError(404, '이 상품에 저장된 본인 소유 이미지를 선택해주세요.');
  const options = role === 'main' && includeOptions ? await readProductOptions(owner, id) : null;
  const optionIds = options?.rows.filter(row => row.imageKey === sourceKey).map(row => row.id).sort() ?? [];
  const commonAssigned = current.content.assets[role].value.includes(sourceKey);
  if (requireRole && !commonAssigned && !(role === 'main' && options && optionIds.length)) throw changed();
  const { bytes, dimensions } = await readImage(sourceKey);
  const source: FreeImageSource = { productId: id, productVersion: current.product.updated_at, contentRevision: current.content.revision,
    sourceKey, sourceSha256: await digest(bytes), role, width: dimensions.width, height: dimensions.height,
    ...(options ? { optionImages: { revision: options.revision, optionIds, ...(!commonAssigned ? { commonAssigned: false as const } : {}) } } : {}) };
  try { return validateFreeImageSource(source); }
  catch { throw new ImageTextError(409, '대표 이미지에 연결된 옵션 정보를 다시 확인해주세요.'); }
}
type QuotationSelection = Pick<FreeImageQuotationTarget, 'profileId' | 'optionId' | 'input' | 'fieldKey' | 'slotIndex'>;
type QuotationSnapshot = Awaited<ReturnType<typeof stableQuotationFieldsView>>;
async function quotationBinding(saved: QuotationSnapshot, input: FreeImageQuotationTarget['input'], outputKey?: string) {
  const guards = Object.fromEntries(Object.entries(saved.source).filter(([field]) => field !== 'productVersion' && field !== 'imageKeys'));
  return digest(new TextEncoder().encode(JSON.stringify({ target: exactPrimaryQuotationTarget(saved.view.resolved.schema.fields, input),
    categoryContext: saved.view.categoryContext, guards, imageKeys: saved.view.imageKeys.filter(key => key !== outputKey) })));
}
function quotationValue(source: FreeImageSource, key: string) {
  const target = source.quotationTarget!; let slot = -1;
  return target.value.split('\n').map(line => line.trim() && ++slot === target.slotIndex ? key : line).join('\n');
}
function quotationOverrides(saved: QuotationSnapshot, source: FreeImageSource, key: string) {
  const target = source.quotationTarget!, exact = exactPrimaryQuotationTarget(saved.view.resolved.schema.fields, target.input);
  const changes = validateQuotationChanges(exact.linked.map(fieldKey => ({ fieldKey, optionId: target.optionId, value: quotationValue(source, key) })),
    { schema: saved.view.resolved.schema, optionIds: saved.options.rows.map(row => row.id), ownedImageKeys: [...saved.view.imageKeys, key], overrides: saved.view.overrides });
  return applyQuotationChanges(saved.view.overrides, changes);
}
async function quotationOriginal(owner: string, id: string, sourceKey: string, role: FreeImageSource['role'], current: Awaited<ReturnType<typeof state>>, selection: QuotationSelection) {
  const saved = await stableQuotationFieldsView(owner, id, selection.profileId), view = saved.view;
  if (view.productVersion !== current.product.updated_at || view.contentRevision !== current.content.revision) throw changed();
  const target = exactPrimaryQuotationTarget(view.resolved.schema.fields, selection.input), rows = view.resolved.rows.filter(row => row.optionId === selection.optionId);
  if (selection.fieldKey !== target.primary || target.fields.some(field => field.readOnly) || rows.length !== 1) throw changed();
  const value = rows[0].fields[target.primary]?.value;
  if (typeof value !== 'string' || target.linked.some(id => rows[0].fields[id]?.value !== value) || quotationImageKeys(value)[selection.slotIndex] !== sourceKey) throw changed();
  const source = await original(owner, id, sourceKey, role, current, false);
  return validateFreeImageSource({ ...source, quotationTarget: { kind: 'quotation', ...selection, revision: view.revision, inputFingerprint: view.inputFingerprint,
    optionRevision: view.optionRevision, bindingSha256: await quotationBinding(saved, selection.input), value } });
}
async function freshSource(owner: string, id: string, source: FreeImageSource) {
  if (source.productId !== id) throw new ImageTextError(400, '번역한 상품과 저장할 상품이 다릅니다.');
  const current = await state(owner, id);
  if (current.product.updated_at !== source.productVersion || current.content.revision !== source.contentRevision) throw changed();
  const observed = source.quotationTarget ? await quotationOriginal(owner, id, source.sourceKey, source.role, current, source.quotationTarget)
    : await original(owner, id, source.sourceKey, source.role, current, true, source.optionImages !== undefined);
  if (freeImageSourceIdentity(observed) !== freeImageSourceIdentity(source)) throw changed();
  return current;
}
async function storedOutput(key: string, source: FreeImageSource, optionImageIds: string[], sha256: string, size: number) {
  if (!env.FILES) throw new ImageTextError(503, '이미지 저장소가 연결되지 않았습니다.');
  const object = await env.FILES.get(key);
  if (!object) return false;
  const identity = freeImageSourceIdentity(source), ids = JSON.stringify(optionImageIds), metadata = object.customMetadata;
  const [sourceSha256, optionIdsSha256] = await Promise.all([digest(new TextEncoder().encode(identity)), digest(new TextEncoder().encode(ids))]);
  const hashedScope = metadata?.freeImageSourceSha256 === sourceSha256 && metadata?.freeImageOptionIdsSha256 === optionIdsSha256;
  // Step 584 stored the short, common-only source proof as plain JSON. Keep
  // those deterministic retries readable, but never infer selected option
  // scope from missing metadata or downgrade a damaged hash-based record.
  const legacyScope = !source.quotationTarget && optionImageIds.length === 0 && metadata?.freeImageSource === identity && (metadata.freeImageOptionIds ?? '[]') === '[]'
    && metadata.freeImageSourceSha256 === undefined && metadata.freeImageOptionIdsSha256 === undefined;
  if (object.size !== size || object.size > MAX_IMAGE_BYTES || object.httpMetadata?.contentType !== 'image/png'
    || metadata?.freeImageOutputSha256 !== sha256 || !hashedScope && !legacyScope
    || source.quotationTarget && !/^[a-f0-9]{64}$/.test(metadata?.freeImageQuotationOverridesSha256 ?? '')) throw new ImageTextError(409, '같은 이미지 결과 번호에 다른 파일이 저장되어 있습니다.');
  const bytes = await readBoundedStream(object.body, MAX_IMAGE_BYTES);
  if (bytes.length !== size || await digest(bytes) !== sha256) throw new ImageTextError(409, '저장한 이미지 결과의 내용이 다릅니다.');
  return true;
}
async function replay(owner: string, id: string, source: FreeImageSource, optionImageIds: string[], key: string, sha256: string, size: number) {
  if (source.quotationTarget) return quotationReplay(owner, id, source, key, sha256, size);
  const current = await state(owner, id);
  const role = current.content.assets[source.role].value;
  const optionOnly = source.optionImages?.commonAssigned === false;
  if (!current.keys.includes(key) || !optionOnly && (!role.includes(key) || role.includes(source.sourceKey))) return null;
  if (optionOnly && (!optionImageIds.length || current.content.revision < source.contentRevision)) return null;
  const observed = await original(owner, id, source.sourceKey, source.role, current, false);
  if (observed.sourceSha256 !== source.sourceSha256 || observed.width !== source.width || observed.height !== source.height) return null;
  const options = optionImageIds.length ? await readProductOptions(owner, id) : null;
  if (options && (options.revision < source.optionImages!.revision + 1 || optionImageIds.some(id => options.rows.filter(row => row.id === id && row.imageKey === key).length !== 1))) return null;
  if (!await storedOutput(key, source, optionImageIds, sha256, size)) return null;
  return response({ source, key, productVersion: current.product.updated_at, contentRevision: current.content.revision, applied: true, replayed: true,
    ...(options ? { optionRevision: options.revision, optionImageIds } : {}) });
}
async function quotationReplay(owner: string, id: string, source: FreeImageSource, key: string, sha256: string, size: number) {
  const target = source.quotationTarget!, current = await state(owner, id);
  if (!current.keys.includes(key)) return null;
  const saved = await stableQuotationFieldsView(owner, id, target.profileId), view = saved.view;
  if (view.revision !== target.revision + 1 || view.productVersion !== view.updatedAt || Date.parse(view.productVersion) <= Date.parse(source.productVersion)
    || view.contentRevision !== source.contentRevision || view.optionRevision !== target.optionRevision || !view.imageKeys.includes(key)
    || await quotationBinding(saved, target.input, key) !== target.bindingSha256) return null;
  const exact = exactPrimaryQuotationTarget(view.resolved.schema.fields, target.input), rows = view.resolved.rows.filter(row => row.optionId === target.optionId), value = quotationValue(source, key);
  if (exact.primary !== target.fieldKey || rows.length !== 1 || exact.linked.some(id => rows[0].fields[id]?.value !== value || view.overrides.options[target.optionId]?.[id] !== value)) return null;
  const observed = await original(owner, id, source.sourceKey, source.role, current, false);
  if (observed.sourceSha256 !== source.sourceSha256 || observed.width !== source.width || observed.height !== source.height || !await storedOutput(key, source, [], sha256, size)) return null;
  const stored = await env.FILES.get(key), overrideHash = await digest(new TextEncoder().encode(JSON.stringify(view.overrides)));
  if (stored?.customMetadata?.freeImageQuotationOverridesSha256 !== overrideHash) throw changed();
  return response({ source, key, productVersion: view.productVersion, contentRevision: view.contentRevision, optionRevision: view.optionRevision,
    quotationRevision: view.revision, quotationInputFingerprint: view.inputFingerprint, applied: true, replayed: true });
}
function selectedOptionIds(value: unknown, source: FreeImageSource) {
  try { return validateFreeImageOptionIds(source, value); }
  catch (error) { throw new ImageTextError(400, error instanceof Error ? error.message : '같은 원본 대표 이미지에 연결된 옵션만 선택해주세요.'); }
}
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new ImageTextError(400, '같은 사이트의 이미지 편집 화면에서 요청해주세요.');
}
function fail(error: unknown) {
  if (error instanceof ImageTextError || error instanceof RequestBodyError) return response({ error: error.message }, error.status);
  if (error instanceof QuotationFieldsSnapshotError || error instanceof PublicDetailError) return response({ error: error.message }, error.status);
  return response({ error: '이미지 문구 처리 결과를 확인하지 못했습니다. 기존 이미지는 유지됩니다. 저장본을 확인한 뒤 다시 시도해주세요.' }, 503);
}
export async function GET(request: Request, context: Context) {
  try {
    const owner = await ownerId(), { id } = await context.params, params = new URL(request.url).searchParams;
    const quotation = params.get('target') === 'quotation';
    const allowed = quotation ? ['sourceKey', 'role', 'target', 'profileId', 'optionId', 'fieldKey', 'slotIndex'] : ['sourceKey', 'role'];
    if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1) || params.getAll('sourceKey').length !== 1 || params.getAll('role').length !== 1
      || !validFreeImageRole(params.get('role'))) throw new ImageTextError(400, '원본 이미지와 역할을 선택해주세요.');
    const current = await state(owner, id), role = params.get('role') as FreeImageSource['role'];
    let selection: QuotationSelection | undefined;
    if (quotation) {
      const profileId = params.get('profileId'), optionId = params.get('optionId'), fieldKey = params.get('fieldKey'), slotIndex = params.get('slotIndex');
      if (!['main', 'additional', 'detail'].includes(role) || profileId !== null && !/^[A-Za-z0-9_-]{1,100}$/.test(profileId)
        || !optionId || !/^[A-Za-z0-9_-]{1,80}$/.test(optionId) || !fieldKey || !/^[A-Za-z0-9_-]{1,100}$/.test(fieldKey)
        || slotIndex === null || !/^(?:0|[1-9][0-9]?)$/.test(slotIndex) || Number(slotIndex) > 29 || role === 'main' && Number(slotIndex) !== 0) throw new ImageTextError(400, '최종 견적 이미지의 옵션과 선택 위치를 확인해주세요.');
      selection = { profileId, optionId, fieldKey, slotIndex: Number(slotIndex), input: role === 'main' ? 'mainImage' : role === 'additional' ? 'additionalImages' : 'detailImages' };
    }
    const source = selection ? await quotationOriginal(owner, id, params.get('sourceKey')!, role, current, selection)
      : await original(owner, id, params.get('sourceKey')!, role, current, true, true);
    // Never return a snapshot whose source/version changed while R2 was read.
    await freshSource(owner, id, source);
    return response({ source });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const owner = await ownerId(), { id } = await context.params;
    sameOrigin(request);
    const type = request.headers.get('content-type') ?? '';
    if (type.split(';')[0].trim().toLowerCase() === 'application/json') {
      const body = await readBoundedJson(request, 96 * 1024);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ImageTextError(400, '번역할 문구를 확인해주세요.');
      const input = body as Record<string, unknown>;
      if (input.action === 'recover') {
        if (Object.keys(input).some(key => !['action', 'source', 'outputSha256', 'outputBytes'].includes(key)) || typeof input.outputSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.outputSha256)
          || !Number.isSafeInteger(input.outputBytes) || (input.outputBytes as number) < 1 || (input.outputBytes as number) > MAX_IMAGE_BYTES) throw new ImageTextError(400, '복구할 PNG 결과 번호와 크기를 확인해주세요.');
        let source: FreeImageSource;
        try { source = validateFreeImageSource(input.source); } catch { throw new ImageTextError(400, '복구할 원본 정보를 확인해주세요.'); }
        if (!source.quotationTarget || source.productId !== id || !isOwnedImageKey(owner, source.sourceKey)) throw new ImageTextError(400, '이 상품의 최종 견적 이미지 복구 범위를 확인해주세요.');
        const fingerprint = await digest(new TextEncoder().encode(freeImageApplyIdentity(source))), key = `${owner}/free-image-${id}-${fingerprint}-${input.outputSha256}.png`;
        const recovered = await replay(owner, id, source, [], key, input.outputSha256, input.outputBytes as number);
        if (recovered) return recovered;
        await freshSource(owner, id, source);
        await storedOutput(key, source, [], input.outputSha256, input.outputBytes as number);
        return response({ source, key, applied: false });
      }
      if (Object.keys(input).some(key => !['action', 'source', 'sourceLanguage', 'regions'].includes(key)) || input.action !== 'translate' || !['zh', 'en'].includes(String(input.sourceLanguage))) throw new ImageTextError(400, '이미지 문구 번역 요청을 확인해주세요.');
      let source: FreeImageSource, regions;
      try { source = validateFreeImageSource(input.source); regions = validateImageTextRegions(input.regions); }
      catch (error) { throw new ImageTextError(400, error instanceof Error ? error.message : '이미지 문구를 확인해주세요.'); }
      await freshSource(owner, id, source);
      const translated = await translateImageRegions(regions, input.sourceLanguage as 'zh' | 'en', undefined, request.signal);
      await freshSource(owner, id, source);
      return response({ source, ...translated });
    }
    if (!/^multipart\/form-data(?:\s*;|$)/i.test(type)) throw new ImageTextError(400, '이미지 저장은 PNG 파일을 multipart 형식으로 요청해주세요.');
    const body = await readBoundedBytes(request, MAX_IMAGE_MULTIPART_BYTES);
    let form: FormData;
    try { form = await new Response(body.buffer as ArrayBuffer, { headers: { 'content-type': type } }).formData(); }
    catch { throw new ImageTextError(400, '이미지 파일 요청을 읽지 못했습니다.'); }
    if ([...form.keys()].some(key => !['action', 'source', 'file', 'optionImageIds'].includes(key)) || ['action', 'source', 'file'].some(key => form.getAll(key).length !== 1)
      || form.getAll('optionImageIds').length > 1
      || form.get('action') !== 'apply' || typeof form.get('source') !== 'string') throw new ImageTextError(400, 'PNG 결과 한 개와 원본 정보를 전달해주세요.');
    let source: FreeImageSource;
    try { const value = form.get('source') as string; if (value.length > 32768) throw Error('원본 정보가 너무 큽니다.'); source = validateFreeImageSource(JSON.parse(value)); }
    catch (error) { throw new ImageTextError(400, error instanceof Error ? error.message : '원본 정보를 확인해주세요.'); }
    if (source.productId !== id || !isOwnedImageKey(owner, source.sourceKey)) throw new ImageTextError(400, '상품·이미지 소유자를 확인해주세요.');
    let optionImageIds: string[];
    try {
      const value = form.get('optionImageIds');
      if (value !== null && (typeof value !== 'string' || value.length > 20000)) throw new ImageTextError(400, '옵션 대표 이미지 선택을 확인해주세요.');
      optionImageIds = selectedOptionIds(value === null ? [] : JSON.parse(value as string), source);
    } catch (error) { if (error instanceof ImageTextError) throw error; throw new ImageTextError(400, '옵션 대표 이미지 선택 형식을 확인해주세요.'); }
    const optionOnly = source.optionImages?.commonAssigned === false;
    if (optionOnly && !optionImageIds.length) throw new ImageTextError(400, '옵션 전용 원본은 적용할 옵션 대표 이미지를 한 개 이상 선택해주세요.');
    const file = form.get('file');
    if (!(file instanceof File) || file.size < 1) throw new ImageTextError(400, '내용이 있는 PNG 결과 파일이 필요합니다.');
    if (file.size > MAX_IMAGE_BYTES) throw new ImageTextError(413, '이미지 한 장은 10MB 이하여야 합니다.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let dimensions;
    try { dimensions = inspectImage(bytes); } catch { throw new ImageTextError(415, '유효한 PNG 결과가 필요합니다.'); }
    if (dimensions.mime !== 'image/png' || file.type !== 'image/png') throw new ImageTextError(415, 'PNG 결과만 저장할 수 있습니다.');
    if (dimensions.width * dimensions.height > MAX_OCR_PIXELS) throw new ImageTextError(413, '번역 결과는 1,200만 픽셀 이하이어야 합니다.');
    const same = dimensions.width === source.width && dimensions.height === source.height;
    const rotated = dimensions.width === source.height && dimensions.height === source.width;
    if (!same && !rotated) throw new ImageTextError(400, '번역 결과 크기가 원본 이미지와 다릅니다.');
    const sha256 = await digest(bytes), fingerprint = await digest(new TextEncoder().encode(freeImageApplyIdentity(source, optionImageIds)));
    const key = `${owner}/free-image-${id}-${fingerprint}-${sha256}.png`;
    if (!isOwnedImageKey(owner, key)) throw new ImageTextError(400, '이미지 결과 저장 범위를 확인해주세요.');
    const recovered = await replay(owner, id, source, optionImageIds, key, sha256, bytes.length);
    if (recovered) return recovered;
    const current = await freshSource(owner, id, source);
    const quotation = source.quotationTarget ? await stableQuotationFieldsView(owner, id, source.quotationTarget.profileId) : null;
    if (quotation && (quotation.view.revision !== source.quotationTarget!.revision || quotation.view.inputFingerprint !== source.quotationTarget!.inputFingerprint)) throw changed();
    const options = optionImageIds.length ? await readProductOptions(owner, id) : null;
    if (options && (options.revision !== source.optionImages!.revision || optionImageIds.some(id => options.rows.filter(row => row.id === id && row.imageKey === source.sourceKey).length !== 1))) throw changed();
    const imageKeys = [...new Set([...current.keys, key])];
    if (imageKeys.length > 50) throw new ImageTextError(400, '원본을 보존하려면 상품 이미지 50개 한도에 여유가 필요합니다.');
    if (!quotation && !optionOnly && Object.entries(current.content.assets).some(([role, field]) => role !== source.role && field.value.includes(key))) throw changed();
    const now = new Date(Math.max(Date.now(), Date.parse(source.productVersion) + 1)).toISOString();
    let next;
    try { next = quotation || optionOnly ? current.content : applyContentPatch(current.content, { assets: { [source.role]: current.content.assets[source.role].value.map(value => value === source.sourceKey ? key : value) } }, now); }
    catch { throw new ImageTextError(409, '이미지 역할이 중복되어 있습니다. 원본 역할을 확인한 후 다시 적용해주세요.'); }
    const finalOverrides = quotation ? quotationOverrides(quotation, source, key) : null;
    const quotationOverridesSha256 = finalOverrides ? await digest(new TextEncoder().encode(JSON.stringify(finalOverrides))) : undefined;
    if (!await storedOutput(key, source, optionImageIds, sha256, bytes.length)) {
      try {
        // Both arrays can contain 200 long IDs. Store their hashes rather than
        // full JSON so the complete record stays below R2's 8KB metadata limit.
        const [sourceSha256, optionIdsSha256] = await Promise.all([
          digest(new TextEncoder().encode(freeImageSourceIdentity(source))), digest(new TextEncoder().encode(JSON.stringify(optionImageIds))),
        ]);
        const saved = await env.FILES.put(key, bytes, { onlyIf: new Headers({ 'if-none-match': '*' }), httpMetadata: { contentType: 'image/png' },
          customMetadata: { freeImageSourceSha256: sourceSha256, freeImageOptionIdsSha256: optionIdsSha256, freeImageOutputSha256: sha256,
            ...(quotationOverridesSha256 ? { freeImageQuotationOverridesSha256: quotationOverridesSha256 } : {}),
            imageValidation: 'header-v1', dimensionValidation: 'header-v1', imageWidth: String(dimensions.width), imageHeight: String(dimensions.height) } });
        if (!saved && !await storedOutput(key, source, optionImageIds, sha256, bytes.length)) throw Error('Image upload was not confirmed.');
      } catch (error) {
        // A failed acknowledgement may follow a committed R2 put. Verify bytes
        // and metadata before continuing; never overwrite or delete that object.
        if (!await storedOutput(key, source, optionImageIds, sha256, bytes.length)) throw error;
      }
    }
    if (quotationOverridesSha256 && (await env.FILES.get(key))?.customMetadata?.freeImageQuotationOverridesSha256 !== quotationOverridesSha256) throw changed();
    await freshSource(owner, id, source);
    // The DB guard checks both original keys and revisions atomically. An R2
    // object can remain unattached after a conflict and be reused safely later.
    try {
      if (quotation && finalOverrides) {
        const saved = await attachQuotationImageTranslation(owner, id, finalOverrides, quotation.view.revision, quotation.source, quotation.view.categoryContext.categoryId, imageKeys);
        const committed = await replay(owner, id, source, [], key, sha256, bytes.length);
        if (committed) {
          if (!saved) return committed;
          const acknowledged: unknown = await committed.json();
          if (!acknowledged || typeof acknowledged !== 'object' || Array.isArray(acknowledged)
            || !('applied' in acknowledged) || acknowledged.applied !== true || !('key' in acknowledged) || acknowledged.key !== key)
            throw new ImageTextError(503, '최종 견적 이미지 저장 확인 응답을 읽지 못했습니다. 같은 PNG 미리보기로 저장 여부를 다시 확인해주세요.');
          return response(Object.fromEntries(Object.entries(acknowledged).filter(([field]) => field !== 'replayed')));
        }
        if (!saved) throw changed();
        throw new ImageTextError(503, '최종 견적 이미지 저장 결과를 확인하지 못했습니다. 같은 PNG 미리보기로 저장 여부를 다시 확인해주세요.');
      }
      const common = { productId: id, expectedVersion: source.productVersion, expectedContentRevision: source.contentRevision,
        previousImageKeys: current.product.image_keys, imageKeys, content: next, productVersion: now };
      const saved = options ? await applyProductImageTranslation(owner, { ...common, contentMutated: !optionOnly, options, optionImageIds, sourceKey: source.sourceKey, outputKey: key })
        : await attachProductDocument(owner, { ...common, contentMutated: true, ...(source.optionImages ? { expectedOptionRevision: source.optionImages.revision } : {}) });
      if (saved) return response({ source, key, productVersion: saved.productVersion, contentRevision: saved.content.revision, applied: true,
        ...(options ? { optionRevision: options.revision + 1, optionImageIds } : {}) });
      const committed = await replay(owner, id, source, optionImageIds, key, sha256, bytes.length);
      if (committed) return committed;
      throw changed();
    } catch (error) {
      const committed = await replay(owner, id, source, optionImageIds, key, sha256, bytes.length);
      if (committed) return committed;
      throw error;
    }
  } catch (error) { return fail(error); }
}
