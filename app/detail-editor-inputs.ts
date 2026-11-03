import type { QuotationFieldsState } from '@/db/quotation-fields';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { DETAIL_SAVE_TEXT_POLICY, detailSaveOptionIds, detailSaveOutputKeys, detailSaveOutputValue, type DetailSaveSource } from '@/app/detail-save-plan';
import { DETAIL_COMPOSITE_PARTS_POLICY, detailCompositePartDescriptor, validateDetailCompositeParts, validateDetailCompositePartSources, type DetailSavedCompositePart } from '@/app/detail-composite-parts';
import { optionImageTargets } from '@/app/quotation-image-targets';
import { quotationScope, scopedQuotationOverrides } from '@/app/quotation-scopes';
import { isOwnedImageKey, MAX_IMAGE_BYTES } from '@/app/image-files';
import { PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-pool-limit';
import { labelUploadKey } from '@/app/label-upload-key';

/** The sealed, ordered inputs of one saved composite, without OCR/editor claims. */
export type DetailEditorInputs = {
  format: 'saved-detail-inputs-v1'|'saved-detail-inputs-v2'; categoryId: string;
  origin: { productId: string; sourceOptionId: string; uploadId: string; revision: number };
  output: { key: string; sha256: string; bytes: number };
  images: DetailSaveSource[];
  partsPolicy?:typeof DETAIL_COMPOSITE_PARTS_POLICY;parts?:DetailSavedCompositePart[];
};

type InputsState = QuotationFieldsState & { detailEditorInputs?: Record<string, unknown> };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(value)
  && !['__proto__', 'prototype', 'constructor'].includes(value);
const integer = (value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => record(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = (): never => { throw Error('저장된 상세 입력 이미지의 원본·카테고리·파일 증거를 확인해주세요.'); };

/** Validate metadata only. The caller separately verifies actual owned bytes. */
export function validateDetailEditorInputs(value: unknown, ownerId: string, categoryId: string): DetailEditorInputs {
  if (typeof ownerId !== 'string' || typeof categoryId !== 'string') return invalid();
  quotationScope(categoryId);
  const multipart=record(value)&&value.format==='saved-detail-inputs-v2';
  if (!exact(value, ['format', 'categoryId', 'origin', 'output', 'images',...(multipart?['partsPolicy','parts']:[])]) || (!multipart&&value.format !== 'saved-detail-inputs-v1') || value.categoryId !== categoryId
    || !exact(value.origin, ['productId', 'sourceOptionId', 'uploadId', 'revision']) || !id(value.origin.productId) || !id(value.origin.sourceOptionId)
    || !hash(value.origin.uploadId) || !integer(value.origin.revision, 1)
    || !exact(value.output, ['key', 'sha256', 'bytes']) || !isOwnedImageKey(ownerId, value.output.key) || !hash(value.output.sha256)
    || !integer(value.output.bytes, 1, MAX_IMAGE_BYTES) || value.output.key !== labelUploadKey(ownerId, value.origin.uploadId)
    || !Array.isArray(value.images) || !value.images.length || value.images.length > PRODUCT_IMAGE_POOL_LIMIT) return invalid();
  const origin: DetailEditorInputs['origin'] = { productId: value.origin.productId, sourceOptionId: value.origin.sourceOptionId,
    uploadId: value.origin.uploadId, revision: value.origin.revision };
  const output: DetailEditorInputs['output'] = { key: value.output.key, sha256: value.output.sha256, bytes: value.output.bytes };
  let parts:DetailSavedCompositePart[]|undefined;
  if(multipart){
    if(value.partsPolicy!==DETAIL_COMPOSITE_PARTS_POLICY)return invalid();
    try{validateDetailCompositeParts(value.parts,value.images.length,true);}catch{return invalid();}
    parts=(value.parts as DetailSavedCompositePart[]).map(part=>({...part}));
    if(parts.some(part=>part.key!==labelUploadKey(ownerId,part.uploadId))||parts[0].key!==output.key||parts[0].sha256!==output.sha256||parts[0].bytes!==output.bytes||parts[0].uploadId!==origin.uploadId)return invalid();
  }
  let height = 0;
  const metadata = new Map<string, string>();
  const images = value.images.map((image: unknown): DetailSaveSource => {
    if (!exact(image, ['key', 'sha256', 'width', 'height']) || !isOwnedImageKey(ownerId, image.key) || image.key === output.key || parts?.some(part=>part.key===image.key)
      || !hash(image.sha256) || !integer(image.width, 1, 16000) || !integer(image.height, 1, 16000) || image.width * image.height > 40000000) return invalid();
    height += Math.max(1, Math.round(image.height * 800 / image.width));
    if (!multipart&&height > 16000) return invalid();
    const proof = JSON.stringify([image.sha256, image.width, image.height]);
    if (metadata.has(image.key) && metadata.get(image.key) !== proof) return invalid();
    metadata.set(image.key, proof);
    return { key: image.key, sha256: image.sha256, width: image.width, height: image.height };
  });
  if(parts)try{validateDetailCompositePartSources(parts.map(detailCompositePartDescriptor),images);}catch{return invalid();}
  return { format: multipart?'saved-detail-inputs-v2':'saved-detail-inputs-v1', categoryId,
    origin: { productId: origin.productId, sourceOptionId: origin.sourceOptionId, uploadId: origin.uploadId, revision: origin.revision },
    output: { key: output.key, sha256: output.sha256, bytes: output.bytes }, images,...(parts?{partsPolicy:DETAIL_COMPOSITE_PARTS_POLICY,parts}:{}) };
}

/** Scoped family metadata keeps its original source identity. An ordinary
 * fallback reads only the saved composite backup, never today's content roles. */
export function detailEditorInputs(view: QuotationFieldsView, state: QuotationFieldsState, productId: string): DetailEditorInputs | null {
  try {
    if (!id(productId) || !record(view) || !record(state) || state.schemaVersion !== 1 || state.productId !== productId
      || !integer(state.revision, 0) || state.revision !== view.revision || state.updatedAt !== view.updatedAt
      || !view.categoryContext?.categoryId || view.resolved?.schema?.status !== 'observed'
      || view.resolved.schema.categoryId !== view.categoryContext.categoryId || !Array.isArray(view.resolved.rows)
      || !Array.isArray(view.imageKeys) || view.imageKeys.length > PRODUCT_IMAGE_POOL_LIMIT || new Set(view.imageKeys).size !== view.imageKeys.length) return null;
    const categoryId = view.categoryContext.categoryId, scope = quotationScope(categoryId), optionIds = detailSaveOptionIds(view);
    if (optionIds.some(optionId => !id(optionId)) || view.resolved.rows.length !== optionIds.length + 1
      || JSON.stringify(scopedQuotationOverrides(state, categoryId)) !== JSON.stringify(view.overrides)) return null;
    const common = view.resolved.rows.filter(row => row.optionId === null), targets = optionImageTargets(view.resolved.schema.fields);
    if (common.length !== 1) return null;
    const key = common[0].fields[targets.detailImages.primary]?.value;
    if (typeof key !== 'string' || !key || key.split('\n').some(part=>!view.imageKeys.includes(part))
      || targets.detailImages.linked.some(field => common[0].fields[field]?.value !== key)
      || targets.detailHtml.linked.some(field => common[0].fields[field]?.value !== '')) return null;
    const ownerId = key.split('/')[0];
    if (!view.imageKeys.every(imageKey => isOwnedImageKey(ownerId, imageKey))) return null;
    const persisted = (state as InputsState).detailEditorInputs;
    let result: DetailEditorInputs;
    if (persisted !== undefined) {
      if (!record(persisted)) return null;
      if (Object.hasOwn(persisted, scope)) result = validateDetailEditorInputs(persisted[scope], ownerId, categoryId);
      else result = ordinaryInputs();
    } else result = ordinaryInputs();
    if ((result.parts?.map(part=>part.key).join('\n')??result.output.key) !== key || result.images.some(image => !view.imageKeys.includes(image.key))) return null;
    return result;

    function ordinaryInputs(): DetailEditorInputs {
      const history = state.detailSaveBackups?.[scope];
      if (!Array.isArray(history)) return invalid();
      const backup = [...history].reverse().find(entry => entry?.receipt&&detailSaveOutputValue(entry.receipt) === key), receipt = backup?.receipt;
      if (!receipt || receipt.categoryId !== categoryId || !integer(receipt.beforeRevision, 0)
        || receipt.revision !== receipt.beforeRevision + 1 || !integer(receipt.revision, 1, state.revision)
        || !Array.isArray(receipt.optionIds) || !receipt.optionIds.length || receipt.optionIds.length > 200
        || receipt.optionIds.some(optionId => !id(optionId)) || new Set(receipt.optionIds).size !== receipt.optionIds.length
        || !id(receipt.sourceOptionId) || !receipt.optionIds.includes(receipt.sourceOptionId) || optionIds.some(optionId => !receipt.optionIds.includes(optionId))
        || (receipt.textPolicy === undefined ? receipt.textCommonFilled !== undefined
          : receipt.textPolicy !== DETAIL_SAVE_TEXT_POLICY || typeof receipt.textCommonFilled !== 'boolean')) return invalid();
      detailSaveOutputKeys(receipt);
      return validateDetailEditorInputs({ format:receipt.parts?'saved-detail-inputs-v2':'saved-detail-inputs-v1', categoryId,
        origin: { productId, sourceOptionId: receipt.sourceOptionId, uploadId: receipt.uploadId, revision: receipt.revision },
        output: { key: receipt.key, sha256: receipt.sha256, bytes: receipt.bytes }, images: backup.sources,...(receipt.parts?{partsPolicy:receipt.partsPolicy,parts:receipt.parts}:{}) }, ownerId, categoryId);
    }
  } catch { return null; }
}
