import { is1688ProductUrl } from '@/app/workflow';
import type { CategoryProfile } from '@/app/category-profiles';
import type { WorkspaceSettings } from '@/app/workspace-settings';

export const collectionBlock = '1688 상품 상세 수집 공급원이 연결되지 않았습니다. URL은 보관되며, 연결만으로 유료 작업이나 등록이 자동 실행되지는 않습니다.';
export type CollectionRequest = { offerId: string; sourceUrl: string; goal: string };
export type CollectionContext = { category: CategoryProfile; settings: WorkspaceSettings; features: string; keywords: string; capturedAt: string };
export type CollectionJob = {
  id: string; offer_id: string; source_url: string; goal: string;
  status: 'awaiting_connector' | 'cancelled'; created_at: string; updated_at: string;
  context?: CollectionContext | null;
};

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
