import { env } from 'cloudflare:workers';
import { readOwnedSplitSnapshot, splitSnapshotPredicate } from '@/db/product-option-splits';
import { stableQuotationFieldsView } from '@/app/quotation-fields-snapshot';
import { detailFamilySource, detailFamilyTargetPlan, type DetailFamilySource } from '@/app/detail-family-plan';
import { DetailFamilyError, type DetailFamilyCatalog, type DetailFamilyPreview, type DetailFamilyReceipt, type DetailFamilyImage, type DetailFamilyEditorPolicy } from '@/app/detail-family-apply';
import { detailEditorInputs, validateDetailEditorInputs, type DetailEditorInputs } from '@/app/detail-editor-inputs';
import type { SupplierHubCompany } from '@/app/supplier-hub-company';
import type { QuotationFieldsState } from '@/db/quotation-fields';
import { verifyCapturedCollectionCompany } from '@/app/collection-company';
import { labelUploadKey, labelUploadDigest } from '@/app/label-upload-key';
import { imageFileType, isOwnedImageKey, MAX_IMAGE_BYTES } from '@/app/image-files';
import { imageDisplayDimensions } from '@/app/image-dimensions';
import { inspectImage } from '@/app/automation/image-edit';
import { readBoundedStream } from '@/app/request-body';
import { fingerprint } from '@/app/automation/model';

export const detailFamilyOperationsSchema = `CREATE TABLE IF NOT EXISTS detail_family_apply_operations (
 owner_id TEXT NOT NULL, request_id TEXT NOT NULL, source_product_id TEXT NOT NULL REFERENCES products(id),
 family_id TEXT NOT NULL, profile_id TEXT, attempt_id TEXT NOT NULL,
 request_payload TEXT NOT NULL CHECK(json_valid(request_payload)), before_payload TEXT NOT NULL CHECK(json_valid(before_payload)),
 after_payload TEXT NOT NULL CHECK(json_valid(after_payload)), receipt_payload TEXT NOT NULL CHECK(json_valid(receipt_payload)),
 committed_at TEXT NOT NULL, PRIMARY KEY(owner_id,request_id),
 CHECK(length(CAST(request_payload AS BLOB))+length(CAST(before_payload AS BLOB))+length(CAST(after_payload AS BLOB))+length(CAST(receipt_payload AS BLOB))<=2097152)
)`;
type Snapshot = Awaited<ReturnType<typeof readOwnedSplitSnapshot>>;
type View = Awaited<ReturnType<typeof stableQuotationFieldsView>>['view'];
type Input = { requestId: string; expectedInputFingerprint: string; targetIds: string[]; previewFingerprint?: string; editorPolicy?: DetailFamilyEditorPolicy };
type Identity = { email: string; role: string };
const conflict = (message = '상세 이미지·같은 분할 그룹·대상 상품 자료가 변경되었습니다. 새 미리보기를 확인해주세요.') => new DetailFamilyError(message);
const encodedBytes = (value: string) => new TextEncoder().encode(value).length;
const quoteLimit = (state: string) => { if (encodedBytes(state) > 512 * 1024) throw new DetailFamilyError('견적서 자료는 상품마다512KiB 이내여야 합니다.', 413); };
const requestPayload = (profileId: string | null, input: Input) => JSON.stringify({ profileId, expectedInputFingerprint: input.expectedInputFingerprint, targetIds: input.targetIds,
  ...(input.editorPolicy ? { editorPolicy: input.editorPolicy } : {}) });
const state = (saved: Snapshot, id: string): QuotationFieldsState => saved.raw.quotation.length ? JSON.parse(saved.raw.quotation[0].payload as string)
  : { schemaVersion: 1, productId: id, revision: 0, updatedAt: null, overrides: { common: {}, options: {} } };
