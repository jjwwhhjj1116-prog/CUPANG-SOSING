import { imageExtension } from '@/app/exports/review-bundle';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_MULTIPART_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
const types = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' } as const;
export function imageFileType(bytes: Uint8Array) {
  const extension = imageExtension(bytes);
  return { extension, contentType: types[extension] };
}
/** Image upload keys are one filename within the exact user's namespace. */
export function isOwnedImageKey(ownerId: string, key: unknown): key is string {
  if (!ownerId || ownerId.length > 200 || /[\/\\\u0000-\u0020%?#]/u.test(ownerId)) return false;
  if (typeof key !== 'string' || key.length > 512 || !key.startsWith(`${ownerId}/`)) return false;
  const filename = key.slice(ownerId.length + 1);
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename) && filename !== '.' && filename !== '..';
}
export function imageObjectName(originalName: string, extension: string) {
  const base = originalName.replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `${base || 'image'}.${extension}`;
}
