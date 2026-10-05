import type { CategoryProfile } from './category-profiles';

/** Report only the app HTTP step/status, never a login or upstream HTML body. */
export async function readCategoryJsonResponse<T>(response:Response,stage:string,read:()=>Promise<unknown>=()=>response.json()):Promise<T>{
  const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
  const failure=(reason:string)=>new Error(`${stage} 실패 [HTTP ${response.status} · ${reason}]. ${response.status===401||response.status===403?'앱 로그인과 접근 권한을 확인해주세요.':response.status>=500?'앱 서버 응답을 확인한 뒤 다시 시도해주세요.':'앱 로그인 상태 또는 서버 응답을 확인해주세요.'}`);
  if(!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json$/.test(type)){
    await response.body?.cancel().catch(()=>undefined);
    throw failure(type==='text/html'?'HTML 응답':'JSON이 아닌 응답');
  }
  try{
    const body=await read();
    if(!body||typeof body!=='object'||Array.isArray(body))throw Error('invalid object');
    return body as T;
  }catch(error){
    if(error&&typeof error==='object'&&'name' in error&&error.name==='AbortError')throw error;
    throw failure(error&&typeof error==='object'&&'status' in error&&error.status===413?'응답 크기 초과':'JSON 형식 오류');
  }
}

/** Publish only a complete list; a later page failure must not hide saved settings. */
export async function loadCategoryProfiles(signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<CategoryProfile[]> {
  const profiles: CategoryProfile[] = [];
  const ids = new Set<string>();
  let cursor = '';
  for (;;) {
    signal?.throwIfAborted();
    const response = await fetcher(`/api/category-profiles${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store', signal });
    const body = await readCategoryJsonResponse<{ profiles?: CategoryProfile[]; nextCursor?: string | null; error?: string }>(response,'카테고리 목록 조회');
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
