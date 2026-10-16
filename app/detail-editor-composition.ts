import type { QuotationFieldsState } from '@/db/quotation-fields';
import type { QuotationFieldsView } from '@/app/quotation-schema';
import { quotationValueLength } from '@/app/quotation-scalar-constraints';
import { optionImageTargets } from '@/app/quotation-image-targets';
import { detailEditorInputs, validateDetailEditorInputs, type DetailEditorInputs } from '@/app/detail-editor-inputs';
import { DETAIL_SAVE_EDITOR_POLICY, DETAIL_SAVE_TEXT_POLICY, type DetailSaveBackup } from '@/app/detail-save-plan';
import { detailWorkspaceDigest, validateDetailWorkspaceRecord } from '@/app/detail-workspace';
import { quotationScope } from '@/app/quotation-scopes';
import { supplierHubCompany, type SupplierHubCompany } from '@/app/supplier-hub-company';
import { labelUploadDigest } from '@/app/label-upload-key';

export type DetailSaveEditorSnapshot = {
  format: 'detail-editor-snapshot-v1'; context: QuotationFieldsView['categoryContext']; company: SupplierHubCompany;
  html: { fieldKey: string; effective: string };
};
export type DetailEditorComposition = {
  format: 'saved-detail-composition-v1'; inputs: DetailEditorInputs;
  html: { fieldKey: string; effective: string; rawCommon: Record<string, string | null>; rawOption: Record<string, string | null> };
};
export type DetailCompositionSource = Pick<QuotationFieldsView, 'productVersion' | 'contentRevision' | 'optionRevision' | 'revision' | 'inputFingerprint' | 'categoryContext'>
  & { productId: string; profileId: string | null; optionId: string };
