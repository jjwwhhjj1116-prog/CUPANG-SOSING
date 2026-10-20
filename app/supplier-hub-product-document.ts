import { singlePackageCurrent, type SinglePackageView } from '@/app/supplier-hub-single-client';
import { supplierHubCompany, type SupplierHubCompany } from '@/app/supplier-hub-company';
import type { QuotationFieldsView } from '@/app/quotation-schema';

export const PRODUCT_DOCUMENT_FORMAT = 'yoofam-supplier-hub-product-document-v1';
export const PRODUCT_DOCUMENT_TYPE = 'YOOFAM_PRODUCT_DOCUMENT_REVIEW';
const LIMIT = 6 * 1024 * 1024, HASH = /^[a-f0-9]{64}$/, ID = /^\w[\w-]{0,99}$/;
type JsonObject = Record<string, unknown>;
type Package = SinglePackageView & { requestedProfileId: string | null; humanAgreementsConfirmed: false };
export type SupplierHubProductDocumentReview = Readonly<{
  format: typeof PRODUCT_DOCUMENT_FORMAT; type: typeof PRODUCT_DOCUMENT_TYPE;
  identity: { ownerId: string; company: SupplierHubCompany; productId: string; profileId: string | null; requestedProfileId: string | null;
    categoryId: string; fingerprint: string; inputFingerprint: string; schemaSha256: string; source: SinglePackageView['source'] };
  members: { optionId: string; optionLabel: string; documentIndex: number }[];
  body: SinglePackageView['payload']; originalBodySha256: string; preparedBodySha256: string; reviewDigest: string;
  registered: false; remoteWrites: false; submissionReady: false;
}>;
export type SupplierHubProductDocumentInput = { packageView: SinglePackageView; quotationView: QuotationFieldsView; ownerId: string };
export type CurrentSupplierHubProductDocumentInput = Omit<SupplierHubProductDocumentInput, 'ownerId'> & {
  productId: string; profileId?: string; signal: AbortSignal; fetcher?: typeof fetch;
};
export class ProductDocumentReviewError extends Error {
  constructor(message = '현재 회사·카테고리의 저장한 전체 상품 견적 자료를 다시 확인해주세요.') { super(message); this.name = 'ProductDocumentReviewError'; }
}
const fail = (message?: string): never => { throw new ProductDocumentReviewError(message); };
const object = (value: unknown): value is JsonObject => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const identifier = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
const numeric = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 || typeof value === 'string' && /^\d{1,20}$/.test(value);
const revision = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const secrets = new Set(['__proto__', 'prototype', 'constructor', 'authorization', 'cookie', 'setcookie', 'password', 'accesstoken', 'refreshtoken', 'clientsecret', 'apikey', 'secret', 'privatekey', 'credentials', 'sessiontoken']);
function nativePrototype(value: object, name: string) {
  const constructor = Object.getOwnPropertyDescriptor(value, 'constructor')?.value;
  return typeof constructor === 'function' && constructor.name === name && /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(constructor));
}

/** Inspect descriptors before reading a value. JSON copy never invokes getters,
 * toJSON, custom prototypes or sparse-array accessors. Unknown schema values
 * remain exact strings/numbers/booleans/null rather than being inferred. */
