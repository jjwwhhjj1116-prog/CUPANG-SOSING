import { labelFields, type LabelField } from '@/app/product-content';
import type { TranslationLabelMapping } from '@/app/translation-label-adoption';
import type { TranslationLabelReuseView } from '@/app/translation-label-reuse';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 10_000): value is string => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const version = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const field = (value: unknown): value is LabelField => typeof value === 'string' && Object.hasOwn(labelFields, value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function verifyTranslationLabelReuseView(value: unknown, productId: string, jobId: string, expectedVersion?: string): TranslationLabelReuseView {
  if (!object(value)) throw Error('표시사항 연결 응답이 올바른 객체가 아닙니다.');
  const attributes = value.attributes, fields = value.fields;
  if (value.format !== 'translation-label-reuse-v1' || value.productId !== productId || value.jobId !== jobId
    || !version(value.productVersion) || expectedVersion !== undefined && value.productVersion !== expectedVersion
    || !revision(value.contentRevision) || !digest(value.inputFingerprint) || !text(value.categoryId, 100) || !value.categoryId
    || !Array.isArray(value.categoryPath) || !value.categoryPath.length || value.categoryPath.length > 30 || !value.categoryPath.every(item => text(item, 200) && item.trim())
    || !text(value.sourceReference, 16_000) || !value.sourceReference || !Array.isArray(attributes) || attributes.length > 50
    || !attributes.every(item => object(item) && revision(item.sourceIndex) && Number(item.sourceIndex) < 50
      && ['sourceName','sourceValue','name','value'].every(key => text(item[key])) && String(item.value).trim())
    || new Set(attributes.map(item => item.sourceIndex)).size !== attributes.length
    || !Array.isArray(fields) || fields.length !== Object.keys(labelFields).length
    || !fields.every(item => object(item) && field(item.field) && item.label === labelFields[item.field] && text(item.before)
      && typeof item.eligible === 'boolean' && (item.reason === undefined || item.reason === null || text(item.reason, 2000)))
    || new Set(fields.map(item => item.field)).size !== fields.length
    || !Array.isArray(value.suggestions) || value.suggestions.length > fields.length
    || !value.suggestions.every(item => object(item) && revision(item.sourceIndex) && field(item.field)
      && attributes.some(attribute => attribute.sourceIndex === item.sourceIndex) && fields.some(target => target.field === item.field && target.eligible))
    || new Set(value.suggestions.map(item => item.sourceIndex)).size !== value.suggestions.length || new Set(value.suggestions.map(item => item.field)).size !== value.suggestions.length
    || !Array.isArray(value.skipped) || value.skipped.length > 100 || !value.skipped.every(item => text(item, 2000))) throw Error('저장된 번역과 현재 표시사항의 연결 응답을 확인하지 못했습니다. 최신 자료를 다시 조회해주세요.');
  return value as unknown as TranslationLabelReuseView;
}

export function translationLabelReuseSelection(view: TranslationLabelReuseView, mappings: readonly TranslationLabelMapping[]) {
  if (!mappings.length || mappings.length > view.fields.length || new Set(mappings.map(item => item.field)).size !== mappings.length
    || new Set(mappings.map(item => item.sourceIndex)).size !== mappings.length) throw Error('번역 속성과 표시사항을 중복 없이 선택해주세요.');
  return mappings.map(mapping => {
    const source = view.attributes.find(item => item.sourceIndex === mapping.sourceIndex), target = view.fields.find(item => item.field === mapping.field);
    if (!source || !target || !target.eligible) throw Error(target?.reason || '직접 수정한 값과 공란은 보존합니다. 연결할 표시사항을 다시 선택해주세요.');
    return { ...mapping, name: target.label, before: target.before, after: source.value };
  }).filter(item => item.before !== item.after);
}

const endpoint = (productId: string, jobId: string, profileId?: string) => `/api/products/${encodeURIComponent(productId)}/translation-labels?jobId=${encodeURIComponent(jobId)}${profileId ? `&profileId=${encodeURIComponent(profileId)}` : ''}`;
export async function readTranslationLabelReuse(productId: string, jobId: string, expectedVersion: string | undefined, signal: AbortSignal, profileId?: string) {
  const response = await fetch(endpoint(productId, jobId, profileId), { cache: 'no-store', signal }), value: unknown = await response.json();
  if (!response.ok) throw Error(object(value) && typeof value.error === 'string' ? value.error : '저장된 상품 속성 번역을 불러오지 못했습니다.');
  return verifyTranslationLabelReuseView(value, productId, jobId, expectedVersion);
}

export class TranslationLabelReuseSaveError extends Error { constructor(message: string, readonly mayHaveSaved: boolean) { super(message); } }
export async function saveTranslationLabelReuse(view: TranslationLabelReuseView, mappings: readonly TranslationLabelMapping[], signal: AbortSignal, profileId?: string) {
  const changes = translationLabelReuseSelection(view, mappings);
  if (!changes.length) throw new TranslationLabelReuseSaveError('현재 표시사항과 다른 번역값을 선택해주세요.', false);
  try {
    const response = await fetch(endpoint(view.productId, view.jobId, profileId), { method: 'POST', signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedProductVersion: view.productVersion, expectedContentRevision: view.contentRevision, expectedInputFingerprint: view.inputFingerprint,
        mappings: changes.map(({ sourceIndex, field }) => ({ sourceIndex, field })) }) });
    const value: unknown = await response.json();
    if (!response.ok) throw new TranslationLabelReuseSaveError(object(value) && typeof value.error === 'string' ? value.error : '표시사항 연결을 저장하지 못했습니다.', response.status >= 500);
    if (!object(value) || value.applied !== changes.length) throw Error('표시사항 저장 개수가 일치하지 않습니다.');
    const next = verifyTranslationLabelReuseView(value.view, view.productId, view.jobId);
    if (Date.parse(next.productVersion) <= Date.parse(view.productVersion) || next.contentRevision !== view.contentRevision + 1
      || next.inputFingerprint === view.inputFingerprint || next.categoryId !== view.categoryId || !same(next.categoryPath, view.categoryPath) || next.sourceReference !== view.sourceReference
      || !same(next.attributes, view.attributes) || changes.some(change => next.fields.find(item => item.field === change.field)?.before !== change.after)
      || view.fields.some(previous => !changes.some(change => change.field === previous.field) && next.fields.find(item => item.field === previous.field)?.before !== previous.before)) throw Error('현재 표시사항 저장 결과가 요청한 변경과 일치하지 않습니다.');
    return { view: next, applied: changes.length };
  } catch (cause) { if (cause instanceof TranslationLabelReuseSaveError) throw cause; throw new TranslationLabelReuseSaveError(cause instanceof Error ? cause.message : '표시사항 저장 결과를 확인하지 못했습니다.', true); }
}
