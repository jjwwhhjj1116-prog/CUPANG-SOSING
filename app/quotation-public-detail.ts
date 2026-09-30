import { currentDetailContent, type ProductContent } from '@/app/product-content';
import { quotationValueIssues, type ResolvedQuotation } from '@/app/quotation-schema';
import { isOwnedImageKey, imageFileType, MAX_IMAGE_BYTES } from '@/app/image-files';
import type { BundleAsset } from '@/app/exports/review-bundle';
import type { SubmissionIssue } from '@/app/submission-review';

export const PUBLIC_DETAIL_PREFIX = 'quotation-public-detail/';
export const PUBLIC_DETAIL_FORMAT = 'yoofam-public-detail-v1';
export type PublicDetailConfig = { origin: string; secret: string };
export type PublicDetailImage = { key: string; token: string; url: string };
export class PublicDetailError extends Error { constructor(message: string, public status = 409) { super(message); } }
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

export function publicDetailConfig(bindings: { YOOFAM_DETAIL_IMAGE_SECRET?: string; YOOFAM_DETAIL_IMAGE_ORIGIN?: string }): PublicDetailConfig | null {
  const secret = bindings.YOOFAM_DETAIL_IMAGE_SECRET, origin = bindings.YOOFAM_DETAIL_IMAGE_ORIGIN;
  if (secret === undefined && origin === undefined) return null;
  let url: URL;
  try { url = new URL(origin ?? ''); } catch { throw new PublicDetailError('상세 이미지 공개 주소 설정을 확인해주세요.', 503); }
  if (!secret || !/^[a-f0-9]{64}$/.test(secret) || url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash
    || !url.hostname.includes('.') || /^(?:localhost|127\.|\[)/.test(url.hostname)) throw new PublicDetailError('상세 이미지 공개 주소 설정을 확인해주세요.', 503);
  return { origin: url.origin, secret };
}

/** A configuration change invalidates old packages without disclosing the signing key. */
export async function publicDetailVersion(config: PublicDetailConfig | null) {
  if (!config) return null;
  return { format: PUBLIC_DETAIL_FORMAT, origin: config.origin, keyId: hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${PUBLIC_DETAIL_FORMAT}\0${config.secret}`))) };
}

/** Resolving an editable draft does not publish files or access the object store. */
export async function resolvePublicDetail(resolved: ResolvedQuotation, content: ProductContent, owner: string, ownedKeys: readonly string[], config: PublicDetailConfig | null) {
  if (!config) return { resolved, images: [] as PublicDetailImage[] };
  const definition = resolved.schema.fields.find(field => field.id === 'detailHtml');
  if (!definition) return { resolved, images: [] as PublicDetailImage[] };
  const signingKey = await crypto.subtle.importKey('raw', Uint8Array.from(config.secret.match(/../g)!, part => parseInt(part, 16)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const byKey = new Map<string, PublicDetailImage>(), includedKeys = new Set<string>();
  const description = currentDetailContent(content).description.value;
  const paragraph = description ? `<p>${escape(description).replace(/\r?\n/g, '<br>')}</p>` : '';
  const rows = [];
  for (const row of resolved.rows) {
    const cell = row.fields.detailHtml;
    if (!cell || ['manual-common', 'manual-option'].includes(cell.source)) { rows.push(row); continue; }
    const keys = (row.fields.detailImages?.value ?? '').split('\n').map(key => key.trim()).filter(Boolean);
    if (keys.length > 30 || new Set(keys).size !== keys.length || keys.some(key => !isOwnedImageKey(owner, key) || !ownedKeys.includes(key))) {
      // Keep a damaged saved selection editable. Invalid/excluded references
      // must never mint links or prevent fixing another option in the form.
      const validationIssues = [...quotationValueIssues(definition, paragraph), '상세페이지에 연결한 상품 이미지를 확인해주세요.'];
      rows.push({ ...row, fields: { ...row.fields, detailHtml: { ...cell, value: paragraph, validationIssues,
        issues: [...validationIssues, ...(cell.reviewMessages ?? [])], needsReview: true } } });
      continue;
    }
    const images: PublicDetailImage[] = [];
    for (const key of keys) {
      let image = byKey.get(key);
      if (!image) {
        const token = hex(await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(`${PUBLIC_DETAIL_FORMAT}\0${owner}\0${key}`)));
        image = { key, token, url: `${config.origin}/media/quotation/${token}` }; byKey.set(key, image);
      }
      images.push(image);
      if (row.included) includedKeys.add(key);
    }
    if (byKey.size > 50) throw new PublicDetailError('상세 이미지가 허용 개수를 초과했습니다.', 413);
    const alt = row.fields.altText?.value ?? '';
    const imageHtml = images.map((image, index) => `<img src="${escape(image.url)}" alt="${escape(alt ? `${alt} ${index + 1}` : '')}" style="display:block;width:100%;height:auto">`).join('');
    const value = images.length ? `<div style="width:800px;max-width:100%;margin:0;padding:0;background-color:#ffffff;box-sizing:border-box">${paragraph}${imageHtml}</div>` : paragraph;
    const validationIssues = quotationValueIssues(definition, value), reviewMessages = cell.reviewMessages ?? [];
    rows.push({ ...row, fields: { ...row.fields, detailHtml: { ...cell, value, validationIssues, reviewMessages,
      issues: [...validationIssues, ...reviewMessages], needsReview: Boolean(definition.reviewRequired) || validationIssues.length > 0 || reviewMessages.length > 0 } } });
  }
  return { resolved: { ...resolved, rows }, images: [...byKey.values()].filter(image => includedKeys.has(image.key)) };
}

/** Explicit package/download requests publish only images referenced by generated HTML.
 * Conditional creation keeps an already exported URL's bytes immutable. */
export async function publishPublicDetail(images: readonly PublicDetailImage[], assets: readonly BundleAsset[], bucket: R2Bucket) {
  const byKey = new Map(assets.map(asset => [asset.key, asset]));
  const prepared = await Promise.all(images.map(async image => {
    const asset = byKey.get(image.key);
    if (!asset || !/^[a-f0-9]{64}$/.test(image.token)) throw new PublicDetailError('상세페이지 첨부 파일이 누락되었습니다.');
    if (asset.data.byteLength > MAX_IMAGE_BYTES) throw new PublicDetailError('상세 이미지 파일은 10MB 이하여야 합니다.', 413);
    let actual;
    try { actual = imageFileType(asset.data); } catch { throw new PublicDetailError('상세페이지에 지원하지 않는 이미지 파일이 있습니다.', 400); }
    if (actual.extension === 'gif') throw new PublicDetailError('Supplier Hub HTML 상세 내용에는 GIF를 사용할 수 없습니다. 상세 이미지를 교체해주세요.');
    const sha256 = hex(await crypto.subtle.digest('SHA-256', new Uint8Array(asset.data)));
    return { image, asset, actual, sha256 };
  }));
  // Validate every file before publishing any of them.
  for (const { image, asset, actual, sha256 } of prepared) {
    const key = PUBLIC_DETAIL_PREFIX + image.token;
    const stored = await bucket.put(key, new Uint8Array(asset.data), { onlyIf: new Headers({ 'If-None-Match': '*' }), sha256,
      httpMetadata: { contentType: actual.contentType }, customMetadata: { publication: PUBLIC_DETAIL_FORMAT, sha256 } });
    const confirmed = stored ?? await bucket.head(key);
    if (!confirmed || confirmed.customMetadata?.publication !== PUBLIC_DETAIL_FORMAT || confirmed.customMetadata?.sha256 !== sha256 || confirmed.size !== asset.data.byteLength)
      throw new PublicDetailError('이 상세 이미지 주소의 저장 파일이 달라졌습니다. 이미지 파일을 다시 저장하고 견적서를 다시 준비해주세요.');
  }
}

/** The public URLs intentionally hide private filenames, so inspect actual GIF
 * bytes rather than relying on a URL extension to enforce the observed rule. */
export function publicDetailMediaIssues(resolved: ResolvedQuotation, images: readonly PublicDetailImage[], assets: readonly BundleAsset[]): SubmissionIssue[] {
  const byKey = new Map(assets.map(asset => [asset.key, asset]));
  const gifs = images.filter(image => { const asset = byKey.get(image.key); return asset && imageFileType(asset.data).extension === 'gif'; });
  return resolved.rows.filter(row => row.included && gifs.some(image => row.fields.detailHtml?.value.includes(image.url))).map(row => ({
    kind: 'error', code: 'HTML_MEDIA_UNSUPPORTED', optionId: row.optionId, optionLabel: row.optionLabel, fieldId: 'detailHtml',
    message: 'HTML 상세 내용에 Supplier Hub가 지원하지 않는 GIF 이미지가 있습니다. 상세 이미지를 교체하거나 7단계 HTML 입력을 수정해주세요.',
  }));
}
