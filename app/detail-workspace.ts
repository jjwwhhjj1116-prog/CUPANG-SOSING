import type { QuotationFieldsView } from '@/app/quotation-schema';
import { isOwnedImageKey, MAX_IMAGE_BYTES, PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-files';
import { supplierHubCompany, type SupplierHubCompany } from '@/app/supplier-hub-company';
import { quotationScope } from '@/app/quotation-scopes';
import { labelUploadDigest } from '@/app/label-upload-key';

export const DETAIL_WORKSPACE_BODY_LIMIT = 512 * 1024;
export type DetailWorkspacePhoto = { id: string; originKey: string; key: string; role: 'top' | 'body' | 'bottom' };
export type DetailWorkspaceDocument = { format: 'detail-workspace-v1'; photos: DetailWorkspacePhoto[]; imageMargin: number; generatedHtml: string };
export type DetailWorkspaceFile = { key: string; sha256: string; bytes: number; width: number; height: number };
export type DetailWorkspaceRoles = { top: string[]; bottom: string[] };
export type DetailWorkspaceExpectedView = Pick<QuotationFieldsView, 'productVersion' | 'revision' | 'contentRevision' | 'optionRevision' | 'inputFingerprint' | 'categoryContext'>;
export type DetailWorkspaceRecord = { format: 'detail-workspace-record-v1'; productId: string; optionId: string; context: QuotationFieldsView['categoryContext'];
  company: SupplierHubCompany; revision: number; updatedAt: string; requestId: string; document: DetailWorkspaceDocument; files: DetailWorkspaceFile[]; digest: string };
export type DetailWorkspaceView = { view: QuotationFieldsView; workspace: DetailWorkspaceRecord | null; roles: DetailWorkspaceRoles };
export type DetailWorkspaceInput = { optionId: string; expectedRevision: number; expectedView: DetailWorkspaceExpectedView; requestId: string; document: DetailWorkspaceDocument };
export class DetailWorkspaceError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 | 409 | 413 | 415 | 503 = 409) { super(message); }
}
const bad = (): never => { throw new DetailWorkspaceError('상세 편집 작업공간의 사진·원본·회사·저장 기준을 확인해주세요.'); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = (value: unknown, length = 100): value is string => typeof value === 'string' && new RegExp(`^[A-Za-z0-9_-]{1,${length}}$`, 'u').test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const key = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function context(value: unknown): QuotationFieldsView['categoryContext'] {
  if (!exact(value, ['source', 'profileId', 'categoryId', 'categoryPath']) || !['profile', 'collection'].includes(String(value.source))
    || !(value.profileId === null || id(value.profileId)) || !id(value.categoryId) || !Array.isArray(value.categoryPath)
    || value.categoryPath.length > 20 || value.categoryPath.some(part => typeof part !== 'string' || part.length > 500)) return bad();
  quotationScope(value.categoryId);
  return { source: value.source as 'profile' | 'collection', profileId: value.profileId as string | null, categoryId: value.categoryId, categoryPath: [...value.categoryPath] as string[] };
}
function photos(value: unknown): DetailWorkspacePhoto[] {
  if (!Array.isArray(value) || value.length > PRODUCT_IMAGE_POOL_LIMIT) return bad();
  const seen = new Set<string>();
  return value.map(photo => {
    if (!exact(photo, ['id', 'originKey', 'key', 'role']) || !id(photo.id) || seen.has(photo.id) || !key(photo.originKey) || !key(photo.key) || !['top', 'body', 'bottom'].includes(String(photo.role))) return bad();
    seen.add(photo.id); return { id: photo.id, originKey: photo.originKey, key: photo.key, role: photo.role as DetailWorkspacePhoto['role'] };
  });
}
/** Deterministic private-image markup; never accepts, executes or fetches HTML. */
export function generateDetailWorkspaceHtml(value: readonly DetailWorkspacePhoto[], imageMargin: number): string {
  const rows = photos(value); if (!integer(imageMargin, 0, 200)) return bad();
  return '<div style="width:800px;box-sizing:border-box;padding:20px;margin:0 auto;">\n'
    + rows.map(photo => `<img src="/api/files/${photo.key.split('/').map(encodeURIComponent).join('/')}" style="display:block;width:760px;height:auto;margin:0 0 ${imageMargin}px 0;" alt="">`).join('\n') + '\n</div>';
}
function document(value: unknown): DetailWorkspaceDocument {
  if (!exact(value, ['format', 'photos', 'imageMargin', 'generatedHtml']) || value.format !== 'detail-workspace-v1' || !integer(value.imageMargin, 0, 200) || typeof value.generatedHtml !== 'string') return bad();
  const images = photos(value.photos), generatedHtml = generateDetailWorkspaceHtml(images, value.imageMargin);
  if (generatedHtml !== value.generatedHtml) return bad();
  let stage = 0;
  for (const photo of images) {
    const next = photo.role === 'top' ? 0 : photo.role === 'body' ? 1 : 2;
    if (next < stage) return bad(); stage = next;
  }
  const result: DetailWorkspaceDocument = { format: 'detail-workspace-v1', photos: images, imageMargin: value.imageMargin, generatedHtml };
  if (new TextEncoder().encode(JSON.stringify(result)).length > DETAIL_WORKSPACE_BODY_LIMIT) throw new DetailWorkspaceError('상세 작업공간 입력은512KiB 이내여야 합니다.', 413);
  return result;
}
export function validateDetailWorkspaceRoles(value: unknown, ownerId: string, imageKeys: readonly string[]): DetailWorkspaceRoles {
  if (!exact(value, ['top', 'bottom'])) return bad();
  const read = (rows: unknown) => {
    if (!Array.isArray(rows) || rows.length > PRODUCT_IMAGE_POOL_LIMIT || new Set(rows).size !== rows.length || rows.some(value => !isOwnedImageKey(ownerId, value) || !imageKeys.includes(value))) return bad();
    return [...rows] as string[];
  };
  const top = read(value.top), bottom = read(value.bottom); if (top.some(value => bottom.includes(value))) return bad();
  return { top, bottom };
}
/** Omit previous only when inspecting a stored record. Pass null for a first
 * save so every new stable row is required to start from its actual own key. */
export function validateDetailWorkspaceDocument(value: unknown, ownerId: string, imageKeys: readonly string[], previous?: DetailWorkspaceDocument | null, roles?: DetailWorkspaceRoles, authorizedPhotos: readonly Pick<DetailWorkspacePhoto, 'id' | 'key'>[] = []): DetailWorkspaceDocument {
  const result = document(value);
  if (!Array.isArray(imageKeys) || imageKeys.length > PRODUCT_IMAGE_POOL_LIMIT || new Set(imageKeys).size !== imageKeys.length
    || result.photos.some(photo => !isOwnedImageKey(ownerId, photo.originKey) || !imageKeys.includes(photo.originKey) || !isOwnedImageKey(ownerId, photo.key)
      || !imageKeys.includes(photo.key) && !authorizedPhotos.some(saved => saved.id === photo.id && saved.key === photo.key))) return bad();
  const proof = roles ? validateDetailWorkspaceRoles(roles, ownerId, imageKeys) : undefined;
  if (proof) {
    for (const role of ['top', 'bottom'] as const) {
      const protectedRows = result.photos.filter(photo => photo.role === role);
      if (!same(protectedRows.map(photo => photo.key), proof[role]) || protectedRows.some(photo => photo.originKey !== photo.key)) return bad();
    }
    if (result.photos.some(photo => photo.role === 'body' && (proof.top.includes(photo.key) || proof.bottom.includes(photo.key)))) return bad();
  }
  if (previous !== undefined) {
    const oldPhotos = previous ? document(previous).photos : [], old = new Map(oldPhotos.map(photo => [photo.id, photo]));
    if (!same(oldPhotos.filter(photo => photo.role !== 'body'), result.photos.filter(photo => photo.role !== 'body')) && previous) return bad();
    for (const photo of result.photos) {
      const saved = old.get(photo.id);
      if (saved ? saved.originKey !== photo.originKey || saved.role !== photo.role : photo.originKey !== photo.key) return bad();
      if (!saved && proof) {
        const expected = proof.top.includes(photo.key) ? 'top' : proof.bottom.includes(photo.key) ? 'bottom' : 'body';
        if (photo.role !== expected) return bad();
      }
    }
  }
  return result;
}
export function validateDetailWorkspaceExpectedView(value: unknown): DetailWorkspaceExpectedView {
  if (!exact(value, ['productVersion', 'revision', 'contentRevision', 'optionRevision', 'inputFingerprint', 'categoryContext'])
    || typeof value.productVersion !== 'string' || !Number.isFinite(Date.parse(value.productVersion))
    || ![value.revision, value.contentRevision, value.optionRevision].every(n => integer(n)) || !hash(value.inputFingerprint)) return bad();
  return { productVersion: value.productVersion, revision: value.revision as number, contentRevision: value.contentRevision as number,
    optionRevision: value.optionRevision as number, inputFingerprint: value.inputFingerprint, categoryContext: context(value.categoryContext) };
}
export function detailWorkspaceExpectedView(value: QuotationFieldsView): DetailWorkspaceExpectedView {
  return validateDetailWorkspaceExpectedView({ productVersion: value.productVersion, revision: value.revision, contentRevision: value.contentRevision,
    optionRevision: value.optionRevision, inputFingerprint: value.inputFingerprint, categoryContext: value.categoryContext });
}
/** Exact source/profile/path identity, not merely a shared category code. */
export async function detailWorkspaceScope(value: QuotationFieldsView['categoryContext']): Promise<string> {
  return labelUploadDigest(new TextEncoder().encode(JSON.stringify(context(value))));
}
export async function detailWorkspaceRequestId(productId: string, optionId: string, expectedRevision: number, expectedView: DetailWorkspaceExpectedView, value: DetailWorkspaceDocument): Promise<string> {
  if (!id(productId, 80) || !id(optionId, 80) || !integer(expectedRevision)) return bad();
  return labelUploadDigest(new TextEncoder().encode(JSON.stringify({ format: 'detail-workspace-save-v1', productId, optionId, expectedRevision,
    expectedView: validateDetailWorkspaceExpectedView(expectedView), document: document(value) })));
}
export function detailWorkspaceFileKeys(value: DetailWorkspaceDocument): string[] { return [...new Set(document(value).photos.flatMap(photo => [photo.originKey, photo.key]))]; }
function normalizedRecord(value: unknown): Omit<DetailWorkspaceRecord, 'digest'> {
  if (!exact(value, ['format', 'productId', 'optionId', 'context', 'company', 'revision', 'updatedAt', 'requestId', 'document', 'files'])
    || value.format !== 'detail-workspace-record-v1' || !id(value.productId, 80) || !id(value.optionId, 80) || !integer(value.revision, 1)
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)) || !hash(value.requestId)
    || !exact(value.company, ['code', 'name'])) return bad();
  const company = supplierHubCompany(value.company.code, value.company.name);
  if (!company || company.code !== value.company.code || company.name !== value.company.name) return bad();
  const saved = document(value.document), keys = detailWorkspaceFileKeys(saved);
  if (!Array.isArray(value.files) || value.files.length !== keys.length) return bad();
  let total = 0;
  const files = value.files.map((file, index): DetailWorkspaceFile => {
    if (!exact(file, ['key', 'sha256', 'bytes', 'width', 'height']) || file.key !== keys[index] || !hash(file.sha256) || !integer(file.bytes, 1, MAX_IMAGE_BYTES)
      || !integer(file.width, 1, 16000) || !integer(file.height, 1, 16000) || file.width * file.height > 40000000) return bad();
    total += file.bytes; if (total > 30 * 1024 * 1024) return bad();
    return { key: file.key, sha256: file.sha256, bytes: file.bytes, width: file.width, height: file.height };
  });
  return { format: 'detail-workspace-record-v1', productId: value.productId, optionId: value.optionId, context: context(value.context), company,
    revision: value.revision, updatedAt: value.updatedAt, requestId: value.requestId, document: saved, files };
}
export async function detailWorkspaceDigest(value: Omit<DetailWorkspaceRecord, 'digest'>): Promise<string> {
  return labelUploadDigest(new TextEncoder().encode(JSON.stringify(normalizedRecord(value))));
}
export function validateDetailWorkspaceRecord(value: unknown, ownerId: string, productId: string, optionId: string, categoryContext: QuotationFieldsView['categoryContext'], company: SupplierHubCompany): DetailWorkspaceRecord {
  if (!object(value) || !hash(value.digest)) return bad();
  const { digest, ...body } = value, record = normalizedRecord(body);
  if (record.productId !== productId || record.optionId !== optionId || !same(record.context, context(categoryContext)) || !same(record.company, company)
    || record.files.some(file => !isOwnedImageKey(ownerId, file.key))) return bad();
  const result = { ...record, digest };
  if (new TextEncoder().encode(JSON.stringify(result)).length > DETAIL_WORKSPACE_BODY_LIMIT) throw new DetailWorkspaceError('상세 작업공간 저장본은512KiB 이내여야 합니다.', 413);
  return result;
}
