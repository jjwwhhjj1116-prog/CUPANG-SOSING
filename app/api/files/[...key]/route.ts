import { getChatGPTUser } from '@/app/chatgpt-auth';
import { env } from 'cloudflare:workers';

export async function GET(_: Request, context: { params: Promise<{ key: string[] }> }) {
  const ownerId = (await getChatGPTUser())?.userId ?? 'local-demo';
  const { key } = await context.params;
  const objectKey = key.join('/');
  if (!objectKey.startsWith(`${ownerId}/`)) return new Response('Forbidden', { status: 403 });
  const object = await env.FILES.get(objectKey);
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600' } });
}
