export type ArchiveRange = 'today' | '7days' | 'month' | 'all' | 'custom';
export type ArchiveKind = 'product' | 'request';
export type ArchiveCategory = { id: string; path: string[]; source: 'request-snapshot' | 'matching-request'; requestId: string };
export type ArchiveItem = {
  id: string; sourceKind: ArchiveKind; title: string; sourceUrl: string; offerId: string | null;
  createdAt: string; updatedAt: string; status: string; supplierHubStatus: string | null;
  category: ArchiveCategory | null;
};
export type ArchiveCursor = { version: 2; createdAt: string; id: string; kind: ArchiveKind; filter: string };
export type ArchiveQuery = { range: ArchiveRange; from: string | null; to: string | null;
  startUtc: string | null; endUtc: string | null; query: string; limit: number; cursor: ArchiveCursor | null };
export type ArchivePage = { items: ArchiveItem[]; nextCursor: string | null; range: ArchiveRange;
  from: string | null; to: string | null; query: string; timeZone: 'Asia/Seoul'; limit: number };
export class ArchiveQueryError extends Error {}
const dayMs = 86_400_000;
const koreaOffsetMs = 9 * 60 * 60 * 1000;
export function koreanDay(iso: string | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() + koreaOffsetMs).toISOString().slice(0, 10);
}
function dayTime(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ArchiveQueryError('날짜는 YYYY-MM-DD 형식으로 입력해주세요.');
  const value = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== day) throw new ArchiveQueryError('실제 존재하는 날짜를 선택해주세요.');
  return value;
}
const isoDay = (value: number) => new Date(value).toISOString().slice(0, 10);
export function archiveDateBounds(range: ArchiveRange, from?: string | null, to?: string | null, now = new Date()) {
  const today = koreanDay(now); const todayMs = dayTime(today);
  if (range === 'all') return { from: null, to: null, startUtc: null, endUtc: null };
  const first = range === 'today' ? today : range === '7days' ? isoDay(todayMs - 6 * dayMs) : range === 'month' ? today.slice(0, 7) + '-01' : from;
  const last = range === 'custom' ? to : today;
  if (!first || !last) throw new ArchiveQueryError('시작일과 종료일을 모두 선택해주세요.');
  const start = dayTime(first); const end = dayTime(last);
  if (start > end) throw new ArchiveQueryError('종료일은 시작일보다 빠를 수 없습니다.');
  return { from: first, to: last, startUtc: new Date(start - koreaOffsetMs).toISOString(), endUtc: new Date(end + dayMs - koreaOffsetMs).toISOString() };
}
async function filterKey(query: Omit<ArchiveQuery, 'cursor'>) {
  // Keep long multilingual searches out of cursors and the next-page URL.
  // This binds filters only; owner isolation remains enforced by the SQL query.
  const bytes = new TextEncoder().encode(JSON.stringify([query.range, query.startUtc, query.endUtc, query.query, query.limit]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
function encodeBase64(value: string) { return btoa(String.fromCharCode(...new TextEncoder().encode(value))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function decodeBase64(value: string) {
  if (!/^[A-Za-z0-9_-]{1,6000}$/.test(value)) throw new ArchiveQueryError('페이지 위치가 올바르지 않습니다. 처음부터 조회해주세요.');
  const normal = value.replaceAll('-', '+').replaceAll('_', '/');
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(normal + '='.repeat((4 - normal.length % 4) % 4)), value => value.charCodeAt(0)));
}
export async function parseArchiveQuery(params: URLSearchParams, now = new Date()): Promise<ArchiveQuery> {
  for (const [key] of params) if (!['range', 'from', 'to', 'q', 'limit', 'cursor'].includes(key) || params.getAll(key).length !== 1) throw new ArchiveQueryError('중복되거나 지원하지 않는 조회 조건입니다.');
  const range = params.get('range') ?? '7days';
  if (!['today', '7days', 'month', 'all', 'custom'].includes(range)) throw new ArchiveQueryError('조회 기간을 선택해주세요.');
  const query = (params.get('q') ?? '').trim();
  if (query.length > 2048 || /[\u0000-\u001f\u007f]/u.test(query)) throw new ArchiveQueryError('검색어는 2,048자 이내의 상품명·URL·상품 번호로 입력해주세요.');
  const rawLimit = params.get('limit') ?? '50'; const limit = /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ArchiveQueryError('페이지 크기는 1~100개여야 합니다.');
  const base = { range: range as ArchiveRange, ...archiveDateBounds(range as ArchiveRange, params.get('from'), params.get('to'), now), query, limit };
  let cursor: ArchiveCursor | null = null;
  const token = params.get('cursor');
  if (token) {
    try {
      const value = JSON.parse(decodeBase64(token));
      if (!value || value.version !== 2 || !['product', 'request'].includes(value.kind) || typeof value.id !== 'string' || !value.id || value.id.length > 200 || typeof value.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) || new Date(value.createdAt).toISOString() !== value.createdAt || value.filter !== await filterKey(base)) throw new Error();
      cursor = { version: 2, kind: value.kind, id: value.id, createdAt: value.createdAt, filter: value.filter };
    } catch { throw new ArchiveQueryError('페이지 위치와 조회 조건이 달라졌습니다. 처음부터 조회해주세요.'); }
  }
  return { ...base, cursor };
}
export async function nextArchiveCursor(item: Pick<ArchiveItem, 'id' | 'sourceKind' | 'createdAt'>, query: ArchiveQuery) {
  return encodeBase64(JSON.stringify({ version: 2, id: item.id, kind: item.sourceKind, createdAt: item.createdAt, filter: await filterKey(query) }));
}
export function archiveStatusLabel(item: Pick<ArchiveItem, 'sourceKind' | 'status'>) {
  if (item.sourceKind === 'request') return item.status === 'cancelled' ? '요청 취소' : item.status === 'awaiting_connector' ? '수집 연결 대기' : '요청 상태 확인 필요';
  return item.status || '상품 상태 확인 필요';
}
export function safeArchiveUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'detail.1688.com' && !url.username && !url.password && !url.port && /^\/offer\/\d+\.html$/.test(url.pathname) ? value : null; } catch { return null; }
}
export function archiveOfferId(value: string) { const safe = safeArchiveUrl(value); return safe ? new URL(safe).pathname.match(/\/offer\/(\d+)\.html$/)?.[1] ?? null : null; }
