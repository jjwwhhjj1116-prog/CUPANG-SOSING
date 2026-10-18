'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DocumentImagePanel } from '@/app/components/document-image-panel';
import { SizeChartExtractionPanel } from '@/app/components/size-chart-extraction-panel';
import { MANUAL_SIZE_CHART_COLUMNS, MANUAL_SIZE_CHART_ROWS, manualSizeUnits, validateManualSizeChart, type ManualSizeChart } from '@/app/manual-size-chart';
import type { ProductContent } from '@/app/product-content';

type Props = { productId: string; version: string; onSaved?: () => void };
type Draft = { chart: ManualSizeChart; sizesInput: string } | null;
type Saved = { content: ProductContent; version: string };
const seed = (): ManualSizeChart => ({ sizeType: '일반 사이즈', sizeUnits: 'cm', sizes: ['사이즈'], measurements: [{ name: '', values: [''] }] });
const draftOf = (chart: ManualSizeChart): NonNullable<Draft> => ({ chart: structuredClone(chart), sizesInput: chart.sizes.join(', ') });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function readContent(value: unknown, productId: string): ProductContent {
  const content = (value as { content?: ProductContent })?.content;
  if (!content || content.schemaVersion !== 1 || content.productId !== productId || !Number.isSafeInteger(content.revision) || content.revision < 0
    || !Array.isArray(content.assets?.size?.value)) throw Error('저장한 사이즈표 응답을 확인하지 못했습니다.');
  if (content.manualSizeChart !== undefined) validateManualSizeChart(content.manualSizeChart);
  return content;
}
/** A lost acknowledgement is recovered only from the exact next content state.
 * Other saved content and role assignments cannot be silently acknowledged. */
function acknowledges(content: ProductContent, before: ProductContent, chart: ManualSizeChart | null) {
  if (content.revision !== before.revision + 1 || !same(content.manualSizeChart, chart ?? undefined)) return false;
  const changed = !same(before.manualSizeChart, chart ?? undefined);
  const rest = (value: ProductContent) => {
    const { revision: _revision, updatedAt: _updatedAt, manualSizeChart: _chart, assets, ...other } = value;
    void _revision; void _updatedAt; void _chart;
    const { size: _size, ...roles } = assets; void _size;
    return { ...other, assets: roles };
  };
  return same(rest(content), rest(before)) && (changed ? content.assets.size.value.length === 0 : same(content.assets.size, before.assets.size));
}

