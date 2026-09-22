// No executor has yet produced verifiable SEO, image, quotation or submission results.
export const integrationBlock = {
  code: 'SUPPLIER_HUB_NOT_VERIFIED',
  error: 'Supplier Hub 확장·탭 연결과 제안 규격이 검증되지 않아 전송을 차단했습니다. 저장·전송되지 않았습니다.',
};

export const initialStatuses = {
  seo_status: '대기', image_status: '대기', quote_status: '대기',
  registration_status: '수동 입력', supplier_hub_status: '미전송',
};

export function is1688ProductUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'detail.1688.com'
      && !url.username && !url.password && !url.port
      && /^\/offer\/\d+\.html$/.test(url.pathname);
  } catch { return false; }
}

// Derived execution states must never be writable by a generic client PATCH.
export function validateProductPatch(body: unknown): Record<string, string | number> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const updates = body as Record<string, unknown>;
  if (!Object.keys(updates).length) return null;
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'title') {
      if (typeof value !== 'string' || !value.trim() || value.length > 500) return null;
    } else if (key === 'image_keys') {
      if (typeof value !== 'string') return null;
      try {
        const keys: unknown = JSON.parse(value);
        if (!Array.isArray(keys) || keys.length > 50 || keys.some(k => typeof k !== 'string' || !k)) return null;
      } catch { return null; }
    } else return null;
  }
  return updates as Record<string, string | number>;
}
