import { currentDetailContent, type ProductContent } from '@/app/product-content';
import { quotationValueIssues, type ResolvedQuotation } from '@/app/quotation-schema';
import { isOwnedImageKey, imageFileType, MAX_IMAGE_BYTES, PRODUCT_IMAGE_POOL_LIMIT } from '@/app/image-files';
import type { BundleAsset } from '@/app/exports/review-bundle';
import type { SubmissionIssue } from '@/app/submission-review';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

export const PUBLIC_DETAIL_PREFIX = 'quotation-public-detail/';
export const PUBLIC_DETAIL_FORMAT = 'yoofam-public-detail-v1';
export type PublicDetailConfig = { origin: string; secret: string };
export type PublicDetailImage = { key: string; token: string; url: string };
export class PublicDetailError extends Error { constructor(message: string, public status = 409) { super(message); } }
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

/** Read image references as inert HTML. Text, comments and raw/inert elements
 * cannot authorize publication; no manual URL is fetched or rewritten. */
function manualImageSources(html: string): string[] {
  const values = new Set<string>(), nodes: DefaultTreeAdapterMap['node'][] = [parseFragment(html)];
  while (nodes.length) {
    const node = nodes.pop()!;
    if ('tagName' in node && ['script', 'style', 'template', 'noscript', 'textarea', 'title'].includes(node.tagName)) continue;
    if ('childNodes' in node) for (let index = node.childNodes.length - 1; index >= 0; index--) nodes.push(node.childNodes[index]);
    if ('tagName' in node && node.tagName === 'img') {
      const src = node.attrs.find(attribute => attribute.name === 'src')?.value.trim();
      if (src) values.add(src);
    }
  }
  return [...values];
}

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
  const manualSources = new Map<string, string[]>();
  const imageForKey = async (key: string) => {
    let image = byKey.get(key);
    if (!image) {
      const token = hex(await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(`${PUBLIC_DETAIL_FORMAT}\0${owner}\0${key}`)));
      image = { key, token, url: `${config.origin}/media/quotation/${token}` }; byKey.set(key, image);
      if (byKey.size > PRODUCT_IMAGE_POOL_LIMIT) throw new PublicDetailError('상세 이미지가 허용 개수를 초과했습니다.', 413);
    }
    return image;
  };
  const description = currentDetailContent(content).description.value;
  const paragraph = description ? `<p>${escape(description).replace(/\r?\n/g, '<br>')}</p>` : '';
  const rows = [];
  for (const row of resolved.rows) {
    const cell = row.fields.detailHtml;
    if (!cell) { rows.push(row); continue; }
    const keys = (row.fields.detailImages?.value ?? '').split('\n').map(key => key.trim()).filter(Boolean);
    if (['manual-common', 'manual-option'].includes(cell.source)) {
      let sources = manualSources.get(cell.value);
      if (!sources) { sources = manualImageSources(cell.value); manualSources.set(cell.value, sources); }
      const capabilities = sources.flatMap<{ src: string; url: URL | null; absolute: boolean }>(src => {
        try { const url = new URL(src, config.origin); return url.pathname.startsWith('/media/quotation/')
          ? [{ src, url, absolute: /^https:\/\//i.test(src) || src.startsWith('//') }] : []; }
        catch { return src.startsWith('/media/quotation/') ? [{ src, url: null, absolute: false }] : []; }
      });
      if (!capabilities.length) { rows.push(row); continue; }
      // Generated HTML is editable before its first export. Its capability URLs
      // may be published only while the corresponding saved detail-role images
      // still belong to this product and current signing configuration.
      const validKeys = keys.length <= 30 && new Set(keys).size === keys.length
        && keys.every(key => isOwnedImageKey(owner, key) && ownedKeys.includes(key));
      const candidates = validKeys ? await Promise.all(keys.map(imageForKey)) : [];
      const local = capabilities.filter(reference => !reference.url || reference.url.origin === config.origin
        // A former origin is identifiable only when its token verifies against
        // this owner's current selected image. Other external URLs stay manual.
        || candidates.some(image => reference.url!.pathname === `/media/quotation/${image.token}`));
      if (!local.length) { rows.push(row); continue; }
      const referenced = local.map(reference => reference.absolute && candidates.find(image => image.url === reference.url?.href));
      if (!validKeys || referenced.some(image => !image)) {
        const validationIssues = [...new Set([...(cell.validationIssues ?? []), '직접 수정한 상세 HTML의 이미지 주소가 현재 상품의 상세 이미지·공개 설정과 일치하지 않습니다. 현재 상세 이미지로 주소를 다시 확인해주세요.'])];
        rows.push({ ...row, fields: { ...row.fields, detailHtml: { ...cell, validationIssues,
          issues: [...validationIssues, ...(cell.reviewMessages ?? [])], needsReview: true } } });
      } else {
        if (row.included) for (const image of referenced) if (image) includedKeys.add(image.key);
        rows.push(row);
      }
      continue;
    }
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
      const image = await imageForKey(key);
      images.push(image);
      if (row.included) includedKeys.add(key);
    }
    const alt = row.fields.altText?.value ?? '';
    const imageHtml = images.map((image, index) => `<img src="${escape(image.url)}" alt="${escape(alt ? `${alt} ${index + 1}` : '')}" style="display:block;width:100%;height:auto">`).join('');
    const value = images.length ? `<div style="width:800px;max-width:100%;margin:0;padding:0;background-color:#ffffff;box-sizing:border-box">${paragraph}${imageHtml}</div>` : paragraph;
    const validationIssues = quotationValueIssues(definition, value), reviewMessages = cell.reviewMessages ?? [];
    rows.push({ ...row, fields: { ...row.fields, detailHtml: { ...cell, value, validationIssues, reviewMessages,
      issues: [...validationIssues, ...reviewMessages], needsReview: Boolean(definition.reviewRequired) || validationIssues.length > 0 || reviewMessages.length > 0 } } });
  }
  return { resolved: { ...resolved, rows }, images: [...byKey.values()].filter(image => includedKeys.has(image.key)) };
}

/** Explicit package/download requests publish only verified images referenced by final HTML.
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
  const sources = new Map<string, Set<string>>();
  return resolved.rows.filter(row => {
    if (!row.included || !gifs.length) return false;
    const html = row.fields.detailHtml?.value ?? '';
    if (!sources.has(html)) sources.set(html, new Set(manualImageSources(html)));
    return gifs.some(image => [...sources.get(html)!].some(src => {
      if (!/^https:\/\//i.test(src) && !src.startsWith('//')) return false;
      try { return new URL(src, image.url).href === image.url; } catch { return false; }
    }));
  }).map(row => ({
    kind: 'error', code: 'HTML_MEDIA_UNSUPPORTED', optionId: row.optionId, optionLabel: row.optionLabel, fieldId: 'detailHtml',
    message: 'HTML 상세 내용에 Supplier Hub가 지원하지 않는 GIF 이미지가 있습니다. 상세 이미지를 교체하거나 7단계 HTML 입력을 수정해주세요.',
  }));
}
