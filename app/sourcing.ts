import { is1688ProductUrl } from '@/app/workflow';
import type { CategoryProfile } from '@/app/category-profiles';
import type { WorkspaceSettings } from '@/app/workspace-settings';

export const collectionBlock = '상품 추가 시 URL의 공개 상품 정보를 가져옵니다. 페이지에서 옵션·원가를 확인할 수 없으면 입력을 유지합니다. 초안을 확인·수정한 뒤 등록전송을 진행하세요.';
export type CollectionRequest = { offerId: string; sourceUrl: string; goal: string };
export type CollectionContext = { category: CategoryProfile; settings: WorkspaceSettings; features: string; keywords: string; capturedAt: string };
export type CollectionJob = {
  id: string; offer_id: string; source_url: string; goal: string;
  status: 'awaiting_connector' | 'cancelled'; created_at: string; updated_at: string;
  context?: CollectionContext | null; product_id?: string | null; received_at?: string | null;
};

export function collectionJobProgress(job: Pick<CollectionJob, 'status' | 'product_id' | 'received_at'>): {kind:string;label:string} {
  if(job.product_id)return {kind:'imported',label:'상품 반영됨'};
  if(job.status==='cancelled')return {kind:'cancelled',label:'취소됨'};
  if(job.received_at)return {kind:'received',label:'원문 수신 · 상품 반영 대기'};
  return {kind:'awaiting_connector',label:'수집 연결 대기'};
}

export type PreservedCollectionRequest = { offerId: string; sourceUrl: string; differences: string[] };
/** Compare the persisted result, so concurrent inserts and retries are reported truthfully. */
export function preservedCollectionRequests(jobs: readonly CollectionJob[], requests: readonly CollectionRequest[], context: CollectionContext): PreservedCollectionRequest[] {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
    return JSON.stringify(value) ?? 'undefined';
  };
  return jobs.flatMap(job => {
    const request = requests.find(item => item.offerId === job.offer_id);
    if (!request) return [];
    const differences: string[] = [];
    if (job.goal !== request.goal) differences.push('작업 목표');
    if (!job.context) differences.push('카테고리·기본설정 기록 없음');
    else {
      if (canonical(job.context.category) !== canonical(context.category)) differences.push('카테고리·견적서 설정');
      if (canonical(job.context.settings) !== canonical(context.settings)) differences.push('기본설정');
      if (job.context.features !== context.features) differences.push('상품 특징');
      if (job.context.keywords !== context.keywords) differences.push('타겟 키워드');
    }
    return differences.length ? [{ offerId: job.offer_id, sourceUrl: job.source_url, differences }] : [];
  });
}

export function parseCollectionRequest(input: unknown): CollectionRequest[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('URL 목록이 필요합니다.');
  const { urls, goal = 'collect' } = input as Record<string, unknown>;
  if (!Array.isArray(urls) || !urls.length || urls.length > 50) throw new Error('한 번에 1~50개 URL을 입력해주세요.');
  if (typeof goal !== 'string' || !['collect', 'price', 'work', 'transmit'].includes(goal)) throw new Error('작업 목표를 확인해주세요.');
  const unique = new Map<string, CollectionRequest>();
  for (const [index, value] of urls.entries()) {
    if (typeof value !== 'string' || value.length > 2048 || !is1688ProductUrl(value.trim())) {
      throw new Error(`${index + 1}번째 URL이 올바른 1688 상세 상품 주소가 아닙니다.`);
    }
    const url = new URL(value.trim());
    const offerId = url.pathname.slice('/offer/'.length, -'.html'.length);
    if (!/^[1-9]\d{0,29}$/.test(offerId)) throw new Error(`${index + 1}번째 상품 번호를 확인해주세요.`);
    unique.set(offerId, { offerId, sourceUrl: `https://detail.1688.com/offer/${offerId}.html`, goal });
  }
  return [...unique.values()];
}

/** Owner-supplied target keywords become editable SEO input, never AI output. */
export function collectionKeywords(value: unknown): string[] {
  if (value === undefined) return [];
  if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new Error('타겟 키워드는 제어문자 없이 2,000자 이내로 입력해주세요.');
  const words = [...new Set(value.split(/[\n,]/).map(word => word.trim()).filter(Boolean))];
  if (words.length > 50 || words.some(word => word.length > 100)) throw new Error('타겟 키워드는 쉼표 또는 줄바꿈으로 구분해 최대 50개, 각 100자까지 입력해주세요.');
  return words;
}
