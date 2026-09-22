'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { archiveStatusLabel, koreanDay, safeArchiveUrl, type ArchivePage, type ArchiveRange } from '@/app/product-archive';
import './product-archive.css';

type Filters = { range: ArchiveRange; from: string; to: string; query: string };
export type ProductArchiveProps = { onOpenProduct: (productId: string) => void | Promise<void>; refreshToken?: string | number };
const initialFilters: Filters = { range: '7days', from: '', to: '', query: '' };
const ranges: { id: ArchiveRange; label: string }[] = [
  { id: 'today', label: '오늘' }, { id: '7days', label: '최근 7일' }, { id: 'month', label: '이번 달' }, { id: 'all', label: '전체 기간' }, { id: 'custom', label: '직접 선택' },
];
const dateTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
function formattedDate(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? dateTime.format(date) : '날짜 확인 필요'; }

export function ProductArchive({ onOpenProduct, refreshToken }: ProductArchiveProps) {
  const id = useId(); const [draft, setDraft] = useState(initialFilters); const [filters, setFilters] = useState(initialFilters);
  const [cursors, setCursors] = useState<(string | null)[]>([null]); const [pageIndex, setPageIndex] = useState(0);
  const [page, setPage] = useState<ArchivePage | null>(null); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [reload, setReload] = useState(0);
  const [openingId, setOpeningId] = useState<string | null>(null); const requestSequence = useRef(0);
  const cursor = cursors[pageIndex];
  const load = useCallback(async (signal: AbortSignal) => {
    const sequence = ++requestSequence.current; setLoading(true); setError('');
    const params = new URLSearchParams({ range: filters.range, q: filters.query });
    if (filters.range === 'custom') { params.set('from', filters.from); params.set('to', filters.to); }
    if (cursor) params.set('cursor', cursor);
    try {
      const response = await fetch(`/api/product-archive?${params}`, { cache: 'no-store', signal });
      const data = await response.json() as ArchivePage & { error?: string };
      if (!response.ok) throw new Error(data.error || '기록을 불러오지 못했습니다.');
      if (sequence === requestSequence.current && !signal.aborted) setPage(data as ArchivePage);
    } catch (cause) { if (!signal.aborted && sequence === requestSequence.current) { setPage(null); setError(cause instanceof Error ? cause.message : '기록을 불러오지 못했습니다.'); } }
    finally { if (!signal.aborted && sequence === requestSequence.current) setLoading(false); }
  }, [filters, cursor]);
  useEffect(() => { const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); }); return () => controller.abort(); }, [load, reload, refreshToken]);
  function firstPage(next = filters) { setFilters({ ...next }); setCursors([null]); setPageIndex(0); setPage(null); setNotice(''); setReload(value => value + 1); }
  function movePage(next: number) {
    if (next > pageIndex && page?.nextCursor) setCursors(previous => [...previous.slice(0, pageIndex + 1), page.nextCursor]);
    setPageIndex(next); setPage(null); setNotice('');
  }
  async function copyUrl(url: string) {
    try { await navigator.clipboard.writeText(url); setNotice('전체 상품 URL을 복사했습니다.'); }
    catch { setNotice('자동 복사에 실패했습니다. 표시된 전체 URL을 선택해 복사해주세요.'); }
  }
  async function openProduct(productId: string) {
    setOpeningId(productId); setError('');
    try { await onOpenProduct(productId); }
    catch { setError('상품을 열지 못했습니다. 기록은 유지됩니다. 다시 시도해주세요.'); }
    finally { setOpeningId(null); }
  }
  const groups = new Map<string, NonNullable<ArchivePage['items']>>();
  for (const item of page?.items ?? []) { const day = koreanDay(item.createdAt) || '날짜 확인 필요'; const items = groups.get(day) ?? []; items.push(item); groups.set(day, items); }
  return <section className="sf-archive" aria-labelledby={`${id}-title`}>
    <header className="sf-archive-heading"><div><span className="sf-archive-eyebrow">PRODUCT HISTORY</span><h2 id={`${id}-title`}>상품·수집 요청 보관함</h2><p>등록한 URL과 작업 기록을 날짜별로 찾아보세요. 표시 시각은 모두 한국 시간입니다.</p></div><button type="button" onClick={() => firstPage()} disabled={loading}>최신 기록 새로고침</button></header>
    <form className="sf-archive-filters" onSubmit={event => { event.preventDefault(); firstPage(draft); }}>
      <label htmlFor={`${id}-range`}>조회 기간<select id={`${id}-range`} value={draft.range} onChange={event => setDraft(value => ({ ...value, range: event.target.value as ArchiveRange }))}>{ranges.map(range => <option key={range.id} value={range.id}>{range.label}</option>)}</select></label>
      {draft.range === 'custom' && <><label htmlFor={`${id}-from`}>시작일<input id={`${id}-from`} type="date" required value={draft.from} onChange={event => setDraft(value => ({ ...value, from: event.target.value }))} /></label><label htmlFor={`${id}-to`}>종료일<input id={`${id}-to`} type="date" required min={draft.from || undefined} value={draft.to} onChange={event => setDraft(value => ({ ...value, to: event.target.value }))} /></label></>}
      <label className="sf-archive-search" htmlFor={`${id}-search`}>상품명 · 전체 URL · 1688 상품 번호<input id={`${id}-search`} type="search" value={draft.query} maxLength={2048} placeholder="상품명이나 URL을 입력하세요" onChange={event => setDraft(value => ({ ...value, query: event.target.value }))} /></label>
      <button className="sf-archive-primary" type="submit" disabled={loading}>조회</button>
    </form>
    <div className="sf-archive-summary"><span>{page ? page.from && page.to ? `${page.from} ~ ${page.to}` : '전체 기간' : '조회 조건을 적용하고 있습니다.'}</span><span>상품과 수집 요청은 각각의 기록으로 보관됩니다.</span></div>
    {notice && <p className="sf-archive-notice" role="status">{notice}</p>}
    {error && <div className="sf-archive-error" role="alert"><p>{error}</p><button type="button" onClick={() => firstPage()}>첫 페이지부터 다시 조회</button></div>}
    <div className="sf-archive-results" aria-busy={loading}>
      {loading ? <p className="sf-archive-empty" role="status">저장된 기록을 불러오는 중입니다.</p> : !error && page?.items.length === 0 ? <div className="sf-archive-empty"><strong>이 조건에 맞는 기록이 없습니다.</strong><p>전체 기간을 선택하거나 검색어를 바꿔보세요.</p><button type="button" onClick={() => { const next = { ...initialFilters, range: 'all' as const }; setDraft(next); firstPage(next); }}>전체 기록 보기</button></div> : [...groups].map(([day, items]) => <section className="sf-archive-day" key={day} aria-label={`${day} 등록 기록`}>
        <h3>{day}<span>이 페이지 {items.length}건</span></h3><div className="sf-archive-records">{items.map(item => <article className="sf-archive-record" key={`${item.sourceKind}:${item.id}`}>
          <div className="sf-archive-record-top"><span className={`sf-archive-kind ${item.sourceKind}`}>{item.sourceKind === 'product' ? '저장 상품' : '수집 요청'}</span><span className="sf-archive-status">{archiveStatusLabel(item)}</span>{item.supplierHubStatus && <span className="sf-archive-hub">Supplier Hub · {item.supplierHubStatus}</span>}<time dateTime={item.createdAt}>등록 {formattedDate(item.createdAt)}</time></div>
          <h4>{item.title || `1688 상품 ${item.offerId ?? 'URL'} 수집 요청`}</h4>
          <div className="sf-archive-url">{safeArchiveUrl(item.sourceUrl) ? <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.sourceUrl}</a> : <span>{item.sourceUrl}</span>}<button type="button" onClick={() => void copyUrl(item.sourceUrl)} aria-label={`${item.title || item.offerId || '상품'} 전체 URL 복사`}>URL 복사</button></div>
          <div className="sf-archive-record-bottom"><div><p>{item.category ? <><span>{item.category.source === 'request-snapshot' ? '요청 시 선택 분류' : '같은 URL 요청의 선택 분류'}</span> {item.category.path.join(' › ')}{item.category.id ? ` (${item.category.id})` : ''}</> : <span>연결된 카테고리 기록 없음</span>}</p>{item.sourceKind === 'request' && <p className="sf-archive-request-note">{item.status === 'cancelled' ? '취소한 요청입니다. 수집 완료 상품을 의미하지 않습니다.' : 'URL을 보관한 요청입니다. 아직 상품 수집 완료로 확인되지 않았습니다.'}</p>}</div>{item.sourceKind === 'product' && <button type="button" className="sf-archive-open" onClick={() => void openProduct(item.id)} disabled={openingId !== null}>{openingId === item.id ? '여는 중…' : '상품 작업 열기 →'}</button>}</div>
        </article>)}</div>
      </section>)}
    </div>
    <nav className="sf-archive-pagination" aria-label="상품 기록 페이지"><button type="button" disabled={loading || pageIndex === 0} onClick={() => movePage(pageIndex - 1)}>← 이전</button><span>{pageIndex + 1} 페이지{page ? ` · ${page.items.length}건` : ''}</span><button type="button" disabled={loading || !page?.nextCursor} onClick={() => movePage(pageIndex + 1)}>다음 →</button></nav>
  </section>;
}
