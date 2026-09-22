import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { env } from 'cloudflare:workers';
import { imageFileType, isOwnedImageKey, MAX_IMAGE_BYTES } from '@/app/image-files';
import { readBoundedStream, RequestBodyError } from '@/app/request-body';

export async function GET(_: Request, context: { params: Promise<{ key: string[] }> }) {
  if (process.env.NODE_ENV === 'production' && !(await getChatGPTUser())?.verifiedAccess) return new Response('Cloudflare Access authentication required', { status: 503 });
  try {
    const ownerId = await getWorkspaceOwnerId();
    const { key } = await context.params;
    const objectKey = key.join('/');
    if (!isOwnedImageKey(ownerId, objectKey)) return new Response('Forbidden', { status: 403 });
    if (!env.FILES) return new Response('Image storage unavailable', { status: 503 });
    const object = await env.FILES.get(objectKey);
    if (!object) return new Response('Not found', { status: 404 });
    if (object.size > MAX_IMAGE_BYTES) return new Response('Image exceeds 10 MB', { status: 413 });
    const bytes = await readBoundedStream(object.body, MAX_IMAGE_BYTES);
    let actual;
    try { actual = imageFileType(bytes); } catch { /* Keep legacy originals, but never serve unsupported active formats inline. */ }
    return new Response(bytes.buffer as ArrayBuffer, { headers: {
      'content-type': actual?.contentType ?? 'application/octet-stream',
      'content-disposition': actual ? `inline; filename="sourceflow-image.${actual.extension}"` : 'attachment; filename="sourceflow-original.bin"',
      'content-length': String(bytes.byteLength), 'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox",
    } });
  } catch (error) {
    if (error instanceof RequestBodyError) return new Response(error.message, { status: error.status });
    return new Response('Image storage unavailable', { status: 503 });
  }
}