function canonical(value: unknown): string {
  let count = 0; const seen = new Set<object>();
  const visit = (item: unknown, depth: number): string => {
    if (++count > 100000 || depth > 30) return fail('전체 상품 견적 자료가 처리 한도를 초과했습니다.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (!item || typeof item !== 'object' || seen.has(item)) return fail('전체 상품 견적 자료의 JSON 형식을 확인해주세요.');
    const keys = Reflect.ownKeys(item), descriptors = Object.getOwnPropertyDescriptors(item);
    if (keys.some(key => typeof key !== 'string') || Object.values(descriptors).some(field => !Object.hasOwn(field, 'value'))) return fail('견적 자료에는 일반 저장값만 사용할 수 있습니다.');
    seen.add(item); let result: string;
    if (Array.isArray(item)) {
      const prototype = Object.getPrototypeOf(item), parent = prototype && Object.getPrototypeOf(prototype);
      if (!prototype || !nativePrototype(prototype, 'Array') || !parent || Object.getPrototypeOf(parent) !== null || !nativePrototype(parent, 'Object')
        || keys.length !== item.length + 1 || Object.keys(item).length !== item.length
        || Object.keys(item).some((key, index) => key !== String(index))) return fail('전체 옵션 배열의 순서와 저장값을 확인해주세요.');
      result = '[' + Array.from({ length: item.length }, (_, index) => visit(descriptors[index].value, depth + 1)).join(',') + ']';
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== null && (Object.getPrototypeOf(prototype) !== null || !nativePrototype(prototype, 'Object')))
        return fail('견적 자료에는 일반 JSON 객체만 사용할 수 있습니다.');
      const names = keys as string[];
      if (names.some(key => !descriptors[key].enumerable || secrets.has(key) || secrets.has(key.replace(/[-_]/g, '').toLowerCase()))) return fail('인증 자료나 특수 항목은 견적 검토에 포함할 수 없습니다.');
      result = '{' + names.sort().map(key => JSON.stringify(key) + ':' + visit(descriptors[key].value, depth + 1)).join(',') + '}';
    }
    seen.delete(item); return result;
  };
  const text = visit(value, 0); if (new TextEncoder().encode(text).byteLength > LIMIT) return fail('전체 상품 견적 자료가 6MB를 초과했습니다.'); return text;
}
const copy = <T,>(value: T): T => JSON.parse(canonical(value)) as T;
/** Shared inert review encoder; exporting it does not change legacy review rules. */
export const productDocumentReviewCanonical = canonical;
const digest = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const exact = (value: JsonObject, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function checkedPackage(packageView: SinglePackageView, quotationView: QuotationFieldsView): Package {
  const value = copy(packageView) as Package, view = copy(quotationView);
  if (!object(value) || !object(view)) return fail();
  const source = value.source, payload = value.payload;
  if (!object(source) || !object(payload) || !object(value.review) || !object(view.categoryContext)
    || !object(view.resolved) || !Array.isArray(view.resolved.rows) || view.resolved.rows.some(row => !object(row) || typeof row.included !== 'boolean') || !Array.isArray(value.options) || !Array.isArray(payload.jsonDocument)
    || !identifier(value.productId) || !singlePackageCurrent(value, view, value.productId)
    || value.prepared !== true || value.humanAgreementsConfirmed !== false || value.review.canPrepare !== true || !Array.isArray(value.review.issues)
    || value.review.issues.some(issue => !object(issue) || !['review', 'error'].includes(issue.level) || issue.level === 'error')
    || !supplierHubCompany(value.company?.code, value.company?.name) || !exact(value.company, ['code', 'name'])
    || !HASH.test(value.schemaSha256) || source.profileId !== null && !identifier(source.profileId) || !numeric(payload.displayCategoryCode) || String(payload.displayCategoryCode) === '0'
    || ![source.contentRevision, source.optionRevision, source.quotationRevision].every(revision)
    || source.profileRevision !== null && !revision(source.profileRevision) || typeof source.productVersion !== 'string' || !Number.isFinite(Date.parse(source.productVersion))
    || !Object.hasOwn(value, 'requestedProfileId') || value.requestedProfileId !== null && (!identifier(value.requestedProfileId) || value.requestedProfileId !== source.profileId)
    || payload.docId !== null || payload.scope !== 'Retail_Categorized_Single' || ![payload.categoryId, payload.productNoticeNumber, payload.version].every(numeric) || String(payload.categoryId) === '0'
    || typeof payload.categoryPath !== 'string' || !payload.categoryPath.trim() || typeof payload.productName !== 'string'
    || !value.options.length || value.options.length > 200 || new Set(value.options.map(option => option.optionId)).size !== value.options.length
    || value.options.some(option => !object(option) || !exact(option, ['optionId', 'optionLabel']) || !identifier(option.optionId) || typeof option.optionLabel !== 'string')
    || canonical(value.options) !== canonical(view.resolved.rows.filter(row => row.included).map(row => ({ optionId: row.optionId, optionLabel: row.optionLabel })))) return fail();
  for (const document of payload.jsonDocument) {
    if (!object(document) || !object(document.startPage) || typeof document.startPage.productName !== 'string' || !document.startPage.productName.trim()
      || document.startPage.categoryPath !== payload.categoryPath || document.imagePage !== undefined && !object(document.imagePage)) return fail('포함 옵션별 상품명·카테고리 연결을 확인해주세요.');
    if (object(document.imagePage)) for (const key of ['msrpAgree', 'labelContactAgreed']) if (Object.hasOwn(document.imagePage, key) && typeof document.imagePage[key] !== 'boolean') return fail('저장된 동의 항목의 자료형을 확인해주세요.');
  }
  if ((payload.jsonDocument[0].startPage as JsonObject).productName !== payload.productName) return fail('첫 저장 옵션과 상품 문서 제목이 다릅니다.');
  return value;
}

/** Read-only full-product contract. Deliberately incompatible with the legacy
 * scalar-option bridge: this is neither a dispatch packet nor a receipt. */
export async function compileSupplierHubProductDocument(input: SupplierHubProductDocumentInput): Promise<SupplierHubProductDocumentReview> {
  if (!identifier(input.ownerId)) return fail('현재 승인 회원을 확인해주세요.');
  const value = checkedPackage(input.packageView, input.quotationView), body = copy(value.payload);
  const members = value.options.map((option, documentIndex) => ({ optionId: option.optionId!, optionLabel: option.optionLabel, documentIndex }));
  const identity = { ownerId: input.ownerId, company: value.company, productId: value.productId, profileId: value.source.profileId, requestedProfileId: value.requestedProfileId,
    categoryId: value.payload.displayCategoryCode, fingerprint: value.fingerprint, inputFingerprint: value.inputFingerprint, schemaSha256: value.schemaSha256, source: value.source };
  const deferred = copy(body);
  for (const document of deferred.jsonDocument) if (object(document.imagePage)) for (const key of ['msrpAgree', 'labelContactAgreed']) if (Object.hasOwn(document.imagePage, key)) document.imagePage[key] = false;
  const originalBodySha256 = await digest(body), preparedBodySha256 = await digest(deferred);
  const reviewDigest = await digest({ format: PRODUCT_DOCUMENT_FORMAT, type: PRODUCT_DOCUMENT_TYPE, identity, members, originalBodySha256, preparedBodySha256 });
  const result: SupplierHubProductDocumentReview = { format: PRODUCT_DOCUMENT_FORMAT, type: PRODUCT_DOCUMENT_TYPE, identity, members, body, originalBodySha256, preparedBodySha256, reviewDigest,
    registered: false as const, remoteWrites: false as const, submissionReady: false as const };
  canonical(result); return freeze(result);
}

function active(signal: AbortSignal) { if (signal.aborted) fail('전체 상품 견적 확인을 취소했습니다.'); }
async function readJson(path: string, signal: AbortSignal, request: typeof fetch, limit = LIMIT): Promise<unknown> {
  active(signal); const response = await request.call(globalThis, path, { method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal }); active(signal);
  if (!response.ok || response.redirected || !/\bapplication\/json\b/i.test(response.headers.get('content-type') ?? '')) return fail('현재 저장 자료의 JSON 응답을 확인하지 못했습니다.');
  if (response.url) { const url = new URL(response.url); if (url.pathname + url.search !== path || typeof location !== 'undefined' && url.origin !== location.origin) return fail('원래 앱의 저장 자료를 확인해주세요.'); }
  const reader = response.body?.getReader(); if (!reader) return fail('현재 저장 자료의 응답이 비어 있습니다.');
  const chunks: Uint8Array[] = []; let length = 0; const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) { active(signal); const { value, done } = await reader.read(); active(signal); if (done) break; length += value.byteLength; if (length > limit) return fail('전체 상품 견적 응답이 처리 한도를 초과했습니다.'); chunks.push(value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('현재 저장 자료의 JSON 형식을 확인하지 못했습니다.'); } canonical(value); return value;
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function actor(value: unknown): { ownerId: string; company: SupplierHubCompany } {
  if (!object(value) || !exact(value, ['ownerId', 'company']) || !identifier(value.ownerId) || !object(value.company) || !exact(value.company, ['code', 'name'])
    || !supplierHubCompany(value.company.code, value.company.name)) return fail('현재 승인 회원 회사를 확인해주세요.');
  return value as { ownerId: string; company: SupplierHubCompany };
}
/** No prepare POST, file publication or bridge dispatch. Queryless captured
 * context remains queryless; its recorded profile ID is not a live selection. */
export async function reviewCurrentSupplierHubProductDocument(input: CurrentSupplierHubProductDocumentInput): Promise<SupplierHubProductDocumentReview> {
  const expected = checkedPackage(input.packageView, input.quotationView), expectedText = canonical(expected), viewText = canonical(input.quotationView);
  if (!identifier(input.productId) || expected.productId !== input.productId || input.profileId !== undefined && !identifier(input.profileId)
    || expected.requestedProfileId !== (input.profileId ?? null)) return fail('검토한 카테고리 요청 범위를 다시 확인해주세요.');
  const request = input.fetcher ?? fetch, path = `/api/products/${encodeURIComponent(input.productId)}/supplier-hub-single-package${input.profileId ? `?profileId=${encodeURIComponent(input.profileId)}` : ''}`;
  const before = actor(await readJson('/api/supplier-hub/catalog-context', input.signal, request, 4096));
  if (canonical(before.company) !== canonical(expected.company)) return fail('검토한 회사와 현재 승인 회사가 다릅니다.');
  const latest = checkedPackage(await readJson(path, input.signal, request) as SinglePackageView, input.quotationView);
  if (canonical(latest) !== expectedText) return fail('검토한 전체 옵션·가격·이미지 또는 저장 자료가 변경됐습니다.');
  const result = await compileSupplierHubProductDocument({ packageView: latest, quotationView: input.quotationView, ownerId: before.ownerId }); active(input.signal);
  const final = checkedPackage(await readJson(path, input.signal, request) as SinglePackageView, input.quotationView);
  if (canonical(final) !== expectedText) return fail('검토 중 전체 상품의 저장값이 변경됐습니다.');
  const after = actor(await readJson('/api/supplier-hub/catalog-context', input.signal, request, 4096));
  active(input.signal);
  if (canonical(before) !== canonical(after) || canonical(input.packageView) !== expectedText || canonical(input.quotationView) !== viewText) return fail('확인 중 회원 회사 또는 상품 견적이 변경됐습니다.');
  return result;
}
