import type { IntakeRow } from '@/app/intake-queue';
import type { CategoryProfile } from '@/app/category-profiles';
import {validateSourceCaptureSelection} from '@/app/source-capture-selection';
export type IntakeDraft = { revision: number; rows: IntakeRow[]; goal: string; updatedAt: string | null };
/** New URL intake prepares editable SEO, pricing and source image roles.
 * Persisted draft goals remain authoritative; this never triggers transmission. */
export const newIntakeDraftGoal = 'work' as const;
export function intakeDraftOwnerId(value:unknown):string|null {
  return typeof value==='string'&&value.length>0&&value.length<=200&&value===value.trim()&&!/[\u0000-\u001f\u007f]/u.test(value)?value:null;
}
export function validateIntakeDraft(input: unknown) {
  const body = input as Record<string, unknown>;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) throw Error('임시저장 버전을 확인해주세요.');
  if (!['collect', 'price', 'work', 'transmit'].includes(String(body.goal))) throw Error('작업 목표를 확인해주세요.');
  if (!Array.isArray(body.rows) || body.rows.length > 50) throw Error('임시저장은 최대 50행입니다.');
  const expectedOwnerId=Object.hasOwn(body,'expectedOwnerId')?intakeDraftOwnerId(body.expectedOwnerId):undefined;
  if(expectedOwnerId===null)throw Error('임시저장 계정 정보를 확인해주세요.');
  const ids = new Set<string>();
  const rows = body.rows.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('상품 입력 행을 확인해주세요.');
    const row = value as Record<string, unknown>;
    const text = (key: string, limit: number) => { const v = row[key]; if (typeof v !== 'string' || v.length > limit) throw Error(`${key} 입력 길이를 확인해주세요.`); return v; };
    const id = text('id', 100); const profileId = text('profileId', 36);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || ids.has(id)) throw Error('상품 행 ID가 잘못되었거나 중복되었습니다.');
    ids.add(id);
    if (!/^[a-f0-9-]{36}$/.test(profileId) || !Number.isSafeInteger(row.profileRevision) || Number(row.profileRevision) < 1) throw Error('카테고리 선택을 확인해주세요.');
    const url=text('url',2048),sourceCapture=row.sourceCapture===undefined?undefined:validateSourceCaptureSelection(row.sourceCapture,url);
    return { id, profileId, profileRevision: Number(row.profileRevision), url, features: text('features', 2000), keywords: text('keywords', 2000),...(sourceCapture?{sourceCapture}:{}) };
  });
  return { expectedRevision: Number(body.expectedRevision), goal: String(body.goal), rows,...(expectedOwnerId!==undefined?{expectedOwnerId}:{}) };
}
export function intakeDraftBody(rows: readonly IntakeRow[], goal: string, expectedRevision: number, expectedOwnerId?:string) {
  return validateIntakeDraft({ expectedRevision, goal,...(expectedOwnerId!==undefined?{expectedOwnerId}:{}), rows: rows.filter(row => row.status !== 'saved').map(row => ({ id: row.id, profileId: row.profile.id, profileRevision: row.profile.revision, url: row.url, features: row.features, keywords: row.keywords,...(row.sourceCapture!==undefined?{sourceCapture:row.sourceCapture}:{}) })) });
}

/** Only server-owned current or previously verified snapshots can acknowledge a
 * selected revision. Never attach current category/company to an old revision. */
export function intakeDraftProfileSnapshot(row: ReturnType<typeof validateIntakeDraft>['rows'][number], current: CategoryProfile, previous?: IntakeRow): Pick<IntakeRow, 'profile' | 'message' | 'profileSnapshotVerified'> | null {
  if (current.id === row.profileId && current.revision === row.profileRevision) {
    return { profile: current, message: '', profileSnapshotVerified: true };
  }
  if (previous?.id === row.id && previous.status === 'draft'
    && previous.profile?.id === row.profileId && previous.profile.revision === row.profileRevision
    && (previous.profileSnapshotVerified === true || previous.message === '')) {
    return { profile: previous.profile, message: '카테고리 설정 변경됨 · 다시 선택해주세요.', profileSnapshotVerified: true };
  }
  return null;
}

/** Saved input is confirmed by its contents, not an HTTP status or revision alone. */
export function readIntakeDraftResponse(input: unknown,expectedOwnerId?:string): IntakeDraft {
  if(expectedOwnerId!==undefined&&(!intakeDraftOwnerId(expectedOwnerId)||intakeDraftOwnerId((input as {ownerId?:unknown}|null)?.ownerId)!==expectedOwnerId))
    throw Error('임시저장을 조회한 로그인 계정이 다릅니다. 현재 입력을 유지하고 페이지를 새로고침해주세요.');
  const draft = (input as { draft?: IntakeDraft } | null)?.draft;
  if (!draft || !Number.isSafeInteger(draft.revision) || draft.revision < 0 || !Array.isArray(draft.rows)
    || draft.rows.some(row => !row || row.status !== 'draft' || !row.profile)
    || (draft.updatedAt !== null && (typeof draft.updatedAt !== 'string' || !Number.isFinite(Date.parse(draft.updatedAt))))) {
    throw Error('임시저장 응답의 입력 내용과 버전을 확인하지 못했습니다.');
  }
  intakeDraftBody(draft.rows, draft.goal, draft.revision);
  return {...draft,rows:draft.rows.map(row=>row.sourceCapture===undefined?row:{...row,sourceCapture:validateSourceCaptureSelection(row.sourceCapture,row.url)})};
}

export function confirmIntakeDraftSave(input: unknown, requested: ReturnType<typeof intakeDraftBody>): IntakeDraft {
  if (!intakeDraftOwnerId(requested.expectedOwnerId)) throw Error('임시저장을 요청한 로그인 계정 정보를 확인하지 못했습니다.');
  const draft = readIntakeDraftResponse(input,requested.expectedOwnerId);
  const saved = intakeDraftBody(draft.rows, draft.goal, requested.expectedRevision,requested.expectedOwnerId);
  if (draft.revision !== requested.expectedRevision + 1 || JSON.stringify(saved) !== JSON.stringify(requested)) {
    throw Error('서버 초안이 저장 요청과 다릅니다. 현재 입력은 유지됩니다. 서버 초안을 확인해주세요.');
  }
  return draft;
}
