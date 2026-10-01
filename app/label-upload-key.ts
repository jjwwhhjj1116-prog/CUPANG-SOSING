/** A fixed filename within one authenticated owner's image namespace. */
export function labelUploadKey(ownerId: string, uploadId: unknown) {
  if (typeof uploadId !== 'string' || !/^[a-f0-9]{64}$/.test(uploadId)) throw new Error('라벨 업로드 번호를 확인해주세요.');
  return `${ownerId}/quotation-label-${uploadId}.png`;
}

export async function labelUploadDigest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
