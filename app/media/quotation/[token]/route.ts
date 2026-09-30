import { env } from 'cloudflare:workers';
import { imageFileType, MAX_IMAGE_BYTES } from '@/app/image-files';
import { readBoundedStream } from '@/app/request-body';
import { PUBLIC_DETAIL_PREFIX, PUBLIC_DETAIL_FORMAT } from '@/app/quotation-public-detail';

/** Capability URL for explicitly exported product-detail images only. No private-key lookup. */
export async function GET(_: Request, context: { params: Promise<{ token: string }> }) {
  const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const { token } = await context.params;
  if (!/^[a-f0-9]{64}$/.test(token)) return notFound();
  try {
    const object = await env.FILES.get(PUBLIC_DETAIL_PREFIX + token);
    if (!object || object.customMetadata?.publication !== PUBLIC_DETAIL_FORMAT || !/^[a-f0-9]{64}$/.test(object.customMetadata?.sha256 ?? '') || object.size < 1 || object.size > MAX_IMAGE_BYTES)
      return notFound();
    const bytes = await readBoundedStream(object.body, MAX_IMAGE_BYTES);
    let actual;
    try { actual = imageFileType(bytes); } catch { return notFound(); }
    if (actual.extension === 'gif' || object.httpMetadata?.contentType !== actual.contentType || bytes.byteLength !== object.size) return notFound();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== object.customMetadata.sha256) return notFound();
    return new Response(bytes.buffer as ArrayBuffer, { headers: { 'content-type': actual.contentType, 'content-length': String(bytes.byteLength),
      'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox",
      'x-robots-tag': 'noindex, nofollow', 'content-disposition': `inline; filename="detail.${actual.extension}"` } });
  } catch { return new Response('Image storage unavailable', { status: 503 }); }
}
