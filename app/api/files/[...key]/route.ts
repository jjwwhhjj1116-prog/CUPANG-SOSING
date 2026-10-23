import { getChatGPTUser } from '@/app/chatgpt-auth';
import { env } from 'cloudflare:workers';
import { imageFileType, isOwnedImageKey, MAX_IMAGE_BYTES } from '@/app/image-files';
import { privateImageStream, PrivateImageStreamError } from '@/app/private-image-stream';

export async function GET(_: Request, context: { params: Promise<{ key: string[] }> }) {
  try {
    // The same verified identity supplies this request's gate and owner. No
    // second session/JWT lookup, cross-request auth cache, or local fallback
    // is allowed when production or native authentication is enabled.
    const user = await getChatGPTUser();
    if ((process.env.NODE_ENV === 'production' || (env as {YOOFAM_AUTH_ENABLED?: string}).YOOFAM_AUTH_ENABLED === 'true') && !user?.verifiedAccess)
      return new Response('Cloudflare Access authentication required', { status: 503 });
    const ownerId = user?.userId ?? 'local-demo';
    const { key } = await context.params;
    const objectKey = key.join('/');
    if (!isOwnedImageKey(ownerId, objectKey)) return new Response('Forbidden', { status: 403 });
    // Editable image documents are returned only through the scoped image API.
    if (key.at(-1)?.startsWith('free-image-') && objectKey.endsWith('.png.edit.json')) return new Response('Not found', { status: 404 });
    if (!env.FILES) return new Response('Image storage unavailable', { status: 503 });
    const object = await env.FILES.get(objectKey);
    if (!object) return new Response('Not found', { status: 404 });
    if (object.size > MAX_IMAGE_BYTES) return new Response('Image exceeds 10 MB', { status: 413 });
    const image = await privateImageStream(object.body, object.size, MAX_IMAGE_BYTES);
    let actual;
    try { actual = imageFileType(image.prefix); } catch { /* Keep legacy originals, but never serve unsupported active formats inline. */ }
    return new Response(image.body, { headers: {
      'content-type': actual?.contentType ?? 'application/octet-stream',
      'content-disposition': actual ? `inline; filename="sourceflow-image.${actual.extension}"` : 'attachment; filename="sourceflow-original.bin"',
      'content-length': String(object.size), 'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox",
    } });
  } catch (error) {
    if (error instanceof PrivateImageStreamError) return new Response(error.message, { status: error.status });
    return new Response('Image storage unavailable', { status: 503 });
  }
}