export function SizeChartWorkspace(props: Props) { return <Editor key={props.productId} {...props} />; }
function Editor({ productId, version, onSaved }: Props) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [busy, setBusy] = useState(false), [imageBusy, setImageBusy] = useState(false);
  const [extractionBusy, setExtractionBusy] = useState(false);
  const [extractionOpen, setExtractionOpen] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(true), operation = useRef(false), sequence = useRef(0);
  const currentVersion = useRef(version), pending = useRef<Draft | undefined>(undefined);
  useEffect(() => { currentVersion.current = version; }, [version]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const imageBusyChanged = useCallback((value: boolean) => setImageBusy(value), []);
  const extractionBusyChanged = useCallback((value: boolean) => setExtractionBusy(value), []);
  const dirty = draft !== undefined, fresh = saved?.version === version;
  const chart = draft === null ? null : draft?.chart ?? saved?.content.manualSizeChart ?? null;
  const locked = busy || imageBusy || extractionBusy;
  function edit(value: Draft | undefined) { pending.current = value; setDraft(value); setNotice(''); }
  async function getContent() {
    const response = await fetch(`/api/products/${encodeURIComponent(productId)}/content`, { cache: 'no-store' });
    const body = await response.json() as { error?: string; content?: unknown };
    if (!response.ok) throw Error(body?.error || '사이즈표를 불러오지 못했습니다.');
    return readContent(body, productId);
  }
  // A refresh must never overwrite edits made while its response is in flight.
  useEffect(() => {
    const ticket = ++sequence.current, requestedVersion = version;
    getContent().then(content => {
      if (alive.current && ticket === sequence.current && currentVersion.current === requestedVersion && pending.current === undefined) setSaved({ content, version: requestedVersion });
    }).catch(cause => { if (alive.current && ticket === sequence.current) setError(cause instanceof Error ? cause.message : '사이즈표 조회 실패'); });
    // Only product identity/version starts an automatic read. Explicit refresh
    // below controls whether unsaved input is kept or discarded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, version]);
  async function reload(keep: boolean) {
    if (operation.current || imageBusy || extractionBusy) return;
    operation.current = true; setBusy(true); setError('');
    const ticket = ++sequence.current, requestedVersion = currentVersion.current;
    try {
      const content = await getContent();
      if (!alive.current || ticket !== sequence.current || currentVersion.current !== requestedVersion) return;
      setSaved({ content, version: requestedVersion });
      if (!keep) edit(undefined);
      setNotice(keep ? '입력은 유지하고 최신 저장본을 확인했습니다.' : '저장한 사이즈표를 다시 불러왔습니다.');
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '사이즈표 조회 실패'); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  function change(transform: (value: NonNullable<Draft>) => NonNullable<Draft>) {
    if (locked || !saved) return;
    edit(transform(draft && draft !== null ? draft : draftOf(saved.content.manualSizeChart ?? seed())));
  }
  function sizesChanged(input: string) {
    change(value => {
      // Column positions, including deliberately repeated names, are preserved.
      // Removing then adding a column never resurrects its former measurements.
      const sizes = input.split(',').map(item => item.trim()).filter(Boolean);
      return { sizesInput: input, chart: { ...value.chart, sizes, measurements: value.chart.measurements.map(row => ({ ...row, values: sizes.map((_, index) => row.values[index] ?? '') })) } };
    });
  }
  async function save() {
    if (operation.current || imageBusy || extractionBusy || !saved || draft === undefined || !fresh) return;
    let normalized: ManualSizeChart | null;
    try { normalized = draft === null ? null : validateManualSizeChart(draft.chart); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '사이즈표 입력을 확인해주세요.'); return; }
    const before = saved.content, requestedVersion = version, ticket = ++sequence.current;
    operation.current = true; setBusy(true); setError(''); setNotice('');
    const current = () => alive.current && ticket === sequence.current && currentVersion.current === requestedVersion;
    try {
      let acknowledged: ProductContent;
      try {
        const response = await fetch(`/api/products/${encodeURIComponent(productId)}/content`, { method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedRevision: before.revision, patch: { manualSizeChart: normalized } }) });
        const body = await response.json() as { error?: string; content?: unknown };
        if (!response.ok) throw Error(body?.error || '사이즈표를 저장하지 못했습니다.');
        acknowledged = readContent(body, productId);
        if (!acknowledges(acknowledged, before, normalized)) throw Error('사이즈표 저장 결과가 요청과 다릅니다. 입력을 유지했습니다.');
      } catch (cause) {
        if (!current()) return;
        const recovered = await getContent().catch(() => null);
        if (!recovered || !acknowledges(recovered, before, normalized)) throw cause;
        acknowledged = recovered;
      }
      if (!current()) return;
      setSaved({ content: acknowledged, version: requestedVersion }); edit(undefined);
      setNotice('사이즈표를 저장했습니다. 변경된 표는 PNG를 새로 만들어 견적서에 연결하세요.'); onSaved?.();
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : '사이즈표 저장 실패'); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  const working = draft && draft !== null ? draft : chart ? draftOf(chart) : null;
  return <section className="panel-stack" aria-label="사이즈표 편집" data-quotation-source-step="옵션" data-workspace-dirty={dirty} data-workspace-saving={locked} aria-busy={busy}>
    <h3>사이즈표 직접 편집</h3>
    <p>사이즈별 측정 항목과 값을 입력합니다. 표를 변경해 저장하면 이전 사이즈표의 견적 연결을 해제하며 원본 파일은 보관합니다.</p>
    <button type="button" className="btn blue" aria-expanded={extractionOpen} disabled={!saved || locked || !fresh || !extractionOpen && dirty} onClick={() => { if (!locked) setExtractionOpen(open => !open); }}>{extractionOpen ? '이미지 추출 영역 닫기' : '이미지에서 사이즈표 초안 만들기'}</button>
    {saved && extractionOpen && <SizeChartExtractionPanel productId={productId} version={version} contentRevision={saved.content.revision} disabled={dirty || busy || imageBusy || !fresh} onBusyChange={extractionBusyChanged} onDraft={value => {
      if (operation.current || imageBusy || pending.current !== undefined || currentVersion.current !== saved.version) return;
      edit(draftOf(validateManualSizeChart(value))); setNotice('이미지에서 추출한 표를 가져왔습니다. 원본과 비교해 수정한 뒤 정보를 저장해주세요.');
    }}/>}
    {!saved && !error && <p role="status">저장한 사이즈표를 불러오는 중…</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {dirty && !fresh && <p role="status">상품 저장 상태가 변경되었습니다. 입력은 유지했습니다. 최신 저장본을 조회한 뒤 저장해주세요.</p>}
    {!working ? <button type="button" className="btn blue" disabled={!saved || locked} onClick={() => edit(draftOf(seed()))}>사이즈표 직접 작성</button> : <>
      <div className="modal-form"><label>사이즈 유형<input aria-label="사이즈 유형" maxLength={80} value={working.chart.sizeType} disabled={locked} onChange={event => change(value => ({ ...value, chart: { ...value.chart, sizeType: event.target.value } }))}/></label>
        <label>단위<select aria-label="사이즈표 단위" value={working.chart.sizeUnits} disabled={locked} onChange={event => change(value => ({ ...value, chart: { ...value.chart, sizeUnits: event.target.value as ManualSizeChart['sizeUnits'] } }))}>{manualSizeUnits.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></label>
        <label>사이즈 목록<input aria-label="사이즈 목록" maxLength={MANUAL_SIZE_CHART_COLUMNS * 82} placeholder="예: S, M, L, XL" value={working.sizesInput} disabled={locked} onChange={event => sizesChanged(event.target.value)}/><small>쉼표로 구분 · 최대 {MANUAL_SIZE_CHART_COLUMNS}열</small></label></div>
      <div className="table-wrap"><table><thead><tr><th>측정 부위</th>{working.chart.sizes.map((size, index) => <th key={index}>{size}</th>)}<th>관리</th></tr></thead><tbody>{working.chart.measurements.map((row, index) => <tr key={index}>
        <td><input aria-label={`측정 항목 ${index + 1} 이름`} maxLength={80} value={row.name} disabled={locked} placeholder="예: 총장" onChange={event => change(value => ({ ...value, chart: { ...value.chart, measurements: value.chart.measurements.map((item, at) => at === index ? { ...item, name: event.target.value } : item) } }))}/></td>
        {row.values.map((cell, column) => <td key={column}><input aria-label={`측정 항목 ${index + 1} 사이즈 ${column + 1} 값`} maxLength={200} value={cell} disabled={locked} onChange={event => change(value => ({ ...value, chart: { ...value.chart, measurements: value.chart.measurements.map((item, at) => at === index ? { ...item, values: item.values.map((old, col) => col === column ? event.target.value : old) } : item) } }))}/></td>)}
        <td><button type="button" className="btn ghost" aria-label={`측정 항목 ${index + 1} 삭제`} disabled={locked} onClick={() => change(value => ({ ...value, chart: { ...value.chart, measurements: value.chart.measurements.filter((_, at) => at !== index) } }))}>삭제</button></td>
      </tr>)}</tbody></table></div>
      <button type="button" className="btn ghost" disabled={locked || working.chart.measurements.length >= MANUAL_SIZE_CHART_ROWS} onClick={() => change(value => ({ ...value, chart: { ...value.chart, measurements: [...value.chart.measurements, { name: '', values: value.chart.sizes.map(() => '') }] } }))}>＋ 측정 항목 추가</button>
      <p>공란은 이미지에서 ‘-’로 표시합니다. 치수·무게·법적 고시나 옵션 값에는 자동으로 반영하지 않습니다.</p>
    </>}
    {saved && <div className="quote-actions"><button type="button" className="btn primary" disabled={!dirty || locked || !fresh} onClick={() => void save()}>사이즈표 정보 저장</button>
      {saved.content.manualSizeChart && <button type="button" className="btn ghost" disabled={locked} onClick={() => edit(null)}>옵션 치수 표로 전환</button>}
      {dirty && <button type="button" className="btn ghost" disabled={locked} onClick={() => void reload(true)}>입력 유지·최신 사이즈표 조회</button>}
      <button type="button" className="btn ghost" disabled={locked} onClick={() => void reload(false)}>{dirty ? '입력 취소·저장 사이즈표 조회' : '저장 사이즈표 다시 조회'}</button></div>}
    {draft === null && <p role="status">정보를 저장하면 직접 작성한 표 대신 저장된 옵션 치수·무게로 표를 만듭니다.</p>}
    {dirty && <p role="status">사이즈표 정보를 먼저 저장하거나 입력을 취소한 뒤 PNG를 만들어주세요.</p>}
    <DocumentImagePanel key={`${productId}:${saved?.content.revision ?? 'loading'}`} productId={productId} version={version} section="size" disabled={!saved || dirty || busy || extractionBusy || !fresh} onBusyChange={imageBusyChanged} onSaved={onSaved}/>
  </section>;
}
