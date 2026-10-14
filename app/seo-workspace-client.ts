import { applySeoWorkspaceChanges, validateSeoWorkspaceInput, type SeoWorkspaceInput, type SeoWorkspaceView } from '@/app/seo-workspace';
import { assetRoles, labelFields } from '@/app/product-content';
import { optionFieldNames, OPTION_LIMIT } from '@/app/product-options';
import { PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-pool-limit';

export type SeoWorkspaceDraft = { seo: Partial<Record<'title' | 'keywords' | 'description', string>>; optionNames: Record<string, string> };
export const emptySeoWorkspaceDraft = (): SeoWorkspaceDraft => ({ seo: {}, optionNames: {} });
export const hasSeoWorkspaceDraft = (draft: SeoWorkspaceDraft) => Object.keys(draft.seo).length > 0 || Object.keys(draft.optionNames).length > 0;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const clock = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const revision = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const text = (value: unknown) => typeof value === 'string' && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const field = (value: unknown, array = false) => record(value) && (array ? Array.isArray(value.value) && value.value.every(text) : text(value.value))
  && ['unverified', 'collected', 'translated', 'generated', 'manual'].includes(String(value.provenance)) && (value.updatedAt === null || clock(value.updatedAt));

/** Stored legacy text may exceed today's editing limits. Validate its identity
 * and shape without turning unchanged values into a new manual patch. */
export function verifySeoWorkspaceView(value: unknown, productId: string): asserts value is SeoWorkspaceView {
  if (!record(value) || value.productId !== productId || !clock(value.productVersion)
    || !record(value.content) || value.content.productId !== productId || value.content.schemaVersion !== 1 || !revision(value.content.revision)
    || value.content.updatedAt !== null && !clock(value.content.updatedAt) || !record(value.content.seo)
    || !field(value.content.seo.title) || !field(value.content.seo.keywords, true) || !field(value.content.seo.description)
    || !record(value.content.label) || Object.keys(labelFields).some(key => !field(((value.content as Record<string, unknown>).label as Record<string, unknown>)[key]))
    || !record(value.content.assets) || Object.keys(assetRoles).some(key => !field(((value.content as Record<string, unknown>).assets as Record<string, unknown>)[key], true))
    || !record(value.options) || value.options.productId !== productId || value.options.schemaVersion !== 1 || !revision(value.options.revision)
    || value.options.updatedAt !== null && !clock(value.options.updatedAt) || !Array.isArray(value.options.rows) || value.options.rows.length > OPTION_LIMIT
    || !Array.isArray(value.imageKeys) || value.imageKeys.length > PRODUCT_IMAGE_POOL_LIMIT || new Set(value.imageKeys).size !== value.imageKeys.length
    || value.imageKeys.some(key => typeof key !== 'string' || !key || key.length > 512 || /[\u0000-\u001f\u007f]/u.test(key)))
    throw Error('같은 상품의 SEO·옵션 저장본을 확인하지 못했습니다. 상품을 다시 확인해주세요.');
  const ids = new Set<string>();
  for (const row of value.options.rows) {
    if (!record(row) || typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(row.id) || ids.has(row.id)
      || !text(row.originalName) || !text(row.translatedName) || !text(row.supplierSku) || typeof row.included !== 'boolean'
      || row.imageKey !== null && !text(row.imageKey) || !clock(row.updatedAt) || !record(row.provenance)
      || !['unverified', 'collected', 'translated', 'manual'].includes(String(row.provenance.translatedName))
      || Object.keys(optionFieldNames).some(key => (row.provenance as Record<string, unknown>)[key] !== undefined && !['unverified', 'collected', 'translated', 'manual'].includes(String((row.provenance as Record<string, unknown>)[key]))))
      throw Error('저장된 옵션 이름과 원문 연결을 확인하지 못했습니다.');
    ids.add(row.id);
  }
}

export function seoWorkspaceInput(view: SeoWorkspaceView, draft: SeoWorkspaceDraft): SeoWorkspaceInput {
  verifySeoWorkspaceView(view, view.productId);
  const seo: SeoWorkspaceInput['seo'] = {};
  if (Object.hasOwn(draft.seo, 'title')) seo.title = draft.seo.title;
  if (Object.hasOwn(draft.seo, 'description')) seo.description = draft.seo.description;
  if (Object.hasOwn(draft.seo, 'keywords')) seo.keywords = draft.seo.keywords!.split(/[\n,]/u).map(value => value.trim()).filter(Boolean);
  const names = Object.keys(draft.optionNames);
  if (names.some(id => view.options.rows.filter(row => row.id === id).length !== 1)) throw Error('수정한 옵션이 현재 저장본에 없습니다. 입력을 유지했습니다.');
  return validateSeoWorkspaceInput({ expectedProductVersion: view.productVersion, expectedContentRevision: view.content.revision, expectedOptionRevision: view.options.revision,
    ...(Object.keys(seo).length ? { seo } : {}), ...(names.length ? { optionNames: view.options.rows.filter(row => Object.hasOwn(draft.optionNames, row.id)).map(row => ({ optionId: row.id, value: draft.optionNames[row.id] })) } : {}) });
}

export function verifySeoWorkspaceSave(before: SeoWorkspaceView, input: SeoWorkspaceInput, saved: SeoWorkspaceView) {
  verifySeoWorkspaceView(saved, before.productId);
  const expected = applySeoWorkspaceChanges(before, validateSeoWorkspaceInput(input), saved.productVersion);
  if (!same(expected, saved)) throw Error('SEO 저장 응답이 수정한 항목과 일치하지 않습니다. 입력을 유지하고 저장본을 확인해주세요.');
}

export function seoWorkspaceSaveState(before: SeoWorkspaceView, input: SeoWorkspaceInput, latest: SeoWorkspaceView): 'saved' | 'unchanged' {
  verifySeoWorkspaceView(latest, before.productId);
  if (same(before, latest)) return 'unchanged';
  verifySeoWorkspaceSave(before, input, latest);
  return 'saved';
}

export function seoWorkspaceRefreshConflicts(before: SeoWorkspaceView, latest: SeoWorkspaceView, draft: SeoWorkspaceDraft): string[] {
  verifySeoWorkspaceView(latest, before.productId);
  if (Date.parse(latest.productVersion) < Date.parse(before.productVersion) || latest.content.revision < before.content.revision || latest.options.revision < before.options.revision)
    throw Error('저장본이 이전 버전입니다. 현재 입력을 유지했습니다.');
  const conflicts: string[] = [];
  for (const key of Object.keys(draft.seo) as (keyof SeoWorkspaceDraft['seo'])[]) {
    if (!same(before.content.seo[key], latest.content.seo[key])) conflicts.push(({ title: '상품명', keywords: '검색태그', description: '상품 설명' })[key]);
  }
  for (const id of Object.keys(draft.optionNames)) {
    const old = before.options.rows.find(row => row.id === id), next = latest.options.rows.find(row => row.id === id);
    if (!old || !next || old.originalName !== next.originalName || old.supplierSku !== next.supplierSku) throw Error('수정한 옵션의 원문 연결이 바뀌었습니다. 입력을 유지했습니다.');
    if (!same([old.translatedName, old.provenance.translatedName, old.updatedAt], [next.translatedName, next.provenance.translatedName, next.updatedAt])
      && (old.translatedName !== next.translatedName || old.provenance.translatedName !== next.provenance.translatedName)) conflicts.push(`옵션 ${next.originalName || id}`);
  }
  return conflicts;
}

export class SeoWorkspaceSaveError extends Error {
  constructor(message: string, public uncertain: boolean, public status?: number) { super(message); }
}
const endpoint = (productId: string) => `/api/products/${encodeURIComponent(productId)}/seo-workspace`;
export async function readSeoWorkspace(productId: string, request: typeof fetch = fetch, signal?: AbortSignal) {
  const response = await request(endpoint(productId), { cache: 'no-store', signal }), body: unknown = await response.json();
  if (!response.ok) throw Error(record(body) && typeof body.error === 'string' ? body.error : 'SEO·옵션 저장본을 불러오지 못했습니다.');
  verifySeoWorkspaceView(body, productId); return body;
}
export async function saveSeoWorkspace(before: SeoWorkspaceView, input: SeoWorkspaceInput, request: typeof fetch = fetch, signal?: AbortSignal) {
  const validated = validateSeoWorkspaceInput(input);
  applySeoWorkspaceChanges(before, validated, new Date(Math.max(Date.now(), Date.parse(before.productVersion) + 1)).toISOString());
  let response: Response | undefined;
  try {
    response = await request(endpoint(before.productId), { method: 'PATCH', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(validated) });
    const body: unknown = await response.json();
    if (!response.ok) throw Error(record(body) && typeof body.error === 'string' ? body.error : 'SEO 설정을 저장하지 못했습니다.');
    verifySeoWorkspaceView(body, before.productId); verifySeoWorkspaceSave(before, validated, body); return body;
  } catch (cause) {
    throw new SeoWorkspaceSaveError(cause instanceof Error ? cause.message : 'SEO 저장 결과를 확인하지 못했습니다.', !response || response.ok || response.status >= 500, response?.status);
  }
}
