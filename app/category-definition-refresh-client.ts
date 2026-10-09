import { validateCategoryProfile, type CategoryProfile } from '@/app/category-profiles';
import { validateHubSchemaSnapshot, type HubSchemaSnapshot } from '@/app/supplier-hub-schema';
import { carryCategoryDefinitionMappings } from '@/app/category-definition-refresh';
import { readCategoryJsonResponse } from '@/app/load-category-profiles';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
const identity = (schema: HubSchemaSnapshot) => [schema.format, schema.categoryId, schema.categoryPath, schema.company];
const definition = (schema: HubSchemaSnapshot) => [identity(schema), schema.schemaString, schema.metadata, schema.draftInitialization, schema.inputBindings, schema.settingsInitialization];

/** Observation time and object key order do not change a saved definition. */
export function sameCategoryHubDefinition(from: HubSchemaSnapshot | undefined, to: HubSchemaSnapshot): boolean {
  return Boolean(from && canonical(definition(from)) === canonical(definition(to)));
}
/** Rule-only updates keep their existing reviewed in-place mapping path. */
export function categoryDefinitionRequiresFork(profile: CategoryProfile, to: HubSchemaSnapshot): boolean {
  const from = profile.hubSchema;
  if (!from) return false;
  if (canonical(identity(from)) !== canonical(identity(to))) throw Error('저장 설정과 새 상세 양식의 회사·코드·전체 경로가 다릅니다. 같은 회사의 카테고리를 다시 선택해주세요.');
  return from.schemaString !== to.schemaString || canonical(from.metadata) !== canonical(to.metadata);
}

export type CategoryDefinitionRefreshRequest = { signature: string; id: string; url: string; body: string };
export type CategoryDefinitionRefreshRequestCache = { current: CategoryDefinitionRefreshRequest | null };
const invalidAck = () => Error('새 상세 양식의 원본·매핑·저장 결과를 확인하지 못했습니다. 기존 선택과 입력은 유지됩니다. 다시 확인해주세요.');
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');

/** The server rederives proof from owned bytes. The client verifies the ACK
 * before a caller may replace a queue row's original category selection. */
export async function refreshCategoryDefinition(source: CategoryProfile, captured: HubSchemaSnapshot, cache: CategoryDefinitionRefreshRequestCache,
  options: { signal: AbortSignal; fetcher?: typeof fetch; newKey?: () => string }): Promise<CategoryProfile> {
  const { signal } = options; signal.throwIfAborted();
  const schema = validateHubSchemaSnapshot(captured, source.categoryId, source.categoryPath);
  if (!categoryDefinitionRequiresFork(source, schema)) throw Error('상세 양식 정의가 변경되지 않았습니다. 저장한 설정을 다시 확인해주세요.');
  const signature = canonical([source.id, source.revision, definition(schema)]);
  if (cache.current?.signature !== signature) cache.current = { signature, id: (options.newKey ?? (() => crypto.randomUUID()))(),
    url: `/api/category-profiles/${encodeURIComponent(source.id)}/refresh-definition`, body: JSON.stringify({ expectedRevision: source.revision, hubSchema: schema }) };
  const pending = cache.current;
  const response = await (options.fetcher ?? fetch)(pending.url, { method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'Idempotency-Key': pending.id }, body: pending.body });
  const body = await readCategoryJsonResponse<{ profile?: CategoryProfile; sourceProfileId?: string; sourceRevision?: number; error?: string }>(response, '새 상세 양식 연결');
  signal.throwIfAborted();
  if (!response.ok) throw Error(body.error || '새 상세 양식 연결을 확인하지 못했습니다. 기존 선택과 입력은 유지됩니다.');
  const saved = body.profile;
  if (response.status !== 201 || body.sourceProfileId !== source.id || body.sourceRevision !== source.revision
    || !saved || typeof saved.id !== 'string' || saved.id !== pending.id.toLowerCase() || saved.id === source.id || saved.revision !== 1
    || saved.name !== source.name || saved.categoryId !== source.categoryId || canonical(saved.categoryPath) !== canonical(source.categoryPath)
    || !saved.hubSchema || !sameCategoryHubDefinition(saved.hubSchema, schema)) throw invalidAck();
  validateCategoryProfile(saved); validateHubSchemaSnapshot(saved.hubSchema, source.categoryId, source.categoryPath);
  if (!source.template) {
    if (saved.template !== null) throw invalidAck();
  } else {
    if (!saved.template) throw invalidAck();
    const expected = { ...source.template };
    if (source.template.workbookEvidence) expected.workbookEvidence = { ...source.template.workbookEvidence, sourceSchemaSha256: await digest(schema.schemaString) };
    // A legacy verified original may acquire descriptors for its previously
    // unmatched columns. Existing original descriptors must remain exact.
    if (expected.workbookFields === undefined && saved.template.workbookFields !== undefined) expected.workbookFields = saved.template.workbookFields;
    if (canonical(expected) !== canonical(saved.template)) throw invalidAck();
  }
  if (canonical(carryCategoryDefinitionMappings(source, saved)) !== canonical(saved.mappings)) throw invalidAck();
  signal.throwIfAborted();
  return saved;
}
