import { getChatGPTUser, getWorkspaceOwnerId } from '@/app/chatgpt-auth';
import { readBoundedJson, RequestBodyError } from '@/app/request-body';
import { validateIntakeDraft, intakeDraftProfileSnapshot } from '@/app/intake-draft';
import { readIntakeDraft, saveIntakeDraft } from '@/db/intake-draft';
import { getCategoryProfile } from '@/db/category-profiles';
import type { IntakeRow } from '@/app/intake-queue';
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
async function authorized() { return process.env.NODE_ENV !== 'production' || (await getChatGPTUser())?.verifiedAccess; }
export async function GET() {
  if (!await authorized()) return json({ error: '로그인 상태를 확인해주세요.' }, 503);
  try { return json({ draft: await readIntakeDraft(await getWorkspaceOwnerId()) }); }
  catch { return json({ error: '임시저장 내용을 불러오지 못했습니다.' }, 503); }
}
export async function PUT(request: Request) {
  if (!await authorized()) return json({ error: '로그인 상태를 확인해주세요.' }, 503);
  let input;
  try { input = validateIntakeDraft(await readBoundedJson(request, 1024 * 1024)); }
  catch (cause) { return json({ error: cause instanceof Error ? cause.message : '입력을 확인해주세요.' }, cause instanceof RequestBodyError ? cause.status : 400); }
  try {
    const owner = await getWorkspaceOwnerId(); const rows: IntakeRow[] = [];
    const previous = await readIntakeDraft(owner);
    if (previous.revision !== input.expectedRevision) return json({ error: '다른 창에서 임시저장이 변경되었습니다. 현재 입력은 유지됩니다. 서버 초안을 확인한 뒤 다시 저장해주세요.' }, 409);
    const profiles = new Map<string, Awaited<ReturnType<typeof getCategoryProfile>>>();
    for (const row of input.rows) {
      if (!profiles.has(row.profileId)) profiles.set(row.profileId, await getCategoryProfile(owner, row.profileId));
      const profile = profiles.get(row.profileId);
      if (!profile) return json({ error: '카테고리 설정을 찾을 수 없습니다. 해당 행의 카테고리를 다시 선택해주세요.' }, 400);
      const snapshot = intakeDraftProfileSnapshot(row, profile, previous.rows.find(saved => saved.id === row.id));
      if (!snapshot) return json({ error: '선택한 카테고리 설정이 변경되었습니다. URL·특징·키워드는 유지하고 해당 행의 카테고리를 다시 선택해주세요.', code: 'CATEGORY_PROFILE_CHANGED' }, 409);
      rows.push({ id: row.id, ...snapshot, url: row.url, features: row.features, keywords: row.keywords, status: 'draft' });
    }
    const draft = await saveIntakeDraft(owner, input.expectedRevision, { rows, goal: input.goal });
    return draft ? json({ draft }) : json({ error: '다른 창에서 임시저장이 변경되었습니다. 현재 입력은 유지됩니다. 서버 초안을 확인한 뒤 다시 저장해주세요.' }, 409);
  } catch { return json({ error: '임시저장 결과를 확인하지 못했습니다. 현재 입력을 유지했습니다.' }, 503); }
}