export type DetailCompositionReply = { source: DetailCompositionSource; composition: DetailEditorComposition };
export class DetailEditorCompositionError extends Error {
  constructor(public status: 404 | 409, message: string, public code?: 'DETAIL_COMPOSITION_MISSING') { super(message); }
}
const invalid = (): never => { throw new DetailEditorCompositionError(409, '저장한 상세 편집 구성과 현재 상품·옵션·회사 연결을 확인해주세요.'); };
const missing = (): never => { throw new DetailEditorCompositionError(404, '이 상세 저장본에는 복원할 사진·HTML 편집 구성이 없습니다.', 'DETAIL_COMPOSITION_MISSING'); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, fields: readonly string[]): value is Record<string, unknown> => object(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/u.test(value)
  && !['__proto__', 'prototype', 'constructor'].includes(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 150000;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Metadata only: HTML remains literal text and is never parsed or executed. */
export function validateDetailSaveEditorSnapshot(value: unknown): DetailSaveEditorSnapshot {
  if (!exact(value, ['format', 'context', 'company', 'html']) || value.format !== 'detail-editor-snapshot-v1'
    || !exact(value.context, ['source', 'profileId', 'categoryId', 'categoryPath']) || !['profile', 'collection', 'unknown'].includes(String(value.context.source))
    || !(value.context.profileId === null || id(value.context.profileId)) || !id(value.context.categoryId)
    || !Array.isArray(value.context.categoryPath) || value.context.categoryPath.length > 20 || value.context.categoryPath.some(part => typeof part !== 'string' || part.length > 500)
    || !exact(value.company, ['code', 'name']) || !supplierHubCompany(value.company.code, value.company.name)
    || supplierHubCompany(value.company.code, value.company.name)?.code !== value.company.code || supplierHubCompany(value.company.code, value.company.name)?.name !== value.company.name
    || !exact(value.html, ['fieldKey', 'effective']) || !id(value.html.fieldKey) || !text(value.html.effective)) return invalid();
  quotationScope(value.context.categoryId);
  return { format: 'detail-editor-snapshot-v1', context: { source: value.context.source as DetailSaveEditorSnapshot['context']['source'],
    profileId: value.context.profileId as string | null, categoryId: value.context.categoryId, categoryPath: [...value.context.categoryPath] as string[] },
  company: { code: value.company.code as string, name: value.company.name as string }, html: { fieldKey: value.html.fieldKey, effective: value.html.effective } };
}
export function detailSaveEditorHtml(view: QuotationFieldsView, sourceOptionId: string): DetailSaveEditorSnapshot['html'] {
  const target = optionImageTargets(view.resolved.schema.fields).detailHtml, rows = view.resolved.rows.filter(row => row.optionId === sourceOptionId), value = rows[0]?.fields[target.primary]?.value;
  if (!id(sourceOptionId) || rows.length !== 1 || !text(value) || target.fields.some(field => field.readOnly
    || quotationValueLength(field, value) > (field.maxLength ?? 150000)) || target.linked.some(field => rows[0].fields[field]?.value !== value)) return invalid();
  return { fieldKey: target.primary, effective: value };
}
export function createDetailSaveEditorSnapshot(view: QuotationFieldsView, sourceOptionId: string, company: SupplierHubCompany): DetailSaveEditorSnapshot {
  return validateDetailSaveEditorSnapshot({ format: 'detail-editor-snapshot-v1', context: view.categoryContext, company, html: detailSaveEditorHtml(view, sourceOptionId) });
}
export async function detailSaveEditorSha256(value: DetailSaveEditorSnapshot): Promise<string> {
  return labelUploadDigest(new TextEncoder().encode(JSON.stringify(validateDetailSaveEditorSnapshot(value))));
}
export function validateDetailEditorComposition(value: unknown, ownerId: string, categoryId: string): DetailEditorComposition {
  if (!exact(value, ['format', 'inputs', 'html']) || value.format !== 'saved-detail-composition-v1'
    || !exact(value.html, ['fieldKey', 'effective', 'rawCommon', 'rawOption']) || !id(value.html.fieldKey) || !text(value.html.effective)) return invalid();
  const html = value.html, maps = [html.rawCommon, html.rawOption];
  if (maps.some(map => !object(map) || Object.keys(map).length < 1 || Object.keys(map).length > 2
    || !Object.hasOwn(map, html.fieldKey as string) || Object.entries(map).some(([key, cell]) => !id(key) || cell !== null && !text(cell)))
    || !same(Object.keys(maps[0] as object), Object.keys(maps[1] as object))) return invalid();
  return { format: 'saved-detail-composition-v1', inputs: validateDetailEditorInputs(value.inputs, ownerId, categoryId),
    html: { fieldKey: value.html.fieldKey, effective: value.html.effective, rawCommon: { ...(value.html.rawCommon as Record<string, string | null>) }, rawOption: { ...(value.html.rawOption as Record<string, string | null>) } } };
}
/** Verify the complete stored snapshot even on an exact POST/recovery replay. */
export async function detailSaveEditorBackup(backup: DetailSaveBackup, view: QuotationFieldsView, company: SupplierHubCompany): Promise<DetailSaveEditorSnapshot | undefined> {
  const receipt = backup.receipt;
  if (receipt.editorPolicy === undefined && receipt.editorSha256 === undefined && backup.editor === undefined) {
    if (receipt.workspace !== undefined || backup.workspace !== undefined) return invalid();
    return;
  }
  if (receipt.editorPolicy !== DETAIL_SAVE_EDITOR_POLICY || typeof receipt.editorSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(receipt.editorSha256)) return invalid();
  const editor = validateDetailSaveEditorSnapshot(backup.editor), target = optionImageTargets(view.resolved.schema.fields).detailHtml;
  if (!same(editor.context, view.categoryContext) || !same(editor.company, company) || editor.html.fieldKey !== target.primary
    || target.fields.some(field => field.readOnly || quotationValueLength(field, editor.html.effective) > (field.maxLength ?? 150000))
    || await detailSaveEditorSha256(editor) !== receipt.editorSha256) return invalid();
  if (backup.workspace !== undefined || receipt.workspace !== undefined) {
    const proof = receipt.workspace;
    if (!exact(proof, ['revision', 'digest']) || !Number.isSafeInteger(proof.revision) || (proof.revision as number) < 1
      || typeof proof.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(proof.digest) || receipt.textPolicy !== DETAIL_SAVE_TEXT_POLICY) return invalid();
    const workspace = validateDetailWorkspaceRecord(backup.workspace, receipt.key.split('/')[0], backup.workspace?.productId ?? '', receipt.sourceOptionId, editor.context, company), { digest, ...record } = workspace;
    if (digest !== await detailWorkspaceDigest(record) || proof.revision !== workspace.revision || proof.digest !== digest) return invalid();
    const files = new Map(workspace.files.map(file => [file.key, file])), sources = workspace.document.photos.map(photo => {
      const file = files.get(photo.key); if (!file) return invalid(); return { key: photo.key, sha256: file.sha256, width: file.width, height: file.height };
    });
    if (!same(sources, backup.sources)) return invalid();
  }
  if (!Array.isArray(backup.before)) return invalid();
  for (const optionId of [null, receipt.sourceOptionId]) for (const field of target.fields) {
    const values = backup.before.filter(change => change.optionId === optionId && change.fieldKey === field.id);
    if (values.length !== 1 || values[0].value !== null && (!text(values[0].value) || quotationValueLength(field, values[0].value) > (field.maxLength ?? 150000))) return invalid();
  }
  const own = backup.before.find(change => change.optionId === receipt.sourceOptionId && change.fieldKey === target.primary)!.value,
    common = backup.before.find(change => change.optionId === null && change.fieldKey === target.primary)!.value;
  if ((own ?? common) !== null && (own ?? common) !== editor.html.effective) return invalid();
  return editor;
}
/** An ordinary own backup is the authority. Family input copies deliberately
 * carry no authority to import another product's historical manual HTML. */
export async function savedDetailEditorComposition(view: QuotationFieldsView, state: QuotationFieldsState, productId: string, optionId: string, company: SupplierHubCompany): Promise<DetailEditorComposition> {
  if (!id(productId) || !id(optionId) || !view.categoryContext.categoryId || state.productId !== productId || state.revision !== view.revision || state.updatedAt !== view.updatedAt) return invalid();
  const targets = optionImageTargets(view.resolved.schema.fields), rows = view.resolved.rows.filter(row => row.optionId === optionId), key = rows[0]?.fields[targets.detailImages.primary]?.value;
  if (rows.length !== 1 || typeof key !== 'string' || !key || targets.detailImages.fields.some(field => field.readOnly)
    || targets.detailImages.linked.some(field => rows[0].fields[field]?.value !== key) || targets.detailHtml.linked.some(field => rows[0].fields[field]?.value !== '')) return invalid();
  const scope = quotationScope(view.categoryContext.categoryId), history = state.detailSaveBackups?.[scope];
  if (history !== undefined && !Array.isArray(history)) return invalid();
  const backup = [...(history ?? [])].reverse().find(item => item?.receipt?.key === key);
  if (!backup) {
    if (Object.hasOwn(state.detailEditorInputs ?? {}, scope)) {
      const copied = detailEditorInputs(view, state, productId);
      if (!copied) return invalid();
      if (copied.origin.productId !== productId && copied.output.key === key) return missing();
    }
    if (history?.some(item => item?.editor !== undefined || item?.receipt?.editorPolicy !== undefined || item?.receipt?.editorSha256 !== undefined)) return invalid();
    return missing();
  }
  const editor = await detailSaveEditorBackup(backup, view, company);
  if (!editor) return missing();
  if (backup.workspace && backup.workspace.productId !== productId) return invalid();
  const inputs = detailEditorInputs(view, state, productId), receipt = backup.receipt;
  if (!inputs || inputs.origin.productId !== productId || inputs.origin.uploadId !== receipt.uploadId || inputs.origin.revision !== receipt.revision
    || inputs.origin.sourceOptionId !== receipt.sourceOptionId || inputs.output.key !== key || !same(inputs.images, backup.sources)) return invalid();
  const raw = (selected: string | null) => Object.fromEntries(targets.detailHtml.linked.map(fieldKey => {
    const matches = backup.before.filter(change => change.optionId === selected && change.fieldKey === fieldKey), value = matches[0]?.value;
    if (matches.length !== 1 || value !== null && !text(value) || value !== null && quotationValueLength(targets.detailHtml.fields.find(field => field.id === fieldKey)!, value) > (targets.detailHtml.fields.find(field => field.id === fieldKey)!.maxLength ?? 150000)) return invalid();
    return [fieldKey, value];
  }));
  return validateDetailEditorComposition({ format: 'saved-detail-composition-v1', inputs,
    html: { ...editor.html, rawCommon: raw(null), rawOption: raw(receipt.sourceOptionId) } }, key.split('/')[0], view.categoryContext.categoryId);
}