async function database(owner: string, id: string, profileId: string | null) {
  const saved = await readOwnedSplitSnapshot(owner, id, profileId);
  await saved.db.prepare(detailFamilyOperationsSchema).run(); return saved.db;
}
function member(saved: Snapshot, company: SupplierHubCompany, identity?: Identity) {
  const value = saved.raw.member[0];
  if (saved.raw.member.length !== 1 || value.status !== 'approved' || value.company_code !== company.code || value.company_name !== company.name
    || identity && (identity.email !== value.email || identity.role !== value.role)) throw new DetailFamilyError('승인된 회사 회원을 다시 확인해주세요.', 403);
}
function captured(saved: Snapshot, company: SupplierHubCompany, view: View) {
  if (saved.raw.products.length !== 1 || saved.raw.links.length !== 1 || saved.raw.jobs.length !== 1 || saved.raw.context.length !== 1 || saved.raw.result.length !== 1)
    throw conflict('상품의 수집 원문·카테고리 연결을 확인할 수 없습니다.');
  const job = saved.raw.jobs[0], product = saved.raw.products[0], context = JSON.parse(saved.raw.context[0].payload as string), result = JSON.parse(saved.raw.result[0].payload as string);
  if (job.status !== 'awaiting_connector' || job.source_url !== product.source_url || result.sourceUrl !== product.source_url || result.offerId !== job.offer_id
    || !verifyCapturedCollectionCompany(context, company) || context.category?.categoryId !== view.categoryContext.categoryId
    || context.category?.id !== view.categoryContext.profileId) throw conflict('현재 회사·상품·수집 카테고리가 일치하지 않습니다.');
  const keys: unknown = JSON.parse(product.image_keys as string);
  if (!Array.isArray(keys) || keys.some(key => !isOwnedImageKey(product.owner_id as string, key)) || JSON.stringify(keys) !== JSON.stringify(view.imageKeys)) throw conflict('대상 상품의 저장 이미지 소유권을 확인해주세요.');
}
async function load(owner: string, company: SupplierHubCompany, id: string, profileId: string | null, db: D1Database, identity?: Identity) {
  const { view } = await stableQuotationFieldsView(owner, id, profileId), saved = await readOwnedSplitSnapshot(owner, id, view.categoryContext.profileId, db);
  member(saved, company, identity); captured(saved, company, view);
  const quotation = state(saved, id); quoteLimit(JSON.stringify(quotation));
  if (saved.raw.products[0].updated_at !== view.productVersion || quotation.revision !== view.revision || saved.raw.options[0]?.revision !== view.optionRevision
    || saved.raw.content[0]?.revision !== view.contentRevision || saved.raw.removed) throw conflict();
  const confirmed = await stableQuotationFieldsView(owner, id, profileId);
  if (JSON.stringify(confirmed.view) !== JSON.stringify(view) || (await readOwnedSplitSnapshot(owner, id, view.categoryContext.profileId, db)).payload !== saved.payload) throw conflict();
  return { saved, view, quotation };
}
async function png(owner: string, source: Pick<DetailFamilySource, 'key' | 'uploadId' | 'sha256' | 'bytes'>): Promise<DetailFamilyImage> {
  if (source.key !== labelUploadKey(owner, source.uploadId) || !env.FILES) throw conflict('저장된 통합 상세 이미지의 소유권을 확인해주세요.');
  const object = await env.FILES.get(source.key);
  if (!object || object.size !== source.bytes || object.size < 1 || object.size > MAX_IMAGE_BYTES || object.httpMetadata?.contentType !== 'image/png'
    || object.customMetadata?.labelUploadId !== source.uploadId || object.customMetadata?.labelBlobSha256 !== source.sha256) throw conflict('통합 상세 PNG의 저장 증거가 일치하지 않습니다.');
  const bytes = await readBoundedStream(object.body, MAX_IMAGE_BYTES);
  if (bytes.length !== source.bytes || await labelUploadDigest(bytes) !== source.sha256) throw conflict('통합 상세 이미지의 실제 파일이 변경되었습니다.');
  let metadata; try { metadata = inspectImage(bytes); } catch { throw conflict('저장된 통합 이미지가 유효한 PNG가 아닙니다.'); }
  if (metadata.mime !== 'image/png' || metadata.width !== 800 || metadata.height < 1 || metadata.height > 16000 || metadata.width * metadata.height > 40000000) throw conflict('검토한800px 통합 상세 PNG를 확인해주세요.');
  return { key: source.key, sha256: source.sha256, bytes: source.bytes, width: 800, height: metadata.height };
}
/** Reuse sealed byte identities from the ordinary save, never live URLs or
 * current global role assignments. Reading is bounded even for a corrupt object. */
