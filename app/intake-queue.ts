import { parseCollectionRequest, collectionKeywords, collectionJobProgress, type CollectionJob, type PreservedCollectionRequest } from '@/app/sourcing';
import type { WorkspaceSettings } from '@/app/workspace-settings';
import type { CategoryProfile } from '@/app/category-profiles';

export type IntakeRow = {
  id: string; profile: CategoryProfile; url: string; features: string; keywords: string;
  status: 'draft' | 'saved' | 'error'; message: string;
};
export function intakeRow(profile: CategoryProfile, id: string): IntakeRow {
  return { id, profile, url: '', features: '', keywords: '', status: 'draft', message: '' };
}

export function visibleIntakeRows(rows: readonly IntakeRow[], query: string): IntakeRow[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    const text = [row.profile.categoryPath.join(' '), row.profile.categoryId, row.url, row.features, row.keywords, row.message].join(' ').toLocaleLowerCase();
    return words.every(word => text.includes(word));
  });
}
export function validateIntakeQueue(rows: readonly IntakeRow[], goal: string) {
  if (!rows.length || rows.length > 50) throw Error('상품을 1~50개 추가해주세요.');
  const errors = new Map<string, string[]>();
  const seen = new Map<string, string[]>();
  const add = (id: string, message: string) => errors.set(id, [...(errors.get(id) ?? []), message]);
  const requests = rows.filter(row => row.status !== 'saved').flatMap(row => {
    let entry: ReturnType<typeof parseCollectionRequest>[number] | undefined;
    try { [entry] = parseCollectionRequest({ urls: [row.url], goal }); }
    catch (cause) { add(row.id, cause instanceof Error ? cause.message : 'URL을 확인해주세요.'); }
    if (!/^[a-f0-9-]{36}$/.test(row.profile.id) || !Number.isSafeInteger(row.profile.revision) || row.profile.revision < 1) add(row.id, '카테고리를 다시 선택해주세요.');
    if (row.features.length > 2000 || row.keywords.length > 2000) add(row.id, '특징·키워드는 각각 2,000자까지 입력해주세요.');
    try { collectionKeywords(row.keywords); } catch (cause) { add(row.id, cause instanceof Error ? cause.message : '키워드를 확인해주세요.'); }
    if (!entry) return [];
    seen.set(entry.offerId, [...(seen.get(entry.offerId) ?? []), row.id]);
    return [{ id: row.id, body: { urls: [entry.sourceUrl], goal, profileId: row.profile.id, expectedProfileRevision: row.profile.revision, features: row.features, keywords: row.keywords } }];
  });
  for (const [offerId, ids] of seen) if (ids.length > 1) {
    const numbers = ids.map(id => rows.findIndex(row => row.id === id) + 1).join(', ');
    for (const id of ids) add(id, `같은 상품 URL 중복 · ${numbers}행 · 상품 ${offerId}. 사용할 행 하나만 남겨주세요.`);
  }
  return { requests, errors: [...errors].map(([id, messages]) => ({ id, row: rows.findIndex(item => item.id === id) + 1, messages })) };
}
export function intakeQueueRequests(rows: readonly IntakeRow[], goal: string) {
  const result = validateIntakeQueue(rows, goal);
  if (result.errors.length) throw Error(result.errors.map(item => `${item.row}행: ${item.messages.join(' ')}`).join('\n'));
  return result.requests;
}

/** Existing endpoint keeps owner checks, profile revision checks and offer deduplication. */
export async function submitIntakeQueue(rows: readonly IntakeRow[], goal: string, options: {
  signal: AbortSignal; fetcher: typeof fetch;
  onRow: (id: string, state: Pick<IntakeRow, 'status' | 'message'>) => void;
  onJobs: (jobs: CollectionJob[]) => void;
  selectedIds?: ReadonlySet<string>;
  expectedSettings?: WorkspaceSettings;
  collect?: (job:CollectionJob,onProgress:(message:string)=>void)=>Promise<string|undefined>;
}) {
  if (options.signal.aborted) return;
  const selectedRows = options.selectedIds ? rows.filter(row => options.selectedIds!.has(row.id)) : rows;
  const validation = validateIntakeQueue(selectedRows, goal);
  if (validation.errors.length) {
    for (const error of validation.errors) options.onRow(error.id, { status: 'error', message: error.messages.join(' ') });
    throw Error(`${validation.errors.length}개 행의 입력을 확인해주세요. 각 행에 오류를 표시했습니다. 아직 요청을 전송하지 않았습니다.`);
  }
  const requests = validation.requests;
  const expectedSettings=options.expectedSettings?JSON.parse(JSON.stringify(options.expectedSettings)) as WorkspaceSettings:undefined;
  for (const request of requests) {
    if (options.signal.aborted) break;
    try {
      const response = await options.fetcher('/api/collection-jobs', { method: 'POST', signal: options.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({...request.body,...(expectedSettings?{expectedSettings}:{})}) });
      const result = await response.json() as { jobs?: CollectionJob[]; preservedRequests?: PreservedCollectionRequest[]; error?: string; code?: string };
      if (options.signal.aborted) break;
      if(!response.ok&&result.code==='REGISTRATION_SETTINGS_CHANGED'){options.onRow(request.id,{status:'error',message:result.error||'기본설정을 다시 확인해주세요.'});break;}
      if (!response.ok || !Array.isArray(result.jobs) || result.jobs.length !== 1 || result.jobs[0].source_url !== request.body.urls[0] || !Array.isArray(result.preservedRequests)) throw Error(result.error || '해당 상품의 저장 결과를 확인하지 못했습니다. 입력은 유지됩니다.');
      options.onJobs(result.jobs);
      const differences = result.preservedRequests?.flatMap(item => item.differences) ?? [];
      if(!differences.length&&options.collect) {
        const message=await options.collect(result.jobs[0],message=>options.onRow(request.id,{status:'draft',message}));
        if(options.signal.aborted)break;
        if(!message)throw Error('상품 반영 결과를 확인하지 못했습니다.');
        options.onRow(request.id,{status:'saved',message});continue;
      }
      options.onRow(request.id, differences.length ? { status: 'error', message: `기존 요청 유지 · ${[...new Set(differences)].join(', ')} 불일치. 기존 요청을 확인해주세요.` } : { status: 'saved', message: `요청 저장됨 · ${collectionJobProgress(result.jobs[0]).label}` });
    } catch (cause) {
      if (options.signal.aborted) break;
      options.onRow(request.id, { status: 'error', message: cause instanceof Error ? cause.message : '저장 확인 실패 · 입력 유지' });
    }
  }
}
