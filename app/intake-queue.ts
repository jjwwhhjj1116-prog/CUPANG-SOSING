import { parseCollectionRequest, collectionKeywords, collectionJobProgress, type CollectionJob, type PreservedCollectionRequest } from '@/app/sourcing';
import type { WorkspaceSettings } from '@/app/workspace-settings';
import type { CategoryProfile } from '@/app/category-profiles';
import {validateSourceCaptureSelection,sourceCaptureSelection,sameSourceCaptureSelection,type SourceCaptureSelection} from '@/app/source-capture-selection';
import {PrimaryCapturePending,readPrimaryCapture,type PrimaryCaptureReference} from '@/app/browser-product-bridge';
import {preservedCollectionRequests} from '@/app/collection-preservation';
import {savedRegistrationSettings} from '@/app/workspace-settings';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';

export type IntakeSourceReviewContinuation={reference:PrimaryCaptureReference;jobId:string;nonce:string;inputKey:string;state:'pending'|'uncertain'|'ready';ownerId?:string;company?:SupplierHubCompany|null;scope?:object};

export type IntakeRow = {
  id: string; profile: CategoryProfile; url: string; features: string; keywords: string;
  status: 'draft' | 'saved' | 'error'; message: string; productId?: string;
  profileSnapshotVerified?: true;
  forkJobId?: string;
  pendingJobId?: string;
  pendingSourceMode?: 'pending-source-urls-v1';
  pendingSourceHash?: string;
  sourceCapture?: SourceCaptureSelection;
  sourceReviewContinuation?: IntakeSourceReviewContinuation;
};
export function intakeSourceReviewInputKey(row:IntakeRow,goal:string,settings?:WorkspaceSettings){return JSON.stringify([row.url,row.profile,row.features,row.keywords,goal,settings?savedRegistrationSettings(settings):null]);}
export function intakeRow(profile: CategoryProfile, id: string): IntakeRow {
  return { id, profile, url: '', features: '', keywords: '', status: 'draft', message: '' };
}

/** Unfilled category rows stay editable in the queue; only entered URLs take
 * part in a start. Malformed runtime values still go through validation. */
export function intakeRowsForCollection(rows: readonly IntakeRow[]): IntakeRow[] {
  return rows.filter(row => row.status !== 'saved' && (typeof row.url !== 'string' || row.url.trim().length > 0));
}

export function visibleIntakeRows(rows: readonly IntakeRow[], query: string): IntakeRow[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    const text = [row.profile.categoryPath.join(' '), row.profile.categoryId, row.url, row.features, row.keywords, row.message].join(' ').toLocaleLowerCase();
    return words.every(word => text.includes(word));
  });
}
export function validateIntakeQueue(rows: readonly IntakeRow[], goal: string, displayedRows: readonly IntakeRow[] = rows) {
  if (!rows.length || rows.length > 50) throw Error('상품을 1~50개 추가해주세요.');
  const errors = new Map<string, string[]>();
  const seen = new Map<string, string[]>();
  const add = (id: string, message: string) => errors.set(id, [...(errors.get(id) ?? []), message]);
  const requests = intakeRowsForCollection(rows).flatMap(row => {
    let entry: ReturnType<typeof parseCollectionRequest>[number] | undefined;
    try { [entry] = parseCollectionRequest({ urls: [row.url], goal }); }
    catch (cause) { add(row.id, cause instanceof Error ? cause.message.replace(/^1번째 URL/u, `${displayedRows.findIndex(item => item.id === row.id) + 1}번째 URL`) : 'URL을 확인해주세요.'); }
    if (!/^[a-f0-9-]{36}$/.test(row.profile.id) || !Number.isSafeInteger(row.profile.revision) || row.profile.revision < 1) add(row.id, '카테고리를 다시 선택해주세요.');
    if (row.features.length > 2000 || row.keywords.length > 2000) add(row.id, '특징·키워드는 각각 2,000자까지 입력해주세요.');
    try { collectionKeywords(row.keywords); } catch (cause) { add(row.id, cause instanceof Error ? cause.message : '키워드를 확인해주세요.'); }
    let sourceCapture:Readonly<SourceCaptureSelection>|undefined;
    if(row.sourceCapture!==undefined)try{sourceCapture=validateSourceCaptureSelection(row.sourceCapture,row.url);}catch(cause){add(row.id,cause instanceof Error?cause.message:'선택한 수집본을 확인해주세요.');}
    if (!entry) return [];
    seen.set(entry.offerId, [...(seen.get(entry.offerId) ?? []), row.id]);
    return [{ id: row.id, body: { urls: [entry.sourceUrl], goal, profileId: row.profile.id, expectedProfileRevision: row.profile.revision, features: row.features, keywords: row.keywords },...(sourceCapture?{sourceCapture}:{}) }];
  });
  for (const [offerId, ids] of seen) if (ids.length > 1) {
    const numbers = ids.map(id => displayedRows.findIndex(row => row.id === id) + 1).join(', ');
    for (const id of ids) add(id, `같은 상품 URL 중복 · ${numbers}행 · 상품 ${offerId}. 사용할 행 하나만 남겨주세요.`);
  }
  return { requests, errors: [...errors].map(([id, messages]) => ({ id, row: displayedRows.findIndex(item => item.id === id) + 1, messages })) };
}
export function intakeQueueRequests(rows: readonly IntakeRow[], goal: string) {
  const result = validateIntakeQueue(rows, goal);
  if (result.errors.length) throw Error(result.errors.map(item => `${item.row}행: ${item.messages.join(' ')}`).join('\n'));
  return result.requests;
}