async function verifyEditorImages(owner: string, value: DetailEditorInputs, categoryId: string) {
  const inputs = planning(() => validateDetailEditorInputs(value, owner, categoryId));
  if (!env.FILES) throw conflict('상세 편집 원본 저장소를 확인해주세요.');
  let total = 0;
  for (const source of inputs.images) {
    const object = await env.FILES.get(source.key);
    if (!object || object.size < 1 || object.size > MAX_IMAGE_BYTES || total + object.size > 30 * 1024 * 1024)
      throw conflict('저장한 상세 편집 원본 이미지가 없거나30MiB 읽기 한도를 초과했습니다.');
    const bytes = await readBoundedStream(object.body, MAX_IMAGE_BYTES); total += bytes.length;
    if (bytes.length !== object.size || total > 30 * 1024 * 1024 || await labelUploadDigest(bytes) !== source.sha256)
      throw conflict('저장한 상세 편집 원본 이미지의 실제 파일이 변경되었습니다.');
    let dimensions;
    try { imageFileType(bytes); dimensions = imageDisplayDimensions(bytes); } catch { throw conflict('저장한 상세 편집 원본의 이미지 형식을 확인해주세요.'); }
    if (!dimensions || dimensions.width !== source.width || dimensions.height !== source.height)
      throw conflict('저장한 상세 편집 원본의 표시 크기가 변경되었습니다.');
  }
  return inputs;
}
function family(saved: Snapshot) { return saved.raw.family.length === 1 ? saved.raw.family[0] : null; }
function readyTarget(saved: Snapshot) {
  if (saved.raw.busy || saved.raw.removed || saved.raw.transmitted || saved.raw.products[0].supplier_hub_status !== '미전송'
    || /전송|접수|등록중|등록완료|처리중/u.test(saved.raw.products[0].registration_status as string)) throw conflict('전송 이력·등록 진행·실행 중인 작업이 있는 대상은 상세 일괄 적용에서 제외해주세요.');
}
function planning<T>(run: () => T): T {
  try { return run(); } catch (error) { throw new DetailFamilyError(error instanceof Error ? error.message : '저장한 통합 상세 이미지와 대상 양식을 확인해주세요.'); }
}
async function number(db: D1Database, owner: string, id: string) {
  return (await db.prepare('SELECT registration_number FROM product_registration_numbers WHERE owner_id=? AND product_id=?').bind(owner, id).first<{ registration_number: string }>())?.registration_number ?? null;
}
export async function detailFamilyCatalog(owner: string, company: SupplierHubCompany, identity: Identity, id: string, profileId: string | null): Promise<DetailFamilyCatalog> {
  const db = await database(owner, id, profileId), source = await load(owner, company, id, profileId, db, identity), relation = family(source.saved);
  let image: DetailFamilyImage | null = null, proof: DetailFamilySource | undefined, reason: string | null = null;
  try {
    if (!relation) throw conflict('같은 옵션 분할 그룹에 속한 상품이 아닙니다.');
    if (source.saved.raw.busy) throw conflict('원본 상품의 실행 중인 작업이 끝난 뒤 다시 확인해주세요.');
    proof = planning(() => detailFamilySource({ productId: id, view: source.view, state: source.quotation })); image = await png(owner, proof);
  } catch (error) { reason = error instanceof Error ? error.message : '통합 상세 저장을 먼저 완료해주세요.'; }
  const records = relation ? await db.prepare(`SELECT p.id,p.title,(SELECT registration_number FROM product_registration_numbers n WHERE n.product_id=p.id AND n.owner_id=p.owner_id) AS registration_number,
    COALESCE((SELECT json_array_length(payload,'$.rows') FROM product_options o WHERE o.product_id=p.id AND o.owner_id=p.owner_id),0) AS option_count
    FROM product_option_split_members m JOIN products p ON p.id=m.product_id AND p.owner_id=m.owner_id
    WHERE m.owner_id=? AND m.family_id=? AND m.root_product_id=? AND m.product_id<>? ORDER BY m.created_at,p.id LIMIT 201`).bind(owner, relation.family_id, relation.root_product_id, id).all<{ id: string; title: string; registration_number: string | null; option_count: number }>() : { results: [] };
  if (records.results.length > 200) throw new DetailFamilyError('한 번에 조회할 분할 상품 수를 초과했습니다.', 413);
  const targets: DetailFamilyCatalog['targets'] = [];
  for (const record of records.results) {
    let optionCount = record.option_count, eligible = false, targetReason = reason;
    try {
      const target = await load(owner, company, record.id, profileId, db, identity); optionCount = target.view.resolved.rows.filter(row => row.optionId !== null).length;
      const targetRelation = family(target.saved);
      if (!targetRelation || targetRelation.family_id !== relation?.family_id || targetRelation.root_product_id !== relation?.root_product_id) throw conflict();
      readyTarget(target.saved);
      if (!proof || !image) throw conflict(reason ?? '통합 상세 저장을 먼저 완료해주세요.');
      planning(() => detailFamilyTargetPlan({ productId: record.id, view: target.view, state: target.quotation }, proof!, new Date(Math.max(Date.now(), Date.parse(target.view.productVersion) + 1)).toISOString()));
      eligible = true; targetReason = null;
    } catch (error) { targetReason = error instanceof Error ? error.message : '대상 상품을 다시 확인해주세요.'; }
    targets.push({ productId: record.id, title: record.title, registrationNumber: record.registration_number, optionCount, eligible, reason: targetReason });
  }
  if ((await readOwnedSplitSnapshot(owner, id, source.view.categoryContext.profileId, db)).payload !== source.saved.payload) throw conflict();
  const editor = image ? detailEditorInputs(source.view, source.quotation, id) : undefined;
  return { format: 'detail-family-catalog-v1', sourceProductId: id, sourceVersion: source.view.productVersion, inputFingerprint: source.view.inputFingerprint,
    company, familyId: relation?.family_id as string ?? null, sourceReady: !!image && !!relation, reason, image, targets,
    ...(editor ? { editor: { policy: 'saved-inputs-v1', categoryId: editor.categoryId, images: editor.images.length } } : {}) };
}
export async function previewDetailFamily(owner: string, company: SupplierHubCompany, identity: Identity, id: string, profileId: string | null, input: Input) {
  const db = await database(owner, id, profileId), source = await load(owner, company, id, profileId, db, identity), relation = family(source.saved);
  if (!relation || source.saved.raw.busy || source.view.inputFingerprint !== input.expectedInputFingerprint) throw conflict();
  const proof = planning(() => detailFamilySource({ productId: id, view: source.view, state: source.quotation })), image = await png(owner, proof);
  let editorInputs: DetailEditorInputs | undefined;
  if (input.editorPolicy) {
    const capturedInputs = detailEditorInputs(source.view, source.quotation, id);
    if (!capturedInputs || JSON.stringify(capturedInputs.output) !== JSON.stringify({ key: proof.key, sha256: proof.sha256, bytes: proof.bytes }))
      throw conflict('현재 통합 상세 저장본에 연결된 검증 가능한 편집 원본이 없습니다.');
    editorInputs = await verifyEditorImages(owner, capturedInputs, proof.categoryId);
  }
  const targets = [];
  for (const targetId of input.targetIds) {
    if (targetId === id) throw conflict('원본 상품은 적용 대상에서 제외해주세요.');
    const target = await load(owner, company, targetId, profileId, db, identity), targetRelation = family(target.saved);
    if (!targetRelation || targetRelation.family_id !== relation.family_id || targetRelation.root_product_id !== relation.root_product_id) throw conflict('같은 회원의 명시적인 옵션 분할 그룹만 선택해주세요.');
    readyTarget(target.saved);
    if (target.view.categoryContext.categoryId !== proof.categoryId) throw conflict('원본과 대상의 현재 수집 카테고리가 다릅니다.');
    targets.push({ ...target, productId: targetId, registrationNumber: await number(db, owner, targetId) });
  }
  const now = new Date(Math.max(Date.now(), ...targets.map(target => Date.parse(target.view.productVersion) + 1))).toISOString();
  const planned = targets.map(target => ({ ...target, plan: planning(() => detailFamilyTargetPlan({ productId: target.productId, view: target.view, state: target.quotation }, proof, now, editorInputs)) }));
  for (const target of planned) quoteLimit(JSON.stringify(target.plan.quotation));
  const request = requestPayload(profileId, input), before = JSON.stringify({ source: { productId: id, profileId: source.view.categoryContext.profileId, payload: source.saved.payload },
    targets: planned.map(target => ({ productId: target.productId, profileId: target.view.categoryContext.profileId, payload: target.saved.payload })) });
  const preview: DetailFamilyPreview = { format: 'detail-family-preview-v1', requestId: input.requestId,
    fingerprint: await fingerprint({ owner, company, request, source: source.saved.payload, image, targets: planned.map(target => target.saved.payload), ...(editorInputs ? { editorInputs } : {}) }),
    sourceProductId: id, sourceVersion: source.view.productVersion, company, familyId: relation.family_id as string, key: image.key, sha256: image.sha256, bytes: image.bytes,
    targets: planned.map(target => ({ productId: target.productId, title: target.saved.raw.products[0].title as string, registrationNumber: target.registrationNumber,
      beforeVersion: target.view.productVersion, revision: target.view.revision, optionIds: target.view.resolved.rows.flatMap(row => row.optionId === null ? [] : [row.optionId]) })),
    ...(editorInputs ? { editor: { policy: 'saved-inputs-v1', inputs: editorInputs } } : {}) };
  // Snapshots are JSON strings inside the archive, so their escaped quotation
  // payloads must be counted at that extra encoding layer, not as plain bytes.
  const expectedAfter = planned.map(target => {
    const raw = structuredClone(target.saved.raw), product = raw.products[0], oldKeys = JSON.parse(product.image_keys as string);
    product.updated_at = now; product.quote_status = '대기';
    if (JSON.stringify(oldKeys) !== JSON.stringify(target.plan.imageKeys)) product.image_keys = JSON.stringify(target.plan.imageKeys);
    raw.quotation = [{ product_id: target.productId, owner_id: owner, revision: target.plan.quotation.revision, payload: JSON.stringify(target.plan.quotation), updated_at: now }];
    return { productId: target.productId, profileId: target.view.categoryContext.profileId, payload: JSON.stringify(raw) };
  });
  const expectedReceipt: DetailFamilyReceipt = { ...preview, format: 'detail-family-receipt-v1', committedAt: now,
    targets: preview.targets.map(target => ({ ...target, savedVersion: now, savedRevision: target.revision + 1 })) };
  // SQLite preserves a few REAL spelling bytes (350.0 vs350). Reserve a small
  // per-target margin while the table CHECK enforces the exact aggregate cap.
  const estimated = encodedBytes(before) + encodedBytes(JSON.stringify(expectedAfter)) + encodedBytes(request)
    + encodedBytes(JSON.stringify(expectedReceipt)) + planned.length * 256;
  if (estimated > 2 * 1024 * 1024) throw new DetailFamilyError('선택한 대상의 상세 적용 보관 자료가2MiB를 초과합니다. 대상 수를 줄여주세요.', 413);
  for (const value of [source, ...planned]) if ((await readOwnedSplitSnapshot(owner, value.view === source.view ? id : (value as typeof planned[number]).productId,
    value.view.categoryContext.profileId, db)).payload !== value.saved.payload) throw conflict();
  return { db, source, proof, image, editorInputs, planned, now, preview, request, before };
}

