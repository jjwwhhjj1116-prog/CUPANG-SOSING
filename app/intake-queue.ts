import { parseCollectionRequest, collectionJobProgress, type CollectionJob, type PreservedCollectionRequest } from '@/app/sourcing';
import type { CategoryProfile } from '@/app/category-profiles';

export type IntakeRow = {
  id: string; profile: CategoryProfile; url: string; features: string; keywords: string;
  status: 'draft' | 'saved' | 'error'; message: string;
};
export function intakeRow(profile: CategoryProfile, id: string): IntakeRow {
  return { id, profile, url: '', features: '', keywords: '', status: 'draft', message: '' };
}
export function intakeQueueRequests(rows: readonly IntakeRow[], goal: string) {
  if (!rows.length || rows.length > 50) throw Error('상품을 1~50개 추가해주세요.');
  const seen = new Set<string>();
  return rows.filter(row => row.status !== 'saved').map(row => {
    let entry;
    try { [entry] = parseCollectionRequest({ urls: [row.url], goal }); }
    catch (cause) { throw Error(`${rows.indexOf(row) + 1}행: ${cause instanceof Error ? cause.message : 'URL을 확인해주세요.'}`); }
    if (seen.has(entry.offerId)) throw Error(`같은 상품 URL이 여러 행에 있습니다: ${entry.offerId}. 서로 다른 카테고리로 중복 접수하지 않도록 URL을 확인해주세요.`);
    seen.add(entry.offerId);
    if (!/^[a-f0-9-]{36}$/.test(row.profile.id) || !Number.isSafeInteger(row.profile.revision) || row.profile.revision < 1) throw Error('카테고리를 다시 선택해주세요.');
    if (row.features.length > 2000 || row.keywords.length > 2000) throw Error('특징·키워드는 각각 2,000자까지 입력해주세요.');
    return { id: row.id, body: { urls: [entry.sourceUrl], goal, profileId: row.profile.id, expectedProfileRevision: row.profile.revision, features: row.features, keywords: row.keywords } };
  });
}

/** Existing endpoint keeps owner checks, profile revision checks and offer deduplication. */
export async function submitIntakeQueue(rows: readonly IntakeRow[], goal: string, options: {
  signal: AbortSignal; fetcher: typeof fetch;
  onRow: (id: string, state: Pick<IntakeRow, 'status' | 'message'>) => void;
  onJobs: (jobs: CollectionJob[]) => void;
}) {
  const requests = intakeQueueRequests(rows, goal);
  for (const request of requests) {
    if (options.signal.aborted) break;
    try {
      const response = await options.fetcher('/api/collection-jobs', { method: 'POST', signal: options.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(request.body) });
      const result = await response.json() as { jobs?: CollectionJob[]; preservedRequests?: PreservedCollectionRequest[]; error?: string };
      if (options.signal.aborted) break;
      if (!response.ok || !Array.isArray(result.jobs) || result.jobs.length !== 1 || result.jobs[0].source_url !== request.body.urls[0] || !Array.isArray(result.preservedRequests)) throw Error(result.error || '해당 상품의 저장 결과를 확인하지 못했습니다. 입력은 유지됩니다.');
      options.onJobs(result.jobs);
      const differences = result.preservedRequests?.flatMap(item => item.differences) ?? [];
      options.onRow(request.id, differences.length ? { status: 'error', message: `기존 요청 유지 · ${[...new Set(differences)].join(', ')} 불일치. 기존 요청을 확인해주세요.` } : { status: 'saved', message: `요청 저장됨 · ${collectionJobProgress(result.jobs[0]).label}` });
    } catch (cause) {
      if (options.signal.aborted) break;
      options.onRow(request.id, { status: 'error', message: cause instanceof Error ? cause.message : '저장 확인 실패 · 입력 유지' });
    }
  }
}
