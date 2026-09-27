import type { CategoryProfile } from './category-profiles';

/** Publish only a complete list; a later page failure must not hide saved settings. */
export async function loadCategoryProfiles(signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<CategoryProfile[]> {
  const profiles: CategoryProfile[] = [];
  const ids = new Set<string>();
  let cursor = '';
  for (;;) {
    signal?.throwIfAborted();
    const response = await fetcher(`/api/category-profiles${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store', signal });
    const body = await response.json() as { profiles?: CategoryProfile[]; nextCursor?: string | null; error?: string };
    signal?.throwIfAborted();
    if (!response.ok) throw new Error(body?.error || '카테고리 목록을 읽지 못했습니다.');
    if (!body || !Array.isArray(body.profiles)) throw new Error('카테고리 목록 응답이 올바르지 않습니다.');
    for (const profile of body.profiles) {
      if (!profile || typeof profile.id !== 'string' || !profile.id || ids.has(profile.id)) throw new Error('카테고리 목록이 변경되었습니다. 다시 불러와주세요.');
      ids.add(profile.id); profiles.push(profile);
    }
    const next = body.nextCursor;
    if (next == null) return profiles;
    if (typeof next !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(next) || next <= cursor || next !== body.profiles.at(-1)?.id) throw new Error('카테고리 목록 위치가 올바르지 않습니다.');
    cursor = next;
  }
}
