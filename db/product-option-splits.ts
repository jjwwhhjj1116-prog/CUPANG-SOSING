import { env } from 'cloudflare:workers';
import { ensureDatabase } from '@/db/queries';
import { ensureCollectionDatabase } from '@/db/collection-jobs';
import { readCollectionResult } from '@/db/collection-results';
import { collectionImagesSchema } from '@/db/collection-images';
import { readProductContent } from '@/db/product-content';
import { readProductOptions } from '@/db/product-options';
import { readProductLabels } from '@/db/product-labels';
import { readQuotationFields } from '@/db/quotation-fields';
import { hasUnsettledTranslation } from '@/db/translation-jobs';
import { listImageJobs } from '@/db/image-jobs';
import { findQuotationAiJob } from '@/db/quotation-ai-jobs';
import { ensureSupplierHubReceiptDatabase } from '@/db/supplier-hub-receipts';
import { ensureSingleReceiptDatabase } from '@/db/supplier-hub-single-receipts';
import { getAutomation } from '@/db/automation';
import { prepareProductRegistration, prepareProductRegistrationOptions } from '@/db/product-registration';
import { stableQuotationFieldsView } from '@/app/quotation-fields-snapshot';
import { planProductOptionSplit, type ProductOptionSplitGroup } from '@/app/product-option-split-plan';
import { fingerprint } from '@/app/automation/model';
import { verifyCapturedCollectionCompany } from '@/app/collection-company';
import { isOwnedImageKey, MAX_IMAGE_BYTES, PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-files';
import { ProductOptionSplitError, type ProductOptionSplitPreview, type ProductOptionSplitReceipt } from '@/app/product-option-split';
import type { SupplierHubCompany } from '@/app/supplier-hub-company';
import type { ProductRecord } from '@/db/queries';
import type { ProductContent } from '@/app/product-content';
import type { ProductOptions } from '@/app/product-options';
import type { ProductLabelsState } from '@/app/product-label';
import type { QuotationFieldsState } from '@/db/quotation-fields';

export const productOptionSplitOperationsSchema = `CREATE TABLE IF NOT EXISTS product_option_split_operations (
 owner_id TEXT NOT NULL, request_id TEXT NOT NULL, source_product_id TEXT NOT NULL REFERENCES products(id),
 family_id TEXT NOT NULL, root_product_id TEXT NOT NULL REFERENCES products(id), profile_id TEXT, attempt_id TEXT NOT NULL,
 request_payload TEXT NOT NULL CHECK(json_valid(request_payload)), before_payload TEXT NOT NULL CHECK(json_valid(before_payload)),
 after_payload TEXT NOT NULL CHECK(json_valid(after_payload)), receipt_payload TEXT NOT NULL CHECK(json_valid(receipt_payload)),
 committed_at TEXT NOT NULL, PRIMARY KEY(owner_id,request_id)
)`;
export const productOptionSplitMembersSchema = `CREATE TABLE IF NOT EXISTS product_option_split_members (
 owner_id TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES products(id), family_id TEXT NOT NULL,
 root_product_id TEXT NOT NULL REFERENCES products(id), parent_product_id TEXT REFERENCES products(id),
 operation_request_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_id,product_id),
 FOREIGN KEY(owner_id,operation_request_id) REFERENCES product_option_split_operations(owner_id,request_id)
)`;
const columns = ['id', 'owner_id', 'source_url', 'title', 'source_price_cny', 'exchange_rate', 'supply_margin', 'coupang_margin', 'supply_price', 'sale_price', 'msrp',
  'options_count', 'seo_status', 'image_status', 'quote_status', 'registration_status', 'supplier_hub_status', 'image_keys', 'goal_stage', 'created_at', 'updated_at'];
const jsonRow = (names: readonly string[], alias = 't') => `json_object(${names.flatMap(name => [`'${name}'`, `${alias}.${name}`]).join(',')})`;
const rows = (table: string, names: readonly string[], where: string, order: string) => `(SELECT json_group_array(json(v)) FROM (SELECT ${jsonRow(names)} AS v FROM ${table} t WHERE ${where} ORDER BY ${order}))`;
const scope = 't.owner_id=a.owner AND t.product_id=a.id';
const linked = '(SELECT job_id FROM collection_products WHERE owner_id=a.owner AND product_id=a.id)';
/** One SELECT pairs every parsed payload with its exact original SQLite row.
 * These fixed internal table/column literals never interpolate user input. */
const snapshotSql = `WITH a(owner,id,profile) AS (VALUES(?,?,?)) SELECT json_object(
 'products',${rows('products', columns, 't.owner_id=a.owner AND t.id=a.id', 't.id')},
 'content',${rows('product_content', ['product_id', 'owner_id', 'revision', 'payload', 'updated_at'], scope, 't.product_id')},
 'options',${rows('product_options', ['product_id', 'owner_id', 'revision', 'payload', 'updated_at'], scope, 't.product_id')},
 'quotation',${rows('product_quotation_fields', ['product_id', 'owner_id', 'revision', 'payload', 'updated_at'], scope, 't.product_id')},
 'labels',${rows('product_labels', ['product_id', 'owner_id', 'revision', 'payload', 'updated_at'], scope, 't.product_id')},
 'policy',${rows('product_price_policy', ['product_id', 'payload'], 't.product_id=a.id', 't.product_id')},
 'settings',${rows('workspace_settings', ['owner_id', 'payload', 'updated_at'], 't.owner_id=a.owner', 't.owner_id')},
 'profile',${rows('category_profiles', ['id', 'owner_id', 'revision', 'payload', 'updated_at'], 't.owner_id=a.owner AND t.id=a.profile', 't.id')},
 'member',${rows('members', ['id', 'email', 'role', 'status', 'company_code', 'company_name', 'updated_at'], 't.id=a.owner', 't.id')},
 'links',${rows('collection_products', ['job_id', 'owner_id', 'product_id', 'created_at'], scope, 't.job_id')},
 'jobs',${rows('collection_jobs', ['id', 'owner_id', 'offer_id', 'source_url', 'goal', 'status', 'created_at', 'updated_at'], `t.owner_id=a.owner AND t.id=${linked}`, 't.id')},
 'context',${rows('collection_context', ['job_id', 'payload'], `t.job_id=${linked}`, 't.job_id')},
 'result',${rows('collection_results', ['job_id', 'owner_id', 'payload', 'received_at'], `t.owner_id=a.owner AND t.job_id=${linked}`, 't.job_id')},
 'supplements',${rows('collection_source_supplements', ['job_id', 'owner_id', 'base_payload', 'captured_payload', 'payload', 'received_at'], `t.owner_id=a.owner AND t.job_id=${linked}`, 't.job_id')},
 'images',${rows('collection_images', ['job_id', 'image_index', 'owner_id', 'product_id', 'object_key', 'operation_id', 'created_at'], scope, 't.image_index')},
 'family',${rows('product_option_split_members', ['owner_id', 'product_id', 'family_id', 'root_product_id', 'parent_product_id', 'operation_request_id', 'created_at'], scope, 't.product_id')},
 'removed',EXISTS(SELECT 1 FROM product_removals t WHERE ${scope}),
 'busy',EXISTS(SELECT 1 FROM translation_jobs t WHERE ${scope} AND t.status IN ('running','uncertain'))
 OR EXISTS(SELECT 1 FROM image_jobs t WHERE ${scope} AND t.status IN ('running','uncertain'))
 OR EXISTS(SELECT 1 FROM quotation_ai_jobs t WHERE ${scope} AND t.status IN ('running','uncertain'))
 OR EXISTS(SELECT 1 FROM product_automation t WHERE ${scope} AND (json_extract(t.payload,'$.status')='running' OR EXISTS(SELECT 1 FROM json_tree(t.payload) WHERE key='status' AND value IN ('running','uncertain')))),
 'transmitted',EXISTS(SELECT 1 FROM supplier_hub_receipts t WHERE ${scope}) OR EXISTS(SELECT 1 FROM supplier_hub_single_receipts t WHERE ${scope})
 ) AS payload FROM a`;
type Raw = Record<string, Record<string, unknown>[]> & { removed: number; busy: number; transmitted: number };
type Member = { email: string; role: string; companyCode: string; companyName: string };
const conflict = (message = '분할 원천·회원·카테고리 자료가 변경되었습니다. 기존 상품은 유지됩니다. 미리보기를 다시 확인해주세요.') => new ProductOptionSplitError(message);
const bytes = (value: string) => new TextEncoder().encode(value).length;
async function database(owner: string, id: string) {
  await ensureDatabase(); const db = await ensureCollectionDatabase();
  await db.batch([db.prepare(productOptionSplitOperationsSchema), db.prepare(productOptionSplitMembersSchema), db.prepare(collectionImagesSchema)]);
  await Promise.all([readProductContent(owner, id), readProductOptions(owner, id), readProductLabels(owner, id), readQuotationFields(owner, id),
    readCollectionResult(owner, '__split_schema__'), hasUnsettledTranslation(owner, id), listImageJobs(owner, id), findQuotationAiJob(owner, id, '__split_schema__'),
    ensureSupplierHubReceiptDatabase(), ensureSingleReceiptDatabase(), getAutomation(owner, id)]);
  return db;
}
async function rawSnapshot(db: D1Database, owner: string, id: string, profileId: string | null) {
  const row = await db.prepare(snapshotSql).bind(owner, id, profileId).first<{ payload: string }>();
  if (!row) throw conflict();
  return { payload: row.payload, raw: JSON.parse(row.payload) as Raw };
}
/** Additive read-only adapter shared by explicit family-detail application.
 * It retains the exact paired row snapshot and changes no split behavior. */
export async function readOwnedSplitSnapshot(owner: string, id: string, profileId: string | null, existingDb?: D1Database) {
  const db = existingDb ?? await database(owner, id);
  return { db, ...await rawSnapshot(db, owner, id, profileId) };
}
export function splitSnapshotPredicate(owner: string, id: string, profileId: string | null, payload: string) {
  return { sql: `(${snapshotSql})=?`, args: [owner, id, profileId, payload], expression: `(${snapshotSql})`, parameters: [owner, id, profileId] };
}
function sourceState(raw: Raw, id: string) {
  const read = <T>(name: string, absent: T): T => raw[name].length ? JSON.parse(raw[name][0].payload as string) as T : absent;
  if (raw.products.length !== 1 || raw.content.length !== 1 || raw.options.length !== 1) throw conflict('저장된 원본 상품·SEO·옵션 자료가 필요합니다. 먼저 저장해주세요.');
  const product = raw.products[0] as unknown as ProductRecord;
  return { product: { ...product, pricing_policy: raw.policy[0]?.payload as string | undefined },
    content: read<ProductContent>('content', null!), options: read<ProductOptions>('options', null!),
    quotation: read<QuotationFieldsState>('quotation', { schemaVersion: 1, productId: id, revision: 0, updatedAt: null, overrides: { common: {}, options: {} } }),
    labels: read<ProductLabelsState>('labels', { schemaVersion: 1, productId: id, revision: 0, updatedAt: null, overrides: { common: {}, options: {} } }) };
}
async function imageProof(owner: string, product: ProductRecord, sourceKeys: unknown[] = []) {
  let keys: unknown; try { keys = JSON.parse(product.image_keys); } catch { throw conflict('저장된 이미지 목록을 확인해주세요.'); }
  if (!Array.isArray(keys) || !keys.length || keys.length > PRODUCT_IMAGE_POOL_LIMIT || new Set(keys).size !== keys.length || keys.some(key => !isOwnedImageKey(owner, key))) throw conflict('이 계정에 저장한 이미지 목록이 필요합니다.');
  if (sourceKeys.some(key => !isOwnedImageKey(owner, key))) throw conflict('원본 이미지 소유권을 확인해주세요.');
  const images = [];
  for (const key of [...new Set([...(keys as string[]), ...(sourceKeys as string[])])]) {
    const object = await env.FILES?.head(key);
    if (!object || object.size < 1 || object.size > MAX_IMAGE_BYTES) throw conflict('원본 이미지가 저장소에 없습니다. 먼저 이미지 저장을 완료해주세요.');
    images.push({ key, size: object.size, etag: object.etag ?? null });
  }
  return images;
}
type Input = { requestId: string; expectedInputFingerprint: string; groups: ProductOptionSplitGroup[]; previewFingerprint?: string };
const requestPayload = (profileId: string | null, input: Input) => JSON.stringify({ profileId, expectedInputFingerprint: input.expectedInputFingerprint, groups: input.groups });
export async function previewProductOptionSplit(owner: string, company: SupplierHubCompany, member: Member, id: string, profileId: string | null, input: Input) {
  const db = await database(owner, id), saved = await stableQuotationFieldsView(owner, id, profileId);
  if (saved.view.inputFingerprint !== input.expectedInputFingerprint) throw conflict();
  const effectiveProfile = saved.view.categoryContext.profileId, snapshot = await rawSnapshot(db, owner, id, effectiveProfile), { raw } = snapshot, source = sourceState(raw, id);
  const identity = raw.member[0];
  if (raw.member.length !== 1 || identity.status !== 'approved' || identity.email !== member.email || identity.role !== member.role
    || identity.company_code !== company.code || identity.company_name !== company.name) throw new ProductOptionSplitError('승인된 회사 회원을 다시 확인해주세요.', 403);
  if (raw.removed || raw.busy || raw.transmitted || source.product.supplier_hub_status !== '미전송'
    || /전송|접수|등록중|등록완료|처리중/u.test(source.product.registration_status)) throw conflict('전송 이력·등록 진행 또는 실행 중인 작업이 있는 상품은 분할할 수 없습니다. 작업 결과를 먼저 확인해주세요.');
  if (raw.links.length !== 1 || raw.jobs.length !== 1 || raw.context.length !== 1 || raw.result.length !== 1 || !raw.images.length) throw conflict('상품에 연결된 저장 원문·카테고리·원본 이미지 기록이 필요합니다.');
  const job = raw.jobs[0], result = JSON.parse(raw.result[0].payload as string), captured = JSON.parse(raw.context[0].payload as string);
  if (job.status !== 'awaiting_connector' || job.source_url !== source.product.source_url || result.sourceUrl !== job.source_url || result.offerId !== job.offer_id
    || raw.images.some(image => image.job_id !== job.id || image.product_id !== id || !isOwnedImageKey(owner, image.object_key))) throw conflict('현재 상품과 저장 원문·이미지 연결이 일치하지 않습니다.');
  if (!verifyCapturedCollectionCompany(captured, company)) throw conflict('수집 당시 회사를 확인할 수 없습니다.');
  const images = await imageProof(owner, source.product, raw.images.map(image => image.object_key));
  const now = new Date(Math.max(Date.now(), Date.parse(source.product.updated_at) + 1)).toISOString();
  let plan: ReturnType<typeof planProductOptionSplit>;
  try { plan = planProductOptionSplit(source, input.groups, now); }
  catch (error) { throw new ProductOptionSplitError(error instanceof Error ? error.message : '분할 그룹을 확인해주세요.', 400, 'OPTION_SPLIT_INVALID'); }
  const targetIds = plan.groups.slice(1).flatMap(group => [group.product.id, ...group.options.rows.map(row => row.id)]);
  const collision = await db.prepare(`SELECT id FROM products WHERE id IN (SELECT value FROM json_each(?))
    UNION ALL SELECT option_id FROM product_registration_options WHERE option_id IN (SELECT value FROM json_each(?))
    UNION ALL SELECT json_extract(o.value,'$.id') FROM product_options p,json_each(p.payload,'$.rows') o WHERE json_extract(o.value,'$.id') IN (SELECT value FROM json_each(?)) LIMIT 1`)
    .bind(JSON.stringify(targetIds), JSON.stringify(targetIds), JSON.stringify(targetIds)).first();
  if (collision) throw conflict('새 상품·옵션 ID가 이미 사용되었습니다. 새 분할 요청을 만들어주세요.');
  const before = JSON.stringify({ source: raw }); if (bytes(before) > 1024 * 1024 || bytes(JSON.stringify(plan)) > 2 * 1024 * 1024) throw new ProductOptionSplitError('분할 원본·전체 복사 자료가 보관 한도를 초과합니다. 분할 그룹이나 자료 크기를 줄여주세요.', 413);
  const current = await stableQuotationFieldsView(owner, id, profileId);
  if (JSON.stringify(current.view) !== JSON.stringify(saved.view) || (await rawSnapshot(db, owner, id, effectiveProfile)).payload !== snapshot.payload) throw conflict();
  const proof = await fingerprint({ owner, company, profileId, source: snapshot.payload, images, request: requestPayload(profileId, input) });
  const preview: ProductOptionSplitPreview = { format: 'product-option-split-preview-v1', requestId: input.requestId, fingerprint: proof, sourceProductId: id,
    sourceVersion: source.product.updated_at, company, groups: plan.groups.map(group => ({ productId: group.product.id, label: group.label, title: group.product.title, seoTitle: group.content.seo.title.value,
      optionIds: group.options.rows.map(row => row.id), sourceOptionIds: group.sourceOptionIds, retainsSource: group.retainsSource })),
    warnings: ['수동으로 작성한 공통·옵션별 견적서 상품명은 그대로 유지합니다. 상품명과 SEO 제목의 분할 이름을 저장 전 확인해주세요.',
      '현재 검토한 옵션 배분만 저장합니다. 자동 분류·삭제 또는 Supplier Hub 전송을 수행하지 않습니다.'] };
  return { db, preview, plan, snapshot, before, images, effectiveProfile, now };
}

type Stored = { source_product_id: string; profile_id: string | null; request_payload: string; after_payload: string; receipt_payload: string };
export async function recoverProductOptionSplit(owner: string, company: SupplierHubCompany, id: string, profileId: string | null, requestId: string, input?: Input) {
  const db = await database(owner, id), member = await db.prepare('SELECT status,company_code,company_name FROM members WHERE id=?').bind(owner).first<{ status: string; company_code: string; company_name: string }>();
  if (!member || member.status !== 'approved' || member.company_code !== company.code || member.company_name !== company.name) throw new ProductOptionSplitError('승인된 회사 회원을 다시 확인해주세요.', 403);
  const row = await db.prepare('SELECT source_product_id,profile_id,request_payload,after_payload,receipt_payload FROM product_option_split_operations WHERE owner_id=? AND request_id=?')
    .bind(owner, requestId).first<Stored>();
  if (!row) return null;
  const receipt = JSON.parse(row.receipt_payload) as ProductOptionSplitReceipt;
  if (row.source_product_id !== id || row.profile_id !== profileId || receipt.company.code !== company.code || receipt.company.name !== company.name
    || input && (row.request_payload !== requestPayload(profileId, input) || receipt.fingerprint !== input.previewFingerprint)) throw conflict('같은 요청번호에 다른 상품·회사·분할 입력을 적용하지 않았습니다.');
  const after = JSON.parse(row.after_payload) as AfterGroup[];
  let current = await allGroupsMatch(db, owner, after);
  for (const group of receipt.groups) {
    const record = await db.prepare(`SELECT n.registration_number,m.family_id FROM products p LEFT JOIN product_registration_numbers n ON n.product_id=p.id AND n.owner_id=p.owner_id
      LEFT JOIN product_option_split_members m ON m.product_id=p.id AND m.owner_id=p.owner_id WHERE p.owner_id=? AND p.id=?`).bind(owner, group.productId).first<{ registration_number: string | null; family_id: string | null }>();
    if (!record || record.registration_number !== group.registrationNumber || record.family_id !== receipt.familyId) current = false;
    if (!group.retainsSource) {
      const mappings = await db.prepare('SELECT option_id FROM product_registration_options WHERE owner_id=? AND product_id=?').bind(owner, group.productId).all<{ option_id: string }>();
      if (mappings.results.length !== group.optionIds.length || group.optionIds.some(id => !mappings.results.some(row => row.option_id === id))) current = false;
    }
  }
  return { receipt, current };
}
type AfterGroup = { product: Record<string, unknown>; content: ProductContent; options: ProductOptions; quotation: QuotationFieldsState; labels: ProductLabelsState;
  policy: string | null; job: Record<string, unknown>; familyMember: Record<string, unknown>; linkCreatedAt: string; context: string; result: Record<string, unknown>; supplements: Record<string, unknown>[]; images: Record<string, unknown>[] };
const recordGroups = (groups: AfterGroup[]) => JSON.stringify(groups);
const equality = (table: string, names: string[], expected: string, where = 't.product_id=json_extract(g.value,\'$.product.id\') AND t.owner_id=?') =>
  `EXISTS(SELECT 1 FROM ${table} t WHERE ${where} AND ${names.map(name => `t.${name} IS json_extract(g.value,'${expected}.${name}')`).join(' AND ')})`;
/** Compare actual committed records rather than treating the planned count as
 * success. JSON scalar payloads are byte-equal, preserving intentional blanks. */
function groupMatchSql() {
  const tests = [equality('products', columns, '$.product', "t.id=json_extract(g.value,'$.product.id') AND t.owner_id=?")];
  for (const [table, field] of [['product_content', 'content'], ['product_options', 'options'], ['product_quotation_fields', 'quotation'], ['product_labels', 'labels']])
    tests.push(`EXISTS(SELECT 1 FROM ${table} t WHERE t.product_id=json_extract(g.value,'$.product.id') AND t.owner_id=? AND t.payload=json_extract(g.value,'$.${field}') AND t.revision=json_extract(g.value,'$.${field}Revision') AND t.updated_at=json_extract(g.value,'$.product.updated_at'))`);
  tests.push(`(SELECT payload FROM product_price_policy WHERE product_id=json_extract(g.value,'$.product.id')) IS json_extract(g.value,'$.policy')`);
  tests.push(equality('collection_jobs', ['id', 'owner_id', 'offer_id', 'source_url', 'goal', 'status', 'created_at', 'updated_at'], '$.job', "t.id=json_extract(g.value,'$.job.id') AND t.owner_id=?"));
  tests.push(`EXISTS(SELECT 1 FROM collection_products t WHERE t.product_id=json_extract(g.value,'$.product.id') AND t.owner_id=? AND t.job_id=json_extract(g.value,'$.job.id') AND t.created_at=json_extract(g.value,'$.linkCreatedAt'))`);
  tests.push(`EXISTS(SELECT 1 FROM collection_context WHERE job_id=json_extract(g.value,'$.job.id') AND payload=json_extract(g.value,'$.context'))`);
  tests.push(`EXISTS(SELECT 1 FROM collection_results t WHERE t.job_id=json_extract(g.value,'$.job.id') AND t.owner_id=? AND t.payload=json_extract(g.value,'$.result.payload') AND t.received_at=json_extract(g.value,'$.result.received_at'))`);
  tests.push(`(SELECT COUNT(*) FROM collection_images t WHERE t.job_id=json_extract(g.value,'$.job.id') AND t.product_id=json_extract(g.value,'$.product.id') AND t.owner_id=?)=json_array_length(g.value,'$.images')`);
  tests.push(`NOT EXISTS(SELECT 1 FROM json_each(g.value,'$.images') i WHERE NOT EXISTS(SELECT 1 FROM collection_images t WHERE t.job_id=json_extract(g.value,'$.job.id') AND t.owner_id=? AND t.product_id=json_extract(g.value,'$.product.id') AND t.image_index=json_extract(i.value,'$.image_index') AND t.object_key=json_extract(i.value,'$.object_key') AND t.operation_id=json_extract(i.value,'$.operation_id') AND t.created_at=json_extract(i.value,'$.created_at')))`);
  tests.push(`NOT EXISTS(SELECT 1 FROM json_each(g.value,'$.supplements') i WHERE NOT EXISTS(SELECT 1 FROM collection_source_supplements t WHERE t.job_id=json_extract(g.value,'$.job.id') AND t.owner_id=? AND t.base_payload=json_extract(i.value,'$.base_payload') AND t.captured_payload=json_extract(i.value,'$.captured_payload') AND t.payload=json_extract(i.value,'$.payload') AND t.received_at=json_extract(i.value,'$.received_at')))`);
  tests.push(`(SELECT COUNT(*) FROM collection_source_supplements WHERE job_id=json_extract(g.value,'$.job.id'))=json_array_length(g.value,'$.supplements')`);
  tests.push(`NOT EXISTS(SELECT 1 FROM product_removals WHERE product_id=json_extract(g.value,'$.product.id'))`);
  tests.push(equality('product_option_split_members', ['product_id', 'family_id', 'root_product_id', 'parent_product_id', 'operation_request_id', 'created_at'], '$.familyMember'));
  return tests.join(' AND ');
}
const groupOwnerArgs = (owner: string) => Array.from({ length: 12 }, () => owner);
async function allGroupsMatch(db: D1Database, owner: string, after: AfterGroup[]) {
  const result = await db.prepare(`SELECT COUNT(*) AS total FROM json_each(?) g WHERE ${groupMatchSql()}`).bind(recordGroups(after), ...groupOwnerArgs(owner)).first<{ total: number }>();
  return result?.total === after.length;
}

export async function commitProductOptionSplit(owner: string, company: SupplierHubCompany, member: Member, id: string, profileId: string | null, input: Input) {
  const previous = await recoverProductOptionSplit(owner, company, id, profileId, input.requestId, input); if (previous) return previous;
  const prepared = await previewProductOptionSplit(owner, company, member, id, profileId, input);
  if (prepared.preview.fingerprint !== input.previewFingerprint) throw conflict();
  const { db, plan, snapshot, now, effectiveProfile } = prepared, raw = snapshot.raw;
  const familyId = raw.family[0]?.family_id as string ?? input.requestId, rootId = raw.family[0]?.root_product_id as string ?? id;
  const after: AfterGroup[] = plan.groups.map((group, index) => {
    const jobId = index === 0 ? raw.jobs[0].id as string : crypto.randomUUID();
    return { product: Object.fromEntries(columns.map(column => [column, group.product[column as keyof ProductRecord]])), content: group.content, options: group.options,
      quotation: group.quotation, labels: group.labels, policy: raw.policy[0]?.payload as string ?? null,
      job: index === 0 ? raw.jobs[0] : { ...raw.jobs[0], id: jobId, created_at: now, updated_at: now },
      familyMember: index === 0 && raw.family.length ? raw.family[0] : { owner_id: owner, product_id: group.product.id, family_id: familyId,
        root_product_id: rootId, parent_product_id: index === 0 ? null : id, operation_request_id: input.requestId, created_at: now },
      linkCreatedAt: index === 0 ? raw.links[0].created_at as string : now, context: raw.context[0].payload as string,
      result: { ...raw.result[0], job_id: jobId }, supplements: raw.supplements.map(row => ({ ...row, job_id: jobId })),
      images: raw.images.map(row => ({ ...row, job_id: jobId, product_id: group.product.id })) };
  });
  // State objects are retained as exact serialized payloads in the durable
  // after-image; revision companions make SQL verification independent of parsing.
  const sqlAfter = after.map(group => ({ ...group, contentRevision: group.content.revision, optionsRevision: group.options.revision,
    quotationRevision: group.quotation.revision, labelsRevision: group.labels.revision, content: JSON.stringify(group.content), options: JSON.stringify(group.options),
    quotation: JSON.stringify(group.quotation), labels: JSON.stringify(group.labels) }));
  const afterPayload = JSON.stringify(sqlAfter); if (bytes(afterPayload) > 2 * 1024 * 1024) throw new ProductOptionSplitError('전체 분할 자료가 저장 한도를 초과합니다.', 413);
  const receipt: ProductOptionSplitReceipt = { ...prepared.preview, format: 'product-option-split-receipt-v1', familyId, committedAt: now,
    groups: prepared.preview.groups.map((group, index) => ({ ...group, jobId: after[index].job.id as string, productVersion: now,
      contentRevision: plan.groups[index].content.revision, optionsRevision: plan.groups[index].options.revision,
      quotationRevision: plan.groups[index].quotation.revision, labelsRevision: plan.groups[index].labels.revision, registrationNumber: null })) };
  const attemptId = crypto.randomUUID(), request = requestPayload(profileId, input), created = `EXISTS(SELECT 1 FROM product_option_split_operations WHERE owner_id=? AND request_id=? AND attempt_id=?)`, createdArgs = [owner, input.requestId, attemptId];
  const targetIds = JSON.stringify(plan.groups.slice(1).flatMap(group => [group.product.id, ...group.options.rows.map(row => row.id)]));
  const statements = [db.prepare(`INSERT INTO product_option_split_operations(owner_id,request_id,source_product_id,family_id,root_product_id,profile_id,attempt_id,request_payload,before_payload,after_payload,receipt_payload,committed_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (${snapshotSql})=?
    AND NOT EXISTS(SELECT 1 FROM products WHERE id IN (SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM product_registration_options WHERE option_id IN (SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM product_options p,json_each(p.payload,'$.rows') r WHERE json_extract(r.value,'$.id') IN (SELECT value FROM json_each(?)))
    ON CONFLICT(owner_id,request_id) DO NOTHING RETURNING request_id`)
    .bind(owner, input.requestId, id, familyId, rootId, profileId, attemptId, request, prepared.before, afterPayload, JSON.stringify(receipt), now, owner, id, effectiveProfile, snapshot.payload, targetIds, targetIds, targetIds)];
  statements.push(db.prepare(`UPDATE products SET ${columns.filter(column => !['id', 'owner_id', 'created_at'].includes(column)).map(column => `${column}=json_extract(?,'$.${column}')`).join(',')}
    WHERE id=? AND owner_id=? AND ${created}`).bind(...columns.filter(column => !['id', 'owner_id', 'created_at'].includes(column)).map(() => JSON.stringify(after[0].product)), id, owner, ...createdArgs));
  statements.push(db.prepare(`INSERT INTO products(${columns.join(',')}) SELECT ${columns.map(column => `json_extract(g.value,'$.product.${column}')`).join(',')}
    FROM json_each(?) g WHERE CAST(g.key AS INTEGER)>0 AND ${created}`).bind(afterPayload, ...createdArgs));
  for (const [table, field] of [['product_content', 'content'], ['product_options', 'options'], ['product_quotation_fields', 'quotation'], ['product_labels', 'labels']])
    statements.push(db.prepare(`INSERT INTO ${table}(product_id,owner_id,revision,payload,updated_at) SELECT json_extract(g.value,'$.product.id'),?,json_extract(g.value,'$.${field}Revision'),json_extract(g.value,'$.${field}'),?
      FROM json_each(?) g WHERE ${created} ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at WHERE ${table}.owner_id=excluded.owner_id`).bind(owner, now, afterPayload, ...createdArgs));
  statements.push(db.prepare(`INSERT INTO product_price_policy(product_id,payload) SELECT json_extract(g.value,'$.product.id'),json_extract(g.value,'$.policy') FROM json_each(?) g WHERE CAST(g.key AS INTEGER)>0 AND json_extract(g.value,'$.policy') IS NOT NULL AND ${created}`).bind(afterPayload, ...createdArgs));
  statements.push(db.prepare(`INSERT INTO collection_jobs(id,owner_id,offer_id,source_url,goal,status,created_at,updated_at) SELECT ${['id', 'owner_id', 'offer_id', 'source_url', 'goal', 'status', 'created_at', 'updated_at'].map(column => `json_extract(g.value,'$.job.${column}')`).join(',')} FROM json_each(?) g WHERE CAST(g.key AS INTEGER)>0 AND ${created}`).bind(afterPayload, ...createdArgs));
  statements.push(db.prepare(`INSERT INTO collection_context(job_id,payload) SELECT json_extract(g.value,'$.job.id'),json_extract(g.value,'$.context') FROM json_each(?) g WHERE CAST(g.key AS INTEGER)>0 AND ${created}`).bind(afterPayload, ...createdArgs));
  statements.push(db.prepare(`INSERT INTO collection_results(job_id,owner_id,payload,received_at) SELECT json_extract(g.value,'$.job.id'),?,json_extract(g.value,'$.result.payload'),json_extract(g.value,'$.result.received_at') FROM json_each(?) g WHERE CAST(g.key AS INTEGER)>0 AND ${created}`).bind(owner, afterPayload, ...createdArgs));
  statements.push(db.prepare(`INSERT INTO collection_source_supplements(job_id,owner_id,base_payload,captured_payload,payload,received_at) SELECT json_extract(g.value,'$.job.id'),?,json_extract(s.value,'$.base_payload'),json_extract(s.value,'$.captured_payload'),json_extract(s.value,'$.payload'),json_extract(s.value,'$.received_at') FROM json_each(?) g,json_each(g.value,'$.supplements') s WHERE CAST(g.key AS INTEGER)>0 AND ${created}`).bind(owner, afterPayload, ...createdArgs));
  statements.push(db.prepare(`INSERT INTO collection_products(job_id,owner_id,product_id,created_at) SELECT json_extract(g.value,'$.job.id'),?,json_extract(g.value,'$.product.id'),? FROM json_each(?) g WHERE CAST(g.key AS INTEGER)>0 AND ${created}`).bind(owner, now, afterPayload, ...createdArgs));
  statements.push(db.prepare(`INSERT INTO collection_images(job_id,image_index,owner_id,product_id,object_key,operation_id,created_at) SELECT json_extract(g.value,'$.job.id'),json_extract(i.value,'$.image_index'),?,json_extract(g.value,'$.product.id'),json_extract(i.value,'$.object_key'),json_extract(i.value,'$.operation_id'),json_extract(i.value,'$.created_at') FROM json_each(?) g,json_each(g.value,'$.images') i WHERE CAST(g.key AS INTEGER)>0 AND ${created}`).bind(owner, afterPayload, ...createdArgs));
  statements.push(db.prepare(`INSERT INTO product_option_split_members(owner_id,product_id,family_id,root_product_id,parent_product_id,operation_request_id,created_at)
    SELECT ?,json_extract(g.value,'$.product.id'),?,?,CASE WHEN CAST(g.key AS INTEGER)=0 THEN NULL ELSE ? END,?,?
    FROM json_each(?) g WHERE ${created} AND (CAST(g.key AS INTEGER)>0 OR NOT EXISTS(SELECT 1 FROM product_option_split_members WHERE owner_id=? AND product_id=?))`)
    .bind(owner, familyId, rootId, id, input.requestId, now, afterPayload, ...createdArgs, owner, id));
  // Existing allocators also run when an INSERT no-ops. Add the operation guard
  // to each allocator SELECT, so a stale source plus a colliding child UUID
  // cannot allocate numbers on an unrelated concurrently created product.
  const allocationDb = { prepare(sql: string) { return { bind(...args: (string | number | null)[]) {
    const boundary = sql.search(/\bON CONFLICT\b|\bRETURNING\b/u), head = boundary < 0 ? sql : sql.slice(0, boundary), tail = boundary < 0 ? '' : sql.slice(boundary);
    return db.prepare(`${head} AND ${created} ${tail}`).bind(...args, ...createdArgs);
  } }; } } as unknown as D1Database;
  for (const group of plan.groups.slice(1)) statements.push(...prepareProductRegistration(allocationDb, owner, group.product.id, now), prepareProductRegistrationOptions(allocationDb, owner, group.product.id, group.options.rows.map(row => row.id), now));
  statements.push(db.prepare(`UPDATE product_option_split_operations SET receipt_payload=json_set(receipt_payload,'$.groups',json((SELECT json_group_array(json_set(g.value,'$.registrationNumber',(SELECT registration_number FROM product_registration_numbers n WHERE n.product_id=json_extract(g.value,'$.productId') AND n.owner_id=?))) FROM json_each(receipt_payload,'$.groups') g))) WHERE owner_id=? AND request_id=? AND after_payload=?`).bind(owner, owner, input.requestId, afterPayload));
  statements.push(db.prepare(`SELECT CASE WHEN NOT ${created} THEN 1 WHEN
    (SELECT COUNT(*) FROM json_each(?) g WHERE ${groupMatchSql()})=?
    AND NOT EXISTS(SELECT 1 FROM json_each(?) g WHERE NOT EXISTS(SELECT 1 FROM product_option_split_members m WHERE m.owner_id=? AND m.product_id=json_extract(g.value,'$.product.id') AND m.family_id=? AND m.root_product_id=?))
    AND NOT EXISTS(SELECT 1 FROM json_each(?) g WHERE CAST(g.key AS INTEGER)>0 AND (NOT EXISTS(SELECT 1 FROM product_registration_numbers n WHERE n.owner_id=? AND n.product_id=json_extract(g.value,'$.product.id')) OR (SELECT COUNT(*) FROM product_registration_options o WHERE o.owner_id=? AND o.product_id=json_extract(g.value,'$.product.id'))<>json_array_length(json_extract(g.value,'$.options'),'$.rows')
      OR EXISTS(SELECT 1 FROM json_each(json_extract(g.value,'$.options'),'$.rows') r WHERE NOT EXISTS(SELECT 1 FROM product_registration_options o WHERE o.product_id=json_extract(g.value,'$.product.id') AND o.option_id=json_extract(r.value,'$.id')))))
    AND NOT EXISTS(SELECT 1 FROM product_option_split_operations o,json_each(o.receipt_payload,'$.groups') g WHERE o.owner_id=? AND o.request_id=? AND json_extract(g.value,'$.registrationNumber') IS NOT (SELECT registration_number FROM product_registration_numbers n WHERE n.owner_id=? AND n.product_id=json_extract(g.value,'$.productId')))
    THEN 1 ELSE json('option split companion invariant failed') END AS verified`).bind(...createdArgs, afterPayload, ...groupOwnerArgs(owner), after.length, afterPayload, owner, familyId, rootId, afterPayload, owner, owner, owner, input.requestId, owner));
  if (JSON.stringify(await imageProof(owner, sourceState(raw, id).product, raw.images.map(image => image.object_key))) !== JSON.stringify(prepared.images)) throw conflict();
  let result;
  try { result = await db.batch(statements); } catch (error) {
    // A database transport can fail after a committed batch. Only recognizable
    // SQLite aborts prove rollback; unknown outcomes require read-only recovery.
    const aborted = error instanceof Error && /constraint|malformed JSON|SQLITE_(?:CONSTRAINT|ERROR)|FOREIGN KEY/u.test(error.message);
    if (aborted) throw conflict('상품 분할 저장이 완료되지 않았습니다. 다시 저장하기 전에 결과를 확인해주세요.');
    throw new ProductOptionSplitError('상품 분할 완료 여부를 확인하지 못했습니다. 다시 저장하지 말고 결과 확인을 눌러주세요.', 503, 'OPTION_SPLIT_UNCERTAIN');
  }
  if (!result[0]?.results?.length) throw conflict();
  const stored = await recoverProductOptionSplit(owner, company, id, profileId, input.requestId, input);
  if (!stored) throw conflict(); return stored;
}
