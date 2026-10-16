import { validateFreeImageEditDocument, MAX_FREE_IMAGE_EDIT_BYTES, type FreeImageEditDocument } from '@/app/free-image-edit-document';
import { freeImageApplyIdentity, freeImageSourceIdentity, validateFreeImageSource, type FreeImageSource } from '@/app/free-image-translation';
import { isOwnedImageKey, MAX_IMAGE_BYTES } from '@/app/image-files';
import { readBoundedStream } from '@/app/request-body';
import { inspectImage } from '@/app/automation/image-edit';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import type { SupplierHubCompany } from '@/app/supplier-hub-company';

export const MAX_FREE_IMAGE_EDIT_RECORD_BYTES = MAX_FREE_IMAGE_EDIT_BYTES + 32 * 1024 + 4096;
export type FreeImageEditRecord = { format: 'free-image-edit-record-v1'; source: FreeImageSource; document: FreeImageEditDocument;
  context: QuotationFieldsView['categoryContext']; company: SupplierHubCompany;
  result: { key: string; sha256: string; bytes: number; width: number; height: number } };
export class FreeImageEditRecordError extends Error {
  constructor(public status: 404 | 409 | 413 | 503, message: string, public code?: string) { super(message); }
}
const invalid = () => new FreeImageEditRecordError(409, '저장한 이미지 편집 문서와 결과 파일의 연결을 확인해주세요.');
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
export async function freeImageEditDigest(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function freeImageEditDocumentBytes(document: FreeImageEditDocument) { return new TextEncoder().encode(JSON.stringify(document)); }
export async function freeImageEditOutputKey(source: FreeImageSource, document: FreeImageEditDocument, outputSha256: string) {
  document = validateFreeImageEditDocument(document, source);
  const documentSha256 = await freeImageEditDigest(freeImageEditDocumentBytes(document));
  const fingerprint = await freeImageEditDigest(new TextEncoder().encode(freeImageApplyIdentity(source, [], document.crop, documentSha256)));
  return { key: `${source.sourceKey.split('/')[0]}/${source.workspaceTarget ? 'free-image-workspace' : 'free-image'}-${source.productId}-${fingerprint}-${outputSha256}.png`, documentSha256 };
}
export async function prepareFreeImageEditRecord(sourceValue: FreeImageSource, documentValue: unknown, context: QuotationFieldsView['categoryContext'], company: SupplierHubCompany,
  result: FreeImageEditRecord['result']) {
  const source = validateFreeImageSource(JSON.parse(freeImageSourceIdentity(sourceValue))), document = validateFreeImageEditDocument(documentValue, source),
    owner = source.sourceKey.split('/')[0];
  if (!source.quotationTarget && !source.workspaceTarget || !isOwnedImageKey(owner, source.sourceKey) || !hash(result.sha256) || !Number.isSafeInteger(result.bytes) || result.bytes < 1 || result.bytes > MAX_IMAGE_BYTES
    || result.width !== (document.crop?.width ?? document.width) || result.height !== (document.crop?.height ?? document.height)
    || new TextEncoder().encode(JSON.stringify(source)).length > 32768) throw invalid();
  const expected = await freeImageEditOutputKey(source, document, result.sha256);
  if (result.key !== expected.key || !isOwnedImageKey(owner, result.key)) throw invalid();
  const record: FreeImageEditRecord = { format: 'free-image-edit-record-v1', source, document, context: structuredClone(context), company: structuredClone(company), result: { ...result } };
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  if (bytes.length > MAX_FREE_IMAGE_EDIT_RECORD_BYTES) throw new FreeImageEditRecordError(413, '이미지 편집 문서가 저장 한도를 초과했습니다. 입력은 유지됩니다.');
  return { record, bytes, documentSha256: expected.documentSha256, recordSha256: await freeImageEditDigest(bytes) };
}
/** Immutable sidecar may remain unreferenced after a conflict. It is never a
 * successful adoption until the existing quotation transaction links its PNG. */
export async function storeFreeImageEditRecord(bucket: Pick<R2Bucket, 'get' | 'put'>, prepared: Awaited<ReturnType<typeof prepareFreeImageEditRecord>>) {
  const key = prepared.record.result.key + '.edit.json';
  async function confirmed() {
    const object = await bucket.get(key); if (!object) return false;
    if (object.size !== prepared.bytes.length || object.size > MAX_FREE_IMAGE_EDIT_RECORD_BYTES || object.httpMetadata?.contentType !== 'application/json') throw invalid();
    const bytes = await readBoundedStream(object.body, MAX_FREE_IMAGE_EDIT_RECORD_BYTES);
    if (bytes.length !== prepared.bytes.length || await freeImageEditDigest(bytes) !== prepared.recordSha256) throw invalid();
    return true;
  }
  if (await confirmed()) return;
  try { await bucket.put(key, prepared.bytes, { onlyIf: new Headers({ 'if-none-match': '*' }), httpMetadata: { contentType: 'application/json' } }); }
  catch (error) { if (!await confirmed()) throw error; return; }
  if (!await confirmed()) throw new FreeImageEditRecordError(503, '편집 문서 저장 결과를 확인하지 못했습니다.');
}
export async function readFreeImageEditRecord(bucket: Pick<R2Bucket, 'get'>, owner: string, productId: string, outputKey: string) {
  if (!isOwnedImageKey(owner, outputKey)) throw invalid();
  const output = await bucket.get(outputKey); if (!output) throw invalid();
  const documentSha256 = output.customMetadata?.freeImageEditDocumentSha256;
  if (documentSha256 === undefined) {
    if (output.customMetadata?.freeImageEditRecordSha256 !== undefined || await bucket.get(outputKey + '.edit.json')) throw invalid();
    throw new FreeImageEditRecordError(404, '이 결과 이미지에는 다시 열 편집 문서가 없습니다.', 'image-edit-document-missing');
  }
  if (!hash(documentSha256) || !hash(output.customMetadata?.freeImageEditRecordSha256) || output.size < 1 || output.size > MAX_IMAGE_BYTES || output.httpMetadata?.contentType !== 'image/png') throw invalid();
  const object = await bucket.get(outputKey + '.edit.json');
  if (!object || object.size < 1 || object.size > MAX_FREE_IMAGE_EDIT_RECORD_BYTES || object.httpMetadata?.contentType !== 'application/json') throw invalid();
  const bytes = await readBoundedStream(object.body, MAX_FREE_IMAGE_EDIT_RECORD_BYTES);
  if (bytes.length !== object.size || await freeImageEditDigest(bytes) !== output.customMetadata.freeImageEditRecordSha256) throw invalid();
  let value: unknown; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw invalid(); }
  if (!exact(value, ['format', 'source', 'document', 'context', 'company', 'result']) || value.format !== 'free-image-edit-record-v1'
    || !exact(value.result, ['key', 'sha256', 'bytes', 'width', 'height'])) throw invalid();
  let prepared;
  try { prepared = await prepareFreeImageEditRecord(validateFreeImageSource(value.source), value.document, value.context as FreeImageEditRecord['context'], value.company as SupplierHubCompany, value.result as FreeImageEditRecord['result']); }
  catch { throw invalid(); }
  const { record } = prepared;
  if (record.source.productId !== productId || !isOwnedImageKey(owner, record.source.sourceKey) || record.result.key !== outputKey
    || prepared.documentSha256 !== documentSha256 || prepared.recordSha256 !== output.customMetadata.freeImageEditRecordSha256 || prepared.bytes.length !== bytes.length
    || output.size !== record.result.bytes || output.customMetadata.freeImageOutputSha256 !== record.result.sha256) throw invalid();
  const png = await readBoundedStream(output.body, MAX_IMAGE_BYTES);
  if (png.length !== record.result.bytes || await freeImageEditDigest(png) !== record.result.sha256) throw invalid();
  let dimensions; try { dimensions = inspectImage(png); } catch { throw invalid(); }
  if (dimensions.mime !== 'image/png' || dimensions.width !== record.result.width || dimensions.height !== record.result.height) throw invalid();
  return { ...prepared, documentSha256 };
}
