// Full included-option transport proof. This contract performs no dispatch,
// Supplier Hub request, persistence, agreement selection or receipt inference.
export const PRODUCT_DOCUMENT_REQUEST_TYPE = 'YOOFAM_PRODUCT_DOCUMENT_REQUEST';
export const PRODUCT_DOCUMENT_REQUEST_VERSION = 1;
export const PRODUCT_DOCUMENT_REQUEST_TTL = 120000;
const FORMAT = 'yoofam-supplier-hub-product-document-v1', REVIEW = 'YOOFAM_PRODUCT_DOCUMENT_REVIEW';
const HASH = /^[a-f0-9]{64}$/, ID = /^\w[\w-]{0,99}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const COMPANIES = Object.freeze({ A01526306: '유앤채', A01464742: '와이홉' });
const PAGES = new Set(['startPage', 'productPage', 'imagePage', 'legalPage', 'logisticsPage', 'sourcingPage']);
const SECRETS = new Set(['__proto__', 'prototype', 'constructor', 'authorization', 'cookie', 'setcookie', 'password', 'accesstoken', 'refreshtoken', 'clientsecret', 'apikey', 'secret', 'privatekey', 'credentials', 'sessiontoken']);
const LIMIT = 6 * 1024 * 1024;
export class ProductDocumentTransportError extends Error {
  constructor(code, message) { super(message); this.name = 'ProductDocumentTransportError'; this.code = code; }
}
const fail = (code, message = '포함 옵션 전체 견적의 저장값과 전달 정보를 확인해주세요.') => { throw new ProductDocumentTransportError(code, message); };
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const id = value => typeof value === 'string' && ID.test(value);
const numeric = value => Number.isSafeInteger(value) && value >= 0 || typeof value === 'string' && /^\d{1,20}$/.test(value);
const revision = value => Number.isSafeInteger(value) && value >= 0;
const exact = (value, keys, optional = []) => object(value) && keys.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => keys.includes(key) || optional.includes(key));
function nativePrototype(value, name) {
  const constructor = Object.getOwnPropertyDescriptor(value, 'constructor')?.value;
  return typeof constructor === 'function' && constructor.name === name && /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(constructor));
}
/** Read descriptors before values, including arrays. No getter or toJSON runs. */
function canonical(value) {
  let nodes = 0; const seen = new Set();
  const visit = (item, depth) => {
    if (++nodes > 100000 || depth > 30) fail('JSON_LIMIT');
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (!item || typeof item !== 'object' || seen.has(item)) fail('JSON');
    const keys = Reflect.ownKeys(item), descriptors = Object.getOwnPropertyDescriptors(item);
    if (keys.some(key => typeof key !== 'string') || Object.values(descriptors).some(field => !Object.hasOwn(field, 'value'))) fail('JSON_DESCRIPTOR');
    seen.add(item); let result;
    if (Array.isArray(item)) {
      const prototype = Object.getPrototypeOf(item), parent = prototype && Object.getPrototypeOf(prototype);
      if (!prototype || !nativePrototype(prototype, 'Array') || !parent || Object.getPrototypeOf(parent) !== null || !nativePrototype(parent, 'Object')
        || keys.length !== item.length + 1 || Object.keys(item).length !== item.length || Object.keys(item).some((key, index) => key !== String(index))) fail('JSON_ARRAY');
      result = '[' + Array.from({ length: item.length }, (_, index) => visit(descriptors[index].value, depth + 1)).join(',') + ']';
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== null && (Object.getPrototypeOf(prototype) !== null || !nativePrototype(prototype, 'Object'))) fail('JSON_PROTOTYPE');
      if (keys.some(key => !descriptors[key].enumerable || SECRETS.has(key) || SECRETS.has(key.replace(/[-_]/g, '').toLowerCase()))) fail('JSON_SECRET');
      result = '{' + keys.sort().map(key => JSON.stringify(key) + ':' + visit(descriptors[key].value, depth + 1)).join(',') + '}';
    }
    seen.delete(item); return result;
  };
  const result = visit(value, 0); if (new TextEncoder().encode(result).byteLength > LIMIT) fail('JSON_LIMIT'); return result;
}
const copy = value => JSON.parse(canonical(value));
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const same = (left, right) => canonical(left) === canonical(right);
function company(value) { return exact(value, ['code', 'name']) && Object.hasOwn(COMPANIES, value.code) && COMPANIES[value.code] === value.name; }
function checkReview(value) {
  if (!exact(value, ['format', 'type', 'identity', 'members', 'body', 'originalBodySha256', 'preparedBodySha256', 'reviewDigest', 'registered', 'remoteWrites', 'submissionReady'])
    || value.format !== FORMAT || value.type !== REVIEW || value.registered !== false || value.remoteWrites !== false || value.submissionReady !== false
    || !['originalBodySha256', 'preparedBodySha256', 'reviewDigest'].every(key => HASH.test(value[key] || ''))) fail('REVIEW');
  const identity = value.identity;
  if (!exact(identity, ['ownerId', 'company', 'productId', 'profileId', 'requestedProfileId', 'categoryId', 'fingerprint', 'inputFingerprint', 'schemaSha256', 'source'])
    || !id(identity.ownerId) || !id(identity.productId) || !company(identity.company)
    || identity.profileId !== null && !id(identity.profileId) || identity.requestedProfileId !== null && (!id(identity.requestedProfileId) || identity.requestedProfileId !== identity.profileId)
    || typeof identity.categoryId !== 'string' || !/^\d{1,20}$/.test(identity.categoryId) || /^0+$/.test(identity.categoryId)
    || !['fingerprint', 'inputFingerprint', 'schemaSha256'].every(key => HASH.test(identity[key] || ''))) fail('IDENTITY');
  const source = identity.source;
  if (!exact(source, ['productVersion', 'contentRevision', 'optionRevision', 'quotationRevision', 'profileId', 'profileRevision'])
    || typeof source.productVersion !== 'string' || !Number.isFinite(Date.parse(source.productVersion))
    || !['contentRevision', 'optionRevision', 'quotationRevision'].every(key => revision(source[key]))
    || source.profileRevision !== null && !revision(source.profileRevision) || source.profileId !== identity.profileId) fail('SOURCE');
  const members = value.members, body = value.body;
  if (!Array.isArray(members) || !members.length || members.length > 200 || members.some((member, index) => !exact(member, ['optionId', 'optionLabel', 'documentIndex'])
    || !id(member.optionId) || typeof member.optionLabel !== 'string' || member.documentIndex !== index) || new Set(members.map(member => member.optionId)).size !== members.length) fail('MEMBERS');
  if (!exact(body, ['docId', 'productName', 'categoryPath', 'categoryId', 'displayCategoryCode', 'jsonDocument', 'scope', 'productNoticeNumber', 'version'], ['remark'])
    || body.docId !== null || body.scope !== 'Retail_Categorized_Single' || !numeric(body.categoryId) || /^0+$/.test(String(body.categoryId))
    || body.displayCategoryCode !== identity.categoryId || !numeric(body.productNoticeNumber) || !numeric(body.version)
    || typeof body.categoryPath !== 'string' || !body.categoryPath.endsWith(' (' + identity.categoryId + ')')
    || typeof body.productName !== 'string' || !body.productName.trim() || body.productName.length > 500 || body.remark !== undefined && typeof body.remark !== 'string'
    || !Array.isArray(body.jsonDocument) || body.jsonDocument.length !== members.length) fail('DOCUMENT');
  for (const document of body.jsonDocument) {
    if (!object(document) || Object.keys(document).some(key => !PAGES.has(key)) || Object.values(document).some(page => !object(page))
      || !object(document.startPage) || typeof document.startPage.productName !== 'string' || !document.startPage.productName.trim() || document.startPage.productName.length > 500
      || document.startPage.categoryPath !== body.categoryPath) fail('DOCUMENT');
    for (const key of ['msrpAgree', 'labelContactAgreed']) if (document.imagePage && Object.hasOwn(document.imagePage, key) && typeof document.imagePage[key] !== 'boolean') fail('AGREEMENT');
  }
  if (body.jsonDocument[0].startPage.productName !== body.productName) fail('DOCUMENT_TITLE');
}
function defer(body) {
  const result = copy(body);
  for (const document of result.jsonDocument) for (const key of ['msrpAgree', 'labelContactAgreed']) if (document.imagePage && Object.hasOwn(document.imagePage, key)) document.imagePage[key] = false;
  return result;
}
function time(packet, now) {
  if (!Number.isSafeInteger(now) || now <= 0 || !Number.isSafeInteger(packet.createdAt) || packet.createdAt <= 0
    || packet.createdAt > now + 5000 || now >= packet.createdAt + PRODUCT_DOCUMENT_REQUEST_TTL) fail('EXPIRED', '전체 상품 견적 전달 확인이 만료됐습니다. 현재 저장값을 다시 확인해주세요.');
}
async function validate(packet, options) {
  const value = copy(packet), now = options?.now ?? Date.now();
  if (!exact(value, ['type', 'version', 'requestId', 'createdAt', 'review']) || value.type !== PRODUCT_DOCUMENT_REQUEST_TYPE || value.version !== PRODUCT_DOCUMENT_REQUEST_VERSION
    || typeof value.requestId !== 'string' || !UUID.test(value.requestId)) fail('PACKET');
  time(value, now); checkReview(value.review); const review = value.review, preparedBody = defer(review.body);
  if (options?.ownerId !== undefined && options.ownerId !== review.identity.ownerId || options?.company !== undefined && !same(options.company, review.identity.company)) fail('ACCOUNT');
  if (await digest(review.body) !== review.originalBodySha256 || await digest(preparedBody) !== review.preparedBodySha256
    || await digest({ format: review.format, type: review.type, identity: review.identity, members: review.members, originalBodySha256: review.originalBodySha256, preparedBodySha256: review.preparedBodySha256 }) !== review.reviewDigest) fail('HASH');
  const identityDigest = await digest({ identity: review.identity, members: review.members });
  const packetDigest = await digest({ format: review.format, version: value.version, identity: review.identity, members: review.members,
    originalBodySha256: review.originalBodySha256, preparedBodySha256: review.preparedBodySha256, reviewDigest: review.reviewDigest });
  const binding = { format: review.format, identity: review.identity, members: review.members, identityDigest, originalBodySha256: review.originalBodySha256,
    preparedBodySha256: review.preparedBodySha256, reviewDigest: review.reviewDigest, packetDigest, registered: false, remoteWrites: false, submissionReady: false };
  return freeze({ packet: value, binding, preparedBody, registered: false, remoteWrites: false, submissionReady: false });
}
/** Builder takes only a compiled, current app review. Never a scalar option. */
export async function createProductDocumentPacket(review, options = {}) {
  const now = options.now ?? Date.now(), value = { type: PRODUCT_DOCUMENT_REQUEST_TYPE, version: PRODUCT_DOCUMENT_REQUEST_VERSION,
    requestId: options.requestId ?? crypto.randomUUID(), createdAt: options.createdAt ?? now, review: copy(review) };
  return (await validate(value, { now })).packet;
}
export async function validateProductDocumentPacket(packet, options = {}) { return validate(packet, options); }
export async function productDocumentPacketBinding(packet, options = {}) { return (await validate(packet, options)).binding; }