type Operation = { source_product_id: string; profile_id: string | null; request_payload: string; before_payload: string; after_payload: string; receipt_payload: string };
type Recorded = { productId: string; profileId: string | null; payload: string };
export async function recoverDetailFamily(owner: string, company: SupplierHubCompany, identity: Identity, id: string, profileId: string | null, requestId: string, input?: Input) {
  const db = await database(owner, id, profileId), source = await readOwnedSplitSnapshot(owner, id, profileId, db); member(source, company, identity);
  const operation = await db.prepare('SELECT source_product_id,profile_id,request_payload,before_payload,after_payload,receipt_payload FROM detail_family_apply_operations WHERE owner_id=? AND request_id=?')
    .bind(owner, requestId).first<Operation>();
  if (!operation) return null;
  const receipt = JSON.parse(operation.receipt_payload) as DetailFamilyReceipt;
  if (operation.source_product_id !== id || operation.profile_id !== profileId || receipt.company.code !== company.code || receipt.company.name !== company.name
    || input && (operation.request_payload !== requestPayload(profileId, input) || receipt.fingerprint !== input.previewFingerprint)) throw conflict('같은 요청번호에 다른 상세 이미지·대상 목록을 적용하지 않았습니다.');
  const before = JSON.parse(operation.before_payload) as { source: Recorded }, after = JSON.parse(operation.after_payload) as Recorded[];
  let current = true;
  for (const expected of [before.source, ...after]) if ((await readOwnedSplitSnapshot(owner, expected.productId, expected.profileId, db)).payload !== expected.payload) current = false;
  if (current) {
    try {
      const uploadId = receipt.key.match(/\/quotation-label-([a-f0-9]{64})\.png$/u)?.[1];
      if (!uploadId) current = false;
      else await png(owner, { key: receipt.key, sha256: receipt.sha256, bytes: receipt.bytes, uploadId });
      if (current && receipt.editor) {
        if (receipt.editor.policy !== 'saved-inputs-v1') current = false;
        else await verifyEditorImages(owner, receipt.editor.inputs, receipt.editor.inputs.categoryId);
      }
    } catch { current = false; }
    // File checks can yield while another editor saves. Recovery must still
    // compare every exact snapshot after reading the PNG; it never retries writes.
    if (current) for (const expected of [before.source, ...after]) if ((await readOwnedSplitSnapshot(owner, expected.productId, expected.profileId, db)).payload !== expected.payload) current = false;
  }
  return { receipt, current };
}
export async function commitDetailFamily(owner: string, company: SupplierHubCompany, identity: Identity, id: string, profileId: string | null, input: Input) {
  const previous = await recoverDetailFamily(owner, company, identity, id, profileId, input.requestId, input); if (previous) return previous;
  const prepared = await previewDetailFamily(owner, company, identity, id, profileId, input);
  if (prepared.preview.fingerprint !== input.previewFingerprint) throw conflict();
  const { db, source, planned, now } = prepared, attemptId = crypto.randomUUID();
  const receipt: DetailFamilyReceipt = { ...prepared.preview, format: 'detail-family-receipt-v1', committedAt: now,
    targets: prepared.preview.targets.map(target => ({ ...target, savedVersion: now, savedRevision: target.revision + 1 })) };
  const after = JSON.stringify(planned.map(target => ({ productId: target.productId, profileId: target.view.categoryContext.profileId, payload: '' })));
  const initial = [source, ...planned].map(value => splitSnapshotPredicate(owner, value === source ? id : (value as typeof planned[number]).productId, value.view.categoryContext.profileId, value.saved.payload));
  const created = 'EXISTS(SELECT 1 FROM detail_family_apply_operations WHERE owner_id=? AND request_id=? AND attempt_id=?)', createdArgs = [owner, input.requestId, attemptId];
  const statements = [db.prepare(`INSERT INTO detail_family_apply_operations(owner_id,request_id,source_product_id,family_id,profile_id,attempt_id,request_payload,before_payload,after_payload,receipt_payload,committed_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${initial[0].sql} ON CONFLICT(owner_id,request_id) DO NOTHING RETURNING request_id`)
    .bind(owner, input.requestId, id, prepared.preview.familyId, profileId, attemptId, prepared.request, prepared.before, after, JSON.stringify(receipt), now, ...initial[0].args)];
  // Repeating20 whole snapshots in one INSERT exceeds D1's statement-byte cap.
  // Check targets before any target mutation, within the same atomic batch;
  // a stale target aborts the provisional operation and every companion.
  for (const guard of initial.slice(1)) statements.push(db.prepare(`SELECT CASE WHEN NOT ${created} THEN 1 WHEN ${guard.sql} THEN 1 ELSE json('detail family target source changed') END AS verified`)
    .bind(...createdArgs, ...guard.args));
  const finalClauses = [], finalArgs: (string | number | null)[] = [];
  for (const [index, target] of planned.entries()) {
    const quote = JSON.stringify(target.plan.quotation), product = target.saved.raw.products[0], oldKeys = JSON.parse(product.image_keys as string),
      imageKeys = JSON.stringify(oldKeys) === JSON.stringify(target.plan.imageKeys) ? product.image_keys as string : JSON.stringify(target.plan.imageKeys);
    statements.push(db.prepare(`INSERT INTO product_quotation_fields(product_id,owner_id,revision,payload,updated_at) SELECT ?,?,?,?,? WHERE ${created}
      ON CONFLICT(product_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at WHERE product_quotation_fields.owner_id=excluded.owner_id`)
      .bind(target.productId, owner, target.plan.quotation.revision, quote, now, ...createdArgs));
    statements.push(db.prepare(`UPDATE products SET image_keys=?,quote_status='대기',updated_at=? WHERE id=? AND owner_id=? AND ${created}`).bind(imageKeys, now, target.productId, owner, ...createdArgs));
    const expression = splitSnapshotPredicate(owner, target.productId, target.view.categoryContext.profileId, target.saved.payload);
    statements.push(db.prepare(`UPDATE detail_family_apply_operations SET after_payload=json_set(after_payload,?,${expression.expression} || '') WHERE owner_id=? AND request_id=? AND attempt_id=?`)
      .bind(`$[${index}].payload`, ...expression.parameters, ...createdArgs));
    const mask = "'$.products[0].updated_at','$.products[0].quote_status','$.products[0].image_keys','$.quotation'";
    finalClauses.push(`EXISTS(SELECT 1 FROM products p JOIN product_quotation_fields q ON q.product_id=p.id AND q.owner_id=p.owner_id
      WHERE p.owner_id=? AND p.id=? AND p.updated_at=? AND p.quote_status='대기' AND p.image_keys=? AND q.revision=? AND q.payload=? AND q.updated_at=?)
      AND json_remove(${expression.expression},${mask})=json_remove(?,${mask})
      AND EXISTS(SELECT 1 FROM detail_family_apply_operations WHERE owner_id=? AND request_id=? AND json_extract(after_payload,?)=${expression.expression})`);
    finalArgs.push(owner, target.productId, now, imageKeys, target.plan.quotation.revision, quote, now, ...expression.parameters, target.saved.payload,
      owner, input.requestId, `$[${index}].payload`, ...expression.parameters);
  }
  // Keep each statement below D1's100-binding limit by asserting one target per
  // read-only SELECT. JSON errors abort the whole batch even if a trigger ignored
  // any earlier companion or a ledger post-image capture.
  for (const [index] of planned.entries()) {
    const argsPerTarget = finalArgs.length / planned.length;
    statements.push(db.prepare(`SELECT CASE WHEN NOT ${created} THEN 1 WHEN ${finalClauses[index]} THEN 1 ELSE json('detail family companion invariant failed') END AS verified`)
      .bind(...createdArgs, ...finalArgs.slice(index * argsPerTarget, (index + 1) * argsPerTarget)));
  }
  statements.push(db.prepare(`SELECT CASE WHEN NOT ${created} THEN 1 WHEN ${initial[0].sql} THEN 1 ELSE json('detail family source changed') END AS verified`).bind(...createdArgs, ...initial[0].args));
  if (JSON.stringify(await png(owner, prepared.proof)) !== JSON.stringify(prepared.image)) throw conflict();
  if (prepared.editorInputs) await verifyEditorImages(owner, prepared.editorInputs, prepared.proof.categoryId);
  let results;
  try { results = await db.batch(statements); }
  catch (error) {
    if (error instanceof Error && /constraint|malformed JSON|SQLITE_(?:CONSTRAINT|ERROR)|FOREIGN KEY/u.test(error.message)) throw conflict('통합 상세 적용이 완료되지 않았습니다. 다시 저장하기 전에 결과를 확인해주세요.');
    throw new DetailFamilyError('통합 상세 적용 완료 여부를 확인하지 못했습니다. 다시 적용하지 말고 결과 확인을 눌러주세요.', 503, 'DETAIL_FAMILY_UNCERTAIN');
  }
  if (!results[0]?.results?.length) throw conflict();
  const saved = await recoverDetailFamily(owner, company, identity, id, profileId, input.requestId, input); if (!saved) throw conflict(); return saved;
}