/** Existing endpoint keeps owner checks, profile revision checks and offer deduplication. */
export async function submitIntakeQueue(rows: readonly IntakeRow[], goal: string, options: {
  signal: AbortSignal; fetcher: typeof fetch;
  onRow: (id: string, state: Pick<IntakeRow, 'status' | 'message'> & Pick<Partial<IntakeRow>, 'productId' | 'forkJobId' | 'pendingJobId' | 'sourceReviewContinuation'>) => void;
  onJobs: (jobs: CollectionJob[]) => void;
  selectedIds?: ReadonlySet<string>;
  expectedSettings?: WorkspaceSettings;
  onSettingsChanged?:()=>void;
  collect?: (job:CollectionJob,onProgress:(message:string)=>void,onProduct:(id:string)=>void,selectedCapture?:Readonly<SourceCaptureSelection>)=>Promise<string|undefined>;
}) {
  if (options.signal.aborted) return;
  const fetcher = options.fetcher;
  const selectedRows = options.selectedIds ? rows.filter(row => options.selectedIds!.has(row.id)) : rows;
  const validation = validateIntakeQueue(selectedRows, goal, rows);
  const failedRows = new Set(validation.errors.map(error => error.id));
  const requests = validation.requests.filter(request => !failedRows.has(request.id));
  if (validation.errors.length) {
    for (const error of validation.errors) {
      if (options.signal.aborted) return;
      options.onRow(error.id, { status: 'error', message: error.messages.join(' ') });
    }
    if (!requests.length) throw Error(`${validation.errors.length}개 행의 입력을 확인해주세요. 각 행에 오류를 표시했습니다. 아직 요청을 전송하지 않았습니다.`);
  }
  const expectedSettings=options.expectedSettings?JSON.parse(JSON.stringify(options.expectedSettings)) as WorkspaceSettings:undefined;
  for (const request of requests) {
    if (options.signal.aborted) break;
    let savedProductId: string | undefined;
    const row=selectedRows.find(value=>value.id===request.id)!,continuation=row.sourceReviewContinuation;
    let activeJob:CollectionJob|undefined;
    try {
      if(continuation){
        if(row.status==='saved'||row.productId||row.forkJobId||row.pendingJobId||continuation.inputKey!==intakeSourceReviewInputKey(row,goal,expectedSettings))throw Error('원래 URL 수집 이후 입력이나 작업 연결이 변경되었습니다. 수집본을 명시적으로 다시 확인해주세요.');
        if(continuation.state!=='ready'){
          const saved=await readPrimaryCapture(continuation.reference,options.signal,fetcher);
          throw new PrimaryCapturePending(saved.reference,'PAGE_SOURCE_REVIEW_REQUIRED','같은 수집본을 확인했습니다. 이 행의 수집정보 확인·수정에서 검토 내용을 저장한 뒤 이어가세요.');
        }
        if(!continuation.reference.item||!sameSourceCaptureSelection(request.sourceCapture,sourceCaptureSelection(continuation.reference.item)))throw Error('검토한 수집본의 연결이 달라졌습니다. 원래 행을 확인해주세요.');
      }
      const response = continuation
        ?await fetcher('/api/collection-jobs?'+new URLSearchParams({id:continuation.jobId}),{cache:'no-store',signal:options.signal})
        :await fetcher('/api/collection-jobs', { method: 'POST', signal: options.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({...request.body,...(expectedSettings?{expectedSettings}:{})}) });
      const result = await response.json() as { jobs?: CollectionJob[]; preservedRequests?: PreservedCollectionRequest[]; error?: string; code?: string };
      if(continuation){
        const job=(result as {job?:CollectionJob}).job;
        if(!response.ok||!job||job.id!==continuation.jobId||job.source_url!==request.body.urls[0]||job.status==='cancelled'||job.product_id||!job.context||!continuation.company||!expectedSettings)throw Error('원래 수집 요청의 회원·회사·상품 연결을 확인하지 못했습니다. 새 요청을 만들지 않았습니다.');
        const differences=preservedCollectionRequests([job],parseCollectionRequest(request.body),{category:row.profile,settings:expectedSettings,features:row.features,keywords:row.keywords,company:continuation.company,capturedAt:job.context.capturedAt});
        if(differences.length)throw Error('원래 수집 요청의 카테고리·기본설정·입력이 변경되었습니다. 기존 원문은 유지됩니다.');
        result.jobs=[job];result.preservedRequests=[];
      }
      if (options.signal.aborted) break;
      if(!response.ok&&result.code==='REGISTRATION_SETTINGS_CHANGED'){options.onRow(request.id,{status:'error',message:result.error||'기본설정을 다시 확인해주세요.'});options.onSettingsChanged?.();break;}
      if(!response.ok&&response.status===409&&result.code==='CATEGORY_PROFILE_CHANGED'){options.onRow(request.id,{status:'error',message:result.error||'카테고리·견적서 설정이 변경되었습니다. 입력을 유지하고 카테고리를 다시 선택한 뒤 시작해주세요.'});break;}
      if (!response.ok || !Array.isArray(result.jobs) || result.jobs.length !== 1 || result.jobs[0].source_url !== request.body.urls[0] || !Array.isArray(result.preservedRequests)) throw Error(result.error || '해당 상품의 저장 결과를 확인하지 못했습니다. 입력은 유지됩니다.');
      activeJob=result.jobs[0];
      options.onJobs(result.jobs);
      if(request.sourceCapture&&result.jobs[0].product_id&&!result.jobs[0].received_at){
        options.onRow(request.id,{status:'error',message:'선택한 수집본으로 기존 작업을 변경하지 않았습니다. 기존 작업을 열거나 저장 원문으로 새 초안을 검토해주세요.',
          ...(result.jobs[0].product_id?{productId:result.jobs[0].product_id,forkJobId:result.jobs[0].id}:{pendingJobId:result.jobs[0].id})});continue;
      }
      const differences = result.preservedRequests?.flatMap(item => item.differences) ?? [];
      if(!differences.length&&options.collect) {
        const message=await options.collect(result.jobs[0],message=>{if(!options.signal.aborted)options.onRow(request.id,{status:'draft',message});},id=>{if(!options.signal.aborted&&id){savedProductId=id;options.onRow(request.id,{status:'draft',message:'상품 초안 저장됨 · 이미지 반영 중',productId:id});}},request.sourceCapture);
        if(options.signal.aborted)break;
        if(!message)throw Error('상품 반영 결과를 확인하지 못했습니다.');
        options.onRow(request.id,{status:'saved',message});continue;
      }
      options.onRow(request.id, differences.length ? { status: 'error', message: `기존 요청 유지 · ${[...new Set(differences)].join(', ')} 불일치. 기존 요청을 확인해주세요.`,
        ...(result.jobs[0].product_id ? {forkJobId:result.jobs[0].id,pendingJobId:undefined}: result.jobs[0].status === 'awaiting_connector' && /^[a-f0-9-]{36}$/.test(result.jobs[0].id) ? {pendingJobId:result.jobs[0].id,forkJobId:undefined} : {}) } : { status: 'saved', message: `요청 저장됨 · ${collectionJobProgress(result.jobs[0]).label}`,forkJobId:undefined,pendingJobId:undefined });
    } catch (cause) {
      if (options.signal.aborted) break;
      const message=cause instanceof Error ? cause.message : '저장 확인 실패 · 입력 유지';
      options.onRow(request.id, { status: 'error', message: savedProductId ? `상품·옵션 초안 저장됨 · 나머지 단계 미완료. ${message}` : message,
        ...(savedProductId ? {productId:savedProductId} : {}),
        ...(cause instanceof PrimaryCapturePending&&!savedProductId&&(activeJob||continuation)?{sourceReviewContinuation:{...continuation,reference:cause.reference,jobId:activeJob?.id??continuation!.jobId,nonce:continuation?.nonce??crypto.randomUUID(),inputKey:intakeSourceReviewInputKey(row,goal,expectedSettings),state:cause.code==='PAGE_SOURCE_REVIEW_REQUIRED'?'pending' as const:'uncertain' as const}}:{}) });
    }
  }
}

/** Recover an existing editor only from a confirmed link or matching saved context. */
export function intakeProductId(row: IntakeRow, jobs: readonly CollectionJob[]): string | null {
  if (row.productId) return row.productId;
  if(row.sourceCapture)return null;
  let sourceUrl: string;
  try { sourceUrl = parseCollectionRequest({urls:[row.url]})[0].sourceUrl; } catch { return null; }
  const ids = [...new Set(jobs.filter(job => {
    if (job.status === 'cancelled' || job.source_url !== sourceUrl || !job.product_id) return false;
    // Pending rows lose transient progress when the server draft is restored.
    // A matching URL alone must never attach a different category's quotation.
    const context = job.context;
    return context?.category.id === row.profile.id
      && context.category.revision === row.profile.revision
      && context.category.categoryId === row.profile.categoryId
      && JSON.stringify(context.category.categoryPath) === JSON.stringify(row.profile.categoryPath)
      && context.features === row.features && context.keywords === row.keywords;
  }).map(job => job.product_id!))];
  return ids.length === 1 ? ids[0] : null;
}
