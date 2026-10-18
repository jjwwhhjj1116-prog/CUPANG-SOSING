import { fingerprint } from '@/app/automation/model';
import { isOwnedImageKey, imageFileType, MAX_IMAGE_BYTES, PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-files';
import { imageDimensions } from '@/app/image-dimensions';
import { imageSizeGuidance } from '@/app/image-size-guidance';
import { PUBLIC_DETAIL_FORMAT, PUBLIC_DETAIL_PREFIX, publishPublicDetail, type PublicDetailConfig, type PublicDetailImage } from '@/app/quotation-public-detail';
import { SINGLE_PROJECTION_OUTPUT_LIMIT, type projectSupplierHubSingleDocument } from '@/app/supplier-hub-single-projection';
import type { BundleAsset } from '@/app/exports/review-bundle';
import type { SubmissionIssue } from '@/app/submission-review';
import type { HubWireField } from '@/app/supplier-hub-schema';

export const SINGLE_ASSET_PACKAGE_FORMAT = 'yoofam-supplier-hub-single-package-v1';
export class SingleAssetError extends Error { constructor(message: string, public code: string, public status = 409) { super(message); } }
type Projection = Awaited<ReturnType<typeof projectSupplierHubSingleDocument>>;
type Issue = { code: string; level: 'error' | 'review'; message: string; optionId?: string | null; fieldId?: string };
type Role = 'main' | 'additional' | 'detail' | 'label' | 'size';
type Selection = { optionId: string | null; fieldId: string; wire: HubWireField; role: Role; keys: string[] };
type StorageMetadata = { size: number; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> };
export type SinglePublishedFile = { key: string; filename: string; byteLength: number; sha256: string; contentType: string; width: number | null; height: number | null; token: string; url: string };
export type SingleAssetPlan = { projection: Projection; payload: Projection['payload']; files: SinglePublishedFile[]; manifest: (Selection & { files: SinglePublishedFile[] })[];
  issues: Issue[]; assets: BundleAsset[]; publicImages: PublicDetailImage[]; sourceAssetFingerprint: string; canPrepare: boolean };
const samePath = (left: readonly string[], right: readonly string[]) => JSON.stringify(left) === JSON.stringify(right);
const hex = (value: ArrayBuffer) => Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
const digest = (value: Uint8Array) => crypto.subtle.digest('SHA-256', new Uint8Array(value)).then(hex);
const singleLabel = '제품 한글 표시사항 라벨 또는 도안 이미지';

/** Current Couplus SAVE syntax, statically observed in main.a20c7114.js
 * (29cfa2cf13011f62da4b99032fecbf7972d541f85cbfe622a5a906389ca7faad):
 * main [343346,346330), additional [226696,227895). Current AIRocketReg
 * chunk ce8f14422c4e93a11592d886a369d633066a8a9f4cdba9f37dbb1276d798c6cc:
 * label [150334,152482), detail [131264,136334), size chart
 * [285279,286603). Size-chart SAVE assigns one uploaded image URL directly.
 * This is SAVE evidence,
 * not proof of Hub acceptance. Detail uses the observed URL-list fallback;
 * an already saved merged image stays one file. No raster is regenerated. */
function role(wire?: HubWireField): Role | null {
  if (!wire) return null;
  const bare = wire.name === undefined && wire.nameKey === undefined && wire.valueKey === undefined;
  if (bare && samePath(wire.path, ['imagePage', 'images', 'mainImage'])) return 'main';
  if (bare && samePath(wire.path, ['imagePage', 'images', 'additionalImage'])) return 'additional';
  if (bare && samePath(wire.path, ['imagePage', 'images', 'sizeChartImage'])) return 'size';
  if (bare && samePath(wire.path, ['imagePage', 'details', 'detailedImage'])) return 'detail';
  if (samePath(wire.path, ['imagePage', 'images', 'labelImages']) && wire.nameKey === 'labelImageType' && wire.valueKey === 'labelImageFiles' && wire.name === singleLabel) return 'label';
  return null;
}
export function singleAssetSelection(projection: Projection, owner: string, ownedKeys: readonly string[]) {
  const selections: Selection[] = [], issues: Issue[] = [], keys = new Set<string>();
  for (const reference of projection.review.unresolvedImages) {
    const assigned = role(reference.wire);
    const issue = (code: string, message: string) => issues.push({ code, level: 'error', message, optionId: reference.optionId, fieldId: reference.fieldId });
    if (!assigned || !reference.wire) { issue('SINGLE_IMAGE_ENCODING_UNVERIFIED', '이 이미지 역할의 정확한 Single 저장 형식이 확인되지 않았습니다.'); continue; }
    if (!reference.keys.length || reference.keys.length > PRODUCT_IMAGE_POOL_LIMIT || new Set(reference.keys).size !== reference.keys.length
      || reference.keys.some(key => !key || key !== key.trim() || !isOwnedImageKey(owner, key) || !ownedKeys.includes(key))) {
      issue('SINGLE_IMAGE_REFERENCE', '현재 상품에 저장된 본인 소유 이미지의 정확한 순서를 확인해주세요.'); continue;
    }
    if (['main', 'label', 'size'].includes(assigned) && reference.keys.length !== 1) {
      issue('SINGLE_IMAGE_COUNT', assigned === 'size' ? '사이즈표의 확인된 Single 저장 형식은 이미지 한 개입니다.' : '대표·한글표시사항의 확인된 Single 저장 형식은 이미지 한 개입니다.'); continue;
    }
    selections.push({ optionId: reference.optionId, fieldId: reference.fieldId, wire: structuredClone(reference.wire), role: assigned, keys: [...reference.keys] });
    reference.keys.forEach(key => keys.add(key));
  }
  return { selections, issues, keys: [...keys] };
}

/** Reads only supplied bytes/metadata. Public candidates are never called
 * published until the explicit publisher verifies the actual stored body. */
export async function buildSingleAssetPlan(input: { projection: Projection; owner: string; productId: string; ownedKeys: readonly string[];
  assets: readonly BundleAsset[]; metadata: ReadonlyMap<string, StorageMetadata | null>; config: PublicDetailConfig | null; sourceIssues?: readonly SubmissionIssue[] }): Promise<SingleAssetPlan> {
  const selection = singleAssetSelection(input.projection, input.owner, input.ownedKeys);
  const issues: Issue[] = [...selection.issues, ...(input.sourceIssues ?? []).map(issue => ({ code: issue.code, level: issue.kind,
    message: issue.message, optionId: issue.optionId, ...(issue.fieldId ? { fieldId: issue.fieldId } : {}) }))];
  const rows = input.projection.review.fields.filter(field => samePath(field.path, ['startPage', 'productName']));
  if (rows.length !== input.projection.payload.jsonDocument.length || new Set(rows.map(row => row.optionId)).size !== rows.length)
    throw new SingleAssetError('Single 이미지의 포함 옵션 문서 연결을 확인해주세요.', 'SINGLE_IMAGE_ROW');
  const pricePaths: Record<string, string[]> = { supplyPrice: ['productPage', 'commonAttributes', 'purchasePrice'],
    salePrice: ['productPage', 'commonAttributes', 'coupangSalePrice'], msrp: ['productPage', 'commonAttributes', 'msrp'] };
  const selectedIds = new Set(selection.selections.map(item => `${item.optionId}\0${item.fieldId}`));
  for (const issue of input.projection.review.issues) {
    if (issue.code === 'IMAGE_UNRESOLVED' && selectedIds.has(`${issue.optionId}\0${issue.fieldId}`)) continue;
    // The existing numeric-text compiler preserves separate canonical price
    // summaries and primary string wires. Represent only the exact same final
    // nonblank scalar; never repair a manual blank or a conflicting summary.
    if (issue.code === 'UNBOUND_SAVED_FIELD' && issue.fieldId && Object.hasOwn(pricePaths, issue.fieldId)) {
      const summary = input.projection.review.fields.filter(field => field.optionId === issue.optionId && field.fieldId === issue.fieldId && field.path.length === 0);
      const primary = input.projection.review.fields.filter(field => field.optionId === issue.optionId && field.name === undefined && samePath(field.path, pricePaths[issue.fieldId!]));
      const index = rows.findIndex(row => row.optionId === issue.optionId);
      let value: unknown = input.projection.payload.jsonDocument[index];
      for (const key of pricePaths[issue.fieldId]) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
      if (summary.length === 1 && primary.length === 1 && primary[0].projected && typeof value === 'string'
        && summary[0].savedValue !== '' && summary[0].savedValue === primary[0].savedValue && value === summary[0].savedValue) continue;
      issues.push({ code: 'SINGLE_PRICE_SUMMARY_CONFLICT', level: 'error', message: '저장한 가격 요약과 정확한 Single 가격 항목의 값·공란을 대조해주세요. 자동으로 복사하지 않았습니다.',
        optionId: issue.optionId, fieldId: issue.fieldId });
    }
    issues.push(issue);
  }
  if (selection.keys.length && !input.config) issues.push({ code: 'SINGLE_PUBLIC_CONFIG', level: 'error', message: 'Single 이미지 공개 경로가 설정되지 않았습니다.' });
  const byKey = new Map(input.assets.map(asset => [asset.key, asset])), files: SinglePublishedFile[] = [];
  let total = 0;
  const signingKey = input.config ? await crypto.subtle.importKey('raw', Uint8Array.from(input.config.secret.match(/../g)!, part => parseInt(part, 16)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) : null;
  for (const key of selection.keys) {
    const asset = byKey.get(key), metadata = input.metadata.get(key);
    const fail = (code: string, message: string) => issues.push({ code, level: 'error', message });
    if (!asset || !asset.data.byteLength || asset.data.byteLength > MAX_IMAGE_BYTES || !metadata || metadata.size !== asset.data.byteLength) { fail('SINGLE_IMAGE_MISSING', '선택한 이미지 원본의 저장 파일·크기를 확인해주세요.'); continue; }
    total += asset.data.byteLength; if (total > 20 * 1024 * 1024) throw new SingleAssetError('Single 이미지 합계는 20MB 이하여야 합니다.', 'SINGLE_IMAGE_SIZE', 413);
    let actual;
    try { actual = imageFileType(asset.data); } catch { fail('SINGLE_IMAGE_TYPE', '선택한 이미지 파일 형식을 확인해주세요.'); continue; }
    if (actual.extension === 'gif') { fail('SINGLE_PUBLIC_MEDIA_UNSUPPORTED', '기존 공개 이미지 경로는 GIF를 지원하지 않습니다. 저장한 원본은 유지됩니다.'); continue; }
    if (metadata.httpMetadata?.contentType !== undefined && metadata.httpMetadata.contentType !== actual.contentType) { fail('SINGLE_IMAGE_METADATA', '저장 이미지 형식과 실제 파일이 다릅니다.'); continue; }
    const sha256 = await digest(asset.data);
    if (['sha256', 'labelBlobSha256', 'freeImageOutputSha256'].some(name => metadata.customMetadata?.[name] !== undefined && metadata.customMetadata[name] !== sha256)) {
      fail('SINGLE_IMAGE_DIGEST', '저장 이미지의 원천 확인 기록과 실제 파일이 다릅니다.'); continue;
    }
    if (!signingKey || !input.config) continue;
    // Exactly the existing public-detail capability recipe and serving route.
    // A changed file under the same key cannot overwrite its immutable copy.
    const token = hex(await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(`${PUBLIC_DETAIL_FORMAT}\0${input.owner}\0${key}`)));
    const dimensions = imageDimensions(asset.data);
    files.push({ key, filename: `single-${sha256}.${actual.extension}`, byteLength: asset.data.byteLength, sha256, contentType: actual.contentType,
      width: dimensions?.width ?? null, height: dimensions?.height ?? null, token, url: `${input.config.origin}/media/quotation/${token}` });
    for (const use of selection.selections.filter(item => item.keys.includes(key))) {
      const guidance = dimensions ? imageSizeGuidance(use.role, dimensions.width, dimensions.height) : ['이미지 픽셀 크기를 읽지 못했습니다.'];
      guidance.forEach(message => issues.push({ code: 'SINGLE_IMAGE_GUIDANCE', level: 'review', message, optionId: use.optionId, fieldId: use.fieldId }));
    }
  }
  const fileMap = new Map(files.map(file => [file.key, file]));
  const manifest = selection.selections.map(item => ({ ...item, files: item.keys.flatMap(key => fileMap.has(key) ? [fileMap.get(key)!] : []) }));
  if (manifest.some(item => item.files.length !== item.keys.length)) issues.push({ code: 'SINGLE_IMAGE_INCOMPLETE', level: 'error', message: '준비할 이미지 파일이 모두 확인되지 않았습니다.' });
  const sourceAssetFingerprint = await fingerprint(selection.keys.map(key => ({ key, sha256: fileMap.get(key)?.sha256 ?? null, metadata: input.metadata.get(key) ?? null })));
  const payload = structuredClone(input.projection.payload);
  for (const item of manifest.filter(item => item.files.length === item.keys.length)) {
    const index = rows.findIndex(row => row.optionId === item.optionId);
    if (index < 0) throw new SingleAssetError('Single 이미지의 포함 옵션 문서 연결을 확인해주세요.', 'SINGLE_IMAGE_ROW');
    let node = payload.jsonDocument[index] as Record<string, unknown>;
    for (const key of item.wire.path.slice(0, item.wire.name === undefined ? -1 : undefined)) {
      const next = node[key]; if (!next || typeof next !== 'object') throw new SingleAssetError('Single 이미지 문서 구조가 변경되었습니다.', 'SINGLE_IMAGE_WIRE'); node = next as Record<string, unknown>;
    }
    const value = item.files.map(file => file.url).join(',');
    if (item.wire.name !== undefined) {
      if (!Array.isArray(node)) throw new SingleAssetError('Single 한글표시사항 배열 구조를 확인해주세요.', 'SINGLE_IMAGE_WIRE');
      const targets = node.filter(entry => entry?.[item.wire.nameKey!] === item.wire.name);
      if (targets.length !== 1) throw new SingleAssetError('Single 한글표시사항 이름 연결이 모호합니다.', 'SINGLE_IMAGE_WIRE');
      targets[0][item.wire.valueKey!] = value;
    } else node[item.wire.path.at(-1)!] = value;
  }
  const publicImages = files.map(file => ({ key: file.key, token: file.token, url: file.url }));
  issues.push({ code: 'SINGLE_REMOTE_UNVERIFIED', level: 'review', message: '공개 파일의 저장 바이트는 검증하지만 Supplier Hub 외부 접근·접수·동의는 별도 확인이 필요합니다.' });
  return { projection: input.projection, payload, files, manifest, issues, assets: selection.keys.flatMap(key => byKey.has(key) ? [byKey.get(key)!] : []), publicImages,
    sourceAssetFingerprint, canPrepare: !issues.some(issue => issue.level === 'error') };
}

export function singleAssetPackageView(plan: SingleAssetPlan, published: boolean) {
  const fileView = (file: SinglePublishedFile) => ({ key: file.key, filename: file.filename, byteLength: file.byteLength, sha256: file.sha256,
    contentType: file.contentType, width: file.width, height: file.height, url: file.url, published,
    verification: published ? 'stored-body-sha256' : 'source-bytes-only' });
  const result = { format: SINGLE_ASSET_PACKAGE_FORMAT, prepared: published && plan.canPrepare, registered: false as const, remoteWrites: false as const,
    submissionReady: false as const, humanAgreementsConfirmed: false as const, company: plan.projection.company, schemaSha256: plan.projection.schemaSha256,
    // Before explicit publication the JSON still omits unresolved image values;
    // candidate URLs exist only in the authenticated manifest, not the payload.
    payload: published && plan.canPrepare ? plan.payload : plan.projection.payload,
    manifest: plan.manifest.map(item => ({ ...item, files: item.files.map(fileView) })),
    review: { issues: plan.issues, privateReferences: plan.projection.review.unresolvedImages, fields: plan.projection.review.fields,
      detailStrategy: 'ordered-public-url-fallback', externalAvailabilityVerified: false, canPrepare: plan.canPrepare } };
  if (new TextEncoder().encode(JSON.stringify(result)).length > SINGLE_PROJECTION_OUTPUT_LIMIT) throw new SingleAssetError('Single 준비 문서가 6MB를 초과했습니다.', 'SINGLE_PACKAGE_SIZE', 413);
  return result;
}

async function verifiedPublicFile(file: SinglePublishedFile, bucket: R2Bucket) {
    const stored = await bucket.get(PUBLIC_DETAIL_PREFIX + file.token);
    if (!stored) return false;
    if (stored.size !== file.byteLength || stored.httpMetadata?.contentType !== file.contentType || stored.customMetadata?.publication !== PUBLIC_DETAIL_FORMAT
      || stored.customMetadata?.sha256 !== file.sha256 || stored.size > MAX_IMAGE_BYTES) throw new SingleAssetError('Single 공개 이미지의 저장 확인 기록이 다릅니다.', 'SINGLE_PUBLIC_IMAGE_CONFLICT');
    const bytes = new Uint8Array(await stored.arrayBuffer());
    if (bytes.byteLength !== file.byteLength || await digest(bytes) !== file.sha256) throw new SingleAssetError('Single 공개 이미지의 실제 파일이 다릅니다.', 'SINGLE_PUBLIC_IMAGE_CONFLICT');
    return true;
}
/** A later GET can verify the explicit prepare result without creating files. */
export async function verifySingleAssets(plan: SingleAssetPlan, bucket: R2Bucket, guard: (file?: SinglePublishedFile) => Promise<void>) {
  if (!plan.canPrepare) return false;
  for (const file of plan.files) {
    await guard(file);
    if (!await verifiedPublicFile(file, bucket)) return false;
    await guard(file);
  }
  return true;
}
export async function publishSingleAssets(plan: SingleAssetPlan, bucket: R2Bucket, guard: (file?: SinglePublishedFile) => Promise<void>) {
  if (!plan.canPrepare) throw new SingleAssetError('Single 준비 자료의 차단 항목을 먼저 확인해주세요.', 'SINGLE_PACKAGE_BLOCKED');
  for (const file of plan.files) {
    await guard(file);
    await publishPublicDetail([{ key: file.key, token: file.token, url: file.url }], plan.assets, bucket);
    if (!await verifiedPublicFile(file, bucket)) throw new SingleAssetError('Single 공개 이미지가 저장되지 않았습니다.', 'SINGLE_PUBLIC_IMAGE_MISSING');
    await guard(file);
  }
}
